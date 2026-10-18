import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ROOM_CODE_ALPHABET } from '../../shared/index.js';
import { character, emitAck, readyUp, setupRoom, sleep, startServer, waitFor } from './helpers.js';

let ctx;
beforeEach(async () => {
  ctx = await startServer();
});
afterEach(async () => {
  await ctx.stop();
});

describe('Crear sala', () => {
  it('devuelve código válido, anfitrión correcto y tema guardado', async () => {
    const s = await ctx.connect();
    const res = await emitAck(s, 'room:create', { nick: 'Ana', topic: '¿Quién se robó la última tortilla?' });
    expect(res.ok).toBe(true);
    expect(res.code).toMatch(/^[A-Z]{5}$/);
    for (const ch of res.code) expect(ROOM_CODE_ALPHABET).toContain(ch);
    expect(res.code).not.toMatch(/[0O1I]/);
    expect(res.room.hostId).toBe(s.id);
    expect(res.playerId).toBe(s.id);
    expect(res.room.topic).toBe('¿Quién se robó la última tortilla?');
    expect(ctx.server.rooms.get(res.code).topic).toBe('¿Quién se robó la última tortilla?');
  });

  it('acepta opciones iniciales y limpia textos', async () => {
    const s = await ctx.connect();
    const res = await emitAck(s, 'room:create', {
      nick: '  Ana\u0007  ',
      topic: 'Tema\n  con   saltos',
      options: ['Juan', 'La suegra', 'El perro'],
    });
    expect(res.ok).toBe(true);
    expect(res.room.players[0].nick).toBe('Ana');
    expect(res.room.topic).toBe('Tema con saltos');
    expect(res.room.options.map((o) => o.text)).toEqual(['Juan', 'La suegra', 'El perro']);
  });

  it('rechaza apodo, tema y opciones iniciales inválidos', async () => {
    const s = await ctx.connect();
    expect((await emitAck(s, 'room:create', { nick: 'A', topic: 'x' })).code).toBe('NICK_INVALID');
    expect((await emitAck(s, 'room:create', { nick: 'Ana'.repeat(5), topic: 'x' })).code).toBe('NICK_INVALID');
    expect((await emitAck(s, 'room:create', { nick: 'Ana', topic: '' })).code).toBe('TOPIC_INVALID');
    expect((await emitAck(s, 'room:create', { nick: 'Ana', topic: 'x'.repeat(81) })).code).toBe('TOPIC_INVALID');
    expect((await emitAck(s, 'room:create', { nick: 'Ana', topic: 'x', options: ['Juan', 'JUÁN'] })).code).toBe(
      'OPTION_DUPLICATE',
    );
    expect((await emitAck(s, 'room:create', { nick: 123, topic: { a: 1 } })).code).toBe('NICK_INVALID');
    expect(ctx.server.rooms.size).toBe(0);
  });
});

describe('Unirse', () => {
  it('se une con código válido (también en minúsculas)', async () => {
    const { code, host } = await setupRoom(ctx, { n: 1 });
    const g = await ctx.connect();
    const update = waitFor(host, 'room:state', (st) => st.players.length === 2);
    const res = await emitAck(g, 'room:join', { nick: 'Luis', code: code.toLowerCase() });
    expect(res.ok).toBe(true);
    expect(res.room.players.map((p) => p.nick)).toEqual(['Anfitrion', 'Luis']);
    await update;
  });

  it('rechaza códigos inválidos o inexistentes', async () => {
    await setupRoom(ctx, { n: 1 });
    const g = await ctx.connect();
    expect((await emitAck(g, 'room:join', { nick: 'Luis', code: 'AB1' })).code).toBe('CODE_INVALID');
    expect((await emitAck(g, 'room:join', { nick: 'Luis', code: 'AAAA0' })).code).toBe('CODE_INVALID');
    expect((await emitAck(g, 'room:join', { nick: 'Luis', code: 'ZZZZZ' })).code).toBe('ROOM_NOT_FOUND');
  });

  it('rechaza apodo repetido en la misma sala', async () => {
    const { code } = await setupRoom(ctx, { n: 1 });
    const g = await ctx.connect();
    expect((await emitAck(g, 'room:join', { nick: 'anfitrión', code })).code).toBe('NICK_TAKEN');
  });

  it('rechaza a la novena persona', async () => {
    const { code } = await setupRoom(ctx, { n: 8 });
    const ninth = await ctx.connect();
    const res = await emitAck(ninth, 'room:join', { nick: 'Noveno', code });
    expect(res.ok).toBe(false);
    expect(res.code).toBe('ROOM_FULL');
    expect(ctx.server.rooms.get(code).players.size).toBe(8);
  });
});

