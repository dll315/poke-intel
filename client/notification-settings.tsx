import {useCallback,useEffect,useState,type FormEvent} from 'react';
import {Bell,Send,Trash2} from 'lucide-react';
import {request} from './api';

type Status={enabled:boolean;configured:boolean;source:'database'|'environment'|'none'|'error';masked:string|null;canSaveWebhook:boolean;configurationError:boolean;counts:{pending:number;sending:number;sent:number;failed:number;skipped:number};lastSentAt:string|null;lastError:string|null};
type MonitorStatus={enabled:boolean;intervalSeconds:number;lastCheckedAt:string|null;lastSuccessAt:string|null;lastEvent:{pokemon:string;region:string;location:string;observedAt:string}|null;consecutiveFailures:number;lastError:string|null};

export function NotificationSettings({onError,onSuccess}:{onError:(error:unknown)=>void;onSuccess:(message:string)=>void}){
  const [status,setStatus]=useState<Status|null>(null);const [enabled,setEnabled]=useState(false);const [webhookUrl,setWebhookUrl]=useState('');const [busy,setBusy]=useState(false);
  const [monitor,setMonitor]=useState<MonitorStatus|null>(null);
  const load=useCallback(async()=>{try{const [next,monitorStatus]=await Promise.all([request<Status>('/admin/settings/notifications'),request<MonitorStatus>('/admin/monitor')]);setStatus(next);setEnabled(next.enabled);setMonitor(monitorStatus);}catch(error){onError(error);}},[onError]);
  useEffect(()=>{void load();},[load]);
  const act=async(action:()=>Promise<unknown>,message:string)=>{setBusy(true);try{await action();setWebhookUrl('');await load();onSuccess(message);}catch(error){onError(error);}finally{setBusy(false);}};
  const save=(event:FormEvent)=>{event.preventDefault();void act(()=>request('/admin/settings/notifications',{method:'PUT',body:{enabled,...(webhookUrl.trim()?{webhookUrl:webhookUrl.trim()}: {})}}),'推送设置已保存。');};
  if(!status)return <div className="loading-state">正在读取推送设置…</div>;
  return <section className="panel notification-settings">
    {monitor&&<div className="monitor-card"><div><h2>头目实时监控</h2><p>{monitor.enabled?`每 ${monitor.intervalSeconds} 秒检查`:'未启用'}</p></div><div className="monitor-event">{monitor.lastEvent?<><strong>{monitor.lastEvent.pokemon} · {monitor.lastEvent.location}</strong><span>{monitor.lastEvent.region} · 最近成功 {monitor.lastSuccessAt?new Date(monitor.lastSuccessAt).toLocaleString('zh-CN'):'暂无'}</span></>:<><strong>尚未发现头目</strong><span>{monitor.lastError||'等待第一次检查'}</span></>}</div></div>}
    <div className="settings-heading"><span className="signal"><Bell size={19}/></span><div><h2>企业微信机器人</h2><p>审核通过的新情报会自动推送到企业微信群。</p></div></div>
    {status.configurationError&&<div className="alert" role="alert">已保存的机器人配置无法解密，请重新填写。</div>}
    {!status.canSaveWebhook&&<div className="alert" role="alert">服务器尚未配置 SETTINGS_ENCRYPTION_KEY，暂时不能从网页保存机器人。</div>}
    <div className="settings-status"><div><span>当前状态</span><strong>{status.enabled?'已启用':'已停用'}</strong></div><div><span>配置来源</span><strong>{status.source==='database'?'管理后台':status.source==='environment'?'服务器环境变量':'未配置'}</strong></div><div><span>机器人标识</span><strong>{status.masked||'无'}</strong></div></div>
    <form onSubmit={save}>
      <label className="toggle-row"><input type="checkbox" aria-label="启用企业微信推送" checked={enabled} onChange={event=>setEnabled(event.target.checked)}/><span>启用企业微信推送</span></label>
      <label className="field"><span>企业微信机器人 Webhook</span><input type="password" aria-label="企业微信机器人 Webhook" value={webhookUrl} onChange={event=>setWebhookUrl(event.target.value)} placeholder={status.configured?'留空表示保留当前机器人':'粘贴机器人 Webhook 地址'} disabled={!status.canSaveWebhook} autoComplete="new-password"/></label>
      <div className="settings-actions"><button className="button primary" disabled={busy||Boolean(webhookUrl&&!status.canSaveWebhook)}>保存设置</button><button type="button" className="button secondary" disabled={busy||!status.enabled} onClick={()=>void act(()=>request('/admin/settings/notifications/test',{method:'POST'}),'测试消息发送成功。')}><Send size={15}/>发送测试消息</button><button type="button" className="button danger" disabled={busy||status.source!=='database'} onClick={()=>void act(()=>request('/admin/settings/notifications/webhook',{method:'DELETE'}),'网页配置已清除。')}><Trash2 size={15}/>清除网页配置</button></div>
    </form>
    <div className="settings-metrics"><span>待发送 <strong>{status.counts.pending}</strong></span><span>已发送 <strong>{status.counts.sent}</strong></span><span>失败 <strong>{status.counts.failed}</strong></span></div>
    {status.lastError&&<p className="settings-error">最近错误：{status.lastError}</p>}
  </section>;
}
