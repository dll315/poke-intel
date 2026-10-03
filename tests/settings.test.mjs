import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb} from '../server/db.mjs';
import {createUser} from '../server/auth.mjs';
import {createSettings,parseSettingsKey} from '../server/settings.mjs';
import {buildApp} from '../server/app.mjs';

const webhook='https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=database-secret-key';
const environmentWebhook='https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=environment-secret-key';
const key='11'.repeat(32);

function fixture(options={}){
  const db=openDb(':memory:');
  const user=createUser(db,{email:'admin@example.com',nickname:'管理员',password:'password12345',role:'admin'});
  let clock=Date.parse('2026-10-04T01:00:00Z');
  const settings=createSettings({db,encryptionKey:key,environmentWebhook,now:()=>clock,...options});
  return{db,user,settings,advance:ms=>clock+=ms};
}

test('settings key accepts exact hex or base64 32-byte values',()=>{
  assert.equal(parseSettingsKey(key).length,32);
  assert.equal(parseSettingsKey(Buffer.alloc(32,7).toString('base64')).length,32);
  assert.equal(parseSettingsKey(''),null);
  for(const invalid of ['ab','zz'.repeat(32),Buffer.alloc(31).toString('base64')])assert.throws(()=>parseSettingsKey(invalid),/32|密钥/);
});

test('notification webhook is encrypted, masked and database settings override environment fallback',()=>{
  const {db,user,settings}=fixture();
  assert.deepEqual(settings.getNotificationConfig(),{enabled:true,webhookUrl:environmentWebhook,source:'environment'});
  settings.saveNotificationConfig({enabled:true,webhookUrl:webhook},user.id);
  assert.deepEqual(settings.getNotificationConfig(),{enabled:true,webhookUrl:webhook,source:'database'});
  const stored=db.prepare("SELECT value FROM app_settings WHERE key='wecom_webhook'").get().value;
  assert.equal(stored.includes('database-secret-key'),false);assert.match(stored,/^v1\./);
  const status=settings.getNotificationStatus();
  assert.equal(status.configured,true);assert.equal(status.enabled,true);assert.equal(status.source,'database');assert.match(status.masked,/key=\*+t-key$/);assert.equal(JSON.stringify(status).includes('database-secret-key'),false);
  const audit=JSON.stringify(db.prepare("SELECT details FROM audit_logs WHERE action='settings.notifications.update'").get());assert.equal(audit.includes('database-secret-key'),false);
});

test('disable preserves encrypted webhook and clear restores environment fallback',()=>{
  const {db,user,settings}=fixture();settings.saveNotificationConfig({enabled:true,webhookUrl:webhook},user.id);
  settings.saveNotificationConfig({enabled:false},user.id);assert.equal(settings.getNotificationConfig().enabled,false);assert.equal(settings.getNotificationConfig().webhookUrl,webhook);
  settings.clearNotificationWebhook(user.id);assert.deepEqual(settings.getNotificationConfig(),{enabled:true,webhookUrl:environmentWebhook,source:'environment'});
  assert.equal(db.prepare("SELECT count(*) n FROM app_settings WHERE key='wecom_webhook'").get().n,0);
});

test('saving requires encryption key and corrupted ciphertext is reported without leaking values',()=>{
  const noKey=fixture({encryptionKey:''});
  assert.throws(()=>noKey.settings.saveNotificationConfig({enabled:true,webhookUrl:webhook},noKey.user.id),/加密密钥/);
  assert.equal(noKey.settings.getNotificationStatus().canSaveWebhook,false);
  const {db,user,settings}=fixture();settings.saveNotificationConfig({enabled:true,webhookUrl:webhook},user.id);
  db.prepare("UPDATE app_settings SET value='v1.broken' WHERE key='wecom_webhook'").run();
  const status=settings.getNotificationStatus();assert.equal(status.configurationError,true);assert.equal(status.configured,false);assert.equal(JSON.stringify(status).includes('broken'),false);
  assert.deepEqual(settings.getNotificationConfig(),{enabled:false,webhookUrl:'',source:'error'});
});

test('admin notification settings API applies immediately and test messages never expose webhook',async t=>{
  const sent=[];const origin='https://poke.example.test';
  const app=await buildApp({dbPath:':memory:',origin,wecomWebhookUrl:environmentWebhook,settingsEncryptionKey:key,notificationFetch:async(url,options)=>{sent.push({url:String(url),body:JSON.parse(options.body)});return Response.json({errcode:0});},notificationsAutoStart:false});
  t.after(()=>app.close());
  createUser(app.db,{email:'admin-api@example.com',nickname:'管理员',password:'password12345',role:'admin'});
  createUser(app.db,{email:'player-api@example.com',nickname:'玩家',password:'password12345',role:'user'});
  const login=async email=>{const response=await app.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin},payload:{email,password:'password12345'}});return{origin,cookie:response.headers['set-cookie'].split(';')[0],'x-csrf-token':response.json().csrfToken};};
  const admin=await login('admin-api@example.com'),player=await login('player-api@example.com');
  assert.equal((await app.inject({url:'/api/v1/admin/settings/notifications',headers:player})).statusCode,403);
  let response=await app.inject({url:'/api/v1/admin/settings/notifications',headers:admin});assert.equal(response.statusCode,200);assert.equal(response.json().source,'environment');assert.equal(response.body.includes('environment-secret-key'),false);
  assert.equal((await app.inject({method:'PUT',url:'/api/v1/admin/settings/notifications',headers:admin,payload:{enabled:'yes',webhookUrl:'https://evil.test'}})).statusCode,422);
  response=await app.inject({method:'PUT',url:'/api/v1/admin/settings/notifications',headers:admin,payload:{enabled:true,webhookUrl:webhook}});assert.equal(response.statusCode,200,response.body);
  response=await app.inject({method:'POST',url:'/api/v1/admin/settings/notifications/test',headers:admin,payload:{}});assert.equal(response.statusCode,200,response.body);assert.equal(sent.at(-1).url,webhook);assert.match(sent.at(-1).body.markdown.content,/测试消息/);
  response=await app.inject({method:'PUT',url:'/api/v1/admin/settings/notifications',headers:admin,payload:{enabled:false}});assert.equal(response.json().enabled,false);
  assert.equal((await app.inject({method:'POST',url:'/api/v1/admin/settings/notifications/test',headers:admin,payload:{}})).statusCode,409);
  response=await app.inject({method:'DELETE',url:'/api/v1/admin/settings/notifications/webhook',headers:admin});assert.equal(response.json().source,'environment');
  assert.equal(response.body.includes('database-secret-key'),false);
});
