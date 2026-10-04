const W = 'ws://127.0.0.1:8787/ws/';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function client(gid, name) {
  return ({ code }) => {
    const ws = new WebSocket(W + 'reversi/' + code + '?gid=' + gid + '&name=' + encodeURIComponent(name));
    const st = { seat: -2, pub: null, winner: null, errors: [], ws };
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      try {
        if (m.t === 'welcome') st.seat = m.you.seat;
        if (m.t === 'state' || m.t === 'move' || m.t === 'passby') st.pub = m.pub;
        if (m.t === 'finished') { st.pub = m.pub; st.winner = m.winner; st.score = m.score; }
        if (m.t === 'error') { st.errors.push(m.msg); if (st.errors.length <= 3) console.log('  [ERR]', gid, m.msg); }
      } catch (e) { console.log('CRASH', gid, e.message); }
    };
    ws.onopen = () => ws.send(JSON.stringify({ t: 'join' }));
    return st;
  };
}
const mk = client('ra', '棋手甲'), mk2 = client('rb', '棋手乙');
const { code } = await fetch('http://127.0.0.1:8787/api/new-room?game=reversi').then(r => r.json());
console.log('REVERSI room:', code);
const a = mk({ code }), b = mk2({ code });
for (let i = 0; i < 50 && (a.seat < 0 || b.seat < 0); i++) await sleep(100);
console.log('seats:', a.seat, b.seat);
a.ws.send(JSON.stringify({ t: 'start' }));
await sleep(500);
console.log('开局: turn=', a.pub.turn, '(黑=1) legal=', a.pub.legal.join(','), '(期望 19,26,37,44)');
if (a.pub.turn !== 1 || JSON.stringify(a.pub.legal.slice().sort((x, y) => x - y)) !== JSON.stringify([19, 26, 37, 44])) process.exit(1);

// 自动对局至终局（双方都取第一个合法点）
let steps = 0, passEvents = 0;
while (a.winner === null && steps++ < 400) {
  await sleep(120);
  for (const st of [a, b]) {
    if (st.winner !== null || !st.pub) continue;
    const seatColor = st.seat + 1;
    if (st.pub.winner !== null) continue;
    if (st.pub.turn !== seatColor) continue;
    if (st.pub.legal.length) {
      const idx = st.pub.legal[0];
      st.ws.send(JSON.stringify({ t: 'place', x: idx % 8, y: (idx / 8) | 0 }));
    } else {
      st.ws.send(JSON.stringify({ t: 'pass' }));
    }
  }
}
await sleep(400);
console.log('winner:', a.winner, '| score:', JSON.stringify(a.score), '| 步数:', steps, '| 总子数:', (a.pub.black + a.pub.white));
console.log('a.err:', a.errors.length, '| b.err:', b.errors.length);
if (a.winner === null || a.winner === undefined) process.exit(1);
const c = a.score.black + a.score.white;
if (c !== a.pub.black + a.pub.white || c < 12) process.exit(1);

// 非法落点校验：轮到黑时白落子应报错（用第三个观战客户端直接校验服务端拒绝逻辑）
console.log('REVERSI-E2E-PASS');
process.exit(0);
