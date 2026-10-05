/* 五子棋客户端 — 原生 JS + canvas（15 路棋盘） */
import { svgTrophy, svgStone, avatarURI } from '/assets/icons.js';
import { gameClient } from '/assets/game-client.js';
const $ = (s) => document.querySelector(s);
const COLORS = ['#1a1a1a', '#f5f5f5'];
const CN = ['黑方', '白方'];
const SIZE = 15;

/* ---------- profile / URL ---------- */
const qs = new URLSearchParams(location.search);
const profile = JSON.parse(localStorage.getItem('fxq_profile') || '{}');
if (qs.get('name')) profile.name = qs.get('name');
if (qs.get('avatar')) profile.avatar = qs.get('avatar');
if (!profile.gid) profile.gid = crypto.randomUUID();
profile.name = (profile.name || '').slice(0, 16) || '玩家';
localStorage.setItem('fxq_profile', JSON.stringify(profile));
const ROOM = (qs.get('room') || '').toLowerCase();

/* ---------- state ---------- */
let ws = null, mySeat = -1, roomView = null, game = null, players = [];

/* ---------- websocket ---------- */
function connect() {
  ws = gameClient({
    path: '/ws/gobang/' + ROOM,
    profile,
    onMsg: handle,
    onStatus: (s) => {
      if (s === 'reconnecting') toast('连接断开，正在重连…', true);
      else if (s === 'reconnected') toast('已重新连接，对局已恢复');
      else if (s === 'kicked') toast('你的账号在其他窗口连接，本窗口已退出', true);
    },
  });
}
function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

function handle(m) { try { handleInner(m); } catch (e) { console.error('handler error', m.t, e); } }
function handleInner(m) {
  switch (m.t) {
    case 'welcome':
      mySeat = m.you.seat;
      roomView = m.room; players = m.room.players; game = m.room.game;
      enterGame(); renderPlayers(); renderAll(); updateUI();
      chatSys(mySeat >= 0 ? `已入座 ${mySeat + 1} 号位（${CN[mySeat]}）` : '观战模式');
      break;
    case 'players':
      players = m.players; if (roomView) roomView.players = m.players;
      renderPlayers(); updateUI();
      break;
    case 'start':
      roomView = m.room; game = m.room.game; players = m.room.players;
      if (mySeat < 0) mySeat = m.room.players.findIndex(p => p && p.name === profile.name);
      chatSys('对局开始！黑方先行'); renderAll(); updateUI();
      break;
    case 'game':
      game = m.game;
      chatSys(`${seatName(m.by)} 落子 (${m.game.lastMove.x},${m.game.lastMove.y})`);
      renderAll(); updateUI();
      break;
    case 'finished':
      game = m.game; roomView = m.room; players = m.room.players;
      const nm = m.winner === -1 ? '平局' : seatName(m.winner);
      chatSys(`🏆 ${nm}获胜！`);
      showBanner(`🏆 ${nm}获胜！`, m.winner === mySeat);
      renderAll(); updateUI();
      break;
    case 'chat': chatLine(m.name, m.text, m.seat); break;
    case 'error': toast(m.msg, true); break;
  }
}
function seatName(seat) { const p = players[seat]; return p ? p.name : CN[seat] || '?'; }

/* ---------- game page ---------- */
function enterGame() {
  $('#lobby').classList.add('hidden');
  $('#game').classList.remove('hidden');
  $('#btn-start').onclick = () => send({ t: 'start' });
  $('#btn-leave').onclick = () => { try { ws && ws.close(1000); } catch {} location.href = '/'; };
  $('#btn-chat').onclick = () => {
    const v = $('#chat-input').value.trim();
    if (v) { send({ t: 'chat', text: v.slice(0, 200) }); $('#chat-input').value = ''; }
  };
  $('#chat-input').onkeydown = (e) => { if (e.key === 'Enter') $('#btn-chat').click(); };
  $('#room-code').textContent = ROOM.toUpperCase();
  $('#room-code').onclick = copyInvite;
}
function copyInvite() {
  const url = `${location.origin}/gobang?room=${ROOM}&name=${encodeURIComponent(profile.name)}` +
    (profile.avatar ? `&avatar=${encodeURIComponent(profile.avatar)}` : '');
  navigator.clipboard?.writeText(url).then(() => toast('邀请链接已复制'), () => toast(url));
}

