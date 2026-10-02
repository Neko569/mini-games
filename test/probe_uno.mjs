const W = 'ws://127.0.0.1:8787/ws/';
const { code } = await fetch('http://127.0.0.1:8787/api/new-room?game=uno').then(r => r.json());
const mk = (gid, name) => {
  const ws = new WebSocket(W + 'uno/' + code + '?gid=' + gid + '&name=' + name);
  const st = { msgs: [] };
  st.ws = ws;
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); st.msgs.push(JSON.stringify(m).slice(0, 80)); };
  ws.onopen = () => ws.send(JSON.stringify({ t: 'join' }));
  return st;
};
const a = mk('g1', 'A'), b = mk('g2', 'B');
await new Promise(r => setTimeout(r, 500));
a.ws.send(JSON.stringify({ t: 'start' }));
await new Promise(r => setTimeout(r, 700));
console.log('A msgs:', a.msgs.join(' | '));
console.log('B msgs:', b.msgs.slice(0, 6).join(' | '));
process.exit(0);
