import { createRequire } from 'node:module';
import path from 'node:path';
import { createDb, runSql, findParams } from '../content/engine.mjs';
import { DATABASES } from '../content/databases.mjs';
import { LESSONS as BASE } from '../content/lessons.mjs';
import { NEW_LESSONS, BEYOND } from '../content/lessons2.mjs';
const LESSONS = [...BASE, ...NEW_LESSONS].map((L) => ({ ...L, theory: L.theory + (BEYOND[L.id] || '') }));
const require = createRequire(import.meta.url);
const initSqlJs = require(path.resolve('node_modules/sql.js/dist/sql-wasm.js'));
const SQL = await initSqlJs({ locateFile: (f) => path.resolve('node_modules/sql.js/dist', f) });
const un = (s) => s.replace(/&lt;/g, '<').replace(/&amp;/g, '&');
let n = 0;
for (const L of LESSONS) for (const m of L.theory.matchAll(/<pre class="ex" data-db="([^"]+)">([\s\S]*?)<\/pre>/g)) {
  n++;
  const sql = un(m[2]); const db = createDb(SQL, DATABASES[m[1]].seed);
  const ps = Object.fromEntries(findParams(sql).map((p) => [p, p.includes('клас') ? '12а' : p.includes('начало') ? (sql.includes('LIKE') ? 'Х' : 3) : p.includes('край') ? 7 : 5]));
  const r = runSql(db, sql, ps);
  console.log(L.id, r.error ? 'ERR ' + r.error.slice(0, 90) : `ok rows=${r.last ? r.last.rows.length : '-'}`, Object.keys(ps).join(','));
}
console.log('examples', n);
