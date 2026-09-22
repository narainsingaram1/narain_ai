export function dayKey(value) {
  const day = new Date(value);
  return `${day.getFullYear()}-${String(day.getMonth()+1).padStart(2,'0')}-${String(day.getDate()).padStart(2,'0')}`;
}

export function fromDayKey(key) {
  const [year,month,day] = key.split('-').map(Number);
  const date = new Date(year,month-1,day);
  if (!year || !month || !day || dayKey(date)!==key) throw new Error('Invalid calendar date');
  return date;
}

export function addDays(key, amount) {
  const day=fromDayKey(key);
  day.setDate(day.getDate()+amount);
  return dayKey(day);
}

export function shiftPeriod(key,mode,amount) {
  const day=fromDayKey(key);
  if (mode==='week') day.setDate(day.getDate()+amount*7);
  else {
    const targetDay=day.getDate();
    day.setDate(1);
    day.setMonth(day.getMonth()+amount);
    const lastDay=new Date(day.getFullYear(),day.getMonth()+1,0).getDate();
    day.setDate(Math.min(targetDay,lastDay));
  }
  return dayKey(day);
}

export function visibleDays(key,mode='month') {
  const anchor=fromDayKey(key);
  if (mode==='month') anchor.setDate(1);
  anchor.setDate(anchor.getDate()-anchor.getDay());
  const first=fromDayKey(key);
  const monthDays=new Date(first.getFullYear(),first.getMonth()+1,0).getDate();
  const firstWeekday=new Date(first.getFullYear(),first.getMonth(),1).getDay();
  const count=mode==='week'?7:Math.max(35,Math.ceil((firstWeekday+monthDays)/7)*7);
  return Array.from({length:count},(_,index)=>addDays(dayKey(anchor),index));
}

export function eventOnDay(event,key) {
  if (!event.starts_at) return false;
  const start=new Date(event.starts_at).getTime();
  const end=event.ends_at?new Date(event.ends_at).getTime():start+1;
  const dayStart=fromDayKey(key).getTime();
  const dayEnd=fromDayKey(addDays(key,1)).getTime();
  return start<dayEnd&&end>dayStart;
}

export function moveEventDates(event,key) {
  if (!event.starts_at) throw new Error('Event has no start date');
  const oldStart=new Date(event.starts_at);
  const day=fromDayKey(key);
  const newStart=new Date(day.getFullYear(),day.getMonth(),day.getDate(),oldStart.getHours(),oldStart.getMinutes(),oldStart.getSeconds());
  const duration=event.ends_at?new Date(event.ends_at).getTime()-oldStart.getTime():null;
  return {starts_at:newStart.toISOString(),ends_at:duration===null?null:new Date(newStart.getTime()+duration).toISOString()};
}
