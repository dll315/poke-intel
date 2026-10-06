import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildApp} from '../server/app.mjs';
import {createUser} from '../server/auth.mjs';

const origin='https://poke.example.test';
const webhook='https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test-only-bot-key';
async function fixture(t,{transport=async()=>Response.json({errcode:0}),enabled=true,autoStart=false}={}){
  const dir=mkdtempSync(join(tmpdir(),'poke-wecom-'));const dbPath=join(dir,'poke.db');
  let clock=Date.parse('2026-10-03T04:00:00Z');
  const options={dbPath,origin,now:()=>clock,wecomWebhookUrl:enabled?webhook:'',settingsEncryptionKey:'11'.repeat(32),notificationFetch:transport,notificationsAutoStart:autoStart};
  let app=await buildApp(options);
  t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
  assert.equal(app.notifications?.enabled,enabled);
  async function session(username,role){
    createUser(app.db,{username,nickname:role==='admin'?'管理员':'玩家',password:'test-password-12345',role});
    const res=await app.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin},payload:{username,password:'test-password-12345'}});
    assert.equal(res.statusCode,200);return{cookie:res.headers['set-cookie'].split(';')[0],'x-csrf-token':res.json().csrfToken,origin};
  }
  const player=await session('player','user');const admin=await session('admin','admin');
  const call=(method,path,payload,headers=admin)=>app.inject({method,url:'/api/v1'+path,payload,headers});
  async function report({location='常青森林',kind='boss',pokemon='皮卡丘',minutes=0}={}){
    const r=await call('POST','/reports',{kind,pokemon,region:kind==='pheno'?'unova':'kanto',...(kind==='pheno'?{phenomenonType:'grass'}:{}),location,observedAt:new Date(clock-minutes*60000).toISOString()},player);
    assert.equal(r.statusCode,201,r.body);return r.json();
  }
  const approve=id=>call('POST',`/admin/reports/${id}/review`,{action:'approve'});
  return{get app(){return app;},call,report,approve,advance:ms=>clock+=ms,reopen:async()=>{await app.close();app=await buildApp(options);}};
}

test('only a new approved active event queues once; merge, repeated approval and rejected reports do not push',async t=>{
  const f=await fixture(t);
  const a=await f.report();assert.equal(f.app.db.prepare('SELECT count(*) n FROM notification_outbox').get().n,0);
  assert.equal((await f.approve(a.id)).statusCode,200);
  await f.approve(a.id);
  const merged=await f.report();await f.approve(merged.id);
  const rejected=await f.report({location:'月见山'});await f.call('POST',`/admin/reports/${rejected.id}/review`,{action:'reject',reason:'误报'});
  assert.equal(f.app.db.prepare('SELECT count(*) n FROM notification_outbox').get().n,1);
  f.advance(61000);const stale=await f.report({location:'旧地点',minutes:120});await f.approve(stale.id);
  assert.equal(f.app.db.prepare('SELECT count(*) n FROM notification_outbox').get().n,1);
});

test('worker delivers Chinese markdown with Beijing time and safe site link without public credentials',async t=>{
  let payload;let endpoint;let options;
  const f=await fixture(t,{transport:async(url,opts)=>{endpoint=url;options=opts;payload=JSON.parse(opts.body);return Response.json({errcode:0});}});
  const r=await f.report({pokemon:'皮卡丘<@all> [恶意](https://bad.test)'});await f.approve(r.id);
  await f.app.notifications.runOnce();
  assert.equal(endpoint,webhook);assert.equal(options.redirect,'error');assert.ok(options.signal);
  assert.equal(payload.msgtype,'markdown');assert.match(payload.markdown.content,/新头目情报/);
  assert.match(payload.markdown.content,/关都/);assert.match(payload.markdown.content,/2026-10-03 12:00/);
  assert.match(payload.markdown.content,/https:\/\/poke.example.test/);
  assert.equal(payload.markdown.content.includes('<@all>'),false);
  assert.ok(Buffer.byteLength(payload.markdown.content)<4096);
  const row=f.app.db.prepare('SELECT * FROM notification_outbox').get();assert.equal(row.state,'sent');assert.equal(row.attempts,1);
  const status=await f.call('GET','/admin/notifications');assert.equal(status.json().counts.sent,1);
  assert.equal(status.body.includes('test-only-bot-key'),false);
  assert.equal((await f.call('GET','/status')).body.includes('test-only-bot-key'),false);
});

