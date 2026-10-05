/* 黑白棋客户端 */
import { svgStone, svgTrophy, avatarURI } from '/assets/icons.js';
import { gameClient } from '/assets/game-client.js';
const $ = (s) => document.querySelector(s);

const qs = new URLSearchParams(location.search);
const profile = JSON.parse(localStorage.getItem('fxq_profile') || '{}');
if (qs.get('name')) { profile.name = qs.get('name'); localStorage.setItem('fxq_profile', JSON.stringify(profile)); }
if (qs.get('avatar')) { profile.avatar = qs.get('avatar'); localStorage.setItem('fxq_profile', JSON.stringify(profile)); }
if (!profile.gid) profile.gid = crypto.randomUUID();
profile.name = (profile.name || '').slice(0, 16) || '玩家';
localStorage.setItem('fxq_profile', JSON.stringify(profile));
const ROOM = (qs.get('room') || '').toLowerCase();

let ws = null, mySeat = -1, players = [], pub = null;

function connect() {
  ws = gameClient({
    path: '/ws/reversi/' + ROOM,
    profile,
    onMsg: handle,
    onStatus: (s) => {
      if (s === 'reconnecting') toast('连接断开，正在重连…', true);
      else if (s === 'reconnected') toast('已重新连接，对局已恢复');
      else if (s === 'kicked') toast('账号在其他窗口连接', true);
    },
  });
}
const send = (o) => ws && ws.send(o);

function handle(m) {
  switch (m.t) {
    case 'welcome':
      mySeat = m.you.seat; players = m.room.players;
      enterGame(); renderAll();
      break;
    case 'start':
      players = m.room.players;
      $('#btn-start').classList.add('hidden');
      chatSys('对局开始！黑方先行。夹住对方棋子即可翻转。');
      break;
    case 'players': players = m.players; break;
    case 'state': pub = m.pub; break;
    case 'move':
      pub = m.pub;
      if (m.autoPass) chatSys(`${players[1 - m.seat]?.name || '对方'} 无棋可下，自动跳过`);
      break;
    case 'passby': pub = m.pub; chatSys(`${players[m.seat]?.name || '玩家'} 跳过回合`); break;
    case 'finished':
      pub = m.pub;
      const nm = m.winner === -1 ? '平局' : (players[m.winner - 1]?.name || `玩家${m.winner}`);
      $('#winbox').innerHTML = svgTrophy(26) + ' ' + esc(nm) + (m.winner === -1 ? '' : ` 获胜！（黑 ${m.score.black} : 白 ${m.score.white}）`);
      $('#winbox').classList.remove('hidden');
      chatSys(`🏆 ${nm}${m.winner === -1 ? '' : ' 获胜'}！终局 黑${m.score.black} : 白${m.score.white}`);
      break;
    case 'chat': chatLine(m.name, m.text); break;
    case 'error': toast(m.msg, true); break;
  }
  renderAll();
}

function enterGame() {
  $('#lobby').classList.add('hidden');
  $('#game').classList.remove('hidden');
  $('#room-code').textContent = ROOM.toUpperCase();
  $('#room-code').onclick = () => {
    navigator.clipboard?.writeText(`${location.origin}/reversi?room=${ROOM}&name=${encodeURIComponent(profile.name)}&avatar=${encodeURIComponent(profile.avatar || '')}`)
      .then(() => toast('邀请链接已复制'), () => {});
  };
  $('#btn-start').onclick = () => send({ t: 'start' });
  $('#btn-start').classList.toggle('hidden', mySeat !== 0);
  $('#btn-leave').onclick = () => { try { ws.close(1000); } catch {} location.href = '/'; };
  $('#btn-pass').onclick = () => send({ t: 'pass' });
  $('#btn-chat').onclick = () => { const v = $('#chat-input').value.trim(); if (v) { send({ t: 'chat', text: v.slice(0, 200) }); $('#chat-input').value = ''; } };
  $('#chat-input').onkeydown = (e) => { if (e.key === 'Enter') $('#btn-chat').click(); };
  renderBoard();
}

