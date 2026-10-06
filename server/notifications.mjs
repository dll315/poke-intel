import {transaction} from './db.mjs';
import {translatePokemon,translateMove} from './catalog.mjs';
import {ApiError} from './validation.mjs';
import {categoryForEvent} from './notification-categories.mjs';
import {translateLocation} from './location-zh.mjs';

const MAX_ATTEMPTS=6;
const SEND_GAP_MS=3500;
const regionNames={kanto:'关都',johto:'城都',hoenn:'丰缘',sinnoh:'神奥',unova:'合众'};
const formatter=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});

export function validateWecomWebhook(value='') {
  if(!value.trim())return '';
  try {
    const url=new URL(value.trim());
    if(url.protocol!=='https:'||url.hostname!=='qyapi.weixin.qq.com'||url.port||url.username||url.password||url.hash||url.pathname!=='/cgi-bin/webhook/send')throw new Error();
    if(url.searchParams.size!==1||!url.searchParams.get('key')||url.searchParams.get('key').length>512)throw new Error();
    return url.href;
  }catch{throw new Error('企业微信 Webhook 配置无效，请使用机器人的官方 HTTPS 地址。');}
}

function safeText(value) {
  return String(value).replace(/[\r\n\t]/g,' ').replace(/[*_`\[\]()#\\]/g,'').replace(/[<>@]/g,char=>({'<':'‹','>':'›','@':'＠'}[char]));
}
function message(db,event,origin) {
  const link=new URL('/',origin);
  link.searchParams.set('q',event.pokemon);link.searchParams.set('kind',event.kind);link.searchParams.set('region',event.region);
  const catalog=event.kind==='boss'&&event.source==='external'?db.prepare("SELECT location_note,hms,moveset,tier FROM external_catalog WHERE kind='boss' AND pokemon=? COLLATE NOCASE AND region=? AND location=? ORDER BY synced_at DESC LIMIT 1").get(event.pokemon,event.region,event.location):null;
  let hms=[],moveset=[];try{hms=JSON.parse(catalog?.hms||'[]');if(!Array.isArray(hms))hms=[];}catch{}
  try{moveset=JSON.parse(catalog?.moveset||'[]');if(!Array.isArray(moveset))moveset=[];}catch{}
  const hmNames={Cut:'居合劈',Flash:'闪光',Surf:'冲浪',Strength:'怪力',Fly:'飞翔','Rock Smash':'碎岩',Waterfall:'攀瀑',Dive:'潜水'};
  return {msgtype:'markdown',markdown:{content:[
    `# 新${event.kind==='boss'?'头目':event.kind==='pheno'?'奇遇':'群聚'}情报`,
    `**宝可梦：** ${safeText(translatePokemon(db,event.pokemon))}`,
    `**地区：** ${regionNames[event.region]}`,
    `**地点：** ${safeText(translateLocation(event.location,event.region))}`,
    ...(event.source==='external'&&translateLocation(event.location,event.region)!==event.location?[`**来源地名：** ${safeText(event.location)}`]:[]),
    ...(catalog?.location_note?[`**地点说明（来源原文）：** ${safeText(String(catalog.location_note).slice(0,300))}`]:[]),
    ...(catalog?.tier!=null?[`**资料分级：** ${safeText(catalog.tier)}`]:[]),
    ...(hms.length?[`**所需秘传：** ${hms.map(hm=>safeText(hmNames[hm]||hm)).join('、')}`]:[]),
    ...(event.kind==='boss'&&event.source==='external'?[moveset.length?`**来源资料配招：** ${moveset.map(move=>safeText(translateMove(db,move))).join('、')}（当次头目招式仍需游戏内核实）`:`**配招：** 来源资料暂未提供，请以游戏内实际招式为准。`]:[]),
    ...(event.kind==='pheno'&&event.note?[`**奇遇信息：** ${safeText(event.note)}`]:[]),
    `**观察时间：** ${formatter.format(new Date(event.observed_at))}（北京时间）`,
    `**${event.source==='external'?'预计结束':'展示截止'}：** ${formatter.format(new Date(event.expires_at))}（北京时间）`,
    '[查看网站情报]('+link.href+')',
    ...(event.source==='external'&&event.source_url?.startsWith('https://alpha.pokemmotools.org/')?[`[查看 Alphapedia 原始记录](${event.source_url})`]:[]),
    event.source==='external'
      ? '> 来源：Alphapedia 自动监控。结束时间按头目 75 分钟、群聚 20 分钟、奇遇 10 分钟估计；以来源状态和游戏实际情况为准。'
      : '> 玩家上报，已通过平台审核；是否仍有效请以游戏实际情况为准。',
  ].join('\n')}};
}

