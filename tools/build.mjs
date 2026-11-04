// Генерира съдържанието за сървъра (с решения) и за браузъра (без решения).
// Пуска се с: node tools/build.mjs
import { createRequire } from 'node:module';
import { writeFileSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createDb, runSql, isOrdered } from '../content/engine.mjs';
import { DATABASES } from '../content/databases.mjs';
import { LESSONS as BASE_LESSONS } from '../content/lessons.mjs';
import { EXTRA, EXTRA_LESSONS } from '../content/extra.mjs';
import { NEW_LESSONS, ORDER, PROGRAM, NOTEBOOK, GLOSSARY, VIZ, BEYOND, BEYOND_TASKS } from '../content/lessons2.mjs';

// Подреждане на уроците по ORDER; задачите: тестови въпроси → основни → бонус
const ALL_L = [...BASE_LESSONS, ...EXTRA_LESSONS, ...NEW_LESSONS];
const LESSONS = ORDER.map((id, idx) => {
  const L = ALL_L.find((x) => x.id === id);
  if (!L) throw new Error('Няма урок ' + id);
  const all = [...L.tasks, ...(EXTRA[id] || []), ...(BEYOND_TASKS[id] || [])];
  const rank = (t) => (t.kind === 'choice' ? 0 : t.bonus ? 2 : 1);
  return {
    ...L, num: idx + 1, theory: L.theory + (BEYOND[id] || ''),
    tasks: all.map((t, i) => [t, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([t]) => t),
  };
});

// ---------- подсказки (генерират се от решението, остават само на сървъра) ----------
const KW = new Set(('SELECT DISTINCT FROM WHERE AND OR NOT IN BETWEEN LIKE IS NULL JOIN INNER LEFT RIGHT FULL OUTER CROSS ON USING GROUP BY HAVING ORDER ASC DESC LIMIT AS UNION ALL INTERSECT EXCEPT EXISTS CASE WHEN THEN ELSE END INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE VIEW INDEX UNIQUE PRIMARY KEY FOREIGN REFERENCES DEFAULT CHECK ALTER ADD COLUMN RENAME TO DROP BEGIN TRANSACTION COMMIT ROLLBACK CASCADE ' +
  'COUNT SUM AVG MIN MAX ROUND LENGTH SUBSTR INSTR CAST COALESCE REPLACE TRIM JULIANDAY INTEGER TEXT REAL VARCHAR').split(' '));
const FEAT = [
  [/\bCREATE\s+VIEW\b/i, 'изглед (CREATE VIEW)'], [/\bCREATE\s+(UNIQUE\s+)?INDEX\b/i, 'индекс (CREATE INDEX)'], [/\bCREATE\s+TABLE\b[^;]*\bAS\s+SELECT\b/i, 'таблица от заявка (CREATE TABLE … AS SELECT)'],
  [/\bCREATE\s+TABLE\b/i, 'създаване на таблица (CREATE TABLE)'], [/\bALTER\s+TABLE\b/i, 'промяна на таблица (ALTER TABLE)'], [/\bDROP\b/i, 'изтриване на обект (DROP)'],
  [/\bINSERT\b/i, 'добавяне на редове (INSERT INTO)'], [/\bUPDATE\b/i, 'промяна (UPDATE … SET)'], [/\bDELETE\b/i, 'изтриване на редове (DELETE)'], [/\bBEGIN\b/i, 'транзакция (BEGIN … COMMIT / ROLLBACK)'],
  [/\bLEFT\s+(OUTER\s+)?JOIN\b/i, 'LEFT JOIN'], [/\bFULL\s+(OUTER\s+)?JOIN\b/i, 'FULL OUTER JOIN'], [/\bCROSS\s+JOIN\b/i, 'CROSS JOIN'], [/(?<!LEFT\s|FULL\s|OUTER\s|CROSS\s)\bJOIN\b/i, 'свързване на таблици (JOIN … ON)'],
  [/\bUNION\b/i, 'обединение (UNION)'], [/\bINTERSECT\b/i, 'сечение (INTERSECT)'], [/\bEXCEPT\b/i, 'разлика (EXCEPT)'],
  [/\bDISTINCT\b/i, 'DISTINCT'], [/\bWHERE\b/i, 'условие (WHERE)'], [/\bBETWEEN\b/i, 'BETWEEN'], [/\bLIKE\b/i, 'LIKE с %'], [/\bIS\s+(NOT\s+)?NULL\b/i, 'проверка IS NULL'], [/\bNOT\s+IN\b/i, 'NOT IN'], [/(?<!NOT\s)\bIN\s*\(/i, 'IN (…)'], [/\bEXISTS\b/i, 'EXISTS'],
  [/\bCASE\b/i, 'CASE WHEN … END'], [/\bCOALESCE\b/i, 'COALESCE'], [/\bCAST\b/i, 'CAST'], [/\bSUBSTR\b/i, 'SUBSTR'], [/\bLENGTH\b/i, 'LENGTH'], [/\bINSTR\b/i, 'INSTR'], [/\|\|/, 'слепване на текст (||)'],
  [/\bCOUNT\s*\(\s*DISTINCT/i, 'COUNT(DISTINCT …)'], [/\bCOUNT\b/i, 'COUNT'], [/\bSUM\b/i, 'SUM'], [/\bAVG\b/i, 'AVG'], [/\bMIN\b/i, 'MIN'], [/\bMAX\b/i, 'MAX'], [/\bROUND\b/i, 'ROUND'],
  [/\bGROUP\s+BY\b/i, 'групиране (GROUP BY)'], [/\bHAVING\b/i, 'условие за групите (HAVING)'], [/\bORDER\s+BY\b[^;]*\bDESC\b/i, 'сортиране низходящо (ORDER BY … DESC)'], [/\bORDER\s+BY\b/i, 'сортиране (ORDER BY)'], [/\bLIMIT\b/i, 'LIMIT'],
];
function makeHints(t, tables) {
  if (t.hints) return t.hints;
  const sol = t.solution;
  const bare = sol.replace(/\[[^\]]*\]/g, ' ').replace(/'(?:[^']|'')*'/g, ' ');
  const used = tables.filter((n) => new RegExp('(^|[^\\p{L}\\p{N}_])' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}\\p{N}_])', 'u').test(bare));
  const feats = [];
  for (const [re, label] of FEAT) if (re.test(bare) && !feats.includes(label)) feats.push(label);
  const drop = (a, b) => { if (feats.includes(a) && feats.includes(b)) feats.splice(feats.indexOf(b), 1); };
  drop('сортиране низходящо (ORDER BY … DESC)', 'сортиране (ORDER BY)');
  drop('COUNT(DISTINCT …)', 'COUNT');
  drop('таблица от заявка (CREATE TABLE … AS SELECT)', 'създаване на таблица (CREATE TABLE)');
  if (!/SELECT\s+DISTINCT/i.test(bare) && feats.includes('DISTINCT')) feats.splice(feats.indexOf('DISTINCT'), 1);
  if (/\(\s*SELECT\b/i.test(bare)) feats.push('вложена заявка (SELECT в скоби)');
  const h1 = (used.length ? `Ще ти трябва ${used.length > 1 ? 'таблиците' : 'таблицата'} ${used.join(', ')}. ` : '') + (feats.length ? 'Използвай: ' + feats.join('; ') + '.' : '');
  // скелет: ключовите думи и таблиците остават, останалото става …
  const tokRe = /'(?:[^']|'')*'|\[[^\]]*\]|"[^"]*"|[\p{L}_][\p{L}\p{N}_.]*|\d+(?:\.\d+)?|<=|>=|<>|!=|\|\||[(),;*=<>+\-\/%.]|:\S+/gu;
  const out = [];
  for (const tok of sol.match(tokRe) || []) {
    const up = tok.toUpperCase();
    let keep = null;
    if (KW.has(up)) keep = up;
    else if (tables.includes(tok)) keep = tok;
    else if (tok === '(' || tok === ')' || tok === ',' || tok === ';' || tok === '*') keep = tok;
    if (keep === null) { if (out[out.length - 1] !== '…') out.push('…'); }
    else out.push(keep);
  }
  let h2 = out.join(' ').replace(/\( /g, '(').replace(/ \)/g, ')').replace(/ ,/g, ',').replace(/ ;/g, ';').replace(/(…, )+…/g, '…').replace(/\b(COUNT|SUM|AVG|MIN|MAX|ROUND|LENGTH|SUBSTR|INSTR|CAST|COALESCE|REPLACE|TRIM|JULIANDAY|VARCHAR) \(/g, '$1(');
  return [h1.trim(), h2];
}

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

