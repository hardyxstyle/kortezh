// Кортеж — общ SQL модул (ползва се и в браузъра, и на сървъра, и при build).
// Не съдържа нищо тайно.

export const LIMITS = { sqlChars: 6000, statements: 40, rows: 2000 };

// Бележка: sql.js не може да добавя собствени функции в Cloudflare Workers (забранено е
// генериране на WebAssembly по време на работа), затова и в браузъра ползваме стандартното
// поведение на SQLite — LIKE различава малки/главни букви при кирилица.
export function setupFunctions(db) {}

export function createDb(SQL, seed, variant) {
  const db = new SQL.Database();
  setupFunctions(db);
  if (seed) db.exec(seed);
  if (variant) db.exec(variant);
  db.exec('PRAGMA foreign_keys = ON;');
  return db;
}

// Бързо отваряне от готов „снимка“ на базата (Uint8Array от db.export()).
export function openDb(SQL, bytes) {
  const db = new SQL.Database(bytes);
  setupFunctions(db);
  db.exec('PRAGMA foreign_keys = ON;');
  return db;
}

// Изпълнява всички заявки от текста. Връща последната таблица-резултат.
export function runSql(db, sql, params) {
  const out = { results: [], last: null, changes: 0, statements: 0, error: null };
  if (!sql || !sql.trim()) { out.error = 'Няма заявка.'; return out; }
  if (sql.length > LIMITS.sqlChars) { out.error = 'Заявката е твърде дълга.'; return out; }
  let it;
  try {
    it = db.iterateStatements(sql);
    for (const st of it) {
      out.statements++;
      if (out.statements > LIMITS.statements) { st.free(); throw new Error('Твърде много заявки наведнъж.'); }
      try {
        if (params && Object.keys(params).length) st.bind(params);
        const columns = st.getColumnNames();
        const rows = [];
        while (st.step()) {
          rows.push(st.get());
          if (rows.length >= LIMITS.rows) { out.truncated = true; break; }
        }
        if (columns.length) {
          const r = { columns, rows };
          out.results.push(r);
          out.last = r;
        } else {
          out.changes += db.getRowsModified();
        }
      } finally {
        st.free();
      }
    }
  } catch (e) {
    out.error = translateError(String(e && e.message ? e.message : e));
  }
  return out;
}

// Намира имената на параметрите (:име) в заявката, без тези в низове/коментари.
export function findParams(sql) {
  const names = [];
  const clean = String(sql || '')
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /(^|[^:\wЀ-ӿ])([:@$][\p{L}_][\p{L}\p{N}_]*)/gu;
  let m;
  while ((m = re.exec(clean))) if (!names.includes(m[2])) names.push(m[2]);
  return names;
}

const ERR = [
  [/no such table: (.+)/, (m) => `Няма таблица с име „${m[1]}“. Провери името (и главните букви).`],
  [/no such column: (.+)/, (m) => `Няма колона „${m[1]}“. Провери името. Имена с интервали се пишат в [ ], напр. [Дата на раждане].`],
  [/near "(.+?)": syntax error/, (m) => `Синтактична грешка близо до „${m[1]}“.`],
  [/incomplete input/, () => 'Заявката е недовършена (липсва нещо в края — скоба, кавичка?).'],
  [/unrecognized token: "(.+?)"/, (m) => `Непознат символ: ${m[1]} (текстът се пише в единични кавички 'така').`],
  [/ambiguous column name: (.+)/, (m) => `Колоната „${m[1]}“ я има в няколко таблици — напиши Таблица.${m[1]}.`],
  [/misuse of aggregate/, () => 'Агрегатна функция е използвана на неправилно място (в WHERE се ползва HAVING).'],
  [/UNIQUE constraint failed: (.+)/, (m) => `Нарушено е ограничението UNIQUE / PRIMARY KEY за ${m[1]} — такава стойност вече има.`],
  [/NOT NULL constraint failed: (.+)/, (m) => `Колоната ${m[1]} не може да е празна (NOT NULL).`],
  [/CHECK constraint failed/, () => 'Стойността не отговаря на условието CHECK.'],
  [/FOREIGN KEY constraint failed/, () => 'Нарушена е връзката (FOREIGN KEY) — такъв ред в свързаната таблица няма.'],
  [/table (.+) already exists/, (m) => `Таблица „${m[1]}“ вече съществува.`],
  [/sub-select returns (\d+) columns - expected 1/, () => 'Вложената заявка трябва да връща точно една колона.'],
  [/(\d+) values for (\d+) columns/, (m) => `Подаваш ${m[1]} стойности за ${m[2]} колони.`],
  [/table (.+) has (\d+) columns but (\d+) values were supplied/, (m) => `Таблицата ${m[1]} има ${m[2]} колони, а подаваш ${m[3]} стойности.`],
];
export function translateError(msg) {
  for (const [re, f] of ERR) {
    const m = msg.match(re);
    if (m) return f(m) + `  (SQL: ${msg})`;
  }
  return 'Грешка: ' + msg;
}

