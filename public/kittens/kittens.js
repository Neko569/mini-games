/* 爆炸猫客户端 */
import { KCARD, svgTrophy, avatarURI } from '/assets/icons.js';
const $ = (s) => document.querySelector(s);
const KIND = {
  boom:   { n: '爆炸猫', em: '💥' }, defuse: { n: '拆弹', em: '🧰' },
  skip:   { n: '跳过', em: '⏭️' },  attack: { n: '攻击', em: '⚔️' },
  favor:  { n: '索要', em: '🙏' },  shuffle:{ n: '洗牌', em: '🔀' },
  seefuture: { n: '窥视', em: '🔮' }, bottom: { n: '底抽', em: '⬇️' },
  nope:   { n: '否决', em: '🚫' },
};

const qs = new URLSearchParams(location.search);
const profile = JSON.parse(localStorage.getItem('fxq_profile') || '{}');
if (qs.get('name')) profile.name = qs.get('name');
if (!profile.gid) profile.gid = crypto.randomUUID();
profile.name = (profile.name || '').slice(0, 16) || '玩家';
localStorage.setItem('fxq_profile', JSON.stringify(profile));
const ROOM = (qs.get('room') || '').toLowerCase();

let ws = null, mySeat = -1, players = [], hand = [], pub = null, reconnectTry = 0;
let selCard = null, pendingTarget = null;

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws/kittens/${ROOM}?gid=${encodeURIComponent(profile.gid)}&name=${encodeURIComponent(profile.name)}`);
  ws.onopen = () => { reconnectTry = 0; send({ t: 'join' }); };
  ws.onmessage = (ev) => { try { handle(JSON.parse(ev.data)); } catch (e) { console.error(e); } };
  ws.onclose = (ev) => {
    if (ev.code === 4000) { toast('账号在其他窗口连接，本窗口已退出', true); return; }
    if (reconnectTry < 12) { reconnectTry++; setTimeout(connect, Math.min(1000 * 2 ** (reconnectTry - 1), 15000)); }
  };
}
const send = (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };

function handle(m) {
  switch (m.t) {
    case 'welcome':
      mySeat = m.you.seat; players = m.room.players;
      enterGame(); renderAll();
      break;
    case 'start':
      players = m.room.players;
      $('#btn-start').classList.add('hidden');
      chatSys('发牌完毕！每回合可先出动作牌，最后必须摸牌。摸到💥就得拆！');
      break;
    case 'players': players = m.players; break;
    case 'hand': hand = m.cards; break;
    case 'state': pub = m.pub; break;
    case 'peek':
      const p = $('#peek');
      p.innerHTML = '🔮 牌堆顶 3 张：<b>' + m.cards.map(k => KCARD[k].replace('width="24" height="24"', 'width="17" height="17" style="vertical-align:-3px"') + KIND[k].n).join('、') + '</b>';
      p.classList.remove('hidden');
      break;
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
    navigator.clipboard?.writeText(`${location.origin}/kittens?room=${ROOM}&name=${encodeURIComponent(profile.name)}`)
      .then(() => toast('邀请链接已复制'), () => {});
  };
  $('#btn-start').onclick = () => send({ t: 'start' });
  $('#btn-start').classList.toggle('hidden', mySeat !== 0);
  $('#btn-leave').onclick = () => { try { ws.close(1000); } catch {} location.href = '/'; };
  $('#btn-draw').onclick = () => { send({ t: 'draw' }); };
  $('#btn-chat').onclick = () => { const v = $('#chat-input').value.trim(); if (v) { send({ t: 'chat', text: v.slice(0, 200) }); $('#chat-input').value = ''; } };
  $('#chat-input').onkeydown = (e) => { if (e.key === 'Enter') $('#btn-chat').click(); };
}

/* 出牌（favor 需选目标） */
function tryPlay(uid) {
  const card = hand.find(c => c.uid === uid);
  if (!card || !pub || pub.turn !== mySeat || pub.pending || pub.giving) return;
  if (card.kind === 'nope' || card.kind === 'boom' || card.kind === 'defuse') { toast('这张牌不能主动打出', true); return; }
  if (card.kind === 'favor') {
    // 选择目标
    const alive = pub.players.filter(p => p.alive && p.seat !== mySeat);
    if (!alive.length) return;
    pendingTarget = { uid, options: alive.map(p => p.seat) };
    renderAll();
    return;
  }
  send({ t: 'play', uid });
}

function renderAll() {
  const bn = $('#banner');
  if (!pub) { bn.textContent = '等待房主开始…'; renderPlayers(); renderHand(); return; }
  const myTurn = pub.turn === mySeat && pub.winner === null && pub.players[mySeat]?.alive;
  if (pub.winner !== null) { bn.textContent = '对局结束'; bn.classList.remove('me'); }
  else if (pub.giving && pub.giving.from === mySeat) { bn.textContent = '🙏 被索要！点一张手牌给出去'; bn.classList.add('me'); }
  else if (myTurn) {
    bn.textContent = pub.drawsLeft > 1 ? `轮到你（还需摸 ${pub.drawsLeft} 张）` : '轮到你：可出动作牌，或直接摸牌';
    bn.classList.add('me');
  } else if (pub.pending) { bn.innerHTML = KCARD[pub.pending.type].replace('width="24" height="24"', 'width="17" height="17" style="vertical-align:-3px"') + ' ' + esc(name(pub.pending.by)) + ' 打出了「' + KIND[pub.pending.type].n + '」…'; bn.classList.remove('me'); }
  else { bn.textContent = `等待 ${name(pub.turn)} 行动…`; bn.classList.remove('me'); }

  $('#deckinfo').innerHTML = `牌堆 ${pub.deckLeft} 张` + (pub.discardTop ? ` · 弃牌顶: ${KCARD[pub.discardTop].replace('width="24" height="24"', 'width="15" height="15" style="vertical-align:-2px"')}${KIND[pub.discardTop].n}` : '');
  $('#btn-draw').disabled = !(myTurn && !pub.pending && !pub.giving);

  // nope 窗口条
  const pd = $('#pend');
  if (pub.pending) {
    const tgt = pub.pending.target !== null && pub.pending.target !== undefined ? ` → ${name(pub.pending.target)}` : '';
    pd.innerHTML = `<b>${KCARD[pub.pending.type].replace('width="24" height="24"', 'width="18" height="18" style="vertical-align:-4px"')} ${esc(name(pub.pending.by))} 出了「${KIND[pub.pending.type].n}」${esc(tgt)}</b>
      <span style="color:var(--muted)">出 🚫 可否决</span>
      <span class="ttl" id="pend-ttl">${Math.ceil(pub.pending.ttl / 1000)}s</span>`;
    pd.classList.remove('hidden');
  } else pd.classList.add('hidden');

  renderPlayers();
  renderHand();
  if (pub.pending && !pub.pending._timer) {
    clearInterval(window.__ttl);
    window.__ttl = setInterval(() => {
      const el = document.getElementById('pend-ttl');
      if (el && pub && pub.pending) {
        const left = Math.max(0, Math.ceil((pub.pending.ttl - (Date.now() - (pub._ts || Date.now()))) / 1000));
        el.textContent = left + 's';
      }
    }, 250);
  }
}

function renderPlayers() {
  if (!pub) {
    $('#opps').innerHTML = players.filter(Boolean).map((p, i) =>
      `<div class="opp"><span class="nm">${esc(p.name)}${p.owner ? '👑' : ''}</span></div>`).join('');
    return;
  }
  $('#opps').innerHTML = pub.players.map((p, i) => {
    if (i === mySeat) return '';
    const meta = [];
    if (!p.alive) meta.push('💥 已爆炸');
    else { meta.push(`手牌 ${p.handCount}`); if (p.hasDefuse) meta.push('🧰'); }
    return `<div class="opp ${pub.turn === i ? 'active' : ''} ${p.alive ? '' : 'dead'}" data-seat="${i}">
      <span class="nm">${esc(name(i))}${players[i]?.owner ? '👑' : ''}</span>
      <span class="info">${meta.join(' · ')}</span></div>`;
  }).join('');
}

function renderHand() {
  const myTurn = pub && pub.turn === mySeat && !pub.pending && !pub.giving && pub.winner === null;
  const giving = pub && pub.giving && pub.giving.from === mySeat;
  $('#mycards').innerHTML = (hand || []).map(c => {
    const em = KCARD[c.kind].replace('width="24" height="24"', 'width="26" height="26"'), nm = KIND[c.kind].n;
    const actionable = (myTurn && ['skip','attack','favor','shuffle','seefuture','bottom'].includes(c.kind)) || giving;
    const sel = selCard === c.uid || (pendingTarget && pendingTarget.uid === c.uid);
    return `<div class="card hand ${actionable ? 'playable' : ''} ${sel ? 'sel' : ''}" data-uid="${c.uid}" title="${nm}">
      <span class="em">${em}</span><span>${nm}</span></div>`;
  }).join('') || '<span style="color:var(--muted)">（无牌）</span>';
  $('#mycards').querySelectorAll('.card').forEach(el => {
    el.onclick = () => {
      const uid = el.dataset.uid;
      const card = hand.find(c => c.uid === uid);
      if (giving) { send({ t: 'give', uid }); return; }
      if (pendingTarget && pendingTarget.uid === uid) { pendingTarget = null; renderAll(); return; }
      if (card.kind === 'favor' && myTurn && !pendingTarget) { tryPlay(uid); return; }
      tryPlay(uid);
    };
  });
  // favor 目标选择条
  if (pendingTarget) {
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:8px;margin:8px 0;flex-wrap:wrap';
    bar.innerHTML = '<span style="color:var(--muted);font-size:13px;align-self:center">索要目标：</span>' +
      pendingTarget.options.map(s => `<button class="btn" data-seat="${s}">${esc(name(s))}</button>`).join('') +
      '<button class="btn ghost" id="fav-cancel">取消</button>';
    $('#mycards').after(bar);
    bar.querySelectorAll('button[data-seat]').forEach(b => b.onclick = () => {
      send({ t: 'play', uid: pendingTarget.uid, target: +b.dataset.seat });
      pendingTarget = null;
    });
    bar.querySelector('#fav-cancel').onclick = () => { pendingTarget = null; renderAll(); };
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
window.__dbg = () => ({ mySeat, pub, hand });

$('#btn-create').onclick = async () => {
  profile.name = $('#lobby-name').value.slice(0, 16) || '玩家';
  localStorage.setItem('fxq_profile', JSON.stringify(profile));
  const r = await fetch('/api/new-room?game=kittens').then(r => r.json());
  location.href = '/kittens?room=' + r.code;
};
$('#btn-join').onclick = () => {
  const code = $('#join-code').value.trim().toLowerCase();
  if (!/^[a-z0-9]{4}$/.test(code)) { $('#lobby-msg').textContent = '房间号为 4 位字母数字'; return; }
  profile.name = $('#lobby-name').value.slice(0, 16) || '玩家';
  localStorage.setItem('fxq_profile', JSON.stringify(profile));
  location.href = '/kittens?room=' + code;
};
$('#lobby-name').value = profile.name;

if (ROOM && /^[a-z0-9]{4}$/.test(ROOM)) connect();
else $('#lobby').classList.remove('hidden');
