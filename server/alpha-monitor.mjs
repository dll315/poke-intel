import {transaction,audit} from './db.mjs';
import {translateLocation} from './location-zh.mjs';
import {translatePokemon} from './catalog.mjs';

const regionIds={kanto:'kanto',johto:'johto',hoenn:'hoenn',sinnoh:'sinnoh',unova:'unova'};
const sourceFor=kind=>kind==='swarm'?'alphapedia-swarm':kind==='pheno'?'alphapedia-pheno':'alphapedia-alpha';
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

function parseHistoryRow(row,kind='boss'){
  if(!row||typeof row!=='object')throw new Error('Alphapedia 历史记录无法解析');
  const pokemon=text(row.pokemon,50),regionRaw=text(row.region,30),region=regionIds[regionRaw.toLowerCase()];if(!region)throw new Error('Alphapedia 历史地区无法解析');
  const location=text(row.location,100),stamp=text(row.timestampIso,40);if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(stamp))throw new Error('Alphapedia 历史时间无法解析');
  const observedAt=new Date(stamp+'Z').toISOString();
  const url=new URL(text(row.alphaUrl,1000),'https://alpha.pokemmotools.org');if(url.origin!=='https://alpha.pokemmotools.org'||url.pathname!==(kind==='swarm'?'/swarm-list':'/alpha-list'))throw new Error('Alphapedia 历史来源无效');
  const timestamp=Number(url.searchParams.get('timestamp'));if(!Number.isSafeInteger(timestamp)||timestamp<=0)throw new Error('Alphapedia 历史时间戳无法解析');
  const expiresAt=new Date(Date.parse(observedAt)+(kind==='swarm'?20:75)*60000).toISOString();
  return{kind,sourceEventId:`alphapedia${kind==='swarm'?'-swarm':''}:${timestamp}:${pokemon}:${region}:${location}`,pokemon,region,location,observedAt,expiresAt,sourceUrl:url.href};
}

