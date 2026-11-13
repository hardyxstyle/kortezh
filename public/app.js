// Кортеж — страницата на ученика.
import { $, $$, esc, api, toast, store, resultTable, runLocal, renderRun, makeEditor, syncParams, readParams, schemaHtml, brand, initTheme, lessonColor, computeBadges, medal } from '/common.js';
import { mountViz } from '/viz.js';

const K = window.KORTEZH;
let ME = null, PROG = {}, CLOSED = [], SHOW_EXP = true, LB = true;
const view = $('#view');
$('#brand').innerHTML = brand;
initTheme($('#theme'));

const STEPS = [
  { id: 'teoria', name: 'Теория' },
  { id: 'primeri', name: 'Примери' },
  { id: 'test', name: 'Тест' },
  { id: 'zadachi', name: 'Задачи' },
  { id: 'tetradka', name: 'За тетрадката' },
];
const lessonById = (id) => K.lessons.find((l) => l.id === id);
const isClosed = (L) => CLOSED.includes(L.id);
const quiz = (L) => L.tasks.filter((t) => t.kind === 'choice');
const sqlTasks = (L) => L.tasks.filter((t) => t.kind === 'sql');
const ok = (t) => !!PROG[t.id]?.s;
function counts(L) {
  const main = L.tasks.filter((t) => !t.bonus), bonus = L.tasks.filter((t) => t.bonus);
  return { main: main.length, solved: main.filter(ok).length, bonus: bonus.length, bonusSolved: bonus.filter(ok).length, quiz: quiz(L).length, quizOk: quiz(L).filter(ok).length, sql: sqlTasks(L).length, sqlOk: sqlTasks(L).filter(ok).length };
}
let badgesBefore = null;
function checkNewBadges() {
  const now = computeBadges(PROG, K.lessons).filter((b) => b.got).map((b) => b.id);
  if (badgesBefore) {
    const fresh = computeBadges(PROG, K.lessons).filter((b) => b.got && !badgesBefore.includes(b.id));
    fresh.forEach((b, i) => setTimeout(() => toast(`Нова значка: ${b.name}`, 3500, 'badge'), 600 + i * 1200));
  }
  badgesBefore = now;
}

// ---------------------------------------------------------------
async function boot() {
  try {
    const d = await api('me');
    ME = d.user; CLOSED = d.closed; SHOW_EXP = d.showExpected; LB = d.leaderboard; PROG = d.progress;
  } catch (e) {
    if (e.status === 401) return location.replace('/');
    view.innerHTML = `<div class="msg bad">${esc(e.message)}</div>`;
    return;
  }
  $('#who').textContent = `${ME.name}${ME.class ? ', ' + ME.class : ''}`;
  if (ME.role === 'teacher') $('#tlink').classList.remove('hidden');
  checkNewBadges();
  route();
}

function route() {
  if (!ME) return;
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const [a, b, c, d] = parts;
  $$('[data-nav]').forEach((x) => x.classList.toggle('active', x.dataset.nav === (a || 'home') || (a === 'l' && x.dataset.nav === 'home')));
  if (a === 'l' && lessonById(b)) return showLesson(lessonById(b), c || 'teoria', d);
  window.scrollTo(0, 0);
  if (a === 'sandbox') return showSandbox();
  if (a === 'rechnik') return showGlossary();
  if (a === 'znachki') return showBadges();
  if (a === 'account') return showAccount();
  return showHome();
}
window.addEventListener('hashchange', route);
$('#logout').addEventListener('click', async () => { try { await api('logout', {}); } finally { location.replace('/'); } });

const teacherBanner = () => (ME.role === 'teacher' ? '<div class="msg info">Преглеждаш като учител. Проверките работят, но не се записват.</div>' : '');