const tablesByDb = Object.fromEntries(Object.entries(publicDbs).map(([k, d]) => [k, d.schema.map((t) => t.table)]));
const serverTasks = {};
const publicLessons = [];
const ids = new Set();

for (const L of LESSONS) {
  const pl = { id: L.id, num: L.num, book: L.book, title: L.title, prog: PROGRAM[L.id] || '', theory: L.theory.trim(), notebook: NOTEBOOK[L.id] || [], viz: VIZ[L.id] || [], tasks: [] };
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
      srv.hints = makeHints(t, tablesByDb[t.db]);
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
  header + `window.KORTEZH = ${JSON.stringify({ dbs: publicDbs, lessons: publicLessons, glossary: GLOSSARY })};\n`);
copyFileSync(path.join(root, 'content/engine.mjs'), path.join(root, 'functions/_lib/engine.js'));
copyFileSync(path.join(root, 'content/engine.mjs'), path.join(root, 'public/engine.js'));

const nTasks = Object.keys(serverTasks).length;
console.log(`Уроци: ${LESSONS.length}, задачи: ${nTasks} (SQL: ${Object.values(serverTasks).filter((t) => t.kind === 'sql').length})`);
console.log(`Грешки: ${errors}, предупреждения: ${warnings}`);
if (errors) process.exit(1);
