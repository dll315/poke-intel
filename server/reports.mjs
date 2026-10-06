import {parse,reportInput,pagination,beijingDateBounds,ApiError} from './validation.mjs';
import {z} from 'zod';
import {transaction} from './db.mjs';
import {translateLocation} from './location-zh.mjs';

export function reportView(db,row) {
  if(!row)return null;
  const reporter=row.user_id?db.prepare('SELECT nickname FROM users WHERE id=?').get(row.user_id):{nickname:'外部来源'};
  return {id:row.id,kind:row.kind,pokemon:row.pokemon,region:row.region,location:row.location,locationZh:translateLocation(row.location,row.region),observedAt:row.observed_at,note:row.note,status:row.status,reason:row.reason,eventId:row.event_id,source:row.source,sourceUrl:row.source_url,createdAt:row.created_at,reporter};
}
export function listReports(db,query,userId,defaultPending=false) {
  const {page,pageSize}=pagination(query);const status=parse(z.enum(['pending','approved','rejected']).optional(),query.status||(defaultPending?'pending':undefined));
  const where=[];const params=[];
  if(userId!==undefined){where.push('user_id=?');params.push(userId);}
  if(status){where.push('status=?');params.push(status);}
  const sqlWhere=where.length?' WHERE '+where.join(' AND '):'';
  const total=db.prepare('SELECT count(*) AS n FROM reports'+sqlWhere).get(...params).n;
  const rows=db.prepare('SELECT * FROM reports'+sqlWhere+' ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?').all(...params,pageSize,(page-1)*pageSize);
  return {items:rows.map(row=>reportView(db,row)),total,page,pageSize};
}
export function validateObservation(observedAt,now) {
  if(Date.parse(observedAt)>now||Date.parse(observedAt)<now-24*3600000)throw new ApiError(422,'观察时间必须在过去 24 小时内',{observedAt:'不能填写未来或超过 24 小时的时间'});
}
export function insertReport(db,data,{userId=null,source='player',sourceEventId=null,sourceUrl=null,expiresAt=null,at}) {
  const result=db.prepare('INSERT INTO reports(user_id,kind,pokemon,region,location,observed_at,note,source,source_url,source_event_id,suggested_expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(userId,data.kind,data.pokemon,data.region,data.location,data.observedAt,data.note,source,sourceUrl,sourceEventId,expiresAt,at);
  return reportView(db,db.prepare('SELECT * FROM reports WHERE id=?').get(Number(result.lastInsertRowid)));
}
export function registerReports(app,{db,now}) {
  app.get('/api/v1/reports/mine',async request=>listReports(db,request.query,request.user.id));
  app.post('/api/v1/reports',async(request,reply)=>{
    const data=parse(reportInput,request.body);const timestamp=now();const at=new Date(timestamp).toISOString();validateObservation(data.observedAt,timestamp);
    const result=transaction(db,()=>{
      const count=(since)=>db.prepare('SELECT count(*) AS n FROM reports WHERE user_id=? AND created_at>=?').get(request.user.id,since).n;
      if(count(new Date(timestamp-60000).toISOString())>=3)throw new ApiError(429,'每分钟最多上报 3 次，请稍后再试');
      const date=new Date(timestamp+8*3600000).toISOString().slice(0,10);
      if(count(beijingDateBounds(date))>=50)throw new ApiError(429,'今天已达到 50 次上报上限');
      return insertReport(db,data,{userId:request.user.id,at});
    });reply.code(201);return result;
  });
}