function renderBoard() {
  const el = $('#board');
  if (el.dataset.built) return;
  el.dataset.built = '1';
  el.innerHTML = Array.from({ length: 64 }, (_, i) => `<div class="cell" data-idx="${i}"></div>`).join('');
  el.addEventListener('click', (e) => {
    const cell = e.target.closest('.cell');
    if (!cell || !pub) return;
    if (pub.turn !== mySeat + 1 || mySeat < 0 || pub.winner !== null) return;
    if (!pub.legal.includes(+cell.dataset.idx)) return;
    send({ t: 'place', x: (+cell.dataset.idx) % 8, y: (+cell.dataset.idx / 8) | 0 });
  });
}

function renderAll() {
  renderBoard();
  if (!pub) return;
  const myColor = mySeat === 0 ? '黑方' : '白方';
  const myTurn = pub.winner === null && pub.turn === mySeat + 1 && mySeat >= 0;
  const bn = $('#banner');
  if (pub.winner !== null) { bn.textContent = '对局结束'; bn.classList.remove('me'); }
  else if (myTurn) {
    bn.textContent = pub.legal.length ? '轮到你落子！点击高亮格子' : '你无棋可下，请跳过回合';
    bn.classList.add('me');
  } else { bn.textContent = `等待 ${pub.seats[pub.turn - 1]?.name || '对方'} 落子…`; bn.classList.remove('me'); }
  $('#btn-pass').disabled = !(myTurn && !pub.legal.length && pub.winner === null);

  // 计分板
  const sb = $('#scorebar');
  const b0 = pub.seats[0], b1 = pub.seats[1];
  const lead = pub.black === pub.white ? '' : (pub.black > pub.white ? ' 黑领先' : ' 白领先');
  sb.innerHTML = `
    <span class="sc">${svgStone(20, true)} ${esc(b0?.name || '黑方')} <b>${pub.black}</b></span>
    <span style="color:var(--muted);font-size:13px">VS${lead}</span>
    <span class="sc"><b>${pub.white}</b> ${esc(b1?.name || '白方')} ${svgStone(20, false)}</span>`;

  // 棋盘
  const cells = $('#board').children;
  const lastIdx = pub.lastMove && !pub.lastMove.pass && !pub.lastMove.autoPass
    ? pub.lastMove.y * 8 + pub.lastMove.x : -1;
  for (let i = 0; i < 64; i++) {
    const c = cells[i];
    const v = pub.board[i];
    const cur = c.firstChild;
    const want = v === 1 ? 'b' : v === 2 ? 'w' : '';
    if (c.dataset.v !== want) {
      c.dataset.v = want;
      c.innerHTML = want ? svgStone(40, want === 'b') : '';
    }
    c.classList.toggle('legal', pub.winner === null && pub.turn === mySeat + 1 && mySeat >= 0 && pub.legal.includes(i));
    c.classList.toggle('last', i === lastIdx);
  }
}

function esc(s) { return String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function toast(msg, err) {
  const t = $('#toast');
  t.textContent = msg; t.classList.toggle('err', !!err); t.classList.remove('hidden');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.add('hidden'), 2400);
}
function chatLine(n, text) {
  const d = document.createElement('div');
  d.innerHTML = `<b>${esc(n)}</b> ${esc(text)}`;
  const log = $('#chat-log'); log.appendChild(d); log.scrollTop = log.scrollHeight;
}
function chatSys(text) {
  const d = document.createElement('div');
  d.textContent = text; d.style.color = 'var(--muted)';
  const log = $('#chat-log'); log.appendChild(d); log.scrollTop = log.scrollHeight;
}

$('#btn-create').onclick = async () => {
  profile.name = ($('#lobby-name').value || '').slice(0, 16) || '玩家';
  localStorage.setItem('fxq_profile', JSON.stringify(profile));
  const r = await fetch('/api/new-room?game=reversi').then(r => r.json());
  location.href = '/reversi?room=' + r.code;
};
$('#btn-join').onclick = () => {
  const code = $('#join-code').value.trim().toLowerCase();
  if (!/^[a-z0-9]{4}$/.test(code)) { $('#lobby-msg').textContent = '房间号为 4 位字母数字'; return; }
  profile.name = ($('#lobby-name').value || '').slice(0, 16) || '玩家';
  localStorage.setItem('fxq_profile', JSON.stringify(profile));
  location.href = '/reversi?room=' + code;
};
$('#lobby-name').value = profile.name;

if (ROOM && /^[a-z0-9]{4}$/.test(ROOM)) connect();
else $('#lobby').classList.remove('hidden');
