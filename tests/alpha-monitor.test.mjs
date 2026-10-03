import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb} from '../server/db.mjs';
import {parseLandingStatus,publishExternalEvent,createAlphaMonitor} from '../server/alpha-monitor.mjs';
import {buildApp} from '../server/app.mjs';
import {createUser} from '../server/auth.mjs';

const payload={latest_ping_raw:'Honchkrow',latest_ping_time:'2026-10-03 16:06:41 UTC (UTC+00:00)',latest_ping_details_html:'<p><span data-region="Sinnoh">Sinnoh</span><a><span data-location="Route 209">Route 209</span></a><a href="/alpha-list?pokemon=Honchkrow&region=Sinnoh&location=Route+209&timestamp=1791048101">Open</a></p>'};

test('landing status parser returns a complete normalized Alpha event',()=>{
  assert.deepEqual(parseLandingStatus(payload),{sourceEventId:'alphapedia:1791048101:Honchkrow:sinnoh:Route 209',pokemon:'Honchkrow',region:'sinnoh',location:'Route 209',observedAt:'2026-10-03T16:06:41.000Z',expiresAt:'2026-10-03T17:21:41.000Z',sourceUrl:'https://alpha.pokemmotools.org/alpha-list?pokemon=Honchkrow&region=Sinnoh&location=Route+209&timestamp=1791048101'});
  for(const bad of [{},{...payload,latest_ping_raw:''},{...payload,latest_ping_details_html:'<p>missing</p>'}])assert.throws(()=>parseLandingStatus(bad),/状态|字段|解析/);
});

test('publisher creates one approved external event and notification across duplicate calls',()=>{
  const db=openDb(':memory:');const queued=[];const notifications={enabled:true,enqueueEvent:id=>queued.push(id)};const event=parseLandingStatus(payload);const now=()=>Date.parse('2026-10-03T16:10:00Z');
  const first=publishExternalEvent({db,notifications,event,now});assert.equal(first.published,true);assert.equal(queued.length,1);
  assert.equal(db.prepare("SELECT count(*) n FROM reports WHERE status='approved' AND source='external'").get().n,1);assert.equal(db.prepare("SELECT count(*) n FROM events WHERE status='active'").get().n,1);
  assert.deepEqual(publishExternalEvent({db,notifications,event,now}),{published:false});assert.equal(queued.length,1);db.close();
});

test('expired initial state advances cursor without publishing',async()=>{
  const db=openDb(':memory:');const calls=[];const fetchImpl=async(url,options={})=>{calls.push({url:String(url),headers:options.headers});if(String(url).endsWith('/'))return new Response('<meta name="landing-status-token" content="token-12345678901234567890123456">',{headers:{'set-cookie':'session=abc; Path=/; HttpOnly'}});return Response.json(payload);};
  const monitor=createAlphaMonitor({db,notifications:{enabled:false,enqueueEvent(){}},fetchImpl,now:()=>Date.parse('2026-10-03T18:00:00Z'),enabled:true,autoStart:false});
  await monitor.runOnce();assert.equal(db.prepare('SELECT count(*) n FROM events').get().n,0);assert.equal(calls.length,2);assert.match(calls[1].headers.Cookie,/session=abc/);assert.equal(monitor.status().lastEvent.pokemon,'Honchkrow');await monitor.close();db.close();
});

test('monitor publishes a new active state once and recovers after a transient failure',async()=>{
  const db=openDb(':memory:');let fail=true;let sends=0;const fetchImpl=async url=>{if(fail){fail=false;throw new Error('https://secret.example/?token=bad');}if(String(url).endsWith('/'))return new Response('<meta name="landing-status-token" content="token-12345678901234567890123456">',{headers:{'set-cookie':'session=abc'}});return Response.json(payload);};
  const monitor=createAlphaMonitor({db,notifications:{enabled:true,enqueueEvent(){sends++;}},fetchImpl,now:()=>Date.parse('2026-10-03T16:10:00Z'),enabled:true,autoStart:false});
  await assert.rejects(()=>monitor.runOnce());assert.equal(monitor.status().consecutiveFailures,1);assert.equal(JSON.stringify(monitor.status()).includes('token=bad'),false);
  await monitor.runOnce();await monitor.runOnce();assert.equal(sends,1);assert.equal(monitor.status().consecutiveFailures,0);await monitor.close();db.close();
});

test('server exposes sanitized monitor status to administrators only',async t=>{
  const origin='https://poke.example.test';const unused=async()=>{throw new Error('unused');};const app=await buildApp({dbPath:':memory:',origin,catalog:{enabled:true,permissionConfirmed:true,autoStart:false,fetchImpl:unused},alphaMonitor:{enabled:true,autoStart:false,fetchImpl:unused}});t.after(()=>app.close());
  createUser(app.db,{email:'monitor-admin@example.com',nickname:'管理员',password:'password12345',role:'admin'});
  const login=await app.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin},payload:{email:'monitor-admin@example.com',password:'password12345'}});const headers={cookie:login.headers['set-cookie'].split(';')[0]};
  const response=await app.inject({url:'/api/v1/admin/monitor',headers});assert.equal(response.statusCode,200);assert.equal(response.json().enabled,true);assert.equal(response.json().intervalSeconds,30);
  assert.equal((await app.inject('/api/v1/admin/monitor')).statusCode,401);
});
