// 战绩上报 stub —— 签名与 CF 版 stats-report.js 相同，转发到 env.STATS shim
export async function reportResult(env, game, seats, winners) {
  try {
    if (!env || !env.STATS || winners === null || winners === undefined) return;
    if (!Array.isArray(winners) || !winners.length) return;
    const results = (seats || []).map((s, i) => s ? { gid: s.gid, name: s.name, win: winners.includes(i) } : null).filter(Boolean);
    if (results.length < 2) return;
    await env.STATS.get(env.STATS.idFromName('global')).fetch('https://stats/record', {
      method: 'POST', body: JSON.stringify({ game, results }),
    });
  } catch {}
}