test('worker translates a known English Pokemon name before sending',async t=>{
  let content='';const f=await fixture(t,{transport:async(url,options)=>{content=JSON.parse(options.body).markdown.content;return Response.json({errcode:0});}});
  f.app.db.prepare('INSERT INTO pokemon_names(english_name,chinese_name,synced_at) VALUES(?,?,?)').run('Pikachu','皮卡丘','2026-10-04T01:00:00.000Z');
  await f.approve((await f.report({pokemon:'Pikachu'})).id);await f.app.notifications.runOnce();
  assert.match(content,/宝可梦：\*\* 皮卡丘/);assert.doesNotMatch(content,/宝可梦：\*\* Pikachu/);
});

test('two robot links receive one event independently without resending to a successful link',async t=>{
  const extra='https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=second-test-bot-key';
  const sent=[];let failExtra=true;
  const f=await fixture(t,{transport:async url=>{sent.push(String(url));if(String(url)===extra&&failExtra){failExtra=false;throw new Error('temporary failure');}return Response.json({errcode:0});}});
  const adminId=f.app.db.prepare("SELECT id FROM users WHERE role='admin'").get().id;
  f.app.settings.addNotificationLink({label:'第二个群',webhookUrl:extra,enabled:true},adminId);
  await f.approve((await f.report()).id);
  await f.app.notifications.runOnce();f.advance(3500);await f.app.notifications.runOnce();
  assert.equal(f.app.db.prepare('SELECT state FROM notification_outbox').get().state,'pending');
  f.advance(61000);await f.app.notifications.runOnce();
  assert.deepEqual(sent,[webhook,extra,extra]);
  assert.equal(f.app.db.prepare('SELECT state FROM notification_outbox').get().state,'sent');
});

test('each robot link filters boss, swarm, player reports and pheno independently',async t=>{
  const extra='https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=filtered-bot-key';
  const sent=[];const f=await fixture(t,{transport:async url=>{sent.push(String(url));return Response.json({errcode:0});}});
  const adminId=f.app.db.prepare("SELECT id FROM users WHERE role='admin'").get().id;
  f.app.settings.saveNotificationConfig({enabled:true,categories:['boss','pheno']},adminId);
  const link=f.app.settings.addNotificationLink({label:'报点群',webhookUrl:extra,enabled:true,categories:['player','swarm']},adminId);
  assert.deepEqual(link.categories,['swarm','player']);
  async function queue(kind,source){
    const at='2026-10-03T04:00:00.000Z';const row=f.app.db.prepare("INSERT INTO events(kind,pokemon,region,location,observed_at,expires_at,last_confirmed_at,status,source,source_url,note) VALUES(?,?,?,?,?,?,?,'active',?,NULL,'')").run(kind,'Pikachu','unova',kind+source+sent.length,at,'2026-10-03T05:00:00.000Z',at,source);
    f.app.notifications.enqueueEvent(Number(row.lastInsertRowid));
    return f.app.db.prepare('SELECT destination_id FROM notification_deliveries WHERE event_id=?').all(Number(row.lastInsertRowid)).map(x=>x.destination_id);
  }
  assert.deepEqual(await queue('boss','external'),['primary']);
  assert.deepEqual(await queue('swarm','external'),[`link:${link.id}`]);
  assert.deepEqual(await queue('boss','player'),[`link:${link.id}`]);
  const playerPheno=await f.report({kind:'pheno',location:'奇遇地点'});await f.approve(playerPheno.id);
  assert.deepEqual(f.app.db.prepare('SELECT destination_id FROM notification_deliveries WHERE event_id=(SELECT event_id FROM reports WHERE id=?)').all(playerPheno.id).map(x=>x.destination_id),[`link:${link.id}`]);
  assert.deepEqual(await queue('pheno','external'),['primary']);
  f.app.settings.updateNotificationLink(link.id,{categories:['pheno']},adminId);
  assert.deepEqual(await queue('pheno','external'),[`link:${link.id}`,'primary']);
  assert.equal((await f.call('GET','/admin/settings/notifications')).json().categories.includes('swarm'),false);
});

test('pending jobs from the previous single-link queue remain deliverable after upgrade',async t=>{
  let sends=0;const f=await fixture(t,{transport:async()=>{sends++;return Response.json({errcode:0});}});
  await f.approve((await f.report()).id);
  f.app.db.exec('DELETE FROM notification_deliveries');
  await f.app.notifications.runOnce();
  assert.equal(sends,1);assert.equal(f.app.db.prepare('SELECT state FROM notification_outbox').get().state,'sent');
});

