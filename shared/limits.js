// Límites y constantes de juego compartidas.
export const LIMITS = {
  NICK_MIN: 2,
  NICK_MAX: 14,
  TOPIC_MIN: 1,
  TOPIC_MAX: 80,
  OPTION_MIN: 1,
  OPTION_MAX: 40,
  MAX_OPTIONS: 8,
  MAX_PLAYERS: 8,
  MIN_PLAYERS: 2,
  ROOM_CODE_LENGTH: 5,
};

// Sin 0, O, 1, I para evitar confusiones.
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export const GAME = {
  TICK_RATE: 20, // actualizaciones por segundo (máx 30)
  MAX_HP: 100,
  RING_RADIUS: 10,
  PLAYER_RADIUS: 0.5,
  MAX_SPEED: 6, // unidades por segundo
  MATCH_SECONDS: 90,
  SUDDEN_DEATH_SECONDS: 20,
  COUNTDOWN_SECONDS: 3,
  KNOCKBACK_DECAY: 6, // por segundo
};

export const GAME_MODES = ['classic', 'auto'];

// Modo automático: cada respuesta es un luchador que pelea solo hasta que quede 1 en pie.
// Arranca lento y suave; cada LEVEL_SECONDS sube el nivel: más velocidad, más daño,
// ataques más seguidos y empujones más fuertes. Multiplicadores sobre los valores base del arma.
export const AUTO = {
  LEVEL_SECONDS: 30,
  // Cada golpe empuja fuerte: la gracia es tirar al rival del ring.
  START: { speed: 0.6, damage: 0.15, rate: 0.6, knockback: 1.2 },
  PER_LEVEL: { speed: 0.15, damage: 0.2, rate: 0.12, knockback: 0.2 },
  MAX: { speed: 2, damage: Infinity, rate: 1.8, knockback: 2.4 },
};

// Modo clásico: sin niveles, todo al 100 %.
export const NO_LEVEL_MULTIPLIERS = Object.freeze({ speed: 1, damage: 1, rate: 1, knockback: 1 });

const round2 = (v) => Math.round(v * 100) / 100;

export function levelMultipliers(level) {
  const n = Math.max(0, level - 1);
  const out = {};
  for (const k of Object.keys(AUTO.START)) {
    out[k] = round2(Math.min(AUTO.MAX[k], AUTO.START[k] + AUTO.PER_LEVEL[k] * n));
  }
  return out;
}

export const RATE_LIMIT = {
  WINDOW_MS: 1000,
  MAX_MESSAGES: 60,
};

// Color de cada opción (bando). Se asigna el primero libre al crear la opción.
export const OPTION_COLORS = [
  '#ff4d4d',
  '#4da6ff',
  '#ffd23f',
  '#3ddc84',
  '#c77dff',
  '#ff8c42',
  '#2ee6d6',
  '#ff6fb5',
];
