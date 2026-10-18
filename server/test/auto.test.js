import { afterEach, describe, expect, it } from 'vitest';
import { AUTO, GAME, NO_LEVEL_MULTIPLIERS, WEAPONS, levelMultipliers, validateCharacter } from '../../shared/index.js';
import { Match } from '../src/match.js';
import { character, collectTicks, emitAck, eventsOf, sleep, startServer, waitFor } from './helpers.js';

let ctx;
afterEach(async () => {
  await ctx?.stop();
  ctx = null;
});

async function autoRoom(options = ['Juan', 'La suegra', 'El perro'], guests = 1) {
  const host = await ctx.connect();
  const res = await emitAck(host, 'room:create', { nick: 'Anfitrion', topic: '¿Quién se robó la tortilla?', options, mode: 'auto' });
  if (!res.ok) throw new Error(res.error);
  const players = [host];
  for (let i = 0; i < guests; i++) {
    const g = await ctx.connect();
    const r = await emitAck(g, 'room:join', { nick: `Mirón${i}`, code: res.code });
    if (!r.ok) throw new Error(r.error);
    players.push(g);
  }
  return { code: res.code, host, players, created: res, room: () => ctx.server.rooms.get(res.code) };
}

describe('Modo automático: sala y lobby', () => {
  it('crea la sala en modo automático y rechaza modos inventados', async () => {
    ctx = await startServer();
    const { created, room } = await autoRoom();
    expect(created.room.mode).toBe('auto');
    expect(room().mode).toBe('auto');
    const s = await ctx.connect();
    expect((await emitAck(s, 'room:create', { nick: 'Ana', topic: 'x', mode: 'battle-royale' })).code).toBe('MODE_INVALID');
    const classic = await emitAck(s, 'room:create', { nick: 'Ana', topic: 'x' });
    expect(classic.room.mode).toBe('classic');
  });

  it('los jugadores solo miran: no eligen personaje ni opción; solo el anfitrión pone respuestas', async () => {
    ctx = await startServer();
    const { host, players, room } = await autoRoom();
    const guest = players[1];
    expect((await emitAck(guest, 'player:character', { character: character() })).code).toBe('AUTO_MODE');
    expect((await emitAck(guest, 'option:choose', { optionId: room().options[0].id })).code).toBe('AUTO_MODE');
    expect((await emitAck(guest, 'option:create', { text: 'El gato' })).code).toBe('NOT_HOST');
    const res = await emitAck(host, 'option:create', { text: 'El gato' });
    expect(res.ok).toBe(true);
    expect(room().players.get(host.id).optionId).toBeNull(); // nadie "defiende" en automático
    expect(room().options).toHaveLength(4);
    expect(room().publicState().players.every((p) => p.ready)).toBe(true);
  });

  it('el anfitrión puede empezar solo, con al menos 2 respuestas', async () => {
    ctx = await startServer();
    const { host, room } = await autoRoom(['Juan'], 0);
    expect((await emitAck(host, 'game:start')).code).toBe('NOT_ENOUGH_OPTIONS');
    await emitAck(host, 'option:create', { text: 'Pedro' });
    const started = waitFor(host, 'game:start');
    expect((await emitAck(host, 'game:start')).ok).toBe(true);
    const data = await started;
    expect(data.mode).toBe('auto');
    expect(room().state).toBe('playing');
  });

  it('un invitado no puede empezar', async () => {
    ctx = await startServer();
    const { players } = await autoRoom();
    expect((await emitAck(players[1], 'game:start')).code).toBe('NOT_HOST');
  });
});

