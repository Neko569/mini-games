/* 炸飞机 E2E */
const W = 'ws://127.0.0.1:8787/ws/';
/* 本地求解合法布阵（与服务端 planes.js 同款规则） */
const SHAPE = [[0,0],[0,1],[-2,2],[-1,2],[0,2],[1,2],[2,2],[-1,3],[0,3],[1,3],[0,4]];
const GW = 10;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function planeCells(x, y, rot) {
  const out = [];
  for (const [dx, dy] of SHAPE) {
    let rx = dx, ry = dy;
    for (let r = 0; r < rot; r++) { const t = rx; rx = -ry; ry = t; }
    const cx = x + rx, cy = y + ry;
    if (cx < 0 || cx >= GW || cy < 0 || cy >= GW) return null;
    out.push(cy * GW + cx);
  }
  return out;
}
function solvePlacements() {
  const combos = [];
  for (let x = 0; x < GW; x++) for (let y = 0; y < GW; y++) for (let r = 0; r < 4; r++) {
    const cells = planeCells(x, y, r);
    if (cells) combos.push({ x, y, rot: r, cells });
  }
  for (let i = 0; i < combos.length; i++) for (let j = 0; j < combos.length; j++) for (let k = 0; k < combos.length; k++) {
    const all = new Set([...combos[i].cells, ...combos[j].cells, ...combos[k].cells]);
    if (all.size === 33) {
      const pick = (p) => ({ x: p.x, y: p.y, rot: p.rot });
      return [pick(combos[i]), pick(combos[j]), pick(combos[k])];
    }
  }
  throw new Error('no solution');
}
function client(gid, name, room) {
  const ws = new WebSocket(W + 'planes/' + room + '?gid=' + gid + '&name=' + encodeURIComponent(name));
  const st = { seat: -2, phase: null, turn: 0, strikes: [[], []], errors: [], ws };
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    try {
      if (m.t === 'welcome') st.seat = m.you.seat;
      if (m.t === 'placed') { st.phase = m.phase; st.ready = m.ready; }
      if (m.t === 'start') st.phase = 'placing';
      if (m.t === 'strike') {
        st.strikes[m.by].push({ x: m.x, y: m.y, res: m.res });
        st.turn = m.nextTurn; st.phase = m.phase;
      }
      if (m.t === 'finished') st.winner = m.winner;
      if (m.t === 'error') { st.errors.push(m.msg); console.log('  [ERR]', gid, m.msg); }
    } catch (e) { console.log('HANDLER-CRASH', gid, e.message); }
  };
  ws.onopen = () => ws.send(JSON.stringify({ t: 'join' }));
  return st;
}

{
  const { code } = await fetch('http://127.0.0.1:8787/api/new-room?game=planes').then(r => r.json());
  console.log('PLANES room:', code);
  const a = client('pa', '甲', code);
  const b = client('pb', '乙', code);
  for (let i = 0; i < 50 && (a.seat < 0 || b.seat < 0); i++) await sleep(100);
  console.log('seats:', a.seat, b.seat);
  a.ws.send(JSON.stringify({ t: 'start' }));
  await sleep(600);
  console.log('phase:', a.phase);
  var sol = solvePlacements();
  a.ws.send(JSON.stringify({ t: 'place', planes: sol }));
  await sleep(400);
  b.ws.send(JSON.stringify({ t: 'place', planes: sol }));
  await sleep(600);
  console.log('phase after place:', a.phase, '| sol:', JSON.stringify(sol));

  const heads = sol.map(p => ({ x: p.x, y: p.y })); // b 与 a 同布局（测试已知）
  let s2 = 0, downs = 0;
  while (!a.winner && s2++ < 300) {
    await sleep(70);
    if (a.phase !== 'fighting') continue;
    if (a.turn === 0) {
      const tried = new Set(a.strikes[0].map(s => s.x + ',' + s.y));
      const target = heads.find(h => !tried.has(h.x + ',' + h.y));
      if (target) { downs++; a.ws.send(JSON.stringify({ t: 'strike', x: target.x, y: target.y })); }
      else a.ws.send(JSON.stringify({ t: 'strike', x: s2 % 10, y: (s2 * 3) % 10 }));
    } else {
      b.ws.send(JSON.stringify({ t: 'strike', x: (s2 * 7) % 10, y: (s2 * 5) % 10 }));
    }
  }
  console.log('PLANES winner:', a.winner, '| 机头命中:', downs, '| 全部a打击:', JSON.stringify(a.strikes[0]));
  console.log('a战果:', JSON.stringify(a.strikes[0].filter(s => s.res !== 'miss')));
  console.log('a.err:', a.errors.length, '| b.err:', b.errors.length);
  if (a.winner !== 0) process.exit(1);
  console.log('PLANES-E2E-PASS');
}
process.exit(0);
