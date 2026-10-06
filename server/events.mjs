import {pagination,parse,kind,region,ApiError,positiveId,beijingDateBounds,like} from './validation.mjs';
import {z} from 'zod';
import {translatePokemon} from './catalog.mjs';
import {translateLocation} from './location-zh.mjs';

export function expireEvents(db,at) {
  db.prepare("UPDATE events SET status='ended' WHERE status='active' AND expires_at<=?").run(at);
}
export function eventView(db,row) {
  if(!row)return null;
  return {id:row.id,kind:row.kind,pokemon:translatePokemon(db,row.pokemon),pokemonOriginal:row.pokemon,region:row.region,location:row.location,locationZh:translateLocation(row.location,row.region),
    observedAt:row.observed_at,expiresAt:row.expires_at,lastConfirmedAt:row.last_confirmed_at,
    status:row.status,source:row.source,sourceUrl:row.source_url,note:row.note,correctionReason:row.correction_reason,
    contributors:db.prepare("SELECT DISTINCT u.nickname FROM reports r JOIN users u ON u.id=r.user_id WHERE r.event_id=? AND r.status='approved' ORDER BY u.nickname").all(row.id)};
}
export function listEvents(db,query,history=false) {
  const {page,pageSize}=pagination(query);const where=[];const params=[];
  const parsed=parse(z.object({kind:kind.optional(),region:region.optional(),q:z.string().max(200).optional(),status:z.enum(['active','ended','corrected']).optional(),view:z.enum(['history']).optional(),dateFrom:z.string().optional(),dateTo:z.string().optional()}),query);
  if(!history&&parsed.view!=='history'){where.push('status=?');params.push('active');}
  if(parsed.status){where.push('status=?');params.push(parsed.status);}
  for(const key of ['kind','region'])if(parsed[key]){where.push(key+'=?');params.push(parsed[key]);}
  if(parsed.q){where.push("(pokemon LIKE ? ESCAPE '\\' OR location LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM pokemon_names pn WHERE pn.english_name=events.pokemon COLLATE NOCASE AND pn.chinese_name LIKE ? ESCAPE '\\'))");params.push(like(parsed.q),like(parsed.q),like(parsed.q));}
  if(parsed.dateFrom){where.push('observed_at>=?');params.push(beijingDateBounds(parsed.dateFrom));}
  if(parsed.dateTo){where.push('observed_at<?');params.push(beijingDateBounds(parsed.dateTo,true));}
  if(parsed.dateFrom&&parsed.dateTo&&parsed.dateFrom>parsed.dateTo)throw new ApiError(422,'开始日期不能晚于结束日期');
  const sqlWhere=where.length?' WHERE '+where.join(' AND '):'';
  const total=db.prepare('SELECT count(*) AS n FROM events'+sqlWhere).get(...params).n;
  const rows=db.prepare('SELECT * FROM events'+sqlWhere+' ORDER BY observed_at DESC,id DESC LIMIT ? OFFSET ?').all(...params,pageSize,(page-1)*pageSize);
  return {items:rows.map(row=>eventView(db,row)),total,page,pageSize};
}
export function registerEvents(app,{db,now,catalog}) {
  app.get('/api/v1/events',async request=>{expireEvents(db,new Date(now()).toISOString());return listEvents(db,request.query);});
  app.get('/api/v1/events/:id',async request=>{
    expireEvents(db,new Date(now()).toISOString());const row=db.prepare('SELECT * FROM events WHERE id=?').get(positiveId(request.params.id));
    if(!row)throw new ApiError(404,'情报不存在');return eventView(db,row);
  });
  app.get('/api/v1/status',async()=>({externalSourcesEnabled:Boolean(catalog?.enabled),demoMode:false,serverTime:new Date(now()).toISOString()}));
}
