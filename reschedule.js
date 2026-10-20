import {slots,time,today,canPerformService} from './availability.js';
export const canReschedule=booking=>['pending','proposed','confirmed'].includes(booking.status);
export function rescheduleBooking(db,booking,date,requestedTime){
 const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
 if(!canReschedule(booking))fail('Можно перенести только запись, по которой работы еще не начались');
 if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||date<today()||date>new Date(Date.now()+180*86400000).toISOString().slice(0,10))fail('Выберите дату в ближайшие 180 дней');
 if(typeof requestedTime!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(requestedTime))fail('Выберите время записи');
 if(booking.masterId&&!(db.masters||[]).some(m=>m.id===booking.masterId&&m.active&&canPerformService(m,booking.serviceId)))fail('Мастер не принимает эту услугу. Сначала назначьте доступного мастера');
 const slot=slots(db,date,booking.duration,booking.id,booking.masterId).find(s=>s.available&&s.time===requestedTime);
 if(!slot)fail('Это время недоступно. Выберите другое свободное окно.',409);
 if(date===booking.date&&slot.start===booking.start)return {ok:true,changed:false};
 const previous=booking.date+' '+(booking.start==null?'без времени':time(booking.start));
 booking.date=date;booking.start=slot.start;
 booking.messages??=[];booking.messages.push({from:'admin',text:'Администратор перенес запись с '+previous+' на '+date+' '+requestedTime+'.',at:new Date().toISOString()});
 return {ok:true,changed:true};
}
