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
const state = { areas:[], classes:[], items:[], plan_templates:[], health:null, healthMetrics:null, healthDate:null, healthRange:'7', view:'today', area:null, filter:'open', editing:null, entryType:'task', editingClass:null, calendarMode:'month', selectedDay:dayKey(new Date()), planDay:dayKey(new Date()), movingEventId:null,collapsedTaskGroups:new Set(),chat:[],agentBusy:false,agentRun:null,aiSettings:null,agentic:{profile:[],missions:[],actions:[]},sessionId:getChatSessionId() };
const labels = {today:'Today',plan:'Daily plan',tasks:'Tasks',calendar:'Calendar',notes:'Notes',journal:'Journal',goals:'Goals',assistant:'Ask Orbit',actions:'Action Center'};
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
async function refresh(){const [data,agentic]=await Promise.all([api('/api/state'),api('/api/agentic')]);state.areas=data.areas;state.classes=data.classes;state.items=data.items;state.plan_templates=data.plan_templates||[];state.health=data.health||null;state.agentic=agentic;if(isHealth(state.area)){try{const p=new URLSearchParams();if(state.healthDate)p.set('date',state.healthDate);if(state.healthRange)p.set('range',state.healthRange);state.healthMetrics=await api('/api/health/metrics?'+p.toString());if(!state.healthDate&&state.healthMetrics.date)state.healthDate=state.healthMetrics.date;}catch{}}await loadAiSettings();await loadChatHistory();render();if($('#editor')?.open)renderClassOptions($('#entry-class').value);if($('#classes-dialog')?.open)renderClasses();if($('#templates-dialog')?.open)renderTemplatesList()}
function area(id){return state.areas.find(a=>a.id===id)}
function isAcademic(id){return area(id)?.name==='Academics'}
function isHealth(id){return area(id)?.name?.toLowerCase()==='health'}
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
  return '<div class="hero"><div><div class="eyebrow">' + (state.area ? escapeHtml(area(state.area)?.name || 'LIFE AREA') : 'YOUR WORKSPACE') + '</div><h1 class="page-title">Tasks<span style="color:var(--accent-primary)">.</span></h1><p class="muted section-desc">Keep deadlines, classes, and next actions in one place—organized by life area.</p></div></div>' +
    '<div class="list-toolbar task-list-toolbar"><div class="filters"><button class="filter ' + (state.filter === 'open' ? 'active' : '') + '" data-filter="open">Open</button><button class="filter ' + (state.filter === 'done' ? 'active' : '') + '" data-filter="done">Done</button><button class="filter ' + (state.filter === 'all' ? 'active' : '') + '" data-filter="all">All</button></div>' +
    '<div class="task-toolbar-right"><span class="task-count muted">' + items.length + ' ' + (items.length === 1 ? 'task' : 'tasks') + '</span><button class="tiny-link" data-new="task">+ Add task</button></div></div>' +
    '<div class="task-grouping-note"><span class="grouping-icon" aria-hidden="true">↳</span><span>Grouped by <strong>life area</strong>' + (state.area ? '' : ' · Academics is organized by class') + '</span></div>' +
    '<div class="task-groups">' + (items.length ? groupsMarkup : empty('Nothing here yet. Add a task to get started.')) + '</div>';
}
function empty(message){return `<div class="empty"><span class="empty-icon">✧</span>${message}</div>`}
function taskRow(item){return `<div class="item-row ${item.status==='done'?'done':''}"><button class="check ${item.status==='done'?'checked':''}" data-toggle="${item.id}" aria-label="${item.status==='done'?'Mark incomplete':'Complete task'}">${item.status==='done'?'✓':''}</button><div class="item-main"><div class="item-title" data-edit="${item.id}">${escapeHtml(item.title)}</div><div class="item-meta">${areaTag(item)}${item.class_name?`<span class="badge course">${escapeHtml(item.class_name)}</span>`:''}${item.parent_title?`<span class="badge">↳ ${escapeHtml(item.parent_title)}</span>`:''}${item.due_at?`<span class="badge ${isOverdue(item)?'warn':''}">${isOverdue(item)?'Overdue · ':''}${fmtDate(item.due_at)}</span>`:''}<span>${escapeHtml(item.priority)} priority</span></div></div><div class="row-actions"><button data-edit="${item.id}" title="Edit">✎</button><button data-delete="${item.id}" title="Delete">×</button></div></div>`}
function renderNav(){document.querySelectorAll('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.view===state.view&&!state.area));$('#areas-nav').innerHTML=state.areas.map(a=>`<button class="area-link ${state.area===a.id?'active':''}" data-area="${a.id}"><span class="area-dot" style="background:${a.color}"></span>${escapeHtml(a.name)}</button>${a.name==='Academics'&&state.area===a.id?`<button class="class-manage-link" data-manage-classes>Manage classes · ${state.classes.length}</button>`:''}`).join('');$('#crumb-current').textContent=state.area?area(state.area)?.name||'Area':labels[state.view];$('#new-main').innerHTML=state.view==='plan'?'+ &nbsp; Add block':'+ &nbsp; New entry'}
function todayView(){const tasks=filtered('task').filter(x=>x.status==='open');const dueToday=tasks.filter(x=>x.due_at&&dateKey(x.due_at)===dateKey(new Date()));const overdue=tasks.filter(isOverdue);const attentionCount=new Set([...dueToday,...overdue].map(x=>x.id)).size;const upcoming=[...tasks].sort(taskSort).slice(0,5);const events=filtered('event').filter(x=>x.starts_at&&new Date(x.starts_at)>=new Date(new Date().setHours(0,0,0,0))).sort((a,b)=>a.starts_at.localeCompare(b.starts_at)).slice(0,4);const goals=filtered('goal').filter(x=>x.status==='open').slice(0,3);const focus=overdue[0]||dueToday[0]||upcoming[0];const healthToday=state.health?.today;const healthSteps=healthToday?.steps||0;const healthCal=Math.round(healthToday?.active_calories||0);const healthSleep=healthToday?.sleep_hours?`${healthToday.sleep_hours.toFixed(1)}h`:'—';const isHealthConnected=Boolean(state.health?.connected||healthToday?.last_synced_at);return `<div class="hero"><div><div class="eyebrow">YOUR DAY, CLEARLY</div><h1 class="page-title">Good ${new Date().getHours()<12?'morning':new Date().getHours()<17?'afternoon':'evening'}<span style="color:var(--accent-primary)">.</span></h1><p class="muted">A calmer place for everything that matters.</p></div><div class="date-pill">✦ &nbsp; ${fullDate(new Date())}</div></div><div class="stat-row"><div class="stat"><div class="number">${tasks.length}</div><small>Open tasks</small></div><div class="stat"><div class="number">${attentionCount}</div><small>Due or overdue</small></div><div class="stat"><div class="number">${goals.length}</div><small>Active goals</small></div><div class="stat" data-health-jump style="cursor:pointer;" title="View Apple Health Biometrics"><div class="number" style="color:#10b981;">${healthSteps?Number(healthSteps).toLocaleString():'—'}</div><small>Steps today 👟</small></div></div><div class="dashboard-grid"><div class="stack"><section class="card focus-card"><div class="eyebrow">✧ &nbsp; YOUR NEXT MOVE</div><h2>${focus?escapeHtml(focus.title):'You have a clear runway.'}</h2><p>${focus?`${focus.class_name?escapeHtml(focus.class_name)+' · ':''}${focus.due_at?(isOverdue(focus)?'Overdue since ':'Due ')+fmtDate(focus.due_at):'Ready whenever you are.'}`:'Add your first task and Orbit will keep it in view.'}</p><button class="focus-action" ${focus?`data-edit="${focus.id}"`:'data-new="task"'}>${focus?'Open task →':'Add a task →'}</button></section><section class="card health-glance-card"><div class="card-head"><div class="health-glance-title"><span class="pulse-dot ${isHealthConnected?'live':''}"></span><h2>Apple Health &amp; Activity</h2></div><button class="tiny-link" data-health-jump>Open Health Hub →</button></div><div class="health-glance-stats"><div class="glance-metric" data-health-jump><span class="metric-badge steps">👟 Steps</span><strong>${healthSteps?Number(healthSteps).toLocaleString():'0'}</strong><small>${(healthToday?.distance_km||0).toFixed(1)} km</small></div><div class="glance-metric" data-health-jump><span class="metric-badge burn">🔥 Burn</span><strong>${healthCal} <small>kcal</small></strong><small>Energy</small></div><div class="glance-metric" data-health-jump><span class="metric-badge sleep">🌙 Sleep</span><strong>${healthSleep}</strong><small>Rest &amp; recovery</small></div></div></section><section class="card"><div class="card-head"><h2>Up next</h2><button class="tiny-link" data-view="tasks">View all →</button></div>${upcoming.length?upcoming.map(taskRow).join(''):empty('No open tasks. Add one to start planning your day.')}</section></div><div class="stack"><section class="card"><div class="card-head"><h2>On your calendar</h2><button class="tiny-link" data-view="calendar">View all →</button></div>${events.length?events.map(x=>`<div class="mini-item" data-edit="${x.id}"><strong>${escapeHtml(x.title)}</strong><small>${fmtDate(x.starts_at)} · ${fmtTime(x.starts_at)}${x.class_name?' · '+escapeHtml(x.class_name):''}</small></div>`).join(''):empty('No upcoming events yet.')}</section><section class="card"><div class="card-head"><h2>Goals in motion</h2><button class="tiny-link" data-view="goals">View all →</button></div>${goals.length?goals.map(x=>`<div class="mini-item" data-edit="${x.id}"><strong>${escapeHtml(x.title)}</strong><small>${escapeHtml(x.area_name||'Uncategorized')}${x.due_at?' · target '+fmtDate(x.due_at):''}</small></div>`).join(''):empty('Add a goal to connect today with the long term.')}</section><section class="card"><div class="card-head"><h2>Your data</h2></div><p class="muted">Your entries live in a SQLite file on this Mac. Export a readable backup anytime.</p><a class="tiny-link" href="/api/export">Download backup →</a></section></div></div>`}
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
  return `<div class="hero calendar-hero"><div><div class="eyebrow">YOUR WORKSPACE</div><h1 class="page-title">Calendar<span style="color:var(--accent-primary)">.</span></h1><p class="muted">See your time at a glance. Click a day to plan it.</p></div><button class="primary-button" data-cal-add="${selected}">+ &nbsp; New event</button></div><div class="calendar-toolbar"><div class="calendar-navigation"><button class="calendar-arrow" data-cal-nav="-1" aria-label="Previous ${state.calendarMode}">‹</button><button class="calendar-arrow" data-cal-nav="1" aria-label="Next ${state.calendarMode}">›</button><h2>${periodTitle}</h2><button class="calendar-today-button" data-cal-today>Today</button></div><div class="calendar-mode"><button class="${state.calendarMode==='month'?'active':''}" data-cal-mode="month">Month</button><button class="${state.calendarMode==='week'?'active':''}" data-cal-mode="week">Week</button></div></div>${state.movingEventId?`<div class="calendar-move-banner">Choose a new day for <strong>${escapeHtml(state.items.find(x=>x.id===state.movingEventId)?.title||'this event')}</strong>. The time stays the same.<button data-cal-cancel>Cancel</button></div>`:''}<div class="calendar-layout"><section class="calendar-board"><div class="calendar-weekdays">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(day=>`<span>${day}</span>`).join('')}</div><div class="calendar-grid ${state.calendarMode}">${cells}</div></section><aside class="calendar-agenda"><div class="agenda-heading"><div><div class="eyebrow">SELECTED DAY</div><h2>${selectedDate.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'})}</h2></div><button class="agenda-add" data-cal-add="${selected}" aria-label="Add event on selected day">+</button></div><div class="agenda-count">${selectedEvents.length} ${selectedEvents.length===1?'event':'events'}</div>${agenda}<div class="calendar-hint">Tip: drag an event to another day, or use Move date.</div></aside></div>`;
}


function formatDuration(startsAt, endsAt) {
  if (!startsAt || !endsAt) return '';
  const diffMs = new Date(endsAt).getTime() - new Date(startsAt).getTime();
  if (diffMs <= 0) return '';
  const mins = Math.round(diffMs / 60000);
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours > 0 && remMins > 0) return `${hours}h ${remMins}m`;
  if (hours > 0) return `${hours}h`;
  return `${mins}m`;
}

function parseTimeBlockString(str) {
  if (!str) return null;
  const cleaned = str.trim();
  const match = cleaned.match(/^(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:-|–|to)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:--|-|:)?\s*(.*)$/i);
  if (!match) return null;
  const startRaw = match[1].trim();
  const endRaw = match[2].trim();
  const title = match[3].trim() || 'Custom Block';
  
  function to24H(val) {
    const isPm = /pm/i.test(val);
    const isAm = /am/i.test(val);
    const cleanTime = val.replace(/am|pm/i, '').trim();
    let [h, m] = cleanTime.split(':').map(Number);
    if (isNaN(m)) m = 0;
    if (isPm && h < 12) h += 12;
    if (isAm && h === 12) h = 0;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  }
  return {
    start: to24H(startRaw),
    end: to24H(endRaw),
    title
  };
}

