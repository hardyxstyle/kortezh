// Общи помощни функции за сървъра (Cloudflare Pages Functions + D1).
import initSqlJs from './sql-wasm.js';
import wasmModule from './sql-wasm.wasm';
import { createDb, openDb } from './engine.js';
import { DB_SEEDS } from './content.js';

// ---------- отговори ----------
export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
export const fail = (message, status = 400) => json({ error: message }, status);

// ---------- схема на D1 ----------
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL, class TEXT, role TEXT NOT NULL DEFAULT 'student', pass TEXT NOT NULL, salt TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')), last_seen TEXT)`,
  `CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS classes (code TEXT PRIMARY KEY, name TEXT NOT NULL, open INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, task_id TEXT NOT NULL, answer TEXT, ok INTEGER NOT NULL, message TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE INDEX IF NOT EXISTS idx_attempts_user ON attempts(user_id, id)`,
  `CREATE INDEX IF NOT EXISTS idx_attempts_time ON attempts(id)`,
  `CREATE TABLE IF NOT EXISTS progress (user_id INTEGER NOT NULL, task_id TEXT NOT NULL, solved INTEGER NOT NULL DEFAULT 0, tries INTEGER NOT NULL DEFAULT 0, last_answer TEXT, solved_answer TEXT, first_solved_at TEXT, updated_at TEXT, PRIMARY KEY (user_id, task_id))`,
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`,
];
let schemaReady = null;
export function ensureSchema(env) {
  if (!env.DB) throw new Error('NO_DB');
  if (!schemaReady) schemaReady = env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s))).catch((e) => { schemaReady = null; throw e; });
  return schemaReady;
}

// ---------- пароли и сесии ----------
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
export const randomHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));
export async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 20000 }, key, 256);
  return hex(bits);
}
export function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const SESSION_DAYS = 30;
export async function createSession(env, userId) {
  const token = randomHex(32);
  const expires = Date.now() + SESSION_DAYS * 864e5;
  await env.DB.prepare('INSERT INTO sessions (token, user_id, expires) VALUES (?, ?, ?)').bind(token, userId, expires).run();
  // почистване на изтекли сесии от време на време
  if (Math.random() < 0.05) await env.DB.prepare('DELETE FROM sessions WHERE expires < ?').bind(Date.now()).run();
  return `kz=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}
export const clearCookie = 'kz=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
export function getToken(request) {
  const c = request.headers.get('cookie') || '';
  const m = c.match(/(?:^|;\s*)kz=([a-f0-9]{64})/);
  return m ? m[1] : null;
}
export async function currentUser(env, request) {
  const token = getToken(request);
  if (!token) return null;
  const u = await env.DB.prepare('SELECT u.id, u.username, u.name, u.class, u.role, u.active FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires > ?').bind(token, Date.now()).first();
  if (!u || !u.active) return null;
  u.token = token;
  return u;
}

// ---------- настройки ----------
export async function getSettings(env) {
  const rows = (await env.DB.prepare('SELECT key, value FROM settings').all()).results;
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    closed: s.closed ? JSON.parse(s.closed) : [],
    leaderboard: s.leaderboard !== '0',
    showExpected: s.showExpected !== '0',
  };
}

// ---------- SQL машина (sql.js в Worker) ----------
let sqlPromise = null;
function getSQL() {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({
      instantiateWasm(imports, done) {
        WebAssembly.instantiate(wasmModule, imports).then((inst) => done(inst, wasmModule));
        return {};
      },
    }).catch((e) => { sqlPromise = null; throw e; });
  }
  return sqlPromise;
}
const snapshots = {};
export async function dbFactory(dbName) {
  const SQL = await getSQL();
  if (!snapshots[dbName]) {
    const d = DB_SEEDS[dbName];
    const a = createDb(SQL, d.seed);
    const b = createDb(SQL, d.seed, d.variant || null);
    snapshots[dbName] = [a.export(), b.export()];
    a.close(); b.close();
  }
  const [base, variant] = snapshots[dbName];
  return (useVariant) => openDb(SQL, useVariant ? variant : base);
}

export async function readJson(request) {
  try { return await request.json(); } catch { return {}; }
}
