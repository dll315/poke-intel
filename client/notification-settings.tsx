import {useCallback,useEffect,useState,type FormEvent} from 'react';
import {Bell,Send,Trash2} from 'lucide-react';
import {request} from './api';

type Category='boss'|'swarm'|'player'|'pheno';
const categories:Category[]=['boss','swarm','player','pheno'];
const categoryNames:Record<Category,string>={boss:'头目推送',swarm:'群聚推送',player:'玩家报点推送',pheno:'奇遇推送'};
const categoryHint:Record<Category,string>={boss:'Alphapedia 自动头目',swarm:'Alphapedia 自动群聚',player:'玩家报点审核通过后',pheno:'Alphapedia 活跃奇遇'};
type Status={enabled:boolean;primaryEnabled?:boolean;configured:boolean;source:'database'|'environment'|'none'|'error';masked:string|null;canSaveWebhook:boolean;configurationError:boolean;categories?:Category[];counts:{pending:number;sending:number;sent:number;failed:number;skipped:number};lastSentAt:string|null;lastError:string|null};
type MonitorStatus={enabled:boolean;intervalSeconds:number;lastCheckedAt:string|null;lastSuccessAt:string|null;lastEvent:{pokemon:string;pokemonZh?:string;region:string;location:string;locationZh?:string;observedAt:string}|null;consecutiveFailures:number;lastError:string|null};
type Link={id:number;label:string;enabled:boolean;masked:string|null;configurationError:boolean;categories?:Category[]};

function CategoryChoices({selected,onChange,prefix,disabled=false}:{selected:Category[];onChange:(next:Category[])=>void;prefix:string;disabled?:boolean}){
  return <fieldset className="category-choices" disabled={disabled}><legend>接收的情报类别</legend><div className="category-choice-grid">{categories.map(category=><label className="category-choice" key={category}><input type="checkbox" aria-label={`${prefix}${categoryNames[category]}`} checked={selected.includes(category)} onChange={event=>onChange(event.target.checked?categories.filter(item=>selected.includes(item)||item===category):selected.filter(item=>item!==category))}/><span><strong>{categoryNames[category]}</strong><small>{categoryHint[category]}</small></span></label>)}</div></fieldset>;
}

