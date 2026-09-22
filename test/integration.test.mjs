import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

test('local workspace CRUD, grounded assistant, and complete export', async () => {
  const dir = await mkdtemp(join(tmpdir(),'orbit-test-'));
  const port = 35000 + Math.floor(Math.random()*20000);
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath,['server.mjs'],{cwd:join(import.meta.dirname,'..'),env:{...process.env,ORBIT_DATA_DIR:dir,PORT:String(port)},stdio:['ignore','pipe','pipe']});
  try {
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Server startup timed out')),5000);
      child.stdout.on('data',data=>{if(data.toString().includes('Orbit is running')){clearTimeout(timer);resolve()}});
      child.once('exit',code=>{clearTimeout(timer);reject(new Error(`Server exited: ${code}`))});
    });
    async function request(path,method='GET',body){const res=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:res.status,data:await res.json()}}
    const initial=await request('/api/state');
    assert.equal(initial.status,200);assert.equal(initial.data.areas.length,5);assert.equal(initial.data.classes.length,0);assert.equal(initial.data.items.length,0);
    const area=initial.data.areas.find(x=>x.name==='Academics');
    const addedClass=await request('/api/classes','POST',{name:'CS 3600'});
    assert.equal(addedClass.status,201);
    const duplicate=await request('/api/classes','POST',{name:'cs 3600'});
    assert.equal(duplicate.status,409);
    const invalid=await request('/api/items','POST',{type:'task',title:'Invalid class area',class_id:addedClass.data.id});
    assert.equal(invalid.status,400);
    const created=await request('/api/items','POST',{type:'task',title:'Finish AI assignment',body:'Read search notes',area_id:area.id,class_id:addedClass.data.id,due_at:'2026-09-24T18:00:00.000Z',priority:'high'});
    assert.equal(created.status,201);assert.equal(created.data.class_name,'CS 3600');
    const answer=await request('/api/assistant','POST',{question:'What about CS 3600?'});
    assert.equal(answer.status,200);assert.equal(answer.data.sources[0].id,created.data.id);
    const renamed=await request(`/api/classes/${addedClass.data.id}`,'PATCH',{name:'CS 3600 · Artificial Intelligence'});
    assert.equal(renamed.status,200);
    assert.equal((await request('/api/state')).data.items[0].class_name,renamed.data.name);
    const cleared=await request(`/api/items/${created.data.id}`,'PATCH',{due_at:null,status:'done'});
    assert.equal(cleared.status,200);assert.equal(cleared.data.due_at,null);assert.equal(cleared.data.status,'done');
    const exported=await request('/api/export');
    assert.equal(exported.status,200);assert.equal(exported.data.schema_version,2);assert.equal(exported.data.items.length,1);assert.equal(exported.data.classes.length,1);
    const deletedClass=await request(`/api/classes/${addedClass.data.id}`,'DELETE');
    assert.equal(deletedClass.status,200);
    const unassigned=(await request('/api/state')).data.items[0];
    assert.equal(unassigned.class_id,null);assert.equal(unassigned.class_name,'');assert.equal(unassigned.title,'Finish AI assignment');
    const removed=await request(`/api/items/${created.data.id}`,'DELETE');
    assert.equal(removed.status,200);assert.equal((await request('/api/state')).data.items.length,0);
  } finally { child.kill('SIGTERM'); await rm(dir,{recursive:true,force:true}); }
});

test('older academic course text migrates into editable classes', async () => {
  const dir=await mkdtemp(join(tmpdir(),'orbit-migrate-'));
  const file=join(dir,'orbit.sqlite');
  const db=new DatabaseSync(file);
  db.exec(`CREATE TABLE areas(id TEXT PRIMARY KEY,name TEXT,color TEXT,created_at TEXT);
    CREATE TABLE items(id TEXT PRIMARY KEY,type TEXT,title TEXT,body TEXT,area_id TEXT,course TEXT,due_at TEXT,starts_at TEXT,ends_at TEXT,status TEXT,priority TEXT,created_at TEXT,updated_at TEXT);
    INSERT INTO areas VALUES('academic-id','Academics','#8b7df8','2026-01-01T00:00:00Z');
    INSERT INTO items VALUES('old-item','task','Old assignment','','academic-id','CS 2340',NULL,NULL,NULL,'open','medium','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');`);
  db.close();
  const port=35000+Math.floor(Math.random()*20000);
  const child=spawn(process.execPath,['server.mjs'],{cwd:join(import.meta.dirname,'..'),env:{...process.env,ORBIT_DATA_DIR:dir,PORT:String(port)},stdio:['ignore','pipe','pipe']});
  let stderr='';child.stderr.on('data',data=>{stderr+=data.toString()});
  try {
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Migration startup timed out')),5000);child.stdout.on('data',data=>{if(data.toString().includes('Orbit is running')){clearTimeout(timer);resolve()}});child.once('exit',code=>{clearTimeout(timer);reject(new Error(`Migration server exited: ${code}\n${stderr}`))})});
    const response=await fetch(`http://127.0.0.1:${port}/api/state`);
    const state=await response.json();
    assert.equal(response.status,200);
    assert.equal(state.classes.length,1);
    assert.equal(state.classes[0].name,'CS 2340');
    assert.equal(state.items[0].class_id,state.classes[0].id);
  } finally {child.kill('SIGTERM');await rm(dir,{recursive:true,force:true})}
});
