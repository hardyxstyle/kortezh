// Кортеж — страницата на ученика.
import { $, $$, esc, api, toast, store, resultTable, runLocal, renderRun, makeEditor, syncParams, readParams, schemaHtml, brand } from '/common.js';

const K = window.KORTEZH;
let ME = null, PROG = {}, CLOSED = [], SHOW_EXP = true, LB = true;
const view = $('#view');
$('#brand').innerHTML = brand;

const lessonById = (id) => K.lessons.find((l) => l.id === id);
const isClosed = (L) => CLOSED.includes(L.id);
function counts(L) {
  const main = L.tasks.filter((t) => !t.bonus), bonus = L.tasks.filter((t) => t.bonus);
  const ok = (t) => PROG[t.id]?.s;
  return { main: main.length, solved: main.filter(ok).length, bonus: bonus.length, bonusSolved: bonus.filter(ok).length };
}
function cellsHtml(L) {
  return '<span class="cells" aria-hidden="true">' + L.tasks.map((t) => {
    const p = PROG[t.id];
    return `<i class="${p?.s ? 'ok' : p?.t ? 'bad' : ''} ${t.bonus ? 'bonus' : ''}" title="${esc(t.title)}"></i>`;
  }).join('') + '</span>';
}

// ---------------------------------------------------------------
async function boot() {
  try {
    const d = await api('me');
    ME = d.user; CLOSED = d.closed; SHOW_EXP = d.showExpected; LB = d.leaderboard;
    PROG = d.progress;
  } catch (e) {
    if (e.status === 401) return location.replace('/');
    view.innerHTML = `<div class="msg bad">${esc(e.message)}</div>`;
    return;
  }
  $('#who').textContent = `${ME.name}${ME.class ? ', ' + ME.class : ''}`;
  if (ME.role === 'teacher') $('#tlink').classList.remove('hidden');
  renderSide();
  route();
}

function renderSide() {
  $('#lessons').innerHTML = K.lessons.map((L) => {
    const c = counts(L);
    const locked = isClosed(L);
    const done = c.solved === c.main && c.main > 0;
    return `<li><a href="#/l/${L.id}" data-l="${L.id}" class="${locked ? 'locked' : ''}" ${locked ? 'aria-disabled="true"' : ''}>
      <span class="n">${L.num}</span><span>${esc(L.title)}</span>
      <span class="c ${done ? 'done' : ''}">${locked ? 'заключен' : `${c.solved}/${c.main}`}</span></a></li>`;
  }).join('');
}

function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const [a, b] = h.split('/');
  $('#side').classList.remove('open');
  $('#menu').setAttribute('aria-expanded', 'false');
  $$('[data-nav]').forEach((x) => x.classList.toggle('active', x.dataset.nav === (a || 'home')));
  $$('#lessons a').forEach((x) => x.classList.toggle('active', a === 'l' && x.dataset.l === b));
  window.scrollTo(0, 0);
  if (a === 'l' && lessonById(b)) return showLesson(lessonById(b));
  if (a === 'sandbox') return showSandbox();
  if (a === 'account') return showAccount();
  return showHome();
}
window.addEventListener('hashchange', route);
$('#menu').addEventListener('click', () => {
  const s = $('#side'); s.classList.toggle('open');
  $('#menu').setAttribute('aria-expanded', s.classList.contains('open'));
});
$('#logout').addEventListener('click', async () => { try { await api('logout', {}); } finally { location.replace('/'); } });

// ---------------------------------------------------------------
function teacherBanner() {
  return ME.role === 'teacher' ? '<div class="msg info">Преглеждаш като учител. Проверките работят, но не се записват.</div>' : '';
}