function renderPlayers() {
  $('#players').innerHTML = (players || []).map((p, i) => p ? `
    <div class="player ${p.connected ? '' : 'off'} ${i === mySeat ? 'me' : ''}">
      <span class="dot" style="background:${COLORS[i]};border:1px solid #555"></span>
      <img class="pavatar" src="${esc(p.avatar) || avatarURI(p.gid || p.name || i, p.name)}" alt="" onerror="this.src=avatarURI(p.gid || p.name || i, p.name)">
      <span class="pname">${esc(p.name)}</span>
      ${p.owner ? '<span class="badge">房主</span>' : ''}
      <span class="conn">${p.connected ? CN[i] : CN[i] + '·离线'}</span>
    </div>` : `<div class="player empty"><span class="dot" style="background:${COLORS[i]};border:1px solid #555"></span>${CN[i]} · 等待加入</div>`
  ).join('');
}

function updateUI() {
  const started = roomView?.started === true;
  const over = roomView?.started === 'over';
  const iAmOwner = players.some(p => p && p.owner && p.seat === mySeat);
  $('#btn-start').classList.toggle('hidden', !(iAmOwner && (!started || over)));
  $('#btn-start').textContent = over ? '再来一局' : '开始对局';

  let hint = '';
  if (!started) hint = '等待房主开始… 支持断线重连';
  else if (over) hint = '对局结束，房主可再来一局';
  else if (mySeat < 0) hint = '观战中';
  else if (game.turn === mySeat) hint = '轮到你落子！';
  else hint = '';
  $('#action-hint').textContent = hint;

  const tb = $('#turn-banner');
  if (started && !over && game) {
    let text = `等待 ${seatName(game.turn)} 落子…`;
    if (mySeat >= 0 && game.turn === mySeat) { text = '轮到你落子 ⚫'; tb.classList.add('me'); }
    else tb.classList.remove('me');
    tb.innerHTML = esc2(text).replace(/\u{1F3C6}/gu, svgTrophy(16)).replace(/⚫/g, svgStone(13, true)); tb.classList.remove('hidden');
  } else tb.classList.add('hidden');
}

