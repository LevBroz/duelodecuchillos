import { GAME, NO_LEVEL_MULTIPLIERS, WEAPONS, findById, levelMultipliers } from '../../shared/index.js';

const r2 = (v) => Math.round(v * 100) / 100;

// Simulación autoritativa de una pelea. No conoce sockets: la avanza quien la use con step(dt).
// Fases: 'countdown' → 'main' → ('sudden') → 'over'
//
// Opciones extra para el modo automático:
//   levelSeconds: cada cuántos segundos sube el nivel (null = sin niveles)
//   noTimeLimit:  pelean hasta que quede uno (sin 90 s ni muerte súbita)
// Los jugadores con `bot: true` los mueve la IA del servidor.
export class Match {
  constructor({ players, options, config = {}, rng = Math.random }) {
    this.cfg = {
      ringRadius: GAME.RING_RADIUS,
      playerRadius: GAME.PLAYER_RADIUS,
      maxSpeed: GAME.MAX_SPEED,
      maxHp: GAME.MAX_HP,
      knockbackDecay: GAME.KNOCKBACK_DECAY,
      countdownSeconds: GAME.COUNTDOWN_SECONDS,
      matchSeconds: GAME.MATCH_SECONDS,
      suddenDeathSeconds: GAME.SUDDEN_DEATH_SECONDS,
      levelSeconds: null,
      noTimeLimit: false,
      ...config,
    };
    this.rng = rng;
    this.options = options.map((o) => ({ id: o.id, text: o.text, color: o.color }));
    this.tick = 0;
    this.clock = 0; // segundos de pelea (sin contar la cuenta regresiva)
    this.phase = this.cfg.countdownSeconds > 0 ? 'countdown' : 'main';
    this.countdown = this.cfg.countdownSeconds;
    this.timeLeft = this.cfg.noTimeLimit ? Infinity : this.cfg.matchSeconds;
    this.level = 1;
    this.mult = this.cfg.levelSeconds ? levelMultipliers(1) : NO_LEVEL_MULTIPLIERS;
    this.events = [];
    this.result = null;
    this.elimOrder = 0;

    // Agrupar por opción para que los aliados arranquen juntos.
    const sorted = [...players].sort((a, b) => (a.optionId < b.optionId ? -1 : a.optionId > b.optionId ? 1 : 0));
    const spawnR = this.cfg.ringRadius * 0.6;
    this.players = new Map();
    sorted.forEach((p, i) => {
      const a = (i / sorted.length) * Math.PI * 2;
      const x = Math.cos(a) * spawnR;
      const z = Math.sin(a) * spawnR;
      this.players.set(p.id, {
        id: p.id,
        nick: p.nick,
        optionId: p.optionId,
        character: p.character,
        weapon: findById(WEAPONS, p.character?.weapon) || WEAPONS[0],
        x,
        z,
        kx: 0,
        kz: 0,
        facing: Math.atan2(-x, -z), // mirando al centro
        hp: this.cfg.maxHp,
        alive: true,
        left: false,
        input: { x: 0, z: 0 },
        moving: false,
        lastAttackAt: -Infinity,
        pendingAttack: null,
        attackSeq: 0,
        lastHitBy: null,
        lastHitAt: -Infinity,
        kills: 0,
        damageDealt: 0,
        eliminatedAt: null,
        elimOrder: null,
        cause: null,
        bot: p.bot
          ? {
              targetId: null,
              retargetIn: 0,
              retreat: 0, // segundos que le quedan alejándose después de pegar
              strafe: this.rng() < 0.5 ? -1 : 1,
              aggression: 0.12 + this.rng() * 0.2, // probabilidad por tick de atacar si está a tiro
              courage: 0.3 + this.rng() * 0.5, // probabilidad de NO retirarse tras pegar
              cornering: 0.4 + this.rng() * 0.5, // qué tanto busca acorralar contra la orilla
            }
          : null,
      });
    });
  }

  get isOver() {
    return this.phase === 'over';
  }

  get acceptsActions() {
    return this.phase === 'main' || this.phase === 'sudden';
  }

