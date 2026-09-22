import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// A stub local model. Whatever it answers, the workspace must stay usable: the
// capture parser resolves names itself and the agent may recover from failure.
function stubModel() {
  return http.createServer(async (req,res) => {
    let raw='';
    for await (const chunk of req) raw+=chunk;
    const {messages}=JSON.parse(raw);
    const system=messages.find(x=>x.role==='system')?.content||'';
    const user=messages.find(x=>x.role==='user')?.content||'';
    const steps=messages.filter(x=>x.role==='tool').length;
    const reply=message=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({message}))};
    const call=(name,args)=>reply({role:'assistant',tool_calls:[{function:{name,arguments:args}}]});

    if (system.includes('rough personal notes')) {
      if (user.includes('midterm')) return call('draft_entries',{entries:[{type:'task',title:'midterm coming up soon',class_name:'cs 3600',when:'soon'}]});
      if (user.includes('gym')) return call('draft_entries',{entries:[{type:'task',title:'Go to the gym',when:'tomorrow at 7am'}]});
      return reply({role:'assistant',content:'I did not understand that note.'});
    }
    if (user.includes('due 2027-03-04')) return call('propose_changes',{explanation:'Added the midterm.',changes:[{op:'create',fields:{type:'task',title:'Midterm',class_name:'cs 3600',when:'2027-03-04'}}]});
    if (user.includes('MATH 2210')) {
      if (!steps) return call('propose_changes',{explanation:'Added the final.',changes:[{op:'create',fields:{type:'task',title:'MATH 2210 final',class_name:'MATH 2210'}}]});
      if (steps===1) return call('create_class',{name:'MATH 2210'});
      return call('propose_changes',{explanation:'Added the final now that the class exists.',changes:[{op:'create',fields:{type:'task',title:'Final exam',class_name:'MATH 2210'}}]});
    }
    // A vague request that never becomes a change: the loop must end with a real
    // explanation instead of a dead end.
    return call('list_records',{limit:5});
  });
}

async function withApp(run) {
  const dir=await mkdtemp(join(tmpdir(),'orbit-natural-'));
  const model=stubModel();
  await new Promise(resolve=>model.listen(0,'127.0.0.1',resolve));
  const modelPort=model.address().port,port=35000+Math.floor(Math.random()*20000);
  const app=spawn(process.execPath,['server.mjs'],{cwd:join(import.meta.dirname,'..'),env:{...process.env,ORBIT_DATA_DIR:dir,PORT:String(port),ORBIT_TIMEZONE:'America/New_York',ORBIT_OLLAMA_URL:`http://127.0.0.1:${modelPort}`},stdio:['ignore','pipe','pipe']});
  try {
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Startup timed out')),5000);
      app.stdout.on('data',data=>{if(data.toString().includes('Orbit is running')){clearTimeout(timer);resolve()}});
      app.once('exit',code=>{clearTimeout(timer);reject(new Error(`App exited: ${code}`))});
    });
    const request=async(path,body)=>{
      const response=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
      return {status:response.status,data:await response.json()};
    };
    await run({request});
  } finally {app.kill('SIGTERM');model.close();await rm(dir,{recursive:true,force:true})}
}

test('capture never invents a date and keeps the class the user named', async () => {
  await withApp(async ({request}) => {
    const academic=(await request('/api/state')).data.areas.find(x=>x.name==='Academics');
    const created=await request('/api/classes',{name:'CS 3600'});
    assert.equal(created.status,201);

    const captured=await request('/api/capture',{text:'create a task in cs 3600 that we have a midterm soon'});
    assert.equal(captured.status,200);
    const [draft]=captured.data.drafts;
    assert.equal(draft.type,'task');
    assert.equal(draft.class_id,created.data.id);
    assert.equal(draft.area_id,academic.id);
    assert.equal(draft.due_at,null);
    assert.equal(draft.when_vague,true);
    assert.deepEqual(draft.needs,['date']);
    // Capture only proposes; nothing is written until the user confirms.
    assert.equal((await request('/api/state')).data.items.length,0);
  });
});

test('the local model may fill a gap but may not overwrite a good draft', async () => {
  await withApp(async ({request}) => {
    const captured=await request('/api/capture',{text:'add a task to hit the gym'});
    assert.equal(captured.status,200);
    const [draft]=captured.data.drafts;
    assert.equal(draft.title,'Hit the gym');
    assert.ok(draft.due_at,'the model supplied the missing date');
    assert.equal(new Date(draft.due_at).getHours(),7);
    assert.deepEqual(draft.needs,[]);
  });
});

test('an unknown class becomes a one-tap offer instead of a refusal', async () => {
  await withApp(async ({request}) => {
    const captured=await request('/api/capture',{text:'add a task for math 2210 homework friday'});
    const [draft]=captured.data.drafts;
    assert.equal(draft.class_id,null);
    assert.ok(draft.options.some(option=>option.kind==='create_class'&&option.name==='MATH 2210'),JSON.stringify(draft.options));
    assert.equal(draft.title,'Homework');
  });
});

test('the agent links a class by name, area, and date wording', async () => {
  await withApp(async ({request}) => {
    const state=(await request('/api/state')).data;
    const academic=state.areas.find(x=>x.name==='Academics');
    const added=await request('/api/classes',{name:'CS 3600'});
    const result=await request('/api/assistant',{question:'Create a task for the midterm in cs 3600 due 2027-03-04'});
    assert.equal(result.status,200);
    assert.equal(result.data.changes.length,1);
    const [task]=result.data.changes;
    assert.equal(task.title,'Midterm');
    assert.equal(task.class_id,added.data.id);
    assert.equal(task.area_id,academic.id);
    assert.equal(new Date(task.due_at).toISOString(),'2027-03-04T14:00:00.000Z');
    assert.ok(result.data.answer.includes('Created task'));
  });
});

test('the agent recovers by creating the class it could not find', async () => {
  await withApp(async ({request}) => {
    const result=await request('/api/assistant',{question:'Add a task for the MATH 2210 final'});
    assert.equal(result.status,200);
    const state=(await request('/api/state')).data;
    const created=state.classes.find(x=>x.name==='MATH 2210');
    assert.ok(created,'the class was created during recovery');
    assert.equal(result.data.changes.length,1);
    assert.equal(result.data.changes[0].class_id,created.id);
  });
});

test('a request that cannot be resolved explains itself with options', async () => {
  await withApp(async ({request}) => {
    const vague=await request('/api/assistant',{question:'Create a task'});
    assert.equal(vague.status,200);
    assert.equal(vague.data.changes.length,0);
    assert.match(vague.data.answer,/could not tell what to change/i);
    assert.doesNotMatch(vague.data.answer,/try a more specific instruction/i);
  });
});
