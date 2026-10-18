import { io as ioClient } from 'socket.io-client';
import { createGameServer } from '../src/app.js';
import { defaultCharacter } from '../../shared/index.js';

// Levanta un servidor real en un puerto de prueba libre.
export async function startServer(opts = {}) {
  const server = createGameServer({ countdownSeconds: 0, ...opts });
  const port = await server.listen(opts.port ?? 0);
  const url = `http://localhost:${port}`;
  const clients = [];

  async function connect() {
    const socket = ioClient(url, { transports: ['websocket'], forceNew: true, reconnection: false });
    clients.push(socket);
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
    return socket;
  }

  async function stop() {
    for (const c of clients) c.disconnect();
    await server.close();
  }

  return { server, port, url, connect, stop };
}

export function emitAck(socket, event, payload = {}, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Sin respuesta a ${event}`)), timeout);
    socket.emit(event, payload, (res) => {
      clearTimeout(timer);
      resolve(res);
    });
  });
}

export function waitFor(socket, event, predicate = () => true, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timeout esperando ${event}`));
    }, timeout);
    function handler(data) {
      if (predicate(data)) {
        clearTimeout(timer);
        socket.off(event, handler);
        resolve(data);
      }
    }
    socket.on(event, handler);
  });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const character = (overrides = {}) => ({ ...defaultCharacter(), ...overrides });

// Crea una sala con un anfitrión y `n - 1` invitados.
export async function setupRoom(ctx, { n = 2, topic = '¿Quién se robó la última tortilla?', options } = {}) {
  const host = await ctx.connect();
  const created = await emitAck(host, 'room:create', { nick: 'Anfitrion', topic, options });
  if (!created.ok) throw new Error(created.error);
  const players = [host];
  for (let i = 1; i < n; i++) {
    const s = await ctx.connect();
    const res = await emitAck(s, 'room:join', { nick: `Jugador${i}`, code: created.code });
    if (!res.ok) throw new Error(res.error);
    players.push(s);
  }
  return { code: created.code, host, players, room: () => ctx.server.rooms.get(created.code) };
}

// Deja a todos listos: personaje + opción. `assign[i]` = texto de opción del jugador i.
export async function readyUp(setup, assign, weapons = []) {
  const room = setup.room();
  for (let i = 0; i < setup.players.length; i++) {
    const s = setup.players[i];
    const r1 = await emitAck(s, 'player:character', { character: character({ weapon: weapons[i] || 'knife' }) });
    if (!r1.ok) throw new Error(r1.error);
    const text = assign[i];
    const existing = room.options.find((o) => o.text === text);
    const r2 = existing
      ? await emitAck(s, 'option:choose', { optionId: existing.id })
      : await emitAck(s, 'option:create', { text });
    if (!r2.ok) throw new Error(r2.error);
  }
}

// Arma una sala, deja a todos listos e inicia la pelea. Devuelve el Match del servidor.
export async function startMatch(ctx, assign, { weapons = [] } = {}) {
  const setup = await setupRoom(ctx, { n: assign.length });
  await readyUp(setup, assign, weapons);
  const started = waitFor(setup.host, 'game:start');
  const res = await emitAck(setup.host, 'game:start');
  if (!res.ok) throw new Error(res.error);
  const startData = await started;
  const room = setup.room();
  return { ...setup, startData, match: room.match, ids: setup.players.map((s) => s.id) };
}

// Coloca a un jugador en una posición exacta (solo pruebas) y le quita el empuje.
export function place(match, id, x, z) {
  const p = match.players.get(id);
  p.x = x;
  p.z = z;
  p.kx = 0;
  p.kz = 0;
}

// Junta todos los ticks que lleguen a un socket durante `ms`.
export function collectTicks(socket, ms) {
  return new Promise((resolve) => {
    const ticks = [];
    const handler = (t) => ticks.push(t);
    socket.on('game:tick', handler);
    setTimeout(() => {
      socket.off('game:tick', handler);
      resolve(ticks);
    }, ms);
  });
}

export const eventsOf = (ticks, type) => ticks.flatMap((t) => t.events.filter((e) => e.type === type));
