// Measures the real agent path against a running Ollama. Start Ollama first.
//   npm run bench
//   npm run bench -- --model qwen3.5:4b --url http://127.0.0.1:11434
//   npm run bench -- --ask "mark the robinhood task done"
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const args=process.argv.slice(2);
const flag=name=>{const at=args.indexOf(name);return at<0?null:args[at+1]||null};
const model=flag('--model')||process.env.ORBIT_MODEL||'qwen3.5:4b';
const customUrl=flag('--url'),endpoint=customUrl||process.env.ORBIT_OLLAMA_URL||'http://127.0.0.1:11434';
const adhoc=flag('--ask');
const serverPath=flag('--server')||'server.mjs';
const seed=[
  {type:'task',title:'Prepare Robinhood OA',body:'Practice two graph problems',priority:'high',due_at:'2026-09-30T18:00:00.000Z'},
  {type:'task',title:'Milestone one',body:'Draft the outline'},
  {type:'task',title:'Milestone two',body:'Record a walkthrough'},
  {type:'note',title:'Search notes',body:'Traversal patterns for interviews'},
  {type:'goal',title:'Land a summer internship',body:'Apply to ten teams by November'}
];
const questions=[
  'What should I focus on this week?',
  'Mark Prepare Robinhood OA done',
  'Create a task to email the Robinhood recruiter tomorrow',
  'Reschedule Prepare Robinhood OA to Friday at 6 PM New York time',
  'Break down the Robinhood task into two milestones',
  'Delete Milestone two'
];

try {
  const tags=await fetch(endpoint+'/api/tags',{signal:AbortSignal.timeout(4000)});
  if (!tags.ok) throw new Error('HTTP '+tags.status);
  const installed=((await tags.json()).models||[]).map(x=>x.name);
  if (!installed.some(name=>name===model||name.startsWith(model.split(':')[0]+':'))) console.log('Warning: '+model+' is not installed at '+endpoint+'. Installed: '+(installed.join(', ')||'none'));
} catch (error) {
  console.error('Cannot reach Ollama at '+endpoint+' ('+error.message+').\nStart it with: ollama serve\nThen install the model: ollama pull '+model);
  process.exit(1);
}

const dir=await mkdtemp(join(tmpdir(),'orbit-bench-'));
const port=35000+Math.floor(Math.random()*20000);
const base='http://127.0.0.1:'+port;
const modelCalls=[];
const app=spawn(process.execPath,[serverPath],{cwd:join(import.meta.dirname,'..'),env:{...process.env,ORBIT_DATA_DIR:dir,PORT:String(port),ORBIT_DEBUG:'1',ORBIT_MODEL:model,...(customUrl?{ORBIT_OLLAMA_URL:customUrl}:{})},stdio:['ignore','pipe','pipe']});
app.stderr.setEncoding('utf8');
let tail='';
app.stderr.on('data',chunk=>{
  const lines=(tail+chunk).split('\n');tail=lines.pop()||'';
  for (const line of lines) {
    const logged=line.match(/^\[orbit\] model (.*)$/);
    if (logged) {try{modelCalls.push(JSON.parse(logged[1]))}catch{}}
    else if (line.trim()&&!/ExperimentalWarning|trace-warnings/.test(line)) console.error('app:',line.trim());
  }
});
const request=async(path,body,timeout=240000)=>{
  const response=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(timeout)});
  return {status:response.status,data:await response.json()};
};
const rows=[];
try {
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Startup timed out')),10000);app.stdout.on('data',data=>{if(data.toString().includes('Orbit is running')){clearTimeout(timer);resolve()}});app.once('exit',code=>{clearTimeout(timer);reject(new Error('App exited: '+code))})});
  for (const item of seed) await request('/api/items',item);
  console.log('Orbit bench · '+model+' · '+endpoint+' · '+serverPath+' · '+(adhoc?'1 ad-hoc question':'6 standard questions')+'\n');
  for (const question of adhoc?[adhoc]:questions) {
    const before=modelCalls.length,startedAt=Date.now();
    const row={question,ms:0,calls:0,prompt:0,cached:0,output:0,load:0,result:''};
    try {
      const response=await request('/api/assistant',{question});
      const data=response.data;
      row.result=response.status===200?(data.proposal?'preview '+data.proposal.changes.length+' change(s)':(data.changes?.length||0)+' change(s) applied'):'HTTP '+response.status+': '+data.error;
      if (response.status!==200) process.exitCode=1;
    } catch (error) {row.result='failed: '+error.message;process.exitCode=1}
    const used=modelCalls.slice(before);
    row.ms=Date.now()-startedAt;
    row.calls=used.length;
    row.prompt=used.reduce((n,x)=>n+(x.prompt_tokens||0),0);
    row.cached=used.reduce((n,x)=>n+(x.cached_tokens||0),0);
    row.output=used.reduce((n,x)=>n+(x.output_tokens||0),0);
    row.load=used.reduce((n,x)=>n+(x.load_ms||0),0);
    rows.push(row);
    console.log(String(row.ms).padStart(7)+' ms · '+String(row.calls).padStart(2)+' model call(s) · '+row.result+'\n  '+question);
  }
  const total=key=>rows.reduce((n,x)=>n+x[key],0),pad=(value,width)=>String(value).padEnd(width);
  console.log('\n'+pad('question',48)+pad('wall',9)+pad('calls',7)+pad('prompt',8)+pad('cached',8)+pad('output',8)+'result');
  for (const row of rows) console.log(pad(row.question.slice(0,46),48)+pad(row.ms+'ms',9)+pad(row.calls,7)+pad(row.prompt,8)+pad(row.cached,8)+pad(row.output,8)+row.result);
  const calls=total('calls');
  console.log('\nTotal '+total('ms')+'ms · '+calls+' model call(s) · '+total('prompt')+' prompt tokens · '+total('output')+' output tokens · '+total('load')+'ms model loading');
  if (calls) console.log('Per model call: '+Math.round(total('ms')/calls)+'ms wall · '+Math.round(total('prompt')/calls)+' prompt tokens · '+Math.round(total('output')/calls)+' output tokens');
} finally {app.kill('SIGTERM');await rm(dir,{recursive:true,force:true})}
