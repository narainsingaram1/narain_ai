// Natural-language understanding for Orbit: relative dates, workspace entity
// matching, and a deterministic capture parser.
//
// Every export here is a pure function so it can be unit tested without a
// server, and reused by both the capture endpoint and agent validation.

const MONTHS = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12};
const MONTH_NAMES = ['january','february','march','april','may','june','july','august','september','october','november','december'];
const WEEKDAY_NAMES = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
const WEEKDAY_WORDS = 'sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat';
const WEEKDAY_INDEX = {sunday:0,monday:1,tuesday:2,wednesday:3,thursday:4,friday:5,saturday:6,sun:0,mon:1,tue:2,tues:2,wed:3,thu:4,thur:4,thurs:4,fri:5,sat:6};
const NUMBER_WORDS = {a:1,an:1,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,couple:2,few:3};

// Phrases that name a moment but not a date. Orbit keeps them as a visible
// hint instead of inventing a deadline the user never asked for.
const VAGUE_PHRASES = ['soon','asap','sometime','someday','later','eventually','shortly','when i can','when possible','in a bit','in a while','at some point','down the road','next few days'];
const TIME_OF_DAY = {morning:9,noon:12,afternoon:14,evening:18,tonight:19,night:19,eod:17,'end of day':17,'end of the day':17,midnight:0};

export function normalizeName(value) {
  return String(value ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'');
}

