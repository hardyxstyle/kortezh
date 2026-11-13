// Кортеж — API. Всички заявки към /api/* минават оттук.
import { json, fail, ensureSchema, hashPassword, safeEqual, randomHex, createSession, clearCookie, currentUser, getSettings, dbFactory, readJson } from '../_lib/server.js';
import { gradeSql } from '../_lib/engine.js';
import { TASKS, LESSONS } from '../_lib/content.js';

const USERNAME_RE = /^[\p{L}\p{N}._-]{3,30}$/u;
const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const clip = (s, n) => (s == null ? null : String(s).slice(0, n));

export async function onRequest(context) {
  const { request, env, params } = context;
  try {
    await ensureSchema(env);
  } catch (e) {
    if (String(e.message) === 'NO_DB') return fail('Базата D1 не е свързана. В Cloudflare: Settings → Bindings → D1 database, име на променливата DB.', 500);
    return fail('Грешка в базата: ' + e.message, 500);
  }
  const path = (params.path || []).join('/');
  const method = request.method;
  try {
    const user = await currentUser(env, request);
    const route = ROUTES[`${method} ${path}`] || matchDynamic(method, path);
    if (!route) return fail('Няма такъв адрес.', 404);
    const [handler, access, extra] = route;
    if (access === 'user' && !user) return fail('Трябва да влезеш в профила си.', 401);
    if (access === 'teacher' && (!user || user.role !== 'teacher')) return fail('Само за учителя.', 403);
    const body = method === 'POST' ? await readJson(request) : {};
    return await handler({ env, request, user, body, url: new URL(request.url), extra });
  } catch (e) {
    return fail('Сървърна грешка: ' + (e && e.message ? e.message : e), 500);
  }
}

function matchDynamic(method, path) {
  let m;
  if (method === 'GET' && (m = path.match(/^t\/student\/(\d+)$/))) return [teacherStudent, 'teacher', Number(m[1])];
  if (method === 'GET' && (m = path.match(/^t\/task\/([\w-]+)$/))) return [teacherTask, 'teacher', m[1]];
  return null;
}

// =====================================================================
// Публични
// =====================================================================
async function status({ env }) {
  const t = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'teacher'").first();
  return json({ hasTeacher: t.n > 0 });
}

async function setup({ env, body }) {
  const t = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'teacher'").first();
  if (t.n > 0) return fail('Учителски профил вече има. Влез от началната страница.', 403);
  const v = validateNew(body, true);
  if (v) return fail(v);
  const salt = randomHex(16);
  const pass = await hashPassword(body.password, salt);
  const r = await env.DB.prepare("INSERT INTO users (username, name, class, role, pass, salt) VALUES (?, ?, NULL, 'teacher', ?, ?)").bind(body.username.trim(), body.name.trim(), pass, salt).run();
  const cookie = await createSession(env, r.meta.last_row_id);
  return json({ ok: true, role: 'teacher' }, 200, { 'set-cookie': cookie });
}

function validateNew(b, teacher) {
  if (!b.name || b.name.trim().length < 3 || b.name.length > 60) return 'Напиши име и фамилия (поне 3 знака).';
  if (!b.username || !USERNAME_RE.test(b.username.trim())) return 'Потребителското име трябва да е 3–30 знака: букви, цифри, точка, тире или долна черта (без интервали).';
  if (!b.password || b.password.length < (teacher ? 8 : 6)) return `Паролата трябва да е поне ${teacher ? 8 : 6} знака.`;
  if (b.password.length > 200) return 'Паролата е твърде дълга.';
  return null;
}