  setInput(id, input) {
    const p = this.players.get(id);
    if (!p || !p.alive || this.isOver) return false;
    if (!input || typeof input !== 'object') return false;
    let x = Number(input.x);
    let z = Number(input.z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
    const len = Math.hypot(x, z);
    if (len > 1) {
      x /= len;
      z /= len;
    }
    p.input.x = x;
    p.input.z = z;
    return true;
  }

  // Devuelve true si el ataque fue aceptado (no está en cooldown, partida activa, etc.).
  queueAttack(id, dir) {
    const p = this.players.get(id);
    if (!p || !p.alive || !this.acceptsActions) return false;
    if (p.pendingAttack) return false;
    const nowMs = this.clock * 1000;
    if (nowMs - p.lastAttackAt < this.cooldownOf(p)) return false;
    let dx = Number(dir?.x);
    let dz = Number(dir?.z);
    if (!Number.isFinite(dx) || !Number.isFinite(dz)) return false;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) {
      dx = Math.sin(p.facing);
      dz = Math.cos(p.facing);
    } else {
      dx /= len;
      dz /= len;
    }
    p.lastAttackAt = nowMs;
    p.pendingAttack = { x: dx, z: dz };
    p.facing = Math.atan2(dx, dz);
    p.attackSeq++;
    return true;
  }

  cooldownOf(p) {
    return p.weapon.cooldownMs / this.mult.rate;
  }

  // Sube de nivel cada `levelSeconds`: más velocidad, daño y ritmo de ataque.
  updateLevel() {
    if (!this.cfg.levelSeconds) return;
    const level = 1 + Math.floor(this.clock / this.cfg.levelSeconds + 1e-9);
    if (level <= this.level) return;
    this.level = level;
    this.mult = levelMultipliers(level);
    this.events.push({ type: 'level', level, ...this.mult });
  }

  // IA de los luchadores automáticos: persiguen a un enemigo (casi siempre el más cercano,
  // a veces uno al azar), lo rodean, le pegan cuando lo tienen a tiro y a veces se retiran.
  thinkBots(dt) {
    const { ringRadius: R, playerRadius: PR } = this.cfg;
    const alive = this.alivePlayers();
    for (const p of alive) {
      const ai = p.bot;
      if (!ai) continue;
      const enemies = alive.filter((e) => e.optionId !== p.optionId);
      if (!enemies.length) {
        p.input.x = p.input.z = 0;
        continue;
      }
      ai.retargetIn -= dt;
      let target = enemies.find((e) => e.id === ai.targetId);
      if (!target || ai.retargetIn <= 0) {
        if (this.rng() < 0.75) {
          target = enemies.reduce((best, e) =>
            Math.hypot(e.x - p.x, e.z - p.z) < Math.hypot(best.x - p.x, best.z - p.z) ? e : best,
          );
        } else {
          target = enemies[Math.floor(this.rng() * enemies.length)];
        }
        ai.targetId = target.id;
        ai.retargetIn = 0.6 + this.rng() * 1.2;
        if (this.rng() < 0.3) ai.strafe = -ai.strafe;
      }
      const dx = target.x - p.x;
      const dz = target.z - p.z;
      const dist = Math.hypot(dx, dz) || 1e-6;
      const nx = dx / dist;
      const nz = dz / dist;
      const reach = p.weapon.range + PR;
      ai.retreat = Math.max(0, ai.retreat - dt);
      // Lejos: corre directo. Cerca: se acerca rodeando. Retirada: se aleja de lado.
      const dir = ai.retreat > 0 ? -1 : 1;
      const side = ai.retreat > 0 ? 1 : dist < reach * 1.6 ? 0.7 : 0.25;
      let mx = nx * dir + -nz * ai.strafe * side;
      let mz = nz * dir + nx * ai.strafe * side;
      // Acorralar: si está cerca, se pone entre el rival y el centro para que el
      // empujón del golpe (que va de atacante a víctima) lo mande hacia la orilla.
      const tr = Math.hypot(target.x, target.z);
      if (ai.retreat <= 0 && dist < reach * 2.5 && tr > 1.5) {
        const ox = target.x / tr;
        const oz = target.z / tr;
        const px = target.x - ox * reach * 0.7;
        const pz = target.z - oz * reach * 0.7;
        const gx = px - p.x;
        const gz = pz - p.z;
        const gd = Math.hypot(gx, gz);
        if (gd > 0.15) {
          mx = (gx / gd) * ai.cornering + mx * (1 - ai.cornering);
          mz = (gz / gd) * ai.cornering + mz * (1 - ai.cornering);
        } else {
          mx *= 0.2;
          mz *= 0.2;
        }
      }
      // No acercarse demasiado a la orilla
      const r = Math.hypot(p.x, p.z);
      if (r > R - 2) {
        mx -= (p.x / r) * 0.9;
        mz -= (p.z / r) * 0.9;
      }
      const ml = Math.hypot(mx, mz) || 1;
      const speed = ai.retreat > 0 ? 0.9 : dist < reach * 0.7 ? 0.35 : 0.8 + this.rng() * 0.2;
      p.input.x = (mx / ml) * speed;
      p.input.z = (mz / ml) * speed;
      // Ataque con algo de azar (no todos reaccionan igual de rápido)
      if (ai.retreat <= 0 && dist < reach - 0.05 && this.rng() < ai.aggression) {
        const ok = this.queueAttack(p.id, { x: dx + (this.rng() - 0.5) * 0.3, z: dz + (this.rng() - 0.5) * 0.3 });
        if (ok && this.rng() > ai.courage) ai.retreat = 0.5 + this.rng() * 1.1;
      }
    }
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    p.left = true;
    if (p.alive) this.eliminate(p, null, 'left');
  }

