import { afterEach, describe, expect, it } from 'vitest';
import { GAME, WEAPONS } from '../../shared/index.js';
import { startMatch, startServer, waitFor } from './helpers.js';

let ctx;
afterEach(async () => {
  await ctx?.stop();
  ctx = null;
});

// Bot sencillo: persigue al enemigo vivo más cercano y le pega cuando lo tiene cerca.
function makeBot(socket, myId, myOption, optionOf, weaponRange) {
  let last = null;
  const onTick = (snap) => {
    last = snap;
  };
  socket.on('game:tick', onTick);
  const timer = setInterval(() => {
    if (!last) return;
    const me = last.players.find((p) => p.id === myId);
    if (!me || !me.al) return;
    let target = null;
    let best = Infinity;
    for (const p of last.players) {
      if (!p.al || p.id === myId || optionOf[p.id] === myOption) continue;
      const d = Math.hypot(p.x - me.x, p.z - me.z);
      if (d < best) {
        best = d;
        target = p;
      }
    }
    if (!target) {
      socket.emit('input', { x: 0, z: 0 });
      return;
    }
    const dx = target.x - me.x;
    const dz = target.z - me.z;
    // Un poco de ruido para que no sea perfecto
    const jitter = (Math.random() - 0.5) * 0.6;
    socket.emit('input', { x: dx / best + jitter, z: dz / best - jitter });
    if (best < weaponRange + GAME.PLAYER_RADIUS) socket.emit('attack', { x: dx, z: dz });
  }, 100);
  return () => {
    clearInterval(timer);
    socket.off('game:tick', onTick);
  };
}

describe('Simulación completa', () => {
  it('8 bots con 4 opciones juegan hasta el final sin errores ni estados inconsistentes', async () => {
    ctx = await startServer({ matchSeconds: 25, suddenDeathSeconds: 6, countdownSeconds: 0.3 });
    const assign = ['Juan', 'La suegra', 'El perro', 'El gato', 'Juan', 'La suegra', 'El perro', 'El gato'];
    const weapons = ['knife', 'dagger', 'switchblade', 'shortsword', 'shortsword', 'switchblade', 'dagger', 'knife'];
    const m = await startMatch(ctx, assign, { weapons });
    const room = m.room();
    const match = m.match;
    expect(room.options).toHaveLength(4);
    expect(m.startData.players).toHaveLength(8);

    const optionOf = Object.fromEntries(m.startData.players.map((p) => [p.id, p.optionId]));
    const stops = m.players.map((s, i) =>
      makeBot(s, m.ids[i], optionOf[m.ids[i]], optionOf, WEAPONS.find((w) => w.id === weapons[i]).range),
    );

    // Observador: revisa cada tick que el estado sea coherente.
    const errors = [];
    const deadSeen = new Set();
    let lastN = -1;
    let lastAlive = 8;
    let ticks = 0;
    m.host.on('game:tick', (snap) => {
      ticks++;
      if (snap.n <= lastN) errors.push(`tick fuera de orden ${snap.n} <= ${lastN}`);
      lastN = snap.n;
      if (snap.players.length !== 8) errors.push(`faltan jugadores en el snapshot: ${snap.players.length}`);
      let alive = 0;
      for (const p of snap.players) {
        if (![p.x, p.z, p.f, p.hp].every(Number.isFinite)) errors.push(`valor no finito en ${p.id}`);
        if (p.hp < 0 || p.hp > GAME.MAX_HP) errors.push(`vida fuera de rango ${p.hp}`);
        if (p.al) {
          alive++;
          if (deadSeen.has(p.id)) errors.push(`${p.id} revivió`);
          if (p.hp <= 0) errors.push(`${p.id} vivo con 0 de vida`);
          if (Math.hypot(p.x, p.z) > GAME.RING_RADIUS + 1e-6) errors.push(`${p.id} vivo fuera del ring`);
        } else deadSeen.add(p.id);
      }
      if (alive > lastAlive) errors.push('aumentaron los vivos');
      lastAlive = alive;
      for (const e of snap.events) {
        if (e.type === 'hit' && optionOf[e.a] === optionOf[e.v]) errors.push('daño entre aliados');
      }
      errors.push(...match.checkInvariants());
    });

    const res = await waitFor(m.host, 'game:over', () => true, 40000);
    stops.forEach((s) => s());

    expect(errors).toEqual([]);
    expect(ticks).toBeGreaterThan(5);
    expect(room.state).toBe('results');
    expect(match.isOver).toBe(true);
    expect(['lastStanding', 'sameOption', 'time', 'suddenDeath', 'draw']).toContain(res.reason);
    expect(res.winners.length).toBeGreaterThanOrEqual(1);
    for (const w of res.winners) expect(room.options.some((o) => o.id === w)).toBe(true);
    expect(res.players).toHaveLength(8);
    expect(res.options).toHaveLength(4);
    expect(res.players.map((p) => p.place)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(res.options.map((o) => o.place)).toEqual([1, 2, 3, 4]);
    expect(res.options[0].winner).toBe(true);
    // Coherencia del resultado: si ganó por eliminación, solo quedan vivos del bando ganador
    if (res.reason === 'lastStanding' || res.reason === 'sameOption') {
      for (const p of res.players) if (p.alive) expect(res.winners).toContain(p.optionId);
    }
    const totalKills = res.players.reduce((s, p) => s + p.kills, 0);
    const deaths = res.players.filter((p) => !p.alive).length;
    expect(totalKills).toBeLessThanOrEqual(deaths);
    // Hubo pelea de verdad
    expect(res.players.some((p) => p.damage > 0)).toBe(true);
    // El servidor sigue sano: se puede pedir revancha
    expect(ctx.server.rooms.get(m.code)).toBeDefined();
  }, 60000);
});