// ---------------------------------------------------------------
async function showHome() {
  const open = K.lessons.filter((L) => !isClosed(L));
  let tm = 0, ts = 0, tb = 0;
  open.forEach((L) => { const c = counts(L); tm += c.main; ts += c.solved; tb += c.bonusSolved; });
  const next = open.find((L) => { const c = counts(L); return c.solved < c.main; });
  const badges = computeBadges(PROG, K.lessons);
  const got = badges.filter((b) => b.got);
  const pct = tm ? Math.round((ts / tm) * 100) : 0;
  view.innerHTML = `${teacherBanner()}
  <section class="hello">
    <div class="card hello-main">
      <div class="hint">${esc(ME.class || '')}</div>
      <h1>Здравей, ${esc(ME.name.split(' ')[0])}</h1>
      <div class="row-flex" style="justify-content:space-between"><span>Решени основни задачи</span><b class="mono">${ts} / ${tm}</b></div>
      <div class="bigbar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>
      <div class="stats"><div><b>${pct}%</b>от отворените уроци</div><div><b>${tb}</b>бонус задачи</div><div><b>${got.length}</b>значки</div></div>
    </div>
    ${next ? `<a class="card next-card" href="#/l/${next.id}/${firstStep(next)}" style="--accent:${lessonColor(next.id)};text-decoration:none">
      <span class="lbl">Продължи оттук</span><h2>Урок ${next.num}. ${esc(next.title)}</h2>
      <span class="hint">${stepLabel(next)}</span><span><span class="btn accent">Продължи</span></span></a>`
      : `<div class="card next-card"><h2>Всички отворени уроци са решени</h2><span class="hint">Опитай бонус задачите (със звездичка) или Пясъчника.</span></div>`}
  </section>
  <h2 class="section-title">Уроци</h2>
  <div class="path">${K.lessons.map(lessonRow).join('')}</div>
  <div class="side-boxes">
    <section class="card"><h3 class="box-h">Последни значки</h3><div class="pad">${got.length ? `<div class="badge-row">${got.slice(-8).map((b) => `<span title="${esc(b.name)}">${medal(b)}</span>`).join('')}</div>` : '<p class="hint" style="margin:0">Реши първата си задача, за да получиш значка.</p>'}<p style="margin:.8rem 0 0"><a href="#/znachki">Всички значки</a></p></div></section>
    <section class="card board" id="lb"></section>
  </div>`;
  if (LB && ME.class) {
    try {
      const d = await api('leaderboard');
      if (!d.hidden && d.rows.length) $('#lb').innerHTML = `<h3 class="box-h">Класиране, ${esc(ME.class)}</h3><ol>${d.rows.map((r) => `<li class="${r.me ? 'me' : ''}"><span>${esc(r.name)}</span><span>${r.solved}</span></li>`).join('')}</ol>`;
      else $('#lb').remove();
    } catch { $('#lb').remove(); }
  } else $('#lb').remove();
}
function firstStep(L) {
  if (!PROG['read:' + L.id]) return 'teoria';
  const c = counts(L);
  if (c.quizOk < c.quiz) return 'test';
  return 'zadachi';
}
function stepLabel(L) {
  const c = counts(L);
  if (!PROG['read:' + L.id]) return 'Започни с теорията';
  return `Решени ${c.solved} от ${c.main} задачи`;
}
function lessonRow(L) {
  const c = counts(L);
  const locked = isClosed(L);
  const done = c.main && c.solved === c.main;
  const pct = c.main ? Math.round((c.solved / c.main) * 100) : 0;
  return `<a class="card lrow ${locked ? 'locked' : ''} ${done ? 'done' : ''}" href="#/l/${L.id}/${firstStep(L)}" style="--accent:${lessonColor(L.id)}" ${locked ? 'aria-disabled="true" tabindex="-1"' : ''}>
    <span class="lnum">${done ? '✓' : L.num}</span>
    <span><h3>${esc(L.title)}</h3>
      <span class="meta">${L.book ? `Учебник, урок ${L.book}` : 'Допълнение по учебната програма'}${locked ? ', заключен' : ''}</span>
      ${locked ? '' : `<div class="minibar"><i style="width:${pct}%"></i></div>
      <span class="lsteps"><span class="${PROG['read:' + L.id] ? 'y' : ''}">${PROG['read:' + L.id] ? '✓ ' : ''}теория</span>${c.quiz ? `<span class="${c.quizOk === c.quiz ? 'y' : ''}">тест ${c.quizOk}/${c.quiz}</span>` : ''}<span class="${c.sqlOk === c.sql ? 'y' : ''}">задачи ${c.sqlOk}/${c.sql}</span>${c.bonusSolved ? `<span class="star">+${c.bonusSolved}★</span>` : ''}</span>`}
    </span></a>`;
}

