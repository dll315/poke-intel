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
  await monitor.runOnce();assert.equal(db.prepare('SELECT count(*) n FROM events').get().n,0);assert.equal(calls.length,3);assert.match(calls[2].headers.Cookie,/session=abc/);assert.equal(monitor.status().lastEvent.pokemon,'Honchkrow');assert.match(monitor.status().lastError,/已使用首页摘要/);await monitor.close();db.close();
});

test('monitor publishes a new active state once and recovers after a transient failure',async()=>{
  const db=openDb(':memory:');let failures=3;let sends=0;const fetchImpl=async url=>{if(failures-->0)throw new Error('https://secret.example/?token=bad');if(String(url).endsWith('/'))return new Response('<meta name="landing-status-token" content="token-12345678901234567890123456">',{headers:{'set-cookie':'session=abc'}});return Response.json(payload);};
  const monitor=createAlphaMonitor({db,notifications:{enabled:true,enqueueEvent(){sends++;}},fetchImpl,now:()=>Date.parse('2026-10-03T16:10:00Z'),enabled:true,autoStart:false});
  await assert.rejects(()=>monitor.runOnce());assert.equal(monitor.status().consecutiveFailures,1);assert.equal(JSON.stringify(monitor.status()).includes('token=bad'),false);
  await monitor.runOnce();await monitor.runOnce();assert.equal(sends,1);assert.equal(monitor.status().consecutiveFailures,0);await monitor.close();db.close();
});

test('history polling publishes every fresh Alpha missed by the homepage summary',async()=>{
  const db=openDb(':memory:');let queued=0;
  const rows=[
    {id:4901,pokemon:'Ditto',region:'Unova',location:'Route 9',timestampIso:'2026-10-05T20:11:12',alphaUrl:'/alpha-list?pokemon=Ditto&region=Unova&location=Route+9&timestamp=1791235572'},
    {id:4900,pokemon:'Pinsir',region:'Unova',location:'Route 12',timestampIso:'2026-10-05T20:05:00',alphaUrl:'/alpha-list?pokemon=Pinsir&region=Unova&location=Route+12&timestamp=1791235200'},
  ];
  const calls=[];const fetchImpl=async(url,options)=>{calls.push({url:String(url),headers:options.headers});return String(url).endsWith('/history')
    ?new Response('<meta name="history-api-token" content="history-token-12345678901234567890">',{headers:{'set-cookie':'session=abc'}})
    :String(url).includes('/api/history-data')?Response.json({historyData:rows,totalRows:2}):new Response('unexpected',{status:500});};
  const monitor=createAlphaMonitor({db,notifications:{enabled:true,enqueueEvent(){queued++;}},fetchImpl,now:()=>Date.parse('2026-10-05T20:20:00Z'),enabled:true,autoStart:false});
  await monitor.runOnce();await monitor.runOnce();
  assert.equal(db.prepare("SELECT count(*) n FROM events WHERE source='external'").get().n,2);
  assert.equal(queued,2);assert.equal(monitor.status().lastEvent.pokemon,'Ditto');
  assert.equal(calls.filter(call=>call.url.endsWith('/history')).length,1);
  assert.equal(calls[1].headers['X-History-Token'],'history-token-12345678901234567890');
  assert.equal(calls[1].headers.Cookie,'session=abc');
  await monitor.close();db.close();
});

test('swarm history polling publishes fresh swarm sightings separately from bosses',async()=>{
  const db=openDb(':memory:');let queued=0;const calls=[];
  const fetchImpl=async(url,options)=>{calls.push(String(url));if(String(url).endsWith('/swarm-history'))return new Response('<meta name="history-api-token" content="history-token-12345678901234567890">',{headers:{'set-cookie':'session=swarm'}});return Response.json({historyData:[{id:5832,pokemon:'Porygon-Z',region:'Johto',location:'Team Rocket HQ',timestampIso:'2026-10-06T03:53:23',alphaUrl:'/swarm-list?pokemon=Porygon-Z&region=Johto&location=Team+Rocket+HQ&timestamp=1791263303'}]});};
  const monitor=createAlphaMonitor({db,notifications:{enabled:true,enqueueEvent(){queued++;}},fetchImpl,now:()=>Date.parse('2026-10-06T04:00:00Z'),enabled:true,kind:'swarm',autoStart:false});
  await monitor.runOnce();await monitor.runOnce();
  assert.equal(db.prepare("SELECT kind FROM events WHERE source='external'").get().kind,'swarm');
  assert.equal(queued,1);assert.equal(monitor.status().lastEvent.pokemon,'Porygon-Z');
  assert.ok(calls.some(url=>url.includes('/api/swarm-history-data')));
  await monitor.close();db.close();
});