describe('Modo automático: la pelea', () => {
  it('crea un luchador por respuesta con personaje y arma válidos al azar', async () => {
    ctx = await startServer();
    const { host, room } = await autoRoom(['Juan', 'La suegra', 'El perro', 'El gato', 'Doña Tere']);
    const started = waitFor(host, 'game:start');
    await emitAck(host, 'game:start');
    const data = await started;
    expect(data.players).toHaveLength(5);
    expect(data.players.map((p) => p.nick)).toEqual(room().options.map((o) => o.text));
    for (const p of data.players) {
      expect(validateCharacter(p.character)).not.toBeNull();
      expect(p.id.startsWith('bot:')).toBe(true);
    }
    // Los espectadores no son luchadores
    expect(data.players.some((p) => p.id === host.id)).toBe(false);
    expect(new Set(data.players.map((p) => p.optionId)).size).toBe(5);
  });

  it('los espectadores no pueden mover ni atacar a nadie', async () => {
    ctx = await startServer();
    const { host, players, room } = await autoRoom(['Juan', 'Pedro']);
    await emitAck(host, 'game:start');
    host.emit('attack', { x: 1, z: 0 });
    players[1].emit('input', { x: 1, z: 0 });
    await sleep(100);
    const match = room().match;
    expect(match.players.has(host.id)).toBe(false);
    expect(match.players.has(players[1].id)).toBe(false);
    expect(match.setInput(host.id, { x: 1, z: 0 })).toBe(false);
    expect(match.queueAttack(players[1].id, { x: 1, z: 0 })).toBe(false);
  });

  it('no hay límite de 90 s: se pelean solos hasta que queda uno en pie', async () => {
    // Niveles cada 1 s para que la prueba sea rápida; matchSeconds corto para comprobar que se ignora.
    ctx = await startServer({ autoLevelSeconds: 1, matchSeconds: 0.5, countdownSeconds: 0 });
    const options = ['Juan', 'La suegra', 'El perro', 'El gato', 'Doña Tere', 'El vecino', 'Chepe', 'La Niña Rosa'];
    const { host, players, room } = await autoRoom(options, 2);
    const match = () => room().match;
    const errors = [];
    const dead = new Set();
    let ticks = 0;
    let sawNullTime = false;
    host.on('game:tick', (snap) => {
      ticks++;
      if (snap.timeLeft === null) sawNullTime = true;
      if (snap.phase === 'sudden') errors.push('hubo muerte súbita en modo automático');
      for (const p of snap.players) {
        if (p.al && dead.has(p.id)) errors.push(`${p.id} revivió`);
        if (!p.al) dead.add(p.id);
        if (p.hp < 0 || p.hp > GAME.MAX_HP) errors.push(`vida fuera de rango ${p.hp}`);
      }
      errors.push(...match().checkInvariants());
    });
    const started = waitFor(players[2], 'game:start');
    await emitAck(host, 'game:start');
    await started;
    const res = await waitFor(players[2], 'game:over', () => true, 45000);
    expect(errors).toEqual([]);
    expect(sawNullTime).toBe(true);
    expect(ticks).toBeGreaterThan(10);
    expect(['lastStanding', 'draw']).toContain(res.reason);
    const alive = res.players.filter((p) => p.alive);
    expect(alive.length).toBeLessThanOrEqual(1);
    if (res.reason === 'lastStanding') {
      expect(res.winners).toEqual([alive[0].optionId]);
      expect(res.options[0].winner).toBe(true);
    }
    expect(res.players).toHaveLength(8);
    expect(res.level).toBeGreaterThanOrEqual(1);
    expect(res.duration).toBeGreaterThan(0.5); // siguió después del "matchSeconds"
    expect(room().state).toBe('results');
  }, 60000);

  it('cada nivel avisa a todos y sube velocidad, daño y ritmo', async () => {
    ctx = await startServer({ autoLevelSeconds: 0.5, countdownSeconds: 0 });
    const { host, players } = await autoRoom(['Juan', 'Pedro']);
    const ticks = collectTicks(players[1], 1400);
    await emitAck(host, 'game:start');
    const all = await ticks;
    const levels = eventsOf(all, 'level');
    expect(levels.length).toBeGreaterThanOrEqual(1);
    expect(levels[0]).toMatchObject({ level: 2, ...levelMultipliers(2) });
    const lastLevel = all.at(-1).level;
    expect(lastLevel).toBeGreaterThanOrEqual(2);
    const nums = levels.map((e) => e.level);
    expect(nums).toEqual([...nums].sort((a, b) => a - b));
  });

  it('revancha: conserva las respuestas y arma luchadores nuevos', async () => {
    ctx = await startServer({ autoLevelSeconds: 0.5, countdownSeconds: 0 });
    const { host, players, room } = await autoRoom(['Juan', 'Pedro']);
    await emitAck(host, 'game:start');
    await waitFor(host, 'game:over', () => true, 30000);
    expect((await emitAck(players[1], 'game:restart')).code).toBe('NOT_HOST');
    expect((await emitAck(host, 'game:restart')).ok).toBe(true);
    expect(room().state).toBe('lobby');
    expect(room().options.map((o) => o.text)).toEqual(['Juan', 'Pedro']);
    const again = waitFor(players[1], 'game:start');
    expect((await emitAck(host, 'game:start')).ok).toBe(true);
    expect((await again).players).toHaveLength(2);
  }, 40000);
});

