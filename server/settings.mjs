import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {audit,transaction} from './db.mjs';
import {validateWecomWebhook} from './notifications.mjs';
import {ApiError} from './validation.mjs';
import {notificationCategories,normalizeCategories} from './notification-categories.mjs';

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
    return{enabled:Boolean(envWebhook)&&get('wecom_enabled')!=='0',webhookUrl:envWebhook,source:envWebhook?'environment':'none'};
  }
  function getNotificationConfig(){const value=resolved();return{enabled:value.enabled,webhookUrl:value.webhookUrl,source:value.source};}
  function listNotificationLinks(){return db.prepare('SELECT id,label,webhook_ciphertext,enabled,categories FROM notification_links ORDER BY id').all().map(row=>{
    let masked=null,configurationError=false;try{masked=maskWebhook(decrypt(key,row.webhook_ciphertext));}catch{configurationError=true;}
    return{id:row.id,label:row.label,enabled:Boolean(row.enabled),masked,configurationError,categories:JSON.parse(row.categories)};
  });}
  function getNotificationDestinations(){
    const primary=resolved(),destinations=[];
    if(primary.enabled&&primary.webhookUrl)destinations.push({id:'primary',webhookUrl:primary.webhookUrl,categories:primaryCategories()});
    if(key)for(const row of db.prepare('SELECT id,webhook_ciphertext,categories FROM notification_links WHERE enabled=1 ORDER BY id').all()){
      try{destinations.push({id:`link:${row.id}`,webhookUrl:validateWecomWebhook(decrypt(key,row.webhook_ciphertext)),categories:normalizeCategories(JSON.parse(row.categories))});}catch{}
    }
    return destinations;
  }
  function primaryCategories(){try{return normalizeCategories(JSON.parse(get('wecom_categories')||JSON.stringify(notificationCategories)));}catch{return [...notificationCategories];}}
  function getNotificationStatus(){const value=resolved(),links=listNotificationLinks(),enabled=value.enabled||links.some(link=>link.enabled&&!link.configurationError);return{enabled,primaryEnabled:value.enabled,configured:Boolean(value.webhookUrl)||links.length>0,source:value.source==='none'&&links.length?'database':value.source,masked:maskWebhook(value.webhookUrl),canSaveWebhook:Boolean(key),configurationError:Boolean(value.configurationError)||links.some(link=>link.configurationError),categories:primaryCategories(),links};}
  function addNotificationLink(input,actorId){
    if(!key)throw new ApiError(409,'服务器尚未配置设置加密密钥');
    const label=String(input.label||'').trim();if(!label||label.length>30)throw new ApiError(422,'链接名称须为 1–30 个字符');
    const webhook=validateWecomWebhook(input.webhookUrl),at=new Date(now()).toISOString();
    const categories=normalizeCategories(input.categories??notificationCategories);
    return transaction(db,()=>{const result=db.prepare('INSERT INTO notification_links(label,webhook_ciphertext,enabled,categories,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(label,encrypt(key,webhook),input.enabled===false?0:1,JSON.stringify(categories),at,at);audit(db,actorId,'settings.notification-link.add','notification_link',Number(result.lastInsertRowid),{label,enabled:input.enabled!==false,categories},at);return listNotificationLinks().find(link=>link.id===Number(result.lastInsertRowid));});
  }
  function updateNotificationLink(id,input,actorId){
    const row=db.prepare('SELECT * FROM notification_links WHERE id=?').get(id);if(!row)throw new ApiError(404,'推送链接不存在');
    const label=input.label===undefined?row.label:String(input.label).trim();if(!label||label.length>30)throw new ApiError(422,'链接名称须为 1–30 个字符');
    if(input.webhookUrl&&!key)throw new ApiError(409,'服务器尚未配置设置加密密钥');
    const ciphertext=input.webhookUrl?encrypt(key,validateWecomWebhook(input.webhookUrl)):row.webhook_ciphertext;
    const enabled=input.enabled===undefined?row.enabled:input.enabled?1:0,categories=normalizeCategories(input.categories??JSON.parse(row.categories)),at=new Date(now()).toISOString();
    return transaction(db,()=>{db.prepare('UPDATE notification_links SET label=?,webhook_ciphertext=?,enabled=?,categories=?,updated_at=? WHERE id=?').run(label,ciphertext,enabled,JSON.stringify(categories),at,id);audit(db,actorId,'settings.notification-link.update','notification_link',id,{label,enabled:Boolean(enabled),categories},at);return listNotificationLinks().find(link=>link.id===id);});
  }
  function deleteNotificationLink(id,actorId){const row=db.prepare('SELECT label FROM notification_links WHERE id=?').get(id);if(!row)throw new ApiError(404,'推送链接不存在');const at=new Date(now()).toISOString();return transaction(db,()=>{db.prepare('DELETE FROM notification_links WHERE id=?').run(id);audit(db,actorId,'settings.notification-link.delete','notification_link',id,{label:row.label},at);return{ok:true};});}
  function getDestination(id){return getNotificationDestinations().find(item=>item.id===id)?.webhookUrl||null;}
  function saveNotificationConfig(input,actorId){
    const hasWebhook=typeof input?.webhookUrl==='string'&&input.webhookUrl.trim();const webhook=hasWebhook?validateWecomWebhook(input.webhookUrl):'';
    if(hasWebhook&&!key)throw new Error('服务器尚未配置设置加密密钥，无法保存企业微信机器人。');
    const at=new Date(now()).toISOString();
    return transaction(db,()=>{
      if(hasWebhook)db.prepare("INSERT INTO app_settings(key,value,updated_at,updated_by) VALUES('wecom_webhook',?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at,updated_by=excluded.updated_by").run(encrypt(key,webhook),at,actorId);
      if(input?.categories)db.prepare("INSERT INTO app_settings(key,value,updated_at,updated_by) VALUES('wecom_categories',?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at,updated_by=excluded.updated_by").run(JSON.stringify(normalizeCategories(input.categories)),at,actorId);
      db.prepare("INSERT INTO app_settings(key,value,updated_at,updated_by) VALUES('wecom_enabled',?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at,updated_by=excluded.updated_by").run(input?.enabled===false?'0':'1',at,actorId);
      const status=getNotificationStatus();audit(db,actorId,'settings.notifications.update','settings',1,{enabled:status.enabled,configured:status.configured,source:status.source,masked:status.masked},at);return status;
    });
  }
  function clearNotificationWebhook(actorId){
    const at=new Date(now()).toISOString();return transaction(db,()=>{db.prepare("DELETE FROM app_settings WHERE key IN ('wecom_webhook','wecom_enabled','wecom_categories')").run();const status=getNotificationStatus();audit(db,actorId,'settings.notifications.clear','settings',1,{enabled:status.enabled,configured:status.configured,source:status.source,masked:status.masked},at);return status;});
  }
  return{getNotificationConfig,getNotificationStatus,getNotificationDestinations,getDestination,listNotificationLinks,addNotificationLink,updateNotificationLink,deleteNotificationLink,saveNotificationConfig,clearNotificationWebhook};
}
