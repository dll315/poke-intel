import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request as httpRequest} from 'node:http';
import {buildApp} from '../server/app.mjs';
import {createUser} from '../server/auth.mjs';

const origin = 'http://localhost:3001';
test('users register and sign in with usernames without supplying email',async t=>{
  const {call}=await fixture(t);
  const registered=await call('POST','/auth/register',{username:'trainer_01',nickname:'训练家',password:'password12345'});
  assert.equal(registered.statusCode,201,registered.body);
  assert.equal(registered.json().user.username,'trainer_01');
  assert.equal('email' in registered.json().user,false);
  const signedIn=await call('POST','/auth/login',{username:'trainer_01',password:'password12345'});
  assert.equal(signedIn.statusCode,200,signedIn.body);
  assert.equal((await call('POST','/auth/register',{username:'trainer_01',nickname:'其他',password:'password12345'})).statusCode,409);
  assert.equal((await call('POST','/auth/register',{username:'admin',nickname:'冒充管理员',password:'password12345'})).statusCode,422);
});
async function fixture(t,options={}) {
  const dir=mkdtempSync(join(tmpdir(),'poke-api-'));
  let clock=Date.parse('2026-10-03T04:00:00Z');
  const dbPath=join(dir,'test.db');const app=await buildApp({dbPath,origin,now:()=>clock,...options});
  t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
  const call=(method,url,payload,session,headers={})=>app.inject({method,url:'/api/v1'+url,payload,headers:{origin:options.origin||origin,...(session?{cookie:session.cookie,'x-csrf-token':session.csrfToken}:{}),...headers}});
  async function login(username='player',role='user') {
    createUser(app.db,{username,nickname:role==='admin'?'管理员':'玩家',password:'password12345',role});
    const res=await call('POST','/auth/login',{username,password:'password12345'});
    assert.equal(res.statusCode,200,res.body);
    return {...res.json(),cookie:res.headers['set-cookie'].split(';')[0]};
  }
  const report=(location='常青森林',minutes=0)=>({kind:'swarm',pokemon:'皮卡丘',region:'kanto',location,observedAt:new Date(clock-minutes*60000).toISOString(),note:'观察到的玩家情报'});
  return {app,dbPath,call,login,report,advance:ms=>clock+=ms};
}

test('anonymous browsing cannot submit; registration, session and logout enforce Origin/CSRF',async t=>{
  const {app,call}=await fixture(t);
  assert.equal((await call('POST','/reports',{})).statusCode,401);
  const anon=(await call('GET','/auth/me')).json();assert.equal(anon.user,null);assert.ok(anon.csrfToken);
  assert.equal((await call('POST','/auth/register',{username:'trainerx',nickname:'玩家',password:'password12345'},null,{origin:'https://bad.example'})).statusCode,403);
  const res=await call('POST','/auth/register',{username:'trainerx',nickname:'玩家',password:'password12345'});
  assert.equal(res.statusCode,201,res.body);const s={...res.json(),cookie:res.headers['set-cookie'].split(';')[0]};
  assert.equal(s.user.username,'trainerx');assert.equal(s.user.role,'user');assert.ok(!('passwordHash' in s.user));
  const stored=app.db.prepare('SELECT password_hash FROM users').get();assert.ok(!stored.password_hash.includes('password12345'));
  assert.equal((await call('GET','/auth/me',undefined,s)).json().user.id,s.user.id);
  assert.equal((await call('POST','/auth/logout',{},s,{'x-csrf-token':'wrong'})).statusCode,403);
  assert.equal((await call('POST','/auth/logout',{},s,{'x-csrf-token':'界'.repeat(s.csrfToken.length)})).statusCode,403);
  assert.equal((await call('POST','/auth/logout',{},s)).statusCode,200);
  assert.equal((await call('GET','/auth/me',undefined,s)).json().user,null);
});