test('ordinary swarm sightings expire after 20 minutes instead of using the Alpha duration',async()=>{
  const db=openDb(':memory:');let queued=0;
  const fetchImpl=async url=>String(url).endsWith('/swarm-history')?new Response('<meta name="history-api-token" content="history-token-12345678901234567890">'):Response.json({historyData:[{pokemon:'Porygon-Z',region:'Johto',location:'Team Rocket HQ',timestampIso:'2026-10-06T03:53:23',alphaUrl:'/swarm-list?timestamp=1791263303'}]});
  const monitor=createAlphaMonitor({db,notifications:{enqueueEvent(){queued++;}},fetchImpl,now:()=>Date.parse('2026-10-06T04:00:00Z'),enabled:true,kind:'swarm',autoStart:false});
  await monitor.runOnce();assert.equal(db.prepare("SELECT expires_at FROM events WHERE kind='swarm'").get().expires_at,'2026-10-06T04:13:23.000Z');
  assert.equal(queued,1);await monitor.close();db.close();
});

test('swarm polling corrects still-active 75-minute records made by the old monitor',async()=>{
  const db=openDb(':memory:');const observed='2026-10-06T03:00:00.000Z';
  db.prepare("INSERT INTO events(kind,pokemon,region,location,observed_at,expires_at,last_confirmed_at,status,source) VALUES('swarm','Crawdaunt','unova','Route 3',?,? ,?,'active','external')").run(observed,'2026-10-06T04:15:00.000Z',observed);
  const fetchImpl=async url=>String(url).endsWith('/swarm-history')?new Response('<meta name="history-api-token" content="history-token-12345678901234567890">'):Response.json({historyData:[]});
  const monitor=createAlphaMonitor({db,notifications:{enqueueEvent(){}},fetchImpl,now:()=>Date.parse('2026-10-06T04:00:00Z'),enabled:true,kind:'swarm',autoStart:false});
  await monitor.runOnce();const row=db.prepare("SELECT expires_at,status FROM events WHERE kind='swarm'").get();assert.equal(row.expires_at,'2026-10-06T03:20:00.000Z');assert.equal(row.status,'ended');
  await monitor.close();db.close();
});

test('old swarm expiry is repaired at startup even when Alphapedia is unavailable',async()=>{
  const db=openDb(':memory:');const observed='2026-10-06T03:00:00.000Z';
  db.prepare("INSERT INTO events(kind,pokemon,region,location,observed_at,expires_at,last_confirmed_at,status,source) VALUES('swarm','Crawdaunt','unova','Route 3',?,? ,?,'active','external')").run(observed,'2026-10-06T04:15:00.000Z',observed);
  const monitor=createAlphaMonitor({db,notifications:{enqueueEvent(){}},fetchImpl:async()=>{throw new Error('offline');},now:()=>Date.parse('2026-10-06T04:00:00Z'),enabled:true,kind:'swarm',autoStart:false});
  const row=db.prepare("SELECT expires_at,status FROM events WHERE kind='swarm'").get();assert.equal(row.expires_at,'2026-10-06T03:20:00.000Z');assert.equal(row.status,'ended');
  await monitor.close();db.close();
});

test('phenomenon lifespan comes from sighting age and missing active cards end old sightings',async()=>{
  const db=openDb(':memory:');let clock=Date.parse('2026-10-06T05:00:00Z');let active=true;
  const card='<article class="pheno-card card-active-pheno"><p data-i18n="Grass Pheno">Grass</p><span data-pokemon="Audino">Audino</span><span data-location="Route 3">Route 3</span><p data-timedelta="120">ago</p><a href="/pheno-list?location=Route+3&amp;type=Grass">View</a></article>';
  const fetchImpl=async()=>new Response(`<div id="phenoSectionHost">${active?card:''}</div><span id="landingNowLabel">${new Date(clock).toISOString().replace('T',' ').replace('.000Z',' UTC (UTC+00:00)')}</span>`);
  const monitor=createAlphaMonitor({db,notifications:{enqueueEvent(){}},fetchImpl,now:()=>clock,enabled:true,kind:'pheno',autoStart:false});
  await monitor.runOnce();assert.equal(db.prepare("SELECT expires_at FROM events WHERE kind='pheno'").get().expires_at,'2026-10-06T05:08:00.000Z');
  clock+=30000;active=false;await monitor.runOnce();assert.equal(db.prepare("SELECT status FROM events WHERE kind='pheno'").get().status,'ended');
  await monitor.close();db.close();
});