describe('Personaje', () => {
  it('acepta ID válido', async () => {
    const { host } = await setupRoom(ctx, { n: 1 });
    const res = await emitAck(host, 'player:character', {
      character: { type: 'animal', variants: { species: 'owl' }, color: 'pink', accessory: 'crown', weapon: 'shortsword' },
    });
    expect(res.ok).toBe(true);
    expect(res.character.variants.species).toBe('owl');
  });

  it('rechaza IDs inválidos', async () => {
    const { host, room } = await setupRoom(ctx, { n: 1 });
    const bad = [
      character({ type: 'dragon' }),
      character({ weapon: 'bazooka' }),
      character({ color: '#000' }),
      character({ accessory: 'capa' }),
      character({ variants: { skin: 'skin9', hair: 'short' } }),
      character({ variants: { skin: 'skin1', hair: 'short', extra: 'x' } }),
      { type: 'robot', variants: { species: 'fox' }, color: 'red', accessory: 'none', weapon: 'knife' },
      'humano',
      null,
    ];
    for (const c of bad) {
      const res = await emitAck(host, 'player:character', { character: c });
      expect(res.code).toBe('CHARACTER_INVALID');
    }
    expect(room().players.get(host.id).character).toBeNull();
  });
});

describe('Opciones', () => {
  it('acepta una opción nueva y asigna al creador', async () => {
    const { host, room } = await setupRoom(ctx, { n: 1 });
    const res = await emitAck(host, 'option:create', { text: '  La   suegra ' });
    expect(res.ok).toBe(true);
    expect(room().options[0].text).toBe('La suegra');
    expect(room().players.get(host.id).optionId).toBe(res.optionId);
  });

  it('rechaza duplicados con mayúsculas, acentos o espacios distintos', async () => {
    const { host } = await setupRoom(ctx, { n: 1 });
    expect((await emitAck(host, 'option:create', { text: 'La suegra' })).ok).toBe(true);
    for (const t of ['la suegra', 'LA SUEGRA', 'La Suégra', '  la   suegra  ', 'lá súegrá']) {
      expect((await emitAck(host, 'option:create', { text: t })).code).toBe('OPTION_DUPLICATE');
    }
  });

  it('rechaza textos vacíos o muy largos', async () => {
    const { host } = await setupRoom(ctx, { n: 1 });
    expect((await emitAck(host, 'option:create', { text: '   ' })).code).toBe('OPTION_INVALID');
    expect((await emitAck(host, 'option:create', { text: 'x'.repeat(41) })).code).toBe('OPTION_INVALID');
    expect((await emitAck(host, 'option:create', { text: 'x'.repeat(40) })).ok).toBe(true);
  });

  it('rechaza la novena opción', async () => {
    const { host, room } = await setupRoom(ctx, { n: 1 });
    for (let i = 1; i <= 8; i++) {
      expect((await emitAck(host, 'option:create', { text: `Opción ${i}` })).ok).toBe(true);
    }
    const res = await emitAck(host, 'option:create', { text: 'Opción 9' });
    expect(res.code).toBe('OPTION_LIMIT');
    expect(room().options.length).toBe(8);
  });

  it('el cambio de opción en el lobby se refleja en todos los clientes', async () => {
    const setup = await setupRoom(ctx, { n: 3, options: ['Juan', 'La suegra'] });
    const [a, b, c] = setup.players;
    const [juan, suegra] = setup.room().options;
    await emitAck(a, 'option:choose', { optionId: juan.id });
    const seenB = waitFor(b, 'room:state', (st) => st.players.find((p) => p.id === a.id).optionId === suegra.id);
    const seenC = waitFor(c, 'room:state', (st) => st.players.find((p) => p.id === a.id).optionId === suegra.id);
    const res = await emitAck(a, 'option:choose', { optionId: suegra.id });
    expect(res.ok).toBe(true);
    const [stB, stC] = await Promise.all([seenB, seenC]);
    expect(stB.options.find((o) => o.id === suegra.id).count).toBe(1);
    expect(stC.options.find((o) => o.id === juan.id).count).toBe(0);
  });

  it('rechaza elegir una opción inexistente', async () => {
    const { host } = await setupRoom(ctx, { n: 1 });
    expect((await emitAck(host, 'option:choose', { optionId: 'o99' })).code).toBe('OPTION_NOT_FOUND');
  });

  it('solo el anfitrión borra opciones y solo si nadie las defiende', async () => {
    const setup = await setupRoom(ctx, { n: 2, options: ['Juan', 'Pedro'] });
    const [host, guest] = setup.players;
    const [juan, pedro] = setup.room().options;
    await emitAck(guest, 'option:choose', { optionId: juan.id });
    expect((await emitAck(guest, 'option:remove', { optionId: pedro.id })).code).toBe('NOT_HOST');
    expect((await emitAck(host, 'option:remove', { optionId: juan.id })).code).toBe('OPTION_IN_USE');
    expect((await emitAck(host, 'option:remove', { optionId: pedro.id })).ok).toBe(true);
    expect(setup.room().options.map((o) => o.text)).toEqual(['Juan']);
  });
});

