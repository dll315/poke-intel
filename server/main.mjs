import {buildApp} from './app.mjs';
import {setDefaultResultOrder} from 'node:dns';

setDefaultResultOrder('ipv4first');

const production=process.env.NODE_ENV==='production';
const origin=process.env.ORIGIN||(production?'':'http://localhost:3001');
if(production){
  const parsed=origin?new URL(origin):null;
  const localHttp=parsed?.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(parsed.hostname);
  if(!parsed||(parsed.protocol!=='https:'&&!localHttp))throw new Error('Production requires an HTTPS ORIGIN or loopback HTTP ORIGIN');
}
const allowedOrigins=(process.env.ALLOWED_ORIGINS||origin).split(',').map(value=>value.trim()).filter(Boolean);
const app=await buildApp({dbPath:process.env.DB_PATH||'data/poke.db',origin,allowedOrigins,trustProxy:process.env.TRUST_PROXY==='1',wecomWebhookUrl:process.env.WECOM_WEBHOOK_URL||'',settingsEncryptionKey:process.env.SETTINGS_ENCRYPTION_KEY||'',catalog:{enabled:process.env.ALPHAPEDIA_ENABLED==='1',permissionConfirmed:process.env.ALPHAPEDIA_PERMISSION_CONFIRMED==='1'},alphaMonitor:{enabled:process.env.ALPHA_MONITOR_ENABLED==='1',intervalMs:Number(process.env.ALPHA_MONITOR_INTERVAL_SECONDS||30)*1000},swarmMonitor:{enabled:(process.env.SWARM_MONITOR_ENABLED||process.env.ALPHA_MONITOR_ENABLED)==='1',intervalMs:Number(process.env.SWARM_MONITOR_INTERVAL_SECONDS||30)*1000},phenoMonitor:{enabled:(process.env.PHENO_MONITOR_ENABLED||process.env.ALPHA_MONITOR_ENABLED)==='1',intervalMs:Number(process.env.PHENO_MONITOR_INTERVAL_SECONDS||30)*1000}});
await app.listen({host:process.env.HOST||'127.0.0.1',port:Number(process.env.PORT||3001)});
console.log(`Poke 情报站已启动：${origin}`);
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,async()=>{await app.close();process.exit(0);});
