import {
  LIMITS,
  OPTION_COLORS,
  ROOM_CODE_ALPHABET,
  normalizeKey,
  validateCharacter,
  validateText,
} from '../../shared/index.js';
import { fail } from './errors.js';

export function generateCode(existing, rng = Math.random) {
  for (let attempt = 0; attempt < 1000; attempt++) {
    let code = '';
    for (let i = 0; i < LIMITS.ROOM_CODE_LENGTH; i++) {
      code += ROOM_CODE_ALPHABET[Math.floor(rng() * ROOM_CODE_ALPHABET.length)];
    }
    if (!existing.has(code)) return code;
  }
  throw new Error('No se pudo generar un código de sala');
}

const CODE_RE = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${LIMITS.ROOM_CODE_LENGTH}}$`);

export function normalizeCode(value) {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return CODE_RE.test(code) ? code : null;
}

export function validateNick(value) {
  return validateText(value, LIMITS.NICK_MIN, LIMITS.NICK_MAX);
}

export function validateTopic(value) {
  return validateText(value, LIMITS.TOPIC_MIN, LIMITS.TOPIC_MAX);
}

export function validateOptionText(value) {
  return validateText(value, LIMITS.OPTION_MIN, LIMITS.OPTION_MAX);
}

// Estados: 'lobby' → 'playing' → 'results' → (revancha) 'lobby'
export class Room {
  // mode: 'classic' (cada quien pelea) | 'auto' (las respuestas pelean solas, los jugadores miran)
  constructor(code, topic, mode = 'classic') {
    this.code = code;
    this.topic = topic;
    this.mode = mode;
    this.state = 'lobby';
    this.hostId = null;
    this.players = new Map(); // orden de inserción = orden de llegada
    this.options = [];
    this.optionSeq = 0;
    this.match = null;
    this.lastResults = null;
  }

  get isEditable() {
    return this.state === 'lobby' || this.state === 'results';
  }

  addPlayer(id, nick) {
    if (this.players.size >= LIMITS.MAX_PLAYERS) return fail('ROOM_FULL');
    if (!this.isEditable) return fail('ROOM_BUSY');
    const key = normalizeKey(nick);
    for (const p of this.players.values()) {
      if (normalizeKey(p.nick) === key) return fail('NICK_TAKEN');
    }
    this.players.set(id, { id, nick, character: null, optionId: null, joinedAt: Date.now() });
    if (!this.hostId) this.hostId = id;
    return { ok: true };
  }

  // Devuelve true si cambió el anfitrión.
  removePlayer(id) {
    if (!this.players.delete(id)) return false;
    if (this.hostId === id) {
      const next = this.players.keys().next();
      this.hostId = next.done ? null : next.value;
      return true;
    }
    return false;
  }

  get isAuto() {
    return this.mode === 'auto';
  }

  setCharacter(id, input) {
    const p = this.players.get(id);
    if (!p) return fail('NOT_IN_ROOM');
    if (this.isAuto) return fail('AUTO_MODE');
    if (!this.isEditable) return fail('WRONG_STATE');
    const character = validateCharacter(input);
    if (!character) return fail('CHARACTER_INVALID');
    p.character = character;
    return { ok: true, character };
  }

  addOption(text) {
    const clean = validateOptionText(text);
    if (!clean) return fail('OPTION_INVALID');
    const key = normalizeKey(clean);
    if (this.options.some((o) => o.key === key)) return fail('OPTION_DUPLICATE');
    if (this.options.length >= LIMITS.MAX_OPTIONS) return fail('OPTION_LIMIT');
    const used = new Set(this.options.map((o) => o.color));
    const color = OPTION_COLORS.find((c) => !used.has(c)) || OPTION_COLORS[0];
    const option = { id: `o${++this.optionSeq}`, text: clean, key, color };
    this.options.push(option);
    return { ok: true, option };
  }

  createOption(playerId, text) {
    const p = this.players.get(playerId);
    if (!p) return fail('NOT_IN_ROOM');
    if (!this.isEditable) return fail('WRONG_STATE');
    // En modo automático solo el anfitrión pone las respuestas y nadie las "defiende".
    if (this.isAuto && playerId !== this.hostId) return fail('NOT_HOST');
    const res = this.addOption(text);
    if (!res.ok) return res;
    if (this.isAuto) return { ok: true, optionId: res.option.id };
    p.optionId = res.option.id;
    return { ok: true, optionId: res.option.id };
  }

  chooseOption(playerId, optionId) {
    const p = this.players.get(playerId);
    if (!p) return fail('NOT_IN_ROOM');
    if (this.isAuto) return fail('AUTO_MODE');
    if (!this.isEditable) return fail('WRONG_STATE');
    if (!this.options.some((o) => o.id === optionId)) return fail('OPTION_NOT_FOUND');
    p.optionId = optionId;
    return { ok: true, optionId };
  }

  removeOption(playerId, optionId) {
    if (playerId !== this.hostId) return fail('NOT_HOST');
    if (!this.isEditable) return fail('WRONG_STATE');
    const idx = this.options.findIndex((o) => o.id === optionId);
    if (idx < 0) return fail('OPTION_NOT_FOUND');
    for (const p of this.players.values()) if (p.optionId === optionId) return fail('OPTION_IN_USE');
    this.options.splice(idx, 1);
    return { ok: true };
  }

  isReady(p) {
    return !!p.character && !!p.optionId && this.options.some((o) => o.id === p.optionId);
  }

  canStart(playerId) {
    if (playerId !== this.hostId) return fail('NOT_HOST');
    if (this.state !== 'lobby') return fail('WRONG_STATE');
    if (this.isAuto) {
      return this.options.length >= 2 ? { ok: true } : fail('NOT_ENOUGH_OPTIONS');
    }
    if (this.players.size < LIMITS.MIN_PLAYERS) return fail('NOT_ENOUGH_PLAYERS');
    for (const p of this.players.values()) if (!this.isReady(p)) return fail('NOT_READY');
    const distinct = new Set([...this.players.values()].map((p) => p.optionId));
    if (distinct.size < 2) return fail('SAME_OPTION');
    return { ok: true };
  }

  publicState() {
    const players = [...this.players.values()].map((p) => ({
      id: p.id,
      nick: p.nick,
      character: p.character,
      optionId: p.optionId,
      ready: this.isAuto || this.isReady(p),
      isHost: p.id === this.hostId,
    }));
    const options = this.options.map((o) => ({
      id: o.id,
      text: o.text,
      color: o.color,
      count: players.filter((p) => p.optionId === o.id).length,
    }));
    return {
      code: this.code,
      topic: this.topic,
      mode: this.mode,
      state: this.state,
      hostId: this.hostId,
      players,
      options,
      maxPlayers: LIMITS.MAX_PLAYERS,
      maxOptions: LIMITS.MAX_OPTIONS,
    };
  }
}