// ---------------------------------------------------------------
function showLesson(L, stepId, sub) {
  if (isClosed(L)) {
    view.innerHTML = `<div class="col"><div class="msg info">Урок ${L.num} още не е отворен. Учителката ще го отключи, когато стигнете до него.</div><a class="btn" href="#/">Към уроците</a></div>`;
    return;
  }
  const step = STEPS.find((s) => s.id === stepId) || STEPS[0];
  const sameLesson = view.dataset.lesson === L.id && view.dataset.step === step.id;
  view.dataset.lesson = L.id; view.dataset.step = step.id;
  if (!sameLesson) window.scrollTo(0, 0);
  view.style.setProperty('--accent', lessonColor(L.id));
  view.innerHTML = `<div class="col">${teacherBanner()}
    <article class="card">
      <header class="lhead">
        <p class="sub"><a href="#/">Уроци</a> / Урок ${L.num}${L.book ? `, в учебника — урок ${L.book}` : ''}</p>
        <h1>${esc(L.title)}</h1>
        ${L.prog ? `<p class="prog">Учебна програма: <b>${esc(L.prog)}</b></p>` : ''}
        <nav class="stepper" aria-label="Стъпки на урока"></nav>
      </header>
      <div class="lbody" id="lbody"></div>
    </article></div>`;
  refreshStepper(L, step.id);
  const body = $('#lbody');
  ({ teoria: stepTheory, primeri: stepExamples, test: stepQuiz, zadachi: stepTasks, tetradka: stepNotebook })[step.id](L, body, sub);
}
function refreshStepper(L, cur) {
  const nav = $('.stepper');
  if (!nav) return;
  cur = cur || view.dataset.step;
  const c = counts(L);
  const stepState = {
    teoria: { done: !!PROG['read:' + L.id] },
    primeri: { done: !!PROG['read:' + L.id] && true, cnt: L.viz.length ? `${L.viz.length}` : '' },
    test: { done: c.quiz > 0 && c.quizOk === c.quiz, cnt: c.quiz ? `${c.quizOk}/${c.quiz}` : '—' },
    zadachi: { done: c.sql > 0 && sqlTasks(L).filter((t) => !t.bonus).every(ok), cnt: `${c.sqlOk}/${c.sql}` },
    tetradka: { done: false },
  };
  stepState.primeri.done = false;
  nav.innerHTML = STEPS.map((s, i) => `<a href="#/l/${L.id}/${s.id}" class="${s.id === cur ? 'on' : ''} ${stepState[s.id].done ? 'done' : ''}" ${s.id === cur ? 'aria-current="step"' : ''}><span class="dot">${stepState[s.id].done ? '✓' : i + 1}</span><span class="lab">${s.name}</span>${stepState[s.id].cnt ? `<span class="cnt">${stepState[s.id].cnt}</span>` : ''}</a>`).join('');
}
const goStep = (L, id, sub) => { location.hash = `#/l/${L.id}/${id}${sub ? '/' + sub : ''}`; };
function stepNav(L, prevId, nextId, nextLabel, extra = '') {
  const p = STEPS.find((s) => s.id === prevId), n = STEPS.find((s) => s.id === nextId);
  return `<div class="steps-nav">${p ? `<a class="btn" href="#/l/${L.id}/${p.id}">◀ ${p.name}</a>` : '<span></span>'}${extra}${n ? `<a class="btn accent" href="#/l/${L.id}/${n.id}" id="nextstep">${nextLabel || n.name} ▶</a>` : ''}</div>`;
}