async function register({ env, body }) {
  // Самостоятелната регистрация е изключена (беше атакувана с налучкване на кодове).
  // Профилите се създават от учителя: Класове → Добави ученици.
  return fail('Регистрацията е изключена. Профила ти го създава учителката.', 403);
  const v = validateNew(body, false);
  if (v) return fail(v);
  const code = String(body.code || '').trim().toUpperCase();
  const cls = await env.DB.prepare('SELECT name, open FROM classes WHERE code = ?').bind(code).first();
  if (!cls) return fail('Няма клас с такъв код. Провери кода, който ти е дала учителката.');
  if (!cls.open) return fail('Регистрацията за този клас е затворена. Попитай учителката.');
  const exists = await env.DB.prepare('SELECT 1 FROM users WHERE username = ?').bind(body.username.trim()).first();
  if (exists) return fail('Това потребителско име е заето. Избери друго.');
  const salt = randomHex(16);
  const pass = await hashPassword(body.password, salt);
  const r = await env.DB.prepare("INSERT INTO users (username, name, class, role, pass, salt) VALUES (?, ?, ?, 'student', ?, ?)").bind(body.username.trim(), body.name.trim(), cls.name, pass, salt).run();
  const cookie = await createSession(env, r.meta.last_row_id);
  return json({ ok: true, role: 'student' }, 200, { 'set-cookie': cookie });
}

// Защита от налучкване на пароли: 10 грешни опита за едно потребителско име или 200 от един адрес
// (в училище целият клас е зад един адрес) → 15 минути пауза.
const FAILS = new Map();
const WINDOW = 15 * 60e3;
const ipOf = (request) => request.headers.get('cf-connecting-ip') || 'local';
function tooMany(key, max) {
  const f = FAILS.get(key);
  if (!f) return false;
  if (Date.now() - f.first > WINDOW) { FAILS.delete(key); return false; }
  return f.n >= max;
}
function addFail(key) {
  const f = FAILS.get(key);
  if (!f || Date.now() - f.first > WINDOW) FAILS.set(key, { n: 1, first: Date.now() });
  else f.n++;
  if (FAILS.size > 5000) FAILS.clear();
}

async function login({ env, body, request }) {
  const ip = ipOf(request);
  const uname = String(body.username || '').trim().toLowerCase();
  const kIp = 'ip:' + ip, kUser = 'u:' + ip + ':' + uname;
  if (tooMany(kIp, 200) || tooMany(kUser, 10)) return fail('Твърде много грешни опити. Опитай пак след 15 минути.', 429);
  const bad = () => { addFail(kIp); addFail(kUser); return fail('Грешно потребителско име или парола.'); };
  const u = await env.DB.prepare('SELECT id, role, pass, salt, active FROM users WHERE username = ?').bind(String(body.username || '').trim()).first();
  // хешираме и при несъществуващо име, за да не личи по времето кои имена съществуват
  const h = await hashPassword(String(body.password || ''), u ? u.salt : 'no-such-user-salt');
  if (!u || !safeEqual(h, u.pass)) return bad();
  if (!u.active) return fail('Профилът ти е спрян. Попитай учителката.');
  const cookie = await createSession(env, u.id);
  return json({ ok: true, role: u.role }, 200, { 'set-cookie': cookie });
}

async function logout({ env, user }) {
  if (user) await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(user.token).run();
  return json({ ok: true }, 200, { 'set-cookie': clearCookie });
}

// =====================================================================
// Ученик
// =====================================================================
async function me({ env, user }) {
  const [rows, settings] = await Promise.all([
    env.DB.prepare('SELECT task_id, solved, tries, last_answer, solved_answer, hints FROM progress WHERE user_id = ?').bind(user.id).all(),
    getSettings(env),
  ]);
  await env.DB.prepare('UPDATE users SET last_seen = ? WHERE id = ?').bind(now(), user.id).run();
  const progress = {};
  for (const r of rows.results) progress[r.task_id] = { s: r.solved, t: r.tries, a: r.last_answer, sa: r.solved_answer, h: r.hints || 0 };
  return json({
    user: { id: user.id, name: user.name, username: user.username, class: user.class, role: user.role },
    progress,
    closed: user.role === 'teacher' ? [] : settings.closed,
    closedForStudents: settings.closed,
    leaderboard: settings.leaderboard,
    showExpected: user.role === 'teacher' ? true : settings.showExpected,
  });
}

