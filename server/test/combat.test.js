import { afterEach, describe, expect, it } from 'vitest';
import { GAME, WEAPONS } from '../../shared/index.js';
import {
  collectTicks,
  emitAck,
  eventsOf,
  place,
  sleep,
  startMatch,
  startServer,
  waitFor,
} from './helpers.js';

const knife = WEAPONS.find((w) => w.id === 'knife');
const DT = 1 / GAME.TICK_RATE;

let ctx;
async function boot(opts) {
  ctx = await startServer(opts);
  return ctx;
}
afterEach(async () => {
  await ctx?.stop();
  ctx = null;
});

const waitHit = (socket, attackerId, timeout = 2000) =>
  waitFor(socket, 'game:tick', (t) => t.events.some((e) => e.type === 'hit' && e.a === attackerId), timeout).then((t) =>
    t.events.find((e) => e.type === 'hit' && e.a === attackerId),
  );

describe('Inicio de partida', () => {
  it('el anfitrión inicia: todos reciben game:start y empiezan con 100 de vida', async () => {
    await boot();
    const m = await startMatch(ctx, ['Juan', 'Pedro', 'Juan']);
    expect(m.room().state).toBe('playing');
    expect(m.startData.players).toHaveLength(3);
    expect(m.startData.snapshot.players.every((p) => p.hp === 100 && p.al === 1)).toBe(true);
    // Nadie empieza fuera del ring
    for (const p of m.startData.snapshot.players) expect(Math.hypot(p.x, p.z)).toBeLessThan(GAME.RING_RADIUS);
    // Durante la pelea no se puede cambiar de opción, personaje ni unirse
    expect((await emitAck(m.players[1], 'option:create', { text: 'Otra' })).code).toBe('WRONG_STATE');
    const late = await ctx.connect();
    expect((await emitAck(late, 'room:join', { nick: 'Tarde', code: m.code })).code).toBe('ROOM_BUSY');
    expect((await emitAck(m.host, 'game:start')).code).toBe('WRONG_STATE');
  });

  it('respeta la cuenta regresiva: no hay acciones antes del ¡ya!', async () => {
    await boot({ countdownSeconds: 0.5 });
    const m = await startMatch(ctx, ['Juan', 'Pedro']);
    const [a] = m.ids;
    const before = { ...m.match.players.get(a) };
    m.host.emit('input', { x: 1, z: 0 });
    m.host.emit('attack', { x: 1, z: 0 });
    await sleep(200);
    expect(m.match.phase).toBe('countdown');
    expect(m.match.players.get(a).x).toBe(before.x);
    expect(m.match.players.get(a).attackSeq).toBe(0);
    await waitFor(m.host, 'game:tick', (t) => t.phase === 'main');
  });
});

describe('Movimiento', () => {
  it('respeta la velocidad máxima aunque el cliente mande un vector gigante', async () => {
    await boot();
    const m = await startMatch(ctx, ['Juan', 'Pedro']);
    const [a, b] = m.ids;
    place(m.match, a, -5, 0);
    place(m.match, b, 0, 8);
    m.host.emit('input', { x: 0, z: -1000 });
    const ticks = await collectTicks(m.host, 700);
    const mine = ticks.map((t) => ({ n: t.n, ...t.players.find((p) => p.id === a) }));
    expect(mine.length).toBeGreaterThan(5);
    for (let i = 1; i < mine.length; i++) {
      const steps = mine[i].n - mine[i - 1].n;
      const d = Math.hypot(mine[i].x - mine[i - 1].x, mine[i].z - mine[i - 1].z);
      expect(d).toBeLessThanOrEqual(GAME.MAX_SPEED * DT * steps + 0.02);
    }
    // Sí se movió (en -z)
    expect(mine.at(-1).z).toBeLessThan(mine[0].z - 1);
  });

  it('ignora entradas inválidas (NaN, strings, objetos raros)', async () => {
    await boot();
    const m = await startMatch(ctx, ['Juan', 'Pedro']);
    const [a] = m.ids;
    place(m.match, a, 0, 0);
    for (const bad of [{ x: 'a', z: 1 }, { x: NaN, z: 0 }, null, 'arriba', { x: Infinity, z: 0 }]) m.host.emit('input', bad);
    await sleep(200);
    const p = m.match.players.get(a);
    expect(p.x).toBe(0);
    expect(p.z).toBe(0);
  });

  it('caminando no se puede salir del ring', async () => {
    await boot();
    const m = await startMatch(ctx, ['Juan', 'Pedro']);
    const [a, b] = m.ids;
    place(m.match, a, 7, 0);
    place(m.match, b, -7, 0);
    m.host.emit('input', { x: 1, z: 0.2 });
    const ticks = await collectTicks(m.host, 1200);
    for (const t of ticks) {
      const p = t.players.find((x) => x.id === a);
      expect(p.al).toBe(1);
      expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(GAME.RING_RADIUS - GAME.PLAYER_RADIUS + 0.02);
    }
    expect(m.match.players.get(a).alive).toBe(true);
  });

  it('los enemigos chocan y los aliados se atraviesan', async () => {
    await boot();
    const m = await startMatch(ctx, ['Juan', 'Pedro', 'Juan']);
    const [a, b, c] = m.ids;
    place(m.match, a, 0, 0);
    place(m.match, c, 0.1, 0); // aliado encimado
    place(m.match, b, -6, 6);
    await sleep(150);
    const pa = m.match.players.get(a);
    const pc = m.match.players.get(c);
    expect(Math.hypot(pa.x - pc.x, pa.z - pc.z)).toBeLessThan(0.2);
    place(m.match, b, 0, 0.1); // enemigo encimado
    await sleep(150);
    const pb = m.match.players.get(b);
    expect(Math.hypot(pa.x - pb.x, pa.z - pb.z)).toBeGreaterThanOrEqual(GAME.PLAYER_RADIUS * 2 - 0.01);
  });
});