describe('Niveles (simulación directa)', () => {
  const knife = WEAPONS.find((w) => w.id === 'knife');
  const mk = (levelSeconds) =>
    new Match({
      players: [
        { id: 'a', nick: 'A', optionId: 'o1', character: { weapon: 'knife' } },
        { id: 'b', nick: 'B', optionId: 'o2', character: { weapon: 'knife' } },
      ],
      options: [
        { id: 'o1', text: 'A' },
        { id: 'o2', text: 'B' },
      ],
      rng: () => 0, // daño mínimo, sin azar
      config: { countdownSeconds: 0, levelSeconds, noTimeLimit: levelSeconds !== null },
    });
  const DT = 1 / GAME.TICK_RATE;

  it('el nivel sube cada N segundos con los multiplicadores de /shared', () => {
    const m = mk(AUTO.LEVEL_SECONDS);
    expect(m.level).toBe(1);
    const steps = Math.round(AUTO.LEVEL_SECONDS / DT);
    const seen = [];
    for (let i = 0; i < steps * 3; i++) seen.push(...m.step(DT).filter((e) => e.type === 'level'));
    expect(seen.map((e) => e.level)).toEqual([2, 3, 4]);
    expect(m.level).toBe(4);
    expect(m.isOver).toBe(false); // sin límite de 90 s
    expect(m.timeLeft).toBe(Infinity);
    // Cada nivel es estrictamente más rápido, más dañino y más seguido que el anterior (hasta el tope)
    for (let l = 1; l < 4; l++) {
      const a = levelMultipliers(l);
      const b = levelMultipliers(l + 1);
      for (const k of ['speed', 'damage', 'rate', 'knockback']) expect(b[k]).toBeGreaterThan(a[k]);
    }
    expect(levelMultipliers(1)).toEqual(AUTO.START);
    expect(levelMultipliers(50).speed).toBe(AUTO.MAX.speed);
    expect(levelMultipliers(50).rate).toBe(AUTO.MAX.rate);
  });

  it('a mayor nivel: más velocidad, más daño y menos cooldown', () => {
    const m = mk(1);
    const a = m.players.get('a');
    const b = m.players.get('b');
    const run = () => {
      a.x = -5;
      a.z = 0;
      b.x = 5;
      b.z = 5;
      m.setInput('a', { x: 0, z: 1 });
      m.step(DT);
      return a.z;
    };
    const v1 = run() / DT;
    expect(v1).toBeCloseTo(GAME.MAX_SPEED * levelMultipliers(1).speed, 5);
    while (m.level < 3) m.step(DT);
    const v3 = run() / DT;
    expect(v3).toBeCloseTo(GAME.MAX_SPEED * levelMultipliers(3).speed, 5);
    expect(v3).toBeGreaterThan(v1);

    // Daño mínimo del cuchillo × multiplicador del nivel 3
    m.setInput('a', { x: 0, z: 0 });
    a.x = 0;
    a.z = 0;
    b.x = 1;
    b.z = 0;
    const hpBefore = b.hp;
    expect(m.queueAttack('a', { x: 1, z: 0 })).toBe(true);
    const ev = m.step(DT).find((e) => e.type === 'hit');
    expect(ev.d).toBe(Math.max(1, Math.round(knife.damage[0] * levelMultipliers(3).damage)));
    expect(b.hp).toBe(hpBefore - ev.d);
    // Cooldown reducido por el ritmo del nivel
    expect(m.cooldownOf(a)).toBeCloseTo(knife.cooldownMs / levelMultipliers(3).rate, 5);
  });

  it('cada golpe empuja fuerte y hacia afuera si el atacante viene del centro', () => {
    const m = mk(30);
    const a = m.players.get('a');
    const b = m.players.get('b');
    a.x = 6;
    a.z = 0;
    b.x = 7;
    b.z = 0;
    m.queueAttack('a', { x: 1, z: 0 });
    m.step(DT);
    // El empuje del nivel 1 en automático es mayor que el del arma sola (clásico).
    // En el mismo tick ya se aplicó un paso de frenado, por eso el factor exp(-decay·dt).
    const decayed = Math.exp(-GAME.KNOCKBACK_DECAY * DT);
    const classicKick = knife.knockback * GAME.KNOCKBACK_DECAY * decayed;
    expect(b.kx).toBeCloseTo(classicKick * AUTO.START.knockback, 5);
    expect(b.kx).toBeGreaterThan(classicKick);
    for (let i = 0; i < 20; i++) m.step(DT);
    expect(b.x).toBeGreaterThan(7 + knife.knockback); // se fue hacia la orilla
  });

  it('los luchadores sacan rivales del ring (no solo ganan por vida)', () => {
    // RNG con semilla para que la prueba sea reproducible
    let seed = 12345;
    const rng = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const causes = { ring: 0, hit: 0 };
    for (let run = 0; run < 15; run++) {
      const options = Array.from({ length: 4 }, (_, i) => ({ id: `o${i}`, text: `R${i}` }));
      const players = options.map((o) => ({ id: `bot:${o.id}`, nick: o.text, optionId: o.id, character: { weapon: WEAPONS[run % 4].id }, bot: true }));
      const m = new Match({ players, options, rng, config: { countdownSeconds: 0, levelSeconds: AUTO.LEVEL_SECONDS, noTimeLimit: true } });
      for (let i = 0; i < 20 * 600 && !m.isOver; i++) m.step(DT);
      expect(m.isOver).toBe(true);
      expect(m.checkInvariants()).toEqual([]);
      for (const p of m.players.values()) if (p.cause) causes[p.cause]++;
    }
    expect(causes.ring).toBeGreaterThan(0);
    expect(causes.ring / (causes.ring + causes.hit)).toBeGreaterThan(0.15);
  });

  it('el modo clásico no tiene niveles', () => {
    const m = mk(null);
    for (let i = 0; i < 200; i++) m.step(DT);
    expect(m.level).toBe(1);
    expect(m.mult).toEqual(NO_LEVEL_MULTIPLIERS); // el clásico va al 100 % siempre
  });
});
