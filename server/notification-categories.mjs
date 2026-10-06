export const notificationCategories=['boss','swarm','player','pheno'];

export function normalizeCategories(value){
  if(!Array.isArray(value)||value.some(item=>!notificationCategories.includes(item)))throw new Error('推送类别无效');
  return notificationCategories.filter(item=>value.includes(item));
}

export function categoryForEvent(event){
  if(event.source==='player')return 'player';
  return event.kind;
}
