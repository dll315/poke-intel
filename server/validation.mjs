import {z} from 'zod';

export const kind=z.enum(['boss','swarm','pheno']);
export const region=z.enum(['kanto','johto','hoenn','sinnoh','unova']);
export const dateTime=z.string().datetime({offset:true}).transform(v=>new Date(v).toISOString());
const text=(max,min=1)=>z.string().trim().min(min).max(max);
const username=z.string().trim().min(3).max(30).regex(/^[a-zA-Z0-9_-]+$/,'用户名只能包含英文字母、数字、下划线和短横线').transform(v=>v.toLowerCase());
export const credentials=z.object({username,password:z.string().min(1).max(128)}).strict();
const account=z.object({username,nickname:text(30),password:z.string().min(10).max(128)}).strict();
export const registration=account.refine(v=>v.username!=='admin',{path:['username'],message:'该用户名不可注册'});
export const adminRegistration=account.extend({password:z.string().min(6).max(128)});
const phenomenonNames={grass:'草丛摇动',dust:'尘土',water:'水面波纹',shadow:'飞行阴影'};
export const reportBaseInput=z.object({kind,pokemon:text(50,0),region,location:text(100),observedAt:dateTime,note:text(1000,0).default(''),phenomenonType:z.enum(['grass','dust','water','shadow']).optional()}).strict();
export const reportInput=reportBaseInput.superRefine((value,context)=>{
  if(value.kind==='pheno'){
    if(value.region!=='unova')context.addIssue({code:'custom',path:['region'],message:'奇遇只可上报合众地区'});
    if(!value.phenomenonType)context.addIssue({code:'custom',path:['phenomenonType'],message:'请选择奇遇形式'});
  }else{
    if(!value.pokemon)context.addIssue({code:'custom',path:['pokemon'],message:'请填写宝可梦名称'});
    if(value.phenomenonType)context.addIssue({code:'custom',path:['phenomenonType'],message:'仅奇遇情报可填写奇遇形式'});
  }
}).transform(({phenomenonType,...value})=>value.kind==='pheno'?{
  ...value,pokemon:value.pokemon||'未知宝可梦',
  note:`${phenomenonNames[phenomenonType]}奇遇${value.note?'；'+value.note:''}`,
}:value);
export const reviewInput=z.object({action:z.enum(['approve','reject']),reason:text(500).optional(),expiresAt:dateTime.optional()}).strict();
export const eventInput=z.object({kind:kind.optional(),pokemon:text(50).optional(),region:region.optional(),location:text(100).optional(),note:text(1000,0).optional(),expiresAt:dateTime.optional(),status:z.enum(['active','ended','corrected']).optional(),correctionReason:text(500).optional()}).strict().refine(v=>Object.keys(v).length>0,{message:'至少填写一个修改项'});
export const userInput=z.object({disabled:z.boolean()}).strict();
export class ApiError extends Error {
  constructor(statusCode,message,fields){super(message);this.statusCode=statusCode;this.fields=fields;}
}
export function parse(schema,input) {
  const parsed=schema.safeParse(input);
  if(!parsed.success){
    const fields={};
    for(const issue of parsed.error.issues){
      let message=issue.message;
      if(issue.code==='invalid_type')message='请填写正确格式的内容';
      else if(issue.code==='too_small')message=issue.origin==='string'?`至少填写 ${issue.minimum} 个字符`:`不得小于 ${issue.minimum}`;
      else if(issue.code==='too_big')message=issue.origin==='string'?`最多填写 ${issue.maximum} 个字符`:`不得超过 ${issue.maximum}`;
      else if(issue.code==='invalid_value')message='请选择有效选项';
      else if(issue.code==='invalid_format')message=issue.format==='datetime'?'请输入有效日期和时间':'填写格式不正确';
      else if(issue.code==='unrecognized_keys')message='包含不支持的字段';
      fields[issue.path.join('.')||'form']=message;
    }
    throw new ApiError(422,'请检查填写内容',fields);
  }
  return parsed.data;
}
export function pagination(query) {
  return parse(z.object({page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(20)}),query);
}
export function positiveId(value) {return parse(z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),value);}
export function beijingDateBounds(date,end=false) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new ApiError(422,'日期格式不正确',{[end?'dateTo':'dateFrom']:'使用 YYYY-MM-DD'});
  const ms=Date.parse(date+'T00:00:00+08:00');
  if(!Number.isFinite(ms)||new Date(ms+8*3600000).toISOString().slice(0,10)!==date)throw new ApiError(422,'日期不存在');
  return new Date(ms+(end?86400000:0)).toISOString();
}
export function like(value){return '%'+value.replace(/[\\%_]/g,'\\$&')+'%';}
