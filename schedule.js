const activeStatuses=new Set(['pending','proposed','confirmed','in_progress','completed']);
const minutes=value=>Number(value.split(':')[0])*60+Number(value.split(':')[1]);
export const capacityOf=settings=>Math.max(1,Math.floor(Number(settings.capacity)||1));
// Half-open intervals: a booking ending at 11:00 leaves 11:00 available.
// Split at every start/end so consecutive bookings don't count as simultaneous.
export function daySegments(settings,bookings,date,except){
 const start=minutes(settings.open),end=minutes(settings.close);
 if(!settings.days.includes(new Date(date+'T12:00:00Z').getUTCDay()))return [];
 const active=bookings.filter(b=>b.start!==null&&b.start!==undefined&&b.id!==except&&b.date===date&&activeStatuses.has(b.status))
  .map(b=>({start:Number(b.start),end:Number(b.start)+Number(b.duration)}))
  .filter(b=>Number.isFinite(b.start)&&Number.isFinite(b.end)&&b.end>start&&b.start<end);
 const boundaries=[...new Set([start,end,...active.flatMap(b=>[Math.max(start,b.start),Math.min(end,b.end)])])].sort((a,b)=>a-b);
 const segments=[];
 for(let i=0;i<boundaries.length-1;i++){
  const start=boundaries[i],end=boundaries[i+1],occupied=active.filter(b=>b.start<end&&b.end>start).length;
  segments.push({start,end,occupied,remaining:Math.max(0,capacityOf(settings)-occupied)});
 }
 return segments;
}
export function remainingFor(segments,start,duration){
 const end=start+duration,overlap=segments.filter(s=>s.start<end&&s.end>start);
 if(!overlap.length||start<segments[0].start||end>segments.at(-1).end)return 0;
 return Math.min(...overlap.map(s=>s.remaining));
}
export function freeWindows(settings,bookings,date){
 const windows=[];
 for(const segment of daySegments(settings,bookings,date)){
  if(!segment.remaining)continue;
  const last=windows.at(-1);
  if(last&&last.end===segment.start&&last.remaining===segment.remaining)last.end=segment.end;
  else windows.push({...segment});
 }
 return windows;
}
