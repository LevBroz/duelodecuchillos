import { h } from '../dom.js';
import { WEAPONS, findById } from '../../../shared/index.js';
import { GameView } from '../three/gameView.js';
import { Controls } from '../controls.js';
import { gore, sfx } from '../audio.js';

const ELIM_SUBTITLES = [
  'Te quedaste sin filo.',
  'Hoy no tenías la razón.',
  'Otro día será, hermano.',
  'Te mandaron a sentarte.',
];

const fmtTime = (s) => {
  const t = Math.max(0, Math.ceil(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

export function gameScreen(root, app) {
  const data = app.match;
  if (!data) {
    app.nextStep();
    return {};
  }
  const myId = app.socket.id;
  const players = new Map(data.players.map((p) => [p.id, { ...p, hp: 100, alive: true }]));
  const options = new Map(data.options.map((o) => [o.id, o]));
  const me = players.get(myId);
  const myWeapon = findById(WEAPONS, me?.character?.weapon) || WEAPONS[0];
  const isAuto = data.mode === 'auto';
  let phase = data.snapshot.phase;
  let over = false;
  let level = data.snapshot.level || 1;

  // ---------- DOM ----------
  const wrap = h('div', { class: 'game-root' });
  root.append(wrap);
  const view = new GameView(wrap, { players: data.players, options: data.options, localId: myId, tickRate: data.tickRate });
  view.setGore(gore.on);
  view.onSwing = (id, x) => sfx.swing(view.panFor(x), false);
  const panOf = (id) => {
    const p = view.position(id);
    return p ? view.panFor(p.x) : 0;
  };

  const timer = h('div', { class: 'timer' }, isAuto ? '0:00' : fmtTime(data.matchSeconds));
  const levelChip = isAuto ? h('div', { class: 'level-chip' }, `Nivel ${level}`) : null;
  const aliveBar = h('div', { class: 'alive-bar' });
  const hpList = h('div', { class: 'hp-list' });
  const feed = h('div', { class: 'feed' });
  const myHpFill = h('i', { style: { width: '100%' } });
  const myHpText = h('span', {}, 'Vida 100');
  const banner = h('div', { class: 'banner' });
  const flash = h('div', { class: 'flash' });
  const smallBtn = { minHeight: '40px', fontSize: '14px', padding: '4px 12px' };
  const muteBtn = h('button', { class: 'btn ghost', type: 'button', style: smallBtn });
  const goreBtn = h('button', { class: 'btn ghost', type: 'button', style: smallBtn });
  const renderToggles = () => {
    muteBtn.textContent = sfx.muted ? '🔇' : '🔊';
    muteBtn.setAttribute('aria-label', sfx.muted ? 'Activar sonido' : 'Silenciar');
    goreBtn.textContent = gore.on ? '🩸' : '🎉';
    goreBtn.setAttribute('aria-label', gore.on ? 'Cambiar sangre por confeti' : 'Activar sangre de caricatura');
    goreBtn.title = gore.on ? 'Sangre de caricatura' : 'Solo confeti';
  };
  muteBtn.addEventListener('click', () => {
    sfx.unlock();
    sfx.setMuted(!sfx.muted);
    renderToggles();
  });
  goreBtn.addEventListener('click', () => {
    gore.set(!gore.on);
    view.setGore(gore.on);
    renderToggles();
  });
  renderToggles();
  const exitBtn = h(
    'div',
    { class: 'hud-exit row' },
    h(
      'button',
      {
        class: 'btn ghost',
        type: 'button',
        style: smallBtn,
        onclick: () => confirm(me ? '¿Salir de la pelea? Quedás eliminado.' : '¿Salir de la sala?') && app.leaveRoom(),
      },
      'Salir',
    ),
    muteBtn,
    goreBtn,
  );
  const hud = h(
    'div',
    { class: 'hud' },
    h('div', { class: 'hud-top' }, h('div', { class: 'center' }, timer, levelChip, aliveBar)),
    hpList,
    feed,
    me ? h('div', { class: 'my-hp' }, myHpText, h('div', { class: 'b' }, myHpFill)) : null,
    banner,
    exitBtn,
  );
  wrap.append(flash, hud);

  // Lista de vida (agrupada por opción)
  const hpItems = new Map();
  const sorted = [...players.values()].sort((a, b) => (a.optionId < b.optionId ? -1 : 1));
  for (const p of sorted) {
    const fill = h('i', { style: { width: '100%' } });
    const item = h(
      'div',
      { class: 'hp-item', style: { color: options.get(p.optionId)?.color } },
      h('span', { class: 'n' }, p.id === myId ? `${p.nick} (vos)` : p.nick),
      h('span', { class: 'b' }, fill),
    );
    hpItems.set(p.id, { item, fill });
    hpList.append(item);
  }

  function renderAlive() {
    const chips = [];
    for (const o of options.values()) {
      const members = [...players.values()].filter((p) => p.optionId === o.id);
      if (!members.length) continue;
      const alive = members.filter((p) => p.alive).length;
      chips.push(
        h('span', { class: `alive-chip ${alive ? '' : 'out'}`, style: { color: o.color } }, `${o.text} ${alive}/${members.length}`),
      );
    }
    aliveBar.replaceChildren(...chips);
    placeFeed();
  }

  // El registro va debajo de los chips de vivos (que pueden ocupar 2-3 filas),
  // salvo en escritorio ancho, donde va abajo a la derecha (ver CSS).
  function placeFeed() {
    const bottomMode =
      window.matchMedia('(min-width: 900px)').matches && !document.documentElement.classList.contains('is-touch');
    if (bottomMode) feed.style.top = '';
    else feed.style.top = `${Math.round(aliveBar.getBoundingClientRect().bottom + 8)}px`;
  }
  window.addEventListener('resize', placeFeed);
  renderAlive();

  let bannerTimer = null;
  function showBanner(text, sub = '', ms = 1200) {
    banner.replaceChildren(text, sub ? h('small', {}, sub) : '');
    banner.classList.remove('pop');
    void banner.offsetWidth;
    banner.classList.add('pop');
    banner.style.display = '';
    clearTimeout(bannerTimer);
    if (ms) bannerTimer = setTimeout(() => (banner.style.display = 'none'), ms);
  }

  function log(text, cls = '') {
    feed.prepend(h('div', { class: cls }, text));
    const maxLines = window.innerWidth < 500 ? 3 : 5; // en celular angosto tapa menos el ring
    while (feed.children.length > maxLines) feed.lastChild.remove();
    const el = feed.firstChild;
    setTimeout(() => el.remove(), 6000);
  }

  const nick = (id) => (id === myId ? 'Vos' : players.get(id)?.nick || '¿?');

  function onEvent(ev) {
    view.handleEvent(ev);
    if (ev.type === 'go') {
      showBanner('¡A los cuchillos!', '', 900);
      log('¡Que se peleen a cuchillos!');
      sfx.beep(true);
    } else if (ev.type === 'hit') {
      const w = findById(WEAPONS, ev.w);
      sfx.hit(view.panFor(ev.x), { heavy: w?.id === 'shortsword', kill: ev.kill });
      if (!ev.kill) log(`${nick(ev.a)} le dio un ${w?.hit || 'cuchillazo'} a ${nick(ev.v)}`);
      if (ev.v === myId) {
        flash.classList.add('on');
        setTimeout(() => flash.classList.remove('on'), 90);
        navigator.vibrate?.(40);
      }
    } else if (ev.type === 'elim') {
      const p = players.get(ev.v);
      if (p) p.alive = false;
      let text;
      if (ev.cause === 'ring') text = ev.by ? `${nick(ev.by)} sacó del ring a ${nick(ev.v)}` : `${nick(ev.v)} se cayó del ring`;
      else if (ev.cause === 'left') text = `${nick(ev.v)} se fue corriendo`;
      else text = `${nick(ev.by)} despachó a ${nick(ev.v)}`;
      log(text, 'elim');
      renderAlive();
      if (ev.cause === 'ring') sfx.fall(panOf(ev.v));
      else sfx.poof(panOf(ev.v));
      if (ev.v === myId && !over) setTimeout(() => sfx.sadTrombone(), ev.cause === 'ring' ? 1300 : 400);
      if (ev.v === myId && !over) {
        showBanner(
          ev.cause === 'ring' ? '¡Te caíste!' : '¡Fuera!',
          ELIM_SUBTITLES[Math.floor(Math.random() * ELIM_SUBTITLES.length)] + ' Mirá cómo termina.',
          2600,
        );
        navigator.vibrate?.([60, 40, 120]);
      } else if (ev.by === myId) showBanner('¡Uno menos!', '', 800);
    } else if (ev.type === 'sudden') {
      showBanner('¡Muerte súbita!', 'Cualquier golpe elimina', 1800);
      sfx.levelUp();
      log('¡Empate! Muerte súbita: cualquier golpe elimina', 'elim');
    } else if (ev.type === 'level') {
      level = ev.level;
      if (levelChip) {
        levelChip.textContent = `Nivel ${level}`;
        levelChip.classList.remove('up');
        void levelChip.offsetWidth;
        levelChip.classList.add('up');
      }
      showBanner(`¡Nivel ${ev.level}!`, 'Más rápido y con más filo', 1600);
      log(`Nivel ${ev.level}: se calentó la cosa`, 'elim');
      view.effects.addShake(0.3);
      sfx.levelUp();
    } else if (ev.type === 'clash') {
      log('¡Clanc! Chocaron los filos');
      sfx.clash(view.panFor(ev.x));
    }
  }

  function onTick(snap) {
    phase = snap.phase;
    view.pushSnapshot(snap);
    for (const ev of snap.events || []) onEvent(ev);
    for (const s of snap.players) {
      const p = players.get(s.id);
      if (!p) continue;
      p.hp = s.hp;
      const it = hpItems.get(s.id);
      it.fill.style.width = `${s.hp}%`;
      it.item.classList.toggle('dead', !s.al);
      if (s.id === myId) {
        myHpFill.style.width = `${s.hp}%`;
        myHpFill.className = s.hp > 50 ? '' : s.hp > 25 ? 'mid' : 'low';
        myHpText.textContent = s.al ? `Vida ${s.hp}` : 'Eliminado';
      }
    }
    if (snap.phase === 'countdown') {
      const n = Math.ceil(snap.countdown);
      if (n !== lastCount) {
        lastCount = n;
        showBanner(String(n), n === 3 ? '¡Quién tiene razón!' : '', 0);
        if (n > 0) sfx.beep();
      }
      timer.textContent = isAuto ? '0:00' : fmtTime(data.matchSeconds);
    } else if (isAuto || snap.timeLeft === null) {
      // Sin límite de tiempo: se muestra cuánto llevan peleando.
      timer.textContent = fmtTime(snap.elapsed || 0);
    } else {
      timer.textContent = fmtTime(snap.timeLeft);
      timer.classList.toggle('low', snap.phase === 'main' && snap.timeLeft <= 10);
      timer.classList.toggle('sudden', snap.phase === 'sudden');
    }
  }
  let lastCount = null;

  onTick({ ...data.snapshot, events: [] });
  if (isAuto) log('¡Pelean solos! Cada 30 s se pone más bravo.');
  else if (phase === 'countdown') log('Los de tu misma opción no se hacen daño.');

  const controls = me
    ? new Controls(wrap, view, {
        cooldownMs: myWeapon.cooldownMs,
        sendInput: (v) => app.socket.emit('input', v),
        sendAttack: (d) => {
          sfx.swing(0, true);
          app.socket.emit('attack', d);
        },
        canAct: () => !over && (phase === 'main' || phase === 'sudden') && players.get(myId)?.alive,
      })
    : null;

  // Latencia para la predicción del movimiento local
  const ping = () => {
    const t0 = performance.now();
    app.socket.timeout(2000).emit('net:ping', (err) => !err && view.setRtt(performance.now() - t0));
  };
  ping();
  const pingTimer = setInterval(ping, 2000);

  app.socket.on('game:tick', onTick);

  return {
    onGameOver(results) {
      over = true;
      const winners = results.winners.map((id) => options.get(id)?.text).filter(Boolean);
      const title = winners.length === 1 ? `¡${winners[0]}!` : results.winners.length ? '¡Empate!' : 'Se acabó';
      const sub = winners.length === 1 ? 'tenía razón' : 'nadie tuvo la razón';
      showBanner(title, sub, 0);
      // Fanfarria si ganó tu bando (o si estás mirando); tono triste si perdiste
      const iLost = me && !results.winners.includes(me.optionId);
      sfx.fanfare(!iLost && results.winners.length > 0);
      setTimeout(() => app.screenName === 'game' && app.go('results'), 2400);
    },
    destroy() {
      app.socket.off('game:tick', onTick);
      window.removeEventListener('resize', placeFeed);
      clearInterval(pingTimer);
      clearTimeout(bannerTimer);
      controls?.dispose();
      view.dispose();
    },
  };
}