// --- 1. Теория
function stepTheory(L, body) {
  body.innerHTML = `<div class="theory">${L.theory}</div>
    <div class="steps-nav"><span class="hint">${PROG['read:' + L.id] ? '✓ Отбелязано като прочетено' : 'Когато прочетеш и пробваш примерите, продължи.'}</span><button class="btn accent" id="readnext">${PROG['read:' + L.id] ? 'Към примерите ▶' : 'Прочетох — към примерите ▶'}</button></div>`;
  $$('pre.ex', body).forEach(mountExample);
  $('#readnext').addEventListener('click', async () => {
    if (!PROG['read:' + L.id]) {
      try { await api('read', { lessonId: L.id }); PROG['read:' + L.id] = { s: 1 }; checkNewBadges(); refreshStepper(L); } catch (e) { toast(e.message); }
    }
    goStep(L, 'primeri');
  });
}
function mountExample(pre) {
  const db = pre.dataset.db, sql = pre.textContent;
  const box = document.createElement('div');
  box.className = 'example';
  box.innerHTML = `<div class="ed"></div><div class="params hidden"></div><div class="bar"><button class="btn small accent run">▶ Изпълни</button><button class="btn small ghost reset">Върни примера</button><span class="hint">Можеш да променяш заявката.</span></div><div class="out" aria-live="polite"></div>`;
  pre.replaceWith(box);
  const params = $('.params', box);
  const defs = { ':номер': 5, ':начало': /LIKE/i.test(sql) ? 'Х' : 3, ':край': 7, ':клас': '12а' };
  const run = async () => { $('.out', box).innerHTML = renderRun(await runLocal(db, cm.getValue(), readParams(params), null)); };
  const cm = makeEditor($('.ed', box), sql, run, (v) => syncParams(params, v, defs));
  syncParams(params, sql, defs);
  $('.run', box).addEventListener('click', run);
  $('.reset', box).addEventListener('click', () => { cm.setValue(sql); $('.out', box).innerHTML = ''; });
}

// --- 2. Примери (визуализации)
async function stepExamples(L, body) {
  body.innerHTML = `<p style="margin-top:0">${L.viz.length ? 'Натискай <b>Следваща стъпка</b>, за да видиш какво става с редовете при изпълнението на заявката.' : 'За този урок няма визуални примери — примерите са в теорията. Пробвай свободно в Пясъчника.'}</p><div id="vizs"></div>${stepNav(L, 'teoria', 'test', quiz(L).length ? 'Към теста' : 'Към задачите')}`;
  if (!quiz(L).length) $('#nextstep').href = `#/l/${L.id}/zadachi`;
  for (const v of L.viz) await mountViz($('#vizs'), v);
}

// --- задачи: обща навигация
function chipsNav(L, list, cur, step) {
  let html = '<nav class="chips-nav" aria-label="Задачи">';
  let sep = false;
  list.forEach((t, i) => {
    if (t.bonus && !sep) { html += '<span class="sep" aria-hidden="true"></span>'; sep = true; }
    const p = PROG[t.id];
    html += `<a href="#/l/${L.id}/${step}/${i + 1}" class="${p?.s ? 'ok' : p?.t ? 'bad' : ''} ${t.bonus ? 'bonus' : ''} ${i === cur ? 'cur' : ''}" title="${esc(t.title)}${t.bonus ? ' (бонус)' : ''}" ${i === cur ? 'aria-current="true"' : ''}>${i + 1}${t.bonus ? '★' : ''}</a>`;
  });
  return html + '</nav>';
}
function stateText(t) {
  const p = PROG[t.id];
  if (p?.s) return `<span class="state ok">✓ решена${p.t > 1 ? `, ${p.t} опита` : ''}</span>`;
  if (p?.t) return `<span class="state">${p.t} ${p.t === 1 ? 'опит' : 'опита'}</span>`;
  return '<span class="state">нерешена</span>';
}
function recordLocal(t, good, answer) {
  if (ME.role === 'teacher') return;
  const p = PROG[t.id] || { s: 0, t: 0, h: 0 };
  p.t = (p.t || 0) + 1; p.a = answer;
  if (good) { p.s = 1; p.sa = answer; }
  PROG[t.id] = p;
  checkNewBadges();
}

