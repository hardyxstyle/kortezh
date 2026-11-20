// Наблюдение за злоупотреби: от кой адрес (IP) и от кой профил идват подозрително много заявки.
// Записва в D1 само когато има превишаване (и най-много веднъж в минута), за да не харчи лимита.
const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const WIN = 5 * 60e3;
// заявки за 5 минути: без вход — от един IP; с вход — от един профил
const LIMIT = { anon: 120, user: 150 };

export const ipOf = (request) => request.headers.get('cf-connecting-ip') || 'local';
export const uaOf = (request) => String(request.headers.get('user-agent') || '').slice(0, 200);

const run = (ctx, p) => { const q = p.catch(() => {}); if (ctx && ctx.waitUntil) ctx.waitUntil(q); };

// Кой профил от кой IP е влизал (записва се най-много веднъж на час за двойка профил + IP).
const seen = new Map();
export function noteUserIp(ctx, env, userId, ip, ua) {
  const k = userId + '|' + ip;
  const t = Date.now();
  if (t - (seen.get(k) || 0) < 3600e3) return;
  if (seen.size > 5000) seen.clear();
  seen.set(k, t);
  const n = stamp();
  run(ctx, env.DB.prepare(`INSERT INTO user_ips (user_id, ip, ua, first_at, last_at, hits) VALUES (?, ?, ?, ?, ?, 1)
    ON CONFLICT (user_id, ip) DO UPDATE SET ua = excluded.ua, last_at = excluded.last_at, hits = hits + 1`).bind(userId, ip, ua, n, n).run());
}

// Натрупва събития и ги записва най-много веднъж в минута.
const pend = new Map();
export function bump(ctx, env, ev, add = 1) {
  const k = ev.kind + '|' + ev.ip + '|' + (ev.userId || 0);
  let p = pend.get(k);
  if (!p) {
    if (pend.size > 5000) pend.clear();
    p = { hits: 0, last: 0 };
    pend.set(k, p);
  }
  p.hits += add;
  const t = Date.now();
  if (t - p.last < 60e3) return;
  p.last = t;
  const hits = p.hits;
  p.hits = 0;
  const n = stamp();
  run(ctx, env.DB.prepare(`INSERT INTO security_events (ip, kind, day, user_id, hits, first_at, last_at, ua, sample) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (ip, kind, day, user_id) DO UPDATE SET hits = hits + excluded.hits, last_at = excluded.last_at, ua = excluded.ua, sample = COALESCE(excluded.sample, sample)`)
    .bind(ev.ip, ev.kind, n.slice(0, 10), ev.userId || 0, hits, n, n, ev.ua || null, ev.sample || null).run());
  if (Math.random() < 0.05) {
    run(ctx, env.DB.batch([
      env.DB.prepare("DELETE FROM security_events WHERE day < date('now', '-90 days')"),
      env.DB.prepare("DELETE FROM user_ips WHERE last_at < datetime('now', '-120 days')"),
    ]));
  }
}

// Брои всяка заявка към /api/* по IP (без вход) или по профил (с вход).
const counters = new Map();
export function watch(ctx, env, { ip, ua, user, path }) {
  const kind = user ? 'user' : 'anon';
  const key = kind + ':' + (user ? user.id : ip);
  const t = Date.now();
  let c = counters.get(key);
  if (!c || t - c.start > WIN) {
    if (counters.size > 5000) counters.clear();
    c = { start: t, n: 0 };
    counters.set(key, c);
  }
  c.n++;
  const lim = LIMIT[kind];
  if (c.n <= lim) return;
  bump(ctx, env, { kind, ip, ua, userId: user ? user.id : 0, sample: path }, c.n === lim + 1 ? c.n : 1);
}
