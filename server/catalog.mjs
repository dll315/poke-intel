import {ApiError} from './validation.mjs';
import {transaction} from './db.mjs';
import {translateLocation} from './location-zh.mjs';

const defaultBaseUrl='https://alpha.pokemmotools.org';
const regionIds={kanto:'kanto',johto:'johto',hoenn:'hoenn',sinnoh:'sinnoh',unova:'unova'};
const endpoints=[['boss','/api/alpha-spawn-data','/alpha-list'],['swarm','/api/swarm-spawn-data','/swarm-list']];

export function translatePokemon(db,value){
  const name=String(value||'');return db.prepare('SELECT chinese_name FROM pokemon_names WHERE english_name=? COLLATE NOCASE').get(name)?.chinese_name||name;
}
export function translateMove(db,value){
  const name=String(value||'');return db.prepare('SELECT chinese_name FROM move_names WHERE english_name=? COLLATE NOCASE').get(name)?.chinese_name||name;
}

function normalize(data,kind,sourceUrl,natdex,names,syncedAt){
  const rows=[];
  for(const [regionName,locations] of Object.entries(data||{})){
    const region=regionIds[String(regionName).toLowerCase()];if(!region||!locations||typeof locations!=='object')continue;
    for(const [fallbackLocation,entries] of Object.entries(locations))for(const entry of Array.isArray(entries)?entries:[]){
      const details=entry?.data||{};const pokemon=String(entry?.name||'').trim();
      const location=String(details['Specific Location']||fallbackLocation||'').trim();if(!pokemon||!location)continue;
      const dex=natdex[String(pokemon).toLowerCase().replace(/[^a-z0-9]/g,'')] ?? null;
      const sourceKey=JSON.stringify([kind,region,location,pokemon]);
      const moveset=Array.isArray(details.Moveset)?details.Moveset.filter(move=>typeof move==='string'&&move.trim()&&move.length<=60).slice(0,8):[];
      rows.push({kind,pokemon,pokemonZh:String(names[pokemon]||''),region,location,locationNote:String(details['Location Notes']||''),tier:Number.isInteger(details.Tier)?details.Tier:null,nationalDex:Number.isInteger(dex)?dex:null,hms:Array.isArray(details.HMs)?details.HMs.map(String):[],moveset,valuable:Boolean(details.HasValuable),source:'Alphapedia',sourceUrl,sourceKey,syncedAt});
    }
  }
  return rows;
}

