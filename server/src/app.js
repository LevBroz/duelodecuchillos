import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import { AUTO, GAME, GAME_MODES, LIMITS, RATE_LIMIT } from '../../shared/index.js';
import { fail } from './errors.js';
import { createGameController } from './game.js';
import {
  Room,
  generateCode,
  normalizeCode,
  validateNick,
  validateTopic,
} from './room.js';

// Red local privada (192.168.x.x, 10.x.x.x, 172.16-31.x.x) en el puerto de Vite: para probar desde el celular.
const LAN_DEV_ORIGIN = /^http:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}):5173$/;

// CLIENT_ORIGIN admite varios orígenes separados por coma y comodines:
//   https://duelo.netlify.app,https://*--duelo.netlify.app
// Sin CLIENT_ORIGIN (desarrollo): localhost:5173 y la red local en :5173.
export function parseOrigins(value) {
  if (!value || !value.trim()) return ['http://localhost:5173', 'http://127.0.0.1:5173', LAN_DEV_ORIGIN];
  if (value.trim() === '*') return '*';
  return value
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean)
    .map((s) =>
      s.includes('*')
        ? new RegExp(`^${s.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')}$`)
        : s,
    );
}

export function originAllowed(allowed, origin) {
  if (allowed === '*') return true;
  return allowed.some((o) => (o instanceof RegExp ? o.test(origin) : o === origin));
}