describe('Ataque', () => {
  it('el daño lo calcula el servidor según el arma (ignora lo que mande el cliente)', async () => {
    await boot();
    const m = await startMatch(ctx, ['Juan', 'Pedro']);
    const [a, b] = m.ids;
    place(m.match, a, 0, 0);
    place(m.match, b, 1, 0);
    const hit = waitHit(m.host, a);
    m.host.emit('attack', { x: 1, z: 0, damage: 9999, hp: 0 });
    const ev = await hit;
    expect(ev.v).toBe(b);
    expect(ev.d).toBeGreaterThanOrEqual(knife.damage[0]);
    expect(ev.d).toBeLessThanOrEqual(knife.damage[1]);
    expect(m.match.players.get(b).hp).toBe(100 - ev.d);
  });

  it('respeta el cooldown: ataques seguidos se ignoran', async () => {
    await boot();
    const m = await startMatch(ctx, ['Juan', 'Pedro']);
    const [a, b] = m.ids;
    place(m.match, a, 0, 0);
    place(m.match, b, 1, 0);
    const ticks = collectTicks(m.host, 300);
    for (let i = 0; i < 6; i++) m.host.emit('attack', { x: 1, z: 0 });
    const hits = eventsOf(await ticks, 'hit').filter((e) => e.a === a);
    expect(hits).toHaveLength(1);
    expect(m.match.players.get(a).attackSeq).toBe(1);
    // Pasado el cooldown, vuelve a pegar
    await sleep(knife.cooldownMs);
    place(m.match, b, 1, 0);
    const again = waitHit(m.host, a);
    m.host.emit('attack', { x: 1, z: 0 });
    await again;
    expect(m.match.players.get(a).attackSeq).toBe(2);
  });

  it('respeta el alcance y la dirección', async () => {
    await boot();
    const m = await startMatch(ctx, ['Juan', 'Pedro']);
    const [a, b] = m.ids;
    // Muy lejos
    place(m.match, a, 0, 0);
    place(m.match, b, knife.range + GAME.PLAYER_RADIUS + 1, 0);
    let ticks = collectTicks(m.host, 250);
    m.host.emit('attack', { x: 1, z: 0 });
    expect(eventsOf(await ticks, 'hit')).toHaveLength(0);
    expect(m.match.players.get(b).hp).toBe(100);
    // Cerca pero a la espalda
    await sleep(knife.cooldownMs);
    place(m.match, b, -1.2, 0);
    ticks = collectTicks(m.host, 250);
    m.host.emit('attack', { x: 1, z: 0 });
    expect(eventsOf(await ticks, 'hit')).toHaveLength(0);
    expect(m.match.players.get(b).hp).toBe(100);
    // Justo en el borde del alcance sí pega
    await sleep(knife.cooldownMs);
    place(m.match, b, knife.range + GAME.PLAYER_RADIUS - 0.05, 0);
    const hit = waitHit(m.host, a);
    m.host.emit('attack', { x: 1, z: 0 });
    expect((await hit).v).toBe(b);
  });

  it('no se puede dañar a un aliado', async () => {
    await boot();
    const m = await startMatch(ctx, ['Juan', 'Pedro', 'Juan']);
    const [a, b, c] = m.ids;
    place(m.match, a, 0, 0);
    place(m.match, c, 1, 0);
    place(m.match, b, -7, -5);
    const ticks = collectTicks(m.host, 300);
    m.host.emit('attack', { x: 1, z: 0 });
    expect(eventsOf(await ticks, 'hit')).toHaveLength(0);
    expect(m.match.players.get(c).hp).toBe(100);
    expect(m.match.players.get(a).attackSeq).toBe(1);
  });

  it('el empuje (knockback) aleja a la víctima', async () => {
    await boot();
    const m = await startMatch(ctx, ['Juan', 'Pedro'], { weapons: ['shortsword', 'knife'] });
    const [a, b] = m.ids;
    place(m.match, a, 0, 0);
    place(m.match, b, 1, 0);
    const hit = waitHit(m.host, a);
    m.host.emit('attack', { x: 1, z: 0 });
    await hit;
    await sleep(500);
    expect(m.match.players.get(b).x).toBeGreaterThan(2);
  });

  it('ataques fuera de partida o de un eliminado se ignoran', async () => {
    await boot();
    const m = await startMatch(ctx, ['Juan', 'Pedro', 'Pedro']);
    const [a, b, c] = m.ids;
    m.match.players.get(c).hp = 1;
    place(m.match, a, 0, 0);
    place(m.match, c, 1, 0);
    place(m.match, b, -7, 0);
    const elim = waitFor(m.host, 'game:tick', (t) => t.events.some((e) => e.type === 'elim' && e.v === c));
    m.host.emit('attack', { x: 1, z: 0 });
    await elim;
    // El eliminado intenta pegar y moverse
    place(m.match, a, 0, 0);
    const deadX = m.match.players.get(c).x;
    const ticks = collectTicks(m.host, 250);
    m.players[2].emit('attack', { x: -1, z: 0 });
    m.players[2].emit('input', { x: 1, z: 0 });
    expect(eventsOf(await ticks, 'hit')).toHaveLength(0);
    expect(m.match.players.get(c).x).toBe(deadX);
    expect(m.match.players.get(a).hp).toBe(100);
  });
});