test('configured local origin aliases accept localhost and loopback but reject other sites',async t=>{
  const {call}=await fixture(t,{origin:'http://localhost:5173',allowedOrigins:['http://localhost:5173','http://127.0.0.1:5173']});
  const payload={username:'alias',nickname:'玩家',password:'password12345'};
  assert.equal((await call('POST','/auth/register',payload,null,{origin:'http://127.0.0.1:5173'})).statusCode,201);
  assert.equal((await call('POST','/auth/register',{...payload,username:'evil'},null,{origin:'https://evil.example'})).statusCode,403);
});
test('allowed separate frontend origin receives credentialed CORS and preflight',async t=>{
  const frontend='https://app.example.com';
  const {app}=await fixture(t,{origin:'https://api.example.com',allowedOrigins:[frontend]});
  const preflight=await app.inject({method:'OPTIONS',url:'/api/v1/auth/login',headers:{origin:frontend,'access-control-request-method':'POST','access-control-request-headers':'content-type'}});
  assert.equal(preflight.statusCode,204);
  assert.equal(preflight.headers['access-control-allow-origin'],frontend);
  assert.equal(preflight.headers['access-control-allow-credentials'],'true');
  const response=await app.inject({method:'GET',url:'/api/v1/auth/me',headers:{origin:frontend}});
  assert.equal(response.statusCode,200);
  assert.equal(response.headers['access-control-allow-origin'],frontend);
  const rejected=await app.inject({method:'OPTIONS',url:'/api/v1/auth/login',headers:{origin:'https://evil.example'}});
  assert.equal(rejected.statusCode,403);
  assert.equal(rejected.headers['access-control-allow-origin'],undefined);
});

test('Alphapedia catalog sync normalizes searchable data and keeps cached rows after upstream failure',async t=>{
  let fail=false;let requests=0;
  const transport=async url=>{
    requests++;
    if(fail)throw new Error('upstream unavailable');
    if(String(url).endsWith('/api/alpha-spawn-data'))return Response.json({Hoenn:{'Granite Cave':[{name:'Sableye',data:{Region:'Hoenn','Specific Location':'Granite Cave','Location Notes':'Basement',HMs:['Flash'],Moveset:['Shadow Ball','Calm Mind','Recover','Taunt'],Tier:4}}]}});
    if(String(url).endsWith('/api/swarm-spawn-data'))return Response.json({Kanto:{'Viridian Forest':[{name:'Pikachu',data:{Region:'Kanto','Specific Location':'Viridian Forest','Location Notes':'',HMs:[],Tier:2,HasValuable:true}}]}});
    if(String(url).endsWith('/api/pokemon-natdex-map'))return Response.json({sableye:302,pikachu:25});
    if(String(url).endsWith('/static/translations/zh/pokemon-species-zh.json'))return Response.json({Sableye:'勾魂眼',Pikachu:'皮卡丘'});
    if(String(url).endsWith('/static/translations/zh/move-zh.json'))return Response.json({'Shadow Ball':'暗影球','shadow ball':'重复项','Calm Mind':'冥想',Recover:'自我再生',Taunt:'挑衅'});
    return new Response('missing',{status:404});
  };
  const {app,call}=await fixture(t,{catalog:{enabled:true,permissionConfirmed:true,fetchImpl:transport,autoStart:false}});
  assert.equal((await call('GET','/status')).json().externalSourcesEnabled,true);
  assert.equal((await call('GET','/catalog')).json().total,0);
  assert.deepEqual(await app.catalog.refresh(),{imported:2,total:2});
  const alpha=(await call('GET','/catalog?kind=boss&q=granite')).json();
  assert.equal(alpha.total,1);assert.equal(alpha.items[0].pokemon,'勾魂眼');assert.equal(alpha.items[0].pokemonOriginal,'Sableye');assert.equal(alpha.items[0].nationalDex,302);assert.equal(alpha.items[0].sourceUrl,'https://alpha.pokemmotools.org/alpha-list');
  assert.deepEqual(alpha.items[0].moveset,['暗影球','冥想','自我再生','挑衅']);
  assert.deepEqual(alpha.items[0].movesetOriginal,['Shadow Ball','Calm Mind','Recover','Taunt']);
  assert.equal((await call('GET','/catalog?q=勾魂眼')).json().total,1);
  assert.equal((await call('GET','/catalog?kind=swarm&region=kanto')).json().items[0].valuable,true);
  assert.deepEqual(await app.catalog.refresh(),{imported:2,total:2});
  fail=true;await assert.rejects(()=>app.catalog.refresh(),/upstream unavailable/);
  assert.equal((await call('GET','/catalog')).json().total,2);
  assert.equal(requests,12);
});