// Ограничение: най-много 20 проверки/подсказки в минута на ученик (спира скриптове, пази лимита за записи в D1).
const RATE = new Map();
function rateLimited(userId) {
  const now = Date.now();
  const arr = (RATE.get(userId) || []).filter((t) => now - t < 60e3);
  arr.push(now);
  RATE.set(userId, arr);
  if (RATE.size > 5000) RATE.clear();
  return arr.length > 20;
}

async function check({ env, user, body }) {
  if (rateLimited(user.id)) return fail('Твърде много проверки за минута. Помисли и опитай пак след малко.', 429);
  const taskId = String(body.taskId || '');
  const task = TASKS[taskId];
  if (!task) return fail('Няма такава задача.');
  const settings = await getSettings(env);
  if (user.role !== 'teacher' && settings.closed.includes(task.lesson)) return fail('Този урок още е заключен.');
  let result, answer;
  if (task.kind === 'choice') {
    const choice = Number(body.answer);
    answer = String(choice);
    const ok = choice === task.answer;
    result = { ok, message: ok ? 'Вярно!' : 'Не е вярно. Помисли и опитай пак.', explain: ok ? task.explain : undefined };
  } else {
    answer = String(body.answer || '');
    if (answer.length > 6000) return fail('Заявката е твърде дълга.');
    const newDb = await dbFactory(task.db);
    result = gradeSql(task, answer, newDb);
  }
  if (user.role === 'teacher') return json({ ...result, teacher: true });
  const t = now();
  const ok = result.ok ? 1 : 0;
  await env.DB.batch([
    env.DB.prepare('INSERT INTO attempts (user_id, task_id, answer, ok, message, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(user.id, taskId, clip(answer, 6000), ok, clip(result.message, 400), t),
    env.DB.prepare(`INSERT INTO progress (user_id, task_id, solved, tries, last_answer, solved_answer, first_solved_at, updated_at)
      VALUES (?1, ?2, ?3, 1, ?4, CASE WHEN ?3 = 1 THEN ?4 END, CASE WHEN ?3 = 1 THEN ?5 END, ?5)
      ON CONFLICT (user_id, task_id) DO UPDATE SET
        tries = tries + 1,
        last_answer = excluded.last_answer,
        solved = MAX(solved, excluded.solved),
        solved_answer = CASE WHEN excluded.solved = 1 THEN excluded.last_answer ELSE solved_answer END,
        first_solved_at = COALESCE(first_solved_at, excluded.first_solved_at),
        updated_at = excluded.updated_at`).bind(user.id, taskId, ok, clip(answer, 6000), t),
    env.DB.prepare('UPDATE users SET last_seen = ? WHERE id = ?').bind(t, user.id),
  ]);
  return json(result);
}

async function hint({ env, user, body }) {
  if (rateLimited(user.id)) return fail('Твърде много заявки за минута. Опитай пак след малко.', 429);
  const taskId = String(body.taskId || '');
  const task = TASKS[taskId];
  if (!task || !task.hints) return fail('Няма подсказка за тази задача.');
  const level = Math.min(2, Math.max(1, Number(body.level) || 1));
  const settings = await getSettings(env);
  if (user.role !== 'teacher' && settings.closed.includes(task.lesson)) return fail('Този урок още е заключен.');
  if (user.role !== 'teacher') {
    await env.DB.prepare(`INSERT INTO progress (user_id, task_id, solved, tries, hints, updated_at) VALUES (?1, ?2, 0, 0, ?3, ?4)
      ON CONFLICT (user_id, task_id) DO UPDATE SET hints = MAX(hints, excluded.hints)`).bind(user.id, taskId, level, now()).run();
  }
  return json({ level, hints: task.hints.slice(0, level) });
}

async function markRead({ env, user, body }) {
  const id = String(body.lessonId || '');
  if (!LESSONS.find((l) => l.id === id) || user.role === 'teacher') return json({ ok: true });
  await env.DB.prepare(`INSERT INTO progress (user_id, task_id, solved, tries, updated_at) VALUES (?, ?, 1, 0, ?)
    ON CONFLICT (user_id, task_id) DO UPDATE SET updated_at = excluded.updated_at`).bind(user.id, 'read:' + id, now()).run();
  return json({ ok: true });
}

async function leaderboard({ env, user }) {
  const settings = await getSettings(env);
  if (!settings.leaderboard && user.role !== 'teacher') return json({ hidden: true, rows: [] });
  const rows = (await env.DB.prepare(`SELECT u.id, u.name, COALESCE(SUM(CASE WHEN p.solved = 1 AND p.task_id NOT LIKE 'read:%' THEN 1 ELSE 0 END), 0) AS solved
      FROM users u LEFT JOIN progress p ON p.user_id = u.id
      WHERE u.role = 'student' AND u.active = 1 AND u.class IS ?
      GROUP BY u.id ORDER BY solved DESC, u.name`).bind(user.class).all()).results;
  return json({ rows: rows.map((r) => ({ name: r.name, solved: r.solved, me: r.id === user.id })) });
}

async function changePassword({ env, user, body }) {
  const u = await env.DB.prepare('SELECT pass, salt FROM users WHERE id = ?').bind(user.id).first();
  const h = await hashPassword(String(body.old || ''), u.salt);
  if (!safeEqual(h, u.pass)) return fail('Старата парола не е вярна.');
  const nw = String(body.new || '');
  const min = user.role === 'teacher' ? 8 : 6;
  if (nw.length < min) return fail(`Новата парола трябва да е поне ${min} знака.`);
  if (nw.length > 200) return fail('Паролата е твърде дълга.');
  const salt = randomHex(16);
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET pass = ?, salt = ? WHERE id = ?').bind(await hashPassword(nw, salt), salt, user.id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND token <> ?').bind(user.id, user.token),
  ]);
  return json({ ok: true });
}