describe('Eliminación y victoria', () => {
  it('caerse del ring elimina al jugador', async () => {
    await boot();
    const m = await startMatch(ctx, ['Juan', 'Pedro', 'Pedro'], { weapons: ['shortsword'] });
    const [a, b, c] = m.ids;
    place(m.match, a, 8.2, 0);
    place(m.match, b, 9.3, 0);
    place(m.match, c, -8, 0);
    const elim = waitFor(m.host, 'game:tick', (t) => t.events.some((e) => e.type === 'elim' && e.v === b), 3000);
    m.host.emit('attack', { x: 1, z: 0 });
    const tick = await elim;
    const ev = tick.events.find((e) => e.type === 'elim');
    expect(ev.cause).toBe('ring');
    expect(ev.by).toBe(a); // se le acredita al que empujó
    const pb = m.match.players.get(b);
    expect(pb.alive).toBe(false);
    expect(pb.hp).toBe(0);
    expect(Math.hypot(pb.x, pb.z)).toBeGreaterThan(GAME.RING_RADIUS);
    expect(m.room().state).toBe('playing'); // c sigue vivo
  });

  it('último en pie gana', async () => {
    await boot();
    const m = await startMatch(ctx, ['Juan', 'Pedro']);
    const [a, b] = m.ids;
    m.match.players.get(b).hp = 3;
    place(m.match, a, 0, 0);
    place(m.match, b, 1, 0);
    const over = waitFor(m.players[1], 'game:over');
    m.host.emit('attack', { x: 1, z: 0 });
    const res = await over;
    const juan = m.room().options.find((o) => o.text === 'Juan');
    expect(res.winners).toEqual([juan.id]);
    expect(res.reason).toBe('lastStanding');
    expect(res.players[0].id).toBe(a);
    expect(res.players[0].kills).toBe(1);
    expect(res.options[0].optionId).toBe(juan.id);
    expect(res.topic).toBe(m.room().topic);
    expect(m.room().state).toBe('results');
  });

  it('si todos los vivos son de la misma opción, gana esa opción', async () => {
    await boot();
    const m = await startMatch(ctx, ['Juan', 'Pedro', 'Juan']);
    const [a, b, c] = m.ids;
    m.match.players.get(b).hp = 2;
    place(m.match, a, 0, 0);
    place(m.match, b, 1, 0);
    place(m.match, c, -5, -5);
    const over = waitFor(m.host, 'game:over');
    m.host.emit('attack', { x: 1, z: 0 });
    const res = await over;
    const juan = m.room().options.find((o) => o.text === 'Juan');
    expect(res.winners).toEqual([juan.id]);
    expect(res.reason).toBe('sameOption');
    expect(res.options.find((o) => o.optionId === juan.id)).toMatchObject({ alive: 2, place: 1, winner: true });
  });

  it('tiempo agotado: gana la opción con más vida total', async () => {
    await boot({ matchSeconds: 0.8 });
    const m = await startMatch(ctx, ['Juan', 'Pedro', 'Pedro']);
    const [a, b, c] = m.ids;
    // Juan: 90 | Pedro: 40 + 45 = 85
    m.match.players.get(a).hp = 90;
    m.match.players.get(b).hp = 40;
    m.match.players.get(c).hp = 45;
    const res = await waitFor(m.host, 'game:over', () => true, 4000);
    const juan = m.room().options.find((o) => o.text === 'Juan');
    expect(res.reason).toBe('time');
    expect(res.winners).toEqual([juan.id]);
    expect(res.options.find((o) => o.optionId === juan.id).hp).toBe(90);
  });

  it('empate al acabar el tiempo activa muerte súbita y cualquier golpe elimina', async () => {
    await boot({ matchSeconds: 0.5, suddenDeathSeconds: 5 });
    const m = await startMatch(ctx, ['Juan', 'Pedro']);
    const [a, b] = m.ids;
    place(m.match, a, -5, 0);
    place(m.match, b, 5, 0);
    const sudden = await waitFor(m.host, 'game:tick', (t) => t.events.some((e) => e.type === 'sudden'), 3000);
    expect(sudden.phase).toBe('sudden');
    expect(sudden.timeLeft).toBeGreaterThan(4);
    expect(m.match.players.get(b).hp).toBe(100);
    place(m.match, a, 0, 0);
    place(m.match, b, 1, 0);
    const over = waitFor(m.host, 'game:over');
    m.host.emit('attack', { x: 1, z: 0 });
    const res = await over;
    expect(res.reason).toBe('lastStanding');
    expect(m.match.players.get(b).alive).toBe(false);
    const hit = m.match.players.get(a).damageDealt;
    expect(hit).toBe(100);
  });

  it('si la muerte súbita también termina empatada, es empate', async () => {
    await boot({ matchSeconds: 0.3, suddenDeathSeconds: 0.4 });
    const m = await startMatch(ctx, ['Juan', 'Pedro']);
    const res = await waitFor(m.host, 'game:over', () => true, 4000);
    expect(res.reason).toBe('draw');
    expect(res.winners).toHaveLength(2);
  });
});

