import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

const root = import.meta.dirname;
const dataDir = process.env.ORBIT_DATA_DIR || join(root, 'data');
await mkdir(dataDir, { recursive: true });
const db = new DatabaseSync(join(dataDir, 'orbit.sqlite'), { timeout: 5000 });
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
db.exec(`
CREATE TABLE IF NOT EXISTS areas (
 id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, color TEXT NOT NULL, created_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS classes (
 id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS items (
 id TEXT PRIMARY KEY,
 type TEXT NOT NULL CHECK(type IN ('task','note','journal','goal','event')),
 title TEXT NOT NULL,
 body TEXT NOT NULL DEFAULT '',
 area_id TEXT REFERENCES areas(id) ON DELETE SET NULL,
 course TEXT NOT NULL DEFAULT '',
 class_id TEXT REFERENCES classes(id) ON DELETE SET NULL,
 due_at TEXT,
 starts_at TEXT,
 ends_at TEXT,
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','done','archived')),
 priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high')),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_items_type_status_due ON items(type,status,due_at);
CREATE INDEX IF NOT EXISTS idx_items_area ON items(area_id);
CREATE INDEX IF NOT EXISTS idx_items_updated ON items(updated_at DESC);
CREATE VIRTUAL TABLE IF NOT EXISTS item_search USING fts5(title,body,course,content='items',content_rowid='rowid');
CREATE TRIGGER IF NOT EXISTS item_ai AFTER INSERT ON items BEGIN INSERT INTO item_search(rowid,title,body,course) VALUES(new.rowid,new.title,new.body,new.course); END;
CREATE TRIGGER IF NOT EXISTS item_ad AFTER DELETE ON items BEGIN INSERT INTO item_search(item_search,rowid,title,body,course) VALUES('delete',old.rowid,old.title,old.body,old.course); END;
CREATE TRIGGER IF NOT EXISTS item_au AFTER UPDATE ON items BEGIN INSERT INTO item_search(item_search,rowid,title,body,course) VALUES('delete',old.rowid,old.title,old.body,old.course); INSERT INTO item_search(rowid,title,body,course) VALUES(new.rowid,new.title,new.body,new.course); END;
`);

const now = () => new Date().toISOString();
const defaultAreas = [
  ['Academics','#8b7df8'], ['Career','#e8ae68'], ['Health','#6bc7a6'],
  ['Personal','#e997b3'], ['Projects','#73aaf2']
];
if (db.prepare('SELECT COUNT(*) AS n FROM areas').get().n === 0) {
  const insert = db.prepare('INSERT INTO areas VALUES(?,?,?,?)');
  for (const [name,color] of defaultAreas) insert.run(randomUUID(),name,color,now());
}