// --- 3. Тест
function stepQuiz(L, body, sub) {
  const list = quiz(L);
  if (!list.length) {
    body.innerHTML = `<p>В този урок няма тестови въпроси.</p>${stepNav(L, 'primeri', 'zadachi', 'Към задачите')}`;
    return;
  }
  const i = Math.min(Math.max((Number(sub) || firstUnsolved(list) + 1) - 1, 0), list.length - 1);
  const t = list[i];
  const p = PROG[t.id];
  const name = 'c-' + t.id;
  body.innerHTML = `${chipsNav(L, list, i, 'test')}
    <div class="task-top"><span class="no">Въпрос ${i + 1} от ${list.length}</span><h2>${esc(t.title)}</h2>${stateText(t)}</div>
    <div class="task-text">${t.text}</div>
    <div class="choices" role="radiogroup">${t.options.map((o, k) => `<label><input type="radio" name="${name}" value="${k}" ${p?.a === String(k) ? 'checked' : ''}><span>${o}</span></label>`).join('')}</div>
    <div class="actions"><button class="btn accent" id="check">✓ Провери</button></div>
    <div class="out" id="out" aria-live="polite"></div>
    <div class="task-nav">${i > 0 ? `<a class="btn" href="#/l/${L.id}/test/${i}">◀ Предишен</a>` : `<a class="btn" href="#/l/${L.id}/primeri">◀ Примери</a>`}${i < list.length - 1 ? `<a class="btn" href="#/l/${L.id}/test/${i + 2}" id="nx">Следващ ▶</a>` : `<a class="btn accent" href="#/l/${L.id}/zadachi">Към задачите ▶</a>`}</div>`;
  const mark = () => $$('.choices label', body).forEach((l) => l.classList.toggle('picked', $('input', l).checked));
  mark();
  $$('.choices input', body).forEach((x) => x.addEventListener('change', mark));
  $('#check').addEventListener('click', async () => {
    const sel = $(`input[name="${name}"]:checked`, body);
    if (!sel) { $('#out').innerHTML = '<div class="msg bad">Избери отговор.</div>'; return; }
    $('#check').disabled = true;
    try {
      const v = await api('check', { taskId: t.id, answer: Number(sel.value) });
      recordLocal(t, v.ok, sel.value);
      $('#out').innerHTML = `<div class="msg ${v.ok ? 'ok' : 'bad'}">${v.ok ? '✓ ' : ''}${esc(v.message)}${v.explain ? ' ' + esc(v.explain) : ''}</div>`;
      $('.task-top .state', body).outerHTML = stateText(t);
      $('.chips-nav', body).outerHTML = chipsNav(L, list, i, 'test');
      refreshStepper(L);
      if (v.ok && $('#nx')) $('#nx').classList.add('accent');
    } catch (e) { $('#out').innerHTML = `<div class="msg bad">${esc(e.message)}</div>`; } finally { $('#check').disabled = false; }
  });
}
const firstUnsolved = (list) => { const k = list.findIndex((t) => !PROG[t.id]?.s); return k < 0 ? 0 : k; };