test('external monitor notification identifies Alphapedia as its source',async t=>{
  let content='';const f=await fixture(t,{transport:async(url,options)=>{content=JSON.parse(options.body).markdown.content;return Response.json({errcode:0});}});
  const observedAt='2026-10-03T04:00:00.000Z',expiresAt='2026-10-03T05:15:00.000Z';
  const result=f.app.db.prepare("INSERT INTO events(kind,pokemon,region,location,observed_at,expires_at,last_confirmed_at,status,source,source_url) VALUES('boss','Ditto','unova','Route 9',?,?,?,'active','external','https://alpha.pokemmotools.org/alpha-list')").run(observedAt,expiresAt,observedAt);
  f.app.notifications.enqueueEvent(Number(result.lastInsertRowid));await f.app.notifications.runOnce();
  assert.match(content,/Alphapedia 自动监控/);
  assert.doesNotMatch(content,/玩家上报/);
});

test('external boss push uses Chinese location and confirmed route details without inventing a moveset',async t=>{
  let content='';const f=await fixture(t,{transport:async(url,options)=>{content=JSON.parse(options.body).markdown.content;return Response.json({errcode:0});}});
  const at='2026-10-03T04:00:00.000Z';
  f.app.db.prepare("INSERT INTO external_catalog(kind,pokemon,region,location,location_note,hms,moveset,source,source_url,source_key,synced_at) VALUES('boss','Ditto','unova','Route 9','near grass','[\"Cut\"]','[\"Transform\",\"Struggle\"]','Alphapedia','https://alpha.pokemmotools.org/alpha-list','boss-ditto',?)").run(at);
  f.app.db.prepare('INSERT INTO move_names(english_name,chinese_name,synced_at) VALUES(?,?,?)').run('Transform','变身',at);
  const result=f.app.db.prepare("INSERT INTO events(kind,pokemon,region,location,observed_at,expires_at,last_confirmed_at,status,source,source_url) VALUES('boss','Ditto','unova','Route 9',?,?,?,'active','external','https://alpha.pokemmotools.org/alpha-list')").run(at,'2026-10-03T05:15:00.000Z',at);
  f.app.notifications.enqueueEvent(Number(result.lastInsertRowid));await f.app.notifications.runOnce();
  assert.match(content,/地点：\*\* 9号道路/);assert.match(content,/地点说明（来源原文）：\*\* near grass/);
  assert.match(content,/所需秘传：\*\* 居合劈/);assert.match(content,/来源资料配招：\*\* 变身、Struggle/);
  assert.match(content,/当次头目招式仍需游戏内核实/);
});

test('external phenomenon push translates the precise point and labels unverified end time',async t=>{
  let content='';const f=await fixture(t,{transport:async(url,options)=>{content=JSON.parse(options.body).markdown.content;return Response.json({errcode:0});}});
  const at='2026-10-03T04:00:00.000Z';
  const result=f.app.db.prepare("INSERT INTO events(kind,pokemon,region,location,observed_at,expires_at,last_confirmed_at,status,source,source_url,note) VALUES('pheno','Audino','unova','Abundant Shrine · (Bottom Center)',?,?,?,'active','external','https://alpha.pokemmotools.org/pheno-list','水面奇遇')").run(at,'2026-10-03T04:10:00.000Z',at);
  f.app.notifications.enqueueEvent(Number(result.lastInsertRowid));await f.app.notifications.runOnce();
  assert.match(content,/丰饶之祠 · （下方中间）/);assert.match(content,/预计结束/);assert.doesNotMatch(content,/展示截止/);
});

test('transport failure does not fail approval; retry survives reopening and sanitizes errors',async t=>{
  let fail=true;let sends=0;
  const f=await fixture(t,{transport:async()=>{sends++;if(fail)throw new Error(webhook);return Response.json({errcode:0});}});
  const r=await f.report({kind:'swarm'});assert.equal((await f.approve(r.id)).statusCode,200);
  await f.app.notifications.runOnce();
  let row=f.app.db.prepare('SELECT * FROM notification_outbox').get();assert.equal(row.state,'pending');assert.equal(row.attempts,1);
  assert.equal(JSON.stringify(row).includes('test-only-bot-key'),false);
  await f.app.notifications.runOnce();assert.equal(sends,1);
  await f.reopen();f.advance(61000);fail=false;await f.app.notifications.runOnce();
  row=f.app.db.prepare('SELECT * FROM notification_outbox').get();assert.equal(row.state,'sent');assert.equal(row.attempts,2);
});

