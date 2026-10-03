import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import staticFiles from '@fastify/static';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {timingSafeEqual} from 'node:crypto';
import {BlockList,isIP} from 'node:net';
import {openDb} from './db.mjs';
import {safeUser,tokenHash,registerAuth} from './auth.mjs';
import {registerEvents,expireEvents} from './events.mjs';
import {registerReports} from './reports.mjs';
import {registerAdmin} from './admin.mjs';
import {ApiError} from './validation.mjs';
import {validateWecomWebhook,createNotifications} from './notifications.mjs';
import {createCatalog} from './catalog.mjs';
import {createSettings} from './settings.mjs';

const proxyPeers=new BlockList();
for(const [address,bits] of [['127.0.0.0',8],['10.0.0.0',8],['172.16.0.0',12],['192.168.0.0',16]])proxyPeers.addSubnet(address,bits,'ipv4');
proxyPeers.addAddress('::1','ipv6');proxyPeers.addSubnet('fc00::',7,'ipv6');
function trustImmediatePrivateProxy(address,hop) {
  if(hop!==0)return false;
  const normalized=address.startsWith('::ffff:')?address.slice(7):address;const version=isIP(normalized);
  return version>0&&proxyPeers.check(normalized,version===4?'ipv4':'ipv6');
}

export async function buildApp({dbPath='data/poke.db',origin='http://localhost:3001',allowedOrigins=[origin],now=Date.now,trustProxy=false,wecomWebhookUrl='',settingsEncryptionKey='',notificationFetch=globalThis.fetch,notificationsAutoStart=true,catalog={}}={}) {
  const webhookUrl=validateWecomWebhook(wecomWebhookUrl);
  const expectedOrigin=new URL(origin).origin;
  if(expectedOrigin!==origin)throw new Error('ORIGIN must contain only scheme, host and optional port');
  const acceptedOrigins=new Set(allowedOrigins.map(value=>{const normalized=new URL(value).origin;if(normalized!==value)throw new Error('ALLOWED_ORIGINS entries must contain only scheme, host and optional port');return normalized;}));acceptedOrigins.add(origin);
  const app=Fastify({logger:false,bodyLimit:16384,requestTimeout:15000,trustProxy:trustProxy?trustImmediatePrivateProxy:false});const db=openDb(dbPath);
  const scriptPolicy=process.env.NODE_ENV==='production'?"script-src 'self'":"script-src 'self' 'unsafe-inline'";
  app.decorate('db',db);app.decorateRequest('user',null);app.decorateRequest('session',null);
  await app.register(cookie);
  const limits=new Map();
  function limit(key,maximum,windowMs) {
    const timestamp=now();
    if(limits.size>=10000)for(const [entry,bucket] of limits)if(bucket.end<=timestamp)limits.delete(entry);
    if(limits.size>=10000&&!limits.has(key))throw new ApiError(429,'请求过多，请稍后再试');
    let bucket=limits.get(key);if(!bucket||bucket.end<=timestamp){bucket={count:0,end:timestamp+windowMs};limits.set(key,bucket);}
    if(bucket.count>=maximum)throw new ApiError(429,'请求过多，请稍后再试');bucket.count++;
  }
  app.addHook('onRequest',async(request,reply)=>{
    reply.header('X-Content-Type-Options','nosniff').header('X-Frame-Options','DENY').header('Referrer-Policy','same-origin');
    reply.header('Content-Security-Policy',"default-src 'self'; "+scriptPolicy+"; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
    if(new URL(origin).protocol==='https:')reply.header('Strict-Transport-Security','max-age=31536000');
    if(request.url.startsWith('/api/'))reply.header('Cache-Control','no-store');
  });
  app.addHook('preHandler',(request,reply,done)=>{
    try {
    const token=request.cookies.poke_session;
    if(token&&token.length<=256){
      const session=db.prepare('SELECT * FROM sessions WHERE token_hash=? AND expires_at>?').get(tokenHash(token),new Date(now()).toISOString());
      if(session){const row=db.prepare('SELECT * FROM users WHERE id=? AND disabled=0').get(session.user_id);if(row){request.user=safeUser(row);request.session=session;}}
    }
    const path=request.routeOptions.url||request.url.split('?')[0];
    const authPublic=path==='/api/v1/auth/register'||path==='/api/v1/auth/login';
    const protectedPath=path.startsWith('/api/v1/admin/')||path==='/api/v1/reports'||path==='/api/v1/reports/mine'||path==='/api/v1/auth/logout';
    if(protectedPath&&!request.user)throw new ApiError(401,'请先登录');
    if(path.startsWith('/api/v1/admin/')&&request.user?.role!=='admin')throw new ApiError(403,'需要管理员权限');
    if(['POST','PUT','PATCH','DELETE'].includes(request.method)&&path.startsWith('/api/')){
      if(!acceptedOrigins.has(request.headers.origin))throw new ApiError(403,'请求来源校验失败');
      if(!authPublic){
        const supplied=request.headers['x-csrf-token'];const expected=request.session?.csrf_token;
        if(typeof supplied!=='string'||!expected||Buffer.byteLength(supplied)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(supplied),Buffer.from(expected)))throw new ApiError(403,'安全验证失败，请刷新页面后重试');
      }
    }
    done();
    }catch(error){done(error);}
  });
  app.setErrorHandler((error,request,reply)=>{
    const status=error.statusCode>=400&&error.statusCode<500?error.statusCode:500;
    if(status===429)reply.header('Retry-After','60');
    const response={error:status===500?'服务器暂时无法处理请求':error.message};
    if(error.fields)response.fields=error.fields;
    reply.code(status).send(response);
  });
  const settings=createSettings({db,now,encryptionKey:settingsEncryptionKey,environmentWebhook:webhookUrl});app.decorate('settings',settings);
  const notifications=createNotifications({db,now,origin,settings,fetchImpl:notificationFetch});
  app.decorate('notifications',notifications);
  const externalCatalog=createCatalog({db,now,...catalog});app.decorate('catalog',externalCatalog);
  app.get('/api/v1/catalog',request=>externalCatalog.list(request.query));
  app.get('/api/v1/catalog/status',()=>externalCatalog.status());
  const context={db,now,origin,limit,notifications,settings,catalog:externalCatalog};registerAuth(app,context);registerEvents(app,context);registerReports(app,context);registerAdmin(app,context);
  const dist=fileURLToPath(new URL('../dist/',import.meta.url));
  const hasClient=existsSync(dist+'index.html');
  if(hasClient)await app.register(staticFiles,{root:dist,prefix:'/',index:['index.html'],list:false});
  app.setNotFoundHandler((request,reply)=>{
    if(hasClient&&request.method==='GET'&&!request.url.startsWith('/api/'))return reply.sendFile('index.html');
    return reply.code(404).send({error:'未找到请求的页面或接口'});
  });
  const maintenance=setInterval(()=>{
    const at=new Date(now()).toISOString();expireEvents(db,at);db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(at);
    for(const [key,bucket] of limits)if(bucket.end<=now())limits.delete(key);
  },60000);maintenance.unref();
  app.addHook('onClose',async()=>{clearInterval(maintenance);externalCatalog.close();await notifications.close();db.close();});
  await app.ready();if(notificationsAutoStart)notifications.start();if(catalog.autoStart!==false)externalCatalog.start();return app;
}
