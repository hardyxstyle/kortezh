// Кортеж — учителски панел.
import { $, $$, esc, api, toast, store, when, brand, initTheme, computeBadges } from '/common.js';

const K = window.KORTEZH;
const view = $('#view');
$('#brand').innerHTML = brand;
initTheme($('#theme'));
const TASK = {};
K.lessons.forEach((L) => L.tasks.forEach((t) => { TASK[t.id] = { ...t, lesson: L }; }));
const taskLabel = (id) => (TASK[id] ? `${id} ${TASK[id].title}` : id);
const shortId = (id) => id.split('-')[1];
const tries = (n) => `${n} ${n === 1 ? 'опит' : 'опита'}`;

let DATA = null;
let CLS = store.get('t:class') || '';

async function load() {
  DATA = await api('t/overview');
  return DATA;
}
function students() {
  return DATA.students.filter((s) => !CLS || s.class === CLS);
}
function classChips(onChange) {
  const names = [...new Set([...DATA.classes.map((c) => c.name), ...DATA.students.map((s) => s.class).filter(Boolean)])].sort();
  const html = `<div class="chips" role="group" aria-label="Клас"><button data-c="" class="${!CLS ? 'on' : ''}">Всички</button>${names.map((n) => `<button data-c="${esc(n)}" class="${CLS === n ? 'on' : ''}">${esc(n)}</button>`).join('')}</div>`;
  setTimeout(() => $$('.chips button', view).forEach((b) => b.addEventListener('click', () => { CLS = b.dataset.c; store.set('t:class', CLS); onChange(); })));
  return html;
}

// ---------------------------------------------------------------
async function boot() {
  try {
    const me = await api('me');
    if (me.user.role !== 'teacher') return location.replace('/app.html');
    $('#who').textContent = me.user.name;
  } catch { return location.replace('/'); }
  route();
}
window.addEventListener('hashchange', route);
$('#logout').addEventListener('click', async () => { try { await api('logout', {}); } finally { location.replace('/'); } });

async function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const [a, b] = h.split('/');
  $$('[data-nav]').forEach((x) => x.classList.toggle('active', x.dataset.nav === (a || '')));
  try {
    if (a === 'l') return await showLessonMatrix(b);
    if (a === 's') return await showStudent(Number(b));
    if (a === 'activity') return await showActivity();
    if (a === 'classes') return await showClasses();
    if (a === 'lessons') return await showLessons();
    if (a === 'account') return showAccount();
    return await showOverview();
  } catch (e) {
    view.innerHTML = `<div class="msg bad">${esc(e.message)}</div>`;
  }
}

// ---------------------------------------------------------------
function heat(solved, total) {
  if (!total) return '';
  const r = solved / total;
  const bg = r === 0 ? 'transparent' : `rgba(46,139,87,${0.12 + r * 0.55})`;
  return `<span class="heat" style="background:${bg};${r > 0.7 ? 'color:#fff;font-weight:600' : ''}">${solved}/${total}</span>`;
}