test('catalog refresh retries a transient upstream request once',async t=>{
  let calls=0;
  const fetchImpl=async url=>{calls++;if(calls===1)throw new Error('temporary timeout');return Response.json({});};
  const {app}=await fixture(t,{catalog:{enabled:true,permissionConfirmed:true,fetchImpl,autoStart:false}});
  assert.deepEqual(await app.catalog.refresh(),{imported:0,total:0});
  assert.equal(calls,6);
});

test('event output translates known English Pokemon names and preserves unknown names',async t=>{
  const {app,call}=await fixture(t);
  app.db.prepare('INSERT INTO pokemon_names(english_name,chinese_name,synced_at) VALUES(?,?,?)').run('Pikachu','皮卡丘','2026-10-03T04:00:00.000Z');
  app.db.prepare("INSERT INTO events(kind,pokemon,region,location,observed_at,expires_at,last_confirmed_at,status,source) VALUES('boss','Pikachu','kanto','森林','2026-10-03T04:00:00.000Z','2026-10-03T05:00:00.000Z','2026-10-03T04:00:00.000Z','active','external')").run();
  const item=(await call('GET','/events')).json().items[0];assert.equal(item.pokemon,'皮卡丘');assert.equal(item.pokemonOriginal,'Pikachu');
  assert.equal((await call('GET','/events?q=皮卡丘')).json().total,1);
});

test('pending reports are private; admins approve, merge only same location, reject and audit',async t=>{
  const {app,call,login,report,advance}=await fixture(t);const player=await login();const admin=await login('admin','admin');
  const first=await call('POST','/reports',report(),player);assert.equal(first.statusCode,201,first.body);const id=first.json().id;
  assert.equal((await call('GET','/events')).json().total,0);
  assert.equal((await call('GET','/reports/mine',undefined,player)).json().items[0].status,'pending');
  assert.equal((await call('GET','/admin/reports',undefined,player)).statusCode,403);
  assert.equal((await call('POST',`/admin/reports/${id}/review`,{action:'approve'},player)).statusCode,403);
  assert.equal((await call('POST',`/admin/reports/${id}/review`,{action:'approve'},admin,{origin:'https://evil.example'})).statusCode,403);
  const approved=await call('POST',`/admin/reports/${id}/review`,{action:'approve'},admin);assert.equal(approved.statusCode,200,approved.body);const eventId=approved.json().event.id;
  assert.equal((await call('POST',`/admin/reports/${id}/review`,{action:'approve'},admin)).json().event.id,eventId);
  advance(60000);
  const second=(await call('POST','/reports',report(),player)).json();
  assert.equal((await call('POST',`/admin/reports/${second.id}/review`,{action:'approve'},admin)).json().event.id,eventId);
  const third=(await call('POST','/reports',report('月见山'),player)).json();
  const event2=(await call('POST',`/admin/reports/${third.id}/review`,{action:'approve'},admin)).json().event;assert.notEqual(event2.id,eventId);
  assert.equal((await call('GET','/events')).json().total,2);
  advance(61000);const fourth=(await call('POST','/reports',report('道路'),player)).json();
  assert.equal((await call('POST',`/admin/reports/${fourth.id}/review`,{action:'reject'},admin)).statusCode,422);
  const rejected=(await call('POST',`/admin/reports/${fourth.id}/review`,{action:'reject',reason:'地点信息不足'},admin)).json();assert.equal(rejected.report.reason,'地点信息不足');
  assert.equal((await call('GET','/events')).json().total,2);
  assert.ok(app.db.prepare('SELECT count(*) AS n FROM audit_logs').get().n>=4);
});

