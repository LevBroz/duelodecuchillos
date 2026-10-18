import { h } from '../dom.js';
import { ACCESSORIES, CHARACTER_TYPES, COLORS, GAME, OPTION_COLORS, WEAPONS } from '../../../shared/index.js';
import { GameView } from '../three/gameView.js';

// Vista de prueba (?demo=1): el ring con personajes de todos los tipos, sin servidor.
// Sirve para revisar gráficos, cámara y rendimiento en un celular.
export function demoScreen(root) {
  const players = [];
  let i = 0;
  for (const type of CHARACTER_TYPES) {
    const opts = type.variantGroups[0].options;
    for (let k = 0; k < Math.min(2, opts.length) && players.length < 8; k++) {
      const variants = {};
      for (const g of type.variantGroups) variants[g.id] = g.options[(k + i) % g.options.length].id;
      players.push({
        id: `demo${i}`,
        nick: `${type.name.split(' ')[0]} ${k + 1}`,
        optionId: `o${i % 4}`,
        character: {
          type: type.id,
          variants,
          color: COLORS[i % COLORS.length].id,
          accessory: ACCESSORIES[i % ACCESSORIES.length].id,
          weapon: WEAPONS[i % WEAPONS.length].id,
        },
      });
      i++;
    }
  }
  const options = [0, 1, 2, 3].map((n) => ({ id: `o${n}`, text: `Opción ${n + 1}`, color: OPTION_COLORS[n] }));

  const wrap = h('div', { class: 'game-root' });
  root.append(wrap);
  const view = new GameView(wrap, { players, options, localId: 'demo0' });
  wrap.append(
    h(
      'div',
      { class: 'hud' },
      h('div', { class: 'hud-top' }, h('div', { class: 'timer' }, 'DEMO')),
      h('a', { class: 'btn hud-exit', href: './' }, 'Salir'),
    ),
  );

  let n = 0;
  const seqs = players.map(() => 0);
  const timer = setInterval(() => {
    n++;
    const t = n / GAME.TICK_RATE;
    const snap = {
      n,
      phase: 'lobby',
      players: players.map((p, idx) => {
        const a = (idx / players.length) * Math.PI * 2 + t * 0.25;
        const r = 4 + Math.sin(t * 0.7 + idx) * 2;
        if (Math.random() < 0.02) seqs[idx]++;
        return {
          id: p.id,
          x: Math.cos(a) * r,
          z: Math.sin(a) * r,
          f: a + Math.PI,
          hp: 100,
          al: 1,
          a: seqs[idx],
          mv: 1,
        };
      }),
    };
    view.pushSnapshot(snap);
  }, 1000 / GAME.TICK_RATE);

  return {
    destroy() {
      clearInterval(timer);
      view.dispose();
    },
  };
}
