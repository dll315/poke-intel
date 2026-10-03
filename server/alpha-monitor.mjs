import {transaction,audit} from './db.mjs';

const regionIds={kanto:'kanto',johto:'johto',hoenn:'hoenn',sinnoh:'sinnoh',unova:'unova'};
const source='alphapedia-alpha';
function text(value,max){const result=String(value||'').trim();if(!result||result.length>max)throw new Error('Alphapedia 状态字段缺失或无效');return result;}
function attribute(html,name){const match=new RegExp(`data-${name}=["']([^"']+)["']`,'i').exec(html);return match?.[1]?.replace(/&amp;/g,'&')||'';}
function cleanError(error){return String(error?.message||error||'监控失败').replace(/https?:\/\/\S+/gi,'[远程地址]').replace(/(?:token|session|key)=[^\s&]+/gi,'$1=[已隐藏]').slice(0,300);}

export function parseLandingStatus(payload){
  if(!payload||typeof payload!=='object')throw new Error('Alphapedia 状态响应无法解析');
  const pokemon=text(payload.latest_ping_raw,50),html=text(payload.latest_ping_details_html,20000);
  const regionRaw=text(attribute(html,'region'),30),region=regionIds[regionRaw.toLowerCase()];if(!region)throw new Error('Alphapedia 状态地区无法解析');
  const location=text(attribute(html,'location'),100);const href=/<a[^>]+href=["']([^"']*\/alpha-list\?[^"']+)["']/i.exec(html)?.[1]?.replace(/&amp;/g,'&');if(!href)throw new Error('Alphapedia 状态来源无法解析');
  const url=new URL(href,'https://alpha.pokemmotools.org');if(url.origin!=='https://alpha.pokemmotools.org'||url.pathname!=='/alpha-list')throw new Error('Alphapedia 状态来源无效');
  const timestamp=Number(url.searchParams.get('timestamp'));if(!Number.isSafeInteger(timestamp)||timestamp<=0)throw new Error('Alphapedia 状态时间戳无法解析');
  const timeMatch=String(payload.latest_ping_time||'').match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) UTC/);if(!timeMatch)throw new Error('Alphapedia 状态时间无法解析');
  const observedAt=new Date(`${timeMatch[1]}T${timeMatch[2]}Z`).toISOString();const expiresAt=new Date(Date.parse(observedAt)+75*60000).toISOString();
  return{sourceEventId:`alphapedia:${timestamp}:${pokemon}:${region}:${location}`,pokemon,region,location,observedAt,expiresAt,sourceUrl:url.href};
}

export function publishExternalEvent({db,notifications,event,now=Date.now}){
  const existing=db.prepare("SELECT id FROM reports WHERE source='external' AND source_event_id=?").get(event.sourceEventId);if(existing)return{published:false};
  if(Date.parse(event.expiresAt)<=now())return{published:false};
  return transaction(db,()=>{
    if(db.prepare("SELECT id FROM reports WHERE source='external' AND source_event_id=?").get(event.sourceEventId))return{published:false};
    const at=new Date(now()).toISOString();const reportResult=db.prepare("INSERT INTO reports(kind,pokemon,region,location,observed_at,note,status,event_id,source,source_url,source_event_id,suggested_expires_at,created_at) VALUES('boss',?,?,?,?,?,'approved',NULL,'external',?,?,?,?)")
      .run(event.pokemon,event.region,event.location,event.observedAt,'Alphapedia 自动监控',event.sourceUrl,event.sourceEventId,event.expiresAt,at);
    const eventResult=db.prepare("INSERT INTO events(kind,pokemon,region,location,observed_at,expires_at,last_confirmed_at,status,source,source_url,note) VALUES('boss',?,?,?,?,?,?,'active','external',?,'Alphapedia 自动监控')")
      .run(event.pokemon,event.region,event.location,event.observedAt,event.expiresAt,event.observedAt,event.sourceUrl);const eventId=Number(eventResult.lastInsertRowid);
    db.prepare('UPDATE reports SET event_id=? WHERE id=?').run(eventId,Number(reportResult.lastInsertRowid));
    notifications.enqueueEvent(eventId);audit(db,null,'external.alpha.publish','event',eventId,{source,sourceEventId:event.sourceEventId},at);return{published:true,eventId};
  });
}

