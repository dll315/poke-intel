import {transaction} from './db.mjs';
import {translatePokemon} from './catalog.mjs';
import {ApiError} from './validation.mjs';

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
  return {msgtype:'markdown',markdown:{content:[
    `# 新${event.kind==='boss'?'头目':'群聚'}情报`,
    `**宝可梦：** ${safeText(translatePokemon(db,event.pokemon))}`,
    `**地区：** ${regionNames[event.region]}`,
    `**地点：** ${safeText(event.location)}`,
    `**观察时间：** ${formatter.format(new Date(event.observed_at))}（北京时间）`,
    `**展示截止：** ${formatter.format(new Date(event.expires_at))}（北京时间）`,
    '[查看网站情报]('+link.href+')',
    '> 玩家上报，已通过平台审核；是否仍有效请以游戏实际情况为准。',
  ].join('\n')}};
}

export function createNotifications({db,now,origin,webhookUrl='',settings=null,fetchImpl=globalThis.fetch}) {
  const config=()=>settings?settings.getNotificationConfig():{enabled:Boolean(webhookUrl),webhookUrl,source:webhookUrl?'environment':'none'};
  let timer=null;let closed=false;let inFlight=null;let activeController=null;
  function enqueueEvent(eventId) {
    if(!config().enabled||!config().webhookUrl)return;
    db.prepare("INSERT OR IGNORE INTO notification_outbox(event_id,state,created_at,next_attempt_at) VALUES(?,'pending',?,?)")
      .run(eventId,new Date(now()).toISOString(),now());
  }
  function claim() {
    return transaction(db,()=>{
      const timestamp=now();
      const last=db.prepare('SELECT max(attempted_at) last FROM notification_outbox').get().last;
      if(last!==null&&timestamp-last<SEND_GAP_MS)return null;
      const job=db.prepare("SELECT * FROM notification_outbox WHERE (state='pending' AND next_attempt_at<=?) OR (state='sending' AND lease_until<=?) ORDER BY id LIMIT 1").get(timestamp,timestamp);
      if(!job)return null;
      const event=db.prepare('SELECT * FROM events WHERE id=?').get(job.event_id);
      if(!event||event.status!=='active'||Date.parse(event.expires_at)<=timestamp){
        db.prepare("UPDATE notification_outbox SET state='skipped',lease_until=NULL,last_error='情报已结束或纠错，停止推送' WHERE id=?").run(job.id);return null;
      }
      if(job.attempts>=MAX_ATTEMPTS){db.prepare("UPDATE notification_outbox SET state='failed',lease_until=NULL WHERE id=?").run(job.id);return null;}
      db.prepare("UPDATE notification_outbox SET state='sending',attempts=attempts+1,attempted_at=?,lease_until=? WHERE id=?").run(timestamp,timestamp+30000,job.id);
      return {...job,attempts:job.attempts+1,event};
    });
  }
  async function sendNext() {
    const current=config();if(!current.enabled||!current.webhookUrl||closed)return;
    const job=claim();if(!job)return;
    activeController=new AbortController();
    let failure='';
    try {
      const payload=message(db,job.event,origin);
      if(Buffer.byteLength(payload.markdown.content)>4096)throw new Error('message-too-large');
      const response=await fetchImpl(current.webhookUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),redirect:'error',signal:AbortSignal.any([activeController.signal,AbortSignal.timeout(8000)])});
      if(!response.ok)failure=`企业微信 HTTP ${response.status}`;
      else {
        const result=await response.json();
        if(result?.errcode!==0)failure=Number.isSafeInteger(result?.errcode)?`企业微信错误码 ${result.errcode}`:'企业微信响应格式无效';
      }
    }catch{failure='企业微信发送失败或超时';}
    finally {activeController=null;}
    if(failure){
      const delay=Math.min(60000*2**(job.attempts-1),300000);
      db.prepare('UPDATE notification_outbox SET state=?,next_attempt_at=?,lease_until=NULL,last_error=? WHERE id=?')
        .run(job.attempts>=MAX_ATTEMPTS?'failed':'pending',now()+delay,failure,job.id);
    }else{
      db.prepare("UPDATE notification_outbox SET state='sent',sent_at=?,lease_until=NULL,last_error=NULL WHERE id=?")
        .run(new Date(now()).toISOString(),job.id);
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
  async function sendTest(){
    const current=config();if(!current.enabled||!current.webhookUrl)throw new ApiError(409,'企业微信机器人尚未启用');
    const controller=new AbortController();
    try{const payload={msgtype:'markdown',markdown:{content:'# Poke 情报站测试消息\n企业微信机器人连接成功。'}};const response=await fetchImpl(current.webhookUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),redirect:'error',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(8000)]) });if(!response.ok)throw new Error();const result=await response.json();if(result?.errcode!==0)throw new Error();return{ok:true};}
    catch{throw new ApiError(502,'企业微信测试消息发送失败，请检查机器人配置');}
  }
  return {get enabled(){return Boolean(config().enabled&&config().webhookUrl);},enqueueEvent,runOnce,start,close,status,sendTest};
}