test('Unova phenomenon report accepts its appearance without a known Pokemon and rejects invalid combinations',async t=>{
  const {call,login,app}=await fixture(t);const player=await login();const admin=await login('admin','admin');
  const base={kind:'pheno',pokemon:'',region:'unova',location:'Route 3',observedAt:'2026-10-03T04:00:00.000Z',note:'3 号道路附近'};
  assert.equal((await call('POST','/reports',{...base,phenomenonType:'grass',region:'kanto'},player)).statusCode,422);
  assert.equal((await call('POST','/reports',base,player)).statusCode,422);
  assert.equal((await call('POST','/reports',{...base,phenomenonType:'unknown'},player)).statusCode,422);
  const created=await call('POST','/reports',{...base,phenomenonType:'grass'},player);
  assert.equal(created.statusCode,201,created.body);
  assert.equal(created.json().kind,'pheno');assert.equal(created.json().pokemon,'未知宝可梦');
  assert.match(created.json().note,/草丛摇动/);
  const approved=await call('POST',`/admin/reports/${created.json().id}/review`,{action:'approve'},admin);
  assert.equal(approved.statusCode,200,approved.body);
  assert.equal(approved.json().event.kind,'pheno');
  assert.equal(approved.json().event.region,'unova');
  assert.equal(app.db.prepare('SELECT note FROM events WHERE id=?').get(approved.json().event.id).note,created.json().note);
});

test('expiry, explicit end, corrections, date boundaries, pagination and detail stay coherent',async t=>{
  const {call,login,report,advance}=await fixture(t);const player=await login();const admin=await login('admin','admin');
  const submitted=(await call('POST','/reports',report('昨晚',719),player)).json();
  const approved=await call('POST',`/admin/reports/${submitted.id}/review`,{action:'approve'},admin);assert.equal(approved.statusCode,200,approved.body);const old=approved.json().event;
  assert.equal(old.status,'ended');
  assert.equal((await call('GET','/events')).json().total,0);
  assert.equal((await call('GET','/events?view=history&dateFrom=2026-10-03&dateTo=2026-10-03')).json().total,1);
  assert.equal((await call('GET','/events?view=history&dateTo=2026-10-02')).json().total,0);
  assert.equal((await call('GET',`/events/${old.id}`)).json().location,'昨晚');
  const fresh=(await call('POST','/reports',report(),player)).json();const event=(await call('POST',`/admin/reports/${fresh.id}/review`,{action:'approve'},admin)).json().event;
  assert.equal((await call('PATCH',`/admin/events/${event.id}`,{status:'corrected'},admin)).statusCode,422);
  assert.equal((await call('PATCH',`/admin/events/${event.id}`,{status:'corrected',correctionReason:'误报'},admin)).json().status,'corrected');
  assert.equal((await call('GET','/events?view=history&status=corrected&pageSize=1')).json().total,1);
  const last=(await call('POST','/reports',report('下一站'),player)).json();const live=(await call('POST',`/admin/reports/${last.id}/review`,{action:'approve'},admin)).json().event;
  advance(61*60000);assert.equal((await call('GET','/events')).json().total,0);
  assert.equal((await call('GET',`/events/${live.id}`)).json().status,'ended');
  assert.equal((await call('GET','/events?dateFrom=invalid')).statusCode,422);
});

test('disabling users invalidates sessions and protects the last admin; sessions expire',async t=>{
  const {call,login,advance}=await fixture(t);const player=await login();const admin=await login('admin','admin');
  assert.equal((await call('PATCH',`/admin/users/${admin.user.id}`,{disabled:true},admin)).statusCode,409);
  assert.equal((await call('PATCH',`/admin/users/${player.user.id}`,{disabled:true},admin)).json().disabled,true);
  assert.equal((await call('GET','/auth/me',undefined,player)).json().user,null);
  assert.equal((await call('POST','/auth/login',{username:player.user.username,password:'password12345'})).statusCode,401);
  assert.equal((await call('PATCH',`/admin/users/${player.user.id}`,{disabled:false},admin)).statusCode,200);
  advance(8*86400000);assert.equal((await call('GET','/admin/users',undefined,admin)).statusCode,401);
});

