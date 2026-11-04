// Генерира съдържанието за сървъра (с решения) и за браузъра (без решения).
// Пуска се с: node tools/build.mjs
import { createRequire } from 'node:module';
import { writeFileSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createDb, runSql, isOrdered } from '../content/engine.mjs';
import { DATABASES } from '../content/databases.mjs';
import { LESSONS } from '../content/lessons.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const initSqlJs = require(path.join(root, 'node_modules/sql.js/dist/sql-wasm.js'));
const SQL = await initSqlJs({ locateFile: (f) => path.join(root, 'node_modules/sql.js/dist', f) });

let errors = 0, warnings = 0;
const err = (m) => { errors++; console.error('ГРЕШКА:', m); };
const wrn = (m) => { warnings++; console.warn('внимание:', m); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// структура на базите
const publicDbs = {};
for (const [name, d] of Object.entries(DATABASES)) {
  const db = createDb(SQL, d.seed);
  const tables = runSql(db, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY rowid").last.rows.map((r) => r[0]);
  const schema = tables.map((t) => {
    const cols = runSql(db, `SELECT name, type, pk FROM pragma_table_info('${t}') ORDER BY cid`).last.rows;
    const fks = runSql(db, `SELECT "from", "table", "to" FROM pragma_foreign_key_list('${t}')`).last?.rows || [];
    const count = runSql(db, `SELECT COUNT(*) FROM [${t}]`).last.rows[0][0];
    return { table: t, rows: count, columns: cols.map(([n, ty, pk]) => ({ name: n, type: ty, pk: !!pk })), fks };
  });
  publicDbs[name] = { title: d.title, description: d.description, seed: d.seed.trim(), schema };
  db.close();
  if (d.variant) { const v = createDb(SQL, d.seed, d.variant); v.close(); }
}

// Изпълнява решението и връща очаквания резултат
function expect(t, dbdef, params, variant, tag) {
  const mk = (pragma) => {
    const db = createDb(SQL, dbdef.seed, variant ? dbdef.variant : null);
    if (pragma) db.exec(pragma);
    return db;
  };
  const db = mk();
  const r = runSql(db, t.solution, params);
  if (r.error) { err(`${t.id} ${tag}: решението дава грешка: ${r.error}`); db.close(); return null; }
  let res = r.last;
  if (t.type === 'modify') {
    if (!t.check || !isOrdered(t.check)) err(`${t.id}: modify задача без check с ORDER BY`);
    const c = runSql(db, t.check, null);
    if (c.error) err(`${t.id} ${tag}: check дава грешка: ${c.error}`);
    res = c.last;
    const db0 = mk();
    const c0 = runSql(db0, t.check, null);
    if (!c0.error && same(c0.last, res)) err(`${t.id} ${tag}: check не забелязва промяната`);
    db0.close();
  }
  db.close();
  if (!res) { err(`${t.id} ${tag}: решението не връща таблица`); return null; }
  if (!res.rows.length) wrn(`${t.id} ${tag}: празен очакван резултат`);
  if (t.type === 'select' && isOrdered(t.solution)) {
    const db2 = mk('PRAGMA reverse_unordered_selects = ON;');
    const r2 = runSql(db2, t.solution, params);
    if (!same(r2.last, res)) err(`${t.id} ${tag}: ORDER BY не определя еднозначно реда (равни стойности)`);
    db2.close();
  }
  return res;
}

const serverTasks = {};
const publicLessons = [];
const ids = new Set();

for (const L of LESSONS) {
  const pl = { id: L.id, num: L.num, book: L.book, title: L.title, theory: L.theory.trim(), tasks: [] };
  for (const t of L.tasks) {
    if (ids.has(t.id)) err(`повторен id ${t.id}`);
    ids.add(t.id);
    const pub = { id: t.id, kind: t.kind, title: t.title, text: t.text, bonus: !!t.bonus };
    const srv = { lesson: L.id, kind: t.kind, bonus: !!t.bonus };
    if (t.kind === 'choice') {
      pub.options = t.options;
      srv.answer = t.answer;
      srv.explain = t.explain || '';
      if (!(t.answer >= 0 && t.answer < t.options.length)) err(`${t.id}: невалиден answer`);
    } else {
      const dbdef = DATABASES[t.db];
      if (!dbdef) { err(`${t.id}: няма база ${t.db}`); continue; }
      Object.assign(pub, { type: t.type, db: t.db });
      Object.assign(srv, { type: t.type, db: t.db });
      const sets = t.params && t.params.length ? t.params : [null];
      const expected = sets.map((p, i) => expect(t, dbdef, p, false, `[набор ${i + 1}]`));
      if (dbdef.variant) {
        const ev = expect(t, dbdef, sets[0], true, '[вариант]');
        srv.expectedVariant = ev;
        if (ev && same(ev, expected[0]) && !t.params && !/pragma_|sqlite_master/i.test(t.check || '')) wrn(`${t.id}: скритият вариант дава същия резултат (не хваща нагласени отговори)`);
      }
      if (t.params) {
        pub.params = Object.keys(t.params[0]);
        srv.params = t.params;
        if (expected.length > 1 && expected.every((e) => same(e, expected[0]))) err(`${t.id}: различните параметри дават еднакъв резултат`);
        pub.paramExample = t.params[0];
      }
      srv.ordered = t.type === 'modify' ? true : isOrdered(t.solution);
      if (t.check) srv.check = t.check;
      srv.expected = expected;
      if (t.type === 'select' && expected[0]) pub.expected = expected[0];
      if (t.type === 'modify' && !/pragma_|sqlite_master/i.test(t.check)) pub.checkSql = t.check;
    }
    pl.tasks.push(pub);
    serverTasks[t.id] = srv;
  }
  publicLessons.push(pl);
}

const dbSeeds = Object.fromEntries(Object.entries(DATABASES).map(([k, v]) => [k, { seed: v.seed.trim(), variant: (v.variant || '').trim() }]));
const lessonMeta = LESSONS.map((L) => ({ id: L.id, num: L.num, book: L.book, title: L.title, tasks: L.tasks.map((t) => t.id), main: L.tasks.filter((t) => !t.bonus).map((t) => t.id) }));

const header = '// АВТОМАТИЧНО ГЕНЕРИРАН ФАЙЛ — не редактирай на ръка. Източник: content/*.mjs, команда: node tools/build.mjs\n';
writeFileSync(path.join(root, 'functions/_lib/content.js'),
  header +
  `export const DB_SEEDS = ${JSON.stringify(dbSeeds)};\n` +
  `export const TASKS = ${JSON.stringify(serverTasks)};\n` +
  `export const LESSONS = ${JSON.stringify(lessonMeta)};\n`);
writeFileSync(path.join(root, 'public/content.js'),
  header + `window.KORTEZH = ${JSON.stringify({ dbs: publicDbs, lessons: publicLessons })};\n`);
copyFileSync(path.join(root, 'content/engine.mjs'), path.join(root, 'functions/_lib/engine.js'));
copyFileSync(path.join(root, 'content/engine.mjs'), path.join(root, 'public/engine.js'));

const nTasks = Object.keys(serverTasks).length;
console.log(`Уроци: ${LESSONS.length}, задачи: ${nTasks} (SQL: ${Object.values(serverTasks).filter((t) => t.kind === 'sql').length})`);
console.log(`Грешки: ${errors}, предупреждения: ${warnings}`);
if (errors) process.exit(1);