// Existing databases used a free-text course field. Link academic records to
// editable classes once, without altering their titles, details, or dates.
if (!db.prepare('PRAGMA table_info(items)').all().some(column => column.name === 'class_id')) {
  db.exec('BEGIN');
  try {
    db.exec('ALTER TABLE items ADD COLUMN class_id TEXT REFERENCES classes(id) ON DELETE SET NULL');
    db.exec("INSERT INTO item_search(item_search) VALUES('rebuild')");
    const academic = db.prepare("SELECT id FROM areas WHERE name='Academics'").get();
    if (academic) {
      const names = db.prepare("SELECT DISTINCT TRIM(course) AS name FROM items WHERE area_id=? AND TRIM(course)!=''").all(academic.id);
      for (const { name } of names) {
        let courseClass = db.prepare('SELECT id FROM classes WHERE name=? COLLATE NOCASE').get(name);
        if (!courseClass) {
          const id = randomUUID();
          db.prepare('INSERT INTO classes VALUES(?,?,?,?)').run(id,name,now(),now());
          courseClass = { id };
        }
        db.prepare('UPDATE items SET class_id=? WHERE area_id=? AND TRIM(course)=? COLLATE NOCASE').run(courseClass.id,academic.id,name);
      }
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
db.exec('CREATE INDEX IF NOT EXISTS idx_items_class ON items(class_id)');

const selectItems = `SELECT i.*, a.name AS area_name, a.color AS area_color, COALESCE(c.name,i.course) AS class_name FROM items i LEFT JOIN areas a ON a.id=i.area_id LEFT JOIN classes c ON c.id=i.class_id`;
const types = new Set(['task','note','journal','goal','event']);
const priorities = new Set(['low','medium','high']);
const statuses = new Set(['open','done','archived']);
const text = (v,max=5000) => typeof v === 'string' ? v.trim().slice(0,max) : '';
const maybeDate = v => v === null || v === '' || v === undefined ? null : Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : undefined;

function send(res, code, value) {
  const body = JSON.stringify(value);
  res.writeHead(code, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'Content-Length':Buffer.byteLength(body), 'X-Content-Type-Options':'nosniff' });
  res.end(body);
}
async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 65536) throw Object.assign(new Error('Request too large'),{ status:413 });
  }
  try { return JSON.parse(body || '{}'); }
  catch { throw Object.assign(new Error('Invalid JSON'),{ status:400 }); }
}
function validateItem(input, prior={}) {
  const field = key => Object.hasOwn(input,key) ? input[key] : prior[key];
  const type = input.type ?? prior.type;
  const title = text(input.title ?? prior.title,200);
  const body = text(input.body ?? prior.body ?? '',10000);
  const course = text(input.course ?? prior.course ?? '',100);
  const areaId = field('area_id') === '' ? null : field('area_id') ?? null;
  const classId = field('class_id') === '' ? null : field('class_id') ?? null;
  const dueAt = maybeDate(field('due_at'));
  const startsAt = maybeDate(field('starts_at'));
  const endsAt = maybeDate(field('ends_at'));
  const status = input.status ?? prior.status ?? 'open';
  const priority = input.priority ?? prior.priority ?? 'medium';
  if (!types.has(type) || !title || !priorities.has(priority) || !statuses.has(status) || [dueAt,startsAt,endsAt].includes(undefined)) throw Object.assign(new Error('Invalid item fields'),{status:400});
  if (areaId && !db.prepare('SELECT id FROM areas WHERE id=?').get(areaId)) throw Object.assign(new Error('Unknown area'),{status:400});
  if (classId) {
    const selectedClass = db.prepare('SELECT id FROM classes WHERE id=?').get(classId);
    const selectedArea = db.prepare('SELECT name FROM areas WHERE id=?').get(areaId);
    if (!selectedClass || selectedArea?.name !== 'Academics') throw Object.assign(new Error('Select a valid academic class'),{status:400});
  }
  if (type === 'event' && (!startsAt || (endsAt && endsAt < startsAt))) throw Object.assign(new Error('Event needs a valid start and end'),{status:400});
  return {type,title,body,course:classId?'':course,area_id:areaId,class_id:classId,due_at:dueAt,starts_at:startsAt,ends_at:endsAt,status,priority};
}
function listItems(query) {
  const clauses = [];
  const args = [];
  if (query.get('type') && types.has(query.get('type'))) { clauses.push('i.type=?'); args.push(query.get('type')); }
  if (query.get('area')) { clauses.push('i.area_id=?'); args.push(query.get('area')); }
  if (query.get('status') && statuses.has(query.get('status'))) { clauses.push('i.status=?'); args.push(query.get('status')); }
  if (query.get('q')) {
    const q = text(query.get('q'),100);
    clauses.push('(i.title LIKE ? OR i.body LIKE ? OR i.course LIKE ? OR c.name LIKE ?)');
    args.push(...Array(4).fill(`%${q}%`));
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  return db.prepare(`${selectItems}${where} ORDER BY CASE WHEN i.type='task' AND i.status='open' THEN 0 ELSE 1 END, CASE i.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, COALESCE(i.due_at,i.starts_at,i.updated_at) ASC LIMIT 5000`).all(...args);
}
function dashboard() {
  const items = db.prepare(`${selectItems} WHERE i.status!='archived' ORDER BY i.updated_at DESC LIMIT 5000`).all();
  return { areas: db.prepare('SELECT * FROM areas ORDER BY created_at').all(), classes: db.prepare('SELECT * FROM classes ORDER BY name COLLATE NOCASE').all(), items };
}
function assistant(question) {
  const q = text(question,500);
  if (!q) throw Object.assign(new Error('Ask a question first'),{status:400});
  const data = dashboard();
  const today = new Date();
  const soon = new Date(today.getTime()+7*86400000);
  const tokens = q.toLowerCase().split(/\W+/).filter(w=>w.length>2);
  const scored = data.items.map(item => {
    const hay = `${item.title} ${item.body} ${item.class_name} ${item.area_name || ''}`.toLowerCase();
    return {item, score: tokens.reduce((n,w)=>n+(hay.includes(w)?1:0),0)};
  }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,5).map(x=>x.item);
  const ql = q.toLowerCase();
  let matches = scored;
  let lead = 'Here is what I found in your workspace:';
  if (/today|now|focus|prioriti|next|urgent/.test(ql)) {
    matches = data.items.filter(x=>x.type==='task'&&x.status==='open').sort((a,b)=>(a.due_at||'9999').localeCompare(b.due_at||'9999')).slice(0,5);
    lead = 'Based on your open tasks, these deserve attention first:';
  } else if (/week|upcoming|deadline|due/.test(ql)) {
    matches = data.items.filter(x=>x.status==='open'&&x.due_at&&new Date(x.due_at)<=soon).sort((a,b)=>a.due_at.localeCompare(b.due_at)).slice(0,5);
    lead = 'These deadlines are coming up within seven days:';
  } else if (/goal|long.term/.test(ql)) {
    matches = data.items.filter(x=>x.type==='goal'&&x.status==='open').slice(0,5);
    lead = 'These are your active goals:';
  }
  if (!matches.length) return { answer:'I could not find relevant records yet. Add a task, note, goal, or event and ask again.', sources:[] };
  const lines = matches.map((x,i)=>`${i+1}. ${x.title}${x.class_name ? ` · ${x.class_name}` : ''}${x.due_at ? ` · due ${new Date(x.due_at).toLocaleDateString()}` : ''}${x.area_name ? ` · ${x.area_name}` : ''}`);
  return { answer:`${lead}\n\n${lines.join('\n')}\n\nThis answer uses only records in this app.`, sources:matches.map(x=>({id:x.id,title:x.title,type:x.type})) };
}

const mime = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};
const server = http.createServer(async (req,res) => {
  try {
    const host = req.headers.host || '';
    if (!/^((127\.0\.0\.1)|(localhost))(\:\d+)?$/.test(host)) return send(res,403,{error:'Local access only'});
    const origin = req.headers.origin;
    if (origin && origin !== `http://${host}`) return send(res,403,{error:'Cross-origin request blocked'});
    if (['POST','PATCH'].includes(req.method) && !req.headers['content-type']?.startsWith('application/json')) return send(res,415,{error:'JSON content type required'});
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      if (req.method==='GET' && url.pathname==='/api/state') return send(res,200,dashboard());
      if (req.method==='GET' && url.pathname==='/api/items') return send(res,200,listItems(url.searchParams));
      if (req.method==='POST' && url.pathname==='/api/items') {
        const item=validateItem(await readJson(req)); const id=randomUUID(); const stamp=now();
        db.prepare('INSERT INTO items(id,type,title,body,area_id,course,class_id,due_at,starts_at,ends_at,status,priority,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,item.type,item.title,item.body,item.area_id,item.course,item.class_id,item.due_at,item.starts_at,item.ends_at,item.status,item.priority,stamp,stamp);
        return send(res,201,db.prepare(`${selectItems} WHERE i.id=?`).get(id));
      }
      if (req.method==='POST' && url.pathname==='/api/classes') {
        const name=text((await readJson(req)).name,100);
        if (!name) return send(res,400,{error:'Class name is required'});
        if (db.prepare('SELECT id FROM classes WHERE name=? COLLATE NOCASE').get(name)) return send(res,409,{error:'That class already exists'});
        const id=randomUUID(), stamp=now();
        db.prepare('INSERT INTO classes VALUES(?,?,?,?)').run(id,name,stamp,stamp);
        return send(res,201,db.prepare('SELECT * FROM classes WHERE id=?').get(id));
      }
      if (req.method==='POST' && url.pathname==='/api/areas') {
        const input=await readJson(req); const name=text(input.name,50); const color=/^#[0-9a-fA-F]{6}$/.test(input.color)?input.color:'#8b7df8';
        if (!name) return send(res,400,{error:'Area name is required'});
        const id=randomUUID(); db.prepare('INSERT INTO areas VALUES(?,?,?,?)').run(id,name,color,now());
        return send(res,201,db.prepare('SELECT * FROM areas WHERE id=?').get(id));
      }
      if (req.method==='POST' && url.pathname==='/api/assistant') return send(res,200,assistant((await readJson(req)).question));
      if (req.method==='GET' && url.pathname==='/api/export') {
        res.writeHead(200,{'Content-Type':'application/json','Content-Disposition':'attachment; filename="orbit-backup.json"','Cache-Control':'no-store'});
        return res.end(JSON.stringify({schema_version:2,areas:db.prepare('SELECT * FROM areas ORDER BY created_at').all(),classes:db.prepare('SELECT * FROM classes ORDER BY name COLLATE NOCASE').all(),items:db.prepare(`${selectItems} ORDER BY i.created_at`).all(),exported_at:now()},null,2));
      }
      const classMatch=url.pathname.match(/^\/api\/classes\/([0-9a-f-]+)$/);
      if (classMatch) {
        const prior=db.prepare('SELECT * FROM classes WHERE id=?').get(classMatch[1]);
        if (!prior) return send(res,404,{error:'Class not found'});
        if (req.method==='PATCH') {
          const name=text((await readJson(req)).name,100);
          if (!name) return send(res,400,{error:'Class name is required'});
          if (db.prepare('SELECT id FROM classes WHERE name=? COLLATE NOCASE AND id!=?').get(name,prior.id)) return send(res,409,{error:'That class already exists'});
          db.prepare('UPDATE classes SET name=?,updated_at=? WHERE id=?').run(name,now(),prior.id);
          return send(res,200,db.prepare('SELECT * FROM classes WHERE id=?').get(prior.id));
        }
        if (req.method==='DELETE') {
          db.exec('BEGIN');
          try {
            db.prepare("UPDATE items SET course='',class_id=NULL,updated_at=? WHERE class_id=?").run(now(),prior.id);
            db.prepare('DELETE FROM classes WHERE id=?').run(prior.id);
            db.exec('COMMIT');
          } catch (error) { db.exec('ROLLBACK'); throw error; }
          return send(res,200,{ok:true});
        }
      }
      const match=url.pathname.match(/^\/api\/items\/([0-9a-f-]+)$/);
      if (match) {
        const prior=db.prepare('SELECT * FROM items WHERE id=?').get(match[1]);
        if (!prior) return send(res,404,{error:'Item not found'});
        if (req.method==='PATCH') {
          const item=validateItem(await readJson(req),prior);
          db.prepare('UPDATE items SET type=?,title=?,body=?,area_id=?,course=?,class_id=?,due_at=?,starts_at=?,ends_at=?,status=?,priority=?,updated_at=? WHERE id=?').run(item.type,item.title,item.body,item.area_id,item.course,item.class_id,item.due_at,item.starts_at,item.ends_at,item.status,item.priority,now(),match[1]);
          return send(res,200,db.prepare(`${selectItems} WHERE i.id=?`).get(match[1]));
        }
        if (req.method==='DELETE') {db.prepare('DELETE FROM items WHERE id=?').run(match[1]); return send(res,200,{ok:true});}
      }
      return send(res,404,{error:'Not found'});
    }
    if (req.method!=='GET') return send(res,405,{error:'Method not allowed'});
    const path = url.pathname==='/' ? '/index.html' : url.pathname;
    const file=resolve(join(root,'public'),'.'+path);
    if (!file.startsWith(join(root,'public')+'/')) return send(res,403,{error:'Forbidden'});
    const content=await readFile(file);
    res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Content-Length':content.length,'X-Content-Type-Options':'nosniff','Cache-Control':'no-cache'});
    res.end(content);
  } catch (error) {
    if (error.code==='ENOENT') return send(res,404,{error:'Not found'});
    if (error.code?.startsWith('SQLITE_CONSTRAINT')) return send(res,409,{error:'That name is already in use'});
    console.error(error);
    return send(res,error.status||500,{error:error.status?error.message:'Something went wrong'});
  }
});
const port=Number(process.env.PORT)||3000;
server.listen(port,'127.0.0.1',()=>console.log(`Orbit is running at http://127.0.0.1:${port}`));
