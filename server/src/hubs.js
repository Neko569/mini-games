// 全局单例：大厅注册中心 + 战绩库（进程内 + JSON 落盘，重启恢复）
import fs from 'node:fs';

// ---------- 大厅 ----------
const lobbyTTL = 30 * 60 * 1000;   // 30 分钟无更新过期
const lobbyCap = 100;              // 容量上限（LRU 淘汰最旧）

export const lobbyHub = {
  rooms: new Map(),

  report(e) {
    if (!e || !e.game || !e.code) return { ok: false };
    const key = `${e.game}:${e.code}`;
    if (e.over || e.players === 0) this.rooms.delete(key);
    else {
      if (!this.rooms.has(key) && this.rooms.size >= lobbyCap) {
        let oldestK = null, oldestT = Infinity;
        for (const [k, v] of this.rooms) if ((v.ts || 0) < oldestT) { oldestT = v.ts || 0; oldestK = k; }
        if (oldestK) this.rooms.delete(oldestK);
      }
      this.rooms.set(key, e);
    }
    return { ok: true };
  },

  list() {
    const now = Date.now();
    const out = [];
    for (const [k, v] of this.rooms) {
      if (now - (v.ts || 0) > lobbyTTL) this.rooms.delete(k);
      else out.push(v);
    }
    out.sort((a, b) => b.ts - a.ts);
    return out.slice(0, 60);
  },

  sweep() {
    const now = Date.now();
    for (const [k, v] of this.rooms) if (now - (v.ts || 0) > lobbyTTL) this.rooms.delete(k);
  },
};

// ---------- 战绩 ----------
const statsFile = new URL('./stats.json', import.meta.url).pathname;
let statsRows = [];
try { statsRows = JSON.parse(fs.readFileSync(statsFile, 'utf8')); } catch {}
let statsDirty = false;
function writeStats() {
  try { fs.writeFileSync(statsFile, JSON.stringify(statsRows)); } catch {}
}
setInterval(() => {
  if (!statsDirty) return;
  statsDirty = false;
  writeStats();
}, 3000).unref();
// 停机前立即落盘（供 server.js 优雅停机调用）
export function flushStats() { if (statsDirty) { statsDirty = false; writeStats(); } }

export const statsHub = {
  record(body) {
    try {
      const { game, results } = body;
      if (!GAMES.includes(game) || !Array.isArray(results)) return { ok: false };
      for (const r of results) {
        if (!r || !r.gid || !r.name) continue;
        statsRows.push({ game, gid: String(r.gid).slice(0, 64), name: String(r.name).slice(0, 32), win: r.win ? 1 : 0, ts: Date.now() });
      }
      if (statsRows.length > 50000) statsRows = statsRows.slice(-40000); // 防无限膨胀
      statsDirty = true;
      return { ok: true };
    } catch (e) { return { ok: false, msg: e.message }; }
  },

  query(url) {
    const gid = url.searchParams.get('gid');
    if (gid) {
      const agg = new Map();
      for (const r of statsRows) if (r.gid === gid) {
        const cur = agg.get(r.game) || { game: r.game, w: 0, n: 0 };
        cur.w += r.win; cur.n += 1; agg.set(r.game, cur);
      }
      return { mine: [...agg.values()] };
    }
    const game = url.searchParams.get('game');
    const agg = new Map();
    for (const r of statsRows) {
      if (game && r.game !== game) continue;
      const key = r.game + ':' + r.gid;
      const cur = agg.get(key) || { game: r.game, name: r.name, w: 0, n: 0 };
      cur.w += r.win; cur.n += 1; agg.set(key, cur);
    }
    const top = [...agg.values()].sort((a, b) => a.game.localeCompare(b.game) || b.w - a.w || a.n - b.n).slice(0, 300);
    return { top };
  },
};

export const GAMES = ['fxq', 'gobang', 'uno', 'planes', 'davinci', 'kittens', 'reversi'];

// 过期清理定时器
setInterval(() => lobbyHub.sweep(), 5 * 60 * 1000).unref();
