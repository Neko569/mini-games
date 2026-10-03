// 战绩上报：房间 DO 终局时调用；stats DO 单例落 sqlite
export async function reportResult(env, game, seats, winners) {
  if (!env || !env.STATS || winners === null || winners === undefined) return;
  if (!Array.isArray(winners) || winners.length === 0) return; // 平局/未定不记
  try {
    const results = (seats || [])
      .map((s, i) => s ? { gid: s.gid, name: s.name, win: winners.includes(i) } : null)
      .filter(Boolean);
    if (results.length < 2) return; // 单人不记
    await env.STATS.get(env.STATS.idFromName('global')).fetch('https://stats/record', {
      method: 'POST',
      body: JSON.stringify({ game, results }),
    });
  } catch { /* 统计失败不影响对局 */ }
}