  eliminate(p, by, cause) {
    if (!p.alive) return;
    p.alive = false;
    p.hp = Math.max(0, p.hp);
    if (cause === 'ring') p.hp = 0;
    p.eliminatedAt = this.clock;
    p.elimOrder = ++this.elimOrder;
    p.cause = cause;
    p.input.x = p.input.z = 0;
    p.pendingAttack = null;
    if (by && by.id !== p.id) by.kills++;
    this.events.push({ type: 'elim', v: p.id, by: by ? by.id : null, cause });
  }

  alivePlayers() {
    return [...this.players.values()].filter((p) => p.alive);
  }

  step(dt) {
    this.tick++;
    if (this.isOver) return [];
    if (this.phase === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.countdown = 0;
        this.phase = 'main';
        this.events.push({ type: 'go' });
      }
      return this.flushEvents();
    }
    this.clock += dt;
    this.updateLevel();
    this.thinkBots(dt);
    const { ringRadius: R, playerRadius: PR, knockbackDecay } = this.cfg;
    const maxSpeed = this.cfg.maxSpeed * this.mult.speed;
    const alive = this.alivePlayers();

    // 1) Movimiento voluntario (velocidad máxima)
    for (const p of alive) {
      p.prevDist = Math.hypot(p.x, p.z);
      const { x, z } = p.input;
      p.moving = Math.hypot(x, z) > 0.05;
      p.x += x * maxSpeed * dt;
      p.z += z * maxSpeed * dt;
      if (p.moving && !p.pendingAttack && this.clock * 1000 - p.lastAttackAt > 250) p.facing = Math.atan2(x, z);
    }

