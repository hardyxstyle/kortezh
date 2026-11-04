// Общи функции за всички страници на Кортеж.
import { createDb, openDb, runSql, findParams } from './engine.js';

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export async function api(path, body) {
  const opt = body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
  let res;
  try { res = await fetch('/api/' + path, opt); } catch { throw new Error('Няма връзка със сървъра. Провери интернета.'); }
  let data = {};
  try { data = await res.json(); } catch { /* празно */ }
  if (!res.ok) {
    const e = new Error(data.error || `Грешка ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return data;
}

export function toast(text, ms = 2600) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

export const store = {
  get(k) { try { return localStorage.getItem('kz:' + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('kz:' + k, v); } catch { /* няма място */ } },
};

// UTC 'YYYY-MM-DD HH:MM:SS' → местно време
export function when(s) {
  if (!s) return '—';
  const d = new Date(s.replace(' ', 'T') + 'Z');
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString('bg-BG', { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return 'днес ' + time;
  return d.toLocaleDateString('bg-BG', { day: 'numeric', month: 'short' }) + ' ' + time;
}

// ---------- таблица-резултат ----------
export function resultTable(r, opts = {}) {
  if (!r) return '';
  const head = r.columns.map((c) => `<th>${esc(c)}</th>`).join('');
  const body = r.rows.map((row) => '<tr>' + row.map((v) => {
    if (v === null) return '<td class="null">NULL</td>';
    if (typeof v === 'number') return `<td class="num">${esc(Number.isInteger(v) ? v : Math.round(v * 10000) / 10000)}</td>`;
    return `<td>${esc(v)}</td>`;
  }).join('') + '</tr>').join('');
  const n = r.rows.length;
  const meta = opts.meta !== false ? `<p class="rt-meta">${n} ${n === 1 ? 'ред' : 'реда'}, ${r.columns.length} ${r.columns.length === 1 ? 'колона' : 'колони'}${opts.truncated ? ' (показани са първите ' + n + ')' : ''}</p>` : '';
  return `<div class="rt-wrap"><table class="rt"><thead><tr>${head}</tr></thead><tbody>${body || ''}</tbody></table></div>${meta}`;
}

// ---------- SQL в браузъра ----------
let SQLp = null;
const snaps = {};
export function getSQL() {
  if (!SQLp) SQLp = window.initSqlJs({ locateFile: (f) => '/vendor/' + f });
  return SQLp;
}
export async function freshDb(dbName) {
  const SQL = await getSQL();
  if (!snaps[dbName]) {
    const d = window.KORTEZH.dbs[dbName];
    const db = createDb(SQL, d.seed);
    snaps[dbName] = db.export();
    db.close();
  }
  return openDb(SQL, snaps[dbName]);
}

// Изпълнява заявката върху чиста база. checkSql — какво да се покаже след промените.
export async function runLocal(dbName, sql, params, checkSql) {
  const db = await freshDb(dbName);
  try {
    const r = runSql(db, sql, params);
    let after = null;
    if (!r.error && checkSql) after = runSql(db, checkSql, null).last;
    return { ...r, after };
  } finally {
    db.close();
  }
}

export function renderRun(r) {
  if (r.error) return `<div class="msg bad">${esc(r.error)}</div>`;
  let h = '';
  if (r.results.length > 1) h += `<p class="rt-meta">Изпълнени са ${r.statements} заявки. Показвам последния резултат.</p>`;
  if (r.last) h += resultTable(r.last, { truncated: r.truncated });
  if (!r.last && r.statements) h += `<div class="msg info">Изпълнено. ${r.changes ? 'Променени редове: ' + r.changes + '.' : 'Структурата на базата е променена или няма променени редове.'}</div>`;
  if (r.after) h += `<p class="rt-meta" style="margin-top:.8rem">Как изглежда таблицата след промените:</p>` + resultTable(r.after);
  return h;
}

// ---------- редактор ----------
export function makeEditor(host, value, onRun, onChange) {
  const cm = window.CodeMirror(host, {
    value: value || '',
    mode: 'text/x-sqlite',
    lineNumbers: true,
    lineWrapping: true,
    indentUnit: 2,
    tabSize: 2,
    viewportMargin: Infinity,
    placeholder: 'SELECT ...',
    extraKeys: { 'Ctrl-Enter': () => onRun && onRun(), 'Cmd-Enter': () => onRun && onRun(), Tab: (c) => c.replaceSelection('  ') },
  });
  if (onChange) cm.on('change', () => onChange(cm.getValue()));
  return cm;
}

// Полета за параметрите (:име) на заявката
export function syncParams(container, sql, defaults = {}) {
  const names = findParams(sql);
  const old = {};
  $$('input', container).forEach((i) => { old[i.dataset.name] = i.value; });
  if (!names.length) { container.innerHTML = ''; container.classList.add('hidden'); return; }
  container.classList.remove('hidden');
  container.innerHTML = names.map((n) => {
    const v = old[n] ?? (defaults[n] !== undefined ? defaults[n] : '');
    return `<label>${esc(n)} = <input data-name="${esc(n)}" value="${esc(v)}" aria-label="Стойност за ${esc(n)}"></label>`;
  }).join('');
}
export function readParams(container) {
  const p = {};
  $$('input', container).forEach((i) => {
    const v = i.value.trim();
    p[i.dataset.name] = v !== '' && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
  });
  return p;
}

export function schemaHtml(dbName) {
  const d = window.KORTEZH.dbs[dbName];
  return `<div class="schema">` + d.schema.map((t) => `<div class="tbl"><b>${esc(t.table)} <span>${t.rows} реда</span></b>` +
    t.columns.map((c) => `<div class="${c.pk ? 'pk' : ''}">${esc(c.name)}${c.pk ? '' : ` <em>${esc((c.type || '').toLowerCase())}</em>`}</div>`).join('') + `</div>`).join('') + `</div>`;
}

export const brand = `<span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i class="on"></i><i class="on"></i><i class="on"></i><i></i><i></i><i></i></span>Кортеж`;