test('provider errcode, bad JSON and HTTP errors retry, then stop after six failed attempts',async t=>{
  let sends=0;
  const f=await fixture(t,{transport:async()=>{sends++;return sends===1?Response.json({errcode:93000,errmsg:webhook}):sends===2?new Response('not-json'):new Response('error',{status:503});}});
  const r=await f.report();await f.approve(r.id);
  for(let i=0;i<6;i++){await f.app.notifications.runOnce();f.advance(7*60000);}
  const row=f.app.db.prepare('SELECT * FROM notification_outbox').get();assert.equal(row.state,'failed');assert.equal(row.attempts,6);
  await f.app.notifications.runOnce();assert.equal(sends,6);assert.equal(row.last_error.includes('test-only-bot-key'),false);
});

test('concurrent ticks send at most once and pacing is retained across restarts',async t=>{
  let sends=0;const f=await fixture(t,{transport:async()=>{sends++;await new Promise(r=>setTimeout(r,5));return Response.json({errcode:0});}});
  await f.approve((await f.report()).id);await f.approve((await f.report({location:'月见山'})).id);
  await Promise.all([f.app.notifications.runOnce(),f.app.notifications.runOnce()]);assert.equal(sends,1);
  await f.reopen();await f.app.notifications.runOnce();assert.equal(sends,1);
  f.advance(3500);await f.app.notifications.runOnce();assert.equal(sends,2);
});

test('ended events are skipped and disabled configuration does not queue old messages',async t=>{
  let sends=0;const f=await fixture(t,{transport:async()=>{sends++;return Response.json({errcode:0});}});
  const approved=(await f.approve((await f.report()).id)).json();await f.call('PATCH',`/admin/events/${approved.event.id}`,{status:'ended'});
  await f.app.notifications.runOnce();assert.equal(sends,0);assert.equal(f.app.db.prepare('SELECT state FROM notification_outbox').get().state,'skipped');
  const off=await fixture(t,{enabled:false});await off.approve((await off.report()).id);
  assert.equal(off.app.db.prepare('SELECT count(*) n FROM notification_outbox').get().n,0);
});

test('invalid and redirected webhook URLs cannot expose credentials or contact arbitrary hosts',async()=>{
  for(const url of ['http://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=x','https://evil.test/send?key=x','https://qyapi.weixin.qq.com@evil.test/send?key=x','https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=x&extra=y']){
    await assert.rejects(()=>buildApp({dbPath:':memory:',wecomWebhookUrl:url}),error=>!error.message.includes(url)&&/企业微信/.test(error.message));
  }
});

test('automatic worker sends queued approvals without blocking the request',async t=>{
  let sends=0;const f=await fixture(t,{autoStart:true,transport:async()=>{sends++;return Response.json({errcode:0});}});
  const r=await f.report();assert.equal((await f.approve(r.id)).statusCode,200);
  const deadline=Date.now()+3000;
  while(!sends&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,25));
  assert.equal(sends,1);assert.equal(f.app.db.prepare('SELECT state FROM notification_outbox').get().state,'sent');
});

test('shutdown aborts an in-flight request and preserves its queued retry',async t=>{
  let entered;const started=new Promise(resolve=>entered=resolve);
  const f=await fixture(t,{transport:async(url,{signal})=>{entered();return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));}});
  await f.approve((await f.report()).id);const sending=f.app.notifications.runOnce();await started;
  await f.app.notifications.close();await sending;
  const row=f.app.db.prepare('SELECT * FROM notification_outbox').get();assert.equal(row.state,'pending');assert.equal(row.lease_until,null);
});

test('outbox insertion and approval are atomic when queue storage fails',async t=>{
  const f=await fixture(t);const r=await f.report();
  f.app.db.exec("CREATE TRIGGER broken_outbox BEFORE INSERT ON notification_outbox BEGIN SELECT RAISE(ABORT,'queue unavailable'); END;");
  assert.equal((await f.approve(r.id)).statusCode,500);
  assert.equal(f.app.db.prepare('SELECT status FROM reports WHERE id=?').get(r.id).status,'pending');
  assert.equal(f.app.db.prepare('SELECT count(*) n FROM events').get().n,0);
  assert.equal(f.app.db.prepare('SELECT count(*) n FROM audit_logs').get().n,0);
});