    // 2) Colisión entre enemigos (los aliados se atraviesan)
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i];
        const b = alive[j];
        if (a.optionId === b.optionId) continue;
        let dx = b.x - a.x;
        let dz = b.z - a.z;
        let d = Math.hypot(dx, dz);
        const min = PR * 2;
        if (d >= min) continue;
        if (d < 1e-6) {
          const ang = this.rng() * Math.PI * 2;
          dx = Math.cos(ang);
          dz = Math.sin(ang);
          d = 1;
        }
        const push = (min - d) / 2;
        const nx = dx / d;
        const nz = dz / d;
        a.x -= nx * push;
        a.z -= nz * push;
        b.x += nx * push;
        b.z += nz * push;
      }
    }

    // 3) Caminando no te podés salir del ring. Solo limita lo voluntario:
    //    si un empujón te dejó en la orilla, no te devuelve, pero tampoco te deja avanzar hacia afuera.
    const walkMax = R - PR;
    for (const p of alive) {
      const d = Math.hypot(p.x, p.z);
      const allowed = Math.max(walkMax, Math.min(p.prevDist, R));
      if (d > allowed) {
        p.x *= allowed / d;
        p.z *= allowed / d;
      }
    }

    // 4) Ataques (resueltos en el servidor)
    const hitsThisTick = [];
    for (const attacker of alive) {
      const atk = attacker.pendingAttack;
      if (!atk || !attacker.alive) continue;
      attacker.pendingAttack = null;
      const w = attacker.weapon;
      for (const victim of alive) {
        if (victim === attacker || !victim.alive) continue;
        if (victim.optionId === attacker.optionId) continue; // aliados: nada de daño
        const vx = victim.x - attacker.x;
        const vz = victim.z - attacker.z;
        const dist = Math.hypot(vx, vz);
        if (dist - PR > w.range) continue;
        if (dist > PR) {
          const cos = (vx * atk.x + vz * atk.z) / dist;
          if (cos < Math.cos(w.arc / 2)) continue;
        }
        const [min, max] = w.damage;
        let dmg = min + Math.floor(this.rng() * (max - min + 1));
        dmg = Math.max(1, Math.round(dmg * this.mult.damage));
        if (this.phase === 'sudden') dmg = victim.hp; // muerte súbita: cualquier golpe elimina
        dmg = Math.min(dmg, victim.hp);
        victim.hp -= dmg;
        attacker.damageDealt += dmg;
        victim.lastHitBy = attacker.id;
        victim.lastHitAt = this.clock;
        // Empuje en la dirección atacante → víctima
        const nx = dist > 1e-6 ? vx / dist : atk.x;
        const nz = dist > 1e-6 ? vz / dist : atk.z;
        victim.kx += nx * w.knockback * this.mult.knockback * knockbackDecay;
        victim.kz += nz * w.knockback * this.mult.knockback * knockbackDecay;
        const kill = victim.hp <= 0;
        this.events.push({ type: 'hit', a: attacker.id, v: victim.id, d: dmg, w: w.id, x: r2(victim.x), z: r2(victim.z), kill });
        hitsThisTick.push([attacker.id, victim.id]);
        if (kill) this.eliminate(victim, attacker, 'hit');
      }
    }
    // Choque de filos: dos enemigos se golpean en el mismo tick
    for (const [a, v] of hitsThisTick) {
      if (a < v && hitsThisTick.some(([a2, v2]) => a2 === v && v2 === a)) {
        const pa = this.players.get(a);
        const pv = this.players.get(v);
        this.events.push({ type: 'clash', x: r2((pa.x + pv.x) / 2), z: r2((pa.z + pv.z) / 2) });
      }
    }

    // 5) Empuje (knockback): esto sí te puede sacar del ring
    const decay = Math.exp(-knockbackDecay * dt);
    for (const p of this.alivePlayers()) {
      if (p.kx === 0 && p.kz === 0) continue;
      p.x += p.kx * dt;
      p.z += p.kz * dt;
      p.kx *= decay;
      p.kz *= decay;
      if (Math.hypot(p.kx, p.kz) < 0.05) p.kx = p.kz = 0;
    }

    // 6) Caerse del ring = eliminado
    for (const p of this.alivePlayers()) {
      if (Math.hypot(p.x, p.z) > R) {
        const by = p.lastHitBy && this.clock - p.lastHitAt < 3 ? this.players.get(p.lastHitBy) : null;
        this.eliminate(p, by, 'ring');
      }
    }

    // 7) Victoria y tiempo
    this.checkVictory();
    if (!this.isOver) {
      this.timeLeft -= dt;
      if (this.timeLeft <= 1e-9) this.onTimeUp();
    }
    return this.flushEvents();
  }

  flushEvents() {
    const ev = this.events;
    this.events = [];
    return ev;
  }

  aliveByOption() {
    const map = new Map();
    for (const p of this.alivePlayers()) {
      const s = map.get(p.optionId) || { alive: 0, hp: 0 };
      s.alive++;
      s.hp += p.hp;
      map.set(p.optionId, s);
    }
    return map;
  }

  checkVictory() {
    const byOpt = this.aliveByOption();
    if (byOpt.size > 1) return;
    if (byOpt.size === 1) {
      const [optionId] = byOpt.keys();
      const reason = this.alivePlayers().length === 1 ? 'lastStanding' : 'sameOption';
      this.finish([optionId], reason);
    } else {
      // Todos cayeron en el mismo tick: empate entre quienes cayeron de último.
      // Si no queda nadie porque se desconectaron, la pelea se abandona.
      const tied = [...this.players.values()].filter((p) => p.eliminatedAt === this.clock && !p.left);
      const winners = [...new Set(tied.map((p) => p.optionId))];
      this.finish(winners, winners.length ? 'draw' : 'abandon');
    }
  }

  // Opciones con mayor vida total (puede haber empate).
  leadersByHp() {
    const byOpt = this.aliveByOption();
    let best = -1;
    let leaders = [];
    for (const [id, s] of byOpt) {
      if (s.hp > best) {
        best = s.hp;
        leaders = [id];
      } else if (s.hp === best) leaders.push(id);
    }
    return leaders;
  }

  onTimeUp() {
    const leaders = this.leadersByHp();
    if (this.phase === 'main') {
      if (leaders.length === 1) return this.finish(leaders, 'time');
      this.phase = 'sudden';
      this.timeLeft = this.cfg.suddenDeathSeconds;
      this.suddenOptions = leaders;
      this.events.push({ type: 'sudden', options: leaders });
      return;
    }
    // Se acabó la muerte súbita
    if (leaders.length === 1) return this.finish(leaders, 'suddenDeath');
    const byOpt = this.aliveByOption();
    let most = -1;
    let winners = [];
    for (const id of leaders) {
      const n = byOpt.get(id).alive;
      if (n > most) {
        most = n;
        winners = [id];
      } else if (n === most) winners.push(id);
    }
    this.finish(winners, winners.length === 1 ? 'suddenDeath' : 'draw');
  }

  finish(winners, reason) {
    this.phase = 'over';
    this.timeLeft = Math.max(0, this.timeLeft);
    this.result = this.buildResults(winners, reason);
    this.events.push({ type: 'over', winners, reason });
  }

  buildResults(winners, reason) {
    const all = [...this.players.values()];
    const optionStats = this.options
      .map((o) => {
        const members = all.filter((p) => p.optionId === o.id);
        if (!members.length) return null;
        const alive = members.filter((p) => p.alive);
        return {
          optionId: o.id,
          text: o.text,
          color: o.color,
          winner: winners.includes(o.id),
          alive: alive.length,
          hp: alive.reduce((s, p) => s + p.hp, 0),
          players: members.length,
          kills: members.reduce((s, p) => s + p.kills, 0),
          lastElim: Math.max(...members.map((p) => (p.alive ? Infinity : p.elimOrder))),
        };
      })
      .filter(Boolean);
    optionStats.sort(
      (a, b) => b.winner - a.winner || b.alive - a.alive || b.hp - a.hp || b.lastElim - a.lastElim || b.kills - a.kills,
    );
    optionStats.forEach((o, i) => {
      o.place = i + 1;
      if (o.lastElim === Infinity) o.lastElim = null;
    });

    const playerStats = all
      .map((p) => ({
        id: p.id,
        nick: p.nick,
        optionId: p.optionId,
        character: p.character,
        alive: p.alive,
        hp: p.alive ? p.hp : 0,
        kills: p.kills,
        damage: p.damageDealt,
        cause: p.cause,
        left: p.left,
        elimOrder: p.elimOrder,
        winner: winners.includes(p.optionId),
      }))
      .sort(
        (a, b) =>
          b.alive - a.alive ||
          b.hp - a.hp ||
          (b.elimOrder || 0) - (a.elimOrder || 0) ||
          b.kills - a.kills ||
          b.damage - a.damage,
      );
    playerStats.forEach((p, i) => (p.place = i + 1));

    return { winners, reason, duration: r2(this.clock), level: this.level, options: optionStats, players: playerStats };
  }

  snapshot() {
    return {
      n: this.tick,
      phase: this.phase,
      // Sin límite de tiempo (modo automático) se manda null y el cliente muestra el tiempo transcurrido.
      timeLeft: Number.isFinite(this.timeLeft) ? r2(Math.max(0, this.timeLeft)) : null,
      elapsed: r2(this.clock),
      level: this.level,
      countdown: r2(this.countdown),
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        x: r2(p.x),
        z: r2(p.z),
        f: r2(p.facing),
        hp: p.hp,
        al: p.alive ? 1 : 0,
        a: p.attackSeq,
        mv: p.moving && p.alive ? 1 : 0,
      })),
    };
  }

  // Revisa invariantes (lo usan las pruebas de simulación).
  checkInvariants() {
    const errors = [];
    const R = this.cfg.ringRadius;
    for (const p of this.players.values()) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) errors.push(`${p.id}: posición no finita`);
      if (p.hp < 0 || p.hp > this.cfg.maxHp) errors.push(`${p.id}: vida fuera de rango ${p.hp}`);
      if (p.alive && p.hp <= 0) errors.push(`${p.id}: vivo con 0 de vida`);
      if (p.alive && Math.hypot(p.x, p.z) > R + 1e-6) errors.push(`${p.id}: vivo fuera del ring`);
      if (!p.alive && p.eliminatedAt === null) errors.push(`${p.id}: muerto sin registro`);
    }
    if (this.isOver && !this.result) errors.push('terminó sin resultado');
    return errors;
  }
}