describe('Desconexiones durante la partida', () => {
  it('el que se va queda eliminado y el resto sigue peleando', async () => {
    await boot();
    const m = await startMatch(ctx, ['Juan', 'Pedro', 'Chepe']);
    const [, , c] = m.ids;
    const elim = waitFor(m.host, 'game:tick', (t) => t.events.some((e) => e.type === 'elim' && e.v === c));
    m.players[2].disconnect();
    const tick = await elim;
    expect(tick.events.find((e) => e.v === c).cause).toBe('left');
    expect(tick.players.find((p) => p.id === c).al).toBe(0);
    await sleep(200);
    expect(m.room().state).toBe('playing');
    expect(m.room().players.has(c)).toBe(false);
    const more = await collectTicks(m.host, 200);
    expect(more.length).toBeGreaterThan(1);
  });

  it('si el anfitrión se va en plena pelea, se reasigna y la pelea sigue', async () => {
    await boot();
    const m = await startMatch(ctx, ['Juan', 'Pedro', 'Chepe']);
    const state = waitFor(m.players[1], 'room:state', (s) => s.players.length === 2);
    m.host.disconnect();
    expect((await state).hostId).toBe(m.ids[1]);
    expect(m.room().state).toBe('playing');
  });

  it('si queda una sola opción por desconexión, esa gana', async () => {
    await boot();
    const m = await startMatch(ctx, ['Juan', 'Pedro']);
    const over = waitFor(m.host, 'game:over');
    m.players[1].disconnect();
    const res = await over;
    expect(res.winners).toEqual([m.room().options.find((o) => o.text === 'Juan').id]);
    expect(res.players.find((p) => p.id === m.ids[1]).left).toBe(true);
  });
});