async function showOverview() {
  await load();
  const list = students();
  const closed = DATA.settings.closed;
  const lessons = K.lessons;
  const head = lessons.map((L) => `<th class="lh" data-l="${L.id}" title="${esc(L.title)} — отвори задачите">${L.num}${closed.includes(L.id) ? ' <span title="заключен" style="color:var(--ink-3)">(з)</span>' : ''}</th>`).join('');
  const rows = list.map((s) => {
    let tot = 0, all = 0;
    const cells = lessons.map((L) => {
      const main = L.tasks.filter((t) => !t.bonus).length;
      const st = s.stats.lessons[L.id];
      const read = s.stats.read.includes(L.id);
      // броим само основните за процента, бонусите отделно
      const solvedMain = DATA.progress.filter((p) => p[0] === s.id && p[2] && TASK[p[1]]?.lesson.id === L.id && !TASK[p[1]].bonus).length;
      tot += solvedMain; all += main;
      const bonus = (st?.solved || 0) - solvedMain;
      return `<td class="cell" title="${esc(L.title)}${read ? ', теорията е прочетена' : ''}">${st || read ? heat(solvedMain, main) : '<span style="color:var(--rule)">—</span>'}${bonus > 0 ? `<span class="star">+${bonus}</span>` : ''}${read ? '<sup style="color:var(--ink-3)">т</sup>' : ''}</td>`;
    }).join('');
    return `<tr class="${s.active ? '' : 'off'}"><td class="name"><a href="#/s/${s.id}">${esc(s.name)}</a>${s.active ? '' : ' (спрян)'}</td><td>${esc(s.class || '')}</td>${cells}<td class="cell"><b>${tot}</b>/${all}</td><td class="cell">${s.attempts}</td><td>${when(s.lastAttempt || s.last_seen)}</td></tr>`;
  }).join('');
  view.innerHTML = `<h1>Ученици</h1>${classChips(showOverview)}
    ${list.length ? `<div class="grid-wrap"><table class="grid"><thead><tr><th>Ученик</th><th>Клас</th>${head}<th>Общо</th><th>Опити</th><th>Последно</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="hint">В клетките е броят решени основни задачи от урока. Зеленото е по-наситено, колкото повече са решени. „+n“ са бонус задачите, а малкото „т“ значи, че ученикът е отбелязал теорията като прочетена. Цъкни номер на урок, за да видиш всяка задача поотделно, или име, за да видиш всичко за ученика.</p>`
    : `<div class="box empty">Още няма регистрирани ученици${CLS ? ' в ' + esc(CLS) : ''}. Създай клас в <a href="#/classes">Класове</a> и дай кода на учениците.</div>`}`;
  $$('th.lh').forEach((th) => th.addEventListener('click', () => { location.hash = '#/l/' + th.dataset.l; }));
}

// ---------------------------------------------------------------
async function showLessonMatrix(lessonId) {
  const L = K.lessons.find((x) => x.id === lessonId);
  if (!L) { location.hash = '#/'; return; }
  await load();
  const list = students();
  const pm = {};
  DATA.progress.forEach(([u, t, s, n, h]) => { pm[u + '|' + t] = { s, n, h }; });
  const head = L.tasks.map((t) => `<th class="lh" data-t="${t.id}" title="${esc(t.title)}">${shortId(t.id)}${t.bonus ? '★' : ''}</th>`).join('');
  const rows = list.map((s) => `<tr class="${s.active ? '' : 'off'}"><td class="name"><a href="#/s/${s.id}">${esc(s.name)}</a></td><td>${esc(s.class || '')}</td>${L.tasks.map((t) => {
    const p = pm[s.id + '|' + t.id];
    if (!p) return `<td class="cell" data-t="${t.id}" data-u="${s.id}"></td>`;
    const hm = p.h ? `<span class="hint-mark" title="ползвал(а) подсказка ${p.h}">п${p.h}</span>` : '';
    if (!p.n) return `<td class="cell" data-t="${t.id}" data-u="${s.id}">${hm}</td>`;
    return `<td class="cell ${p.s ? 'ok' : 'bad'}" data-t="${t.id}" data-u="${s.id}" title="${tries(p.n)}${p.h ? ', с подсказка' : ''}">${p.s ? '✓' : '✗'}${p.n > 1 ? `<small>${p.n}</small>` : ''}${hm}</td>`;
  }).join('')}</tr>`).join('');
  const solvedBy = (t) => list.filter((s) => pm[s.id + '|' + t.id]?.s).length;
  view.innerHTML = `<p><a href="#/">← Всички уроци</a></p><h1>Урок ${L.num}. ${esc(L.title)}</h1>${classChips(() => showLessonMatrix(lessonId))}
    <div class="grid-wrap"><table class="grid mx"><thead><tr><th>Ученик</th><th>Клас</th>${head}</tr></thead><tbody>${rows || `<tr><td colspan="${L.tasks.length + 2}" class="empty">Няма ученици.</td></tr>`}</tbody>
    <tfoot><tr><td colspan="2" style="color:var(--ink-3)">Решили</td>${L.tasks.map((t) => `<td class="cell">${solvedBy(t)}</td>`).join('')}</tr></tfoot></table></div>
    <p class="hint">✓ решена, ✗ опитвана, но още не е решена (малкото число е броят опити), „п1“/„п2“ — ползвал(а) подсказка 1 или 2. Цъкни задача или клетка, за да видиш какво са написали.</p>
    <div id="taskpanel" style="margin-top:1.5rem"></div>`;
  $$('[data-t]', view).forEach((c) => c.addEventListener('click', () => showTaskAnswers(c.dataset.t, c.dataset.u)));
}

