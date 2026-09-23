import { dayKey, fromDayKey, addDays, shiftPeriod, visibleDays, eventOnDay, moveEventDates } from './calendar.js';

const $ = s => document.querySelector(s);
const themeQuery = matchMedia('(prefers-color-scheme: light)');
const themeModes = new Set(['system', 'light', 'dark']);
function storedTheme() {
  try {
    const value = localStorage.getItem('orbit-theme');
    return themeModes.has(value) ? value : 'system';
  } catch {
    return 'system';
  }
}
function applyTheme(mode = storedTheme()) {
  const selected = themeModes.has(mode) ? mode : 'system';
  const resolved = selected === 'system' ? (themeQuery.matches ? 'light' : 'dark') : selected;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themeMode = selected;
  const selector = $('#theme-select');
  if (selector) selector.value = selected;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'light' ? '#f6f8fc' : '#0d0e14');
}
applyTheme();

const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function getChatSessionId() {
  try {
    let id = localStorage.getItem('orbit-chat-session');
    if (!id) {
      id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : 'session_' + Math.random().toString(36).slice(2);
      localStorage.setItem('orbit-chat-session', id);
    }
    return id;
  } catch {
    return 'default-session';
  }
}
const state = { areas:[], classes:[], items:[], view:'today', area:null, filter:'open', editing:null, entryType:'task', editingClass:null, calendarMode:'month', selectedDay:dayKey(new Date()), planDay:dayKey(new Date()), movingEventId:null,collapsedTaskGroups:new Set(),chat:[],agentBusy:false,agentRun:null,aiSettings:null,sessionId:getChatSessionId() };
const labels = {today:'Today',plan:'Daily plan',tasks:'Tasks',calendar:'Calendar',notes:'Notes',journal:'Journal',goals:'Goals',assistant:'Ask Orbit'};
const singular = {tasks:'task',plan:'event',notes:'note',journal:'journal',goals:'goal',calendar:'event'};
const dateKey = dayKey;
const fmtDate = d => d ? new Date(d).toLocaleDateString(undefined,{month:'short',day:'numeric'}) : '';
const fmtTime = d => d ? new Date(d).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'}) : '';
const localInput = d => {if(!d)return '';const instant=new Date(d);return new Date(instant.getTime()-instant.getTimezoneOffset()*60000).toISOString().slice(0,16)};
const fullDate = d => new Date(d).toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'});
let toastTimer;
function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),3300)}
async function api(path,options={}){const res=await fetch(path,{...options,headers:{'Content-Type':'application/json',...options.headers}});const data=await res.json();if(!res.ok)throw new Error(data.error||'Request failed');return data}
async function loadAiSettings() {
  try {
    const data = await api('/api/settings');
    state.aiSettings = data;
    const label = $('#ai-provider-label');
    if (label) label.textContent = `${data.provider} (${data.model})`;
    if ($('#ai-active-provider')) $('#ai-active-provider').value = data.active_provider || '';
    if ($('#ai-openrouter-model') && !$('#ai-openrouter-model').value) $('#ai-openrouter-model').value = data.openrouter_model || '';
    if ($('#ai-ollama-model') && !$('#ai-ollama-model').value) $('#ai-ollama-model').value = data.model || 'qwen3.5:4b';
  } catch {}
}
async function loadChatHistory() {
  try {
    const history = await api(`/api/chat/history?session_id=${encodeURIComponent(state.sessionId)}`);
    if (Array.isArray(history) && history.length && !state.chat.length) {
      state.chat = history.map(item => ({
        kind: item.role === 'user' ? 'user' : 'answer',
        message: item.content,
        sources: item.sources || [],
        changes: [],
        proposal: null
      }));
      renderChat();
    }
  } catch {}
}
async function refresh(){const data=await api('/api/state');state.areas=data.areas;state.classes=data.classes;state.items=data.items;await loadAiSettings();await loadChatHistory();render();if($('#editor').open)renderClassOptions($('#entry-class').value);if($('#classes-dialog').open)renderClasses()}
function area(id){return state.areas.find(a=>a.id===id)}
function isAcademic(id){return area(id)?.name==='Academics'}
function renderClassOptions(selected=''){const select=$('#entry-class');select.innerHTML='<option value="">No class</option>'+state.classes.map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');select.value=state.classes.some(c=>c.id===selected)?selected:''}
function showClassField(){const academic=isAcademic($('#entry-area').value);$('#class-field').classList.toggle('hidden',!academic);if(!academic)$('#entry-class').value=''}
function renderClasses(){const list=$('#classes-list');list.innerHTML=state.classes.length?state.classes.map(c=>`<div class="class-row"><strong>${escapeHtml(c.name)}</strong><div><button type="button" data-class-edit="${c.id}" aria-label="Rename ${escapeHtml(c.name)}">Rename</button><button type="button" data-class-delete="${c.id}" aria-label="Remove ${escapeHtml(c.name)}">Remove</button></div></div>`).join(''):empty('No classes yet. Add your first class below.')}
function openClasses(){state.editingClass=null;$('#class-form').reset();$('#class-name-label').firstChild.textContent='Add a class';$('#save-class').textContent='Add class';$('#cancel-class-edit').classList.add('hidden');renderClasses();$('#classes-dialog').showModal()}
function areaTag(item){const a=area(item.area_id);return a?`<span class="badge"><span class="tag-dot" style="background:${a.color}"></span>${escapeHtml(a.name)}</span>`:''}
function itemDate(item){return item.due_at||item.starts_at||item.created_at}
function isOverdue(item){return item.type==='task'&&item.status==='open'&&item.due_at&&new Date(item.due_at)<new Date()}
function filtered(type){return state.items.filter(x=>x.type===type&&x.status!=='archived'&&(!state.area||x.area_id===state.area))}
function taskSort(a,b){const due=(a.due_at||'9999').localeCompare(b.due_at||'9999');if(due)return due;const parentTitle=item=>state.items.find(x=>x.id===(item.parent_id||item.id))?.title||item.title;const group=parentTitle(a).localeCompare(parentTitle(b),undefined,{numeric:true});if(group)return group;if(a.parent_id!==b.parent_id)return a.parent_id?1:-1;return a.title.localeCompare(b.title,undefined,{numeric:true})}

function taskSummary(collection) {
  const noun = collection.length === 1 ? 'task' : 'tasks';
  const done = collection.filter(item => item.status === 'done').length;
  return collection.length + ' ' + noun + (state.filter === 'all' && done ? ' · ' + done + ' done' : '');
}
function taskSubgroups(group) {
  if (group.area?.name !== 'Academics') {
    return '<div class="task-group-rows">' + group.tasks.map(taskRow).join('') + '</div>';
  }
  const subgroups = new Map();
  for (const item of group.tasks) {
    const label = item.class_name?.trim() || 'Unassigned class';
    const key = item.class_id || 'class:' + label;
    if (!subgroups.has(key)) subgroups.set(key, { label, tasks:[] });
    subgroups.get(key).tasks.push(item);
  }
  return [...subgroups.values()]
    .sort((a,b) => {
      if (a.label === 'Unassigned class') return 1;
      if (b.label === 'Unassigned class') return -1;
      return a.label.localeCompare(b.label);
    })
    .map(subgroup => '<section class="task-subgroup"><div class="task-subgroup-head"><span class="task-subgroup-title"><span class="subgroup-marker" aria-hidden="true">↳</span><strong>' + escapeHtml(subgroup.label) + '</strong></span><span class="task-subgroup-summary">' + taskSummary(subgroup.tasks) + '</span></div>' + subgroup.tasks.map(taskRow).join('') + '</section>')
    .join('');
}
function taskView() {
  const items = filtered('task')
    .filter(item => state.filter === 'all' || item.status === state.filter)
    .sort(taskSort);
  const groups = new Map();
  for (const item of items) {
    const selectedArea = area(item.area_id);
    const key = selectedArea?.id || 'unassigned-area';
    if (!groups.has(key)) groups.set(key, { key, area:selectedArea, tasks:[] });
    groups.get(key).tasks.push(item);
  }
  const areaOrder = new Map(state.areas.map((entry,index) => [entry.id,index]));
  const orderedGroups = [...groups.values()].sort((a,b) => {
    const aOrder = a.area ? (areaOrder.get(a.area.id) ?? 999) : 999;
    const bOrder = b.area ? (areaOrder.get(b.area.id) ?? 999) : 999;
    return aOrder - bOrder || (a.area?.name || 'Unassigned').localeCompare(b.area?.name || 'Unassigned');
  });
  const groupsMarkup = orderedGroups.map(group => {
    const collapsed = state.collapsedTaskGroups.has(group.key);
    const label = group.area?.name || 'Unassigned area';
    const color = group.area?.color || '#9aa3b2';
    const description = group.area?.name === 'Academics' ? 'Organized by class' : 'Life area';
    return '<section class="task-group' + (collapsed ? ' is-collapsed' : '') + '" data-task-group="' + escapeHtml(group.key) + '">' +
      '<button type="button" class="task-group-header" data-group-toggle="' + escapeHtml(group.key) + '" aria-expanded="' + (!collapsed) + '">' +
      '<span class="task-group-heading"><span class="group-color-dot" style="background:' + color + '"></span><span><strong>' + escapeHtml(label) + '</strong><small>' + description + '</small></span></span>' +
      '<span class="task-group-summary">' + taskSummary(group.tasks) + '<span class="group-chevron" aria-hidden="true">⌄</span></span></button>' +
      '<div class="task-group-body">' + taskSubgroups(group) + '</div></section>';
  }).join('');
  return '<div class="hero"><div><div class="eyebrow">' + (state.area ? escapeHtml(area(state.area)?.name || 'LIFE AREA') : 'YOUR WORKSPACE') + '</div><h1 class="page-title">Tasks<span style="color:#a797f6">.</span></h1><p class="muted section-desc">Keep deadlines, classes, and next actions in one place—organized by life area.</p></div></div>' +
    '<div class="list-toolbar task-list-toolbar"><div class="filters"><button class="filter ' + (state.filter === 'open' ? 'active' : '') + '" data-filter="open">Open</button><button class="filter ' + (state.filter === 'done' ? 'active' : '') + '" data-filter="done">Done</button><button class="filter ' + (state.filter === 'all' ? 'active' : '') + '" data-filter="all">All</button></div>' +
    '<div class="task-toolbar-right"><span class="task-count muted">' + items.length + ' ' + (items.length === 1 ? 'task' : 'tasks') + '</span><button class="tiny-link" data-new="task">+ Add task</button></div></div>' +
    '<div class="task-grouping-note"><span class="grouping-icon" aria-hidden="true">↳</span><span>Grouped by <strong>life area</strong>' + (state.area ? '' : ' · Academics is organized by class') + '</span></div>' +
    '<div class="task-groups">' + (items.length ? groupsMarkup : empty('Nothing here yet. Add a task to get started.')) + '</div>';
}
function empty(message){return `<div class="empty"><span class="empty-icon">✧</span>${message}</div>`}
function taskRow(item){return `<div class="item-row ${item.status==='done'?'done':''}"><button class="check ${item.status==='done'?'checked':''}" data-toggle="${item.id}" aria-label="${item.status==='done'?'Mark incomplete':'Complete task'}">${item.status==='done'?'✓':''}</button><div class="item-main"><div class="item-title" data-edit="${item.id}">${escapeHtml(item.title)}</div><div class="item-meta">${areaTag(item)}${item.class_name?`<span class="badge course">${escapeHtml(item.class_name)}</span>`:''}${item.parent_title?`<span class="badge">↳ ${escapeHtml(item.parent_title)}</span>`:''}${item.due_at?`<span class="badge ${isOverdue(item)?'warn':''}">${isOverdue(item)?'Overdue · ':''}${fmtDate(item.due_at)}</span>`:''}<span>${escapeHtml(item.priority)} priority</span></div></div><div class="row-actions"><button data-edit="${item.id}" title="Edit">✎</button><button data-delete="${item.id}" title="Delete">×</button></div></div>`}
function renderNav(){document.querySelectorAll('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.view===state.view&&!state.area));$('#areas-nav').innerHTML=state.areas.map(a=>`<button class="area-link ${state.area===a.id?'active':''}" data-area="${a.id}"><span class="area-dot" style="background:${a.color}"></span>${escapeHtml(a.name)}</button>${a.name==='Academics'&&state.area===a.id?`<button class="class-manage-link" data-manage-classes>Manage classes · ${state.classes.length}</button>`:''}`).join('');$('#crumb-current').textContent=state.area?area(state.area)?.name||'Area':labels[state.view];$('#new-main').innerHTML=state.view==='plan'?'+ &nbsp; Add block':'+ &nbsp; New entry'}
function todayView(){const tasks=filtered('task').filter(x=>x.status==='open');const dueToday=tasks.filter(x=>x.due_at&&dateKey(x.due_at)===dateKey(new Date()));const overdue=tasks.filter(isOverdue);const attentionCount=new Set([...dueToday,...overdue].map(x=>x.id)).size;const upcoming=[...tasks].sort(taskSort).slice(0,5);const events=filtered('event').filter(x=>x.starts_at&&new Date(x.starts_at)>=new Date(new Date().setHours(0,0,0,0))).sort((a,b)=>a.starts_at.localeCompare(b.starts_at)).slice(0,4);const goals=filtered('goal').filter(x=>x.status==='open').slice(0,3);const focus=overdue[0]||dueToday[0]||upcoming[0];return `<div class="hero"><div><div class="eyebrow">YOUR DAY, CLEARLY</div><h1 class="page-title">Good ${new Date().getHours()<12?'morning':new Date().getHours()<17?'afternoon':'evening'}<span style="color:#a797f6">.</span></h1><p class="muted">A calmer place for everything that matters.</p></div><div class="date-pill">✦ &nbsp; ${fullDate(new Date())}</div></div><div class="stat-row"><div class="stat"><div class="number">${tasks.length}</div><small>Open tasks</small></div><div class="stat"><div class="number">${attentionCount}</div><small>Due or overdue</small></div><div class="stat"><div class="number">${goals.length}</div><small>Active goals</small></div></div><div class="dashboard-grid"><div class="stack"><section class="card focus-card"><div class="eyebrow">✧ &nbsp; YOUR NEXT MOVE</div><h2>${focus?escapeHtml(focus.title):'You have a clear runway.'}</h2><p>${focus?`${focus.class_name?escapeHtml(focus.class_name)+' · ':''}${focus.due_at?(isOverdue(focus)?'Overdue since ':'Due ')+fmtDate(focus.due_at):'Ready whenever you are.'}`:'Add your first task and Orbit will keep it in view.'}</p><button class="focus-action" ${focus?`data-edit="${focus.id}"`:'data-new="task"'}>${focus?'Open task →':'Add a task →'}</button></section><section class="card"><div class="card-head"><h2>Up next</h2><button class="tiny-link" data-view="tasks">View all →</button></div>${upcoming.length?upcoming.map(taskRow).join(''):empty('No open tasks. Add one to start planning your day.')}</section></div><div class="stack"><section class="card"><div class="card-head"><h2>On your calendar</h2><button class="tiny-link" data-view="calendar">View all →</button></div>${events.length?events.map(x=>`<div class="mini-item" data-edit="${x.id}"><strong>${escapeHtml(x.title)}</strong><small>${fmtDate(x.starts_at)} · ${fmtTime(x.starts_at)}${x.class_name?' · '+escapeHtml(x.class_name):''}</small></div>`).join(''):empty('No upcoming events yet.')}</section><section class="card"><div class="card-head"><h2>Goals in motion</h2><button class="tiny-link" data-view="goals">View all →</button></div>${goals.length?goals.map(x=>`<div class="mini-item" data-edit="${x.id}"><strong>${escapeHtml(x.title)}</strong><small>${escapeHtml(x.area_name||'Uncategorized')}${x.due_at?' · target '+fmtDate(x.due_at):''}</small></div>`).join(''):empty('Add a goal to connect today with the long term.')}</section><section class="card"><div class="card-head"><h2>Your data</h2></div><p class="muted">Your entries live in a SQLite file on this Mac. Export a readable backup anytime.</p><a class="tiny-link" href="/api/export">Download backup →</a></section></div></div>`}
function calendarView() {
  const selected=state.selectedDay;
  const selectedDate=fromDayKey(selected);
  const events=filtered('event').filter(event=>event.starts_at).sort((a,b)=>a.starts_at.localeCompare(b.starts_at));
  const days=visibleDays(selected,state.calendarMode);
  const selectedEvents=events.filter(event=>eventOnDay(event,selected));
  const monthName=selectedDate.toLocaleDateString(undefined,{month:'long',year:'numeric'});
  const weekEnd=fromDayKey(days[6]);
  const periodTitle=state.calendarMode==='month'?monthName:`${fromDayKey(days[0]).toLocaleDateString(undefined,{month:'short',day:'numeric'})} – ${weekEnd.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})}`;
  const today=dayKey(new Date());
  const cells=days.map(key=>{
    const day=fromDayKey(key);
    const dayEvents=events.filter(event=>eventOnDay(event,key));
    const outside=state.calendarMode==='month'&&day.getMonth()!==selectedDate.getMonth();
    const chips=dayEvents.slice(0,3).map(event=>{
      const color=area(event.area_id)?.color||'#a797f6';
      const startsHere=dayKey(event.starts_at)===key;
      return `<button type="button" class="calendar-chip" data-cal-event="${event.id}" style="--event-color:${color}" title="${escapeHtml(event.title)} · Drag to move or click to edit"><span class="calendar-chip-time">${startsHere?fmtTime(event.starts_at):'↔'}</span><span class="calendar-chip-title">${escapeHtml(event.title)}</span></button>`;
    }).join('');
    return `<div class="calendar-cell ${outside?'outside':''} ${key===selected?'selected':''} ${key===today?'today':''} ${state.movingEventId?'move-target':''}" data-cal-day="${key}"><div class="calendar-cell-top"><button type="button" class="calendar-date" data-cal-day="${key}" aria-label="${fullDate(day)}${dayEvents.length?`, ${dayEvents.length} ${dayEvents.length===1?'event':'events'}`:''}">${day.getDate()}</button><button type="button" class="calendar-day-add" data-cal-add="${key}" aria-label="Add event on ${fullDate(day)}" title="Add event">+</button></div><div class="calendar-cell-events">${chips}${dayEvents.length>3?`<span class="calendar-more">+${dayEvents.length-3} more</span>`:''}</div>${dayEvents.length?`<span class="calendar-mobile-count">${dayEvents.length}</span>`:''}</div>`;
  }).join('');
  const agenda=selectedEvents.length?selectedEvents.map(event=>{
    const color=area(event.area_id)?.color||'#a797f6';
    const startLabel=dayKey(event.starts_at)===selected?fmtTime(event.starts_at):'Continues from earlier';
    return `<article class="agenda-event" style="--event-color:${color}"><div class="agenda-time">${startLabel}</div><button type="button" class="agenda-event-title" data-cal-event="${event.id}">${escapeHtml(event.title)}</button><div class="agenda-event-meta">${event.ends_at?`Ends ${dayKey(event.ends_at)===selected?fmtTime(event.ends_at):fmtDate(event.ends_at)+' · '+fmtTime(event.ends_at)}`:''}${event.area_name?` · ${escapeHtml(event.area_name)}`:''}${event.class_name?` · ${escapeHtml(event.class_name)}`:''}</div><div class="agenda-actions"><button type="button" data-cal-event="${event.id}">Edit</button><button type="button" data-cal-move="${event.id}">Move date</button></div></article>`;
  }).join(''):empty('Nothing scheduled for this day. Click + to add an event.');
  return `<div class="hero calendar-hero"><div><div class="eyebrow">YOUR WORKSPACE</div><h1 class="page-title">Calendar<span style="color:#a797f6">.</span></h1><p class="muted">See your time at a glance. Click a day to plan it.</p></div><button class="primary-button" data-cal-add="${selected}">+ &nbsp; New event</button></div><div class="calendar-toolbar"><div class="calendar-navigation"><button class="calendar-arrow" data-cal-nav="-1" aria-label="Previous ${state.calendarMode}">‹</button><button class="calendar-arrow" data-cal-nav="1" aria-label="Next ${state.calendarMode}">›</button><h2>${periodTitle}</h2><button class="calendar-today-button" data-cal-today>Today</button></div><div class="calendar-mode"><button class="${state.calendarMode==='month'?'active':''}" data-cal-mode="month">Month</button><button class="${state.calendarMode==='week'?'active':''}" data-cal-mode="week">Week</button></div></div>${state.movingEventId?`<div class="calendar-move-banner">Choose a new day for <strong>${escapeHtml(state.items.find(x=>x.id===state.movingEventId)?.title||'this event')}</strong>. The time stays the same.<button data-cal-cancel>Cancel</button></div>`:''}<div class="calendar-layout"><section class="calendar-board"><div class="calendar-weekdays">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(day=>`<span>${day}</span>`).join('')}</div><div class="calendar-grid ${state.calendarMode}">${cells}</div></section><aside class="calendar-agenda"><div class="agenda-heading"><div><div class="eyebrow">SELECTED DAY</div><h2>${selectedDate.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'})}</h2></div><button class="agenda-add" data-cal-add="${selected}" aria-label="Add event on selected day">+</button></div><div class="agenda-count">${selectedEvents.length} ${selectedEvents.length===1?'event':'events'}</div>${agenda}<div class="calendar-hint">Tip: drag an event to another day, or use Move date.</div></aside></div>`;
}


const planPeriods = [
  {key:'morning',label:'Morning',range:'5:00 AM – 12:00 PM',addHour:9},
  {key:'afternoon',label:'Afternoon',range:'12:00 PM – 5:00 PM',addHour:13},
  {key:'evening',label:'Evening',range:'5:00 PM – 9:00 PM',addHour:18},
  {key:'night',label:'Night',range:'9:00 PM – 5:00 AM',addHour:21}
];
function planPeriodFor(event) {
  const hour = new Date(event.starts_at).getHours();
  return hour < 5 ? 'night' : hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 21 ? 'evening' : 'night';
}
function planBlock(event) {
  const startsToday = dayKey(event.starts_at) === state.planDay;
  const startLabel = startsToday ? fmtTime(event.starts_at) : 'Continues';
  const endLabel = event.ends_at ? (dayKey(event.ends_at) === state.planDay ? fmtTime(event.ends_at) : fmtDate(event.ends_at)) : 'Open-ended';
  const tags = areaTag(event) + (event.class_name ? '<span class="badge course">' + escapeHtml(event.class_name) + '</span>' : '');
  return '<button type="button" class="plan-block" data-edit="' + event.id + '"><span class="plan-block-time"><strong>' + startLabel + '</strong><small>' + (event.ends_at ? 'to ' + endLabel : 'Open-ended') + '</small></span><span class="plan-block-main"><strong class="plan-block-title">' + escapeHtml(event.title) + '</strong><span class="plan-block-meta">' + tags + '</span>' + (event.body ? '<span class="plan-block-notes">' + escapeHtml(event.body) + '</span>' : '') + '</span><span class="plan-block-arrow" aria-hidden="true">›</span></button>';
}
function planView() {
  const selected = state.planDay;
  const selectedDate = fromDayKey(selected);
  const events = filtered('event')
    .filter(event => event.starts_at && eventOnDay(event, selected))
    .sort((a,b) => new Date(a.starts_at) - new Date(b.starts_at));
  const dueTasks = filtered('task')
    .filter(item => item.due_at && dayKey(item.due_at) === selected)
    .sort((a,b) => (a.due_at || '').localeCompare(b.due_at || ''));
  const sections = planPeriods.map(period => {
    const periodEvents = events.filter(event => planPeriodFor(event) === period.key);
    return '<section class="plan-period"><header class="plan-period-header"><div class="plan-period-title"><span class="plan-period-mark" aria-hidden="true">' + (period.key === 'morning' ? '☼' : period.key === 'afternoon' ? '◒' : period.key === 'evening' ? '☾' : '✦') + '</span><span><strong>' + period.label + '</strong><small>' + period.range + '</small></span></div><button type="button" class="plan-period-add" data-plan-add="' + period.addHour + '">+ Add</button></header><div class="plan-blocks">' + (periodEvents.length ? periodEvents.map(planBlock).join('') : '<div class="plan-empty"><span>Nothing planned yet</span><button type="button" data-plan-add="' + period.addHour + '">+ Add a block</button></div>') + '</div></section>';
  }).join('');
  const openTasks = dueTasks.filter(item => item.status === 'open').length;
  const taskSummaryText = dueTasks.length ? dueTasks.length + ' ' + (dueTasks.length === 1 ? 'task' : 'tasks') : 'No tasks due';
  return '<div class="hero plan-hero"><div><div class="eyebrow">DESIGN YOUR DAY</div><h1 class="page-title">Daily plan<span style="color:#a797f6">.</span></h1><p class="muted">Shape the day in blocks you can actually see, then adjust as life changes.</p></div><button class="primary-button" data-plan-add="9">+ &nbsp; Add block</button></div><div class="plan-toolbar"><div class="plan-navigation"><button type="button" class="plan-nav-button" data-plan-nav="-1" aria-label="Previous day">‹</button><button type="button" class="plan-nav-button" data-plan-nav="1" aria-label="Next day">›</button><h2>' + selectedDate.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric',year:'numeric'}) + '</h2><button type="button" class="plan-today-button" data-plan-today>Today</button></div><label class="plan-date-picker">Jump to date<input type="date" data-plan-date value="' + selected + '"></label></div><div class="plan-layout"><section class="plan-timeline">' + sections + '</section><aside class="plan-sidebar"><section class="plan-sidebar-card"><div class="card-head"><h2>Day at a glance</h2><span class="badge">' + (events.length ? events.length + ' ' + (events.length === 1 ? 'block' : 'blocks') : 'Open day') + '</span></div><div class="plan-stat-grid"><div class="plan-stat"><strong>' + events.length + '</strong><small>Schedule blocks</small></div><div class="plan-stat"><strong>' + openTasks + '</strong><small>Open due tasks</small></div><div class="plan-stat"><strong>' + dueTasks.filter(item => item.status === 'done').length + '</strong><small>Completed</small></div></div></section><section class="plan-sidebar-card"><div class="card-head"><h2>Due this day</h2><span class="muted">' + taskSummaryText + '</span></div>' + (dueTasks.length ? dueTasks.map(taskRow).join('') : '<div class="plan-sidebar-empty">No due tasks. Keep the day focused.</div>') + '</section><section class="plan-sidebar-card plan-help"><div class="eyebrow">A SIMPLE RHYTHM</div><h2>Plan the shape, not every minute.</h2><p>Add a block, give it a time when useful, and keep the details in the block itself. Open-ended events work well for flexible plans.</p></section></aside></div>';
}

function listView(type){const title=labels[state.view];let items=filtered(type);if(type==='task')items=items.filter(x=>state.filter==='all'||x.status===state.filter).sort((a,b)=>(a.due_at||'9999').localeCompare(b.due_at||'9999'));const intro={task:'Keep deadlines, classes, and next actions in one place.',note:'Save ideas, class notes, and useful context.',journal:'Reflect and see what your days are really like.',goal:'Give your longer plans a home.',event:'See what is coming up on your own calendar.'}[type];let content='';if(type==='task')content=`<div class="list-toolbar"><div class="filters"><button class="filter ${state.filter==='open'?'active':''}" data-filter="open">Open</button><button class="filter ${state.filter==='done'?'active':''}" data-filter="done">Done</button><button class="filter ${state.filter==='all'?'active':''}" data-filter="all">All</button></div><button class="tiny-link" data-new="task">+ Add task</button></div><div class="card list-card">${items.length?items.map(taskRow).join(''):empty('Nothing here yet. Add a task to get started.')}</div>`;
else if(type==='event')content=`<div class="list-toolbar"><span class="muted">${items.length} events</span><button class="tiny-link" data-new="event">+ Add event</button></div><div class="calendar-list">${items.length?items.sort((a,b)=>(a.starts_at||'').localeCompare(b.starts_at||'')).map(x=>`<div class="event-card" data-edit="${x.id}"><div class="event-date"><strong>${new Date(x.starts_at).getDate()}</strong><small>${new Date(x.starts_at).toLocaleDateString(undefined,{month:'short'})}</small></div><div class="event-body"><strong>${escapeHtml(x.title)}</strong><small>${fmtTime(x.starts_at)}${x.ends_at?' – '+fmtTime(x.ends_at):''}${x.class_name?' · '+escapeHtml(x.class_name):''}</small></div>${areaTag(x)}</div>`).join(''):empty('No events yet. Build your schedule by adding one.')}</div>`;
else content=`<div class="list-toolbar"><span class="muted">${items.length} ${title.toLowerCase()} ${items.length===1?'entry':'entries'}</span><button class="tiny-link" data-new="${type}">+ Add ${type}</button></div><div class="note-grid">${items.length?items.map(x=>`<article class="note-card ${type==='goal'?'goal-card':''}" data-edit="${x.id}"><div class="note-icon">${type==='journal'?'✎':type==='goal'?'◎':'▤'}</div><strong>${escapeHtml(x.title)}</strong><p>${escapeHtml(x.body||'No details yet')}</p><footer>${escapeHtml(x.area_name||'Uncategorized')} · ${fmtDate(itemDate(x))}</footer></article>`).join(''):empty(`No ${title.toLowerCase()} yet. Capture your first one.`)}</div>`;
return `<div class="hero"><div><div class="eyebrow">${state.area?escapeHtml(area(state.area)?.name||'LIFE AREA'):'YOUR WORKSPACE'}</div><h1 class="page-title">${title}<span style="color:#a797f6">.</span></h1><p class="muted section-desc">${intro}</p></div></div>${content}`}
function assistantView(){const badgeText=state.aiSettings?`${escapeHtml(state.aiSettings.provider)} · ${escapeHtml(state.aiSettings.model)}`:'Local workspace · Ollama';return '<div class="hero agent-hero"><div class="agent-hero-copy"><div class="eyebrow">LOCAL WORKSPACE AGENT</div><h1 class="page-title">Ask Orbit<span style="color:#a797f6">.</span></h1><p class="muted">A private workspace agent for finding records, shaping plans, and making careful changes.</p></div><div class="agent-hero-badge" data-open-ai-settings style="cursor:pointer;" title="Click to configure AI Engine"><span class="agent-hero-orb" aria-hidden="true">✦</span><div><strong>'+(state.aiSettings?.has_groq?'Free Cloud Accelerated':state.aiSettings?.has_openrouter?'Cloud Accelerated':'Private & Unlimited')+'</strong><small>'+badgeText+' ⚙</small></div></div></div><div class="assistant-layout agent-layout"><section class="card ask-card agent-card"><header class="agent-header"><div class="agent-avatar" aria-hidden="true"><span>✦</span><i></i></div><div class="agent-header-copy"><h2>Workspace agent</h2><p>Grounded in the records you saved here</p></div><span class="agent-local-badge"><span class="agent-status-dot"></span>'+(state.agentBusy?'Working':'Ready')+'</span></header><div id="agent-activity" class="agent-activity" aria-live="polite"></div><div id="chat-log" class="chat-log" aria-live="polite">'+(state.chat.length?state.chat.map(chatMarkup).join(''):'<div class="chat-bubble answer welcome-bubble"><div class="markdown-content"><p>Tell me what you want to find, plan, or change.</p><ul><li>Ask about deadlines or focus</li><li>Ask me to create or update records</li><li>Review a change before it is applied</li></ul></div></div>')+'</div><form id="ask-form" class="ask-form"><div class="agent-input-wrap"><span aria-hidden="true">⌘</span><input name="question" maxlength="500" required placeholder="Ask Orbit to find, plan, or change something…" aria-label="Ask Orbit"></div><button class="primary-button" type="submit">Ask Orbit <span aria-hidden="true">↗</span></button></form></section><aside class="card agent-side-card"><div class="card-head"><div><div class="eyebrow">SHORTCUTS</div><h2>Start with something specific</h2></div><span class="badge">Local</span></div><div class="suggestions agent-suggestions"><button data-ask="What should I focus on today?"><span class="suggestion-icon">✦</span><span><strong>Focus for today</strong><small>Surface the work that deserves attention</small></span><b>↗</b></button><button data-ask="Break down Project 2 into four milestones"><span class="suggestion-icon">⌘</span><span><strong>Break down a project</strong><small>Turn one task into linked milestones</small></span><b>↗</b></button><button data-ask="Show my open CS 2110 tasks"><span class="suggestion-icon">⌕</span><span><strong>Find a set of records</strong><small>Search across tasks, notes, and events</small></span><b>↗</b></button></div><div class="agent-side-divider"></div><div class="agent-flow"><div><span>01</span><strong>Orbit reads</strong><small>Searches your saved workspace first.</small></div><div><span>02</span><strong>Orbit reasons</strong><small>Uses tools to verify exact records.</small></div><div><span>03</span><strong>You stay in control</strong><small>Grouped changes wait for your approval.</small></div></div><div class="agent-privacy"><span>◉</span><p><strong>Nothing leaves this Mac.</strong><small>Orbit uses your local records and local model connection.</small></p></div></aside></div>'}
function render(){renderNav();$('#content').innerHTML=state.view==='today'?todayView():state.view==='assistant'?assistantView():state.view==='calendar'?calendarView():state.view==='plan'?planView():`${isAcademic(state.area)?`<div class="academic-tools"><span>${state.classes.length} ${state.classes.length===1?'class':'classes'} in Academics</span><button data-manage-classes>Manage classes →</button></div>`:''}${state.view==="tasks"?taskView():listView(singular[state.view])}`;renderAgentActivity();setAgentBusyUI()}
function navigate(view,areaId=null){state.view=view;state.area=areaId;render();window.scrollTo(0,0)}
function toggleFields(){const type=state.entryType;$('#date-label').firstChild.textContent=type==='event'?'Starts at':type==='goal'?'Target date':'Due date';$('#date-label').classList.toggle('hidden',['note','journal'].includes(type));$('#end-label').classList.toggle('hidden',type!=='event');$('#priority-label').classList.toggle('hidden',type!=='task');document.querySelectorAll('#type-row button').forEach(b=>b.classList.toggle('selected',b.dataset.type===type));$('#entry-title').placeholder={task:'What needs to get done?',event:'What is happening?',note:'What is this note about?',journal:'How was your day?',goal:'What are you working toward?'}[type]}
function openEditor(type='task',item=null,day=null,hour=9){state.editing=item?.id||null;state.entryType=item?.type||type;$('#entry-form').reset();$('#entry-area').innerHTML='<option value="">No area</option>'+state.areas.map(a=>`<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');$('#dialog-title').textContent=item?'Edit entry':'New entry';$('#entry-title').value=item?.title||'';$('#entry-body').value=item?.body||'';$('#entry-area').value=item?.area_id||state.area||'';renderClassOptions(item?.class_id||'');showClassField();$('#entry-priority').value=item?.priority||'medium';$('#entry-date').value=localInput(item?.type==='event'?item?.starts_at:item?.due_at);$('#entry-end').value=localInput(item?.ends_at);if(type==='event'&&!item){const planDate=state.view==='plan'?state.planDay:dayKey(new Date());const start=fromDayKey(day||(state.view==='calendar'?state.selectedDay:planDate));start.setHours(hour,0,0,0);$('#entry-date').value=localInput(start);$('#entry-end').value=localInput(new Date(start.getTime()+3600000))}toggleFields();$('#editor').showModal();$('#entry-title').focus()}
async function saveEntry(e){e.preventDefault();const type=state.entryType;const date=$('#entry-date').value;const end=$('#entry-end').value;const payload={type,title:$('#entry-title').value,body:$('#entry-body').value,area_id:$('#entry-area').value||null,class_id:isAcademic($('#entry-area').value)?$('#entry-class').value||null:null,course:'',priority:$('#entry-priority').value,due_at:type==='event'?null:date?new Date(date).toISOString():null,starts_at:type==='event'&&date?new Date(date).toISOString():null,ends_at:type==='event'&&end?new Date(end).toISOString():null};try{await api(state.editing?`/api/items/${state.editing}`:'/api/items',{method:state.editing?'PATCH':'POST',body:JSON.stringify(payload)});if(type==='event'&&date){const createdDay=dayKey(new Date(date));if(state.view==='calendar')state.selectedDay=createdDay;if(state.view==='plan')state.planDay=createdDay;}$('#editor').close();await refresh();toast(state.editing?'Entry updated':'Entry saved')}catch(err){toast(err.message)}}
async function moveEventToDay(id,key){const event=state.items.find(x=>x.id===id&&x.type==='event');if(!event)return;if(dayKey(event.starts_at)===key){state.movingEventId=null;state.selectedDay=key;render();return}try{await api(`/api/items/${id}`,{method:'PATCH',body:JSON.stringify(moveEventDates(event,key))});state.movingEventId=null;state.selectedDay=key;await refresh();toast('Event moved to '+fullDate(fromDayKey(key)))}catch(err){toast(err.message)}}
async function toggleTask(id){const item=state.items.find(x=>x.id===id);if(!item)return;try{await api(`/api/items/${id}`,{method:'PATCH',body:JSON.stringify({status:item.status==='done'?'open':'done'})});await refresh()}catch(err){toast(err.message)}}
async function deleteItem(id){const item=state.items.find(x=>x.id===id);if(!item||!confirm(`Delete “${item.title}”? This cannot be undone.`))return;try{await api(`/api/items/${id}`,{method:'DELETE'});await refresh();toast('Entry deleted')}catch(err){toast(err.message)}}
async function saveClass(e){e.preventDefault();const name=$('#class-name').value.trim();if(!name)return;try{const saved=await api(state.editingClass?`/api/classes/${state.editingClass}`:'/api/classes',{method:state.editingClass?'PATCH':'POST',body:JSON.stringify({name})});const wasEditing=Boolean(state.editingClass);state.editingClass=null;$('#class-form').reset();$('#class-name-label').firstChild.textContent='Add a class';$('#save-class').textContent='Add class';$('#cancel-class-edit').classList.add('hidden');await refresh();if($('#editor').open&&isAcademic($('#entry-area').value))$('#entry-class').value=saved.id;toast(wasEditing?'Class renamed':'Class added')}catch(err){toast(err.message)}}
async function removeClass(id){const found=state.classes.find(c=>c.id===id);if(!found)return;const count=state.items.filter(x=>x.class_id===id).length;if(!confirm(`Remove “${found.name}”? ${count} linked ${count===1?'entry':'entries'} will stay, but will no longer have a class.`))return;try{await api(`/api/classes/${id}`,{method:'DELETE'});await refresh();toast('Class removed; entries kept')}catch(err){toast(err.message)}}

function inlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/\x60([^\x60\n]+)\x60/g,'<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,'<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')
    .replace(/__([^_]+)__/g,'<strong>$1</strong>')
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g,'<em>$1</em>')
    .replace(/(?<!_)_([^_\n]+)_(?!_)/g,'<em>$1</em>');
}
function renderMarkdown(source='') {
  const lines=String(source??'').split(/\r?\n/);
  let html='',paragraph=[],listType=null,codeLines=null,codeLanguage='';
  const closeList=()=>{if(listType){html+=listType==='ul'?'</ul>':'</ol>';listType=null}};
  const flushParagraph=()=>{if(paragraph.length){html+='<p>'+inlineMarkdown(paragraph.join(' '))+'</p>';paragraph=[]}};
  for (const rawLine of lines) {
    const line=rawLine.trimEnd();
    const fence=line.match(/^\x60\x60\x60([\w-]*)\s*$/);
    if (fence) {
      if (codeLines!==null) {html+='<pre><code'+(codeLanguage?' class="language-'+escapeHtml(codeLanguage)+'"':'')+'>'+escapeHtml(codeLines.join('\n'))+'</code></pre>';codeLines=null;codeLanguage=''}
      else {flushParagraph();closeList();codeLines=[];codeLanguage=fence[1]||''}
      continue;
    }
    if (codeLines!==null) {codeLines.push(rawLine);continue}
    if (!line.trim()) {flushParagraph();closeList();continue}
    const heading=line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {flushParagraph();closeList();html+='<h'+heading[1].length+'>'+inlineMarkdown(heading[2])+'</h'+heading[1].length+'>';continue}
    const bullet=line.match(/^[-*]\s+(.+)$/);
    if (bullet) {flushParagraph();if(listType!=='ul'){closeList();html+='<ul>';listType='ul'}html+='<li>'+inlineMarkdown(bullet[1])+'</li>';continue}
    const ordered=line.match(/^\d+[.)]\s+(.+)$/);
    if (ordered) {flushParagraph();if(listType!=='ol'){closeList();html+='<ol>';listType='ol'}html+='<li>'+inlineMarkdown(ordered[1])+'</li>';continue}
    closeList();paragraph.push(line.trim());
  }
  if (codeLines!==null) html+='<pre><code'+(codeLanguage?' class="language-'+escapeHtml(codeLanguage)+'"':'')+'>'+escapeHtml(codeLines.join('\n'))+'</code></pre>';
  flushParagraph();closeList();
  return html||'<p class="markdown-empty">Orbit is composing…</p>';
}
let chatRenderQueued=false;
let agentTimer=null;
function renderChat() {
  const box=$('#chat-log');
  if (!box) return;
  box.innerHTML=state.chat.map(chatMarkup).join('');
  box.scrollTop=box.scrollHeight;
}
function scheduleChatRender() {
  if (chatRenderQueued) return;
  chatRenderQueued=true;
  setTimeout(()=>{chatRenderQueued=false;renderChat()},16);
}
function renderAgentActivity() {
  const panel=$('#agent-activity');
  const run=state.agentRun;
  if (!panel) return;
  if (!run) {panel.innerHTML='';panel.classList.remove('is-active');return}
  const running=run.status==='running';
  const elapsed=((run.completedAt||Date.now())-run.startedAt)/1000;
  const stateLabel=running?'Orbit is working locally':run.status==='error'?'Run stopped':'Run complete';
  const steps=run.steps.slice(-6).map(step=>'<div class="agent-step '+(step.state||'done')+'"><span class="agent-step-icon" aria-hidden="true">'+(step.state==='running'?'◌':step.state==='error'?'!':'✓')+'</span><span><strong>'+escapeHtml(step.label)+'</strong>'+(step.detail?'<small>'+escapeHtml(step.detail)+'</small>':'')+'</span></div>').join('');
  panel.classList.toggle('is-active',running);
  panel.innerHTML='<div class="agent-activity-head"><span class="agent-pulse '+(running?'is-running':run.status==='error'?'is-error':'is-done')+'" aria-hidden="true"></span><div><strong>'+escapeHtml(run.phase||'Orbit is ready')+'</strong><small>'+stateLabel+'</small></div><time>'+elapsed.toFixed(1)+'s</time></div>'+(steps?'<div class="agent-steps">'+steps+'</div>':'');
}
function setAgentBusyUI() {
  const form=$('#ask-form');
  if (!form) return;
  const input=form.querySelector('input');
  const button=form.querySelector('button');
  if (input) input.disabled=state.agentBusy;
  if (button) {button.disabled=state.agentBusy;button.innerHTML=state.agentBusy?'<span class="button-spinner" aria-hidden="true"></span> Working…':'Ask Orbit <span aria-hidden="true">↗</span>'}
}
function updateAgentRun(event) {
  const run=state.agentRun;
  if (!run) return;
  if (event.type==='start') run.phase='Orbit is online';
  if (event.type==='phase') run.phase=event.label||'Working through the request';
  if (event.type==='tool') {
    let step=null;
    for (let i=run.steps.length-1;i>=0;i--) if (run.steps[i].name===event.name&&run.steps[i].state==='running') {step=run.steps[i];break}
    if (!step) {step={name:event.name,label:event.label||'Workspace tool',state:'running'};run.steps.push(step)}
    step.state=event.state||step.state;
    step.label=event.label||step.label;
    step.detail=event.detail||'';
    if (step.state==='running') run.phase=step.label;
    else if (step.state==='error') run.phase='Needs attention';
    else run.phase=step.detail||'Workspace check complete';
  }
  if (event.type==='done'&&run.status==='running') {run.phase='Run complete';run.status='complete';run.completedAt=Date.now()}
  if (event.type==='error') {run.phase='Run stopped';run.status='error';run.completedAt=Date.now()}
  renderAgentActivity();
}
function receiveAgentEvent(event,live) {
  if (!event||!live) return;
  if (event.type==='token') {live.message+=(event.text||'');live.streaming=true;updateAgentRun(event);scheduleChatRender();return}
  if (event.type==='answer') {live.message=event.answer||live.message;live.sources=event.sources||[];live.changes=event.proposal?.changes||event.changes||[];live.proposal=event.proposal?.token||null;live.streaming=false;updateAgentRun(event);renderChat();return}
  if (event.type==='error') {live.message=event.error||'The local agent could not complete the request.';live.error=true;live.streaming=false;updateAgentRun(event);renderChat();return}
  updateAgentRun(event);
}
function beginAgentRun() {
  clearInterval(agentTimer);
  state.agentRun={phase:'Starting Orbit',steps:[],startedAt:Date.now(),status:'running'};
  document.body.classList.add('agent-is-running');
  agentTimer=setInterval(renderAgentActivity,250);
  renderAgentActivity();setAgentBusyUI();
}
function endAgentRun() {
  clearInterval(agentTimer);agentTimer=null;
  if (state.agentRun&&state.agentRun.status==='running') {state.agentRun.status='complete';state.agentRun.phase='Run complete';state.agentRun.completedAt=Date.now()}
  document.body.classList.remove('agent-is-running');
  renderAgentActivity();setAgentBusyUI();
}
async function streamAsk(question,live) {
  const response=await fetch('/api/assistant/stream',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question,session_id:state.sessionId})});
  if (!response.ok) {let data={};try{data=await response.json()}catch{}throw new Error(data.error||'The local agent could not start.')}
  if (!response.body || response.headers.get('content-type')?.includes('application/json')) {
    const result=await response.json();receiveAgentEvent({type:'answer',...result},live);receiveAgentEvent({type:'done'},live);return;
  }
  const reader=response.body.getReader();
  const decoder=new TextDecoder();
  let buffer='';
  const consume=line=>{if(!line.trim())return;try{receiveAgentEvent(JSON.parse(line),live)}catch{}};
  while (true) {
    const {value,done}=await reader.read();
    buffer+=decoder.decode(value||new Uint8Array(),{stream:!done});
    const lines=buffer.split('\n');buffer=lines.pop()||'';
    for (const line of lines) consume(line);
    if (done) break;
  }
  if (buffer.trim()) consume(buffer);
}

function agentField(key,value){if(key==='parent_id'&&value)return state.items.find(x=>x.id===value)?.title||value;if(key==='area_id'&&value)return state.areas.find(x=>x.id===value)?.name||value;if(key==='class_id'&&value)return state.classes.find(x=>x.id===value)?.name||value;if(['due_at','starts_at','ends_at'].includes(key)&&value)return new Date(value).toLocaleString();return value??'cleared'}
function changeMarkup(change){const fields=['title','body','due_at','starts_at','ends_at','status','priority','area_id','class_id','parent_id'];const before=change.before||{},after=change.after||change;const diffs=fields.filter(k=>change.op==='create'?after[k]:before[k]!==after[k]);return `<div class="agent-change"><strong>${escapeHtml(change.op.toUpperCase())} · ${escapeHtml(after.title||change.title||before.title)}</strong>${diffs.map(k=>`<span>${escapeHtml(k.replaceAll('_',' '))}: ${escapeHtml(agentField(k,after[k]))}${change.op==='update'?` <small>(was ${escapeHtml(agentField(k,before[k]))})</small>`:''}</span>`).join('')}</div>`}
function chatMarkup(entry){const content=entry.kind==='answer'?'<div class="markdown-content">'+renderMarkdown(entry.message)+'</div>':'<div class="plain-message">'+escapeHtml(entry.message)+'</div>';const sources=entry.sources?.length?'<div class="chat-sources">'+entry.sources.map(x=>'<button data-edit="'+escapeHtml(x.id)+'">'+escapeHtml(x.title)+'</button>').join('')+'</div>':'';const changes=entry.changes?.length?'<div class="agent-changes">'+entry.changes.map(changeMarkup).join('')+'</div>':'';const actions=entry.proposal?'<div class="agent-actions"><button class="primary-button" data-apply-proposal="'+escapeHtml(entry.proposal)+'">Apply these changes</button><button class="quiet-button" data-dismiss-proposal="'+escapeHtml(entry.proposal)+'">Discard</button></div>':'';return '<div class="chat-bubble '+(entry.kind||'answer')+(entry.streaming?' is-streaming':'')+(entry.error?' is-error':'')+'">'+content+(entry.streaming?'<span class="stream-cursor" aria-label="Streaming"></span>':'')+sources+changes+actions+'</div>'}
function appendChat(kind,message,sources=[],changes=[],proposal=null){state.chat.push({kind,message,sources,changes,proposal});renderChat()}
async function ask(question){const prompt=question?.trim();if(!prompt||state.agentBusy)return;state.agentBusy=true;beginAgentRun();state.chat.push({kind:'user',message:prompt});const live={kind:'answer',message:'',sources:[],changes:[],proposal:null,streaming:true};state.chat.push(live);renderChat();const input=$('#ask-form input');if(input){input.value='';input.disabled=true}setAgentBusyUI();try{await streamAsk(prompt,live);if(live.changes?.length)await refresh()}catch(err){live.message=err.message;live.error=true;live.streaming=false;if(state.agentRun){state.agentRun.status='error';state.agentRun.phase='Run stopped';state.agentRun.completedAt=Date.now()}renderChat()}finally{state.agentBusy=false;endAgentRun();const next=$('#ask-form input');if(next){next.disabled=false;next.focus()}}}
async function applyProposal(token){try{const result=await api('/api/assistant/commit',{method:'POST',body:JSON.stringify({token})});const entry=state.chat.find(x=>x.proposal===token);if(entry){entry.proposal=null;entry.message=result.answer;entry.changes=result.changes;entry.sources=result.sources}await refresh();toast(result.answer)}catch(err){appendChat('answer',err.message)}}
$('#content').addEventListener('click',async e=>{const apply=e.target.closest('[data-apply-proposal]'),dismiss=e.target.closest('[data-dismiss-proposal]');if(!apply&&!dismiss)return;e.stopPropagation();if(apply){apply.disabled=true;await applyProposal(apply.dataset.applyProposal)}else{const entry=state.chat.find(x=>x.proposal===dismiss.dataset.dismissProposal);if(entry){entry.proposal=null;entry.message='Discarded. No changes were made.';render()}}});
$('#content').addEventListener('click',async e=>{
  const target=e.target.closest('[data-cal-event],[data-cal-add],[data-cal-nav],[data-cal-mode],[data-cal-today],[data-cal-move],[data-cal-cancel],[data-cal-day]');
  if (!target || state.view!=='calendar') return;
  e.stopPropagation();
  if (suppressCalendarClick && target.dataset.calEvent){suppressCalendarClick=false;return}
  if (target.dataset.calEvent){const event=state.items.find(item=>item.id===target.dataset.calEvent);if(event)openEditor('event',event);return}
  if (target.dataset.calMove){state.movingEventId=target.dataset.calMove;render();return}
  if (target.hasAttribute('data-cal-cancel')){state.movingEventId=null;render();return}
  if (target.dataset.calAdd){state.selectedDay=target.dataset.calAdd;render();openEditor('event',null,target.dataset.calAdd);return}
  if (target.dataset.calNav){state.selectedDay=shiftPeriod(state.selectedDay,state.calendarMode,Number(target.dataset.calNav));render();return}
  if (target.dataset.calMode){state.calendarMode=target.dataset.calMode;render();return}
  if (target.hasAttribute('data-cal-today')){state.selectedDay=dayKey(new Date());render();return}
  if (target.dataset.calDay){if(state.movingEventId)await moveEventToDay(state.movingEventId,target.dataset.calDay);else{state.selectedDay=target.dataset.calDay;render()}}
});
let calendarDrag=null,suppressCalendarClick=false;
$('#content').addEventListener('pointerdown',e=>{const chip=e.target.closest('.calendar-chip');if(!chip||e.pointerType==='touch')return;calendarDrag={id:chip.dataset.calEvent,x:e.clientX,y:e.clientY,active:false,chip};chip.setPointerCapture(e.pointerId)});
document.addEventListener('pointermove',e=>{if(!calendarDrag)return;if(!calendarDrag.active&&Math.hypot(e.clientX-calendarDrag.x,e.clientY-calendarDrag.y)>7){calendarDrag.active=true;calendarDrag.chip.classList.add('dragging')}if(!calendarDrag.active)return;e.preventDefault();document.querySelectorAll('.calendar-cell.drop-target').forEach(x=>x.classList.remove('drop-target'));document.elementFromPoint(e.clientX,e.clientY)?.closest('.calendar-cell')?.classList.add('drop-target')});
document.addEventListener('pointerup',async e=>{if(!calendarDrag)return;const drag=calendarDrag;calendarDrag=null;drag.chip.classList.remove('dragging');document.querySelectorAll('.calendar-cell.drop-target').forEach(x=>x.classList.remove('drop-target'));if(!drag.active)return;suppressCalendarClick=true;setTimeout(()=>{suppressCalendarClick=false},100);const cell=document.elementFromPoint(e.clientX,e.clientY)?.closest('.calendar-cell');if(cell)await moveEventToDay(drag.id,cell.dataset.calDay)});
document.addEventListener('pointercancel',()=>{calendarDrag=null;document.querySelectorAll('.calendar-cell.drop-target,.calendar-chip.dragging').forEach(x=>x.classList.remove('drop-target','dragging'))});
document.addEventListener('click',async e=>{const t=e.target.closest('button,[data-edit],.event-card,.note-card,.mini-item');if(!t)return;if(t.dataset.groupToggle){const key=t.dataset.groupToggle;if(state.collapsedTaskGroups.has(key))state.collapsedTaskGroups.delete(key);else state.collapsedTaskGroups.add(key);render();return}if(t.dataset.planNav){state.planDay=addDays(state.planDay,Number(t.dataset.planNav));render();return}if(t.hasAttribute('data-plan-today')){state.planDay=dayKey(new Date());render();return}if(t.dataset.planAdd){openEditor('event',null,state.planDay,Number(t.dataset.planAdd));return}if(t.dataset.close){document.getElementById(t.dataset.close).close();return}if(t.hasAttribute('data-manage-classes')){openClasses();return}if(t.dataset.classEdit){const found=state.classes.find(c=>c.id===t.dataset.classEdit);if(found){state.editingClass=found.id;$('#class-name').value=found.name;$('#class-name-label').firstChild.textContent='Rename class';$('#save-class').textContent='Save name';$('#cancel-class-edit').classList.remove('hidden');$('#class-name').focus()}return}if(t.dataset.classDelete){await removeClass(t.dataset.classDelete);return}if(t.dataset.view){navigate(t.dataset.view);return}if(t.dataset.area){navigate('tasks',t.dataset.area);return}if(t.dataset.new){openEditor(t.dataset.new);return}if(t.dataset.toggle){await toggleTask(t.dataset.toggle);return}if(t.dataset.delete){await deleteItem(t.dataset.delete);return}if(t.dataset.edit){const item=state.items.find(x=>x.id===t.dataset.edit);if(item)openEditor(item.type,item);return}if(t.dataset.filter){state.filter=t.dataset.filter;render();return}if(t.dataset.ask){await ask(t.dataset.ask)}});
$('#content').addEventListener('change',e=>{if(!e.target.matches('[data-plan-date]')||!e.target.value)return;try{fromDayKey(e.target.value);state.planDay=e.target.value;render()}catch{toast('Choose a valid date')}});
$('#new-main').addEventListener('click',()=>openEditor(singular[state.view]||'task'));
$('#entry-form').addEventListener('submit',saveEntry);
$('#entry-date').addEventListener('change',()=>{if(state.entryType!=='event')return;const start=$('#entry-date').value,end=$('#entry-end').value;if(start&&(!end||new Date(end)<=new Date(start)))$('#entry-end').value=localInput(new Date(new Date(start).getTime()+3600000))});
$('#entry-area').addEventListener('change',showClassField);
$('#manage-classes-editor').addEventListener('click',openClasses);
$('#class-form').addEventListener('submit',saveClass);
$('#cancel-class-edit').addEventListener('click',()=>{state.editingClass=null;$('#class-form').reset();$('#class-name-label').firstChild.textContent='Add a class';$('#save-class').textContent='Add class';$('#cancel-class-edit').classList.add('hidden')});
$('#type-row').addEventListener('click',e=>{if(e.target.dataset.type){state.entryType=e.target.dataset.type;toggleFields()}});
$('#add-area').addEventListener('click',()=>$('#area-dialog').showModal());
$('#area-form').addEventListener('submit',async e=>{e.preventDefault();const form=e.target;try{await api('/api/areas',{method:'POST',body:JSON.stringify({name:form.elements.namedItem('name').value,color:form.elements.namedItem('color').value})});$('#area-dialog').close();form.reset();await refresh();toast('Life area added')}catch(err){toast(err.message)}});
$('#search-open').addEventListener('click',()=>{$('#search-dialog').showModal();$('#search-input').focus()});
$('#search-input').addEventListener('input',e=>{const q=e.target.value.trim().toLowerCase();const matches=q?state.items.filter(x=>`${x.title} ${x.body} ${x.class_name} ${x.area_name||''}`.toLowerCase().includes(q)).slice(0,20):[];$('#search-results').innerHTML=q?(matches.length?matches.map(x=>`<div class="search-result" data-edit="${x.id}"><strong>${escapeHtml(x.title)}</strong><small>${escapeHtml(x.type)} · ${escapeHtml(x.area_name||'No area')}${x.class_name?' · '+escapeHtml(x.class_name):''}</small></div>`).join(''):empty('No matching records.')):empty('Search across your entire workspace.')});
$('#search-results').addEventListener('click',e=>{const item=e.target.closest('[data-edit]');if(item){$('#search-dialog').close();const found=state.items.find(x=>x.id===item.dataset.edit);if(found)openEditor(found.type,found)}});
document.addEventListener('submit',e=>{if(e.target.id==='ask-form'){e.preventDefault();ask(new FormData(e.target).get('question'))}});
function openAiSettings() {
  const label = $('#ai-provider-label');
  if (label && state.aiSettings) label.textContent = `${state.aiSettings.provider} (${state.aiSettings.model})`;
  if ($('#ai-active-provider') && state.aiSettings) $('#ai-active-provider').value = state.aiSettings.active_provider || '';
  if ($('#ai-openrouter-model') && state.aiSettings) $('#ai-openrouter-model').value = state.aiSettings.openrouter_model || '';
  if ($('#ai-ollama-model') && state.aiSettings) $('#ai-ollama-model').value = state.aiSettings.model || '';
  $('#ai-settings-dialog')?.showModal();
}
$('#ai-settings-open')?.addEventListener('click', openAiSettings);
document.addEventListener('click', e => {
  if (e.target.closest('[data-open-ai-settings]')) openAiSettings();
});
$('#ai-save-settings')?.addEventListener('click', async () => {
  const active_provider = $('#ai-active-provider')?.value;
  const groq_api_key = $('#ai-groq-key')?.value.trim();
  const openrouter_api_key = $('#ai-openrouter-key')?.value.trim();
  const openrouter_model = $('#ai-openrouter-model')?.value.trim();
  const orbit_model = $('#ai-ollama-model')?.value.trim();
  const payload = {};
  if (active_provider !== undefined) payload.active_provider = active_provider;
  if (groq_api_key !== undefined && groq_api_key !== '') payload.groq_api_key = groq_api_key;
  if (openrouter_api_key !== undefined && openrouter_api_key !== '') payload.openrouter_api_key = openrouter_api_key;
  if (openrouter_model) payload.openrouter_model = openrouter_model;
  if (orbit_model) payload.orbit_model = orbit_model;
  try {
    const updated = await api('/api/settings', { method: 'POST', body: JSON.stringify(payload) });
    state.aiSettings = updated;
    $('#ai-settings-dialog')?.close();
    toast(`AI engine updated: ${updated.provider}`);
    render();
  } catch (err) {
    toast(err.message);
  }
});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&state.movingEventId){state.movingEventId=null;render()}if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('#search-dialog').showModal();$('#search-input').focus()}});
$('#theme-select').addEventListener('change', e => {
  const mode = themeModes.has(e.target.value) ? e.target.value : 'system';
  try { localStorage.setItem('orbit-theme', mode); } catch {}
  applyTheme(mode);
});
const followSystemTheme = () => {
  if (document.documentElement.dataset.themeMode === 'system') applyTheme('system');
};
// Voice Quick-Capture
let activeRecognition = null;
let voiceTranscribedText = '';

function initVoiceCapture() {
  const btn = $('#voice-capture-btn');
  const overlay = $('#voice-overlay');
  const transcriptEl = $('#voice-transcript');
  const closeBtn = $('#voice-close-btn');
  if (!btn) return;

  const SpeechClass = window.SpeechRecognition || window.webkitSpeechRecognition;

  function stopVoice(cancel = false) {
    if (activeRecognition) {
      const rec = activeRecognition;
      activeRecognition = null;
      try { rec.stop(); } catch {}
    }
    btn?.classList.remove('is-recording');
    overlay?.classList.add('hidden');
    if (cancel) voiceTranscribedText = '';
  }

  function handleVoiceFinalize() {
    const textToProcess = voiceTranscribedText.trim();
    stopVoice(false);
    if (textToProcess) {
      toast(`Heard: “${textToProcess}”`);
      ask(textToProcess);
    }
  }

  btn.addEventListener('click', () => {
    if (btn.classList.contains('is-recording')) {
      handleVoiceFinalize();
      return;
    }

    if (!SpeechClass) {
      toast('Speech recognition not supported in this browser (Chrome / Safari recommended).');
      return;
    }

    try {
      const recognition = new SpeechClass();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      voiceTranscribedText = '';
      if (transcriptEl) transcriptEl.textContent = 'Listening… speak your task, reminder, or event.';
      btn.classList.add('is-recording');
      overlay?.classList.remove('hidden');

      recognition.onstart = () => {
        activeRecognition = recognition;
      };

      recognition.onresult = (event) => {
        let interim = '';
        let final = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const item = event.results[i];
          if (item.isFinal) final += item[0].transcript;
          else interim += item[0].transcript;
        }
        const current = (final || interim).trim();
        if (current) {
          voiceTranscribedText = current;
          if (transcriptEl) transcriptEl.textContent = current;
        }
      };

      recognition.onerror = (event) => {
        console.warn('Speech recognition error:', event.error);
        if (event.error === 'not-allowed') {
          toast('Microphone access denied. Please grant microphone permission.');
        } else if (event.error !== 'no-speech') {
          toast(`Voice error: ${event.error}`);
        }
        stopVoice(true);
      };

      recognition.onend = () => {
        if (activeRecognition) {
          handleVoiceFinalize();
        }
      };

      recognition.start();
    } catch (err) {
      console.error(err);
      toast('Could not start microphone: ' + err.message);
      stopVoice(true);
    }
  });

  closeBtn?.addEventListener('click', () => {
    stopVoice(true);
    toast('Voice capture cancelled.');
  });
}
initVoiceCapture();

refresh().catch(err=>{toast(err.message);$('#content').innerHTML=empty('Could not load your workspace. Check that the server is running.')});