export function NotificationSettings({onError,onSuccess}:{onError:(error:unknown)=>void;onSuccess:(message:string)=>void}){
  const [status,setStatus]=useState<Status|null>(null);const [enabled,setEnabled]=useState(false);const [webhookUrl,setWebhookUrl]=useState('');const [busy,setBusy]=useState(false);
  const [monitor,setMonitor]=useState<MonitorStatus|null>(null);const [swarmMonitor,setSwarmMonitor]=useState<MonitorStatus|null>(null);const [phenoMonitor,setPhenoMonitor]=useState<MonitorStatus|null>(null);
  const [primaryCategories,setPrimaryCategories]=useState<Category[]>(categories);
  const [links,setLinks]=useState<Link[]>([]),[linkLabel,setLinkLabel]=useState(''),[linkUrl,setLinkUrl]=useState(''),[linkCategories,setLinkCategories]=useState<Category[]>(categories);
  const load=useCallback(async()=>{try{const [next,monitorStatus,swarmStatus,phenoStatus,nextLinks]=await Promise.all([request<Status>('/admin/settings/notifications'),request<MonitorStatus>('/admin/monitor'),request<MonitorStatus>('/admin/monitor/swarm'),request<MonitorStatus>('/admin/monitor/pheno'),request<Link[]>('/admin/settings/notification-links')]);setStatus(next);setEnabled(next.primaryEnabled??next.enabled);setPrimaryCategories(next.categories??categories);setMonitor(monitorStatus);setSwarmMonitor(swarmStatus);setPhenoMonitor(phenoStatus);setLinks(nextLinks);}catch(error){onError(error);}},[onError]);
  useEffect(()=>{void load();},[load]);
  const act=async(action:()=>Promise<unknown>,message:string)=>{setBusy(true);try{await action();setWebhookUrl('');await load();onSuccess(message);}catch(error){onError(error);}finally{setBusy(false);}};
  const save=(event:FormEvent)=>{event.preventDefault();void act(()=>request('/admin/settings/notifications',{method:'PUT',body:{enabled,categories:primaryCategories,...(webhookUrl.trim()?{webhookUrl:webhookUrl.trim()}: {})}}),'推送设置已保存。');};
  const addLink=(event:FormEvent)=>{event.preventDefault();setBusy(true);void request('/admin/settings/notification-links',{method:'POST',body:{label:linkLabel.trim(),webhookUrl:linkUrl.trim(),enabled:true,categories:linkCategories}}).then(async()=>{setLinkLabel('');setLinkUrl('');setLinkCategories(categories);await load();onSuccess('推送链接已添加。');}).catch(onError).finally(()=>setBusy(false));};
  if(!status)return <div className="loading-state">正在读取推送设置…</div>;
  return <section className="panel notification-settings">
    {monitor&&<div className="monitor-card"><div><h2>头目实时监控</h2><p>{monitor.enabled?`每 ${monitor.intervalSeconds} 秒检查`:'未启用'}</p></div><div className="monitor-event">{monitor.lastEvent?<><strong>{monitor.lastEvent.pokemonZh||monitor.lastEvent.pokemon} · {monitor.lastEvent.locationZh||monitor.lastEvent.location}</strong><span>{monitor.lastEvent.region} · 最近成功 {monitor.lastSuccessAt?new Date(monitor.lastSuccessAt).toLocaleString('zh-CN'):'暂无'}</span></>:<><strong>尚未发现头目</strong><span>{monitor.lastError||'等待第一次检查'}</span></>}</div></div>}
    {swarmMonitor&&<div className="monitor-card"><div><h2>群聚实时监控</h2><p>{swarmMonitor.enabled?`每 ${swarmMonitor.intervalSeconds} 秒检查`:'未启用'}</p></div><div className="monitor-event">{swarmMonitor.lastEvent?<><strong>{swarmMonitor.lastEvent.pokemonZh||swarmMonitor.lastEvent.pokemon} · {swarmMonitor.lastEvent.locationZh||swarmMonitor.lastEvent.location}</strong><span>{swarmMonitor.lastEvent.region} · 最近成功 {swarmMonitor.lastSuccessAt?new Date(swarmMonitor.lastSuccessAt).toLocaleString('zh-CN'):'暂无'}</span></>:<><strong>尚未发现群聚</strong><span>{swarmMonitor.lastError||'等待第一次检查'}</span></>}</div></div>}
    {phenoMonitor&&<div className="monitor-card"><div><h2>奇遇实时监控</h2><p>{phenoMonitor.enabled?`每 ${phenoMonitor.intervalSeconds} 秒检查`:'未启用'}</p></div><div className="monitor-event">{phenoMonitor.lastEvent?<><strong>{phenoMonitor.lastEvent.pokemonZh||phenoMonitor.lastEvent.pokemon} · {phenoMonitor.lastEvent.locationZh||phenoMonitor.lastEvent.location}</strong><span>最近成功 {phenoMonitor.lastSuccessAt?new Date(phenoMonitor.lastSuccessAt).toLocaleString('zh-CN'):'暂无'}</span></>:<><strong>尚未发现奇遇</strong><span>{phenoMonitor.lastError||'等待第一次检查'}</span></>}</div></div>}
    {monitor?.lastError&&<p className="settings-error">头目监控提示：{monitor.lastError}</p>}
    {swarmMonitor?.lastError&&<p className="settings-error">群聚监控提示：{swarmMonitor.lastError}</p>}
    {phenoMonitor?.lastError&&<p className="settings-error">奇遇监控提示：{phenoMonitor.lastError}</p>}
    <div className="settings-heading"><span className="signal"><Bell size={19}/></span><div><h2>企业微信机器人</h2><p>审核通过的新情报会自动推送到企业微信群。</p></div></div>
    {status.configurationError&&<div className="alert" role="alert">已保存的机器人配置无法解密，请重新填写。</div>}
    {!status.canSaveWebhook&&<div className="alert" role="alert">服务器尚未配置 SETTINGS_ENCRYPTION_KEY，暂时不能从网页保存机器人。</div>}
    <div className="settings-status"><div><span>当前状态</span><strong>{status.enabled?'已启用':'已停用'}</strong></div><div><span>配置来源</span><strong>{status.source==='database'?'管理后台':status.source==='environment'?'服务器环境变量':'未配置'}</strong></div><div><span>机器人标识</span><strong>{status.masked||'无'}</strong></div></div>
    <form onSubmit={save}>
      <label className="toggle-row"><input type="checkbox" aria-label="启用企业微信推送" checked={enabled} onChange={event=>setEnabled(event.target.checked)}/><span>启用企业微信推送</span></label>
      <label className="field"><span>企业微信机器人 Webhook</span><input type="password" aria-label="企业微信机器人 Webhook" value={webhookUrl} onChange={event=>setWebhookUrl(event.target.value)} placeholder={status.configured?'留空表示保留当前机器人':'粘贴机器人 Webhook 地址'} disabled={!status.canSaveWebhook} autoComplete="new-password"/></label>
      <CategoryChoices prefix="主机器人" selected={primaryCategories} onChange={setPrimaryCategories} disabled={busy}/>
      <div className="settings-actions"><button className="button primary" disabled={busy||Boolean(webhookUrl&&!status.canSaveWebhook)}>保存设置</button><button type="button" className="button secondary" disabled={busy||!(status.primaryEnabled??status.enabled)} onClick={()=>void act(()=>request('/admin/settings/notifications/test',{method:'POST'}),'测试消息发送成功。')}><Send size={15}/>发送测试消息</button><button type="button" className="button danger" disabled={busy||status.source!=='database'} onClick={()=>void act(()=>request('/admin/settings/notifications/webhook',{method:'DELETE'}),'网页配置已清除。')}><Trash2 size={15}/>清除网页配置</button></div>
    </form>
    <div className="settings-heading"><span className="signal"><Bell size={19}/></span><div><h2>推送链接管理</h2><p>可添加多个企业微信机器人，每条新情报会分别发送。</p></div></div>
    <form onSubmit={addLink}>
      <label className="field"><span>链接名称</span><input aria-label="链接名称" value={linkLabel} onChange={event=>setLinkLabel(event.target.value)} required maxLength={30} placeholder="例如：主群、备用群"/></label>
      <label className="field"><span>新增机器人 Webhook</span><input type="password" aria-label="新增机器人 Webhook" value={linkUrl} onChange={event=>setLinkUrl(event.target.value)} required autoComplete="new-password" placeholder="粘贴企业微信机器人链接"/></label>
      <CategoryChoices prefix="新增链接" selected={linkCategories} onChange={setLinkCategories} disabled={busy}/>
      <div className="settings-actions"><button className="button primary" disabled={busy||!status.canSaveWebhook}>添加推送链接</button></div>
    </form>
    {links.length>0&&<div className="notification-link-list">{links.map(link=><div className="notification-link" key={link.id}><div><strong>{link.label}</strong><span>{link.masked||'配置无法解密'} · {link.enabled?'已启用':'已停用'}</span><CategoryChoices prefix={`${link.label}`} selected={link.categories??categories} disabled={busy} onChange={next=>{setLinks(current=>current.map(item=>item.id===link.id?{...item,categories:next}:item));void act(()=>request(`/admin/settings/notification-links/${link.id}`,{method:'PATCH',body:{categories:next}}),'接收类别已更新。');}}/></div><div className="settings-actions"><button type="button" className="button secondary" disabled={busy} onClick={()=>void act(()=>request(`/admin/settings/notification-links/${link.id}`,{method:'PATCH',body:{enabled:!link.enabled}}),link.enabled?'推送链接已停用。':'推送链接已启用。')}>{link.enabled?'停用':'启用'}</button><button type="button" className="button secondary" disabled={busy||!link.enabled} onClick={()=>void act(()=>request(`/admin/settings/notification-links/${link.id}/test`,{method:'POST'}),'测试消息发送成功。')}><Send size={15}/>测试</button><button type="button" className="button danger" disabled={busy} onClick={()=>void act(()=>request(`/admin/settings/notification-links/${link.id}`,{method:'DELETE'}),'推送链接已删除。')}><Trash2 size={15}/>删除</button></div></div>)}</div>}
    <div className="settings-metrics"><span>待发送 <strong>{status.counts.pending}</strong></span><span>已发送 <strong>{status.counts.sent}</strong></span><span>失败 <strong>{status.counts.failed}</strong></span></div>
    {status.lastError&&<p className="settings-error">最近错误：{status.lastError}</p>}
  </section>;
}