// =====================================================================
// Учител
// =====================================================================
const taskLesson = Object.fromEntries(Object.entries(TASKS).map(([id, t]) => [id, t.lesson]));

async function teacherOverview({ env }) {
  const [classes, users, prog, last, settings] = await Promise.all([
    env.DB.prepare('SELECT c.code, c.name, c.open, c.created_at, (SELECT COUNT(*) FROM users u WHERE u.class = c.name AND u.role = \'student\') AS students FROM classes c ORDER BY c.name').all(),
    env.DB.prepare("SELECT id, username, name, class, active, created_at, last_seen FROM users WHERE role = 'student' ORDER BY class, name").all(),
    env.DB.prepare('SELECT user_id, task_id, solved, tries, hints FROM progress').all(),
    env.DB.prepare('SELECT user_id, MAX(created_at) AS t, COUNT(*) AS n, SUM(ok) AS good FROM attempts GROUP BY user_id').all(),
    getSettings(env),
  ]);
  const stats = {};
  for (const r of prog.results) {
    const s = (stats[r.user_id] ||= { lessons: {}, read: [], tries: 0 });
    if (r.task_id.startsWith('read:')) { s.read.push(r.task_id.slice(5)); continue; }
    const L = taskLesson[r.task_id];
    if (!L) continue;
    const ls = (s.lessons[L] ||= { solved: 0, tried: 0 });
    ls.tried++;
    if (r.solved) ls.solved++;
    s.tries += r.tries;
  }
  const lastMap = Object.fromEntries(last.results.map((r) => [r.user_id, r]));
  return json({
    classes: classes.results,
    students: users.results.map((u) => ({ ...u, stats: stats[u.id] || { lessons: {}, read: [], tries: 0 }, attempts: lastMap[u.id]?.n || 0, good: lastMap[u.id]?.good || 0, lastAttempt: lastMap[u.id]?.t || null })),
    progress: prog.results.filter((r) => !r.task_id.startsWith('read:')).map((r) => [r.user_id, r.task_id, r.solved, r.tries, r.hints || 0]),
    settings,
  });
}