test('validates inputs and enforces three reports per minute, fifty per Beijing day and login limits',async t=>{
  const {call,login,report,advance}=await fixture(t);const player=await login();
  assert.equal((await call('POST','/auth/register',{username:'bad',nickname:'a',password:'short'})).statusCode,422);
  for(const patch of [{kind:'invalid'},{region:'invalid'},{pokemon:'a'.repeat(51)},{note:'a'.repeat(1001)},{observedAt:'2026-10-04T04:00:00Z'},{observedAt:'2026-10-01T04:00:00Z'}]) {
    const invalid=await call('POST','/reports',{...report(),...patch},player);assert.equal(invalid.statusCode,422,invalid.body);assert.ok(invalid.json().fields);
  }
  for(let i=0;i<3;i++)assert.equal((await call('POST','/reports',report(),player)).statusCode,201);
  assert.equal((await call('POST','/reports',report(),player)).statusCode,429);
  for(let i=3;i<50;i++){advance(61000);assert.equal((await call('POST','/reports',report(),player)).statusCode,201);}
  advance(61000);assert.equal((await call('POST','/reports',report(),player)).statusCode,429);
  let limited;for(let i=0;i<11;i++)limited=await call('POST','/auth/login',{username:'wrong',password:'incorrect123'});assert.equal(limited.statusCode,429);
});

test('published state survives reopening persistent SQLite and external imports remain disabled',async t=>{
  const {app,dbPath,call,login,report}=await fixture(t);const player=await login();const admin=await login('admin','admin');
  const r=(await call('POST','/reports',report(),player)).json();await call('POST',`/admin/reports/${r.id}/review`,{action:'approve'},admin);
  assert.equal((await call('GET','/status')).json().externalSourcesEnabled,false);
  assert.equal(app.db.prepare('SELECT count(*) AS n FROM events').get().n,1);
  const {importSourceRecords}=await import('../server/sources.mjs');
  await assert.rejects(()=>importSourceRecords(app.db,[],{}),/disabled|关闭/i);
  await app.close();
  const reopened=await buildApp({dbPath,origin,now:()=>Date.parse('2026-10-03T04:00:00Z')});
  try {assert.equal((await reopened.inject('/api/v1/events')).json().total,1);assert.equal((await reopened.inject({url:'/api/v1/auth/me',headers:{cookie:player.cookie}})).json().user.id,player.user.id);}
  finally {await reopened.close();}
});

test('configured one-hop proxy gives independent clients separate limits; default ignores spoofed headers',async t=>{
  for(const trustProxy of [false,true]){
    const {call}=await fixture(t,{trustProxy});
    for(let i=0;i<6;i++){
      const res=await call('POST','/auth/register',{username:`proxy${i}`,nickname:'玩家',password:'password12345'},null,{'x-forwarded-for':`192.0.2.${i+1}`});
      assert.equal(res.statusCode,trustProxy||i<5?201:429,res.body);
    }
  }
});

test('external adapter requires explicit permission and imports idempotently into pending review',async t=>{
  const {app,call,report}=await fixture(t);const {importSourceRecords}=await import('../server/sources.mjs');
  const data={...report(),source:'authorized-api',sourceEventId:'event-1',expiresAt:'2026-10-03T05:00:00Z',sourceUrl:'https://example.com/event/1'};
  await assert.rejects(()=>importSourceRecords(app.db,[data],{enabled:true,source:'authorized-api'}),/disabled|关闭/i);
  const options={enabled:true,permissionConfirmed:true,source:'authorized-api'};
  assert.deepEqual(await importSourceRecords(app.db,[data,data],options),{imported:1,skipped:1});
  assert.deepEqual(await importSourceRecords(app.db,[data],options),{imported:0,skipped:1});
  assert.equal(app.db.prepare("SELECT count(*) AS n FROM reports WHERE status='pending' AND source='external'").get().n,1);
  assert.equal((await call('GET','/events')).json().total,0);
});

test('15-minute merge boundary and manual ending preserve distinct events',async t=>{
  const {call,login,report,advance}=await fixture(t);const player=await login();const admin=await login('admin','admin');
  const approve=async data=>{const r=await call('POST','/reports',data,player);assert.equal(r.statusCode,201,r.body);const result=await call('POST',`/admin/reports/${r.json().id}/review`,{action:'approve'},admin);assert.equal(result.statusCode,200,result.body);return result.json().event;};
  const first=await approve(report());advance(15*60000);
  const boundary=await approve(report());assert.equal(boundary.id,first.id);assert.equal(boundary.lastConfirmedAt,'2026-10-03T04:15:00.000Z');
  advance(1000);const outside=await approve(report());assert.notEqual(outside.id,first.id);
  const ended=await call('PATCH',`/admin/events/${outside.id}`,{status:'ended'},admin);assert.equal(ended.json().status,'ended');
  assert.equal((await call('GET','/events')).json().total,1);
  assert.equal((await call('GET','/events?view=history&status=ended')).json().total,1);
});

