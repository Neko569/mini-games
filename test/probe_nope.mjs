const W = 'ws://127.0.0.1:8787/ws/';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function client(gid, room) {
  const ws = new WebSocket(W + 'kittens/' + room + '?gid=' + gid + '&name=' + gid);
  const st = { seat: -2, hand: null, pub: null, errors: [], ws };
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data);
    if (m.t === 'welcome') st.seat = m.you.seat;
    if (m.t === 'hand') st.hand = m.cards;
    if (m.t === 'state') st.pub = m.pub;
    if (m.t === 'error') st.errors.push(m.msg);
  };
  ws.onopen = () => ws.send(JSON.stringify({ t: 'join' }));
  return st;
}
const { code } = await fetch('http://127.0.0.1:8787/api/new-room?game=kittens').then(r => r.json());
const a = client('na', code), b = client('nb', code);
for (let i = 0; i < 50 && (a.seat < 0 || b.seat < 0); i++) await sleep(100);
a.ws.send(JSON.stringify({ t: 'start' }));
await sleep(600);
// a 找一张动作牌出掉，b 立即 nope
const act = a.hand.find(c => ['skip','attack','favor','shuffle','seefuture'].includes(c.kind));
if (!act) { console.log('a 无动作牌，PASS-SKIP'); process.exit(0); }
a.ws.send(JSON.stringify({ t: 'play', uid: act.uid, target: 1 }));
await sleep(400);
const before = a.pub.pending;
const bNope = b.hand.find(c => c.kind === 'nope');
if (!bNope) { console.log('b 无 nope，窗口将超时结算（等 3.4s）'); await sleep(3400); console.log('pending after timeout:', a.pub.pending); process.exit(0); }
b.ws.send(JSON.stringify({ t: 'nope', uid: bNope.uid }));
await sleep(400);
console.log('nope前 pending:', before?.type, '| nope后 pending:', a.pub.pending, '| a手牌:', a.hand.length, '(应不变，动作被否决)');
console.log('NOPE-' + (a.pub.pending === null ? 'PASS' : 'FAIL'));
process.exit(0);
