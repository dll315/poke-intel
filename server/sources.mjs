import {z} from 'zod';
import {parse,reportInput,dateTime,ApiError} from './validation.mjs';
import {insertReport} from './reports.mjs';
import {transaction} from './db.mjs';

// Callers must separately verify the provider's API and permission to republish.
// This boundary never fetches or scrapes a provider and is not enabled by the server.
export async function importSourceRecords(db,records,{enabled=false,permissionConfirmed=false,source,now=Date.now}={}) {
  if(!enabled||!permissionConfirmed)throw new Error('External source imports disabled / 外部来源未启用或未核实许可');
  if(typeof source!=='string'||!source.trim()||source.length>100)throw new ApiError(422,'必须指定已获许可的来源');
  const schema=reportInput.extend({source:z.literal(source),sourceEventId:z.string().min(1).max(200),expiresAt:dateTime,sourceUrl:z.string().url().max(2000).refine(v=>['https:','http:'].includes(new URL(v).protocol))}).strict();
  const validated=records.map(record=>parse(schema,record));
  return transaction(db,()=>{
    let imported=0;let skipped=0;
    for(const record of validated){
      // Keep provider identity as part of the idempotency key without exposing it as a source category.
      const sourceEventId=JSON.stringify([source,record.sourceEventId]);
      if(db.prepare("SELECT id FROM reports WHERE source='external' AND source_event_id=?").get(sourceEventId)){skipped++;continue;}
      if(record.expiresAt<=record.observedAt)throw new ApiError(422,'来源截止时间必须晚于观察时间');
      insertReport(db,record,{source:'external',sourceEventId,sourceUrl:record.sourceUrl,expiresAt:record.expiresAt,at:new Date(now()).toISOString()});imported++;
    }
    return {imported,skipped};
  });
}
