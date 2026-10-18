import { GAME, randomCharacter } from '../../shared/index.js';
import { Match } from './match.js';

// Conecta las salas con la simulación: arranca el bucle de ticks, reenvía intenciones
// y publica estado/resultados. Máximo 30 ticks por segundo.
export function createGameController(io, config, broadcastRoom) {
  const dt = 1 / config.tickRate;

  function stop(room) {
    if (room.timer) clearInterval(room.timer);
    room.timer = null;
  }

  function finish(room) {
    stop(room);
    const result = { ...room.match.result, topic: room.topic };
    room.state = 'results';
    room.lastResults = result;
    io.to(room.code).emit('game:over', result);
    broadcastRoom(room);
  }

  function tick(room) {
    const match = room.match;
    if (!match) return stop(room);
    const events = match.step(dt);
    const snap = match.snapshot();
    snap.events = events;
    io.to(room.code).emit('game:tick', snap);
    if (match.isOver) finish(room);
  }

  return {
    start(room) {
      // Clásico: pelean los jugadores. Automático: un luchador por respuesta, con personaje
      // al azar; los jugadores de la sala solo miran.
      const players = room.isAuto
        ? room.options.map((o) => ({
            id: `bot:${o.id}`,
            nick: o.text,
            optionId: o.id,
            character: randomCharacter(config.rng),
            bot: true,
          }))
        : [...room.players.values()].map((p) => ({
            id: p.id,
            nick: p.nick,
            optionId: p.optionId,
            character: p.character,
          }));
      const match = new Match({
        players,
        options: room.options,
        rng: config.rng,
        config: {
          countdownSeconds: config.countdownSeconds,
          matchSeconds: config.matchSeconds,
          suddenDeathSeconds: config.suddenDeathSeconds,
          levelSeconds: room.isAuto ? config.autoLevelSeconds : null,
          noTimeLimit: room.isAuto,
        },
      });
      room.match = match;
      room.state = 'playing';
      room.lastResults = null;
      io.to(room.code).emit('game:start', {
        topic: room.topic,
        mode: room.mode,
        levelSeconds: room.isAuto ? config.autoLevelSeconds : null,
        tickRate: config.tickRate,
        ringRadius: GAME.RING_RADIUS,
        matchSeconds: config.matchSeconds,
        suddenDeathSeconds: config.suddenDeathSeconds,
        countdown: config.countdownSeconds,
        players,
        options: room.options.map((o) => ({ id: o.id, text: o.text, color: o.color })),
        snapshot: match.snapshot(),
      });
      broadcastRoom(room);
      stop(room);
      room.timer = setInterval(() => tick(room), 1000 / config.tickRate);
      return { ok: true };
    },

    stop,

    onPlayerLeft(room, id) {
      if (room.state === 'playing' && room.match) room.match.removePlayer(id);
    },

    // En modo automático los jugadores son espectadores: sus ids no están en la pelea,
    // así que estas intenciones se ignoran solas.
    input(room, id, payload) {
      if (room.state === 'playing' && room.match) room.match.setInput(id, payload);
    },

    attack(room, id, payload) {
      if (room.state === 'playing' && room.match) room.match.queueAttack(id, payload);
    },
  };
}