export function createGameServer(opts = {}) {
  const config = {
    clientOrigin: parseOrigins(opts.clientOrigin),
    tickRate: Math.min(30, opts.tickRate ?? GAME.TICK_RATE),
    countdownSeconds: opts.countdownSeconds ?? GAME.COUNTDOWN_SECONDS,
    matchSeconds: opts.matchSeconds ?? GAME.MATCH_SECONDS,
    suddenDeathSeconds: opts.suddenDeathSeconds ?? GAME.SUDDEN_DEATH_SECONDS,
    autoLevelSeconds: opts.autoLevelSeconds ?? AUTO.LEVEL_SECONDS,
    rateWindowMs: opts.rateWindowMs ?? RATE_LIMIT.WINDOW_MS,
    rateMax: opts.rateMax ?? RATE_LIMIT.MAX_MESSAGES,
    rng: opts.rng ?? Math.random,
    log: opts.log ?? (() => {}),
  };

  const app = express();
  app.use(cors({ origin: config.clientOrigin }));
  app.get('/', (_req, res) => res.type('text/plain').send('Duelo de Cuchillos: servidor activo.'));
  app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));

  const httpServer = http.createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: config.clientOrigin },
    maxHttpBufferSize: 16 * 1024,
    // El CORS no aplica a WebSocket: revisamos el Origin también ahí.
    // Sin Origin (clientes que no son navegador, como las pruebas) se permite.
    allowRequest: (req, cb) => {
      const origin = req.headers.origin;
      cb(null, !origin || originAllowed(config.clientOrigin, origin));
    },
  });

  const rooms = new Map();
  const socketRoom = new Map(); // socket.id → code

  const broadcastRoom = (room) => io.to(room.code).emit('room:state', room.publicState());

  function leaveRoom(socket) {
    const code = socketRoom.get(socket.id);
    if (!code) return;
    socketRoom.delete(socket.id);
    socket.leave(code);
    const room = rooms.get(code);
    if (!room) return;
    room.removePlayer(socket.id);
    game.onPlayerLeft(room, socket.id);
    if (room.players.size === 0) {
      game.stop(room);
      rooms.delete(code);
      return;
    }
    broadcastRoom(room);
  }

  function enterRoom(socket, room) {
    socketRoom.set(socket.id, room.code);
    socket.join(room.code);
  }

  const game = createGameController(io, config, broadcastRoom);

  io.on('connection', (socket) => {
    // Límite de mensajes por socket. Si se pasa, el paquete se descarta.
    let windowStart = Date.now();
    let count = 0;
    socket.use((packet, next) => {
      const now = Date.now();
      if (now - windowStart >= config.rateWindowMs) {
        windowStart = now;
        count = 0;
      }
      count++;
      if (count > config.rateMax) {
        const ack = packet[packet.length - 1];
        if (typeof ack === 'function') ack(fail('RATE_LIMIT'));
        return;
      }
      next();
    });

    const on = (event, handler) => {
      socket.on(event, (payload, ack) => {
        if (typeof payload === 'function') {
          ack = payload;
          payload = undefined;
        }
        const reply = typeof ack === 'function' ? ack : () => {};
        try {
          const res = handler(payload && typeof payload === 'object' ? payload : {});
          if (res) reply(res);
        } catch (err) {
          config.log('error', event, err);
          reply(fail('INTERNAL'));
        }
      });
    };

    const currentRoom = () => rooms.get(socketRoom.get(socket.id)) || null;

    on('room:create', ({ nick, topic, options, mode = 'classic' }) => {
      const cleanNick = validateNick(nick);
      if (!cleanNick) return fail('NICK_INVALID');
      const cleanTopic = validateTopic(topic);
      if (!cleanTopic) return fail('TOPIC_INVALID');
      if (!GAME_MODES.includes(mode)) return fail('MODE_INVALID');
      const initial = options === undefined ? [] : options;
      if (!Array.isArray(initial) || initial.length > LIMITS.MAX_OPTIONS) return fail('OPTION_LIMIT');

      const room = new Room(generateCode(rooms, config.rng), cleanTopic, mode);
      for (const text of initial) {
        const res = room.addOption(text);
        if (!res.ok) return res;
      }
      leaveRoom(socket);
      room.addPlayer(socket.id, cleanNick);
      rooms.set(room.code, room);
      enterRoom(socket, room);
      broadcastRoom(room);
      return { ok: true, code: room.code, playerId: socket.id, room: room.publicState() };
    });

    on('room:join', ({ nick, code }) => {
      const cleanNick = validateNick(nick);
      if (!cleanNick) return fail('NICK_INVALID');
      const cleanCode = normalizeCode(code);
      if (!cleanCode) return fail('CODE_INVALID');
      const room = rooms.get(cleanCode);
      if (!room) return fail('ROOM_NOT_FOUND');
      if (socketRoom.get(socket.id) === room.code) {
        return { ok: true, code: room.code, playerId: socket.id, room: room.publicState() };
      }
      const res = room.addPlayer(socket.id, cleanNick);
      if (!res.ok) return res;
      leaveRoom(socket);
      enterRoom(socket, room);
      broadcastRoom(room);
      return { ok: true, code: room.code, playerId: socket.id, room: room.publicState() };
    });

    on('room:leave', () => {
      leaveRoom(socket);
      return { ok: true };
    });

    on('player:character', ({ character }) => {
      const room = currentRoom();
      if (!room) return fail('NOT_IN_ROOM');
      const res = room.setCharacter(socket.id, character);
      if (res.ok) broadcastRoom(room);
      return res;
    });

    on('option:create', ({ text }) => {
      const room = currentRoom();
      if (!room) return fail('NOT_IN_ROOM');
      const res = room.createOption(socket.id, text);
      if (res.ok) broadcastRoom(room);
      return res;
    });

    on('option:choose', ({ optionId }) => {
      const room = currentRoom();
      if (!room) return fail('NOT_IN_ROOM');
      const res = room.chooseOption(socket.id, optionId);
      if (res.ok) broadcastRoom(room);
      return res;
    });

    on('option:remove', ({ optionId }) => {
      const room = currentRoom();
      if (!room) return fail('NOT_IN_ROOM');
      const res = room.removeOption(socket.id, optionId);
      if (res.ok) broadcastRoom(room);
      return res;
    });

    on('game:start', () => {
      const room = currentRoom();
      if (!room) return fail('NOT_IN_ROOM');
      const res = room.canStart(socket.id);
      if (!res.ok) return res;
      return game.start(room);
    });

    on('game:restart', () => {
      const room = currentRoom();
      if (!room) return fail('NOT_IN_ROOM');
      if (socket.id !== room.hostId) return fail('NOT_HOST');
      if (room.state !== 'results') return fail('WRONG_STATE');
      room.state = 'lobby';
      room.match = null;
      broadcastRoom(room);
      return { ok: true };
    });

    // Para medir latencia desde el cliente.
    socket.on('net:ping', (ack) => typeof ack === 'function' && ack(Date.now()));

    // Intenciones de juego: sin ack, se ignoran si no aplican.
    socket.on('input', (payload) => {
      const room = currentRoom();
      if (room) game.input(room, socket.id, payload);
    });
    socket.on('attack', (payload) => {
      const room = currentRoom();
      if (room) game.attack(room, socket.id, payload);
    });

    socket.on('disconnect', () => leaveRoom(socket));
  });

  return {
    app,
    httpServer,
    io,
    rooms,
    config,
    listen(port = 0) {
      return new Promise((resolve) => {
        httpServer.listen(port, () => resolve(httpServer.address().port));
      });
    },
    close() {
      for (const room of rooms.values()) game.stop(room);
      rooms.clear();
      return new Promise((resolve) => {
        io.close(() => resolve());
      });
    },
  };
}
