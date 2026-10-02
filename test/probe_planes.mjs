const W = 'ws://127.0.0.1:8787/ws/';
const { code } = await fetch('http://127.0.0.1:8787/api/new-room?game=planes').then(r => r.json());
const ws = new WebSocket(W + 'planes/' + code + '?gid=g1&name=A');
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); console.log('MSG:', JSON.stringify(m).slice(0, 120)); };
ws.onopen = () => ws.send(JSON.stringify({ t: 'join' }));
await new Promise(r => setTimeout(r, 600));
process.exit(0);
