const W = 'ws://127.0.0.1:8787/ws/';
const { code } = await fetch('http://127.0.0.1:8787/api/new-room?game=uno').then(r => r.json());
const mk = (gid, name) => {
  const ws = new WebSocket(W + 'uno/' + code + '?gid=' + gid + '&name=' + name);
  const st = { hand: null, pub: null, seat: -2, log: [] };
  st.ws = ws;
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    st.log.push(m.t);
    if (m.t === 'welcome') st.seat = m.you.seat;
    if (m.t === 'hand') st.hand = m.cards;
    if (m.t === 'state') st.pub = m.pub;
    if (m.t === 'error') st.log.push('ERR:' + m.msg);
  };
  ws.onopen = () => ws.send(JSON.stringify({ t: 'join' }));
  return st;
};
const a = mk('g1', 'A'), b = mk('g2', 'B');
await new Promise(r => setTimeout(r, 500));
a.ws.send(JSON.stringify({ t: 'start' }));
await new Promise(r => setTimeout(r, 500));
console.log('top:', JSON.stringify(a.pub.top), 'color:', a.pub.color, 'turn:', a.pub.turn);
// 找 a 手牌中可出的第一张
const i = a.hand.findIndex(c => c.c === a.pub.color || c.c === 'W' || c.v === a.pub.top.v);
console.log('playable idx:', i, JSON.stringify(a.hand[i]));
a.ws.send(JSON.stringify({ t: 'play', idx: i, color: 'R' }));
await new Promise(r => setTimeout(r, 500));
console.log('after play: pub =', JSON.stringify(a.pub), '| a.log:', a.log.join(','), '| b.hand:', b.hand.length);
process.exit(0);
