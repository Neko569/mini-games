/* UNO 客户端 */
const $ = (s) => document.querySelector(s);
const CC = { R: '#e53935', Y: '#fdd835', G: '#43a047', B: '#1e88e5' };
const CN = { R: '红', Y: '黄', G: '绿', B: '蓝' };
const VTXT = { skip: '禁止', rev: '反转', d2: '+2', wild: '变色', wd4: '+4' };

const qs = new URLSearchParams(location.search);
const profile = JSON.parse(localStorage.getItem('fxq_profile') || '{}');
if (qs.get('name')) profile.name = qs.get('name');
if (!profile.gid) profile.gid = crypto.randomUUID();
profile.name = (profile.name || '').slice(0, 16) || '玩家';
localStorage.setItem('fxq_profile', JSON.stringify(profile));
const ROOM = (qs.get('room') || '').toLowerCase();

let ws = null, mySeat = -1, players = [], hand = [], pub = null, reconnectTry = 0;
let pendingWildIdx = null;

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws/uno/${ROOM}?gid=${encodeURIComponent(profile.gid)}&name=${encodeURIComponent(profile.name)}`);
  ws.onopen = () => { reconnectTry = 0; send({ t: 'join' }); };
  ws.onmessage = (ev) => { try { handle(JSON.parse(ev.data)); } catch (e) { console.error(e); } };
  ws.onclose = (ev) => {
    if (ev.code === 4000) { toast('账号在其他窗口连接', true); return; }
    if (reconnectTry < 12) { reconnectTry++; setTimeout(connect, Math.min(1000 * 2 ** (reconnectTry - 1), 15000)); }
  };
}
const send = (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };

function handle(m) {
  switch (m.t) {
    case 'welcome':
      mySeat = m.you.seat; players = m.room.players;
      enterGame(); renderPlayers();
      break;
    case 'start':
      players = m.room.players;
      $('#btn-start').classList.add('hidden');
      chatSys('对局开始！');
      break;
    case 'players': players = m.players; renderPlayers(); break;
    case 'state':
      pub = m.pub; renderTable(m.pub); renderPlayers();
      if (m.last && m.last.card) chatSys(`${esc(name(m.last.seat))} 打出 ${cardText(m.last.card)}${m.last.uno ? '（UNO!）' : ''}`);
      break;
    case 'hand': hand = m.cards; renderHand(); break;
    case 'drawn': chatSys(`你摸了 ${m.cards.length} 张`); break;
    case 'finished':
      pub = m.pub;
      showWin(name(m.winner));
      chatSys(`🏆 ${esc(name(m.winner))} 获胜！`);
      break;
    case 'chat': chatLine(m.name, m.text); break;
    case 'error': toast(m.msg, true); break;
  }
}
const name = (seat) => (players[seat] && players[seat].name) || `玩家${seat + 1}`;

function cardText(c) {
  if (c.c === 'W') return c.v === 'wd4' ? '万能+4' : '变色';
  return (CN[c.c] || '') + (VTXT[c.v] || c.v);
}
function cardBG(c) {
  return c.c === 'W' ? 'conic-gradient(#e53935 0 25%,#fdd835 0 50%,#43a047 0 75%,#1e88e5 0)' : CC[c.c];
}

function renderPlayers() {
  $('#players').innerHTML = (players || []).map((p, i) => p ? `
    <div class="pl ${i === pub?.turn ? 'active' : ''} ${p.connected ? '' : 'off'}">
      <b>${esc(p.name)}</b>${p.owner ? '<span>👑</span>' : ''}
      <span class="cnt">${pub ? pub.handCounts[i] + ' 张' : '—'}</span>
    </div>` : '').join('');
}
function renderTable(p) {
  if (!p) return;
  const top = p.top;
  const el = $('#top');
  el.textContent = top.c === 'W' ? (top.v === 'wd4' ? '+4' : '变') : (VTXT[top.v] || top.v);
  el.style.background = top.c === 'W' ? cardBG(top) : CC[p.color];
  $('#curcolor').textContent = CN[p.color] || '—';
  $('#curcolor').style.color = CC[p.color];
  $('#penalty').textContent = p.pendingDraw > 0 ? `罚牌 +${p.pendingDraw}！` : '';
  $('#dir').textContent = p.dir === 1 ? '↻ 顺时针' : '↺ 逆时针';
  const mine = p.turn === mySeat;
  const tb = $('#turn-banner');
  tb.textContent = p.winner !== null ? '对局结束' :
    (mine ? (p.pendingDraw > 0 ? '你被罚牌，点牌堆摸牌' : '轮到你出牌') : `等待 ${name(p.turn)} …`);
  tb.classList.toggle('mine', mine);
  $('#deck').style.visibility = mine ? 'visible' : 'hidden';
  renderHand(); renderPlayers();
}
function renderHand() {
  const p = pub;
  const mine = p && p.turn === mySeat && p.winner === null;
  $('#hand').innerHTML = hand.map((c, i) => {
    const playable = mine && p.pendingDraw === 0 &&
      (c.c === 'W' || c.c === p.color || c.v === p.top.v);
    return `<div class="ucard ${c.c === 'W' ? 'wild' : ''} ${mine && !playable ? 'dim' : ''} ${playable ? 'playable' : ''}"
      style="background:${cardBG(c)}" data-i="${i}">
      ${c.c === 'W' ? '<small>WILD</small>' : ''}<span>${VTXT[c.v] || c.v}</span>
      ${c.c !== 'W' ? `<small>${CN[c.c]}</small>` : ''}</div>`;
  }).join('') || '<div style="opacity:.5">手牌空了</div>';
  $('#hand').querySelectorAll('.ucard').forEach(el => {
    el.onclick = () => {
      const i = +el.dataset.i;
      const c = hand[i];
      if (c.c === 'W') { pendingWildIdx = i; $('#colorpick').classList.remove('hidden'); return; }
      tryPlay(i);
    };
  });
}
function tryPlay(i, color) {
  send({ t: 'play', idx: i, color });
  $('#colorpick').classList.add('hidden');
  pendingWildIdx = null;
}

function enterGame() {
  $('#lobby').classList.add('hidden');
  $('#game').classList.remove('hidden');
  $('#room-code').textContent = ROOM.toUpperCase();
  $('#room-code').onclick = () => {
    navigator.clipboard?.writeText(`${location.origin}/uno?room=${ROOM}&name=${encodeURIComponent(profile.name)}`)
      .then(() => toast('邀请链接已复制'), () => {});
  };
  $('#btn-start').onclick = () => send({ t: 'start' });
  $('#btn-start').classList.toggle('hidden', mySeat !== 0);
  $('#btn-leave').onclick = () => { try { ws.close(1000); } catch {} location.href = '/'; };
  $('#deck').onclick = () => send({ t: 'draw' });
  $('#btn-chat').onclick = () => { const v = $('#chat-input').value.trim(); if (v) { send({ t: 'chat', text: v.slice(0, 200) }); $('#chat-input').value = ''; } };
  $('#chat-input').onkeydown = (e) => { if (e.key === 'Enter') $('#btn-chat').click(); };
  $('#colorpick').querySelectorAll('.cbtn').forEach(b => b.onclick = () => tryPlay(pendingWildIdx, b.dataset.c));
}
function showWin(nm) {
  $('#winbox').textContent = `🏆 ${nm} 获胜！`;
  $('#winbox').classList.remove('hidden');
}
function chatLine(n, t) {
  const d = document.createElement('div');
  d.innerHTML = `<b style="color:#4f8cff">${esc(n)}</b> ${esc(t)}`;
  push(d);
}
function chatSys(t) {
  const d = document.createElement('div');
  d.style.opacity = '.6'; d.textContent = t;
  push(d);
}
function push(d) {
  const log = $('#chat-log');
  log.appendChild(d);
  while (log.children.length > 60) log.removeChild(log.firstChild);
  log.scrollTop = log.scrollHeight;
}
function esc(s) { return String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function toast(msg, err) {
  const t = $('#toast');
  t.textContent = msg; t.classList.toggle('err', !!err); t.classList.remove('hidden');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.add('hidden'), 2400);
}
window.__dbg = () => ({ mySeat, pub, hand });

/* lobby */
$('#btn-create').onclick = async () => {
  profile.name = $('#lobby-name').value.slice(0, 16) || '玩家';
  localStorage.setItem('fxq_profile', JSON.stringify(profile));
  const r = await fetch('/api/new-room?game=uno').then(r => r.json());
  location.href = '/uno?room=' + r.code;
};
$('#btn-join').onclick = () => {
  const code = $('#join-code').value.trim().toLowerCase();
  if (!/^[a-z0-9]{4}$/.test(code)) { $('#lobby-msg').textContent = '房间号为 4 位字母数字'; return; }
  profile.name = $('#lobby-name').value.slice(0, 16) || '玩家';
  localStorage.setItem('fxq_profile', JSON.stringify(profile));
  location.href = '/uno?room=' + code;
};
$('#lobby-name').value = profile.name;

if (ROOM && /^[a-z0-9]{4}$/.test(ROOM)) connect();
else $('#lobby').classList.remove('hidden');