export function parsePhenoStatus(payload){
  const html=text(payload?.pheno_section_html,50000);
  const match=/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) UTC/.exec(String(payload?.now_label||''));
  if(!match)throw new Error('Alphapedia 奇遇时间无法解析');
  const serverNow=Date.parse(`${match[1]}T${match[2]}Z`),events=[];
  for(const card of html.matchAll(/<article\b[^>]*class=["']([^"']*\bpheno-card\b[^"']*)["'][^>]*>([\s\S]*?)<\/article>/gi)){
    if(!card[1].split(/\s+/).includes('card-active-pheno'))continue;
    const body=card[2],pokemon=text(/data-pokemon=["']([^"']+)/i.exec(body)?.[1],50),location=text(/data-location=["']([^"']+)/i.exec(body)?.[1],100);
    const type=text(/data-i18n=["'](Dust|Grass|Shadow|Water) Pheno["']/i.exec(body)?.[1],20);
    const age=Number(/data-timedelta=["'](\d+)["']/i.exec(body)?.[1]);if(!Number.isSafeInteger(age)||age<0||age>86400)throw new Error('Alphapedia 奇遇时间无效');
    const href=/<a[^>]+href=["']([^"']*\/pheno-list\?[^"']+)/i.exec(body)?.[1]?.replace(/&amp;/g,'&');
    const url=new URL(text(href,1000),'https://alpha.pokemmotools.org');if(url.origin!=='https://alpha.pokemmotools.org'||url.pathname!=='/pheno-list')throw new Error('Alphapedia 奇遇来源无效');
    const observedAt=new Date(serverNow-age*1000).toISOString(),expiresAt=new Date(serverNow+(600-age)*1000).toISOString();
    events.push({kind:'pheno',sourceEventId:`alphapedia-pheno:${Math.floor((serverNow-age*1000)/1000)}:${pokemon}:${type}:${location}`,pokemon,region:'unova',location,observedAt,expiresAt,sourceUrl:url.href,note:{Dust:'尘土',Grass:'草丛',Shadow:'阴影',Water:'水面'}[type]+'奇遇'});
  }
  return events;
}

export function publishExternalEvent({db,notifications,event,now=Date.now}){
  const kind=event.kind||'boss';
  const existing=db.prepare("SELECT event_id FROM reports WHERE source='external' AND source_event_id=?").get(event.sourceEventId);if(existing){if(kind==='pheno'&&existing.event_id)db.prepare("UPDATE events SET last_confirmed_at=? WHERE id=? AND status='active'").run(new Date(now()).toISOString(),existing.event_id);return{published:false};}
  if(Date.parse(event.expiresAt)<=now())return{published:false};
  return transaction(db,()=>{
    if(db.prepare("SELECT id FROM reports WHERE source='external' AND source_event_id=?").get(event.sourceEventId))return{published:false};
    const at=new Date(now()).toISOString();const reportResult=db.prepare("INSERT INTO reports(kind,pokemon,region,location,observed_at,note,status,event_id,source,source_url,source_event_id,suggested_expires_at,created_at) VALUES(?,?,?,?,?,?,'approved',NULL,'external',?,?,?,?)")
      .run(kind,event.pokemon,event.region,event.location,event.observedAt,event.note||'Alphapedia 自动监控',event.sourceUrl,event.sourceEventId,event.expiresAt,at);
    const eventResult=db.prepare("INSERT INTO events(kind,pokemon,region,location,observed_at,expires_at,last_confirmed_at,status,source,source_url,note) VALUES(?,?,?,?,?,?,?,'active','external',?,'Alphapedia 自动监控')")
      .run(kind,event.pokemon,event.region,event.location,event.observedAt,event.expiresAt,event.observedAt,event.sourceUrl);const eventId=Number(eventResult.lastInsertRowid);
    if(event.note)db.prepare('UPDATE events SET note=? WHERE id=?').run(event.note,eventId);
    db.prepare('UPDATE reports SET event_id=? WHERE id=?').run(eventId,Number(reportResult.lastInsertRowid));
    notifications.enqueueEvent(eventId);audit(db,null,'external.alpha.publish','event',eventId,{source:sourceFor(kind),sourceEventId:event.sourceEventId},at);return{published:true,eventId};
  });
}

export function createAlphaMonitor({db,notifications,fetchImpl=globalThis.fetch,now=Date.now,enabled=false,intervalMs=30000,baseUrl='https://alpha.pokemmotools.org',kind='boss',autoStart=true}={}){
  if(intervalMs<15000||intervalMs>300000)throw new Error('头目监控间隔必须在 15–300 秒之间');
  if(!['boss','swarm','pheno'].includes(kind))throw new Error('监控类型无效');
  const source=sourceFor(kind),historyPath=kind==='swarm'?'/swarm-history':'/history',historyApi=kind==='swarm'?'/api/swarm-history-data':'/api/history-data';
  let token='',cookie='',historyToken='',historyCookie='',timer=null,inFlight=null,controller=null,closed=false;
  db.prepare('INSERT OR IGNORE INTO external_monitor_state(source) VALUES(?)').run(source);
  function repairLegacySwarmExpiry(){
    if(kind!=='swarm')return;
    const old=db.prepare("SELECT id,observed_at,expires_at FROM events WHERE kind='swarm' AND source='external' AND status='active'").all();
    const correct=db.prepare("UPDATE events SET expires_at=?,status=? WHERE id=? AND status='active'");
    for(const row of old){const start=Date.parse(row.observed_at);if(!Number.isFinite(start)||row.expires_at!==new Date(start+75*60000).toISOString())continue;const end=new Date(start+20*60000).toISOString();correct.run(end,Date.parse(end)<=now()?'ended':'active',row.id);}
  }
  repairLegacySwarmExpiry();
  const state=()=>db.prepare('SELECT * FROM external_monitor_state WHERE source=?').get(source);
  function save(fields){const keys=Object.keys(fields);db.prepare(`UPDATE external_monitor_state SET ${keys.map(key=>key+'=?').join(',')} WHERE source=?`).run(...keys.map(key=>fields[key]),source);}
  async function fetchHistory(url,headers,timeoutMs=20000){for(let attempt=0;attempt<2;attempt++){
    controller=new AbortController();try{return await fetchImpl(url,{headers,redirect:'error',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(timeoutMs)])});}
    catch(error){if(attempt===1||closed)throw error;}
  }}
  async function establish(){controller=new AbortController();const response=await fetchImpl(new URL('/',baseUrl),{headers:{'User-Agent':'Poke-Intel-Monitor/1.0','Accept':'text/html'},redirect:'error',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)])});if(!response.ok)throw new Error(`Alphapedia 会话请求失败 (${response.status})`);const html=await response.text();token=/<meta\s+name=["']landing-status-token["']\s+content=["']([^"']+)/i.exec(html)?.[1]||'';if(!/^[A-Za-z0-9_-]{16,128}$/.test(token))throw new Error('Alphapedia 状态令牌无法解析');cookie=(response.headers.get('set-cookie')||'').split(';')[0];}
  async function statusRequest(retry=true){if(!token)await establish();controller=new AbortController();const response=await fetchImpl(new URL('/api/landing-status',baseUrl),{headers:{'User-Agent':'Poke-Intel-Monitor/1.0','Accept':'application/json','X-Landing-Status-Token':token,'Referer':new URL('/',baseUrl).href,...(cookie?{Cookie:cookie}:{})},redirect:'error',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)])});if((response.status===401||response.status===403)&&retry){token='';cookie='';return statusRequest(false);}if(response.status===204)return null;if(!response.ok)throw new Error(`Alphapedia 状态请求失败 (${response.status})`);return response.json();}
  async function historyRequest(retry=true){
    if(!historyToken){
      const page=await fetchHistory(new URL(historyPath,baseUrl),{'User-Agent':'Poke-Intel-Monitor/1.0','Accept':'text/html'});
      if(!page.ok)throw new Error(`Alphapedia 历史会话请求失败 (${page.status})`);
      const html=await page.text();historyToken=/<meta\s+name=["']history-api-token["']\s+content=["']([^"']+)/i.exec(html)?.[1]||'';
      if(!/^[A-Za-z0-9_-]{16,128}$/.test(historyToken))throw new Error('Alphapedia 历史令牌无法解析');
      historyCookie=(page.headers.get('set-cookie')||'').split(';')[0];
    }
    const url=new URL(historyApi+'?page=1&pageSize=100',baseUrl);
    const response=await fetchHistory(url,{'User-Agent':'Poke-Intel-Monitor/1.0','Accept':'application/json','X-History-Token':historyToken,'Referer':new URL(historyPath,baseUrl).href,...(historyCookie?{Cookie:historyCookie}:{})});
    if((response.status===401||response.status===403)&&retry){historyToken='';historyCookie='';return historyRequest(false);}
    if(!response.ok)throw new Error(`Alphapedia 历史请求失败 (${response.status})`);
    const payload=await response.json();if(!Array.isArray(payload?.historyData))throw new Error('Alphapedia 历史响应无法解析');
    return payload.historyData.map(row=>parseHistoryRow(row,kind));
  }
  async function phenoRequest(){
    const response=await fetchHistory(new URL('/',baseUrl),{'User-Agent':'Poke-Intel-Monitor/1.0','Accept':'text/html'},12000);
    if(!response.ok)throw new Error(`Alphapedia 奇遇页面请求失败 (${response.status})`);
    const html=await response.text(),start=html.indexOf('id="phenoSectionHost"');
    if(start<0)throw new Error('Alphapedia 奇遇卡片无法解析');
    const nowLabel=/<span[^>]*id=["']landingNowLabel["'][^>]*>([^<]+)/i.exec(html)?.[1];
    return parsePhenoStatus({pheno_section_html:html.slice(start,start+10000),now_label:nowLabel});
  }
  async function check(){const checkedAt=new Date(now()).toISOString();try{
    let events,warning=null;
    if(kind==='pheno')events=await phenoRequest();
    else try{events=await historyRequest();}catch(error){if(kind==='swarm')throw error;warning=`历史接口不可用，已使用首页摘要：${cleanError(error)}`;const payload=await statusRequest();events=payload?[parseLandingStatus(payload)]:[];}
    if(kind==='swarm')repairLegacySwarmExpiry();
    for(const event of events)if(Date.parse(event.expiresAt)>now())publishExternalEvent({db,notifications,event,now});
    if(kind==='pheno'){
      const activeIds=new Set(events.filter(event=>Date.parse(event.expiresAt)>now()).map(event=>event.sourceEventId));
      const tracked=db.prepare("SELECT r.source_event_id,e.id FROM reports r JOIN events e ON e.id=r.event_id WHERE r.source='external' AND r.kind='pheno' AND e.status='active'").all();
      const end=db.prepare("UPDATE events SET status='ended',expires_at=? WHERE id=? AND status='active'");
      for(const row of tracked)if(!activeIds.has(row.source_event_id))end.run(checkedAt,row.id);
    }
    const event=events[0]||null,current=state();save({last_checked_at:checkedAt,last_success_at:checkedAt,last_event_id:event?.sourceEventId||current.last_event_id,last_event_json:event?JSON.stringify(event):current.last_event_json,last_error:warning,consecutive_failures:0});return event;
  }catch(error){const current=state();save({last_checked_at:checkedAt,last_error:cleanError(error),consecutive_failures:current.consecutive_failures+1});throw error;}finally{controller=null;}}
  function runOnce(){if(!enabled)return Promise.resolve(null);if(inFlight)return inFlight;inFlight=check().finally(()=>{inFlight=null;});return inFlight;}
  function start(){if(!enabled||closed||timer)return;const tick=()=>void runOnce().catch(()=>{});timer=setInterval(tick,intervalMs);timer.unref();tick();}
  async function close(){closed=true;if(timer)clearInterval(timer);timer=null;controller?.abort();if(inFlight)try{await inFlight;}catch{}}
  function status(){const row=state();let lastEvent=null;try{lastEvent=row.last_event_json?JSON.parse(row.last_event_json):null;if(lastEvent)lastEvent={...lastEvent,pokemonZh:translatePokemon(db,lastEvent.pokemon),locationZh:translateLocation(lastEvent.location,lastEvent.region)};}catch{}return{kind,enabled,intervalSeconds:intervalMs/1000,lastCheckedAt:row.last_checked_at,lastSuccessAt:row.last_success_at,lastEvent,consecutiveFailures:row.consecutive_failures,lastError:row.last_error};}
  const monitor={enabled,start,runOnce,close,status};if(autoStart)start();return monitor;
}