export function createAlphaMonitor({db,notifications,fetchImpl=globalThis.fetch,now=Date.now,enabled=false,intervalMs=30000,baseUrl='https://alpha.pokemmotools.org',autoStart=true}={}){
  if(intervalMs<15000||intervalMs>300000)throw new Error('头目监控间隔必须在 15–300 秒之间');
  let token='',cookie='',timer=null,inFlight=null,controller=null,closed=false;
  db.prepare('INSERT OR IGNORE INTO external_monitor_state(source) VALUES(?)').run(source);
  const state=()=>db.prepare('SELECT * FROM external_monitor_state WHERE source=?').get(source);
  function save(fields){const keys=Object.keys(fields);db.prepare(`UPDATE external_monitor_state SET ${keys.map(key=>key+'=?').join(',')} WHERE source=?`).run(...keys.map(key=>fields[key]),source);}
  async function establish(){controller=new AbortController();const response=await fetchImpl(new URL('/',baseUrl),{headers:{'User-Agent':'Poke-Intel-Monitor/1.0','Accept':'text/html'},redirect:'error',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)])});if(!response.ok)throw new Error(`Alphapedia 会话请求失败 (${response.status})`);const html=await response.text();token=/<meta\s+name=["']landing-status-token["']\s+content=["']([^"']+)/i.exec(html)?.[1]||'';if(!/^[A-Za-z0-9_-]{16,128}$/.test(token))throw new Error('Alphapedia 状态令牌无法解析');cookie=(response.headers.get('set-cookie')||'').split(';')[0];}
  async function statusRequest(retry=true){if(!token)await establish();controller=new AbortController();const response=await fetchImpl(new URL('/api/landing-status',baseUrl),{headers:{'User-Agent':'Poke-Intel-Monitor/1.0','Accept':'application/json','X-Landing-Status-Token':token,'Referer':new URL('/',baseUrl).href,...(cookie?{Cookie:cookie}:{})},redirect:'error',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)])});if((response.status===401||response.status===403)&&retry){token='';cookie='';return statusRequest(false);}if(response.status===204)return null;if(!response.ok)throw new Error(`Alphapedia 状态请求失败 (${response.status})`);return response.json();}
  async function check(){const checkedAt=new Date(now()).toISOString();try{const payload=await statusRequest();let event=null;if(payload){event=parseLandingStatus(payload);if(event.sourceEventId!==state().last_event_id&&Date.parse(event.expiresAt)>now())publishExternalEvent({db,notifications,event,now});}save({last_checked_at:checkedAt,last_success_at:checkedAt,last_event_id:event?.sourceEventId||state().last_event_id,last_event_json:event?JSON.stringify(event):state().last_event_json,last_error:null,consecutive_failures:0});return event;}catch(error){const current=state();save({last_checked_at:checkedAt,last_error:cleanError(error),consecutive_failures:current.consecutive_failures+1});throw error;}finally{controller=null;}}
  function runOnce(){if(!enabled)return Promise.resolve(null);if(inFlight)return inFlight;inFlight=check().finally(()=>{inFlight=null;});return inFlight;}
  function start(){if(!enabled||closed||timer)return;const tick=()=>void runOnce().catch(()=>{});timer=setInterval(tick,intervalMs);timer.unref();tick();}
  async function close(){closed=true;if(timer)clearInterval(timer);timer=null;controller?.abort();if(inFlight)try{await inFlight;}catch{}}
  function status(){const row=state();let lastEvent=null;try{lastEvent=row.last_event_json?JSON.parse(row.last_event_json):null;}catch{}return{enabled,intervalSeconds:intervalMs/1000,lastCheckedAt:row.last_checked_at,lastSuccessAt:row.last_success_at,lastEvent,consecutiveFailures:row.consecutive_failures,lastError:row.last_error};}
  const monitor={enabled,start,runOnce,close,status};if(autoStart)start();return monitor;
}