export function createNotifications({db,now,origin,webhookUrl='',settings=null,fetchImpl=globalThis.fetch}) {
  const destinations=()=>settings?settings.getNotificationDestinations():(webhookUrl?[{id:'primary',webhookUrl}]:[]);
  const destination=id=>settings?settings.getDestination(id):(id==='primary'?webhookUrl:null);
  let timer=null;let closed=false;let inFlight=null;let activeController=null;
  function enqueueEvent(eventId) {
    const event=db.prepare('SELECT kind,source FROM events WHERE id=?').get(eventId);if(!event)return;
    const category=categoryForEvent(event),targets=destinations().filter(target=>!target.categories||target.categories.includes(category));if(!targets.length)return;
    db.prepare("INSERT OR IGNORE INTO notification_outbox(event_id,state,created_at,next_attempt_at) VALUES(?,'pending',?,?)")
      .run(eventId,new Date(now()).toISOString(),now());
    const insert=db.prepare("INSERT OR IGNORE INTO notification_deliveries(event_id,destination_id,state,next_attempt_at) VALUES(?,?,'pending',?)");
    for(const target of targets)insert.run(eventId,target.id,now());
  }
  function updateAggregate(eventId,error=null){
    const rows=db.prepare('SELECT state,next_attempt_at FROM notification_deliveries WHERE event_id=?').all(eventId);
    if(!rows.length)return;
    const pending=rows.filter(row=>row.state==='pending'||row.state==='sending');
    const state=pending.length?'pending':rows.some(row=>row.state==='failed')?'failed':rows.some(row=>row.state==='sent')?'sent':'skipped';
    const next=pending.length?Math.min(...pending.map(row=>row.next_attempt_at)):now();
    db.prepare('UPDATE notification_outbox SET state=?,next_attempt_at=?,lease_until=NULL,sent_at=CASE WHEN ?=? THEN ? ELSE sent_at END,last_error=CASE WHEN ?=? THEN NULL ELSE COALESCE(?,last_error) END WHERE event_id=?')
      .run(state,next,state,'sent',new Date(now()).toISOString(),state,'sent',error,eventId);
  }
  function claim() {
    return transaction(db,()=>{
      const timestamp=now();
      const legacy=db.prepare("SELECT o.* FROM notification_outbox o WHERE o.state IN ('pending','sending') AND NOT EXISTS(SELECT 1 FROM notification_deliveries d WHERE d.event_id=o.event_id)").all();
      if(legacy.length){const targets=destinations(),insert=db.prepare('INSERT OR IGNORE INTO notification_deliveries(event_id,destination_id,state,attempts,next_attempt_at,attempted_at,lease_until) VALUES(?,?,?,?,?,?,?)');for(const job of legacy){const event=db.prepare('SELECT kind,source FROM events WHERE id=?').get(job.event_id);for(const target of targets)if(event&&(!target.categories||target.categories.includes(categoryForEvent(event))))insert.run(job.event_id,target.id,job.state,job.attempts,job.next_attempt_at,job.lease_until);}}
      const last=db.prepare('SELECT max(attempted_at) last FROM notification_outbox').get().last;
      if(last!==null&&timestamp-last<SEND_GAP_MS)return null;
      const job=db.prepare("SELECT d.*,o.id outbox_id FROM notification_deliveries d JOIN notification_outbox o ON o.event_id=d.event_id WHERE (d.state='pending' AND d.next_attempt_at<=?) OR (d.state='sending' AND d.lease_until<=?) ORDER BY o.id,CASE WHEN d.destination_id='primary' THEN 0 ELSE 1 END,d.destination_id LIMIT 1").get(timestamp,timestamp);
      if(!job)return null;
      const event=db.prepare('SELECT * FROM events WHERE id=?').get(job.event_id);
      if(!event||event.status!=='active'||Date.parse(event.expires_at)<=timestamp){
        db.prepare("UPDATE notification_deliveries SET state='skipped',lease_until=NULL,last_error='情报已结束或纠错，停止推送' WHERE event_id=? AND state IN ('pending','sending')").run(job.event_id);
        updateAggregate(job.event_id,'情报已结束或纠错，停止推送');return null;
      }
      const targetUrl=destination(job.destination_id);
      if(!targetUrl){db.prepare("UPDATE notification_deliveries SET state='skipped',lease_until=NULL,last_error='推送链接已停用或删除' WHERE event_id=? AND destination_id=?").run(job.event_id,job.destination_id);updateAggregate(job.event_id,'推送链接已停用或删除');return null;}
      if(job.attempts>=MAX_ATTEMPTS){db.prepare("UPDATE notification_deliveries SET state='failed',lease_until=NULL WHERE event_id=? AND destination_id=?").run(job.event_id,job.destination_id);updateAggregate(job.event_id);return null;}
      db.prepare("UPDATE notification_deliveries SET state='sending',attempts=attempts+1,attempted_at=?,lease_until=? WHERE event_id=? AND destination_id=?").run(timestamp,timestamp+30000,job.event_id,job.destination_id);
      db.prepare("UPDATE notification_outbox SET state='sending',attempts=attempts+1,attempted_at=?,lease_until=? WHERE id=?").run(timestamp,timestamp+30000,job.outbox_id);
      return {...job,attempts:job.attempts+1,event,targetUrl};
    });
  }
  async function sendNext() {
    if(closed)return;
    const job=claim();if(!job)return;
    activeController=new AbortController();
    let failure='';
    try {
      const payload=message(db,job.event,origin);
      if(Buffer.byteLength(payload.markdown.content)>4096)throw new Error('message-too-large');
      const response=await fetchImpl(job.targetUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),redirect:'error',signal:AbortSignal.any([activeController.signal,AbortSignal.timeout(8000)])});
      if(!response.ok)failure=`企业微信 HTTP ${response.status}`;
      else {
        const result=await response.json();
        if(result?.errcode!==0)failure=Number.isSafeInteger(result?.errcode)?`企业微信错误码 ${result.errcode}`:'企业微信响应格式无效';
      }
    }catch{failure='企业微信发送失败或超时';}
    finally {activeController=null;}
    if(failure){
      const delay=Math.min(60000*2**(job.attempts-1),300000);
      db.prepare('UPDATE notification_deliveries SET state=?,next_attempt_at=?,lease_until=NULL,last_error=? WHERE event_id=? AND destination_id=?')
        .run(job.attempts>=MAX_ATTEMPTS?'failed':'pending',now()+delay,failure,job.event_id,job.destination_id);
      updateAggregate(job.event_id,failure);
    }else{
      db.prepare("UPDATE notification_deliveries SET state='sent',sent_at=?,lease_until=NULL,last_error=NULL WHERE event_id=? AND destination_id=?")
        .run(now(),job.event_id,job.destination_id);
      updateAggregate(job.event_id);
    }
  }
  function runOnce() {
    if(inFlight)return inFlight;
    inFlight=sendNext().finally(()=>{inFlight=null;});return inFlight;
  }
  function start() {
    if(closed||timer)return;
    const tick=()=>{void runOnce().catch(()=>{/* A database error must not crash the approval server. */});};
    timer=setInterval(tick,1000);timer.unref();tick();
  }
  async function close() {
    closed=true;if(timer)clearInterval(timer);activeController?.abort();if(inFlight)await inFlight;
  }
  function status() {
    const counts={pending:0,sending:0,sent:0,failed:0,skipped:0};
    for(const row of db.prepare('SELECT state,count(*) n FROM notification_outbox GROUP BY state').all())counts[row.state]=row.n;
    const current=settings?.getNotificationStatus?.()||{enabled:Boolean(webhookUrl),configured:Boolean(webhookUrl),source:webhookUrl?'environment':'none',masked:null,canSaveWebhook:false,configurationError:false};
    return {...current,counts,lastSentAt:db.prepare('SELECT max(sent_at) at FROM notification_outbox').get().at,
      lastError:db.prepare('SELECT last_error FROM notification_outbox WHERE last_error IS NOT NULL ORDER BY attempted_at DESC,id DESC LIMIT 1').get()?.last_error||null};
  }
  async function sendTest(destinationId){
    const target=destinationId?destination(destinationId):destinations()[0]?.webhookUrl;if(!target)throw new ApiError(409,'企业微信机器人尚未启用');
    const controller=new AbortController();
    try{const payload={msgtype:'markdown',markdown:{content:'# Poke 情报站测试消息\n企业微信机器人连接成功。'}};const response=await fetchImpl(target,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),redirect:'error',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(8000)]) });if(!response.ok)throw new Error();const result=await response.json();if(result?.errcode!==0)throw new Error();return{ok:true};}
    catch{throw new ApiError(502,'企业微信测试消息发送失败，请检查机器人配置');}
  }
  return {get enabled(){return destinations().length>0;},enqueueEvent,runOnce,start,close,status,sendTest};
}