async function showHome() {
  const all = K.lessons.filter((L) => !isClosed(L));
  let totalMain = 0, totalSolved = 0;
  all.forEach((L) => { const c = counts(L); totalMain += c.main; totalSolved += c.solved; });
  const next = all.find((L) => { const c = counts(L); return c.solved < c.main; });
  view.innerHTML = `<div class="overview"><div>
    ${teacherBanner()}
    <div class="lesson-head"><p class="sub">${esc(ME.class || '')}</p><h1>Здравей, ${esc(ME.name.split(' ')[0])}</h1>
    <div class="progressline">Решени основни задачи: <b>${totalSolved} от ${totalMain}</b></div>
    ${next ? `<div class="jump"><a class="btn primary" href="#/l/${next.id}">Продължи с урок ${next.num}: ${esc(next.title)}</a></div>` : totalMain ? '<div class="msg ok" style="margin-top:1rem">Всички отворени уроци са решени. Опитай бонус задачите (със звездичка).</div>' : ''}
    </div>
    <table class="lessons-table"><thead><tr><th></th><th>Урок</th><th>Напредък</th><th style="text-align:right">Решени</th></tr></thead><tbody>
    ${K.lessons.map((L) => {
      const c = counts(L);
      if (isClosed(L)) return `<tr><td class="n">${L.num}</td><td style="color:var(--ink-3)">${esc(L.title)}</td><td colspan="2" style="color:var(--ink-3)">урокът още не е отворен</td></tr>`;
      return `<tr class="row-link" data-href="#/l/${L.id}"><td class="n">${L.num}</td><td><a href="#/l/${L.id}" style="text-decoration:none">${esc(L.title)}</a><div style="font-size:.82rem;color:var(--ink-3)">урок ${L.book} в учебника${PROG['read:' + L.id] ? ', теорията е прочетена' : ''}</div></td><td>${cellsHtml(L)}</td><td class="c">${c.solved}/${c.main}${c.bonusSolved ? ` <span class="star">+${c.bonusSolved}★</span>` : ''}</td></tr>`;
    }).join('')}
    </tbody></table></div>
    <aside id="lb"></aside></div>`;
  $$('tr.row-link').forEach((tr) => tr.addEventListener('click', (e) => { if (e.target.tagName !== 'A') location.hash = tr.dataset.href; }));
  if (LB && ME.class) {
    try {
      const d = await api('leaderboard');
      if (!d.hidden && d.rows.length) $('#lb').innerHTML = `<div class="board"><h3>Класиране, ${esc(ME.class)}</h3><ol>${d.rows.map((r) => `<li class="${r.me ? 'me' : ''}"><span>${esc(r.name)}</span><span>${r.solved}</span></li>`).join('')}</ol></div>`;
    } catch { /* няма класиране */ }
  }
}