test('swarm monitor retries an intermittent connection failure within one check',async()=>{
  const db=openDb(':memory:');let calls=0;
  const fetchImpl=async url=>{calls++;if(calls===1)throw new Error('connect timeout');if(String(url).endsWith('/swarm-history'))return new Response('<meta name="history-api-token" content="history-token-12345678901234567890">');return Response.json({historyData:[]});};
  const monitor=createAlphaMonitor({db,notifications:{enabled:false,enqueueEvent(){}},kind:'swarm',enabled:true,fetchImpl,autoStart:false});
  await monitor.runOnce();assert.equal(calls,3);assert.equal(monitor.status().lastError,null);
  await monitor.close();db.close();
});

test('pheno monitor publishes each active phenomenon once from landing status',async()=>{
  const db=openDb(':memory:');let queued=0;
  const card=(pokemon,location,type,age,active=true)=>`<article class="pheno-card ${active?'card-active-pheno':''}"><p data-i18n="${type} Pheno">${type} Pheno</p><span data-pokemon="${pokemon}">${pokemon}</span><span data-location="${location}">${location}</span><p data-timedelta="${age}">ago</p><a href="/pheno-list?location=${encodeURIComponent(location)}&amp;type=${type}">View</a></article>`;
  const status={now_label:'2026-10-06 05:00:00 UTC (UTC+00:00)',pheno_section_html:card('Audino','Route 3','Grass',569)+card('Basculin','Abundant Shrine','Water',515)+card('Excadrill','Victory Road','Dust',22665,false)};
  let calls=0;const fetchImpl=async url=>{calls++;assert.ok(String(url).endsWith('/'));return new Response(`<div id="phenoSectionHost">${status.pheno_section_html}</div><span id="landingNowLabel">${status.now_label}</span>`);};
  const monitor=createAlphaMonitor({db,notifications:{enabled:true,enqueueEvent(){queued++;}},fetchImpl,now:()=>Date.parse('2026-10-06T05:00:00Z'),enabled:true,kind:'pheno',autoStart:false});
  await monitor.runOnce();await monitor.runOnce();
  assert.equal(db.prepare("SELECT count(*) n FROM events WHERE kind='pheno'").get().n,2);
  assert.equal(queued,2);assert.equal(calls,2);assert.equal(monitor.status().lastEvent.kind,'pheno');
  const eventId=db.prepare("SELECT id FROM events WHERE pokemon='Audino'").get().id;
  db.prepare("UPDATE events SET status='corrected' WHERE id=?").run(eventId);
  await monitor.runOnce();assert.equal(db.prepare('SELECT status FROM events WHERE id=?').get(eventId).status,'corrected');
  await monitor.close();db.close();
});

test('server exposes sanitized monitor status to administrators only',async t=>{
  const origin='https://poke.example.test';const unused=async()=>{throw new Error('unused');};const app=await buildApp({dbPath:':memory:',origin,catalog:{enabled:true,permissionConfirmed:true,autoStart:false,fetchImpl:unused},alphaMonitor:{enabled:true,autoStart:false,fetchImpl:unused}});t.after(()=>app.close());
  createUser(app.db,{username:'monitor-admin',nickname:'管理员',password:'password12345',role:'admin'});
  const login=await app.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin},payload:{username:'monitor-admin',password:'password12345'}});const headers={cookie:login.headers['set-cookie'].split(';')[0]};
  const response=await app.inject({url:'/api/v1/admin/monitor',headers});assert.equal(response.statusCode,200);assert.equal(response.json().enabled,true);assert.equal(response.json().intervalSeconds,30);
  assert.equal((await app.inject('/api/v1/admin/monitor')).statusCode,401);
});
