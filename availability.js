import {daySegments,remainingFor} from './schedule.js';
export const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow'}).format(new Date());
export const minutes=s=>Number(s.split(':')[0])*60+Number(s.split(':')[1]);
export const time=n=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
// Older masters without serviceIds retain access to every service.
export const canPerformService=(master,serviceId)=>!Array.isArray(master.serviceIds)||master.serviceIds.includes(serviceId);
export const mastersForService=(db,serviceId)=>(db.masters||[]).filter(m=>m.active&&canPerformService(m,serviceId));
export function slots(db,date,duration,except,masterId,serviceId){
 if(!Number.isInteger(db.settings.step)||db.settings.step<1||!Number.isInteger(duration)||duration<1||duration>1440)throw Object.assign(new Error('Некорректные настройки расписания. Проверьте шаг и длительность.'),{status:503});
 const s=db.settings,start=minutes(s.open),end=minutes(s.close),out=[],segments=daySegments(s,db.bookings,date,except);
 const pool=serviceId&&(db.masters||[]).length?mastersForService(db,serviceId).filter(m=>!masterId||m.id===masterId):null;
 if(pool&&!pool.length)return [];
 const busy=(id,n)=>db.bookings.some(b=>b.id!==except&&b.masterId===id&&b.date===date&&b.start!=null&&['pending','proposed','confirmed','in_progress','completed'].includes(b.status)&&b.start<n+duration&&b.start+b.duration>n);
 if(s.days.includes(new Date(date+'T12:00:00Z').getUTCDay()))for(let n=start;n+duration<=end;n+=s.step){
  const free=pool?.filter(m=>!busy(m.id,n));
  const remaining=Math.min(remainingFor(segments,n,duration),pool?free.length:masterId&&busy(masterId,n)?0:Infinity),past=Date.parse(`${date}T${time(n)}:00+03:00`)<=Date.now();
  out.push({time:time(n),start:n,masterId:free?.[0]?.id||masterId||'',available:remaining>0&&!past,remaining:past?0:remaining,reason:past?'past':remaining===0?'capacity':null});
 }
 return out;
}