test('public direct peers cannot spoof one-hop proxy client addresses',async t=>{
  const {app}=await fixture(t,{trustProxy:true});
  for(let i=0;i<6;i++){
    const res=await app.inject({method:'POST',url:'/api/v1/auth/register',remoteAddress:'198.51.100.10',headers:{origin,'x-forwarded-for':`192.0.2.${i+1}`},payload:{username:`direct${i}`,nickname:'玩家',password:'password12345'}});
    assert.equal(res.statusCode,i<5?201:429,res.body);
  }
});

test('production cookies, CSP, body limits and API not-found preserve security boundaries',async t=>{
  const prior=process.env.NODE_ENV;process.env.NODE_ENV='production';
  let context;try {context=await fixture(t,{origin:'https://poke.example'});}finally {if(prior===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=prior;}
  const {call}=context;
  const res=await call('POST','/auth/register',{username:'secure',nickname:'玩家',password:'password12345'});
  assert.equal(res.statusCode,201,res.body);
  assert.match(res.headers['set-cookie'],/HttpOnly/);assert.match(res.headers['set-cookie'],/SameSite=Lax/);assert.match(res.headers['set-cookie'],/Secure/);
  assert.match(res.headers['content-security-policy'],/script-src 'self';/);assert.ok(!res.headers['content-security-policy'].includes("script-src 'self' 'unsafe-inline'"));
  assert.equal(res.headers['x-content-type-options'],'nosniff');assert.ok(res.headers['strict-transport-security']);assert.equal(res.headers['cache-control'],'no-store');
  assert.equal((await call('POST','/auth/login',{username:'secure',password:'a'.repeat(20000)})).statusCode,413);
  const missing=await call('GET','/unknown');assert.equal(missing.statusCode,404);assert.equal(typeof missing.json().error,'string');
});

test('disabling and restoring during in-flight login does not resurrect a revoked login',async t=>{
  const {app,call,login}=await fixture(t);const player=await login();const admin=await login('admin','admin');
  const pending=call('POST','/auth/login',{username:player.user.username,password:'password12345'});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await call('PATCH',`/admin/users/${player.user.id}`,{disabled:true},admin)).statusCode,200);
  assert.equal((await call('PATCH',`/admin/users/${player.user.id}`,{disabled:false},admin)).statusCode,200);
  const result=await pending;assert.equal(result.statusCode,401,result.body);
  assert.equal(app.db.prepare('SELECT count(*) AS n FROM sessions WHERE user_id=?').get(player.user.id).n,0);
});

test('revoking a session while a real HTTP request body is streaming prevents the report',async t=>{
  const {app,call,login,report}=await fixture(t);const player=await login();const admin=await login('admin','admin');
  await app.listen({host:'127.0.0.1',port:0});const port=app.server.address().port;
  const body=Buffer.from(JSON.stringify(report()));
  const seen=new Promise(resolve=>app.server.once('request',resolve));
  let request;
  const result=new Promise((resolve,reject)=>{
    request=httpRequest({host:'127.0.0.1',port,path:'/api/v1/reports',method:'POST',headers:{origin,cookie:player.cookie,'x-csrf-token':player.csrfToken,'content-type':'application/json','content-length':body.length}},response=>{
      const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>resolve({statusCode:response.statusCode,body:Buffer.concat(chunks).toString()}));
    });request.on('error',reject);request.write(body.subarray(0,body.length-1));
  });
  await seen;
  assert.equal((await call('PATCH',`/admin/users/${player.user.id}`,{disabled:true},admin)).statusCode,200);
  request.end(body.subarray(body.length-1));
  const response=await result;assert.equal(response.statusCode,401,response.body);
  assert.equal(app.db.prepare('SELECT count(*) AS n FROM reports WHERE user_id=?').get(player.user.id).n,0);
});