// --- 4. Задачи (една по една)
function stepTasks(L, body, sub) {
  const list = sqlTasks(L);
  if (!list.length) { body.innerHTML = `<p>Няма задачи.</p>${stepNav(L, 'test', 'tetradka')}`; return; }
  const i = Math.min(Math.max((Number(sub) || firstUnsolved(list) + 1) - 1, 0), list.length - 1);
  const t = list[i];
  const p = PROG[t.id];
  const dbTitle = K.dbs[t.db].title;
  const paramNote = t.paramExample ? `<p class="rt-meta" style="margin:0 0 .4rem">Пример при ${Object.entries(t.paramExample).map(([k, v]) => `<code>${esc(k)} = ${esc(typeof v === 'string' ? `'${v}'` : v)}</code>`).join(', ')}:</p>` : '';
  body.innerHTML = `${chipsNav(L, list, i, 'zadachi')}
    <div class="task-top"><span class="no">Задача ${i + 1} от ${list.length}${t.bonus ? ', <span class="star">★ бонус</span>' : ''}</span><h2>${esc(t.title)}</h2>${stateText(t)}</div>
    <div class="task-text">${t.text}</div>
    <div class="tools">
      <button class="btn small line" data-tg="schema">Таблиците (${esc(dbTitle)})</button>
      ${t.expected && SHOW_EXP ? '<button class="btn small line" data-tg="expected">Очакван резултат</button>' : ''}
      <button class="btn small line" id="h1">${p?.h >= 1 ? 'Подсказка 1 ✓' : 'Подсказка 1'}</button>
      <button class="btn small line ${p?.h >= 1 ? '' : 'hidden'}" id="h2">${p?.h >= 2 ? 'Подсказка 2 ✓' : 'Подсказка 2'}</button>
      ${p?.sa && p.sa !== p.a ? '<button class="btn small line" data-tg="solvedans">Вярното ми решение</button>' : ''}
    </div>
    <div class="panel hidden" data-p="schema">${schemaHtml(t.db)}</div>
    ${t.expected ? `<div class="panel hidden" data-p="expected">${paramNote}${resultTable(t.expected)}</div>` : ''}
    <div class="panel hint-box hidden" id="hintbox"></div>
    ${p?.sa ? `<div class="panel hidden" data-p="solvedans"><h4>Последното ти вярно решение</h4><pre class="code-small">${esc(p.sa)}</pre></div>` : ''}
    <div class="ed"></div>
    <div class="params hidden"></div>
    <div class="actions">
      <button class="btn run">▶ Изпълни <span class="kbd">Ctrl+Enter</span></button>
      <button class="btn accent check">✓ Провери</button>
      <span class="spacer"></span>
      <button class="btn small ghost clear">Изчисти</button>
    </div>
    <div class="out" aria-live="polite"></div>
    <div class="task-nav">${i > 0 ? `<a class="btn" href="#/l/${L.id}/zadachi/${i}">◀ Предишна</a>` : `<a class="btn" href="#/l/${L.id}/test">◀ Тест</a>`}${i < list.length - 1 ? `<a class="btn ${p?.s ? 'accent' : ''}" href="#/l/${L.id}/zadachi/${i + 2}" id="nx">Следваща ▶</a>` : `<a class="btn accent" href="#/l/${L.id}/tetradka">За тетрадката ▶</a>`}</div>`;
  $$('[data-tg]', body).forEach((b) => b.addEventListener('click', () => {
    const panel = $(`[data-p="${b.dataset.tg}"]`, body);
    panel.classList.toggle('hidden');
    b.classList.toggle('on', !panel.classList.contains('hidden'));
  }));
  const hintbox = $('#hintbox');
  const showHint = async (level) => {
    try {
      const d = await api('hint', { taskId: t.id, level });
      hintbox.innerHTML = d.hints.map((h, k) => `<h4>Подсказка ${k + 1}</h4>${k === 1 ? `<p class="hint" style="margin:0">Скелет на едно възможно решение — на мястото на „…“ попълни сам(а):</p><pre>${esc(h)}</pre>` : `<p style="margin:0">${esc(h)}</p>`}`).join('');
      hintbox.classList.remove('hidden');
      if (ME.role !== 'teacher') { PROG[t.id] = { ...(PROG[t.id] || { s: 0, t: 0 }), h: Math.max(PROG[t.id]?.h || 0, level) }; }
      $('#h1').textContent = 'Подсказка 1 ✓';
      $('#h2').classList.remove('hidden');
      if (level >= 2) $('#h2').textContent = 'Подсказка 2 ✓';
    } catch (e) { toast(e.message); }
  };
  $('#h1').addEventListener('click', () => showHint(Math.max(1, PROG[t.id]?.h || 1) >= 2 ? 2 : 1));
  $('#h2').addEventListener('click', () => showHint(2));
  const params = $('.params', body), out = $('.out', body);
  const draftKey = 'd:' + t.id;
  const initial = store.get(draftKey) ?? p?.a ?? '';
  const run = async () => { const r = await runLocal(t.db, cm.getValue(), readParams(params), t.checkSql || null); out.innerHTML = renderRun(r); return r; };
  const cm = makeEditor($('.ed', body), initial, run, (v) => { store.set(draftKey, v); syncParams(params, v, t.paramExample || {}); });
  syncParams(params, initial, t.paramExample || {});
  setTimeout(() => cm.refresh(), 0);
  $('.run', body).addEventListener('click', run);
  $('.clear', body).addEventListener('click', () => { cm.setValue(''); out.innerHTML = ''; cm.focus(); });
  const btn = $('.check', body);
  btn.addEventListener('click', async () => {
    const sql = cm.getValue();
    if (!sql.trim()) { out.innerHTML = '<div class="msg bad">Напиши заявка.</div>'; return; }
    btn.disabled = true;
    try {
      const r = await runLocal(t.db, sql, readParams(params), t.checkSql || null);
      const v = await api('check', { taskId: t.id, answer: sql });
      recordLocal(t, v.ok, sql);
      out.innerHTML = `<div class="msg ${v.ok ? 'ok' : 'bad'}">${v.ok ? '✓ ' : ''}${esc(v.message)}</div>` + (r.error ? '' : renderRun(r));
      $('.task-top .state', body).outerHTML = stateText(t);
      $('.chips-nav', body).outerHTML = chipsNav(L, list, i, 'zadachi');
      refreshStepper(L);
      if (v.ok && $('#nx')) { $('#nx').classList.add('accent'); $('#nx').focus(); }
    } catch (e) {
      out.innerHTML = `<div class="msg bad">${esc(e.message)}</div>`;
    } finally { btn.disabled = false; }
  });
}