async function teacherStudent({ env, extra: id }) {
  const u = await env.DB.prepare('SELECT id, username, name, class, active, created_at, last_seen, role FROM users WHERE id = ?').bind(id).first();
  if (!u || u.role !== 'student') return fail('Няма такъв ученик.', 404);
  const [prog, att] = await Promise.all([
    env.DB.prepare('SELECT task_id, solved, tries, last_answer, solved_answer, first_solved_at, updated_at, hints FROM progress WHERE user_id = ?').bind(id).all(),
    env.DB.prepare('SELECT id, task_id, answer, ok, message, created_at FROM attempts WHERE user_id = ? ORDER BY id DESC LIMIT 400').bind(id).all(),
  ]);
  return json({ user: u, progress: prog.results, attempts: att.results });
}

async function teacherTask({ env, extra: taskId }) {
  if (!TASKS[taskId]) return fail('Няма такава задача.', 404);
  const rows = (await env.DB.prepare(`SELECT u.id, u.name, u.class, p.solved, p.tries, p.last_answer, p.solved_answer, p.updated_at, p.hints
    FROM users u LEFT JOIN progress p ON p.user_id = u.id AND p.task_id = ?
    WHERE u.role = 'student' ORDER BY u.class, u.name`).bind(taskId).all()).results;
  return json({ rows });
}

