import {z} from 'zod';
import {parse,reviewInput,eventInput,userInput,pagination,positiveId,ApiError,like} from './validation.mjs';
import {transaction,audit} from './db.mjs';
import {listReports,reportView} from './reports.mjs';
import {listEvents,eventView,expireEvents} from './events.mjs';
import {safeUser} from './auth.mjs';
import {validateWecomWebhook} from './notifications.mjs';

const notificationSettingsInput=z.object({enabled:z.boolean(),webhookUrl:z.string().max(1000).refine(value=>{try{validateWecomWebhook(value);return true;}catch{return false;}},'企业微信 Webhook 地址无效').optional()}).strict();

export function registerAdmin(app,{db,now,notifications,settings}) {
  app.get('/api/v1/admin/notifications',async()=>notifications.status());
  app.get('/api/v1/admin/settings/notifications',async()=>({...settings.getNotificationStatus(),...notifications.status()}));
  app.put('/api/v1/admin/settings/notifications',async request=>settings.saveNotificationConfig(parse(notificationSettingsInput,request.body),request.user.id));
  app.delete('/api/v1/admin/settings/notifications/webhook',async request=>settings.clearNotificationWebhook(request.user.id));
  app.post('/api/v1/admin/settings/notifications/test',async()=>notifications.sendTest());
  app.get('/api/v1/admin/reports',async request=>listReports(db,request.query,undefined,true));
  app.get('/api/v1/admin/events',async request=>{expireEvents(db,new Date(now()).toISOString());return listEvents(db,request.query,true);});
  app.post('/api/v1/admin/reports/:id/review',async request=>{
    const input=parse(reviewInput,request.body);const id=positiveId(request.params.id);const at=new Date(now()).toISOString();
    if(input.action==='reject'&&!input.reason)throw new ApiError(422,'请填写驳回理由',{reason:'驳回理由必填'});
    return transaction(db,()=>{
      expireEvents(db,at);const report=db.prepare('SELECT * FROM reports WHERE id=?').get(id);
      if(!report)throw new ApiError(404,'上报不存在');
      if(report.status!=='pending'){
        if(report.status===(input.action==='approve'?'approved':'rejected'))return {report:reportView(db,report),event:eventView(db,report.event_id?db.prepare('SELECT * FROM events WHERE id=?').get(report.event_id):null)};
        throw new ApiError(409,'该上报已审核');
      }
      let eventId=null;
      if(input.action==='approve'){
        const expiresAt=input.expiresAt||report.suggested_expires_at||new Date(Date.parse(report.observed_at)+3600000).toISOString();
        if(expiresAt<=report.observed_at)throw new ApiError(422,'截止时间必须晚于观察时间',{expiresAt:'截止时间必须晚于观察时间'});
        const low=new Date(Date.parse(report.observed_at)-15*60000).toISOString();const high=new Date(Date.parse(report.observed_at)+15*60000).toISOString();
        const existing=db.prepare("SELECT * FROM events WHERE kind=? AND pokemon=? AND region=? AND location=? AND status='active' AND observed_at>=? AND observed_at<=? ORDER BY observed_at DESC,id DESC LIMIT 1")
          .get(report.kind,report.pokemon,report.region,report.location,low,high);
        if(existing){
          eventId=existing.id;
          db.prepare('UPDATE events SET last_confirmed_at=?,expires_at=? WHERE id=?').run(existing.last_confirmed_at>report.observed_at?existing.last_confirmed_at:report.observed_at,existing.expires_at>expiresAt?existing.expires_at:expiresAt,eventId);
        }else{
          const result=db.prepare('INSERT INTO events(kind,pokemon,region,location,observed_at,expires_at,last_confirmed_at,status,source,source_url,note) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
            .run(report.kind,report.pokemon,report.region,report.location,report.observed_at,expiresAt,report.observed_at,expiresAt>at?'active':'ended',report.source,report.source_url,report.note);
          eventId=Number(result.lastInsertRowid);
          if(expiresAt>at)notifications.enqueueEvent(eventId);
        }
      }
      const status=input.action==='approve'?'approved':'rejected';
      db.prepare('UPDATE reports SET status=?,reason=?,event_id=? WHERE id=?').run(status,input.action==='reject'?input.reason:null,eventId,id);
      audit(db,request.user.id,'report.'+input.action,'report',id,{reason:input.reason||null,eventId},at);
      return {report:reportView(db,db.prepare('SELECT * FROM reports WHERE id=?').get(id)),event:eventView(db,eventId?db.prepare('SELECT * FROM events WHERE id=?').get(eventId):null)};
    });
  });
  app.patch('/api/v1/admin/events/:id',async request=>{
    const input=parse(eventInput,request.body);const id=positiveId(request.params.id);const at=new Date(now()).toISOString();
    return transaction(db,()=>{
      expireEvents(db,at);const row=db.prepare('SELECT * FROM events WHERE id=?').get(id);if(!row)throw new ApiError(404,'情报不存在');
      if(input.status==='corrected'&&!input.correctionReason&&!row.correction_reason)throw new ApiError(422,'请填写纠错说明',{correctionReason:'纠错说明必填'});
      const expiresAt=input.expiresAt||row.expires_at;
      if(expiresAt<=row.observed_at)throw new ApiError(422,'截止时间必须晚于观察时间',{expiresAt:'截止时间必须晚于观察时间'});
      let status=input.status||row.status;
      if(status==='active'&&expiresAt<=at)status='ended';
      const updated={kind:input.kind||row.kind,pokemon:input.pokemon||row.pokemon,region:input.region||row.region,location:input.location||row.location,note:input.note??row.note,expiresAt,status,correctionReason:input.correctionReason??row.correction_reason};
      db.prepare('UPDATE events SET kind=?,pokemon=?,region=?,location=?,note=?,expires_at=?,status=?,correction_reason=? WHERE id=?')
        .run(updated.kind,updated.pokemon,updated.region,updated.location,updated.note,updated.expiresAt,updated.status,updated.correctionReason,id);
      audit(db,request.user.id,'event.edit','event',id,{before:row,after:updated},at);
      return eventView(db,db.prepare('SELECT * FROM events WHERE id=?').get(id));
    });
  });
  app.get('/api/v1/admin/users',async request=>{
    const {page,pageSize}=pagination(request.query);const q=parse(z.string().max(200).optional(),request.query.q);const params=q?[like(q),like(q)]:[];
    const where=q?" WHERE email LIKE ? ESCAPE '\\' OR nickname LIKE ? ESCAPE '\\'":'';
    const total=db.prepare('SELECT count(*) AS n FROM users'+where).get(...params).n;
    const items=db.prepare('SELECT * FROM users'+where+' ORDER BY id DESC LIMIT ? OFFSET ?').all(...params,pageSize,(page-1)*pageSize).map(safeUser);
    return {items,total,page,pageSize};
  });
  app.patch('/api/v1/admin/users/:id',async request=>{
    const input=parse(userInput,request.body);const id=positiveId(request.params.id);
    return transaction(db,()=>{
      const row=db.prepare('SELECT * FROM users WHERE id=?').get(id);if(!row)throw new ApiError(404,'账号不存在');
      if(input.disabled&&row.role==='admin'&&!row.disabled&&db.prepare("SELECT count(*) AS n FROM users WHERE role='admin' AND disabled=0").get().n<=1)throw new ApiError(409,'不能停用最后一位管理员');
      db.prepare('UPDATE users SET disabled=?,session_generation=session_generation+? WHERE id=?').run(input.disabled?1:0,input.disabled?1:0,id);
      if(input.disabled)db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
      audit(db,request.user.id,input.disabled?'user.disable':'user.enable','user',id,{disabled:input.disabled},new Date(now()).toISOString());
      return safeUser(db.prepare('SELECT * FROM users WHERE id=?').get(id));
    });
  });
}
