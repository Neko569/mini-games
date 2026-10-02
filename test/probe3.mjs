const W = 'ws://127.0.0.1:8787/ws/';
const SHAPE = [[0,0],[0,1],[-2,2],[-1,2],[0,2],[1,2],[2,2],[-1,3],[0,3],[1,3],[0,4]];
const GW = 10;
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
const { code } = await fetch('http://127.0.0.1:8787/api/new-room?game=planes').then(r => r.json());
const mk = (gid, name) => {
  const ws = new WebSocket(W + 'planes/' + code + '?gid=' + gid + '&name=' + name);
  const st = { msgs: [] };
  st.ws = ws;
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); st.msgs.push(m); };
  ws.onopen = () => ws.send(JSON.stringify({ t: 'join' }));
  return st;
};
const a = mk('p1', 'A'), b = mk('p2', 'B');
await new Promise(r => setTimeout(r, 500));
a.ws.send(JSON.stringify({ t: 'start' }));
await new Promise(r => setTimeout(r, 300));
// 布一个已知布局
const sol = [{ x: 0, y: 2, rot: 0 }, { x: 5, y: 5, rot: 0 }, { x: 8, y: 8, rot: 0 }];
console.log('local cells of plane1:', planeCells(0, 2, 0));
a.ws.send(JSON.stringify({ t: 'place', planes: sol }));
await new Promise(r => setTimeout(r, 300));
b.ws.send(JSON.stringify({ t: 'place', planes: sol }));
await new Promise(r => setTimeout(r, 500));
// a 打 b 的机头 (0,2)
a.ws.send(JSON.stringify({ t: 'strike', x: 0, y: 2 }));
await new Promise(r => setTimeout(r, 500));
for (const m of a.msgs) console.log('A<-', JSON.stringify(m).slice(0, 110));
process.exit(0);