async function teacherActivity({ env, url }) {
  const limit = Math.min(Number(url.searchParams.get('limit')) || 150, 500);
  const cls = url.searchParams.get('class');
  const q = cls
    ? env.DB.prepare('SELECT a.id, a.task_id, a.answer, a.ok, a.message, a.created_at, u.id AS user_id, u.name, u.class FROM attempts a JOIN users u ON u.id = a.user_id WHERE u.class = ? ORDER BY a.id DESC LIMIT ?').bind(cls, limit)
    : env.DB.prepare('SELECT a.id, a.task_id, a.answer, a.ok, a.message, a.created_at, u.id AS user_id, u.name, u.class FROM attempts a JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT ?').bind(limit);
  return json({ rows: (await q.all()).results });
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeCode(name) {
  const lat = { 'а': 'A', 'б': 'B', 'в': 'V', 'г': 'G', 'д': 'D', 'е': 'E' };
  const base = String(name).toLowerCase().replace(/[а-е]/g, (c) => lat[c]).replace(/[^0-9A-Za-z]/g, '').toUpperCase().slice(0, 4) || 'KL';
  let s = '';
  const r = crypto.getRandomValues(new Uint8Array(4));
  for (const b of r) s += CODE_CHARS[b % CODE_CHARS.length];
  return `${base}-${s}`;
}

const TR = { 'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'sht', 'ъ': 'a', 'ь': 'y', 'ю': 'yu', 'я': 'ya' };
const translit = (s) => [...String(s).toLowerCase()].map((c) => (TR[c] !== undefined ? TR[c] : c)).join('').replace(/[^a-z0-9]/g, '');
const PW_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';
function randomPassword(n = 7) {
  let s = '';
  for (const b of crypto.getRandomValues(new Uint8Array(n))) s += PW_CHARS[b % PW_CHARS.length];
  return s;
}
async function teacherStudentCreate({ env, body }) {
  const name = String(body.name || '').trim().replace(/\s+/g, ' ');
  const cls = String(body.class || '').trim();
  if (name.length < 3 || name.length > 60) return fail('Името трябва да е 3–60 знака.');
  if (!cls) return fail('Избери клас.');
  // Ако в класа вече има ученик с това име — не създаваме нов профил.
  const norm = (x) => String(x || '').toLocaleLowerCase('bg').replace(/\s+/g, ' ').trim();
  const same = (await env.DB.prepare("SELECT name, username FROM users WHERE role = 'student' AND class = ?").bind(cls).all()).results.find((r) => norm(r.name) === norm(name));
  if (same) return json({ ok: true, skipped: true, name, username: same.username, class: cls });
  const parts = name.split(' ');
  const base = (translit(parts[0]) + (parts.length > 1 ? '.' + translit(parts[parts.length - 1]) : '')).slice(0, 26) || 'uchenik';
  let username = base, k = 1;
  while (await env.DB.prepare('SELECT 1 FROM users WHERE username = ?').bind(username).first()) username = base + (++k);
  const password = randomPassword();
  const salt = randomHex(16);
  await env.DB.prepare("INSERT INTO users (username, name, class, role, pass, salt) VALUES (?, ?, ?, 'student', ?, ?)").bind(username, name, cls, await hashPassword(password, salt), salt).run();
  return json({ ok: true, name, username, password, class: cls });
}

async function teacherList({ env, user }) {
  const rows = (await env.DB.prepare("SELECT id, username, name, created_at, last_seen FROM users WHERE role = 'teacher' ORDER BY id").all()).results;
  return json({ rows: rows.map((r) => ({ ...r, me: r.id === user.id })) });
}
async function teacherCreate({ env, body }) {
  const name = String(body.name || '').trim().replace(/\s+/g, ' ');
  if (name.length < 3 || name.length > 60) return fail('Името трябва да е 3–60 знака.');
  const parts = name.split(' ');
  const base = (translit(parts[0]) + (parts.length > 1 ? '.' + translit(parts[parts.length - 1]) : '')).slice(0, 26) || 'uchitel';
  let username = base, k = 1;
  while (await env.DB.prepare('SELECT 1 FROM users WHERE username = ?').bind(username).first()) username = base + (++k);
  const password = randomPassword(10);
  const salt = randomHex(16);
  await env.DB.prepare("INSERT INTO users (username, name, class, role, pass, salt) VALUES (?, ?, NULL, 'teacher', ?, ?)").bind(username, name, await hashPassword(password, salt), salt).run();
  return json({ ok: true, name, username, password });
}
async function teacherDelete({ env, user, body }) {
  const id = Number(body.id);
  if (id === user.id) return fail('Не можеш да изтриеш собствения си профил.');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id),
    env.DB.prepare("DELETE FROM users WHERE id = ? AND role = 'teacher'").bind(id),
  ]);
  return json({ ok: true });
}

async function teacherClassCreate({ env, body }) {
  const name = String(body.name || '').trim();
  if (!name || name.length > 20) return fail('Напиши име на класа, напр. 12а.');
  let code = String(body.code || '').trim().toUpperCase() || makeCode(name);
  if (!/^[A-Z0-9-]{4,20}$/.test(code)) return fail('Кодът може да съдържа само латински букви, цифри и тире (4–20 знака).');
  const ex = await env.DB.prepare('SELECT 1 FROM classes WHERE code = ?').bind(code).first();
  if (ex) return fail('Такъв код вече има.');
  await env.DB.prepare('INSERT INTO classes (code, name) VALUES (?, ?)').bind(code, name).run();
  return json({ ok: true, code });
}
async function teacherClassToggle({ env, body }) {
  await env.DB.prepare('UPDATE classes SET open = 1 - open WHERE code = ?').bind(String(body.code || '')).run();
  return json({ ok: true });
}
async function teacherClassDelete({ env, body }) {
  await env.DB.prepare('DELETE FROM classes WHERE code = ?').bind(String(body.code || '')).run();
  return json({ ok: true });
}

