import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('agent applies one edit and previews an atomic batch', async () => {
  const dir=await mkdtemp(join(tmpdir(),'orbit-agent-'));
  const model=http.createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;
    const {messages}=JSON.parse(raw);
    const request=messages.find(x=>x.role==='user').content;
    const tools=messages.filter(x=>x.role==='tool');
    let call;
    if(request.includes('Create one task'))call={name:'propose_changes',arguments:{explanation:'Created the task.',changes:[{op:'create',fields:{type:'task',title:'Prepare Robinhood OA',priority:'high'}}]}};
    else if(request.includes('Create two tasks'))call={name:'propose_changes',arguments:{explanation:'Prepared two tasks.',changes:[{op:'create',fields:{type:'task',title:'Milestone one'}},{op:'create',fields:{type:'task',title:'Milestone two'}}]}};
    else if(request.includes('Update two tasks')){
      if(!tools.length)call={name:'search_records',arguments:{query:'Milestone'}};
      else if(tools.length<3)call={name:'get_record',arguments:{id:JSON.parse(tools[0].content)[tools.length-1].id}};
      else call={name:'propose_changes',arguments:{explanation:'Complete both milestones.',changes:tools.slice(1).map(x=>{const record=JSON.parse(x.content);return {op:'update',id:record.id,expected_updated_at:record.updated_at,fields:{status:'done'}}})}};
    }
    else if(request.includes('Reschedule the Robinhood task')){
      if(!tools.length)call={name:'search_records',arguments:{query:'Prepare Robinhood OA'}};
      else if(tools.length===1)call={name:'get_record',arguments:{id:JSON.parse(tools[0].content)[0].id}};
      else {const record=JSON.parse(tools[1].content);call={name:'propose_changes',arguments:{explanation:'Moved the task.',changes:[{op:'update',id:record.id,fields:{due_at:tools.length===2?'2026-09-25T18:00:00Z':'2026-09-25T18:00-04:00'}}]}}}
    }
    else if(!tools.length)call={name:'search_records',arguments:{query:'Prepare Robinhood OA'}};
    else if(tools.length===1)call={name:'get_record',arguments:{id:JSON.parse(tools[0].content)[0].id}};
    else {const record=JSON.parse(tools[1].content);call={name:'propose_changes',arguments:{explanation:'Marked the task done.',changes:[{op:'update',id:record.id,expected_updated_at:record.updated_at,fields:{status:'done'}}]}}}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({message:{role:'assistant',tool_calls:[{function:call}]}}));
  });
  await new Promise(resolve=>model.listen(0,'127.0.0.1',resolve));
  const modelPort=model.address().port,port=35000+Math.floor(Math.random()*20000);
  const app=spawn(process.execPath,['server.mjs'],{cwd:join(import.meta.dirname,'..'),env:{...process.env,ORBIT_DATA_DIR:dir,PORT:String(port),ORBIT_OLLAMA_URL:`http://127.0.0.1:${modelPort}`},stdio:['ignore','pipe','pipe']});
  try {
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Startup timed out')),5000);app.stdout.on('data',data=>{if(data.toString().includes('Orbit is running')){clearTimeout(timer);resolve()}});app.once('exit',code=>{clearTimeout(timer);reject(new Error(`App exited: ${code}`))})});
    const request=async(path,body)=>{const response=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json()}};
    const created=await request('/api/assistant',{question:'Create one task'});
    assert.equal(created.status,200);assert.equal(created.data.changes[0].title,'Prepare Robinhood OA');
    const updated=await request('/api/assistant',{question:'Mark Prepare Robinhood OA done'});
    assert.equal(updated.status,200);assert.equal(updated.data.changes[0].status,'done');
    const rescheduled=await request('/api/assistant',{question:'Reschedule the Robinhood task to September 25, 2026 at 6 PM New York time'});
    assert.equal(rescheduled.status,200);assert.equal(rescheduled.data.changes[0].due_at,'2026-09-25T22:00:00.000Z');
    const batch=await request('/api/assistant',{question:'Create two tasks'});
    assert.equal(batch.data.proposal.changes.length,2);
    assert.equal((await request('/api/state')).data.items.length,1);
    const applied=await request('/api/assistant/commit',{token:batch.data.proposal.token});
    assert.equal(applied.status,200);assert.equal(applied.data.changes.length,2);
    assert.equal((await request('/api/state')).data.items.length,3);
    assert.equal((await request('/api/assistant/commit',{token:batch.data.proposal.token})).status,410);
    const stale=await request('/api/assistant',{question:'Update two tasks'});
    assert.equal(stale.status,200);assert.equal(stale.data.proposal.changes.length,2);
    const changedId=stale.data.proposal.changes[0].id;
    const response=await fetch(`http://127.0.0.1:${port}/api/items/${changedId}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({priority:'high'})});
    assert.equal(response.status,200);
    assert.equal((await request('/api/assistant/commit',{token:stale.data.proposal.token})).status,409);
    assert.equal((await request('/api/state')).data.items.filter(x=>x.status==='done').length,1);
  } finally {app.kill('SIGTERM');model.close();await rm(dir,{recursive:true,force:true})}
});
