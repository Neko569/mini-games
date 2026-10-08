// 大厅上报 stub —— 签名与 CF 版 lobby.js 相同，转发到 env.LOBBY shim（server.js 提供）
function snapshotRoom(game, max, room) {
  const seats = (room.seats || []).filter(Boolean);
  const host = (seats.find(s => s.connected !== false) || seats[0] || {}).name || '房主';
  return {
    game, code: room.code, max,
    players: seats.filter(s => s.connected !== false).length,
    seated: seats.length,
    started: room.started === true,
    over: room.started === 'over',
    host, ts: Date.now(),
  };
}

export async function reportLobby(env, game, max, room) {
  try {
    if (!env || !env.LOBBY || !room || !room.code) return;
    await env.LOBBY.get(env.LOBBY.idFromName('global')).fetch('https://lobby/report', {
      method: 'POST', body: JSON.stringify(snapshotRoom(game, max, room)),
    });
  } catch {}
}
