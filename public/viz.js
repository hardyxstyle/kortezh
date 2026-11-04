// Кортеж — визуални обяснения стъпка по стъпка (WHERE, JOIN, GROUP BY и др.).
import { esc, freshDb } from '/common.js';
import { runSql } from '/engine.js';

const q = (db, sql, params) => {
  const r = runSql(db, sql, params || null);
  if (r.error) throw new Error(r.error + ' — ' + sql);
  return r.last || { columns: [], rows: [] };
};
const br = (c) => `[${c}]`;
const fmt = (v) => (v === null ? '<span class="null">NULL</span>' : typeof v === 'number' ? esc(Number.isInteger(v) ? v : Math.round(v * 100) / 100) : esc(v));

function table(cols, rows, o = {}) {
  const head = cols.map((c, j) => `<th class="${o.colClass ? o.colClass(j) : ''}">${esc(c)}</th>`).join('');
  const body = rows.map((r, i) => `<tr class="${o.rowClass ? o.rowClass(i) : ''}">${r.map((v, j) => `<td class="${typeof v === 'number' ? 'num ' : ''}${v === null ? 'null ' : ''}${o.colClass ? o.colClass(j) : ''} ${o.cellClass ? o.cellClass(i, j) : ''}">${fmt(v)}</td>`).join('')}</tr>`).join('');
  return `<div class="rt-wrap" style="max-height:none"><table class="rt"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}
const block = (label, html) => `<div><p class="lbl">${esc(label)}</p>${html}</div>`;

// ---------- построяване на стъпките ----------
const BUILD = {
  project(v, db) {
    const t = q(db, `SELECT * FROM ${v.table}${v.pre || v.where ? ' WHERE ' + (v.pre || v.where) : ''}`);
    const idx = v.cols.map((c) => t.columns.indexOf(c));
    const res = t.rows.map((r) => idx.map((j) => r[j]));
    return [
      { cap: `Това е таблицата <b>${esc(v.table)}</b> — всички колони.`, html: table(t.columns, t.rows) },
      { cap: `<code>SELECT ${v.cols.join(', ')}</code> избира само тези колони. Останалите отпадат.`, html: table(t.columns, t.rows, { colClass: (j) => (idx.includes(j) ? 'v-col' : 'v-dim') }) },
      { cap: 'Резултатът е нова, временна таблица със същия брой редове, но само с избраните колони — това е <b>проекция</b>.', html: table(v.cols, res) },
    ];
  },
  filter(v, db) {
    const show = v.show.map(br).join(', ');
    const t = q(db, `SELECT ${show}, CASE WHEN ${v.where} THEN 1 ELSE 0 END FROM ${v.table}${v.pre ? ' WHERE ' + v.pre : ''}`, v.params);
    const cols = t.columns.slice(0, -1);
    const rows = t.rows.map((r) => r.slice(0, -1));
    const ok = t.rows.map((r) => r[r.length - 1] === 1);
    const kept = rows.filter((_, i) => ok[i]);
    const pIdx = (v.cols || v.show).map((c) => cols.indexOf(c));
    const steps = [
      { cap: `Започваме от таблицата <b>${esc(v.table)}</b>${v.pre ? ' (показани са само част от редовете)' : ''}.`, html: table(cols, rows) },
      { cap: `За <b>всеки ред</b> се проверява условието <code>${esc(v.where)}</code>${v.params ? ` при ${Object.entries(v.params).map(([k, x]) => `<code>${esc(k)} = '${esc(x)}'</code>`).join(', ')}` : ''}. Зелените отговарят, червените — не.`, html: table(cols, rows, { rowClass: (i) => (ok[i] ? 'v-ok' : 'v-no') }) },
      { cap: `Остават само ${kept.length} реда — това е <b>селекция</b>.`, html: table(cols, kept) },
    ];
    if (v.cols && v.cols.length !== v.show.length) steps.push({ cap: `Накрая <code>SELECT ${v.cols.join(', ')}</code> оставя само избраните колони (проекция).`, html: table(v.cols, kept.map((r) => pIdx.map((j) => r[j]))) });
    return steps;
  },
  calc(v, db) {
    const t = q(db, `SELECT ${v.show.map(br).join(', ')}, ${v.add.map((a) => a.sql).join(', ')} FROM ${v.table}${v.pre ? ' WHERE ' + v.pre : ''}`);
    const base = v.show.length;
    const steps = [{ cap: `Таблицата <b>${esc(v.table)}</b> има колони ${v.show.map((c) => `<b>${esc(c)}</b>`).join(', ')}.`, html: table(v.show, t.rows.map((r) => r.slice(0, base))) }];
    v.add.forEach((a, k) => {
      const n = base + k + 1;
      steps.push({ cap: `Изчислимото поле <code>${esc(a.sql)} AS ${esc(a.as)}</code> се пресмята <b>за всеки ред</b>. В таблицата нищо не се записва.`, html: table([...v.show, ...v.add.slice(0, k + 1).map((x) => x.as)], t.rows.map((r) => r.slice(0, n)), { colClass: (j) => (j === n - 1 ? 'v-col' : '') }) });
    });
    return steps;
  },
  sort(v, db) {
    const sel = v.show.map(br).join(', ');
    const a = q(db, `SELECT ${sel} FROM ${v.table}${v.pre ? ' WHERE ' + v.pre : ''}`);
    const b = q(db, `SELECT ${sel} FROM ${v.table}${v.pre ? ' WHERE ' + v.pre : ''} ORDER BY ${v.order}`);
    const col = v.order.split(' ')[0];
    const ci = a.columns.indexOf(col);
    return [
      { cap: 'Без ORDER BY редовете идват в произволен ред (обикновено реда на въвеждане).', html: table(a.columns, a.rows) },
      { cap: `<code>ORDER BY ${esc(v.order)}</code> пренарежда редовете по колоната <b>${esc(col)}</b>${/DESC/i.test(v.order) ? ' — от най-голямото към най-малкото' : ''}. Липсващите стойности (NULL) отиват в единия край.`, html: table(b.columns, b.rows, { colClass: (j) => (j === ci ? 'v-col' : '') }) },
    ];
  },
  group(v, db) {
    const sel = v.show.map(br).join(', ');
    const a = q(db, `SELECT ${sel} FROM ${v.table}`);
    const sorted = q(db, `SELECT ${sel} FROM ${v.table} ORDER BY ${br(v.by)}`);
    const gi = sorted.columns.indexOf(v.by);
    const groups = [...new Set(sorted.rows.map((r) => r[gi]))];
    const res = q(db, `SELECT ${br(v.by)}, ${v.aggs.map((x) => `${x.sql} AS ${br(x.as)}`).join(', ')} FROM ${v.table} GROUP BY ${br(v.by)} ORDER BY ${br(v.by)}`);
    return [
      { cap: `Таблицата <b>${esc(v.table)}</b>.`, html: table(a.columns, a.rows) },
      { cap: `<code>GROUP BY ${esc(v.by)}</code> събира редовете с еднаква стойност на <b>${esc(v.by)}</b> в група. Всеки цвят е една група — ${groups.length} групи.`, html: table(sorted.columns, sorted.rows, { rowClass: (i) => 'g' + (groups.indexOf(sorted.rows[i][gi]) % 8), colClass: (j) => (j === gi ? 'v-col' : '') }) },
      { cap: `За всяка група агрегатните функции (${v.aggs.map((x) => `<code>${esc(x.sql)}</code>`).join(', ')}) дават <b>по една стойност</b>. Затова резултатът има по един ред на група.`, html: table(res.columns, res.rows, { rowClass: (i) => 'g' + (i % 8) }) },
    ];
  },
  join(v, db) {
    const L = q(db, `SELECT ${v.left.cols.map(br).join(', ')} FROM ${v.left.table}${v.left.where ? ' WHERE ' + v.left.where : ''}`);
    const R = q(db, `SELECT ${v.right.cols.map(br).join(', ')} FROM ${v.right.table}${v.right.where ? ' WHERE ' + v.right.where : ''}`);
    const li = L.columns.indexOf(v.on[0]), ri = R.columns.indexOf(v.on[1]);
    const cols = [...L.columns, ...R.columns.map((c) => (L.columns.includes(c) ? v.right.table + '.' + c : c))];
    const steps = [{ cap: `Две таблици: <b>${esc(v.left.table)}</b> (лява) и <b>${esc(v.right.table)}</b> (дясна). Свързваме ги по условието <code>${esc(v.left.table)}.${esc(v.on[0])} = ${esc(v.right.table)}.${esc(v.on[1])}</code>.`, html: block(v.left.table, table(L.columns, L.rows)) + block(v.right.table, table(R.columns, R.rows)) }];
    const res = [];
    L.rows.slice(0, 7).forEach((lr, i) => {
      const m = R.rows.map((rr, j) => (lr[li] !== null && rr[ri] === lr[li] ? j : -1)).filter((j) => j >= 0);
      const before = res.length;
      if (m.length) m.forEach((j) => res.push([...lr, ...R.rows[j]]));
      else if (v.kind === 'left') res.push([...lr, ...R.columns.map(() => null)]);
      const what = m.length ? `съвпада с ${m.length} ${m.length === 1 ? 'ред' : 'реда'} отдясно → ${m.length} ${m.length === 1 ? 'нов ред' : 'нови реда'} в резултата` : v.kind === 'left' ? 'няма двойка отдясно, но при <b>LEFT JOIN</b> редът остава, а дясната част е NULL' : 'няма двойка отдясно → при <b>INNER JOIN</b> редът отпада';
      steps.push({
        cap: `Ред ${i + 1} отляво (<code>${esc(v.on[0])} = ${fmt(lr[li])}</code>) ${what}.`,
        html: block(v.left.table, table(L.columns, L.rows, { rowClass: (k) => (k === i ? 'v-cur' : '') })) + block(v.right.table, table(R.columns, R.rows, { rowClass: (k) => (m.includes(k) ? 'v-ok' : '') })) + block('Резултат', table(cols, res, { rowClass: (k) => (k >= before ? 'v-new' : '') })),
      });
    });
    steps.push({ cap: `Готово: ${res.length} реда. ${v.kind === 'left' ? 'LEFT JOIN запазва всички редове от лявата таблица.' : 'INNER JOIN връща само двойките, които съвпадат.'}`, html: table(cols, res) });
    return steps;
  },
  setop(v, db) {
    const A = [...new Set(q(db, v.a.sql).rows.map((r) => r[0]))];
    const B = [...new Set(q(db, v.b.sql).rows.map((r) => r[0]))];
    const inB = new Set(B), inA = new Set(A);
    const box = (label, items, cls) => block(label, `<div class="setbox">${items.map((x) => `<div class="it ${cls ? cls(x) : ''}">${esc(x)}</div>`).join('')}</div>`);
    const inter = A.filter((x) => inB.has(x)), uni = [...A, ...B.filter((x) => !inA.has(x))], diff = A.filter((x) => !inB.has(x));
    return [
      { cap: `Две множества: <b>A</b> — ${esc(v.a.label)}, <b>B</b> — ${esc(v.b.label)}.`, html: box('A', A) + box('B', B) },
      { cap: `<code>A INTERSECT B</code> — само общите стойности (${inter.length}).`, html: box('A', A, (x) => (inB.has(x) ? 'v-ok' : 'v-no')) + box('B', B, (x) => (inA.has(x) ? 'v-ok' : 'v-no')) + box('Резултат', inter) },
      { cap: `<code>A UNION B</code> — всички стойности, всяка по веднъж (${uni.length}).`, html: box('A', A, () => 'v-ok') + box('B', B, () => 'v-ok') + box('Резултат', uni) },
      { cap: `<code>A EXCEPT B</code> — стойностите от A, които ги няма в B (${diff.length}).`, html: box('A', A, (x) => (inB.has(x) ? 'v-no' : 'v-ok')) + box('B', B, () => 'v-no') + box('Резултат', diff) },
    ];
  },
  subquery(v, db) {
    const val = q(db, v.inner).rows[0][0];
    const cond = v.cond.replace('?', String(val));
    const t = q(db, `SELECT ${v.show.map(br).join(', ')}, CASE WHEN ${cond} THEN 1 ELSE 0 END FROM ${v.table}`);
    const cols = t.columns.slice(0, -1), rows = t.rows.map((r) => r.slice(0, -1)), ok = t.rows.map((r) => r[r.length - 1] === 1);
    return [
      { cap: `Първо се изпълнява <b>вътрешната</b> заявка <code>${esc(v.inner)}</code>. Тя връща една стойност:`, html: `<span class="bigval">${fmt(val)}</span>` },
      { cap: `Стойността се „слага“ на мястото на скобите: условието става <code>${esc(cond)}</code> и се проверява за всеки ред на <b>${esc(v.table)}</b>.`, html: table(cols, rows, { rowClass: (i) => (ok[i] ? 'v-ok' : 'v-no') }) },
      { cap: 'Резултатът на външната заявка.', html: table(cols, rows.filter((_, i) => ok[i])) },
    ];
  },
  update(v, db) {
    const sel = v.show.map(br).join(', ');
    const before = q(db, `SELECT ${sel}, CASE WHEN ${v.where} THEN 1 ELSE 0 END FROM ${v.table} ORDER BY rowid`);
    const cols = before.columns.slice(0, -1), rows = before.rows.map((r) => r.slice(0, -1)), hit = before.rows.map((r) => r[r.length - 1] === 1);
    db.exec(`UPDATE ${v.table} SET ${Object.entries(v.set).map(([k, x]) => `${br(k)} = ${x}`).join(', ')} WHERE ${v.where}`);
    const after = q(db, `SELECT ${sel} FROM ${v.table} ORDER BY rowid`);
    const setCols = Object.keys(v.set).map((k) => cols.indexOf(k));
    return [
      { cap: `Таблицата <b>${esc(v.table)}</b> преди промяната.`, html: table(cols, rows) },
      { cap: `<code>WHERE ${esc(v.where)}</code> избира кои редове да се променят.`, html: table(cols, rows, { rowClass: (i) => (hit[i] ? 'v-ok' : '') }) },
      { cap: `<code>SET ${Object.entries(v.set).map(([k, x]) => `${esc(k)} = ${esc(x)}`).join(', ')}</code> променя само тези редове. Останалите не се пипат.`, html: table(after.columns, after.rows, { cellClass: (i, j) => (hit[i] && setCols.includes(j) ? 'v-chg' : '') }) },
    ];
  },
};

export async function mountViz(host, v) {
  const card = document.createElement('section');
  card.className = 'card viz';
  card.innerHTML = `<div class="viz-head"><h3>${esc(v.title)}</h3></div><div class="viz-body">${v.sql ? `<div class="viz-sql">${esc(v.sql)}</div>` : ''}<p class="viz-cap" aria-live="polite"></p><div class="viz-stage"></div>
    <div class="viz-ctrl"><button class="btn small prev">◀ Назад</button><button class="btn small accent next">Следваща стъпка ▶</button><button class="btn small ghost again">Отначало</button><span class="viz-dots"></span></div></div>`;
  host.appendChild(card);
  let steps;
  const db = await freshDb(v.db);
  try { steps = BUILD[v.type](v, db); } catch (e) { card.querySelector('.viz-body').innerHTML = `<div class="msg bad">${esc(e.message)}</div>`; return; } finally { db.close(); }
  let i = 0;
  const cap = card.querySelector('.viz-cap'), stage = card.querySelector('.viz-stage'), dots = card.querySelector('.viz-dots');
  const prev = card.querySelector('.prev'), next = card.querySelector('.next');
  const show = () => {
    cap.innerHTML = `<b>Стъпка ${i + 1} от ${steps.length}.</b> ${steps[i].cap}`;
    stage.innerHTML = steps[i].html;
    dots.innerHTML = steps.map((_, k) => `<i class="${k <= i ? 'on' : ''}"></i>`).join('');
    prev.disabled = i === 0;
    next.disabled = i === steps.length - 1;
  };
  prev.addEventListener('click', () => { if (i > 0) { i--; show(); } });
  next.addEventListener('click', () => { if (i < steps.length - 1) { i++; show(); } });
  card.querySelector('.again').addEventListener('click', () => { i = 0; show(); });
  show();
}