function planTimeBlock(event) {
  const isDone = event.status === 'done';
  const startsToday = dayKey(event.starts_at) === state.planDay;
  const startLabel = startsToday ? fmtTime(event.starts_at) : 'Continues';
  const endLabel = event.ends_at ? (dayKey(event.ends_at) === state.planDay ? fmtTime(event.ends_at) : fmtDate(event.ends_at)) : 'Open';
  const duration = event.ends_at ? formatDuration(event.starts_at, event.ends_at) : '';
  const a = area(event.area_id);
  const color = a?.color || 'var(--accent-primary)';
  const tags = areaTag(event) + (event.class_name ? `<span class="badge course">${escapeHtml(event.class_name)}</span>` : '');

  return `<article class="plan-custom-block ${isDone ? 'is-done' : ''}" style="--block-accent: ${color}">` +
    `<div class="plan-block-time-col">` +
      `<strong class="plan-time-start">${startLabel}</strong>` +
      `<small class="plan-time-end">${endLabel ? 'to ' + endLabel : 'Open-ended'}</small>` +
      (duration ? `<span class="plan-duration-pill">${duration}</span>` : '') +
    `</div>` +
    `<div class="plan-block-rail" aria-hidden="true">` +
      `<span class="plan-node-dot" style="background:${color}"></span>` +
    `</div>` +
    `<div class="plan-block-card">` +
      `<div class="plan-block-top">` +
        `<div class="plan-block-title-row">` +
          `<button type="button" class="plan-check ${isDone ? 'checked' : ''}" data-plan-toggle="${event.id}" title="${isDone ? 'Mark in progress' : 'Mark completed'}" aria-label="${isDone ? 'Mark incomplete' : 'Complete block'}">${isDone ? '✓' : ''}</button>` +
          `<button type="button" class="plan-title-btn" data-edit="${event.id}" title="Click to edit block">` +
            `<strong class="plan-block-title ${isDone ? 'done-text' : ''}">${escapeHtml(event.title)}</strong>` +
          `</button>` +
        `</div>` +
        `<div class="plan-block-actions">` +
          `<button type="button" class="plan-action-btn" data-plan-duplicate="${event.id}" title="Duplicate block (+1 hr)">⧉</button>` +
          `<button type="button" class="plan-action-btn" data-edit="${event.id}" title="Edit details">✎</button>` +
          `<button type="button" class="plan-action-btn delete" data-delete="${event.id}" title="Delete block">×</button>` +
        `</div>` +
      `</div>` +
      (event.body ? `<p class="plan-block-body">${escapeHtml(event.body)}</p>` : '') +
      `<div class="plan-block-footer">${tags}${event.priority && event.priority !== 'medium' ? `<span class="badge ${event.priority==='high'?'warn':''}">${escapeHtml(event.priority)}</span>` : ''}</div>` +
    `</div>` +
  `</article>`;
}

function planTimeGap(startTimeStr, endTimeStr, gapMins) {
  const startFmt = fmtTime(startTimeStr);
  const endFmt = fmtTime(endTimeStr);
  const hours = Math.floor(gapMins / 60);
  const remMins = gapMins % 60;
  const label = hours > 0 ? (remMins > 0 ? `${hours}h ${remMins}m free` : `${hours}h free`) : `${gapMins}m free`;
  const sDate = new Date(startTimeStr);
  const eDate = new Date(endTimeStr);
  const sVal = `${String(sDate.getHours()).padStart(2,'0')}:${String(sDate.getMinutes()).padStart(2,'0')}`;
  const eVal = `${String(eDate.getHours()).padStart(2,'0')}:${String(eDate.getMinutes()).padStart(2,'0')}`;

  return `<div class="plan-gap-indicator">` +
    `<span class="plan-gap-line"></span>` +
    `<button type="button" class="plan-gap-btn" data-fill-gap-start="${sVal}" data-fill-gap-end="${eVal}">` +
      `<span class="gap-plus">＋</span> Fill gap <strong>${startFmt} – ${endFmt}</strong> <span class="gap-badge">${label}</span>` +
    `</button>` +
    `<span class="plan-gap-line"></span>` +
  `</div>`;
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
  const templates = state.plan_templates || [];

  let totalPlannedMins = 0;
  for (const ev of events) {
    if (ev.starts_at && ev.ends_at) {
      const d = (new Date(ev.ends_at).getTime() - new Date(ev.starts_at).getTime()) / 60000;
      if (d > 0) totalPlannedMins += d;
    }
  }
  const plannedHoursStr = totalPlannedMins > 0 ? `${(totalPlannedMins / 60).toFixed(1)} hrs` : '0 hrs';
  const completedBlocks = events.filter(e => e.status === 'done').length;

  let timelineContent = '';
  if (events.length === 0) {
    timelineContent = `<div class="plan-empty-canvas">` +
      `<div class="empty-canvas-icon">✦</div>` +
      `<h3>Your day is an open canvas.</h3>` +
      `<p>Build custom time blocks (like <strong>7:00–8:00 GYM</strong> or <strong>8:00–9:00 LeetCode</strong>) or apply one of your daily routine templates below.</p>` +
      `<div class="plan-empty-actions">` +
        `<button type="button" class="primary-button" data-plan-focus-quick>+ &nbsp; Add custom block</button>` +
        `<button type="button" class="secondary-button" data-open-templates>⚡ &nbsp; Apply routine template</button>` +
      `</div>` +
    `</div>`;
  } else {
    const blockElements = [];
    for (let i = 0; i < events.length; i++) {
      const current = events[i];
      if (i > 0) {
        const prev = events[i - 1];
        if (prev.ends_at && current.starts_at) {
          const prevEnd = new Date(prev.ends_at).getTime();
          const currStart = new Date(current.starts_at).getTime();
          const gapMins = Math.round((currStart - prevEnd) / 60000);
          if (gapMins >= 20) {
            blockElements.push(planTimeGap(prev.ends_at, current.starts_at, gapMins));
          }
        }
      }
      blockElements.push(planTimeBlock(current));
    }
    timelineContent = `<div class="plan-timeline-stream">${blockElements.join('')}</div>`;
  }

  const areaOptions = state.areas.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
  const templateDropdownOptions = templates.map(t => `<option value="${t.id}">${escapeHtml(t.name)} (${t.blocks?.length || 0} blocks)</option>`).join('');
  const templateChips = templates.slice(0, 4).map(t =>
    `<button type="button" class="routine-chip" data-quick-apply-tpl-id="${t.id}" title="${escapeHtml(t.description || t.name)}">` +
      `<span class="routine-chip-bolt">⚡</span>` +
      `<span class="routine-chip-info"><strong>${escapeHtml(t.name)}</strong><small>${t.blocks?.length || 0} blocks</small></span>` +
      `<span class="routine-chip-arrow">›</span>` +
    `</button>`
  ).join('');

  const openTasks = dueTasks.filter(item => item.status === 'open').length;
  const taskSummaryText = dueTasks.length ? dueTasks.length + ' ' + (dueTasks.length === 1 ? 'task' : 'tasks') : 'No tasks due';

  return `<div class="hero plan-hero">` +
    `<div>` +
      `<div class="eyebrow">DESIGN YOUR DAY</div>` +
      `<h1 class="page-title">Daily plan<span style="color:var(--accent-primary)">.</span></h1>` +
      `<p class="muted">Shape the day in customizable time blocks, create routines, and reuse templates.</p>` +
    `</div>` +
    `<div class="plan-hero-actions">` +
      `<button type="button" class="quiet-button" data-open-save-template title="Save current day as a reusable template">💾 &nbsp; Save as template</button>` +
      `<button type="button" class="secondary-button" data-open-templates title="View and apply routine templates">⚡ &nbsp; Routine templates <span class="badge-count">${templates.length}</span></button>` +
      `<button type="button" class="primary-button" data-new="event">+ &nbsp; Add block</button>` +
    `</div>` +
  `</div>` +
  `<div class="plan-toolbar">` +
    `<div class="plan-navigation">` +
      `<button type="button" class="plan-nav-button" data-plan-nav="-1" aria-label="Previous day">‹</button>` +
      `<button type="button" class="plan-nav-button" data-plan-nav="1" aria-label="Next day">›</button>` +
      `<h2>${selectedDate.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric',year:'numeric'})}</h2>` +
      `<button type="button" class="plan-today-button" data-plan-today>Today</button>` +
    `</div>` +
    `<div class="plan-toolbar-right">` +
      (templates.length ? `<select class="plan-quick-template-select" data-quick-apply-template aria-label="Apply routine template"><option value="">⚡ Apply template...</option>${templateDropdownOptions}</select>` : '') +
      `<label class="plan-date-picker">Jump to date<input type="date" data-plan-date value="${selected}"></label>` +
    `</div>` +
  `</div>` +
  `<div class="plan-layout">` +
    `<section class="plan-main-col">` +
      `<div class="plan-quick-add-card">` +
        `<div class="plan-quick-add-head">` +
          `<span><strong class="quick-title">⚡ Quick Block Builder</strong> <small class="muted">e.g. type “7:00-8:00 GYM” or pick times below</small></span>` +
          `<div class="quick-duration-pills">` +
            `<button type="button" class="dur-pill" data-dur="30">+30m</button>` +
            `<button type="button" class="dur-pill" data-dur="45">+45m</button>` +
            `<button type="button" class="dur-pill active" data-dur="60">+1h</button>` +
            `<button type="button" class="dur-pill" data-dur="90">+1.5h</button>` +
            `<button type="button" class="dur-pill" data-dur="120">+2h</button>` +
          `</div>` +
        `</div>` +
        `<form id="plan-quick-form" class="plan-quick-form">` +
          `<div class="plan-quick-inputs">` +
            `<div class="plan-quick-times">` +
              `<label class="plan-time-label">From<input type="time" id="plan-q-start" value="08:00" required></label>` +
              `<span class="time-sep">to</span>` +
              `<label class="plan-time-label">To<input type="time" id="plan-q-end" value="09:00" required></label>` +
            `</div>` +
            `<div class="plan-quick-details">` +
              `<input type="text" id="plan-q-title" class="plan-q-title-input" placeholder="e.g. 7:00–8:00 GYM, or study leetcode, take a shower..." required maxlength="200">` +
              `<select id="plan-q-area" class="plan-q-area-select"><option value="">No area</option>${areaOptions}</select>` +
              `<button type="submit" class="primary-button plan-q-submit-btn">+ Add Block</button>` +
            `</div>` +
          `</div>` +
        `</form>` +
      `</div>` +
      `<div class="plan-timeline-wrapper">${timelineContent}</div>` +
    `</section>` +
    `<aside class="plan-sidebar">` +
      `<section class="plan-sidebar-card">` +
        `<div class="card-head">` +
          `<h2>Day at a glance</h2>` +
          `<span class="badge">${events.length ? events.length + ' ' + (events.length === 1 ? 'block' : 'blocks') : 'Open day'}</span>` +
        `</div>` +
        `<div class="plan-stat-grid">` +
          `<div class="plan-stat"><strong>${events.length}</strong><small>Time blocks</small></div>` +
          `<div class="plan-stat"><strong>${completedBlocks} / ${events.length}</strong><small>Completed</small></div>` +
          `<div class="plan-stat"><strong>${plannedHoursStr}</strong><small>Scheduled</small></div>` +
        `</div>` +
      `</section>` +
      `<section class="plan-sidebar-card">` +
        `<div class="card-head">` +
          `<div><div class="eyebrow">REUSABLE ROUTINES</div><h2>Templates</h2></div>` +
          `<button type="button" class="tiny-link" data-open-templates>View all →</button>` +
        `</div>` +
        `<p class="muted sidebar-desc">Load a saved routine to schedule your ideal day in one tap.</p>` +
        `<div class="routine-chips-list">${templateChips || '<div class="plan-sidebar-empty">No templates yet. Click “Save as template” above.</div>'}</div>` +
        `<div class="routine-card-footer">` +
          `<button type="button" class="tiny-link" data-open-save-template>+ Save this day as template</button>` +
        `</div>` +
      `</section>` +
      `<section class="plan-sidebar-card">` +
        `<div class="card-head">` +
          `<h2>Due this day</h2>` +
          `<span class="muted">${taskSummaryText}</span>` +
        `</div>` +
        (dueTasks.length ? dueTasks.map(taskRow).join('') : '<div class="plan-sidebar-empty">No due tasks. Keep the day focused.</div>') +
      `</section>` +
      `<section class="plan-sidebar-card plan-help">` +
        `<div class="eyebrow">A FLEXIBLE RHYTHM</div>` +
        `<h2>Shape your day in blocks.</h2>` +
        `<p>Give high-leverage activities their own time window. Save what works as a template to turn good days into repeatable habits.</p>` +
      `</section>` +
    `</aside>` +
  `</div>`;
}

function renderTemplatesList() {
  const container = $('#templates-list');
  if (!container) return;
  const templates = state.plan_templates || [];
  if (!templates.length) {
    container.innerHTML = empty('No saved templates yet. Click “Create new template” or “Save day as template”.');
    return;
  }
  container.innerHTML = templates.map(tpl => {
    const blockPills = (tpl.blocks || []).map(b =>
      `<span class="tpl-block-chip" title="${escapeHtml(b.title)} · ${escapeHtml(b.body || '')}">` +
        `<strong>${escapeHtml(b.start_time || '')}–${escapeHtml(b.end_time || '')}</strong> ` +
        `<span>${escapeHtml(b.title)}</span>` +
      `</span>`
    ).join('');

    return `<div class="template-card" data-template-id="${tpl.id}">` +
      `<div class="template-card-header">` +
        `<div>` +
          `<h3>${escapeHtml(tpl.name)}</h3>` +
          (tpl.description ? `<p class="muted">${escapeHtml(tpl.description)}</p>` : '') +
        `</div>` +
        `<button type="button" class="tpl-delete-btn" data-delete-template="${tpl.id}" title="Delete template">×</button>` +
      `</div>` +
      `<div class="template-blocks-row">${blockPills || '<span class="muted">No blocks</span>'}</div>` +
      `<div class="template-card-actions">` +
        `<button type="button" class="primary-button tpl-apply-btn" data-apply-template="${tpl.id}" data-apply-mode="append">⚡ Apply to ${state.planDay}</button>` +
        `<button type="button" class="quiet-button tpl-replace-btn" data-apply-template="${tpl.id}" data-apply-mode="replace" title="Clears existing day events first">Replace day</button>` +
      `</div>` +
    `</div>`;
  }).join('');
}

