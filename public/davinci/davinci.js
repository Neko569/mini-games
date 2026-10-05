import { svgTrophy, svgCrown, svgSpark, avatarURI } from '/assets/icons.js';
import { gameClient } from '/assets/game-client.js';
/* 达芬奇密码客户端 */
const $ = (s) => document.querySelector(s);
const CC = { B: '#1a1a1a', W: '#eceff1', J: 'linear-gradient(135deg,#e53935,#1e88e5)' };
const CTX = { B: '黑', W: '白', J: 'J' };

const qs = new URLSearchParams(location.search);
const profile = JSON.parse(localStorage.getItem('fxq_profile') || '{}');
if (qs.get('name')) profile.name = qs.get('name');
if (!profile.gid) profile.gid = crypto.randomUUID();
profile.name = (profile.name || '').slice(0, 16) || '玩家';
localStorage.setItem('fxq_profile', JSON.stringify(profile));
const ROOM = (qs.get('room') || '').toLowerCase();

let ws = null, mySeat = -1, players = [], hand = [], pub = null;
let gTarget = null, gColor = null, gRank = null;

function connect() {
  ws = gameClient({
    path: '/ws/davinci/' + ROOM,
    profile,
    onMsg: handle,
    onStatus: (s) => {
      if (s === 'reconnecting') toast('连接断开，正在重连…', true);
      else if (s === 'reconnected') toast('已重新连接，对局已恢复');
      else if (s === 'kicked') toast('你的账号在其他窗口连接，本窗口已退出', true);
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
      chatSys('发牌完毕！你先摸一张，然后选择猜牌或弃牌');
      break;
    case 'players': players = m.players; break;
    case 'hand': hand = m.cards; break;
    case 'drawn': toast(`你摸到一张牌（只有你看得到）`); break;
    case 'state': pub = m.pub; break;
    case 'finished':
      pub = m.pub;
      $('#winbox').innerHTML = svgTrophy(26) + ' ' + esc(name(m.winner)) + ' 获胜！';
      $('#winbox').classList.remove('hidden');
      chatSys(`🏆 ${name(m.winner)} 获胜！`);
      break;
    case 'chat': chatLine(m.name, m.text); break;
    case 'error': toast(m.msg, true); break;
  }
  renderAll();
}

function name(seat) { return (players[seat] && players[seat].name) || `玩家${seat + 1}`; }

function enterGame() {
  $('#lobby').classList.add('hidden');
  $('#game').classList.remove('hidden');
  $('#room-code').textContent = ROOM.toUpperCase();
  $('#room-code').onclick = () => {
    navigator.clipboard?.writeText(`${location.origin}/davinci?room=${ROOM}&name=${encodeURIComponent(profile.name)}`)
      .then(() => toast('邀请链接已复制'), () => {});
  };
  $('#btn-start').onclick = () => send({ t: 'start' });
  $('#btn-start').classList.toggle('hidden', mySeat !== 0);
  $('#btn-leave').onclick = () => { try { ws.close(1000); } catch {} location.href = '/'; };
  $('#btn-draw').onclick = () => { cancelGuess(); send({ t: 'draw' }); };
  $('#btn-chat').onclick = () => { const v = $('#chat-input').value.trim(); if (v) { send({ t: 'chat', text: v.slice(0, 200) }); $('#chat-input').value = ''; } };
  $('#chat-input').onkeydown = (e) => { if (e.key === 'Enter') $('#btn-chat').click(); };
  $('#btn-cancel-guess').onclick = cancelGuess;
  $('#btn-guess').onclick = doGuess;
  $('#g-colors').querySelectorAll('.gnb').forEach(b => b.onclick = () => {
    gColor = b.dataset.c;
    $('#g-colors').querySelectorAll('.gnb').forEach(x => x.classList.toggle('sel', x === b));
    renderRanks();
  });
}

function renderRanks() {
  const box = $('#g-ranks');
  if (gColor === 'J') {
    box.innerHTML = '<button class="gnb sel">万能</button>';
    gRank = 'J';
    return;
  }
  box.innerHTML = Array.from({ length: 12 }, (_, r) => `<button class="gnb" data-r="${r}">${r}</button>`).join('');
  gRank = null;
  box.querySelectorAll('.gnb').forEach(b => b.onclick = () => {
    gRank = +b.dataset.r;
    box.querySelectorAll('.gnb').forEach(x => x.classList.toggle('sel', x === b));
  });
}

function startGuess(seat, uid) {
  gTarget = { seat, uid };
  gColor = null; gRank = null;
  $('#guessui').classList.remove('hidden');
  $('#g-target').textContent = name(seat);
  $('#g-colors').querySelectorAll('.gnb').forEach(x => x.classList.remove('sel'));
  $('#g-ranks').innerHTML = '';
}
function cancelGuess() {
  gTarget = null;
  $('#guessui').classList.add('hidden');
}
function doGuess() {
  if (!gTarget) return;
  if (gColor === null || gRank === null) { toast('先选颜色和点数', true); return; }
  send({ t: 'guess', seat: gTarget.seat, uid: gTarget.uid, c: gColor, r: gRank });
  cancelGuess();
}

/* ---------- 渲染 ---------- */
function renderAll() {
  if (!pub) { $('#banner').textContent = '等待房主开始…'; updateBtns(); return; }
  const myTurn = pub.turn === mySeat && pub.winner === null;
  const bn = $('#banner');
  if (pub.winner !== null) { bn.textContent = '对局结束'; bn.classList.remove('me'); }
  else if (myTurn) {
    bn.textContent = pub.drawnBy === mySeat ? '轮到你：猜牌或弃牌' : (pub.mustGuess ? '牌堆已空：直接猜！' : '轮到你：先摸一张');
    bn.classList.add('me');
  } else { bn.textContent = `等待 ${name(pub.turn)} 行动…`; bn.classList.remove('me'); }

  $('#deckinfo').textContent = `牌堆 ${pub.deckLeft} 张`;
  $('#btn-draw').disabled = !(myTurn && pub.drawnBy !== mySeat && pub.deckLeft > 0);

  // 对手区
  const opps = [];
  pub.players.forEach((p, i) => {
    if (i === mySeat) return;
    const cells = p.revealed.map(c => `<div class="card revealed c${c.c}" title="${c.c === 'J' ? '万能' : CTX[c.c] + c.r}">${c.c === 'J' ? 'J' : c.r}</div>`).join('')
      + Array.from({ length: p.faceDown }, () => '<div class="card down"></div>').join('');
    opps.push(`<div class="opp ${pub.turn === i ? 'active' : ''} ${p.eliminated ? 'dead' : ''}" data-seat="${i}">
      <div class="nm"><b>${esc(name(i))}</b>${players[i]?.owner ? svgCrown(13) : ''} ${p.eliminated ? '<span style="color:#e53935">已出局</span>' : ''}
      <span style="color:var(--muted);font-size:12px;margin-left:auto">暗牌 ${p.faceDown}</span></div>
      <div class="cards">${cells || '<span style="color:var(--muted)">无牌</span>'}</div></div>`);
  });
  $('#opps').innerHTML = opps.join('');
  // 给对手暗牌挂猜牌事件（uid 由服务端 pubView 下发）
  document.querySelectorAll('#opps .opp').forEach((box) => {
    const seatIdx = +box.dataset.seat;
    const p = pub.players[seatIdx];
    box.querySelectorAll('.card.down').forEach((el, k) => {
      el.classList.add('guessable');
      el.onclick = () => {
        if (!myTurn || pub.winner !== null || !p.downUids[k]) return;
        startGuess(seatIdx, p.downUids[k]);
      };
    });
  });
  // 我的牌
  $('#mycards').innerHTML = (hand || []).map(c => `
    <div class="card ${c.revealed ? 'revealed' : 'down mine'} c${c.c}" data-uid="${c.uid}" title="${c.revealed ? '明牌' : '暗牌(仅自己可见)'}">${c.c === 'J' ? 'J' : c.r}${c.fresh ? svgSpark(12) : ''}</div>`).join('');
  $('#mycards').querySelectorAll('.card.down').forEach(el => {
    el.onclick = () => {
      if (!myTurn || pub.winner !== null) return;
      send({ t: 'discard', uid: el.dataset.uid });
      cancelGuess();
    };
  });
  updateBtns();
}
function updateBtns() {
  if (pub) $('#btn-start').classList.toggle('hidden', !(players.some(p => p && p.owner && p.seat === mySeat) && pub.started !== true && pub.winner === null && !pub.turn && pub.deckLeft === 26));
  else $('#btn-start').classList.toggle('hidden', !(players.some(p => p && p.owner && p.seat === mySeat)));
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
function showWin(n) {
  $('#winbox').innerHTML = svgTrophy(26) + ' ' + esc(n) + ' 获胜！';
  $('#winbox').classList.remove('hidden');
}
window.__dbg = () => ({ mySeat, pub, hand });

$('#btn-create').onclick = async () => {
  profile.name = $('#lobby-name').value.slice(0, 16) || '玩家';
  localStorage.setItem('fxq_profile', JSON.stringify(profile));
  const r = await fetch('/api/new-room?game=davinci').then(r => r.json());
  location.href = '/davinci?room=' + r.code;
};
$('#btn-join').onclick = () => {
  const code = $('#join-code').value.trim().toLowerCase();
  if (!/^[a-z0-9]{4}$/.test(code)) { $('#lobby-msg').textContent = '房间号为 4 位字母数字'; return; }
  profile.name = $('#lobby-name').value.slice(0, 16) || '玩家';
  localStorage.setItem('fxq_profile', JSON.stringify(profile));
  location.href = '/davinci?room=' + code;
};
$('#lobby-name').value = profile.name;

if (ROOM && /^[a-z0-9]{4}$/.test(ROOM)) connect();
else $('#lobby').classList.remove('hidden');