// ---------- сравнение на резултати ----------
function norm(v) {
  if (v === null || v === undefined) return '∅';
  if (typeof v === 'number') return 'n:' + (Math.round(v * 100) / 100).toString();
  if (v instanceof Uint8Array) return 'b:' + v.length;
  const s = String(v).trim();
  if (s !== '' && /^-?\d+(\.\d+)?$/.test(s)) return 'n:' + (Math.round(Number(s) * 100) / 100).toString();
  return 's:' + s;
}
const rowKey = (r) => r.map(norm).join('␟');
const sortedRowKey = (r) => r.map(norm).sort().join('␟');

export function isOrdered(sql) { return /\border\s+by\b/i.test(sql || ''); }

// expected/actual: {columns, rows}. Връща {ok, message}
export function compareResults(expected, actual, ordered) {
  if (!actual) return { ok: false, message: 'Заявката не върна таблица-резултат (липсва SELECT?).' };
  const ec = expected.columns.length, ac = actual.columns.length;
  const er = expected.rows.length, ar = actual.rows.length;
  if (ec !== ac) return { ok: false, message: `Резултатът ти има ${ac} ${ac === 1 ? 'колона' : 'колони'}, а се очакват ${ec}.` };
  if (er !== ar) return { ok: false, message: `Резултатът ти има ${ar} ${ar === 1 ? 'ред' : 'реда'}, а се очакват ${er}.` };
  const ek = expected.rows.map(rowKey), ak = actual.rows.map(rowKey);
  let same;
  if (ordered) same = ek.every((k, i) => k === ak[i]);
  else {
    const a = [...ek].sort(), b = [...ak].sort();
    same = a.every((k, i) => k === b[i]);
  }
  if (same) return { ok: true, message: 'Вярно!' };
  // подсказки
  if (ordered) {
    const a = [...ek].sort(), b = [...ak].sort();
    if (a.every((k, i) => k === b[i])) return { ok: false, message: 'Редовете са верните, но подредбата не е. Провери ORDER BY (ASC / DESC).' };
  }
  const es = expected.rows.map(sortedRowKey).sort(), as = actual.rows.map(sortedRowKey).sort();
  if (es.every((k, i) => k === as[i])) return { ok: false, message: 'Данните са верни, но колоните са в друг ред. Подреди ги както е в условието.' };
  return { ok: false, message: 'Броят на редовете и колоните е верен, но стойностите не съвпадат с очакваните.' };
}

// Пълна проверка на SQL задача.
// task: {type:'select'|'modify', params?:[...], check?, ordered, expected:[...], expectedVariant}
// newDb(variant:boolean) -> нова база (основни данни или скрития вариант)
export function gradeSql(task, sql, newDb) {
  if (!sql || !sql.trim()) return { ok: false, message: 'Няма написана заявка.' };
  const sets = task.params && task.params.length ? task.params : [null];
  const runs = sets.map((p, i) => ({ p, exp: task.expected[i], variant: false, i }));
  if (task.expectedVariant) runs.push({ p: sets[0], exp: task.expectedVariant, variant: true, i: 0 });
  for (const run of runs) {
    const db = newDb(run.variant);
    try {
      const r = runSql(db, sql, run.p);
      if (r.error) return { ok: false, message: r.error };
      let actual = r.last;
      if (task.type === 'modify') {
        const c = runSql(db, task.check, null);
        if (c.error) return { ok: false, message: 'След твоите заявки проверката не успя: ' + c.error };
        actual = c.last;
      }
      const cmp = compareResults(run.exp, actual, task.type === 'modify' ? true : task.ordered);
      if (!cmp.ok) {
        if (run.variant) {
          cmp.message = 'С основните данни резултатът ти е верен, но проверката пуска заявката и върху други (скрити) данни — там не става. Сигурно си написал(а) конкретна стойност или резултат, вместо да го пресметнеш, или условието е вярно само случайно.';
        } else if (run.i > 0) {
          cmp.message = 'С други стойности на параметрите резултатът е грешен — сигурно си написал(а) конкретна стойност вместо параметър. ' + cmp.message;
        } else if (task.type === 'modify') {
          cmp.message = 'Таблицата след твоите промени не е каквато трябва. ' + cmp.message;
        }
        return cmp;
      }
    } finally {
      db.close();
    }
  }
  return { ok: true, message: 'Вярно! Браво!' };
}
