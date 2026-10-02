const W = 'ws://127.0.0.1:8787/ws/';
function client(gid, name, game, room) {
  const ws = new WebSocket(W + game + '/' + room + '?gid=' + gid + '&name=' + encodeURIComponent(name));
  const st = { seat: -2, msgs: [], hand: null, pub: null, busy: false, ws, phase: null, turn: 0, strikes: [[], []], downs: [] };
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.t === 'welcome') { st.seat = m.you.seat; st.busy = false; }
    if (m.t === 'hand') { st.hand = m.cards; st.busy = false; }
    if (m.t === 'state') { st.pub = m.pub; st.busy = false; }
    if (m.t === 'error') { st.busy = false; console.log('  [ERR]', gid, m.msg); }
    if (m.t === 'placed') { st.phase = m.phase; st.busy = false; }
    if (m.t === 'strike') {
      st.strikes[m.by].push({ x: m.x, y: m.y, res: m.res });
      st.turn = m.nextTurn; st.phase = m.phase; st.busy = false;
      if (m.by === st.seat) st.lastRes = m.res;
      if (m.res === 'down') st.downs.push({ by: m.by, x: m.x, y: m.y });
    }
    if (m.t === 'finished') st.winner = m.winner;
  };
  ws.onopen = () => ws.send(JSON.stringify({ t: 'join' }));
  return st;
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ===== UNO ===== */
{
  const { code } = await fetch('http://127.0.0.1:8787/api/new-room?game=uno').then(r => r.json());
  console.log('UNO room:', code);
  const a = client('ua', '阿红', 'uno', code);
  const b = client('ub', '阿蓝', 'uno', code);
  for (let i = 0; i < 50 && (a.seat < 0 || b.seat < 0); i++) await sleep(100);
  a.ws.send(JSON.stringify({ t: 'start' }));
  for (let i = 0; i < 20 && !a.pub; i++) await sleep(100);
  console.log('hands:', a.hand.length, b.hand.length, '| top:', JSON.stringify(a.pub.top));

  let safety = 0, winner = null;
  while (winner === null && safety++ < 800) {
    await sleep(60);
    if (safety % 100 === 0) console.log('  t' + safety, 'a.seat=' + a.seat, 'turn=' + a.pub.turn, 'pd=' + a.pub.pendingDraw, 'busy=' + a.busy + b.busy, 'hands=' + a.hand.length + '/' + b.hand.length, 'msgs=' + a.msgs.length + '/' + b.msgs.length, 'top=' + a.pub.top.c + a.pub.top.v);
    if (!a.pub || !b.pub) continue;
    if (a.pub.winner !== null) { winner = a.pub.winner; break; }
    for (const st of [a, b]) {
      if (st.busy || !st.pub || st.pub.winner !== null) continue;
      if (st.pub.turn !== st.seat) continue;
      if (st.pub.pendingDraw > 0) { st.busy = true; st.ws.send(JSON.stringify({ t: 'draw' })); continue; }
      const playable = st.hand.findIndex(c => c.c === st.pub.color || c.v === st.pub.top.v || c.c === 'W');
      st.busy = true;
      if (playable >= 0) st.ws.send(JSON.stringify({ t: 'play', idx: playable, color: 'R' }));
      else st.ws.send(JSON.stringify({ t: 'draw' }));
    }
  }
  console.log('UNO winner:', winner, '| safety hit:', safety >= 800, '| a手数:', a.hand.length, '| b手数:', b.hand.length);
  if (winner === null) process.exit(1);
  console.log('UNO PASS');
}

/* ===== PLANES ===== */
{
  const { code } = await fetch('http://127.0.0.1:8787/api/new-room?game=planes').then(r => r.json());
  console.log('PLANES room:', code);
  const pa = client('pa', '机长', 'planes', code);
  const pb = client('pb', '塔台', 'planes', code);
  for (let i = 0; i < 50 && (pa.seat < 0 || pb.seat < 0); i++) await sleep(100);
  pa.ws.send(JSON.stringify({ t: 'start' }));
  for (let i = 0; i < 20 && pa.phase !== 'placing'; i++) await sleep(100);
  pa.ws.send(JSON.stringify({ t: 'place', planes: [{ x: 2, y: 0, rot: 0 }, { x: 5, y: 2, rot: 0 }, { x: 8, y: 0, rot: 0 }] }));
  pb.ws.send(JSON.stringify({ t: 'place', planes: [{ x: 2, y: 0, rot: 0 }, { x: 5, y: 2, rot: 0 }, { x: 8, y: 0, rot: 0 }] }));
  for (let i = 0; i < 20 && pa.phase !== 'fighting'; i++) await sleep(100);
  console.log('phase:', pa.phase);
  const heads = [{ x: 2, y: 0 }, { x: 5, y: 2 }, { x: 8, y: 0 }];
  let s2 = 0, downs = 0;
  while (pa.winner === null && s2++ < 300) {
    await sleep(70);
    if (pa.phase !== 'fighting' && pa.winner === null) continue;
    if (pa.winner !== null) break;
    if (pa.turn === 0 && !pa.busy) {
      const tried = new Set(pa.strikes[0].map(s => s.x + ',' + s.y));
      const target = heads.find(h => !tried.has(h.x + ',' + h.y));
      pa.busy = true;
      if (target) { downs++; pa.ws.send(JSON.stringify({ t: 'strike', x: target.x, y: target.y })); }
      else pa.ws.send(JSON.stringify({ t: 'strike', x: s2 % 10, y: (s2 * 3) % 10 }));
    } else if (pa.turn === 1 && !pb.busy) {
      pb.busy = true;
      pb.ws.send(JSON.stringify({ t: 'strike', x: (s2 * 7) % 10, y: (s2 * 5) % 10 }));
    }
  }
  console.log('PLANES winner:', pa.winner, '| 机头命中:', downs, '| a战果:', JSON.stringify(pa.strikes[0].filter(s => s.res !== 'miss')));
  if (pa.winner !== 0) process.exit(1);
  console.log('ALL-E2E-PASS');
  process.exit(0);
}