function esc2(t) { return String(t ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function showBanner(text, me) {
  const tb = $('#turn-banner');
  tb.innerHTML = esc2(text).replace(/\u{1F3C6}/gu, svgTrophy(16)).replace(/⚫/g, svgStone(13, true)); tb.classList.remove('hidden'); tb.classList.toggle('me', !!me);
}

/* ---------- board ---------- */
const canvas = $('#board'), ctx = canvas.getContext('2d');
const PAD = 24, CELL = (640 - PAD * 2) / (SIZE - 1);

function renderAll() {
  ctx.clearRect(0, 0, 640, 640);
  // 木纹底
  ctx.fillStyle = '#c9a06a';
  ctx.fillRect(0, 0, 640, 640);
  ctx.strokeStyle = '#8a6a3f'; ctx.lineWidth = 1;
  for (let i = 0; i < SIZE; i++) {
    ctx.beginPath();
    ctx.moveTo(PAD, PAD + i * CELL); ctx.lineTo(640 - PAD, PAD + i * CELL);
    ctx.moveTo(PAD + i * CELL, PAD); ctx.lineTo(PAD + i * CELL, 640 - PAD);
    ctx.stroke();
  }
  // 星位
  [[3, 3], [11, 3], [3, 11], [11, 11], [7, 7]].forEach(([sx, sy]) => {
    ctx.beginPath(); ctx.arc(PAD + sx * CELL, PAD + sy * CELL, 3.4, 0, 7); ctx.fill();
  });
  // 胜利线
  if (game && game.winLine && game.winLine.length) {
    const a = game.winLine[0], b = game.winLine[game.winLine.length - 1];
    ctx.strokeStyle = '#ffd54a'; ctx.lineWidth = 6; ctx.lineCap = 'round';
    ctx.shadowColor = '#ffd54a'; ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(PAD + a.x * CELL, PAD + a.y * CELL);
    ctx.lineTo(PAD + b.x * CELL, PAD + b.y * CELL);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  // 棋子
  if (game) {
    for (const mv of game.moves) {
      const x = PAD + mv.x * CELL, y = PAD + mv.y * CELL;
      const isLast = game.lastMove && game.lastMove.x === mv.x && game.lastMove.y === mv.y;
      const grad = ctx.createRadialGradient(x - 4, y - 4, 1, x, y, 13);
      if (mv.c === 1) { grad.addColorStop(0, '#555'); grad.addColorStop(1, '#0a0a0a'); }
      else { grad.addColorStop(0, '#fff'); grad.addColorStop(1, '#c8c8c8'); }
      ctx.beginPath(); ctx.arc(x, y, 13, 0, 7); ctx.fillStyle = grad; ctx.fill();
      if (isLast) { ctx.strokeStyle = '#ff5252'; ctx.lineWidth = 2.5; ctx.stroke(); }
    }
  }
}

canvas.addEventListener('click', (e) => {
  if (!game || game.winner !== null || mySeat < 0 || game.turn !== mySeat) return;
  const rect = canvas.getBoundingClientRect();
  const px = (e.clientX - rect.left) * (canvas.width / rect.width);
  const py = (e.clientY - rect.top) * (canvas.height / rect.height);
  const x = Math.round((px - PAD) / CELL), y = Math.round((py - PAD) / CELL);
  if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return;
  // 距交点太远忽略
  const dx = px - (PAD + x * CELL), dy = py - (PAD + y * CELL);
  if (dx * dx + dy * dy > 20 * 20) return;
  if (game.board[y * SIZE + x] !== 0) return;
  send({ t: 'place', x, y });
});

/* ---------- chat ---------- */
function chatLine(name, text, seat) {
  const div = document.createElement('div');
  div.className = 'chat-line';
  div.innerHTML = `<b style="color:${seat >= 0 && seat < 2 ? '#4f8cff' : '#8b97ad'}">${esc(name)}</b> ${esc(text)}`;
  pushChat(div);
}
function chatSys(text) {
  const div = document.createElement('div');
  div.className = 'chat-line sys';
  div.textContent = text;
  pushChat(div);
}
function pushChat(div) {
  const log = $('#chat-log');
  log.appendChild(div);
  while (log.children.length > 80) log.removeChild(log.firstChild);
  log.scrollTop = log.scrollHeight;
}
function esc(s) {
  return String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
function toast(msg, err) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('err', !!err);
  t.classList.remove('hidden');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add('hidden'), 2600);
}

/* debug */
window.__dbg = () => ({ mySeat, roomView, game, players });

/* boot */
function showLobby() { $('#lobby').classList.remove('hidden'); }
if (ROOM && /^[a-z0-9]{4}$/.test(ROOM)) connect();
else showLobby();

/* ---------- 大厅：创建 / 加入 ---------- */
function saveProfile() {
  profile.name = ($('#lobby-name').value || '').slice(0, 16) || '玩家';
  localStorage.setItem('fxq_profile', JSON.stringify(profile));
}
$('#btn-create').onclick = async () => {
  saveProfile();
  const r = await fetch('/api/new-room?game=gobang').then(r => r.json()).catch(() => null);
  if (r && r.code) location.href = '/gobang?room=' + r.code;
  else $('#lobby-msg').textContent = '创建失败，请重试';
};
$('#btn-join').onclick = () => {
  const code = $('#join-code').value.trim().toLowerCase();
  if (!/^[a-z0-9]{4}$/.test(code)) { $('#lobby-msg').textContent = '房间号为 4 位字母数字'; return; }
  saveProfile();
  location.href = '/gobang?room=' + code;
};
$('#lobby-name').value = profile.name;
if (document.getElementById('lobby-avatar')) document.getElementById('lobby-avatar').src = profile.avatar || avatarURI(profile.gid, profile.name);