async function showTaskAnswers(taskId, focusUser) {
  const t = TASK[taskId];
  const panel = $('#taskpanel');
  panel.innerHTML = '<p class="empty">Зареждане…</p>';
  const d = await api('t/task/' + taskId);
  const rows = d.rows.filter((r) => !CLS || r.class === CLS);
  const opt = (a) => (t.kind === 'choice' && a != null ? `${Number(a) + 1}) ${t.options[Number(a)] ?? ''}` : a);
  panel.innerHTML = `<div class="box"><h2>${esc(taskLabel(taskId))}</h2><div style="margin-bottom:1rem">${t.text}</div>
    ${t.kind === 'choice' ? `<ol>${t.options.map((o) => `<li>${o}</li>`).join('')}</ol>` : ''}
    ${rows.map((r) => `<div id="ans-${r.id}" style="border-top:1px solid var(--rule-soft);padding:.6rem 0;${String(r.id) === String(focusUser) ? 'background:var(--mark-soft);' : ''}">
      <div class="row-flex"><b>${esc(r.name)}</b><span class="hint">${esc(r.class || '')}</span>
      ${r.tries ? `<span class="${r.solved ? 'mark-ok' : 'mark-bad'}" style="color:${r.solved ? 'var(--ok)' : 'var(--bad)'}">${r.solved ? '✓ решена' : '✗ не е решена'}</span><span class="hint">${tries(r.tries)}${r.hints ? `, подсказка ${r.hints}` : ''}, последно ${when(r.updated_at)}</span>` : '<span class="hint">не е опитвана</span>'}</div>
      ${r.last_answer != null ? `<div class="code-small">${esc(opt(r.last_answer))}</div>` : ''}
      ${r.solved_answer && r.solved_answer !== r.last_answer ? `<div class="hint">Вярното решение:</div><div class="code-small">${esc(opt(r.solved_answer))}</div>` : ''}
    </div>`).join('')}</div>`;
  const target = focusUser ? $('#ans-' + focusUser) : panel;
  (target || panel).scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ---------------------------------------------------------------
async function showStudent(id) {
  const [d] = await Promise.all([api('t/student/' + id), DATA ? null : load()]);
  const u = d.user;
  const prog = Object.fromEntries(d.progress.map((p) => [p.task_id, p]));
  const classes = [...new Set(DATA.classes.map((c) => c.name))];
  const lessonsHtml = K.lessons.map((L) => {
    const read = prog['read:' + L.id];
    const anyTry = L.tasks.some((t) => prog[t.id]);
    const solved = L.tasks.filter((t) => !t.bonus && prog[t.id]?.solved).length;
    const main = L.tasks.filter((t) => !t.bonus).length;
    return `<details ${anyTry ? 'open' : ''} class="box" style="margin-bottom:.8rem"><summary style="cursor:pointer"><b>Урок ${L.num}. ${esc(L.title)}</b> <span class="hint">${solved}/${main} основни${read ? ', теорията е прочетена ' + when(read.updated_at) : ''}</span></summary>
      <table class="grid" style="margin-top:.6rem"><tbody>${L.tasks.map((t) => {
        const p = prog[t.id];
        const opt = (a) => (t.kind === 'choice' && a != null ? `${Number(a) + 1}) ${t.options[Number(a)] ?? ''}` : a);
        return `<tr><td style="width:3rem" class="mono">${shortId(t.id)}${t.bonus ? '★' : ''}</td><td style="white-space:normal">${esc(t.title)}
          ${p?.last_answer != null ? `<div class="code-small">${esc(opt(p.last_answer))}</div>` : ''}
          ${p?.solved_answer && p.solved_answer !== p.last_answer ? `<div class="hint">Вярното решение (${when(p.first_solved_at)}):</div><div class="code-small">${esc(opt(p.solved_answer))}</div>` : ''}</td>
          <td style="width:9rem">${p ? `<span style="color:${p.solved ? 'var(--ok)' : 'var(--bad)'};font-weight:600">${p.solved ? '✓ решена' : '✗ не е'}</span><br><span class="hint">${tries(p.tries)}${p.hints ? `, подсказка ${p.hints}` : ''}</span>` : '<span class="hint">—</span>'}</td></tr>`;
      }).join('')}</tbody></table></details>`;
  }).join('');
  view.innerHTML = `<p><a href="#/">← Ученици</a></p>
    <h1>${esc(u.name)}</h1>
    <p class="hint" style="font-size:.95rem">Значки: <b>${(() => { const pr = {}; d.progress.forEach((x) => { pr[x.task_id] = { s: x.solved, t: x.tries, h: x.hints }; }); return computeBadges(pr, K.lessons).filter((b) => b.got).length; })()}</b>. ${esc(u.class || 'без клас')}, потребител <b>${esc(u.username)}</b>, регистриран ${when(u.created_at)}, последно активен ${when(u.last_seen)}${u.active ? '' : ', <b style="color:var(--bad)">профилът е спрян</b>'}</p>
    <div class="box" style="margin:1rem 0 1.5rem"><div class="row-flex">
      <label class="field" style="margin:0">Клас <select id="cls">${[u.class, ...classes].filter((v, i, a) => v && a.indexOf(v) === i).map((c) => `<option ${c === u.class ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
      <button class="btn small" id="savecls">Запази класа</button>
      <button class="btn small" id="newpw">Нова парола</button>
      <button class="btn small" id="toggle">${u.active ? 'Спри профила' : 'Активирай профила'}</button>
      <button class="btn small danger" id="reset">Изтрий напредъка</button>
      <button class="btn small danger" id="del">Изтрий ученика</button>
    </div><div id="pwbox"></div></div>
    <div class="cards2" style="grid-template-columns:minmax(0,2fr) minmax(280px,1fr)"><div>${lessonsHtml}</div>
    <div class="box"><h2>Всички опити (${d.attempts.length})</h2>${d.attempts.length ? d.attempts.map((a) => `<details class="att"><summary><span style="color:${a.ok ? 'var(--ok)' : 'var(--bad)'};font-weight:700">${a.ok ? '✓' : '✗'}</span> ${esc(taskLabel(a.task_id))} <span class="hint">${when(a.created_at)}</span></summary>
      <div class="code-small">${esc(TASK[a.task_id]?.kind === 'choice' ? `${Number(a.answer) + 1}) ${TASK[a.task_id].options[Number(a.answer)] ?? ''}` : a.answer)}</div><div class="hint">${esc(a.message || '')}</div></details>`).join('') : '<p class="hint">Още няма опити.</p>'}</div></div>`;
  const upd = async (body, msg) => { try { await api('t/student/update', { id, ...body }); toast(msg); DATA = null; showStudent(id); } catch (e) { toast(e.message); } };
  $('#savecls').addEventListener('click', () => upd({ class: $('#cls').value }, 'Класът е сменен.'));
  $('#toggle').addEventListener('click', () => upd({ active: !u.active }, u.active ? 'Профилът е спрян.' : 'Профилът е активиран.'));
  $('#newpw').addEventListener('click', () => {
    const pw = Math.random().toString(36).slice(2, 8);
    $('#pwbox').innerHTML = `<div class="row-flex" style="margin-top:.8rem"><label class="field" style="margin:0">Нова парола <input id="pwv" value="${pw}"></label><button class="btn small primary" id="pwsave">Задай</button></div>`;
    $('#pwsave').addEventListener('click', async () => {
      const v = $('#pwv').value;
      try { await api('t/student/update', { id, password: v }); $('#pwbox').innerHTML = `<div class="form-ok" style="margin-top:.8rem">Новата парола на ${esc(u.username)} е <b class="mono">${esc(v)}</b>. Запиши я и я дай на ученика.</div>`; }
      catch (e) { toast(e.message); }
    });
  });
  $('#reset').addEventListener('click', async () => {
    if (!confirm(`Да изтрия ли целия напредък и всички опити на ${u.name}? Това не може да се върне.`)) return;
    await api('t/student/reset', { id }); toast('Напредъкът е изтрит.'); DATA = null; showStudent(id);
  });
  $('#del').addEventListener('click', async () => {
    if (!confirm(`Да изтрия ли ученика ${u.name} заедно с целия му напредък? Това не може да се върне.`)) return;
    await api('t/student/delete', { id }); toast('Ученикът е изтрит.'); DATA = null; location.hash = '#/';
  });
}

// ---------------------------------------------------------------
async function showActivity() {
  if (!DATA) await load();
  const q = CLS ? `?class=${encodeURIComponent(CLS)}` : '';
  const d = await api('t/activity' + q);
  view.innerHTML = `<div class="row-flex" style="justify-content:space-between"><h1>Активност</h1><button class="btn small" id="refresh">Обнови</button></div>${classChips(showActivity)}
    <div class="box">${d.rows.length ? `<ul class="feed">${d.rows.map((a) => {
      const t = TASK[a.task_id];
      const ans = t?.kind === 'choice' ? `${Number(a.answer) + 1}) ${t.options[Number(a.answer)] ?? ''}` : a.answer;
      return `<li><span class="${a.ok ? 'mark-ok' : 'mark-bad'}">${a.ok ? '✓' : '✗'}</span><div><div><a href="#/s/${a.user_id}"><b>${esc(a.name)}</b></a> <span class="hint">${esc(a.class || '')}</span> <span>${esc(taskLabel(a.task_id))}</span> <span class="meta">${when(a.created_at)}</span></div>
      <details><summary class="meta">какво е написал(а)</summary><div class="code-small">${esc(ans)}</div><div class="meta">${esc(a.message || '')}</div></details></div></li>`;
    }).join('')}</ul>` : '<p class="empty">Още няма опити.</p>'}</div>`;
  $('#refresh').addEventListener('click', showActivity);
}

// ---------------------------------------------------------------
async function showClasses() {
  await load();
  const site = location.origin;
  const clsNames = [...new Set([...DATA.classes.map((c) => c.name), ...DATA.students.map((s) => s.class).filter(Boolean)])].sort();
  view.innerHTML = `<h1>Класове и ученици</h1>
    <div class="box" style="margin-bottom:1.2rem"><h2>Добави ученици</h2>
      <p class="hint" style="margin-top:0">Самостоятелната регистрация е изключена (някой се опита да налучка кода с хиляди автоматични заявки). Постави имената — по едно на ред — и сайтът ще създаде профилите с потребителско име и парола.</p>
      <div id="smsg"></div>
      <form id="news"><div class="row-flex" style="align-items:flex-start">
        <label class="field" style="min-width:160px">Клас<select name="class">${clsNames.map((c) => `<option>${esc(c)}</option>`).join('')}</select></label>
        <label class="field" style="flex:1;min-width:260px">Имена (по едно на ред)<textarea name="names" rows="6" style="display:block;width:100%;margin-top:.3rem;padding:.6em .7em;border:1.5px solid var(--rule);border-radius:6px;background:var(--surface);color:var(--ink);font:inherit" placeholder="Мария Иванова&#10;Петър Петров"></textarea></label>
      </div><button class="btn primary">Създай профилите</button></form>
      <div id="created"></div>
    </div>
    <div class="cards2"><div class="box"><h2>Нов клас</h2><div id="cmsg"></div>
      <form id="newc"><label class="field">Име на класа<input name="name" required maxlength="20" placeholder="напр. 12а"></label>
      <label class="field">Код (по желание)<input name="code" maxlength="20" placeholder="остави празно за случаен" style="text-transform:uppercase"><span class="hint">Латински букви, цифри и тире.</span></label>
      <button class="btn primary">Създай клас</button></form></div>
    <div class="box"><h2>Как влизат учениците</h2><p>Отварят <b class="mono">${esc(site)}</b> и влизат с потребителското име и паролата, които им даваш. После могат да си сменят паролата от „Профил“.</p><p class="hint">Ако някой забрави паролата, отвори го от „Ученици“ и натисни „Нова парола“.</p></div></div>
    <h2 class="section">Класове</h2>
    ${DATA.classes.length ? `<div class="grid-wrap"><table class="grid"><thead><tr><th>Клас</th><th>Код</th><th>Ученици</th><th>Регистрация с код</th><th></th></tr></thead><tbody>
    ${DATA.classes.map((c) => `<tr><td><b>${esc(c.name)}</b></td><td><span class="big-code">${esc(c.code)}</span></td><td>${c.students}</td>
      <td><span class="hint">изключена</span></td>
      <td><button class="btn small ghost" data-del="${esc(c.code)}">Изтрий кода</button></td></tr>`).join('')}</tbody></table></div>
      <p class="hint">Изтриването на код не трие учениците, само спира регистрацията с него.</p>` : '<p class="hint">Още няма класове.</p>'}`;
  $('#news').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const names = String(fd.get('names') || '').split('\n').map((x) => x.trim()).filter(Boolean);
    if (!names.length) { $('#smsg').innerHTML = '<div class="form-error">Напиши поне едно име.</div>'; return; }
    if (!fd.get('class')) { $('#smsg').innerHTML = '<div class="form-error">Първо създай клас отдолу.</div>'; return; }
    const btn = e.target.querySelector('button'); btn.disabled = true;
    const out = [];
    for (const n of names) {
      $('#smsg').innerHTML = `<div class="msg info">Създавам ${out.length + 1} от ${names.length}…</div>`;
      try { out.push(await api('t/student/create', { name: n, class: fd.get('class') })); }
      catch (ex) { out.push({ name: n, error: ex.message }); }
    }
    btn.disabled = false;
    $('#smsg').innerHTML = '<div class="form-ok">Готово. Запиши или принтирай паролите сега — после не се виждат (може само да се зададе нова).</div>';
    $('#created').innerHTML = `<div class="grid-wrap" style="margin-top:.8rem"><table class="grid" id="ptab"><thead><tr><th>Име</th><th>Клас</th><th>Потребителско име</th><th>Парола</th></tr></thead><tbody>${out.map((r) => r.error ? `<tr><td>${esc(r.name)}</td><td colspan="3" style="color:var(--bad)">${esc(r.error)}</td></tr>` : `<tr><td>${esc(r.name)}</td><td>${esc(r.class)}</td><td class="mono"><b>${esc(r.username)}</b></td><td class="mono"><b>${esc(r.password)}</b></td></tr>`).join('')}</tbody></table></div>
      <div class="row-flex" style="margin-top:.6rem"><button class="btn small" id="printpw">Принтирай</button><span class="hint">Адрес: ${esc(site)}</span></div>`;
    $('#printpw').addEventListener('click', () => {
      const w = window.open('', '_blank');
      w.document.write(`<html><head><meta charset="utf-8"><title>Профили</title><style>body{font-family:sans-serif}td{border:1px dashed #999;padding:14px 18px}table{border-collapse:collapse}</style></head><body><table>${out.filter((r) => !r.error).map((r) => `<tr><td><b>${esc(r.name)}</b> (${esc(r.class)})<br>Сайт: ${esc(site)}<br>Потребител: <b>${esc(r.username)}</b><br>Парола: <b>${esc(r.password)}</b></td></tr>`).join('')}</table></body></html>`);
      w.document.close(); w.print();
    });
    DATA = null;
  });
  $('#newc').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { const r = await api('t/class', Object.fromEntries(new FormData(e.target))); toast('Създаден е код ' + r.code); showClasses(); }
    catch (ex) { $('#cmsg').innerHTML = `<div class="form-error">${esc(ex.message)}</div>`; }
  });
  $$('[data-toggle]').forEach((b) => b.addEventListener('click', async () => { await api('t/class/toggle', { code: b.dataset.toggle }); showClasses(); }));
  $$('[data-del]').forEach((b) => b.addEventListener('click', async () => { if (!confirm('Да изтрия ли кода ' + b.dataset.del + '?')) return; await api('t/class/delete', { code: b.dataset.del }); showClasses(); }));
}