async function teacherStudentUpdate({ env, body }) {
  const id = Number(body.id);
  const u = await env.DB.prepare("SELECT id FROM users WHERE id = ? AND role = 'student'").bind(id).first();
  if (!u) return fail('Няма такъв ученик.');
  const stm = [];
  if (body.active !== undefined) {
    stm.push(env.DB.prepare('UPDATE users SET active = ? WHERE id = ?').bind(body.active ? 1 : 0, id));
    if (!body.active) stm.push(env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id));
  }
  if (body.class !== undefined) stm.push(env.DB.prepare('UPDATE users SET class = ? WHERE id = ?').bind(String(body.class).trim() || null, id));
  if (body.name !== undefined) {
    if (String(body.name).trim().length < 3) return fail('Името е твърде кратко.');
    stm.push(env.DB.prepare('UPDATE users SET name = ? WHERE id = ?').bind(String(body.name).trim(), id));
  }
  if (body.password) {
    if (body.password.length < 6) return fail('Паролата трябва да е поне 6 знака.');
    const salt = randomHex(16);
    stm.push(env.DB.prepare('UPDATE users SET pass = ?, salt = ? WHERE id = ?').bind(await hashPassword(body.password, salt), salt, id));
    stm.push(env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id));
  }
  if (stm.length) await env.DB.batch(stm);
  return json({ ok: true });
}

async function teacherStudentDelete({ env, body }) {
  const id = Number(body.id);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM attempts WHERE user_id = ?').bind(id),
    env.DB.prepare('DELETE FROM progress WHERE user_id = ?').bind(id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id),
    env.DB.prepare("DELETE FROM users WHERE id = ? AND role = 'student'").bind(id),
  ]);
  return json({ ok: true });
}

async function teacherResetProgress({ env, body }) {
  const id = Number(body.id);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM attempts WHERE user_id = ?').bind(id),
    env.DB.prepare('DELETE FROM progress WHERE user_id = ?').bind(id),
  ]);
  return json({ ok: true });
}

async function teacherSettings({ env, body }) {
  const stm = [];
  const put = (k, v) => stm.push(env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').bind(k, v));
  if (Array.isArray(body.closed)) put('closed', JSON.stringify(body.closed.filter((x) => LESSONS.some((l) => l.id === x))));
  if (body.leaderboard !== undefined) put('leaderboard', body.leaderboard ? '1' : '0');
  if (body.showExpected !== undefined) put('showExpected', body.showExpected ? '1' : '0');
  if (stm.length) await env.DB.batch(stm);
  return json({ ok: true, settings: await getSettings(env) });
}

// =====================================================================
const ROUTES = {
  'GET status': [status, 'public'],
  'POST setup': [setup, 'public'],
  'POST register': [register, 'public'],
  'POST login': [login, 'public'],
  'POST logout': [logout, 'public'],
  'GET me': [me, 'user'],
  'POST check': [check, 'user'],
  'POST read': [markRead, 'user'],
  'POST hint': [hint, 'user'],
  'GET leaderboard': [leaderboard, 'user'],
  'POST password': [changePassword, 'user'],
  'GET t/overview': [teacherOverview, 'teacher'],
  'GET t/activity': [teacherActivity, 'teacher'],
  'POST t/class': [teacherClassCreate, 'teacher'],
  'POST t/student/create': [teacherStudentCreate, 'teacher'],
  'GET t/teachers': [teacherList, 'teacher'],
  'POST t/teacher/create': [teacherCreate, 'teacher'],
  'POST t/teacher/delete': [teacherDelete, 'teacher'],
  'POST t/class/toggle': [teacherClassToggle, 'teacher'],
  'POST t/class/delete': [teacherClassDelete, 'teacher'],
  'POST t/student/update': [teacherStudentUpdate, 'teacher'],
  'POST t/student/delete': [teacherStudentDelete, 'teacher'],
  'POST t/student/reset': [teacherResetProgress, 'teacher'],
  'POST t/settings': [teacherSettings, 'teacher'],
};
