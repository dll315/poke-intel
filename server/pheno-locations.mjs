import {transaction} from './db.mjs';
import {translateArea,translateDetail} from './location-zh.mjs';

const types={Grass:'grass',Dust:'dust',Water:'water',Shadow:'shadow'};
const sourceUrl='https://alpha.pokemmotools.org/pheno-list';

export function normalizePhenoLocations(data){
  if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('Alphapedia 奇遇地点数据无效');
  const rows=[];const seen=new Set();
  for(const [area,entries] of Object.entries(data)){
    if(!area||area.length>100||!entries||typeof entries!=='object')continue;
    for(const [sourceType,group] of Object.entries(entries)){
      const type=types[sourceType];if(!type||!Array.isArray(group?.['Specific Locations']))continue;
      for(const point of group['Specific Locations']){
        const detail=String(point?.['Specific Location']||'').trim();if(!detail||detail.length>100)continue;
        const key=JSON.stringify([area,type,detail]);if(seen.has(key))continue;seen.add(key);
        let mapUrl=null;try{const url=new URL(point?.['Map Link']);if(url.protocol==='https:')mapUrl=url.href;}catch{}
        rows.push({area,type,detail,mapUrl});
      }
    }
  }
  if(!rows.length)throw new Error('Alphapedia 奇遇地点列表为空');
  return rows;
}

export function createPhenoLocations({db,now=Date.now,enabled=false,permissionConfirmed=false,baseUrl='https://alpha.pokemmotools.org',fetchImpl=globalThis.fetch,intervalMs=60*60*1000}={}){
  const active=enabled&&permissionConfirmed;let timer=null,refreshing=null,lastError='';
  async function refresh(){
    if(!active)throw new Error('Alphapedia 奇遇地点资料未启用');
    if(refreshing)return refreshing;
    refreshing=(async()=>{
      let payload;
      for(let attempt=0;attempt<2;attempt++){
        try{const response=await fetchImpl(new URL('/api/pheno-spawn-data',baseUrl),{headers:{accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(20000)});if(!response.ok)throw new Error(`Alphapedia 奇遇地点请求失败 (${response.status})`);payload=await response.json();break;}
        catch(error){if(attempt===1)throw error;}
      }
      const rows=normalizePhenoLocations(payload),syncedAt=new Date(now()).toISOString();
      transaction(db,()=>{db.exec('DELETE FROM pheno_locations');const insert=db.prepare('INSERT INTO pheno_locations(area,type,detail,map_url,synced_at) VALUES(?,?,?,?,?)');for(const row of rows)insert.run(row.area,row.type,row.detail,row.mapUrl,syncedAt);});
      lastError='';return{imported:rows.length};
    })().catch(error=>{lastError=String(error?.message||error).slice(0,200);throw error;}).finally(()=>{refreshing=null;});return refreshing;
  }
  function list(){return{enabled:active,sourceUrl,lastSyncedAt:db.prepare('SELECT max(synced_at) at FROM pheno_locations').get().at,lastError,items:db.prepare('SELECT area,type,detail,map_url mapUrl FROM pheno_locations ORDER BY area,type,detail').all().map(row=>({...row,areaZh:translateArea(row.area),detailZh:translateDetail(row.detail)}))};}
  function start(){if(!active||timer)return;void refresh().catch(()=>{});timer=setInterval(()=>void refresh().catch(()=>{}),intervalMs);timer.unref();}
  function close(){if(timer)clearInterval(timer);timer=null;}
  return{enabled:active,refresh,list,start,close};
}