// ---------------------------------------------------------------
async function showLessons() {
  await load();
  const s = DATA.settings;
  view.innerHTML = `<h1>Уроци и настройки</h1>
    <div class="cards2"><div class="box"><h2>Отворени уроци</h2><p class="hint">Учениците виждат и решават само отворените уроци. Отваряй ги, когато стигнете до тях.</p>
      ${K.lessons.map((L) => `<label style="display:flex;gap:.6rem;padding:.45rem 0;border-top:1px solid var(--rule-soft);cursor:pointer"><input type="checkbox" data-l="${L.id}" ${s.closed.includes(L.id) ? '' : 'checked'}><span><b>${L.num}.</b> ${esc(L.title)} <span class="hint">(учебник, урок ${L.book}; ${L.tasks.length} задачи)</span></span></label>`).join('')}
      <div class="row-flex" style="margin-top:.8rem"><button class="btn small" id="all">Отвори всички</button><button class="btn small" id="none">Заключи всички</button></div></div>
    <div class="box"><h2>Настройки</h2>
      <label style="display:flex;gap:.6rem;padding:.45rem 0;cursor:pointer"><input type="checkbox" id="lb" ${s.leaderboard ? 'checked' : ''}><span>Учениците виждат класиране на своя клас</span></label>
      <label style="display:flex;gap:.6rem;padding:.45rem 0;cursor:pointer"><input type="checkbox" id="se" ${s.showExpected ? 'checked' : ''}><span>Учениците могат да видят очаквания резултат на задачата (без решението)</span></label>
    </div></div>
    <div style="margin-top:1rem"><button class="btn primary" id="save">Запази</button></div>`;
  $('#all').addEventListener('click', () => $$('[data-l]').forEach((c) => { c.checked = true; }));
  $('#none').addEventListener('click', () => $$('[data-l]').forEach((c) => { c.checked = false; }));
  $('#save').addEventListener('click', async () => {
    const closed = $$('[data-l]').filter((c) => !c.checked).map((c) => c.dataset.l);
    try { await api('t/settings', { closed, leaderboard: $('#lb').checked, showExpected: $('#se').checked }); toast('Запазено.'); }
    catch (e) { toast(e.message); }
  });
}

function showAccount() {
  view.innerHTML = `<h1>Профил</h1><div class="box" style="max-width:420px"><h2>Смяна на паролата</h2><div id="pwmsg"></div>
    <form id="pw"><label class="field">Сегашна парола<input type="password" name="old" required autocomplete="current-password"></label>
    <label class="field">Нова парола<input type="password" name="new" required minlength="8" autocomplete="new-password"><span class="hint">Поне 8 знака.</span></label>
    <button class="btn primary">Смени паролата</button></form></div>`;
  $('#pw').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('password', Object.fromEntries(new FormData(e.target))); $('#pwmsg').innerHTML = '<div class="form-ok">Паролата е сменена.</div>'; e.target.reset(); }
    catch (ex) { $('#pwmsg').innerHTML = `<div class="form-error">${esc(ex.message)}</div>`; }
  });
}

boot();