// --- 5. За тетрадката
function stepNotebook(L, body) {
  const terms = (K.glossary || []).filter((g) => g[2] === L.id);
  const lb = computeBadges(PROG, K.lessons).find((b) => b.lesson === L.id);
  const c = counts(L);
  const i = K.lessons.indexOf(L), nextL = K.lessons[i + 1];
  body.innerHTML = `<h2 style="margin-top:0">За тетрадката</h2>
    ${L.notebook.length ? `<div class="notebook"><ol>${L.notebook.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></div>` : '<p>Няма резюме за този урок.</p>'}
    ${terms.length ? `<h3>Понятия от урока</h3><dl class="terms">${terms.map((g) => `<dt>${esc(g[0])}</dt><dd>${esc(g[1])}</dd>`).join('')}</dl>` : ''}
    <h3>Твоят резултат</h3>
    <div class="row-flex">${lb ? `<span class="badge ${lb.got ? '' : 'off'}" style="padding:0">${medal(lb)}</span>` : ''}<div>Решени <b>${c.solved} от ${c.main}</b> основни задачи${c.bonus ? `, бонус <b>${c.bonusSolved} от ${c.bonus}</b>` : ''}.<br><span class="hint">${lb?.got ? 'Значката за урока е твоя!' : 'Реши всички основни задачи, за да вземеш значката на урока.'}</span></div></div>
    <div class="steps-nav"><a class="btn" href="#/l/${L.id}/zadachi">◀ Задачи</a><button class="btn" onclick="window.print()">Принтирай</button>${nextL && !isClosed(nextL) ? `<a class="btn accent" href="#/l/${nextL.id}/teoria">Урок ${nextL.num}: ${esc(nextL.title)} ▶</a>` : '<a class="btn accent" href="#/">Към уроците</a>'}</div>`;
}

// ---------------------------------------------------------------
function showSandbox() {
  const dbs = Object.entries(K.dbs);
  const cur = store.get('sb:db') || dbs[0][0];
  view.innerHTML = `<div class="col"><article class="card"><div class="lbody">
    <p class="hint" style="margin:0">Тук нищо не се проверява и не се записва</p><h1 style="margin:.2rem 0 1rem">Пясъчник</h1>
    <label class="field" style="max-width:280px">База от данни<select id="sbdb">${dbs.map(([k, d]) => `<option value="${esc(k)}" ${k === cur ? 'selected' : ''}>${esc(d.title)}</option>`).join('')}</select></label>
    <p id="sbdesc" style="color:var(--ink-2)"></p>
    <div class="panel" id="sbschema"></div>
    <div class="ed"></div><div class="params hidden"></div>
    <div class="actions"><button class="btn accent run">▶ Изпълни <span class="kbd">Ctrl+Enter</span></button></div>
    <div class="out" aria-live="polite"></div>
    <p class="hint" style="margin-top:1rem">Всяко изпълнение започва от чиста база. Можеш да пишеш няколко заявки, разделени с <code>;</code>.</p>
  </div></article></div>`;
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

function showGlossary() {
  const G = [...(K.glossary || [])].sort((a, b) => a[0].localeCompare(b[0], 'bg'));
  view.innerHTML = `<div class="col" style="max-width:1100px"><h1>Речник</h1><p class="hint">Понятията от учебната програма и учебника. Цъкни урока, за да отидеш там.</p>
    <input class="gloss-search" id="gq" placeholder="Търси понятие…" aria-label="Търси понятие"><div class="gloss" id="gl"></div></div>`;
  const draw = (qq) => {
    const s = qq.trim().toLowerCase();
    $('#gl').innerHTML = G.filter((g) => !s || (g[0] + ' ' + g[1]).toLowerCase().includes(s)).map((g) => {
      const L = lessonById(g[2]);
      return `<div class="card" style="--accent:${lessonColor(g[2])}"><b>${esc(g[0])}</b><p>${esc(g[1])}</p>${L ? `<a href="#/l/${L.id}/teoria">Урок ${L.num}. ${esc(L.title)}</a>` : ''}</div>`;
    }).join('') || '<p class="empty">Няма такова понятие.</p>';
  };
  draw('');
  $('#gq').addEventListener('input', (e) => draw(e.target.value));
}

function showBadges() {
  const B = computeBadges(PROG, K.lessons);
  const general = B.filter((b) => !b.lesson), les = B.filter((b) => b.lesson);
  const card = (b) => `<div class="card badge ${b.got ? '' : 'off'}">${medal(b)}<b>${esc(b.name)}</b><span class="d">${esc(b.desc)}</span></div>`;
  view.innerHTML = `<div class="col" style="max-width:1100px"><h1>Значки</h1><p class="hint">Имаш ${B.filter((b) => b.got).length} от ${B.length}.</p>
    <h2 class="section-title">Постижения</h2><div class="badges">${general.map(card).join('')}</div>
    <h2 class="section-title">Завършени уроци</h2><div class="badges">${les.map(card).join('')}</div></div>`;
}

function showAccount() {
  view.innerHTML = `<div class="col"><h1>Профил</h1>
    <div class="cards2"><div class="card pad"><h2 style="margin-top:0">Данни</h2>
      <p>Име: <b>${esc(ME.name)}</b><br>Потребителско име: <b>${esc(ME.username)}</b><br>${ME.class ? `Клас: <b>${esc(ME.class)}</b>` : ''}</p>
      <p class="hint">Ако нещо е сгрешено, кажи на учителката — тя може да го поправи.</p></div>
    <div class="card pad"><h2 style="margin-top:0">Смяна на паролата</h2><div id="pwmsg"></div>
      <form id="pw"><label class="field">Сегашна парола<input type="password" name="old" required autocomplete="current-password"></label>
      <label class="field">Нова парола<input type="password" name="new" required minlength="6" autocomplete="new-password"></label>
      <button class="btn primary">Смени паролата</button></form></div></div></div>`;
  $('#pw').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('password', Object.fromEntries(new FormData(e.target))); $('#pwmsg').innerHTML = '<div class="form-ok">Паролата е сменена. <a href="#/">Към уроците</a></div>'; e.target.reset(); }
    catch (ex) { $('#pwmsg').innerHTML = `<div class="form-error">${esc(ex.message)}</div>`; }
  });
}

boot();