function openTemplatesModal() {
  $('#template-create-card')?.classList.add('hidden');
  renderTemplatesList();
  $('#templates-dialog')?.showModal();
}

function openSaveTemplateModal() {
  const dayEvents = filtered('event').filter(e => e.starts_at && eventOnDay(e, state.planDay)).sort((a,b) => new Date(a.starts_at) - new Date(b.starts_at));
  if (!dayEvents.length) {
    toast('Add at least one time block to this day before saving as template');
    return;
  }
  const preview = $('#save-template-preview');
  if (preview) {
    preview.innerHTML = `<div class="save-preview-title">Blocks to be saved (${dayEvents.length}):</div>` +
      `<div class="save-preview-list">` +
        dayEvents.map(e => {
          const s = fmtTime(e.starts_at);
          const en = e.ends_at ? fmtTime(e.ends_at) : 'Open';
          return `<div class="save-preview-item"><span class="save-preview-time">${s} – ${en}</span><strong>${escapeHtml(e.title)}</strong></div>`;
        }).join('') +
      `</div>`;
  }
  const nameInput = $('#save-tpl-name');
  if (nameInput) nameInput.value = `Routine (${fromDayKey(state.planDay).toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'})})`;
  $('#save-template-dialog')?.showModal();
  nameInput?.focus();
}

function addTemplateBlockRow(start = '08:00', end = '09:00', title = '', areaName = '') {
  const container = $('#tpl-blocks-builder');
  if (!container) return;
  const row = document.createElement('div');
  row.className = 'tpl-builder-row';
  const areas = state.areas.map(a => `<option value="${escapeHtml(a.name)}" ${a.name === areaName ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('');
  row.innerHTML = `
    <input type="time" class="tpl-row-start" value="${start}" required>
    <span class="muted">to</span>
    <input type="time" class="tpl-row-end" value="${end}" required>
    <input type="text" class="tpl-row-title" placeholder="Block title (e.g. GYM)" value="${escapeHtml(title)}" required>
    <select class="tpl-row-area"><option value="">No area</option>${areas}</select>
    <button type="button" class="tpl-row-remove" aria-label="Remove block">×</button>
  `;
  row.querySelector('.tpl-row-remove').addEventListener('click', () => row.remove());
  container.appendChild(row);
}

async function handleQuickAddBlock(e) {
  e?.preventDefault();
  const startInput = $('#plan-q-start');
  const endInput = $('#plan-q-end');
  const titleInput = $('#plan-q-title');
  const areaInput = $('#plan-q-area');
  if (!titleInput || !titleInput.value.trim()) return;

  let startTime = startInput?.value || '08:00';
  let endTime = endInput?.value || '09:00';
  let title = titleInput.value.trim();

  const parsed = parseTimeBlockString(title);
  if (parsed) {
    startTime = parsed.start;
    endTime = parsed.end;
    title = parsed.title;
  }

  const [y, m, d] = state.planDay.split('-').map(Number);
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  const startDate = new Date(y, m - 1, d, isNaN(sh) ? 8 : sh, isNaN(sm) ? 0 : sm, 0, 0);
  let endDay = d;
  if (!isNaN(eh) && eh < sh) endDay += 1;
  const endDate = new Date(y, m - 1, endDay, isNaN(eh) ? 9 : eh, isNaN(em) ? 0 : em, 0, 0);

  try {
    await api('/api/items', {
      method: 'POST',
      body: JSON.stringify({
        type: 'event',
        title,
        body: '',
        area_id: areaInput?.value || null,
        class_id: null,
        course: '',
        priority: 'medium',
        due_at: null,
        starts_at: startDate.toISOString(),
        ends_at: endDate.toISOString()
      })
    });
    titleInput.value = '';
    if (startInput && endInput) {
      startInput.value = endTime;
      const [nextH, nextM] = endTime.split(':').map(Number);
      const nextEndDate = new Date(y, m - 1, d, nextH + 1, nextM, 0, 0);
      endInput.value = `${String(nextEndDate.getHours()).padStart(2,'0')}:${String(nextEndDate.getMinutes()).padStart(2,'0')}`;
    }
    await refresh();
    toast(`Block added: “${title}” (${startTime} – ${endTime})`);
    titleInput.focus();
  } catch (err) {
    toast(err.message);
  }
}

async function duplicateBlock(id) {
  const ev = state.items.find(x => x.id === id);
  if (!ev || !ev.starts_at) return;
  const oldStart = new Date(ev.starts_at);
  const durMs = ev.ends_at ? (new Date(ev.ends_at).getTime() - oldStart.getTime()) : 3600000;
  const newStart = ev.ends_at ? new Date(ev.ends_at) : new Date(oldStart.getTime() + 3600000);
  const newEnd = new Date(newStart.getTime() + durMs);

  try {
    await api('/api/items', {
      method: 'POST',
      body: JSON.stringify({
        type: 'event',
        title: ev.title + ' (Copy)',
        body: ev.body || '',
        area_id: ev.area_id || null,
        class_id: ev.class_id || null,
        course: '',
        priority: ev.priority || 'medium',
        due_at: null,
        starts_at: newStart.toISOString(),
        ends_at: newEnd.toISOString()
      })
    });
    await refresh();
    toast(`Block duplicated: “${ev.title}”`);
  } catch (err) {
    toast(err.message);
  }
}

async function toggleBlockDone(id) {
  const ev = state.items.find(x => x.id === id);
  if (!ev) return;
  const nextStatus = ev.status === 'done' ? 'open' : 'done';
  try {
    await api(`/api/items/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: nextStatus })
    });
    await refresh();
    toast(nextStatus === 'done' ? `Completed: “${ev.title}” ✓` : `Reopened: “${ev.title}”`);
  } catch (err) {
    toast(err.message);
  }
}

async function applyTemplate(templateId, mode = 'append') {
  try {
    const res = await api(`/api/plan-templates/${templateId}/apply`, {
      method: 'POST',
      body: JSON.stringify({ date: state.planDay, mode })
    });
    $('#templates-dialog')?.close();
    await refresh();
    toast(`Applied routine “${res.template_name}” (${res.applied} blocks)`);
  } catch (err) {
    toast(err.message);
  }
}

function listView(type){const title=labels[state.view];let items=filtered(type);if(type==='task')items=items.filter(x=>state.filter==='all'||x.status===state.filter).sort((a,b)=>(a.due_at||'9999').localeCompare(b.due_at||'9999'));const intro={task:'Keep deadlines, classes, and next actions in one place.',note:'Save ideas, class notes, and useful context.',journal:'Reflect and see what your days are really like.',goal:'Give your longer plans a home.',event:'See what is coming up on your own calendar.'}[type];let content='';if(type==='task')content=`<div class="list-toolbar"><div class="filters"><button class="filter ${state.filter==='open'?'active':''}" data-filter="open">Open</button><button class="filter ${state.filter==='done'?'active':''}" data-filter="done">Done</button><button class="filter ${state.filter==='all'?'active':''}" data-filter="all">All</button></div><button class="tiny-link" data-new="task">+ Add task</button></div><div class="card list-card">${items.length?items.map(taskRow).join(''):empty('Nothing here yet. Add a task to get started.')}</div>`;
else if(type==='event')content=`<div class="list-toolbar"><span class="muted">${items.length} events</span><button class="tiny-link" data-new="event">+ Add event</button></div><div class="calendar-list">${items.length?items.sort((a,b)=>(a.starts_at||'').localeCompare(b.starts_at||'')).map(x=>`<div class="event-card" data-edit="${x.id}"><div class="event-date"><strong>${new Date(x.starts_at).getDate()}</strong><small>${new Date(x.starts_at).toLocaleDateString(undefined,{month:'short'})}</small></div><div class="event-body"><strong>${escapeHtml(x.title)}</strong><small>${fmtTime(x.starts_at)}${x.ends_at?' – '+fmtTime(x.ends_at):''}${x.class_name?' · '+escapeHtml(x.class_name):''}</small></div>${areaTag(x)}</div>`).join(''):empty('No events yet. Build your schedule by adding one.')}</div>`;
else content=`<div class="list-toolbar"><span class="muted">${items.length} ${title.toLowerCase()} ${items.length===1?'entry':'entries'}</span><button class="tiny-link" data-new="${type}">+ Add ${type}</button></div><div class="note-grid">${items.length?items.map(x=>`<article class="note-card ${type==='goal'?'goal-card':''}" data-edit="${x.id}"><div class="note-icon">${type==='journal'?'✎':type==='goal'?'◎':'▤'}</div><strong>${escapeHtml(x.title)}</strong><p>${escapeHtml(x.body||'No details yet')}</p><footer>${escapeHtml(x.area_name||'Uncategorized')} · ${fmtDate(itemDate(x))}</footer></article>`).join(''):empty(`No ${title.toLowerCase()} yet. Capture your first one.`)}</div>`;
return `<div class="hero"><div><div class="eyebrow">${state.area?escapeHtml(area(state.area)?.name||'LIFE AREA'):'YOUR WORKSPACE'}</div><h1 class="page-title">${title}<span style="color:var(--accent-primary)">.</span></h1><p class="muted section-desc">${intro}</p></div></div>${content}`}
function assistantView(){const badgeText=state.aiSettings?`${escapeHtml(state.aiSettings.provider)} · ${escapeHtml(state.aiSettings.model)}`:'Local workspace · Ollama';const localOnly=state.aiSettings?.type==='ollama';return '<div class="hero agent-hero"><div class="agent-hero-copy"><div class="eyebrow">AUTONOMOUS SECOND BRAIN</div><h1 class="page-title">Ask Orbit<span style="color:var(--accent-primary)">.</span></h1><p class="muted">A controlled cognitive partner for searching memory, researching targets, shaping plans, and staging actions.</p></div><div class="agent-hero-badge" data-open-ai-settings style="cursor:pointer;" title="Click to configure AI Engine"><span class="agent-hero-orb" aria-hidden="true">✦</span><div><strong>'+(state.aiSettings?.has_groq?'Free Cloud Accelerated':state.aiSettings?.has_openrouter?'Cloud Accelerated':'Private & Unlimited')+'</strong><small>'+badgeText+' ⚙</small></div></div></div><div class="assistant-layout agent-layout"><section class="card ask-card agent-card"><header class="agent-header"><div class="agent-avatar" aria-hidden="true"><span>✦</span><i></i></div><div class="agent-header-copy"><h2>Orbit Second Brain</h2><p>Grounded in full workspace context &amp; hybrid memory</p></div><span class="agent-local-badge"><span class="agent-status-dot"></span>'+(state.agentBusy?'Reasoning':'Online')+'</span></header><div id="agent-activity" class="agent-activity" aria-live="polite"></div><div id="chat-log" class="chat-log" aria-live="polite">'+(state.chat.length?state.chat.map(chatMarkup).join(''):'<div class="chat-bubble answer welcome-bubble"><div class="markdown-content"><p><strong>Welcome to your second brain.</strong> Orbit remembers your workspace context, past conversations, and life areas.</p><ul><li>Ask about priorities or deadlines: <em>“What should I focus on today?”</em></li><li>Create or update records: <em>“Add CS 3600 homework due Friday 5pm”</em></li><li>Research a professor or role and stage a tailored draft in Action Center.</li></ul></div></div>')+'</div><form id="ask-form" class="ask-form"><div class="agent-input-wrap"><span aria-hidden="true">⌘</span><input name="question" maxlength="500" required placeholder="Ask Orbit anything or command an action (e.g. “Research this professor and draft an email”)…" aria-label="Ask Orbit"></div><button class="primary-button" type="submit">Ask Orbit <span aria-hidden="true">↗</span></button></form></section><aside class="card agent-side-card"><div class="card-head"><div><div class="eyebrow">SHORTCUTS</div><h2>Start with a prompt</h2></div><span class="badge">Second Brain</span></div><div class="suggestions agent-suggestions"><button data-ask="What should I focus on today?"><span class="suggestion-icon">✦</span><span><strong>Focus for today</strong><small>Surface the work that deserves attention</small></span><b>↗</b></button><button data-ask="Break down Project 2 into four milestones"><span class="suggestion-icon">⌘</span><span><strong>Break down a project</strong><small>Turn one task into linked milestones</small></span><b>↗</b></button><button data-ask="Research this professor and draft a tailored cold email for my approval: "><span class="suggestion-icon">↗</span><span><strong>Draft grounded outreach</strong><small>Research, personalize, and stage for approval</small></span><b>↗</b></button></div><div class="agent-side-divider"></div><div class="agent-flow"><div><span>01</span><strong>Recall &amp; research</strong><small>Uses approved profile facts and cited sources.</small></div><div><span>02</span><strong>Draft &amp; validate</strong><small>Prepares exact content without inventing claims.</small></div><div><span>03</span><strong>You stay in control</strong><small>External actions wait in Action Center.</small></div></div><div class="agent-privacy"><span>◉</span><p><strong>'+(localOnly?'Local model active.':'Cloud model active.')+'</strong><small>'+(localOnly?'Workspace reasoning stays on this Mac; web queries go to Brave when used.':'Prompts are sent to the selected AI provider; web queries go to Brave when used.')+'</small></p></div></aside></div>'}
function actionCard(action){const evidence=(action.evidence||[]).map(x=>'<a href="'+escapeHtml(x.url)+'" target="_blank" rel="noreferrer">'+escapeHtml(x.title||new URL(x.url).hostname)+'</a>').join('');const recipient=action.recipient_name||action.recipient_address||'Target not specified';let controls='';if(action.status==='pending_approval')controls='<button class="primary-button" data-action-decision="approve" data-action-id="'+action.id+'">Approve draft</button><button class="quiet-button" data-action-decision="reject" data-action-id="'+action.id+'">Reject</button>';else if(action.status==='approved')controls='<button class="primary-button" data-action-handoff="'+action.id+'">Open safe handoff</button>';else if(action.status==='handed_off')controls='<button class="primary-button" data-action-complete="'+action.id+'">I sent/submitted it</button>';return '<article class="action-card"><header><div><span class="action-kind">'+escapeHtml(action.kind.replaceAll('_',' '))+'</span><h3>'+escapeHtml(recipient)+'</h3></div><span class="action-status '+escapeHtml(action.status)+'">'+escapeHtml(action.status.replaceAll('_',' '))+'</span></header>'+(action.subject?'<strong class="action-subject">'+escapeHtml(action.subject)+'</strong>':'')+'<pre>'+escapeHtml(action.body)+'</pre>'+(action.rationale?'<p class="muted">'+escapeHtml(action.rationale)+'</p>':'')+(evidence?'<div class="action-evidence"><strong>Evidence</strong>'+evidence+'</div>':'')+'<div class="action-controls">'+controls+'</div></article>'}
function actionCenterView(){const profile=state.agentic.profile||[],actions=state.agentic.actions||[],pending=actions.filter(x=>x.status==='pending_approval').length;return '<div class="hero"><div><div class="eyebrow">CONTROLLED EXECUTION</div><h1 class="page-title">Action Center<span style="color:var(--accent-primary)">.</span></h1><p class="muted">Research and drafting can be automatic. Nothing leaves this Mac until you approve the exact action.</p></div><button class="primary-button" data-action-start>Ask Orbit to research &amp; draft</button></div><div class="action-layout"><section class="card action-profile"><div class="card-head"><div><div class="eyebrow">TRUTH SOURCE</div><h2>Your profile</h2></div><span class="badge">'+profile.length+' facts</span></div><p class="muted">Only add facts you want Orbit to use in outreach and applications. Mark private identifiers sensitive; the drafting agent will not receive them.</p><form id="profile-fact-form" class="profile-fact-form"><input name="key" required maxlength="100" placeholder="Fact name, e.g. Graduation"><textarea name="value" required maxlength="4000" rows="2" placeholder="Verified value, e.g. May 2028"></textarea><label><input name="sensitive" type="checkbox"> Sensitive — never expose to the drafting model</label><button class="primary-button" type="submit">Save fact</button></form><div class="profile-facts">'+(profile.length?profile.map(x=>'<div><span><strong>'+escapeHtml(x.fact_key)+'</strong><small>'+escapeHtml(x.fact_value)+' · '+escapeHtml(x.sensitivity)+'</small></span><button data-profile-delete="'+x.id+'" aria-label="Delete '+escapeHtml(x.fact_key)+'">×</button></div>').join(''):empty('Add your first verified profile fact.'))+'</div></section><section class="action-queue"><div class="card-head"><div><div class="eyebrow">APPROVAL QUEUE</div><h2>'+pending+' waiting for review</h2></div><span class="badge">'+(state.aiSettings?.has_web_search?'Web research ready':'Web key needed')+'</span></div>'+(actions.length?actions.map(actionCard).join(''):empty('No external actions yet. Ask Orbit to research a professor, role, or person and draft a tailored message.'))+'</section></div>'}
function renderProgressRing(pct, color, size = 68, stroke = 7) {
  const radius = (size - stroke) / 2;
  const circ = 2 * Math.PI * radius;
  const clamped = Math.min(100, Math.max(0, pct));
  const offset = circ - (clamped / 100) * circ;
  return `
    <svg class="health-progress-ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${size/2}" cy="${size/2}" r="${radius}" stroke="rgba(255,255,255,0.08)" stroke-width="${stroke}" fill="transparent" />
      <circle cx="${size/2}" cy="${size/2}" r="${radius}" stroke="${color}" stroke-width="${stroke}" fill="transparent"
        stroke-dasharray="${circ}" stroke-dashoffset="${offset}" stroke-linecap="round"
        transform="rotate(-90 ${size/2} ${size/2})" />
    </svg>
  `;
}