describe('Seguridad', () => {
  it('un cliente solo cambia su propio personaje y opción', async () => {
    const setup = await setupRoom(ctx, { n: 2, options: ['Juan', 'Pedro'] });
    const [host, guest] = setup.players;
    const room = setup.room();
    // Intentos de suplantación: el servidor ignora cualquier id que venga en el mensaje.
    await emitAck(guest, 'player:character', { id: host.id, playerId: host.id, character: character({ color: 'red' }) });
    await emitAck(guest, 'option:choose', { id: host.id, playerId: host.id, optionId: room.options[1].id });
    expect(room.players.get(host.id).character).toBeNull();
    expect(room.players.get(host.id).optionId).toBeNull();
    expect(room.players.get(guest.id).character.color).toBe('red');
    expect(room.players.get(guest.id).optionId).toBe(room.options[1].id);
  });

  it('sin sala no se puede hacer nada', async () => {
    const s = await ctx.connect();
    expect((await emitAck(s, 'player:character', { character: character() })).code).toBe('NOT_IN_ROOM');
    expect((await emitAck(s, 'option:create', { text: 'x' })).code).toBe('NOT_IN_ROOM');
    expect((await emitAck(s, 'game:start')).code).toBe('NOT_IN_ROOM');
  });

  it('limita los mensajes por segundo por socket', async () => {
    const { host } = await setupRoom(ctx, { n: 1 });
    const results = await Promise.all(
      Array.from({ length: 120 }, (_, i) => emitAck(host, 'option:create', { text: `spam ${i}` })),
    );
    const limited = results.filter((r) => r.code === 'RATE_LIMIT').length;
    expect(limited).toBeGreaterThan(50);
    // Después de la ventana vuelve a aceptar mensajes.
    await sleep(1100);
    const res = await emitAck(host, 'player:character', { character: character() });
    expect(res.ok).toBe(true);
  });
});

describe('Lobby', () => {
  it('marca Listo solo con personaje y opción', async () => {
    const setup = await setupRoom(ctx, { n: 2 });
    const [host] = setup.players;
    await emitAck(host, 'player:character', { character: character() });
    let st = setup.room().publicState();
    expect(st.players[0].ready).toBe(false);
    await emitAck(host, 'option:create', { text: 'Juan' });
    st = setup.room().publicState();
    expect(st.players[0].ready).toBe(true);
    expect(st.players[1].ready).toBe(false);
  });

  it('desconexión: el jugador sale de la lista y de su opción', async () => {
    const setup = await setupRoom(ctx, { n: 3 });
    await readyUp(setup, ['Juan', 'Pedro', 'Pedro']);
    const [host, , leaver] = setup.players;
    const update = waitFor(host, 'room:state', (st) => st.players.length === 2);
    leaver.disconnect();
    const st = await update;
    expect(st.players.some((p) => p.id === leaver.id)).toBe(false);
    expect(st.options.find((o) => o.text === 'Pedro').count).toBe(1);
  });

  it('si el anfitrión se va, pasa al siguiente por orden de llegada', async () => {
    const setup = await setupRoom(ctx, { n: 3 });
    const [host, second, third] = setup.players;
    const update = waitFor(third, 'room:state', (st) => st.players.length === 2);
    host.disconnect();
    const st = await update;
    expect(st.hostId).toBe(second.id);
    expect(st.players.find((p) => p.id === second.id).isHost).toBe(true);
    // El nuevo anfitrión se va también → pasa al tercero.
    const update2 = waitFor(third, 'room:state', (s) => s.players.length === 1);
    second.disconnect();
    expect((await update2).hostId).toBe(third.id);
  });

  it('la sala se borra cuando se van todos', async () => {
    const setup = await setupRoom(ctx, { n: 2 });
    setup.players.forEach((s) => s.disconnect());
    await sleep(200);
    expect(ctx.server.rooms.size).toBe(0);
  });
});

describe('Iniciar partida (validaciones)', () => {
  it('rechaza con menos de 2 jugadores', async () => {
    const setup = await setupRoom(ctx, { n: 1 });
    await readyUp(setup, ['Juan']);
    expect((await emitAck(setup.host, 'game:start')).code).toBe('NOT_ENOUGH_PLAYERS');
  });

  it('rechaza si alguien no está listo', async () => {
    const setup = await setupRoom(ctx, { n: 3 });
    const [host, b] = setup.players;
    await emitAck(host, 'player:character', { character: character() });
    await emitAck(host, 'option:create', { text: 'Juan' });
    await emitAck(b, 'player:character', { character: character() });
    await emitAck(b, 'option:create', { text: 'Pedro' });
    expect((await emitAck(host, 'game:start')).code).toBe('NOT_READY');
  });

  it('rechaza si todos defienden la misma opción', async () => {
    const setup = await setupRoom(ctx, { n: 3, options: ['Juan', 'Pedro'] });
    await readyUp(setup, ['Juan', 'Juan', 'Juan']);
    const res = await emitAck(setup.host, 'game:start');
    expect(res.code).toBe('SAME_OPTION');
    expect(res.error).toMatch(/misma opinión, hermanos/);
  });

  it('rechaza si lo intenta alguien que no es anfitrión', async () => {
    const setup = await setupRoom(ctx, { n: 2 });
    await readyUp(setup, ['Juan', 'Pedro']);
    expect((await emitAck(setup.players[1], 'game:start')).code).toBe('NOT_HOST');
    expect(setup.room().state).toBe('lobby');
  });
});