export function levenshtein(a,b) {
  const left=String(a??''), right=String(b??'');
  if (left===right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  let previous=Array.from({length:right.length+1},(_,i)=>i);
  for (let i=1;i<=left.length;i++) {
    const current=[i];
    for (let j=1;j<=right.length;j++) {
      const cost=left[i-1]===right[j-1]?0:1;
      current[j]=Math.min(previous[j]+1,current[j-1]+1,previous[j-1]+cost);
    }
    previous=current;
  }
  return previous[right.length];
}

export function similarity(a,b) {
  const left=String(a??''), right=String(b??'');
  if (!left && !right) return 1;
  if (!left || !right) return 0;
  return 1 - levenshtein(left,right)/Math.max(left.length,right.length);
}

// Rank workspace rows (classes or areas) against a free-text phrase. A name
// that appears verbatim wins; near-misses are scored so "cs3600" still finds
// "CS 3600" and a typo still reaches the right class.
export function rankEntities(input, rows) {
  const text=String(input??'');
  const normText=normalizeName(text);
  const tokens=text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const scored=[];
  for (const row of rows||[]) {
    if (!row?.id) continue;
    const name=String(row.name??'');
    const norm=normalizeName(name);
    if (!norm) continue;
    let score=0;
    if (normText.includes(norm)) score=1;
    if (score<1) score=Math.max(score,similarity(norm,normText)*0.6);
    if (score<0.75) {
      const words=name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      if (words.length) {
        let total=0;
        for (const word of words) {
          let best=0;
          for (const token of tokens) {
            const prefix=token.length>=3&&word.length>=3&&(token.startsWith(word)||word.startsWith(token))?0.82:0;
            const value=Math.max(similarity(word,token),prefix);
            if (value>best) best=value;
          }
          total+=best;
        }
        score=Math.max(score,(total/words.length)*0.85);
      }
    }
    if (score>0) scored.push({row,score,normLength:norm.length});
  }
  scored.sort((a,b)=>b.score-a.score||b.normLength-a.normLength);
  return scored;
}

export function matchEntity(input, rows, options={}) {
  const threshold=options.threshold ?? 0.7;
  const scored=rankEntities(input,rows);
  const best=scored[0];
  if (!best || best.score<threshold) return {match:null,score:best?.score||0,candidates:scored.slice(0,4).map(item=>item.row)};
  const near=scored.filter(item=>item.score>=Math.max(threshold,best.score-0.06)).map(item=>item.row);
  return {match:near.length===1?best.row:null,score:best.score,candidates:near.slice(0,4)};
}


export function zoneParts(timeZone, at=new Date()) {
  const parts=new Intl.DateTimeFormat('en-US',{timeZone,hour12:false,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).formatToParts(at);
  const map=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return {year:Number(map.year),month:Number(map.month),day:Number(map.day),hour:Number(map.hour)%24,minute:Number(map.minute),second:Number(map.second)};
}

export function zoneOffsetMinutes(timeZone, at=new Date()) {
  const parts=zoneParts(timeZone,at);
  const asUTC=Date.UTC(parts.year,parts.month-1,parts.day,parts.hour,parts.minute,parts.second);
  return Math.round((asUTC-Math.floor(at.getTime()/1000)*1000)/60000);
}

// Render a wall-clock time in `timeZone` as an ISO timestamp that carries an
// explicit offset, so the stored instant is unambiguous everywhere.
export function zonedStamp(timeZone, parts) {
  const pad=value=>String(value).padStart(2,'0');
  const wall=Date.UTC(parts.year,parts.month-1,parts.day,parts.hour||0,parts.minute||0,parts.second||0);
  let instant=wall;
  for (let attempt=0;attempt<3;attempt++) instant=wall-zoneOffsetMinutes(timeZone,new Date(instant))*60000;
  const offset=zoneOffsetMinutes(timeZone,new Date(instant));
  const local=new Date(instant+offset*60000);
  const sign=offset<0?'-':'+';
  const abs=Math.abs(offset);
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth()+1)}-${pad(local.getUTCDate())}T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}${sign}${pad(Math.floor(abs/60))}:${pad(abs%60)}`;
}

const shiftDays=(parts,days)=>{
  const shifted=new Date(Date.UTC(parts.year,parts.month-1,parts.day+days));
  return {...parts,year:shifted.getUTCFullYear(),month:shifted.getUTCMonth()+1,day:shifted.getUTCDate()};
};
const weekdayOf=parts=>new Date(Date.UTC(parts.year,parts.month-1,parts.day)).getUTCDay();
const monthLength=(year,month)=>new Date(Date.UTC(year,month,0)).getUTCDate();
const dayLabel=parts=>`${MONTH_NAMES[parts.month-1]} ${parts.day}`;

function resolveHour(hour, minute, meridiem) {
  let value=Number(hour);
  if (meridiem==='pm'&&value<12) value+=12;
  if (meridiem==='am'&&value===12) value=0;
  return {hour:value,minute:Number(minute||0)};
}

function shiftMonths(parts, count) {
  const raw=parts.month-1+count;
  const year=parts.year+Math.floor(raw/12);
  const month=(raw%12+12)%12+1;
  return {year,month,day:Math.min(parts.day,monthLength(year,month))};
}

// Resolve the day mentioned in a phrase, ignoring the time of day for now.
function findDay(lower, today) {
  const iso=lower.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})(?:[t\s](\d{1,2}):(\d{2}))?/);
  if (iso) {
    const parts={year:Number(iso[1]),month:Number(iso[2]),day:Number(iso[3])};
    return {parts,label:dayLabel(parts),time:iso[4]?{hour:Number(iso[4]),minute:Number(iso[5]),timeKnown:true}:null};
  }
  const named=lower.match(new RegExp(`\\b(${MONTH_NAMES.map(name=>name.slice(0,3)).join('|')})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*,?\\s*(\\d{4}))?`));
  if (named) {
    const parts={year:Number(named[3]||today.year),month:MONTHS[named[1].slice(0,3)],day:Number(named[2])};
    if (!named[3]&&Date.UTC(parts.year,parts.month-1,parts.day)<Date.UTC(today.year,today.month-1,today.day)) parts.year+=1;
    return {parts,label:dayLabel(parts)};
  }
  const numeric=lower.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (numeric) {
    const parts={year:numeric[3]?Number(numeric[3].length===2?`20${numeric[3]}`:numeric[3]):today.year,month:Number(numeric[1]),day:Number(numeric[2])};
    if (!numeric[3]&&Date.UTC(parts.year,parts.month-1,parts.day)<Date.UTC(today.year,today.month-1,today.day)) parts.year+=1;
    return {parts,label:dayLabel(parts)};
  }
  const relative=lower.match(/\bin\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|couple|few|\d{1,3})\s+(day|days|week|weeks|month|months)\b/);
  if (relative) {
    const count=NUMBER_WORDS[relative[1]]??Number(relative[1]);
    const unit=relative[2].replace(/s$/,'');
    if (unit==='day') return {parts:shiftDays(today,count),label:`in ${count} day${count===1?'':'s'}`};
    if (unit==='week') return {parts:shiftDays(today,count*7),label:`in ${count} week${count===1?'':'s'}`};
    return {parts:shiftMonths(today,count),label:`in ${count} month${count===1?'':'s'}`};
  }
  const weekHint=lower.match(/\b(next|this|last)\s+(week|month|weekend)\b/);
  if (weekHint&&weekHint[2]==='weekend') {
    const modifier=weekHint[1];
    if (modifier==='last') return {parts:shiftDays(today,-(((weekdayOf(today)+6)%7)||7)),label:'last weekend'};
    const toSaturday=6-weekdayOf(today);
    return {parts:shiftDays(today,toSaturday>=0?toSaturday:toSaturday+7+(modifier==='next'?7:0)),label:`${modifier} weekend`};
  }
  if (weekHint&&weekHint[2]==='week') {
    const modifier=weekHint[1];
    const toMonday=(1-weekdayOf(today)+7)%7;
    if (modifier==='last') return {parts:shiftDays(today,-(((weekdayOf(today)+6)%7)||7)),label:'last week'};
    if (modifier==='next') return {parts:shiftDays(today,toMonday||7),label:'next week'};
    return {parts:shiftDays(today,toMonday),label:'this week'};
  }
  if (weekHint) {
    const modifier=weekHint[1];
    const count=modifier==='last'?-1:1;
    if (modifier==='this') {
      const parts=shiftMonths(today,0);
      return {parts,label:'this month'};
    }
    return {parts:shiftMonths(today,count),label:`${modifier} month`};
  }
  const weekday=lower.match(new RegExp(`\\b(?:(next|this|last)\\s+)?(${WEEKDAY_WORDS})\\b`));
  if (weekday) {
    const target=WEEKDAY_INDEX[weekday[2]];
    const modifier=weekday[1];
    const distance=((target-weekdayOf(today))+7)%7||7;
    const parts=shiftDays(today,distance+(modifier==='next'?7:0)-(modifier==='last'?7:0));
    return {parts,label:`${modifier?`${modifier} `:''}${WEEKDAY_NAMES[target]}`};
  }
  const simple=lower.match(/\b(today|tonight|tonite|tomorrow|tmrw|tomorow|eod|end of day|end of the day|noon|midnight)\b/);
  if (simple) {
    const word=simple[1];
    const isToday=['today','tonight','tonite','eod','noon','midnight'].includes(word)||word.startsWith('end of');
    const key=word==='tonite'?'tonight':word.startsWith('end of')?'eod':word;
    const hour=TIME_OF_DAY[key];
    return {parts:isToday?today:shiftDays(today,1),label:word==='tmrw'||word==='tomorow'?'tomorrow':word,time:hour===undefined?null:{hour,minute:0,timeKnown:true}};
  }
  const period=lower.match(/\b(this\s+)?(morning|afternoon|evening|night)\b/);
  if (period) return {parts:today,label:`${period[1]?'this ':''}${period[2]}`,time:{hour:TIME_OF_DAY[period[2]],minute:0,timeKnown:true}};
  return null;
}



// Parse a phrase such as "friday", "next week", "in 3 days", "sep 25 at 5pm"
// or "soon". Vague phrases resolve to `vague:true` with no timestamp so the
// caller can ask for a real date instead of inventing one.
export function parseWhen(input, options={}) {
  const timeZone=options.timeZone||'UTC';
  const now=options.now||new Date();
  const raw=String(input??'').trim();
  if (!raw) return {matched:false,vague:false,phrase:''};
  const lower=raw.toLowerCase();
  const today=zoneParts(timeZone,now);
  const day={year:today.year,month:today.month,day:today.day};
  const found=findDay(lower,day);
  if (found) {
    const explicit=lower.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
    const plain=lower.match(/\b(?:at|by)\s+(\d{1,2})(?::(\d{2}))?\b/);
    const clock=found.time||(explicit?{...resolveHour(explicit[1],explicit[2],explicit[3]),timeKnown:true}:plain?{...resolveHour(plain[1],plain[2]),timeKnown:false}:null);
    return {
      matched:true,
      vague:false,
      phrase:raw,
      label:found.label,
      timeKnown:Boolean(clock?.timeKnown),
      iso:zonedStamp(timeZone,{...found.parts,hour:clock?clock.hour:9,minute:clock?clock.minute:0,second:0})
    };
  }
  const clock=lower.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (clock) {
    const resolved=resolveHour(clock[1],clock[2],clock[3]);
    return {matched:true,vague:false,phrase:raw,label:`${resolved.hour}:${String(resolved.minute).padStart(2,'0')} today`,timeKnown:true,iso:zonedStamp(timeZone,{...day,...resolved,second:0})};
  }
  const vague=VAGUE_PHRASES.find(phrase=>lower.includes(phrase));
  if (vague) return {matched:true,vague:true,phrase:vague,label:vague,timeKnown:false,iso:null};
  return {matched:false,vague:false,phrase:raw};
}

const EVENT_CUES=/\b(meeting|meet up|call with|appointment|interview|lecture|dinner|lunch|brunch|coffee with|flight|party|birthday|trip|standup|stand-up|sync with|ceremony|concert|office hours|drop-?off|pick-?up)\b/;
const NOTE_CUES=/\b(note|notes|idea|thought|remember that|fyi|reference|quote|read this)\b/;
const JOURNAL_CUES=/\b(journal|diary|reflect on my day|today i felt)\b/;
const GOAL_CUES=/\b(goal|long[- ]term|aim to|i want to eventually|someday i want)\b/;
const HIGH_CUES=/\b(urgent|asap|critical|important|high priority|must do|do today|top priority)\b|!!|!high/i;
const LOW_CUES=/\b(low priority|whenever|no rush|not urgent|when i get around to it)\b|!low/i;

const escapeRegExp=value=>String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const STRIP_WHEN=new RegExp([
  `\\b(?:${WEEKDAY_WORDS})\\b`,
  '\\b(?:today|tonight|tonite|tomorrow|tmrw|tomorow|eod|noon|midnight)\\b',
  '\\bend of (?:the )?day\\b',
  '\\b(?:next|this|last)\\s+(?:week|month|weekend)\\b',
  `\\b(?:${MONTH_NAMES.join('|')})\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s*\\d{4})?\\b`,
  '\\bin\\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|couple|few|\\d{1,3})\\s+(?:days?|weeks?|months?)\\b',
  '\\b\\d{4}-\\d{1,2}-\\d{1,2}\\b',
  '\\b\\d{1,2}\\/\\d{1,2}(?:\\/\\d{2,4})?\\b',
  '\\b(?:at\\s+)?\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)\\b',
  '\\b(?:at|by)\\s+\\d{1,2}(?::\\d{2})?\\b',
  '\\bthis (?:morning|afternoon|evening|night)\\b',
  `\\b(?:${VAGUE_PHRASES.map(phrase=>escapeRegExp(phrase)).join('|')})\\b`
].join('|'),'gi');
const COMMAND_PREFIX=/^(?:\s*(?:ok(?:ay)?|please|hey|hi|yo|so|now|also|and|then)[\s,]+)+/i;
const LEAD_PREFIX=/^(?:\s*(?:can you|could you|would you|will you|i want to|i wanna|i need to|i have to|i've got to|i should|i gotta|remind me to|remind me about|don'?t forget to|dont forget to|remember to|note that|i have|i got|there is|there's|got|we have)\s+)+/i;
const VERB_PREFIX=/^(?:\s*(?:create|add|make|log|jot down|note down|write down|save|track|schedule|put|throw in)\s+(?:me\s+)?(?:a|an|the|another|new|some)?\s*(?:task|event|note|journal entry|entry|reminder|to-?do|milestone|thing)?\s*(?:for|about|to|that|:)?\s*)/i;
const RELATIVE_CLAUSE=/^(?:\s*(?:that\s+(?:we|i|you)\s+(?:have|has|need|needs|must|should|got|are having|have coming up)|which\s+(?:we|i)\s+(?:have|need|must)|there'?s|there is|i\s+(?:have|need|must|should|want)|we\s+(?:have|need|must|should)|got)\s+(?:a|an|the)?\s*)+/i;
const TRAILING_FILLER=/\s+(?:for me|please|thanks|thank you|as a task|as an event|as a note|as a goal|if possible|when you can|(?:to|in|into|on)\s+(?:my\s+)?(?:tasks?|todo|todos?|events?|calendar|notes?|journal|goals?)|(?:can you\s+)?(?:please\s+)?(?:add|put|save|track|schedule|throw)\s+(?:it|this)?\s*(?:in|into|to|on)?\s*(?:my\s+)?(?:tasks?|todo|todos?|events?|calendar|notes?|journal|goals?)(?:\s+(?:for me|please))?|(?:can you\s+)?(?:please\s+)?add it(?:\s+to\s+tasks?)?)\s*$/i;

export function removePhrase(text, phrase) {
  if (!phrase) return text;
  return String(text).replace(new RegExp(`\\b(?:in|for|from|about|with|to|on|during)?\\s*${escapeRegExp(phrase)}\\b`,'gi'),' ');
}

// A course code someone typed that does not match a saved class yet, such as
// "math 2210" or "@cs3600". It becomes an offer to create that class.
const COURSE_MENTION=/(?:@([a-z][a-z0-9 .-]{1,14})|\b(?:in|for|from|during|class|course)\s+([a-z]{2,5}\s?-?\d{3,4}[a-z]?)\b)/i;
export function courseMention(text) {
  const found=String(text??'').match(COURSE_MENTION);
  if (!found) return '';
  if (found[1]) return found[1].trim();
  // Course codes are conventionally upper case, so "math 2210" offers to create
  // "MATH 2210". A name typed with @ is left exactly as written.
  return (found[2]||'').trim().toUpperCase();
}

export function cleanTitle(text) {
  let value=` ${String(text??'').replace(/\s+/g,' ').trim()} `;
  for (let pass=0;pass<5;pass++) {
    const before=value;
    value=value.replace(COMMAND_PREFIX,' ').replace(LEAD_PREFIX,' ').replace(VERB_PREFIX,' ').replace(RELATIVE_CLAUSE,' ').replace(TRAILING_FILLER,' ');
    value=value.replace(/[\s,;:.\-]+(?:on|at|by|for|in|due|due on|due by|the|a|an|to|about)\s*$/i,' ');
    if (before===value) break;
  }
  value=value.replace(/\s+/g,' ').replace(/^[\s,;:.\-–—]+|[\s,;:.\-–—]+$/g,'').trim();
  value=value.replace(/^(?:a|an|the)\s+/i,'').trim();
  return value ? value.charAt(0).toUpperCase()+value.slice(1) : '';
}

// A single sentence can carry two obligations ("midterm friday; also email the
// professor"). Split only on explicit separators so ordinary "and" stays intact.
export function splitIntents(text) {
  const value=String(text??'').trim();
  if (!value) return [];
  const parts=value.split(/\s*(?:;|\balso\b|\band then\b|\bplus\b|\n)\s*/i).map(part=>part.trim()).filter(Boolean);
  const usable=parts.filter(part=>part.split(/\s+/).length>=2);
  return usable.length>1?usable:[value];
}

const CAREER_CUES = /\b(swe|oa|online assessment|interview|job|internship|recruiter|resume|cv|offer|application|career|superhuman|linkedin|hiring|referral)\b/i;
const HEALTH_CUES = /\b(gym|workout|doctor|dentist|appointment|run|running|lifting|medicine|prescription|therapy|sleep|health|fitness|meds|dental)\b/i;
const ACADEMIC_CUES = /\b(homework|hw|exam|quiz|midterm|final|lecture|syllabus|assignment|study|reading|textbook|class|course|professor|ta|office hours)\b/i;
const PROJECT_CUES = /\b(project|hackathon|repo|codebase|github|pull request|pr|feature|bug|deploy|build)\b/i;

export function heuristicDraft(input, context={}) {
  const timeZone=context.timeZone||'UTC';
  const now=context.now||new Date();
  const classes=context.classes||[];
  const areas=context.areas||[];
  const original=String(input??'').trim();
  if (!original) return null;
  const lower=original.toLowerCase();

  let type='task';
  if (JOURNAL_CUES.test(lower)) type='journal';
  else if (GOAL_CUES.test(lower)) type='goal';
  else if (NOTE_CUES.test(lower)) type='note';
  else if (EVENT_CUES.test(lower)) type='event';

  const priority=HIGH_CUES.test(lower)?'high':LOW_CUES.test(lower)?'low':'medium';

  const classMatch=matchEntity(original,classes);
  const areaMatch=matchEntity(original,areas);
  const academic=areas.find(item=>/^academics$/i.test(String(item.name??'').trim()))||null;
  const classId=classMatch.match?.id||null;
  let areaId=areaMatch.match?.id||null;
  if (classId&&!areaId&&academic) areaId=academic.id;
  if (!areaId) {
    if (classMatch.match || courseMention(original)) areaId=academic?.id||null;
    else if (CAREER_CUES.test(lower)) areaId=areas.find(item=>/^career$/i.test(String(item.name??'').trim()))?.id||null;
    else if (HEALTH_CUES.test(lower)) areaId=areas.find(item=>/^health$/i.test(String(item.name??'').trim()))?.id||null;
    else if (ACADEMIC_CUES.test(lower)) areaId=academic?.id||null;
    else if (PROJECT_CUES.test(lower)) areaId=areas.find(item=>/^projects?$/i.test(String(item.name??'').trim()))?.id||null;
  }

  const when=parseWhen(original,{timeZone,now});
  const dated=['task','event','goal'].includes(type);

  // A course code that matches nothing yet is kept so the user can create it in
  // one tap, instead of the capture silently dropping the class.
  const mention=classMatch.match?'':courseMention(original);
  let title=original;
  if (classMatch.match) title=removePhrase(title,classMatch.match.name);
  else if (mention) title=removePhrase(title,mention);
  if (areaMatch.match) title=removePhrase(title,areaMatch.match.name);
  title=cleanTitle(title.replace(STRIP_WHEN,' '))||cleanTitle(original.replace(STRIP_WHEN,' '))||original;

  const needs=[];
  if (dated&&(!when.matched||when.vague)) needs.push('date');
  else if (type==='event'&&!when.timeKnown) needs.push('time');
  const classCandidates=classMatch.match?[]:rankEntities(original,classes).filter(item=>item.score>=0.45).slice(0,4).map(item=>item.row);

  return {
    type,
    title,
    body:'',
    priority,
    source:'rules',
    when_phrase:when.matched?when.phrase:'',
    when_label:when.matched?when.label:'',
    when_vague:Boolean(when.vague),
    time_known:Boolean(when.timeKnown),
    due_at:dated&&!when.vague&&type!=='event'&&when.iso?when.iso:null,
    starts_at:type==='event'&&!when.vague&&when.iso?when.iso:null,
    area_id:areaId,
    area_name:areas.find(item=>item.id===areaId)?.name||'',
    class_id:classId,
    class_name:classes.find(item=>item.id===classId)?.name||mention||'',
    needs,
    class_candidates:classCandidates.map(item=>item.name),
    original
  };
}

export function heuristicDrafts(text, context={}) {
  return splitIntents(text).map(part=>heuristicDraft(part,context)).filter(Boolean);
}

// Extract a high-confidence direct user action (e.g. conversational additions or status toggles)
// to provide instantaneous execution without unnecessary model delays or interrogation.
export function extractDirectIntent(input, context={}) {
  const original=String(input??'').trim();
  if (!original) return null;
  const lower=original.toLowerCase();

  // Queries must never be treated as direct mutations
  if (/^(?:what|which|show|list|how|who|where|when|can you show|tell me|find|search)\b/i.test(lower)) return null;

  // Generic or vague creation requests must be handled through standard agent reasoning
  if (/^(?:create|add|make|new)\s+(?:a|an|one|two|three|some|\d+)?\s*(?:task|item|event|milestone)s?$/i.test(lower)) return null;

  // If a specific course code is mentioned that is not a registered class yet, let the agent manage class creation
  if (courseMention(original)) return null;

  // Unambiguous conversational additions like "I have a Superhuman SWE OA due in 7 days can you please add it to tasks"
  const isConversationalAdd = /^(?:i have|i got|there is|there's|got|we have)\s+/i.test(lower) && /\b(?:add (?:it|this)?\s*to\s*(?:my\s*)?tasks?|task|due)\b/i.test(lower);

  if (isConversationalAdd) {
    const draft = heuristicDraft(original, context);
    if (draft && draft.title && draft.title.length >= 3 && !/^(?:task|item|new task|something)$/i.test(draft.title)) {
      return {
        intent: 'create',
        op: 'create',
        draft
      };
    }
  }

  return null;
}