export function createCatalog({db,now=Date.now,enabled=false,permissionConfirmed=false,baseUrl=defaultBaseUrl,fetchImpl=globalThis.fetch,autoStart=true,intervalMs=60*1000}={}){
  const active=enabled&&permissionConfirmed;let timer=null;let refreshing=null;let lastError='';
  async function fetchJson(path){
    for(let attempt=0;attempt<2;attempt++){
      try{
        const response=await fetchImpl(new URL(path,baseUrl),{headers:{accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(20000)});
        if(!response.ok){const error=new Error(`Alphapedia 请求失败 (${response.status})`);error.retryable=response.status===429||response.status>=500;throw error;}
        return await response.json();
      }catch(error){if(attempt===1||error.retryable===false)throw error;}
    }
  }
  async function refresh(){
    if(!active)throw new Error('Alphapedia catalog disabled / 外部资料库未启用或未核实许可');
    if(refreshing)return refreshing;
    refreshing=(async()=>{
      const alpha=await fetchJson(endpoints[0][1]);const swarm=await fetchJson(endpoints[1][1]);const natdex=await fetchJson('/api/pokemon-natdex-map');const names=await fetchJson('/static/translations/zh/pokemon-species-zh.json');const moveNames=await fetchJson('/static/translations/zh/move-zh.json').catch(()=>null);
      const syncedAt=new Date(now()).toISOString();const rows=[...normalize(alpha,'boss',new URL('/alpha-list',baseUrl).href,natdex,names,syncedAt),...normalize(swarm,'swarm',new URL('/swarm-list',baseUrl).href,natdex,names,syncedAt)];
      transaction(db,()=>{db.exec('DELETE FROM external_catalog; DELETE FROM pokemon_names');const nameInsert=db.prepare('INSERT INTO pokemon_names(english_name,chinese_name,synced_at) VALUES(?,?,?)');for(const [english,chinese] of Object.entries(names||{}))if(String(english).trim()&&String(chinese).trim())nameInsert.run(String(english),String(chinese),syncedAt);if(moveNames&&typeof moveNames==='object'&&!Array.isArray(moveNames)&&Object.keys(moveNames).length){db.exec('DELETE FROM move_names');const moveInsert=db.prepare('INSERT OR IGNORE INTO move_names(english_name,chinese_name,synced_at) VALUES(?,?,?)');for(const [english,chinese] of Object.entries(moveNames))if(typeof chinese==='string'&&english.trim()&&english.length<=80&&chinese.trim()&&chinese.length<=80)moveInsert.run(english,chinese,syncedAt);}const insert=db.prepare('INSERT INTO external_catalog(kind,pokemon,pokemon_zh,region,location,location_note,tier,national_dex,hms,moveset,valuable,source,source_url,source_key,synced_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');for(const row of rows)insert.run(row.kind,row.pokemon,row.pokemonZh||null,row.region,row.location,row.locationNote,row.tier,row.nationalDex,JSON.stringify(row.hms),JSON.stringify(row.moveset),row.valuable?1:0,row.source,row.sourceUrl,row.sourceKey,row.syncedAt);});
      lastError='';return{imported:rows.length,total:rows.length};
    })().catch(error=>{lastError=String(error?.message||error).slice(0,300);throw error;}).finally(()=>{refreshing=null;});return refreshing;
  }
  function start(){if(!active||timer)return;void refresh().catch(()=>{});timer=setInterval(()=>void refresh().catch(()=>{}),intervalMs);timer.unref();}
  function close(){if(timer)clearInterval(timer);timer=null;}
  function list(query={}){
    const page=Math.max(1,Number(query.page)||1),pageSize=Math.min(100,Math.max(1,Number(query.pageSize)||20));const where=[],params=[];
    if(query.kind){if(!['boss','swarm'].includes(query.kind))throw new ApiError(422,'资料类型无效');where.push('kind=?');params.push(query.kind);}
    if(query.region){if(!regionIds[String(query.region)])throw new ApiError(422,'地区无效');where.push('region=?');params.push(query.region);}
    if(query.q){const q=String(query.q).trim();if(q.length>100)throw new ApiError(422,'搜索内容过长');where.push('(pokemon LIKE ? OR pokemon_zh LIKE ? OR location LIKE ?)');params.push(`%${q}%`,`%${q}%`,`%${q}%`);}
    const clause=where.length?' WHERE '+where.join(' AND '):'';const total=db.prepare('SELECT count(*) n FROM external_catalog'+clause).get(...params).n;
    const rows=db.prepare('SELECT * FROM external_catalog'+clause+' ORDER BY region,location,pokemon LIMIT ? OFFSET ?').all(...params,pageSize,(page-1)*pageSize);
    return{items:rows.map(row=>{const movesetOriginal=JSON.parse(row.moveset);return{id:row.id,kind:row.kind,pokemon:row.pokemon_zh||row.pokemon,pokemonOriginal:row.pokemon,region:row.region,location:row.location,locationZh:translateLocation(row.location,row.region),locationNote:row.location_note,tier:row.tier,nationalDex:row.national_dex,hms:JSON.parse(row.hms),moveset:movesetOriginal.map(move=>translateMove(db,move)),movesetOriginal,valuable:Boolean(row.valuable),source:row.source,sourceUrl:row.source_url,syncedAt:row.synced_at};}),total,page,pageSize};
  }
  return{enabled:active,refresh,start,close,list,status:()=>({enabled:active,total:db.prepare('SELECT count(*) n FROM external_catalog').get().n,lastSyncedAt:db.prepare('SELECT max(synced_at) at FROM external_catalog').get().at,lastError})};
}
