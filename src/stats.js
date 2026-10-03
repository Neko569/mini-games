// StatsDO: 全局战绩单例（SQLite）
const GAMES = ['fxq', 'gobang', 'uno', 'planes', 'davinci', 'kittens'];

export class StatsDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(req) {
    const sql = this.state.storage.sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game TEXT NOT NULL, gid TEXT NOT NULL, name TEXT NOT NULL,
      win INTEGER NOT NULL, ts INTEGER NOT NULL)`);
    const url = new URL(req.url);

    if (req.method === 'POST' && url.pathname === '/record') {
      try {
        const { game, results } = await req.json();
        if (!GAMES.includes(game) || !Array.isArray(results)) return Response.json({ ok: false }, { status: 400 });
        for (const r of results) {
          if (!r || !r.gid || !r.name) continue;
          sql.exec(`INSERT INTO results (game, gid, name, win, ts) VALUES (?, ?, ?, ?, ?)`,
            game, String(r.gid).slice(0, 64), String(r.name).slice(0, 32), r.win ? 1 : 0, Date.now());
        }
        return Response.json({ ok: true });
      } catch (e) {
        return Response.json({ ok: false, msg: e.message }, { status: 400 });
      }
    }

    if (url.pathname === '/query') {
      const game = url.searchParams.get('game');
      const gid = url.searchParams.get('gid');
      if (gid) {
        const rows = sql.exec(
          `SELECT game, SUM(win) AS w, COUNT(*) AS n FROM results WHERE gid = ? GROUP BY game`, String(gid)).toArray();
        return Response.json({ mine: rows });
      }
      const rows = sql.exec(
        `SELECT game, gid, name, SUM(win) AS w, COUNT(*) AS n
         FROM results GROUP BY game, gid ORDER BY game, w DESC, n ASC LIMIT 300`).toArray();
      return Response.json({ top: rows });
    }

    return new Response('not found', { status: 404 });
  }
}
