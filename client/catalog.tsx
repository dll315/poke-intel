import {useCallback,useEffect,useState} from 'react';
import {ExternalLink,RefreshCw,Search} from 'lucide-react';
import {request} from './api';
import {regions,type CatalogEntry,type List} from './types';
import {Empty,Pagination} from './ui';

export function Catalog({onError}:{onError:(error:unknown)=>string}){
  const [items,setItems]=useState<List<CatalogEntry>>({items:[],total:0,page:1,pageSize:20});
  const [q,setQ]=useState('');const [kind,setKind]=useState('');const [region,setRegion]=useState('');
  const [applied,setApplied]=useState({q:'',kind:'',region:''});const [loading,setLoading]=useState(true);
  const load=useCallback(async(page=1,filters=applied)=>{setLoading(true);try{const params=new URLSearchParams({page:String(page),pageSize:'20'});Object.entries(filters).forEach(([key,value])=>value&&params.set(key,value));setItems(await request(`/catalog?${params}`));}catch(error){onError(error);}finally{setLoading(false);}},[applied,onError]);
  useEffect(()=>{void load();},[load]);
  const search=()=>{const next={q:q.trim(),kind,region};setApplied(next);const params=new URLSearchParams({view:'catalog'});Object.entries(next).forEach(([key,value])=>value&&params.set(key,value));history.replaceState(null,'',`?${params}`);};
  return <>
    <section className="filters catalog-filters"><form onSubmit={event=>{event.preventDefault();search();}}><div className="filter-main">
      <div className="search-box"><Search size={18}/><input aria-label="搜索资料" placeholder="搜索宝可梦或地点…" value={q} onChange={event=>setQ(event.target.value)} maxLength={100}/></div>
      <select aria-label="资料类型" value={kind} onChange={event=>setKind(event.target.value)}><option value="">全部类型</option><option value="boss">头目</option><option value="swarm">群聚</option></select>
      <select aria-label="资料地区" value={region} onChange={event=>setRegion(event.target.value)}><option value="">全部地区</option>{Object.entries(regions).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select>
      <button className="button primary" type="submit">搜索资料</button>
    </div></form></section>
    <div className="section-label"><h2>刷新地点资料 <span>{items.total}</span></h2><span>{loading?'正在读取…':'数据来源：Alphapedia'}</span></div>
    <section className="catalog-grid" aria-busy={loading}>{loading&&!items.items.length?<div className="loading-state"><RefreshCw size={22} className="spinning"/>正在读取资料库…</div>:items.items.length?items.items.map(item=><article className="catalog-card" key={item.id}>
      <div className="card-top"><span className={`tag ${item.kind}`}>{item.kind==='boss'?'头目':'群聚'}</span>{item.tier!==null&&<span className="catalog-tier">Tier {item.tier}</span>}</div>
      <h3>{item.pokemon}</h3><p className="catalog-original">{item.pokemonOriginal}</p><p className="catalog-dex">{item.nationalDex?`全国图鉴 #${item.nationalDex}`:'暂无图鉴编号'}</p>
      <dl><div><dt>地区</dt><dd>{regions[item.region]}</dd></div><div><dt>地点</dt><dd>{item.locationZh||item.location}</dd></div>{item.locationNote&&<div><dt>说明</dt><dd>{item.locationNote}</dd></div>}{item.hms.length>0&&<div><dt>所需秘传</dt><dd>{item.hms.join('、')}</dd></div>}{item.kind==='boss'&&item.moveset?.length>0&&<div><dt>来源资料配招</dt><dd>{item.moveset.join('、')}</dd></div>}</dl>
      <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">查看 Alphapedia 来源 <ExternalLink size={13}/></a>
    </article>):<Empty title="未找到资料" description="请更换宝可梦、地点或地区后重试。"/>}</section>
    <Pagination data={items} onPage={page=>void load(page)}/><p className="catalog-note">此处展示刷新地点参考资料，不代表当前正在发生的实时事件。请以游戏内情况为准。</p>
  </>;
}