function timeAgo(dateString) {
  if (!dateString) return 'Never';
  const diffSec = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);
  if (diffSec < 60) return 'Just now';
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

async function uploadHealthExportFile(file, statusEl) {
  if (!file) return;
  if (statusEl) {
    statusEl.classList.remove('hidden');
    statusEl.innerHTML = `<div class="uploading-spinner-row"><span class="spinner-inline"></span><span>Parsing Apple Health biometrics (${(file.size / (1024 * 1024)).toFixed(1)} MB)...</span></div>`;
  }
  toast(`Streaming Apple Health export (${file.name})...`);
  try {
    const res = await fetch('/api/health/import-export', {
      method: 'POST',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'X-Filename': file.name
      },
      body: file
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to parse export file');
    if (statusEl) {
      statusEl.innerHTML = `<span class="success-text">✅ ${data.message}</span>`;
    }
    toast(`✅ ${data.message}`);
    await refresh();
    setTimeout(() => {
      $('#health-setup-dialog')?.close();
    }, 1200);
  } catch (err) {
    if (statusEl) {
      statusEl.innerHTML = `<span class="error-text">❌ ${err.message}</span>`;
    }
    toast(`Import failed: ${err.message}`);
  }
}

async function clearAllHealthData() {
  if (!confirm('Clear all Apple Health biometrics and reset to a clean slate?')) return;
  try {
    await api('/api/health/clear', { method: 'POST' });
    toast('All health data cleared');
    $('#health-setup-dialog')?.close();
    await refresh();
  } catch (err) {
    toast(err.message);
  }
}

async function openHealthSetupModal() {
  try {
    const info = await api('/api/health/setup');
    const combinedInput = $('#health-setup-combined-url');
    const ipInput = $('#health-setup-ip-url');
    if (combinedInput) combinedInput.value = `${info.webhook_url}?token=${info.sync_token}`;
    if (ipInput) ipInput.value = `${info.ip_webhook_url}?token=${info.sync_token}`;
  } catch {}
  $('#health-setup-dialog')?.showModal();
}

async function loadHealthMetrics(date = null, range = null) {
  if (date !== null) state.healthDate = date;
  if (range !== null) state.healthRange = range;
  const p = new URLSearchParams();
  if (state.healthDate) p.set('date', state.healthDate);
  if (state.healthRange) p.set('range', state.healthRange);
  try {
    state.healthMetrics = await api('/api/health/metrics?' + p.toString());
    if (!state.healthDate && state.healthMetrics.date) {
      state.healthDate = state.healthMetrics.date;
    }
  } catch (err) {
    console.error('Failed to load health metrics', err);
  }
}

function formatHoursMins(hoursVal) {
  if (!hoursVal || hoursVal <= 0) return '0h 0m';
  const h = Math.floor(hoursVal);
  const m = Math.round((hoursVal - h) * 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function renderSleepQualityScoreCard(score, efficiencyPct, sleepHours, inBedHours) {
  let ratingText = 'Unrecorded';
  let ratingClass = 'sleep-rating-neutral';
  let ratingDesc = 'Wear Apple Watch to track sleep cycles & restorative recovery.';
  if (score >= 85) {
    ratingText = 'Optimal Recovery · Restorative';
    ratingClass = 'sleep-rating-optimal';
    ratingDesc = 'Exceptional slow-wave & REM balance. Nervous system fully restored.';
  } else if (score >= 70) {
    ratingText = 'Good Sleep · Recharged';
    ratingClass = 'sleep-rating-good';
    ratingDesc = 'Solid sleep continuity and adequate deep recovery for baseline performance.';
  } else if (score >= 50) {
    ratingText = 'Fair · Interrupted Sleep';
    ratingClass = 'sleep-rating-fair';
    ratingDesc = 'Fragmented cycles or lower restorative stages. Consider an earlier wind-down.';
  } else if (score > 0) {
    ratingText = 'Suboptimal Rest';
    ratingClass = 'sleep-rating-low';
    ratingDesc = 'Elevated awake interruptions or significantly truncated sleep duration.';
  }

  const scoreDisplay = score > 0 ? score : (sleepHours > 0 ? Math.min(95, Math.round((sleepHours / 8) * 85)) : 0);
  const effDisplay = efficiencyPct > 0 ? efficiencyPct : (sleepHours > 0 ? 96 : 0);

  return `
    <div class="sleep-score-hero">
      <div class="sleep-score-circle-box">
        <div class="sleep-score-ring-wrap">
          ${renderProgressRing(scoreDisplay, scoreDisplay >= 80 ? '#10b981' : scoreDisplay >= 65 ? '#06b6d4' : scoreDisplay >= 50 ? '#f59e0b' : '#8b5cf6', 82, 8)}
          <div class="sleep-score-number">
            <strong>${scoreDisplay || '—'}</strong>
            <small>/100</small>
          </div>
        </div>
        <div class="sleep-score-label-col">
          <div class="sleep-score-eyebrow">POLYSOMNOGRAPHY SCORE</div>
          <h4 class="sleep-score-rating ${ratingClass}">${ratingText}</h4>
          <p class="sleep-score-desc muted">${ratingDesc}</p>
        </div>
      </div>
      <div class="sleep-efficiency-stats">
        <div class="sleep-eff-stat">
          <span class="muted">Sleep Efficiency</span>
          <strong>${effDisplay}%</strong>
          <small class="muted">Time asleep vs in bed</small>
        </div>
        <div class="sleep-eff-stat">
          <span class="muted">Total In Bed</span>
          <strong>${formatHoursMins(inBedHours || sleepHours)}</strong>
          <small class="muted">${formatHoursMins(sleepHours)} actual sleep</small>
        </div>
      </div>
    </div>
  `;
}

function renderSleepStageHypnogram(sleepDetails, totalSleepHours) {
  const core = Number(sleepDetails.core_hours || 0);
  const deep = Number(sleepDetails.deep_hours || 0);
  const rem = Number(sleepDetails.rem_hours || 0);
  const awake = Number(sleepDetails.awake_hours || 0);
  const total = Number(totalSleepHours || (core + deep + rem) || 0);
  const inBed = Number(sleepDetails.in_bed_hours || (total + awake) || total);

  const hasStages = (deep > 0 || rem > 0 || core > 0);

  if (!hasStages) {
    if (total > 0) {
      return `
        <div class="sleep-hypnogram-box">
          <div class="hypno-bar-wrapper">
            <div class="hypno-bar single-stage" style="background: linear-gradient(90deg, #8b5cf6, #6366f1);">
              <span class="hypno-bar-label">${formatHoursMins(total)} recorded sleep duration</span>
            </div>
          </div>
          <p class="muted hypno-note">Apple Watch sleep stages (Deep, REM, Core, Awake) record automatically when wearing your watch to sleep.</p>
        </div>
      `;
    }
    return `
      <div class="sleep-hypnogram-box empty-box">
        <p class="muted">No sleep session recorded for this day.</p>
      </div>
    `;
  }

  const deepPct = total > 0 ? Math.round((deep / total) * 100) : 0;
  const remPct = total > 0 ? Math.round((rem / total) * 100) : 0;
  const corePct = total > 0 ? Math.round((core / total) * 100) : 0;
  const awakePct = inBed > 0 ? Math.round((awake / inBed) * 100) : 0;

  return `
    <div class="sleep-hypnogram-box">
      <div class="hypno-bar-wrapper">
        <div class="hypno-bar segmented">
          <div class="hypno-segment seg-deep" style="width: ${deepPct}%;" title="Deep Sleep: ${formatHoursMins(deep)} (${deepPct}%)">
            ${deepPct >= 12 ? `<span>Deep ${deepPct}%</span>` : ''}
          </div>
          <div class="hypno-segment seg-rem" style="width: ${remPct}%;" title="REM Sleep: ${formatHoursMins(rem)} (${remPct}%)">
            ${remPct >= 12 ? `<span>REM ${remPct}%</span>` : ''}
          </div>
          <div class="hypno-segment seg-core" style="width: ${corePct}%;" title="Core Sleep: ${formatHoursMins(core)} (${corePct}%)">
            ${corePct >= 12 ? `<span>Core ${corePct}%</span>` : ''}
          </div>
          ${awake > 0 ? `
            <div class="hypno-segment seg-awake" style="width: ${Math.max(3, awakePct)}%;" title="Awake: ${formatHoursMins(awake)} (${awakePct}%)">
              ${awakePct >= 8 ? `<span>Awake</span>` : ''}
            </div>
          ` : ''}
        </div>
      </div>
      <div class="hypno-legend">
        <div class="legend-pill"><span class="legend-dot dot-deep"></span><strong>Deep:</strong> ${formatHoursMins(deep)} <small>(${deepPct}%)</small></div>
        <div class="legend-pill"><span class="legend-dot dot-rem"></span><strong>REM:</strong> ${formatHoursMins(rem)} <small>(${remPct}%)</small></div>
        <div class="legend-pill"><span class="legend-dot dot-core"></span><strong>Core:</strong> ${formatHoursMins(core)} <small>(${corePct}%)</small></div>
        <div class="legend-pill"><span class="legend-dot dot-awake"></span><strong>Awake:</strong> ${formatHoursMins(awake)} <small>(${awakePct}%)</small></div>
      </div>
    </div>
  `;
}

function renderSleepStageBenchmarkCards(sleepDetails, totalSleepHours) {
  const core = Number(sleepDetails.core_hours || 0);
  const deep = Number(sleepDetails.deep_hours || 0);
  const rem = Number(sleepDetails.rem_hours || 0);
  const awake = Number(sleepDetails.awake_hours || 0);
  const total = Number(totalSleepHours || (core + deep + rem) || 0);

  const deepPct = total > 0 ? Math.round((deep / total) * 100) : 0;
  const remPct = total > 0 ? Math.round((rem / total) * 100) : 0;
  const corePct = total > 0 ? Math.round((core / total) * 100) : 0;
  const awakePct = total > 0 ? Math.round((awake / (total + awake)) * 100) : 0;

  const deepStatus = deepPct >= 15 ? 'Optimal' : deepPct >= 10 ? 'Moderate' : 'Low';
  const remStatus = remPct >= 20 ? 'Optimal' : remPct >= 15 ? 'Moderate' : 'Low';
  const coreStatus = (corePct >= 40 && corePct <= 60) ? 'Optimal' : 'Standard';
  const awakeStatus = awakePct <= 10 ? 'Optimal' : 'Elevated';

  return `
    <div class="stage-benchmarks-grid">
      <!-- Deep Sleep Card -->
      <div class="stage-benchmark-card stage-card-deep">
        <div class="stage-card-top">
          <div class="stage-badge-group">
            <span class="stage-indicator-dot dot-deep"></span>
            <strong>Deep Sleep</strong>
          </div>
          <span class="stage-status-badge ${deepStatus === 'Optimal' ? 'badge-optimal' : 'badge-suboptimal'}">${deepStatus}</span>
        </div>
        <div class="stage-card-val">
          <span class="stage-time">${formatHoursMins(deep)}</span>
          <span class="stage-pct">${deepPct}% of sleep</span>
        </div>
        <div class="stage-benchmark-track">
          <div class="stage-benchmark-fill fill-deep" style="width: ${Math.min(100, (deepPct / 25) * 100)}%;"></div>
        </div>
        <div class="stage-target-meta">
          <span>Clinical Benchmark: <strong>15% – 25%</strong></span>
          <small class="muted">Slow-wave cellular regeneration, GH secretion, immune repair</small>
        </div>
      </div>

      <!-- REM Sleep Card -->
      <div class="stage-benchmark-card stage-card-rem">
        <div class="stage-card-top">
          <div class="stage-badge-group">
            <span class="stage-indicator-dot dot-rem"></span>
            <strong>REM Sleep</strong>
          </div>
          <span class="stage-status-badge ${remStatus === 'Optimal' ? 'badge-optimal' : 'badge-suboptimal'}">${remStatus}</span>
        </div>
        <div class="stage-card-val">
          <span class="stage-time">${formatHoursMins(rem)}</span>
          <span class="stage-pct">${remPct}% of sleep</span>
        </div>
        <div class="stage-benchmark-track">
          <div class="stage-benchmark-fill fill-rem" style="width: ${Math.min(100, (remPct / 25) * 100)}%;"></div>
        </div>
        <div class="stage-target-meta">
          <span>Clinical Benchmark: <strong>20% – 25%</strong></span>
          <small class="muted">Cognitive processing, neuroplasticity, memory consolidation</small>
        </div>
      </div>

      <!-- Core / Light Sleep Card -->
      <div class="stage-benchmark-card stage-card-core">
        <div class="stage-card-top">
          <div class="stage-badge-group">
            <span class="stage-indicator-dot dot-core"></span>
            <strong>Core / Light Sleep</strong>
          </div>
          <span class="stage-status-badge ${coreStatus === 'Optimal' ? 'badge-optimal' : 'badge-suboptimal'}">${coreStatus}</span>
        </div>
        <div class="stage-card-val">
          <span class="stage-time">${formatHoursMins(core)}</span>
          <span class="stage-pct">${corePct}% of sleep</span>
        </div>
        <div class="stage-benchmark-track">
          <div class="stage-benchmark-fill fill-core" style="width: ${Math.min(100, (corePct / 55) * 100)}%;"></div>
        </div>
        <div class="stage-target-meta">
          <span>Clinical Benchmark: <strong>45% – 55%</strong></span>
          <small class="muted">Physiological maintenance, cardiac deceleration, motor memory</small>
        </div>
      </div>

      <!-- Awake / Interruption Card -->
      <div class="stage-benchmark-card stage-card-awake">
        <div class="stage-card-top">
          <div class="stage-badge-group">
            <span class="stage-indicator-dot dot-awake"></span>
            <strong>Awake Time</strong>
          </div>
          <span class="stage-status-badge ${awakeStatus === 'Optimal' ? 'badge-optimal' : 'badge-suboptimal'}">${awakeStatus}</span>
        </div>
        <div class="stage-card-val">
          <span class="stage-time">${formatHoursMins(awake)}</span>
          <span class="stage-pct">${awakePct}% in bed</span>
        </div>
        <div class="stage-benchmark-track">
          <div class="stage-benchmark-fill fill-awake" style="width: ${Math.min(100, (awakePct / 15) * 100)}%;"></div>
        </div>
        <div class="stage-target-meta">
          <span>Clinical Benchmark: <strong>&lt; 10%</strong></span>
          <small class="muted">Micro-arousals, restless shifts, brief nocturnal awakenings</small>
        </div>
      </div>
    </div>
  `;
}

function renderStackedSleepChart(history, goalHours = 8) {
  if (!history || history.length <= 1) return '';
  const maxH = Math.max(goalHours, ...history.map(d => d.sleep_hours || 0), 9);

  const bars = history.map(d => {
    const dt = new Date(d.date + 'T12:00:00Z');
    const label = history.length > 14 
      ? dt.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })
      : dt.toLocaleDateString(undefined, { weekday: 'narrow' });
    const core = d.sleep_details?.core_hours || 0;
    const deep = d.sleep_details?.deep_hours || 0;
    const rem = d.sleep_details?.rem_hours || 0;
    const awake = d.sleep_details?.awake_hours || 0;
    const total = d.sleep_hours || (core + deep + rem);

    const hasStages = (deep > 0 || rem > 0 || core > 0);
    const totalHeightPct = Math.min(100, Math.round((total / maxH) * 100));

    let barContent = '';
    if (hasStages && total > 0) {
      const dPct = (deep / total) * 100;
      const rPct = (rem / total) * 100;
      const cPct = (core / total) * 100;
      barContent = `
        <div class="stacked-bar-inner" style="height: ${Math.max(6, totalHeightPct)}%;">
          <div class="stack-seg seg-awake-bar" style="height: ${awake > 0 ? Math.min(20, (awake / total) * 100) : 0}%"></div>
          <div class="stack-seg seg-core-bar" style="height: ${cPct}%"></div>
          <div class="stack-seg seg-rem-bar" style="height: ${rPct}%"></div>
          <div class="stack-seg seg-deep-bar" style="height: ${dPct}%"></div>
        </div>
      `;
    } else {
      barContent = `
        <div class="stacked-bar-inner" style="height: ${Math.max(6, totalHeightPct)}%;">
          <div class="stack-seg seg-core-bar" style="height: 100%"></div>
        </div>
      `;
    }

    const tooltip = `${d.date}: ${Number(total).toFixed(1)}h total${hasStages ? ` (Deep: ${Number(deep).toFixed(1)}h, REM: ${Number(rem).toFixed(1)}h, Core: ${Number(core).toFixed(1)}h)` : ''}`;

    return `
      <div class="stacked-chart-col" title="${tooltip}">
        <div class="stacked-bar-wrap">
          ${barContent}
        </div>
        <span class="stacked-bar-label">${label}</span>
      </div>
    `;
  }).join('');

  return `
    <div class="multi-day-sleep-chart-section">
      <div class="chart-subhead">
        <div>
          <h4>Sleep Architecture Progression Across ${history.length} Days</h4>
          <small class="muted">Nightly distribution of Deep, REM, Core, and Awake stages</small>
        </div>
        <div class="chart-legend-row">
          <span class="leg-item"><i class="dot dot-deep"></i>Deep</span>
          <span class="leg-item"><i class="dot dot-rem"></i>REM</span>
          <span class="leg-item"><i class="dot dot-core"></i>Core</span>
          <span class="leg-item"><i class="dot dot-awake"></i>Awake</span>
        </div>
      </div>
      <div class="stacked-chart-container">
        <div class="stacked-chart-grid-line" style="bottom: ${Math.round((goalHours / maxH) * 100)}%;">
          <span class="goal-line-label">${goalHours}h target</span>
        </div>
        <div class="stacked-chart-bars-wrap">
          ${bars}
        </div>
      </div>
    </div>
  `;
}

function renderCardioRecoverySection(record, history, aggregates) {
  const rhr = record.resting_heart_rate !== null ? Math.round(record.resting_heart_rate) : null;
  const minHr = record.min_heart_rate !== null ? Math.round(record.min_heart_rate) : null;
  const maxHr = record.max_heart_rate !== null ? Math.round(record.max_heart_rate) : null;
  const latestHr = record.latest_heart_rate !== null ? Math.round(record.latest_heart_rate) : null;
  const hrv = record.hrv_ms !== null ? Math.round(record.hrv_ms) : null;

  const baselineRhr = aggregates?.avg_resting_hr || null;
  const baselineHrv = aggregates?.avg_hrv || null;

  let hrvZone = 'No HRV Data';
  let hrvZoneClass = 'recovery-zone-none';
  let hrvZoneDesc = 'Heart Rate Variability measures autonomic nervous system balance.';
  let hrvZonePct = 50;

  if (hrv !== null) {
    if (hrv >= 60) {
      hrvZone = 'Optimal Recovery · High Readiness';
      hrvZoneClass = 'recovery-zone-high';
      hrvZoneDesc = 'High autonomic flexibility & parasympathetic tone. Primed for deep work or training.';
      hrvZonePct = Math.min(100, Math.round((hrv / 100) * 100));
    } else if (hrv >= 42) {
      hrvZone = 'Balanced Recovery · Normal Adaptation';
      hrvZoneClass = 'recovery-zone-mid';
      hrvZoneDesc = 'Steady autonomic homeostasis. Normal capacity for daily exertion.';
      hrvZonePct = Math.round((hrv / 100) * 100);
    } else {
      hrvZone = 'Low Recovery · Sympathetic Strain';
      hrvZoneClass = 'recovery-zone-low';
      hrvZoneDesc = 'Elevated systemic stress detected. Prioritize sleep and active recovery.';
      hrvZonePct = Math.max(12, Math.round((hrv / 100) * 100));
    }
  }

  let rhrDeltaText = '';
  if (rhr !== null && baselineRhr !== null && baselineRhr !== rhr) {
    const delta = rhr - baselineRhr;
    if (delta < 0) {
      rhrDeltaText = `<span class="delta-positive">▼ ${Math.abs(delta)} bpm below baseline (${baselineRhr} bpm)</span>`;
    } else {
      rhrDeltaText = `<span class="delta-elevated">▲ ${delta} bpm above baseline (${baselineRhr} bpm)</span>`;
    }
  } else if (baselineRhr !== null) {
    rhrDeltaText = `<span class="muted">Matches ${history.length}-day baseline: ${baselineRhr} bpm</span>`;
  }

  return `
    <section class="card health-cardio-card">
      <div class="card-head">
        <div>
          <div class="eyebrow">AUTONOMIC &amp; CARDIAC HEALTH</div>
          <h2>Cardio &amp; Recovery Analytics</h2>
        </div>
        <span class="badge ${hrvZoneClass}">${hrvZone}</span>
      </div>

      <div class="cardio-stats-grid">
        <!-- Resting HR Box -->
        <div class="cardio-stat-box">
          <span class="cardio-box-label">Resting Heart Rate</span>
          <div class="cardio-main-num">
            <strong>${rhr !== null ? rhr : '—'}</strong>
            <small>bpm</small>
          </div>
          <div class="cardio-meta-sub">
            ${rhrDeltaText || '<span class="muted">Apple Watch basal cardiac rate</span>'}
          </div>
        </div>

        <!-- Heart Rate Span Box -->
        <div class="cardio-stat-box">
          <span class="cardio-box-label">Heart Rate Span (Min to Max)</span>
          <div class="cardio-span-display">
            <div class="span-point">
              <small class="muted">Min</small>
              <strong>${minHr !== null ? `${minHr} bpm` : (rhr !== null ? `${Math.max(40, rhr - 6)} bpm` : '—')}</strong>
            </div>
            <div class="span-bar-wrap">
              <div class="span-bar-fill"></div>
              ${rhr !== null ? `<div class="span-marker" style="left: 35%;" title="Resting HR: ${rhr} bpm"></div>` : ''}
            </div>
            <div class="span-point">
              <small class="muted">Max</small>
              <strong>${maxHr !== null ? `${maxHr} bpm` : (latestHr !== null ? `${latestHr} bpm` : '—')}</strong>
            </div>
          </div>
          <div class="cardio-meta-sub">
            <span class="muted">${latestHr !== null ? `Latest Reading: ${latestHr} bpm` : 'Photoplethysmography sensor readings'}</span>
          </div>
        </div>

        <!-- HRV Readiness Box -->
        <div class="cardio-stat-box">
          <span class="cardio-box-label">Heart Rate Variability (HRV)</span>
          <div class="cardio-main-num">
            <strong>${hrv !== null ? hrv : '—'}</strong>
            <small>ms (SDNN)</small>
          </div>
          <div class="hrv-gauge-track">
            <div class="hrv-gauge-fill ${hrvZoneClass}" style="width: ${hrvZonePct}%;"></div>
          </div>
          <div class="cardio-meta-sub">
            <span class="muted">${baselineHrv ? `Avg: ${baselineHrv} ms · ` : ''}${hrvZoneDesc}</span>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderMultiDayAggregatesBanner(aggregates, range) {
  if (!aggregates || range === 'day') return '';
  const rangeLabel = range === 'all' ? 'All-Time Historical' : `Last ${range} Days`;
  return `
    <div class="card health-aggregates-banner">
      <div class="aggregates-header">
        <div>
          <div class="eyebrow">MULTI-DAY PERFORMANCE LEDGER</div>
          <h3>${rangeLabel} Aggregates</h3>
        </div>
        <span class="badge badge-accent">${aggregates.total_days} Active Days Recorded</span>
      </div>
      <div class="aggregates-grid">
        <div class="agg-col">
          <span class="agg-label">Total Steps</span>
          <strong class="agg-val">${Number(aggregates.total_steps || 0).toLocaleString()}</strong>
          <small class="muted">${Number(aggregates.avg_steps || 0).toLocaleString()} avg / day</small>
        </div>
        <div class="agg-col">
          <span class="agg-label">Active Calories</span>
          <strong class="agg-val">${Number(aggregates.total_active_calories || 0).toLocaleString()}<small> kcal</small></strong>
          <small class="muted">${Math.round(aggregates.avg_active_calories || 0)} avg / day</small>
        </div>
        <div class="agg-col">
          <span class="agg-label">Average Sleep</span>
          <strong class="agg-val">${aggregates.avg_sleep_hours ? `${aggregates.avg_sleep_hours}h` : '—'}</strong>
          <small class="muted">${aggregates.avg_sleep_score ? `Score: ${aggregates.avg_sleep_score}/100 · ` : ''}${aggregates.avg_sleep_efficiency ? `${aggregates.avg_sleep_efficiency}% eff` : ''}</small>
        </div>
        <div class="agg-col">
          <span class="agg-label">Resting HR Baseline</span>
          <strong class="agg-val">${aggregates.avg_resting_hr ? `${aggregates.avg_resting_hr} bpm` : '—'}</strong>
          <small class="muted">${aggregates.avg_hrv ? `Avg HRV: ${aggregates.avg_hrv} ms` : 'Basal cardiac tone'}</small>
        </div>
        <div class="agg-col">
          <span class="agg-label">Workouts</span>
          <strong class="agg-val">${aggregates.total_workouts || 0} sessions</strong>
          <small class="muted">${aggregates.total_workout_minutes || 0} active exercise mins</small>
        </div>
      </div>
    </div>
  `;
}

function healthHubView() {
  const queryDate = state.healthDate || state.healthMetrics?.date || (state.healthMetrics?.latest?.date || dayKey(new Date()));
  if (!state.healthDate) state.healthDate = queryDate;
  const range = state.healthRange || '7';

  const selectedDay = state.healthMetrics?.selected_day || state.healthMetrics?.today || {
    date: queryDate,
    steps: 0, distance_km: 0, active_calories: 0, resting_heart_rate: null,
    latest_heart_rate: null, min_heart_rate: null, max_heart_rate: null,
    hrv_ms: null, sleep_hours: 0, sleep_details: {},
    water_ml: 0, weight_kg: null, workouts: [], last_synced_at: null
  };
  const activeRecord = selectedDay;
  const latest = state.healthMetrics?.latest || null;
  const syncSource = state.healthMetrics?.sync_source || 'none';
  const totalDays = state.healthMetrics?.total_days || 0;
  const latestDate = state.healthMetrics?.latest_date || null;
  const availableDates = state.healthMetrics?.available_dates || [];
  const aggregates = state.healthMetrics?.aggregates || null;
  const history = state.healthMetrics?.history || [];
  const settings = state.healthMetrics?.settings || state.health?.settings || {
    daily_step_goal: 10000, daily_calorie_goal: 600, daily_sleep_goal: 8, daily_water_goal: 2500
  };

  const isConnected = totalDays > 0 || Boolean(activeRecord.last_synced_at) || Boolean(latest);
  const isViewingToday = activeRecord.date === dayKey(new Date());

  const stepPct = Math.round((activeRecord.steps / settings.daily_step_goal) * 100) || 0;
  const calPct = Math.round((activeRecord.active_calories / settings.daily_calorie_goal) * 100) || 0;
  const sleepPct = Math.round((activeRecord.sleep_hours / settings.daily_sleep_goal) * 100) || 0;
  const waterPct = Math.round((activeRecord.water_ml / settings.daily_water_goal) * 100) || 0;

  const sleepH = Math.floor(activeRecord.sleep_hours);
  const sleepM = Math.round((activeRecord.sleep_hours - sleepH) * 60);

  let recoveryLabel = 'No HRV Data';
  let recoveryClass = 'muted-pill';
  if (activeRecord.hrv_ms !== null) {
    if (activeRecord.hrv_ms >= 60) {
      recoveryLabel = 'High Recovery · Ready to Train';
      recoveryClass = 'recovery-high';
    } else if (activeRecord.hrv_ms >= 42) {
      recoveryLabel = 'Normal Recovery · Balanced';
      recoveryClass = 'recovery-mid';
    } else {
      recoveryLabel = 'Low Recovery · Prioritize Rest';
      recoveryClass = 'recovery-low';
    }
  }

  const workouts = Array.isArray(activeRecord.workouts) ? activeRecord.workouts : [];
  const tasks = filtered('task');
  const openTasks = tasks.filter(t => t.status === 'open');
  const doneTasks = tasks.filter(t => t.status === 'done');

  const sparkMaxSteps = Math.max(settings.daily_step_goal, ...history.map(h => h.steps || 0), 1000);
  const sparkMaxCal = Math.max(settings.daily_calorie_goal, ...history.map(h => h.active_calories || 0), 500);

  const stepBars = history.map((day, idx) => {
    const d = new Date(day.date + 'T12:00:00Z');
    const dayName = history.length > 14 ? d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' }) : d.toLocaleDateString(undefined, { weekday: 'narrow' });
    const isSelected = day.date === activeRecord.date;
    const heightPct = Math.min(100, Math.round((day.steps / sparkMaxSteps) * 100));
    const metGoal = day.steps >= settings.daily_step_goal;
    return `
      <div class="trend-col ${isSelected ? 'trend-today' : ''}" title="${day.date}: ${Number(day.steps).toLocaleString()} steps">
        <div class="trend-bar-wrap">
          <div class="trend-bar ${metGoal ? 'goal-met' : ''}" style="height:${Math.max(4, heightPct)}%"></div>
        </div>
        <span class="trend-label">${dayName}</span>
      </div>
    `;
  }).join('');

  const calBars = history.map((day, idx) => {
    const d = new Date(day.date + 'T12:00:00Z');
    const dayName = history.length > 14 ? d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' }) : d.toLocaleDateString(undefined, { weekday: 'narrow' });
    const isSelected = day.date === activeRecord.date;
    const heightPct = Math.min(100, Math.round((day.active_calories / sparkMaxCal) * 100));
    const metGoal = day.active_calories >= settings.daily_calorie_goal;
    return `
      <div class="trend-col ${isSelected ? 'trend-today' : ''}" title="${day.date}: ${Math.round(day.active_calories)} kcal">
        <div class="trend-bar-wrap">
          <div class="trend-bar cal-bar ${metGoal ? 'goal-met' : ''}" style="height:${Math.max(4, heightPct)}%"></div>
        </div>
        <span class="trend-label">${dayName}</span>
      </div>
    `;
  }).join('');

  // Workouts for ledger
  const allHistoryWorkouts = [];
  for (const d of history) {
    if (Array.isArray(d.workouts)) {
      for (const w of d.workouts) {
        allHistoryWorkouts.push({ ...w, date: d.date });
      }
    }
  }
  const displayWorkouts = range === 'day' ? workouts.map(w => ({ ...w, date: activeRecord.date })) : allHistoryWorkouts.reverse();

  return `
    <div class="hero health-hero">
      <div>
        <div class="eyebrow">BIOMETRICS &amp; WELLNESS HUB</div>
        <h1 class="page-title">Health &amp; Performance<span style="color:#10b981">.</span></h1>
        <p class="muted">Genuine Apple HealthKit biometrics synced 100% privately from your iPhone and Apple Watch.</p>
      </div>
      <div class="health-hero-actions">
        <button type="button" class="secondary-button" id="open-health-setup-btn" data-open-health-setup>
          ⚡ ${isConnected ? 'Apple Health Connected' : 'Connect Apple Health (Free)'}
        </button>
        <button type="button" class="primary-button" id="open-health-log-btn" data-open-health-quick-log>
          + Quick Log
        </button>
      </div>
    </div>

    <div class="health-status-bar">
      <div class="health-sync-status">
        <span class="status-indicator ${isConnected ? 'live' : 'idle'}"></span>
        <span>${
          syncSource === 'apple_export'
            ? `Real Apple Health Export · ${totalDays} day${totalDays === 1 ? '' : 's'} recorded (Latest: ${latestDate})`
            : syncSource === 'live_sync'
            ? `Apple Health Live Stream · Last updated ${timeAgo(activeRecord.last_synced_at)}`
            : 'No Health Data Connected · Drop export.zip below'
        }</span>
      </div>
      <div class="health-sync-tools">
        <button type="button" class="tiny-link" data-open-health-setup>⚙ Setup &amp; Credentials</button>
        ${isConnected ? `<button type="button" class="tiny-link danger-link" id="hub-clear-health-btn">Clear Data</button>` : ''}
        <button type="button" class="tiny-link" id="health-refresh-btn">↺ Refresh</button>
      </div>
    </div>

    <!-- Apple Health Direct Ingestion Dropzone -->
    <div class="card health-export-dropzone" id="hub-health-dropzone">
      <div class="dropzone-body">
        <div class="dropzone-icon">📥</div>
        <div class="dropzone-text-group">
          <strong>Import Apple Health Export (<code>export.zip</code> or <code>export.xml</code>)</strong>
          <p class="muted">AirDrop from iPhone (Health App → Profile → Export All Health Data) and drop here for instant biometrics.</p>
        </div>
        <div class="dropzone-btn-group">
          <button type="button" class="secondary-button" id="browse-hub-export-btn">Browse File…</button>
          <input type="file" id="hub-health-file-input" accept=".zip,.xml" hidden>
        </div>
      </div>
      <div id="hub-upload-status" class="upload-status hidden"></div>
    </div>

    <!-- Multi-Day Timeline Navigation & Horizon Bar -->
    <div class="health-date-bar">
      <div class="health-date-nav">
        <button type="button" class="health-nav-btn" data-health-date-nav="-1" title="Previous Day">◀ Prev Day</button>
        <input type="date" id="health-date-picker" class="health-date-picker" value="${activeRecord.date}">
        <button type="button" class="health-nav-btn" data-health-date-nav="1" title="Next Day">Next Day ▶</button>
        <button type="button" class="health-nav-today-btn ${isViewingToday ? 'active' : ''}" data-health-today>Today</button>

        <div class="health-date-dropdown-wrap">
          <select id="health-date-select" class="health-date-dropdown">
            <option value="">Jump to recorded day (${availableDates.length})...</option>
            ${availableDates.map(ad => `
              <option value="${ad.date}" ${ad.date === activeRecord.date ? 'selected' : ''}>
                ${ad.date} · ${Number(ad.steps || 0).toLocaleString()} steps · ${Number(ad.sleep_hours || 0).toFixed(1)}h sleep ${ad.has_workouts ? '· 🏋️' : ''}
              </option>
            `).join('')}
          </select>
        </div>
      </div>

      <div class="health-range-pills">
        <span class="range-label">Horizon:</span>
        <button type="button" class="range-pill ${range === 'day' ? 'active' : ''}" data-health-range="day">Day</button>
        <button type="button" class="range-pill ${range === '7' ? 'active' : ''}" data-health-range="7">7D</button>
        <button type="button" class="range-pill ${range === '14' ? 'active' : ''}" data-health-range="14">14D</button>
        <button type="button" class="range-pill ${range === '30' ? 'active' : ''}" data-health-range="30">30D</button>
        <button type="button" class="range-pill ${range === 'all' ? 'active' : ''}" data-health-range="all">All</button>
      </div>
    </div>

    ${!isViewingToday ? `
      <div class="health-day-banner">
        <span>📅 Viewing historical records for <strong>${activeRecord.date}</strong>. Multi-day charts &amp; averages cover the window up to this day.</span>
        <button type="button" class="tiny-link" data-health-today style="margin-left:auto;">Return to Today →</button>
      </div>
    ` : (latestDate && latestDate !== activeRecord.date && activeRecord.steps === 0) ? `
      <div class="health-day-banner">
        <span>📅 Viewing today (fresh recording session). Your most recent imported Apple Health archive is from <strong>${latestDate}</strong>.</span>
        <button type="button" class="tiny-link" data-health-jump-date="${latestDate}" style="margin-left:auto;">Jump to ${latestDate} →</button>
      </div>
    ` : ''}

    ${renderMultiDayAggregatesBanner(aggregates, range)}

    <!-- Top Biometrics Grid -->
    <div class="health-metrics-grid">
      <!-- 1. Steps Card -->
      <section class="card health-card">
        <div class="health-card-head">
          <div class="health-card-title">
            <span class="health-card-icon steps-icon">👟</span>
            <div>
              <h3>Daily Steps</h3>
              <small class="muted">Goal: ${settings.daily_step_goal.toLocaleString()} steps</small>
            </div>
          </div>
          <div class="ring-wrap">
            ${renderProgressRing(stepPct, '#10b981')}
            <span class="ring-pct">${stepPct}%</span>
          </div>
        </div>
        <div class="health-stat-main">
          <div class="metric-value">${Number(activeRecord.steps || 0).toLocaleString()}<span class="metric-unit">steps</span></div>
          <div class="metric-sub">
            <span>📍 ${Number(activeRecord.distance_km || 0).toFixed(2)} km</span>
            <span class="dot-sep">·</span>
            <span>${(Number(activeRecord.distance_km || 0) * 0.621371).toFixed(1)} miles</span>
          </div>
        </div>
      </section>

      <!-- 2. Active Calories Card -->
      <section class="card health-card">
        <div class="health-card-head">
          <div class="health-card-title">
            <span class="health-card-icon burn-icon">🔥</span>
            <div>
              <h3>Active Energy</h3>
              <small class="muted">Goal: ${settings.daily_calorie_goal} kcal</small>
            </div>
          </div>
          <div class="ring-wrap">
            ${renderProgressRing(calPct, '#f43f5e')}
            <span class="ring-pct">${calPct}%</span>
          </div>
        </div>
        <div class="health-stat-main">
          <div class="metric-value">${Math.round(activeRecord.active_calories || 0)}<span class="metric-unit">kcal</span></div>
          <div class="metric-sub">
            <span>Burned through movement &amp; exercise</span>
          </div>
        </div>
      </section>

      <!-- 3. Sleep & Rest Card -->
      <section class="card health-card">
        <div class="health-card-head">
          <div class="health-card-title">
            <span class="health-card-icon sleep-icon">🌙</span>
            <div>
              <h3>Sleep Duration</h3>
              <small class="muted">Target: ${settings.daily_sleep_goal}h</small>
            </div>
          </div>
          <div class="ring-wrap">
            ${renderProgressRing(sleepPct, '#8b5cf6')}
            <span class="ring-pct">${sleepPct}%</span>
          </div>
        </div>
        <div class="health-stat-main">
          <div class="metric-value">${activeRecord.sleep_hours ? `${sleepH}h ${sleepM}m` : '0h 0m'}<span class="metric-unit">${sleepPct}% target</span></div>
          <div class="metric-sub">
            <span>${activeRecord.sleep_details?.deep_hours ? `Deep: ${formatHoursMins(activeRecord.sleep_details.deep_hours)} · REM: ${formatHoursMins(activeRecord.sleep_details.rem_hours)}` : 'Synced from Apple Watch sleep tracking'}</span>
          </div>
        </div>
      </section>

      <!-- 4. Heart & Recovery Card -->
      <section class="card health-card">
        <div class="health-card-head">
          <div class="health-card-title">
            <span class="health-card-icon heart-icon">❤️</span>
            <div>
              <h3>Heart &amp; Recovery</h3>
              <small class="muted">Resting HR &amp; HRV</small>
            </div>
          </div>
          <span class="badge ${recoveryClass}">${recoveryLabel}</span>
        </div>
        <div class="heart-vitals-row">
          <div class="vital-block">
            <span class="vital-label">Resting HR</span>
            <strong class="vital-val">${activeRecord.resting_heart_rate ? `${Math.round(activeRecord.resting_heart_rate)}` : '—'}<small>bpm</small></strong>
          </div>
          <div class="vital-block">
            <span class="vital-label">Latest HR</span>
            <strong class="vital-val">${activeRecord.latest_heart_rate ? `${Math.round(activeRecord.latest_heart_rate)}` : '—'}<small>bpm</small></strong>
          </div>
          <div class="vital-block">
            <span class="vital-label">HRV Readiness</span>
            <strong class="vital-val">${activeRecord.hrv_ms ? `${Math.round(activeRecord.hrv_ms)}` : '—'}<small>ms</small></strong>
          </div>
        </div>
      </section>

      <!-- 5. Hydration Tracker Card -->
      <section class="card health-card">
        <div class="health-card-head">
          <div class="health-card-title">
            <span class="health-card-icon water-icon">💧</span>
            <div>
              <h3>Hydration</h3>
              <small class="muted">Target: ${settings.daily_water_goal} ml</small>
            </div>
          </div>
          <span class="badge">${waterPct}% logged</span>
        </div>
        <div class="health-stat-main">
          <div class="metric-value">${Number(activeRecord.water_ml || 0).toLocaleString()}<span class="metric-unit">/ ${settings.daily_water_goal} ml</span></div>
          <div class="water-progress-bar">
            <div class="water-fill" style="width:${Math.min(100, waterPct)}%"></div>
          </div>
          <div class="water-quick-row">
            <button type="button" class="water-quick-pill" data-quick-water="250">+250ml 💧</button>
            <button type="button" class="water-quick-pill" data-quick-water="500">+500ml 💧</button>
            <button type="button" class="water-quick-pill" data-quick-water="750">+750ml 💧</button>
            <button type="button" class="water-quick-pill-sub" data-quick-water="-250">-250</button>
          </div>
        </div>
      </section>

      <!-- 6. Workouts Overview Card -->
      <section class="card health-card">
        <div class="health-card-head">
          <div class="health-card-title">
            <span class="health-card-icon workout-icon">🏋️</span>
            <div>
              <h3>Today’s Workouts</h3>
              <small class="muted">${workouts.length} recorded session${workouts.length === 1 ? '' : 's'}</small>
            </div>
          </div>
          <button type="button" class="tiny-link" data-open-health-quick-log>+ Log workout</button>
        </div>
        <div class="workouts-feed">
          ${workouts.length ? workouts.map(w => `
            <div class="workout-session-item">
              <span class="workout-emoji">${w.name.toLowerCase().includes('run') ? '🏃' : w.name.toLowerCase().includes('cycle') || w.name.toLowerCase().includes('bike') ? '🚴' : w.name.toLowerCase().includes('swim') ? '🏊' : '🏋️'}</span>
              <div class="workout-session-info">
                <strong>${escapeHtml(w.name)}</strong>
                <small>${w.duration_mins} mins · ${w.calories} kcal</small>
              </div>
            </div>
          `).join('') : '<p class="muted empty-subtext">No workouts recorded for this day. Workouts sync automatically from Apple Watch or Apple Health export.</p>'}
        </div>
      </section>
    </div>

    <!-- DEEP SLEEP ARCHITECTURE & POLYSOMNOGRAPHY SECTION -->
    <section class="card health-sleep-architecture-card">
      <div class="card-head">
        <div>
          <div class="eyebrow">POLYSOMNOGRAPHY &amp; SLEEP ARCHITECTURE</div>
          <h2>Sleep Architecture Analysis</h2>
        </div>
        <span class="badge badge-purple">Apple Watch Polysomnography</span>
      </div>

      ${renderSleepQualityScoreCard(
        activeRecord.sleep_details?.score,
        activeRecord.sleep_details?.efficiency_pct,
        activeRecord.sleep_hours,
        activeRecord.sleep_details?.in_bed_hours
      )}

      <!-- Hypnogram Stage Segment Bar -->
      <div class="hypnogram-section-wrap">
        <div class="hypno-header-row">
          <h4>Sleep Stages Breakdown (${activeRecord.date})</h4>
          <span class="muted">${formatHoursMins(activeRecord.sleep_hours)} Total Sleep Duration</span>
        </div>
        ${renderSleepStageHypnogram(activeRecord.sleep_details, activeRecord.sleep_hours)}
      </div>

      <!-- 4 Clinical Stage Benchmark Cards -->
      ${renderSleepStageBenchmarkCards(activeRecord.sleep_details, activeRecord.sleep_hours)}

      <!-- Multi-Day Stacked Sleep Chart (when range != 'day') -->
      ${renderStackedSleepChart(history, settings.daily_sleep_goal)}
    </section>

    <!-- CARDIO & RECOVERY ANALYTICS SECTION -->
    ${renderCardioRecoverySection(activeRecord, history, aggregates)}

    <!-- Multi-Day Activity & Calorie Trends Visualizer -->
    <section class="card health-trends-card">
      <div class="card-head">
        <div>
          <div class="eyebrow">ACTIVITY DISTRIBUTION</div>
          <h2>Steps &amp; Active Energy Trends</h2>
        </div>
        <span class="badge">${range === 'all' ? 'All Time' : `Last ${history.length} Days`}</span>
      </div>
      <div class="trends-columns-grid">
        <div class="trend-column-box">
          <div class="trend-box-header">
            <strong>Steps Progression</strong>
            <small class="muted">Goal: ${settings.daily_step_goal.toLocaleString()}</small>
          </div>
          <div class="trend-chart-bars">${stepBars}</div>
        </div>
        <div class="trend-column-box">
          <div class="trend-box-header">
            <strong>Active Energy Burned</strong>
            <small class="muted">Goal: ${settings.daily_calorie_goal} kcal</small>
          </div>
          <div class="trend-chart-bars">${calBars}</div>
        </div>
      </div>
    </section>

    <!-- Workout Ledger across Horizon -->
    <section class="card health-workouts-ledger-card">
      <div class="card-head">
        <div>
          <div class="eyebrow">HISTORICAL EXERCISE RECORD</div>
          <h2>Recorded Workouts Ledger</h2>
        </div>
        <span class="badge">${displayWorkouts.length} Session${displayWorkouts.length === 1 ? '' : 's'}</span>
      </div>
      <div class="workouts-ledger-list">
        ${displayWorkouts.length ? displayWorkouts.map(w => `
          <div class="ledger-workout-item">
            <span class="workout-emoji">${w.name.toLowerCase().includes('run') ? '🏃' : w.name.toLowerCase().includes('cycle') || w.name.toLowerCase().includes('bike') ? '🚴' : w.name.toLowerCase().includes('swim') ? '🏊' : '🏋️'}</span>
            <div class="ledger-workout-body">
              <div class="ledger-workout-top">
                <strong>${escapeHtml(w.name)}</strong>
                <span class="ledger-workout-date">${w.date}</span>
              </div>
              <div class="ledger-workout-meta">
                <span>⏱ ${w.duration_mins} mins</span>
                <span class="dot-sep">·</span>
                <span>🔥 ${w.calories} kcal</span>
              </div>
            </div>
          </div>
        `).join('') : '<p class="muted empty-subtext">No workouts found in this time horizon.</p>'}
      </div>
    </section>

    <!-- Health Tasks & Routines in this Life Area -->
    <div class="health-tasks-section">
      <div class="list-toolbar">
        <div>
          <h2>Health Tasks &amp; Habits</h2>
          <span class="muted">${openTasks.length} open · ${doneTasks.length} completed</span>
        </div>
        <button class="primary-button" data-new="task">+ Add health task</button>
      </div>
      <div class="card list-card">
        ${tasks.length ? tasks.map(taskRow).join('') : empty('No health tasks yet. Add a workout, meal prep, or wellness habit.')}
      </div>
    </div>
  `;
}

function render(){renderNav();$('#content').innerHTML=state.view==='today'?todayView():state.view==='assistant'?assistantView():state.view==='actions'?actionCenterView():state.view==='calendar'?calendarView():state.view==='plan'?planView():isHealth(state.area)?healthHubView():`${isAcademic(state.area)?`<div class="academic-tools"><span>${state.classes.length} ${state.classes.length===1?'class':'classes'} in Academics</span><button data-manage-classes>Manage classes →</button></div>`:''}${state.view==="tasks"?taskView():listView(singular[state.view])}`;renderAgentActivity();setAgentBusyUI()}
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
  panel.innerHTML='<div class="agent-runtime"><div class="runtime-core '+(running?'is-running':run.status==='error'?'is-error':'is-done')+'" aria-hidden="true"><i></i><i></i><i></i><span>✦</span></div><div class="agent-activity-head"><div><span class="runtime-label">LIVE EXECUTION</span><strong>'+escapeHtml(run.phase||'Orbit is ready')+'</strong><small>'+stateLabel+'</small></div><time>'+elapsed.toFixed(1)+'s</time></div></div>'+(steps?'<div class="agent-steps">'+steps+'</div>':'')+'<div class="runtime-rail"><i></i></div>';
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
document.addEventListener('click',async e=>{const t=e.target.closest('button,[data-edit],.event-card,.note-card,.mini-item');if(!t)return;if(t.dataset.healthDateNav){const delta=Number(t.dataset.healthDateNav);const curr=state.healthDate||dayKey(new Date());state.healthDate=addDays(curr,delta);await loadHealthMetrics(state.healthDate,state.healthRange);render();return}if(t.hasAttribute('data-health-today')){state.healthDate=dayKey(new Date());await loadHealthMetrics(state.healthDate,state.healthRange);render();return}if(t.dataset.healthJumpDate){state.healthDate=t.dataset.healthJumpDate;await loadHealthMetrics(state.healthDate,state.healthRange);render();return}if(t.dataset.healthRange){state.healthRange=t.dataset.healthRange;await loadHealthMetrics(state.healthDate,state.healthRange);render();return}if(t.id==='hub-clear-health-btn'||t.id==='health-clear-data-btn'){await clearAllHealthData();return}if(t.id==='browse-hub-export-btn'){$('#hub-health-file-input')?.click();return}if(t.closest('#modal-health-dropzone')&&!t.closest('input')){$('#modal-health-file-input')?.click();return}if(t.dataset.quickWater){const delta=Number(t.dataset.quickWater);try{await api('/api/health/quick-log',{method:'POST',body:JSON.stringify({action:'add_water',amount_ml:delta})});await refresh();toast(delta>0?`+${delta}ml water logged 💧`:`${delta}ml water updated`)}catch(err){toast(err.message)}return}if(t.hasAttribute('data-open-health-setup')||t.id==='open-health-setup-btn'){await openHealthSetupModal();return}if(t.hasAttribute('data-open-health-quick-log')||t.id==='open-health-log-btn'){$('#health-quick-log-form')?.reset();$('#health-quick-log-dialog')?.showModal();return}if(t.closest('[data-health-jump]')){const healthArea=state.areas.find(a=>a.name.toLowerCase()==='health');if(healthArea)navigate('tasks',healthArea.id);return}if(t.dataset.copyTarget){const inp=document.getElementById(t.dataset.copyTarget);if(inp){await navigator.clipboard?.writeText(inp.value);const orig=t.textContent;t.textContent='Copied!';setTimeout(()=>{t.textContent=orig},1500);toast('Copied to clipboard')}return}if(t.id==='health-test-sync-btn'){try{t.disabled=true;t.textContent='Syncing…';const setupInfo=await api('/api/health/setup');await api('/api/health/sync',{method:'POST',headers:{'X-Health-Token':setupInfo.sync_token},body:JSON.stringify(setupInfo.sample_payload)});await refresh();$('#health-setup-dialog')?.close();toast('⚡ Verified Apple HealthKit test sync received!')}catch(err){toast(err.message)}finally{t.disabled=false;t.textContent='⚡ Send Test HealthKit Sync'}return}if(t.id==='health-refresh-btn'){await refresh();toast('Biometrics refreshed');return}if(t.dataset.waterAmount){const inp=$('#quick-log-water-input');if(inp)inp.value=t.dataset.waterAmount;return}if(t.dataset.healthType){document.querySelectorAll('#quick-log-type-row button').forEach(b=>b.classList.remove('selected'));t.classList.add('selected');const ty=t.dataset.healthType;$('#quick-log-water-panel')?.classList.toggle('hidden',ty!=='water');$('#quick-log-workout-panel')?.classList.toggle('hidden',ty!=='workout');$('#quick-log-weight-panel')?.classList.toggle('hidden',ty!=='weight');return}if(t.hasAttribute('data-action-start')){navigate('assistant');setTimeout(()=>{const input=$('#ask-form input');if(input){input.value='Research this target and draft a truthful personalized outreach message for my approval: ';input.focus()}},0);return}if(t.dataset.profileDelete){try{await api('/api/profile/'+t.dataset.profileDelete,{method:'DELETE'});await refresh();toast('Profile fact removed')}catch(err){toast(err.message)}return}if(t.dataset.actionDecision){try{await api('/api/external-actions/'+t.dataset.actionId+'/decision',{method:'POST',body:JSON.stringify({decision:t.dataset.actionDecision})});await refresh();toast(t.dataset.actionDecision==='approve'?'Draft approved':'Draft rejected')}catch(err){toast(err.message)}return}if(t.dataset.actionHandoff){try{const result=await api('/api/external-actions/'+t.dataset.actionHandoff+'/handoff',{method:'POST',body:'{}'});await navigator.clipboard?.writeText(result.action.body);await refresh();if(result.handoff_url)location.href=result.handoff_url;toast('Draft copied; handoff opened')}catch(err){toast(err.message)}return}if(t.dataset.actionComplete){try{await api('/api/external-actions/'+t.dataset.actionComplete+'/executed',{method:'POST',body:'{}'});await refresh();toast('Marked complete from your confirmation')}catch(err){toast(err.message)}return}if(t.dataset.groupToggle){const key=t.dataset.groupToggle;if(state.collapsedTaskGroups.has(key))state.collapsedTaskGroups.delete(key);else state.collapsedTaskGroups.add(key);render();return}if(t.dataset.planNav){state.planDay=addDays(state.planDay,Number(t.dataset.planNav));render();return}if(t.hasAttribute('data-plan-today')){state.planDay=dayKey(new Date());render();return}if(t.dataset.planAdd){openEditor('event',null,state.planDay,Number(t.dataset.planAdd));return}if(t.hasAttribute('data-open-templates')){openTemplatesModal();return}if(t.hasAttribute('data-open-save-template')){openSaveTemplateModal();return}if(t.dataset.planToggle){await toggleBlockDone(t.dataset.planToggle);return}if(t.dataset.planDuplicate){await duplicateBlock(t.dataset.planDuplicate);return}if(t.dataset.applyTemplate){await applyTemplate(t.dataset.applyTemplate,t.dataset.applyMode||'append');return}if(t.dataset.deleteTemplate){if(confirm('Delete this routine template?')){try{await api('/api/plan-templates/'+t.dataset.deleteTemplate,{method:'DELETE'});await refresh();toast('Template deleted')}catch(err){toast(err.message)}}return}if(t.dataset.quickApplyTplId){await applyTemplate(t.dataset.quickApplyTplId,'append');return}if(t.dataset.fillGapStart){const sInput=$('#plan-q-start'),eInput=$('#plan-q-end'),tInput=$('#plan-q-title');if(sInput)sInput.value=t.dataset.fillGapStart;if(eInput)eInput.value=t.dataset.fillGapEnd;if(tInput){tInput.focus();tInput.scrollIntoView({behavior:'smooth',block:'center'})}return}if(t.hasAttribute('data-plan-focus-quick')){const tInput=$('#plan-q-title');if(tInput){tInput.focus();tInput.scrollIntoView({behavior:'smooth',block:'center'})}return}if(t.dataset.dur){const sInput=$('#plan-q-start'),eInput=$('#plan-q-end');if(sInput&&eInput){document.querySelectorAll('.dur-pill').forEach(p=>p.classList.remove('active'));t.classList.add('active');const [h,m]=sInput.value.split(':').map(Number);const durMins=Number(t.dataset.dur);const endTotalMins=(h*60+m+durMins)%1440;const endH=Math.floor(endTotalMins/60),endM=endTotalMins%60;eInput.value=`${String(endH).padStart(2,'0')}:${String(endM).padStart(2,'0')}`}return}if(t.id==='open-create-template-btn'){const card=$('#template-create-card');if(card){card.classList.toggle('hidden');if(!card.classList.contains('hidden')&&!$('#tpl-blocks-builder')?.children.length){addTemplateBlockRow('07:00','08:00','GYM & Stretch','Health');addTemplateBlockRow('08:00','09:00','Shower & Breakfast','Personal');addTemplateBlockRow('09:00','12:00','Deep Work / LeetCode','Career')}}return}if(t.id==='tpl-add-block-row'){addTemplateBlockRow();return}if(t.id==='tpl-create-cancel'){$('#template-create-card')?.classList.add('hidden');return}if(t.dataset.close){document.getElementById(t.dataset.close).close();return}if(t.hasAttribute('data-manage-classes')){openClasses();return}if(t.dataset.classEdit){const found=state.classes.find(c=>c.id===t.dataset.classEdit);if(found){state.editingClass=found.id;$('#class-name').value=found.name;$('#class-name-label').firstChild.textContent='Rename class';$('#save-class').textContent='Save name';$('#cancel-class-edit').classList.remove('hidden');$('#class-name').focus()}return}if(t.dataset.classDelete){await removeClass(t.dataset.classDelete);return}if(t.dataset.view){navigate(t.dataset.view);return}if(t.dataset.area){navigate('tasks',t.dataset.area);return}if(t.dataset.new){openEditor(t.dataset.new);return}if(t.dataset.toggle){await toggleTask(t.dataset.toggle);return}if(t.dataset.delete){await deleteItem(t.dataset.delete);return}if(t.dataset.edit){const item=state.items.find(x=>x.id===t.dataset.edit);if(item)openEditor(item.type,item);return}if(t.dataset.filter){state.filter=t.dataset.filter;render();return}if(t.dataset.ask){await ask(t.dataset.ask)}});
document.addEventListener('change',async e=>{if(e.target.id==='health-date-picker'||e.target.id==='health-date-select'){if(e.target.value){state.healthDate=e.target.value;await loadHealthMetrics(state.healthDate,state.healthRange);render();}return}if(e.target.id==='hub-health-file-input'&&e.target.files?.[0]){await uploadHealthExportFile(e.target.files[0],$('#hub-upload-status'));e.target.value='';return}if(e.target.id==='modal-health-file-input'&&e.target.files?.[0]){await uploadHealthExportFile(e.target.files[0],$('#modal-upload-status'));e.target.value='';return}});
['dragenter','dragover'].forEach(name=>{document.addEventListener(name,e=>{const dropzone=e.target.closest('#hub-health-dropzone,#modal-health-dropzone');if(dropzone){e.preventDefault();dropzone.classList.add('drag-over')}})});
['dragleave'].forEach(name=>{document.addEventListener(name,e=>{const dropzone=e.target.closest('#hub-health-dropzone,#modal-health-dropzone');if(dropzone&&!dropzone.contains(e.relatedTarget)){dropzone.classList.remove('drag-over')}})});
document.addEventListener('drop',async e=>{const dropzone=e.target.closest('#hub-health-dropzone,#modal-health-dropzone');if(dropzone){e.preventDefault();dropzone.classList.remove('drag-over');const file=e.dataTransfer?.files?.[0];if(file){const statusEl=dropzone.querySelector('.upload-status');await uploadHealthExportFile(file,statusEl)}}});
$('#content').addEventListener('change',async e=>{if(e.target.matches('[data-quick-apply-template]')&&e.target.value){const tplId=e.target.value;e.target.value='';await applyTemplate(tplId,'append');return}if(!e.target.matches('[data-plan-date]')||!e.target.value)return;try{fromDayKey(e.target.value);state.planDay=e.target.value;render()}catch{toast('Choose a valid date')}});
document.addEventListener('input',e=>{if(e.target.id==='plan-q-title'){const parsed=parseTimeBlockString(e.target.value);if(parsed){const sInput=$('#plan-q-start'),eInput=$('#plan-q-end');if(sInput)sInput.value=parsed.start;if(eInput)eInput.value=parsed.end}}});
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
document.addEventListener('submit',async e=>{if(e.target.id==='health-quick-log-form'){e.preventDefault();const selectedType=document.querySelector('#quick-log-type-row button.selected')?.dataset.healthType||'water';try{if(selectedType==='water'){const amount=Number($('#quick-log-water-input')?.value)||250;await api('/api/health/quick-log',{method:'POST',body:JSON.stringify({action:'add_water',amount_ml:amount})});toast(`+${amount}ml water logged 💧`)}else if(selectedType==='workout'){const name=$('#quick-log-workout-name')?.value.trim()||'Workout';const duration=Number($('#quick-log-workout-duration')?.value)||45;const calories=Number($('#quick-log-workout-calories')?.value)||280;await api('/api/health/quick-log',{method:'POST',body:JSON.stringify({action:'log_workout',name,duration_mins:duration,calories})});toast(`Workout “${name}” logged 🏋️`)}else if(selectedType==='weight'){const weight=Number($('#quick-log-weight-input')?.value);if(weight){await api('/api/health/quick-log',{method:'POST',body:JSON.stringify({action:'set_weight',weight_kg:weight})});toast(`Weight recorded: ${weight} kg ⚖️`)}} $('#health-quick-log-dialog')?.close();await refresh()}catch(err){toast(err.message)}return}if(e.target.id==='plan-quick-form'){e.preventDefault();handleQuickAddBlock(e);return}if(e.target.id==='save-template-form'){e.preventDefault();const name=$('#save-tpl-name')?.value.trim();const description=$('#save-tpl-desc')?.value.trim()||'';if(!name)return;try{await api('/api/plan-templates/save-day',{method:'POST',body:JSON.stringify({date:state.planDay,name,description})});$('#save-template-dialog')?.close();await refresh();toast(`Routine “${name}” saved!`)}catch(err){toast(err.message)}return}if(e.target.id==='template-create-form'){e.preventDefault();const name=$('#tpl-create-name')?.value.trim();const description=$('#tpl-create-desc')?.value.trim()||'';if(!name)return;const blockRows=document.querySelectorAll('.tpl-builder-row');const blocks=[];blockRows.forEach(row=>{const s=row.querySelector('.tpl-row-start')?.value||'';const en=row.querySelector('.tpl-row-end')?.value||'';const tit=row.querySelector('.tpl-row-title')?.value.trim()||'';const ar=row.querySelector('.tpl-row-area')?.value||'';if(tit)blocks.push({start_time:s,end_time:en,title:tit,area_name:ar,priority:'medium'})});if(!blocks.length){toast('Add at least one block to the template');return}try{await api('/api/plan-templates',{method:'POST',body:JSON.stringify({name,description,blocks})});$('#template-create-card')?.classList.add('hidden');$('#template-create-form')?.reset();$('#tpl-blocks-builder').innerHTML='';await refresh();toast(`Routine template “${name}” created!`)}catch(err){toast(err.message)}return}if(e.target.id==='ask-form'){e.preventDefault();ask(new FormData(e.target).get('question'));return}if(e.target.id==='profile-fact-form'){e.preventDefault();const form=new FormData(e.target);try{await api('/api/profile',{method:'POST',body:JSON.stringify({key:form.get('key'),value:form.get('value'),sensitivity:form.get('sensitive')?'sensitive':'normal'})});await refresh();toast('Verified profile fact saved')}catch(err){toast(err.message)}}});
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
  const brave_search_api_key = $('#ai-brave-key')?.value.trim();
  const payload = {};
  if (active_provider !== undefined) payload.active_provider = active_provider;
  if (groq_api_key !== undefined && groq_api_key !== '') payload.groq_api_key = groq_api_key;
  if (openrouter_api_key !== undefined && openrouter_api_key !== '') payload.openrouter_api_key = openrouter_api_key;
  if (openrouter_model) payload.openrouter_model = openrouter_model;
  if (orbit_model) payload.orbit_model = orbit_model;
  if (brave_search_api_key) payload.brave_search_api_key = brave_search_api_key;
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
