import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {audit,transaction} from './db.mjs';
import {validateWecomWebhook} from './notifications.mjs';

export function parseSettingsKey(value=''){
  const raw=String(value).trim();if(!raw)return null;
  let key;
  if(/^[0-9a-fA-F]{64}$/.test(raw))key=Buffer.from(raw,'hex');
  else {try{key=Buffer.from(raw,'base64');}catch{key=null;}}
  if(!key||key.length!==32)throw new Error('SETTINGS_ENCRYPTION_KEY 必须是 32 字节密钥（64 位十六进制或 Base64）。');
  return key;
}

function encrypt(key,value){
  const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',key,iv);const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
  return ['v1',iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),encrypted.toString('base64url')].join('.');
}
function decrypt(key,value){
  const [version,iv,tag,ciphertext,...rest]=String(value).split('.');if(version!=='v1'||!iv||!tag||!ciphertext||rest.length)throw new Error('invalid encrypted setting');
  const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(iv,'base64url'));decipher.setAuthTag(Buffer.from(tag,'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext,'base64url')),decipher.final()]).toString('utf8');
}
function maskWebhook(value){
  if(!value)return null;const url=new URL(value),secret=url.searchParams.get('key')||'';return `key=${'*'.repeat(Math.max(8,secret.length-5))}${secret.slice(-5)}`;
}

export function createSettings({db,encryptionKey='',environmentWebhook='',now=Date.now}={}){
  const key=parseSettingsKey(encryptionKey);const envWebhook=validateWecomWebhook(environmentWebhook);
  const get=rowKey=>db.prepare('SELECT value FROM app_settings WHERE key=?').get(rowKey)?.value;
  function resolved(){
    const encrypted=get('wecom_webhook');
    if(encrypted){
      if(!key)return{enabled:false,webhookUrl:'',source:'error',configurationError:true};
      try{const webhookUrl=validateWecomWebhook(decrypt(key,encrypted));const enabled=get('wecom_enabled')!=='0';return{enabled,webhookUrl,source:'database'};}
      catch{return{enabled:false,webhookUrl:'',source:'error',configurationError:true};}
    }
    return{enabled:Boolean(envWebhook),webhookUrl:envWebhook,source:envWebhook?'environment':'none'};
  }
  function getNotificationConfig(){const value=resolved();return{enabled:value.enabled,webhookUrl:value.webhookUrl,source:value.source};}
  function getNotificationStatus(){const value=resolved();return{enabled:value.enabled,configured:Boolean(value.webhookUrl),source:value.source,masked:maskWebhook(value.webhookUrl),canSaveWebhook:Boolean(key),configurationError:Boolean(value.configurationError)};}
  function saveNotificationConfig(input,actorId){
    const hasWebhook=typeof input?.webhookUrl==='string'&&input.webhookUrl.trim();const webhook=hasWebhook?validateWecomWebhook(input.webhookUrl):'';
    if(hasWebhook&&!key)throw new Error('服务器尚未配置设置加密密钥，无法保存企业微信机器人。');
    const at=new Date(now()).toISOString();
    return transaction(db,()=>{
      if(hasWebhook)db.prepare("INSERT INTO app_settings(key,value,updated_at,updated_by) VALUES('wecom_webhook',?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at,updated_by=excluded.updated_by").run(encrypt(key,webhook),at,actorId);
      db.prepare("INSERT INTO app_settings(key,value,updated_at,updated_by) VALUES('wecom_enabled',?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at,updated_by=excluded.updated_by").run(input?.enabled===false?'0':'1',at,actorId);
      const status=getNotificationStatus();audit(db,actorId,'settings.notifications.update','settings',1,{enabled:status.enabled,configured:status.configured,source:status.source,masked:status.masked},at);return status;
    });
  }
  function clearNotificationWebhook(actorId){
    const at=new Date(now()).toISOString();return transaction(db,()=>{db.prepare("DELETE FROM app_settings WHERE key IN ('wecom_webhook','wecom_enabled')").run();const status=getNotificationStatus();audit(db,actorId,'settings.notifications.clear','settings',1,{enabled:status.enabled,configured:status.configured,source:status.source,masked:status.masked},at);return status;});
  }
  return{getNotificationConfig,getNotificationStatus,saveNotificationConfig,clearNotificationWebhook};
}