// ---------------------------------------------------------------
function showLesson(L) {
  if (isClosed(L)) {
    view.innerHTML = `<div class="col"><div class="msg info">Урок ${L.num} още не е отворен. Учителката ще го отключи, когато стигнете до него.</div></div>`;
    return;
  }
  const c = counts(L);
  view.innerHTML = `<div class="col">
    ${teacherBanner()}
    <div class="lesson-head"><p class="sub">Урок ${L.num}, в учебника — урок ${L.book}</p><h1>${esc(L.title)}</h1>
      <div class="progressline" id="pl"></div>
      <div class="jump"><a class="btn small" href="#theory" data-jump="theory">Теория</a><a class="btn small" href="#tasks" data-jump="tasks">Задачи (${L.tasks.length})</a></div>
    </div>
    <section class="theory" id="theory">${L.theory}
      <div class="read-row" id="readrow"></div>
    </section>
    <h2 class="section" id="tasks">Задачи <small>${c.main} основни${c.bonus ? `, ${c.bonus} бонус със звездичка` : ''}</small></h2>
    <div id="tasklist"></div>
    ${nextLink(L)}
  </div>`;
  $$('[data-jump]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); $('#' + a.dataset.jump).scrollIntoView({ behavior: 'smooth' }); }));
  updateProgressLine(L);
  renderReadRow(L);
  // примерите в теорията
  $$('pre.ex', view).forEach((pre) => mountExample(pre));
  const list = $('#tasklist');
  L.tasks.forEach((t) => list.appendChild(t.kind === 'choice' ? choiceTask(t, L) : sqlTask(t, L)));
}
function nextLink(L) {
  const i = K.lessons.indexOf(L);
  const n = K.lessons[i + 1];
  return n && !isClosed(n) ? `<div style="margin-top:2rem"><a class="btn" href="#/l/${n.id}">Следващ урок: ${esc(n.title)}</a></div>` : '';
}
function updateProgressLine(L) {
  const c = counts(L);
  const el = $('#pl');
  if (el) el.innerHTML = `${cellsHtml(L)} <span>${c.solved} от ${c.main} решени${c.bonus ? `, бонус ${c.bonusSolved} от ${c.bonus}` : ''}</span>`;
  renderSide();
  $$('#lessons a').forEach((x) => x.classList.toggle('active', x.dataset.l === L.id));
}
function renderReadRow(L) {
  const row = $('#readrow');
  if (PROG['read:' + L.id]) { row.innerHTML = '<span style="color:var(--ok);font-weight:600">✓ Теорията е прочетена</span> <button class="btn small" id="totasks">Към задачите</button>'; $('#totasks').addEventListener('click', () => $('#tasks').scrollIntoView({ behavior: 'smooth' })); return; }
  row.innerHTML = '<button class="btn" id="readbtn">Прочетох теорията</button><span class="hint">Учителят вижда кой е прочел урока.</span>';
  $('#readbtn').addEventListener('click', async () => {
    try { await api('read', { lessonId: L.id }); PROG['read:' + L.id] = { s: 1 }; renderReadRow(L); $('#tasks').scrollIntoView({ behavior: 'smooth' }); }
    catch (e) { toast(e.message); }
  });
}

function mountExample(pre) {
  const db = pre.dataset.db;
  const sql = pre.textContent;
  const box = document.createElement('div');
  box.className = 'example';
  box.innerHTML = `<div class="ed"></div><div class="params hidden"></div><div class="bar"><button class="btn small primary run">▶ Изпълни</button><button class="btn small ghost reset">Върни примера</button><span class="hint">Можеш да променяш заявката.</span></div><div class="out"></div>`;
  pre.replaceWith(box);
  const params = $('.params', box);
  const run = async () => {
    const r = await runLocal(db, cm.getValue(), readParams(params), autoAfter(cm.getValue()));
    $('.out', box).innerHTML = renderRun(r);
  };
  const defs = { ':номер': 5, ':начало': /LIKE/i.test(sql) ? 'Х' : 3, ':край': 7, ':клас': '12а' };
  const cm = makeEditor($('.ed', box), sql, run, (v) => syncParams(params, v, defs));
  syncParams(params, sql, defs);
  $('.run', box).addEventListener('click', run);
  $('.reset', box).addEventListener('click', () => { cm.setValue(sql); $('.out', box).innerHTML = ''; });
}
// за свободни заявки: ако няма SELECT накрая, нищо допълнително
const autoAfter = () => null;

// ---------------------------------------------------------------
function stateText(t) {
  const p = PROG[t.id];
  if (p?.s) return `<span class="state ok">✓ решена${p.t > 1 ? `, ${p.t} опита` : ''}</span>`;
  if (p?.t) return `<span class="state">${p.t} ${p.t === 1 ? 'опит' : 'опита'}</span>`;
  return '<span class="state">нерешена</span>';
}
function taskShell(t) {
  const p = PROG[t.id];
  const el = document.createElement('article');
  el.className = 'task' + (p?.s ? ' solved' : p?.t ? ' tried' : '');
  el.id = 't-' + t.id;
  el.innerHTML = `<div class="task-head"><span class="id">${t.id}</span><h3>${esc(t.title)}</h3>${t.bonus ? '<span class="star">★ бонус</span>' : ''}<span class="sh">${stateText(t)}</span></div><div class="text">${t.text}</div>`;
  return el;
}
function refreshTask(el, t, L) {
  const p = PROG[t.id];
  el.className = 'task' + (p?.s ? ' solved' : p?.t ? ' tried' : '');
  $('.sh', el).innerHTML = stateText(t);
  updateProgressLine(L);
}
function recordLocal(t, ok, answer) {
  if (ME.role === 'teacher') return;
  const p = PROG[t.id] || { s: 0, t: 0 };
  p.t = (p.t || 0) + 1; p.a = answer;
  if (ok) { p.s = 1; p.sa = answer; }
  PROG[t.id] = p;
}

function sqlTask(t, L) {
  const el = taskShell(t);
  const p = PROG[t.id];
  const dbTitle = K.dbs[t.db].title;
  const tools = [`<button class="btn small ghost" data-tg="schema">Структура на базата (${esc(dbTitle)})</button>`];
  if (t.expected && SHOW_EXP) tools.push('<button class="btn small ghost" data-tg="expected">Очакван резултат</button>');
  if (p?.sa && p.sa !== p.a) tools.push('<button class="btn small ghost" data-tg="solvedans">Вярното ми решение</button>');
  const paramNote = t.paramExample ? `<p class="rt-meta" style="margin:0 0 .4rem">Пример при ${Object.entries(t.paramExample).map(([k, v]) => `<code>${esc(k)} = ${esc(typeof v === 'string' ? `'${v}'` : v)}</code>`).join(', ')}:</p>` : '';
  el.insertAdjacentHTML('beforeend', `
    <div class="tools">${tools.join('')}</div>
    <div class="panel hidden" data-p="schema">${schemaHtml(t.db)}</div>
    ${t.expected ? `<div class="panel hidden" data-p="expected">${paramNote}${resultTable(t.expected)}</div>` : ''}
    ${p?.sa ? `<div class="panel hidden" data-p="solvedans"><h4>Последното ти вярно решение</h4><pre class="code-small">${esc(p.sa)}</pre></div>` : ''}
    <div class="ed"></div>
    <div class="params hidden"></div>
    <div class="actions">
      <button class="btn run">▶ Изпълни <span class="kbd">Ctrl+Enter</span></button>
      <button class="btn primary check">✓ Провери</button>
      <span class="spacer"></span>
      <button class="btn small ghost clear">Изчисти</button>
    </div>
    <div class="out" aria-live="polite"></div>`);
  $$('[data-tg]', el).forEach((b) => b.addEventListener('click', () => {
    const panel = $(`[data-p="${b.dataset.tg}"]`, el);
    panel.classList.toggle('hidden');
    b.classList.toggle('on', !panel.classList.contains('hidden'));
  }));
  const params = $('.params', el);
  const out = $('.out', el);
  const draftKey = 'd:' + t.id;
  const initial = store.get(draftKey) ?? p?.a ?? '';
  const run = async () => {
    const sql = cm.getValue();
    const r = await runLocal(t.db, sql, readParams(params), t.checkSql || null);
    out.innerHTML = renderRun(r);
    return r;
  };
  const cm = makeEditor($('.ed', el), initial, run, (v) => { store.set(draftKey, v); syncParams(params, v, t.paramExample || {}); });
  syncParams(params, initial, t.paramExample || {});
  $('.run', el).addEventListener('click', run);
  $('.clear', el).addEventListener('click', () => { cm.setValue(''); out.innerHTML = ''; cm.focus(); });
  const btn = $('.check', el);
  btn.addEventListener('click', async () => {
    const sql = cm.getValue();
    if (!sql.trim()) { out.innerHTML = '<div class="msg bad">Напиши заявка.</div>'; return; }
    btn.disabled = true;
    try {
      const r = await runLocal(t.db, sql, readParams(params), t.checkSql || null);
      const v = await api('check', { taskId: t.id, answer: sql });
      recordLocal(t, v.ok, sql);
      out.innerHTML = `<div class="msg ${v.ok ? 'ok' : 'bad'}">${v.ok ? '✓ ' : ''}${esc(v.message)}</div>` + (r.error ? '' : renderRun(r));
      refreshTask(el, t, L);
    } catch (e) {
      out.innerHTML = `<div class="msg bad">${esc(e.message)}</div>`;
    } finally { btn.disabled = false; }
  });
  return el;
}

function choiceTask(t, L) {
  const el = taskShell(t);
  const p = PROG[t.id];
  const name = 'c-' + t.id;
  el.insertAdjacentHTML('beforeend', `<div class="choices" role="radiogroup">${t.options.map((o, i) => `<label><input type="radio" name="${name}" value="${i}" ${p?.a === String(i) ? 'checked' : ''}><span>${o}</span></label>`).join('')}</div>
    <div class="actions"><button class="btn primary check">✓ Провери</button></div><div class="out" aria-live="polite"></div>`);
  const mark = () => $$('label', el).forEach((l) => l.classList.toggle('picked', $('input', l).checked));
  mark();
  $$('input', el).forEach((i) => i.addEventListener('change', mark));
  const btn = $('.check', el), out = $('.out', el);
  btn.addEventListener('click', async () => {
    const sel = $(`input[name="${name}"]:checked`, el);
    if (!sel) { out.innerHTML = '<div class="msg bad">Избери отговор.</div>'; return; }
    btn.disabled = true;
    try {
      const v = await api('check', { taskId: t.id, answer: Number(sel.value) });
      recordLocal(t, v.ok, sel.value);
      out.innerHTML = `<div class="msg ${v.ok ? 'ok' : 'bad'}">${v.ok ? '✓ ' : ''}${esc(v.message)}${v.explain ? ' ' + esc(v.explain) : ''}</div>`;
      refreshTask(el, t, L);
    } catch (e) { out.innerHTML = `<div class="msg bad">${esc(e.message)}</div>`; } finally { btn.disabled = false; }
  });
  return el;
}

// ---------------------------------------------------------------
function showSandbox() {
  const dbs = Object.entries(K.dbs);
  const cur = store.get('sb:db') || dbs[0][0];
  view.innerHTML = `<div class="col">
    <div class="lesson-head"><p class="sub">Тук нищо не се проверява и не се записва</p><h1>Пясъчник</h1></div>
    <div class="row-flex" style="margin-bottom:.8rem"><label class="field" style="margin:0">База от данни
      <select id="sbdb">${dbs.map(([k, d]) => `<option value="${esc(k)}" ${k === cur ? 'selected' : ''}>${esc(d.title)}</option>`).join('')}</select></label></div>
    <p id="sbdesc" style="color:var(--ink-2)"></p>
    <div class="panel" id="sbschema"></div>
    <div class="ed"></div><div class="params hidden"></div>
    <div class="actions" style="margin-top:.6rem"><button class="btn primary run">▶ Изпълни <span class="kbd">Ctrl+Enter</span></button></div>
    <div class="out" aria-live="polite"></div>
    <p class="hint" style="margin-top:1rem">Всяко изпълнение започва от чиста база. Можеш да пишеш няколко заявки една след друга, разделени с <code>;</code>.</p>
  </div>`;
  const sel = $('#sbdb');
  const show = () => { $('#sbschema').innerHTML = schemaHtml(sel.value); $('#sbdesc').textContent = K.dbs[sel.value].description; store.set('sb:db', sel.value); };
  show();
  sel.addEventListener('change', show);
  const params = $('.params', view);
  const run = async () => { $('.out', view).innerHTML = renderRun(await runLocal(sel.value, cm.getValue(), readParams(params), null)); };
  const cm = makeEditor($('.ed', view), store.get('sb:sql') || 'SELECT * FROM Ученик;', run, (v) => { store.set('sb:sql', v); syncParams(params, v); });
  syncParams(params, cm.getValue());
  $('.run', view).addEventListener('click', run);
}

function showAccount() {
  view.innerHTML = `<div class="col"><div class="lesson-head"><h1>Профил</h1></div>
    <div class="cards2"><div class="box"><h2>Данни</h2>
      <p>Име: <b>${esc(ME.name)}</b><br>Потребителско име: <b>${esc(ME.username)}</b><br>${ME.class ? `Клас: <b>${esc(ME.class)}</b>` : ''}</p>
      <p class="hint">Ако нещо е сгрешено, кажи на учителката — тя може да го поправи.</p></div>
    <div class="box"><h2>Смяна на паролата</h2><div id="pwmsg"></div>
      <form id="pw"><label class="field">Сегашна парола<input type="password" name="old" required autocomplete="current-password"></label>
      <label class="field">Нова парола<input type="password" name="new" required minlength="6" autocomplete="new-password"></label>
      <button class="btn primary">Смени паролата</button></form></div></div></div>`;
  $('#pw').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('password', Object.fromEntries(new FormData(e.target))); $('#pwmsg').innerHTML = '<div class="form-ok">Паролата е сменена.</div>'; e.target.reset(); }
    catch (ex) { $('#pwmsg').innerHTML = `<div class="form-error">${esc(ex.message)}</div>`; }
  });
}

boot();