describe('Revancha', () => {
  async function finishedMatch() {
    await boot();
    const m = await startMatch(ctx, ['Juan', 'Pedro', 'Pedro'], { weapons: ['dagger', 'shortsword', 'switchblade'] });
    const [a, b, c] = m.ids;
    m.match.players.get(a).hp = 1;
    place(m.match, b, 0, 0);
    place(m.match, a, 1, 0);
    place(m.match, c, -6, -6);
    const over = waitFor(m.host, 'game:over');
    m.players[1].emit('attack', { x: 1, z: 0 });
    await over;
    return m;
  }

  it('solo el anfitrión puede reiniciar', async () => {
    const m = await finishedMatch();
    expect((await emitAck(m.players[1], 'game:restart')).code).toBe('NOT_HOST');
    expect(m.room().state).toBe('results');
  });

  it('no se puede reiniciar en plena pelea', async () => {
    await boot();
    const m = await startMatch(ctx, ['Juan', 'Pedro']);
    expect((await emitAck(m.host, 'game:restart')).code).toBe('WRONG_STATE');
  });

  it('conserva personajes y opciones, deja cambiar de opción y volver a pelear', async () => {
    const m = await finishedMatch();
    const room = m.room();
    const before = [...room.players.values()].map((p) => ({ id: p.id, character: p.character, optionId: p.optionId }));
    const optionsBefore = room.options.map((o) => o.text);
    const lobby = waitFor(m.players[2], 'room:state', (s) => s.state === 'lobby');
    expect((await emitAck(m.host, 'game:restart')).ok).toBe(true);
    const st = await lobby;
    expect(st.options.map((o) => o.text)).toEqual(optionsBefore);
    for (const p of before) {
      const now = st.players.find((x) => x.id === p.id);
      expect(now.character).toEqual(p.character);
      expect(now.optionId).toBe(p.optionId);
      expect(now.ready).toBe(true);
    }
    expect(st.players.find((p) => p.id === m.ids[0]).character.weapon).toBe('dagger');
    // Cambiar de opción antes de empezar
    const juan = room.options.find((o) => o.text === 'Juan');
    expect((await emitAck(m.players[2], 'option:choose', { optionId: juan.id })).ok).toBe(true);
    // Volver a pelear
    const started = waitFor(m.players[1], 'game:start');
    expect((await emitAck(m.host, 'game:start')).ok).toBe(true);
    const data = await started;
    expect(data.snapshot.players.every((p) => p.hp === 100 && p.al === 1)).toBe(true);
    expect(data.players.find((p) => p.id === m.ids[2]).optionId).toBe(juan.id);
  });
});

describe('Tasa de ticks', () => {
  it('no emite más de 30 actualizaciones por segundo (aunque se configure más)', async () => {
    await boot({ tickRate: 120 });
    expect(ctx.server.config.tickRate).toBeLessThanOrEqual(30);
    const m = await startMatch(ctx, ['Juan', 'Pedro']);
    const ticks = await collectTicks(m.host, 2000);
    expect(ticks.length).toBeLessThanOrEqual(61);
    expect(ticks.length).toBeGreaterThan(40);
    // Ninguna ventana de 1 s tiene más de 30
    const times = [];
    const t0 = Date.now();
    await new Promise((resolve) => {
      const h = () => times.push(Date.now() - t0);
      m.host.on('game:tick', h);
      setTimeout(() => {
        m.host.off('game:tick', h);
        resolve();
      }, 2000);
    });
    for (let i = 0; i < times.length; i++) {
      const inWindow = times.filter((t) => t >= times[i] && t < times[i] + 1000).length;
      expect(inWindow).toBeLessThanOrEqual(31);
    }
  });

  it('con la configuración por defecto va a 20 ticks/s', async () => {
    await boot();
    const m = await startMatch(ctx, ['Juan', 'Pedro']);
    const ticks = await collectTicks(m.host, 1000);
    expect(ticks.length).toBeLessThanOrEqual(GAME.TICK_RATE + 1);
    expect(ticks.length).toBeGreaterThanOrEqual(GAME.TICK_RATE - 4);
  });
});
