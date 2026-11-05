import wheelTiming from './waterwheel-timing.json';
import { BODY, companionHome, resolveFormation } from './formation.js';

export const MAX_ENEMIES = 3;
export const WHEEL = wheelTiming;
export const BOSS_AT = 60;
export const WALK_SPEED = 1.35;
export const REACH = 5.4;
export const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export const angleDelta = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
export const CHAIN_LENGTH = 3;
export const CHAIN_WINDOW = 0.45;

const stage = o => {
  const m = { heavy: false, finisher: false, ...o };
  m.duration = m.clipDuration / m.speed;
  m.beats = m.peaks.map(x => x / m.speed);
  m.cancelAt = Math.min(m.duration - 0.04, m.beats.at(-1) + m.cancelDelay);
  return m;
};

export const MOVES = {
  light1: stage({ kind: 'light', stage: 1, clip: 'Light1', label: '横斩', clipDuration: 0.45, speed: 1.15, peaks: [0.217], damage: 24, cancelDelay: 0.1 }),
  light2: stage({ kind: 'light', stage: 2, clip: 'Light2', label: '反手斩', clipDuration: 0.55, speed: 1.15, peaks: [0.233], damage: 26, cancelDelay: 0.1 }),
  light3: stage({ kind: 'light', stage: 3, clip: 'Light3', label: '终结斩', clipDuration: 2.0, speed: 1.5, peaks: [0.633], damage: 40, finisher: true, cancelDelay: 0.45 }),
  heavy1: stage({ kind: 'heavy', stage: 1, clip: 'Heavy1', label: '突进斩', clipDuration: 1.583333, speed: 1.35, peaks: [0.3], damage: 62, heavy: true, cancelDelay: 0.3 }),
  heavy2: stage({ kind: 'heavy', stage: 2, clip: 'Heavy2', label: '连续斩击', clipDuration: 3.0, speed: 1.45, peaks: [0.233, 0.7, 1.533], damages: [30, 30, 46], damage: 30, heavy: true, cancelDelay: 0.3 }),
  heavy3: stage({ kind: 'heavy', stage: 3, clip: 'Heavy3', label: '重击连斩', clipDuration: 4.35, speed: 1.5, peaks: [0.4, 1.15, 1.817, 2.6], damages: [34, 34, 42, 66], damage: 34, heavy: true, cancelDelay: 0.4 }),
  musou: {
    clip: 'WaterWheel',
    speed: 1,
    clipDuration: wheelTiming.duration,
    duration: wheelTiming.duration,
    landingTime: wheelTiming.landingTime,
    releaseStart: wheelTiming.swingStart,
    releaseEnd: wheelTiming.swingEnd,
    beats: wheelTiming.damageTimes,
  },
};

export function createBattle({ allySide = -1, bossAt = BOSS_AT } = {}) {
  const g = {
    bossAt,
    progress: 0,
    speed: 0,
    status: 'ready',
    time: 0,
    hp: 100,
    energy: 0,
    kills: 0,
    perfect: 0,
    musouCount: 0,
    enemies: [],
    hazards: [],
    events: [],
    seq: 0,
    phase: 0,
    spawnAt: 0.9,
    lightCd: 0,
    heavyCd: 0,
    dodgeCd: 0,
    spinCd: 0,
    thrustBurstCd: 0,
    ultCd: 0,
    guarding: false,
    steerX: 0,
    steerY: 0,
    steerActive: false,
    swing: null,
    moveKey: null,
    chainKind: null,
    chainStage: 0,
    chainTimer: 0,
    invincible: 0,
    dodgeTime: 0,
    dodgeDirection: 1,
    musouTime: -1,
    musouBeat: 0,
    allyCd: 2.6,
    bossSpawned: false,
    bossDefeated: false,
    combo: 0,
    damageTaken: 0,
  };
  const emit = (type, data = {}) => g.events.push({ type, ...data });
  g.player = { x: 0, z: 0, radius: BODY.player };
  g.ally = { ...companionHome(allySide), side: allySide === 1 ? 1 : -1, returning: false, backing: false };

  function start() {
    if (g.status !== 'ready') return;
    g.status = 'playing';
    emit('wave', { wave: 1 });
    emit('message', {
      text: `炭治郎：我守${g.ally.side === 1 ? '右' : '左'}翼，恶鬼正从前方冲来！`,
      duration: 3.5,
    });
  }

  function spawn(boss = false) {
    const slot = g.seq % 3;
    const x = boss ? 0 : [0, -0.52, 0.52][slot] + Math.sin(g.seq * 2.1) * 0.12;
    const z = boss ? -8.2 : [-7.6, -8.3, -8.8][slot];
    const maxHp = boss ? 620 : 52 + Math.floor(g.progress * 0.55);
    const e = {
      id: ++g.seq,
      x,
      z,
      y: 0,
      yaw: 0,
      size: boss ? 1 : 0.86,
      hp: maxHp,
      maxHp,
      boss,
      elite: boss,
      role: boss ? 'caster' : slot === 1 ? 'caster' : 'claw',
      phase: g.seq * 1.7,
      dead: 0,
      spin: 1,
      flash: 0,
      stun: 0,
      tell: 0,
      cooldown: boss ? 2.4 : 2.6 + slot * 0.55,
      lane: boss ? 0 : clamp(x * 0.85, -0.58, 0.58),
      arrived: false,
      vx: 0,
      vz: 0,
      vy: 0,
      radius: boss ? BODY.boss : BODY.enemy,
    };
    g.enemies.push(e);
    resolveFormation(g);
    emit('spawn', { id: e.id, boss });
    return e;
  }

  function finish(victory) {
    g.status = victory ? 'victory' : 'defeat';
    g.hazards = [];
    g.swing = null;
    g.moveKey = null;
    emit('end', { victory });
  }

  function removeHazards(e) {
    g.hazards = g.hazards.filter(h => h.source !== e.id);
    e.tell = 0;
  }

  function hurtEnemy(e, damage, heavy = false, charge = true, launch = !!heavy) {
    if (e.hp <= 0) return;
    const pop = !!launch;
    e.hp = Math.max(0, e.hp - damage);
    e.flash = 0.13;
    e.stun = pop ? 0.65 : 0.13;
    e.z -= pop ? 0.32 : 0.08;
    if (heavy) removeHazards(e);
    if (charge) g.energy = Math.min(100, g.energy + (heavy ? 10 : 4));
    g.combo++;
    emit('hit', { id: e.id, x: e.x, y: 1.15, z: e.z, dead: e.hp <= 0, heavy: !!heavy, finisher: pop && !heavy });
    if (e.hp <= 0) {
      e.dead = 0.001;
      g.kills++;
      removeHazards(e);
      if (charge) g.energy = Math.min(100, g.energy + 5);
      if (e.boss) g.bossDefeated = true;
    }
    resolveFormation(g);
  }

  function nextStage(kind) {
    return g.chainKind === kind && g.chainTimer > 0 && g.chainStage < CHAIN_LENGTH ? g.chainStage + 1 : 1;
  }

  function stageView(kind) {
    const n = nextStage(kind);
    const m = MOVES[kind + n];
    return { stage: n, label: m.label, clip: m.clip, cooling: kind === 'heavy' && n === 1 && g.heavyCd > 0 };
  }

  function endSwing() {
    const s = g.swing;
    if (s?.key === 'heavy3') g.heavyCd = Math.max(g.heavyCd, 1.2);
    g.swing = null;
    g.moveKey = null;
    if (s) g.chainTimer = CHAIN_WINDOW;
  }

  function attack(kind, targetId, opts = {}) {
    if (g.status !== 'playing' || g.musouTime >= 0) return false;
    if (g.guarding && kind !== 'musou') g.guarding = false;
    if (kind === 'musou') {
      if (g.energy < 100) {
        emit('message', { text: '命中恶鬼或完美闪避，积蓄水车合击', duration: 1.4 });
        return false;
      }
      g.guarding = false;
      g.swing = null;
      g.moveKey = null;
      g.chainKind = null;
      g.chainStage = 0;
      g.chainTimer = 0;
      g.energy = 0;
      g.musouTime = 0;
      g.musouBeat = 0;
      g.musouCount++;
      g.invincible = WHEEL.duration + 0.2;
      g.ally.castStart = { x: g.ally.x, z: g.ally.z };
      emit('attack', { kind: 'musou' });
      return true;
    }
    if (kind !== 'light' && kind !== 'heavy') return false;
    if (g.swing && g.swing.time < MOVES[g.swing.key].cancelAt) return false;
    const stageNo = nextStage(kind);
    if (kind === 'heavy' && stageNo === 1 && g.heavyCd > 0) return false;
    if (g.swing?.key === 'heavy3' && kind === 'heavy' && stageNo === 1) {
      g.heavyCd = Math.max(g.heavyCd, 1.2);
      return false;
    }
    const key = kind + stageNo;
    const m = MOVES[key];
    const slashDir = opts.slashDir || (kind === 'heavy' ? 'thrust' : stageNo === 2 ? 'left' : 'right');
    g.swing = { key, kind, clip: m.clip, speed: m.speed, time: 0, beat: 0, targetId: targetId ?? null, slashDir };
    g.moveKey = key;
    g.chainKind = kind;
    g.chainStage = stageNo;
    g.chainTimer = 1;
    if (kind === 'heavy' && stageNo === 1) g.heavyCd = 1.8;
    emit('attack', { kind, key, stage: stageNo, clip: m.clip, slashDir });
    emit('swing', { heavy: !!m.heavy, finisher: !!m.finisher, key, clip: m.clip, stage: stageNo, slashDir });
    return true;
  }

  function findTargetOrNearest(targetId) {
    let target =
      targetId == null
        ? null
        : g.enemies.find(e => e.id === targetId && e.hp > 0 && Math.hypot(e.x - g.player.x, e.z - g.player.z) <= REACH + 1.2);
    if (!target) {
      target = g.enemies
        .filter(e => e.hp > 0 && Math.hypot(e.x - g.player.x, e.z - g.player.z) <= REACH + 1.2)
        .sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0];
    }
    return target || null;
  }

  // Skill 1 (Air Gesture 'circle' / Trackpad 'swipe-up' / Key '1'): Water Wheel Spin / Full Musou
  function castWaterWheel(targetId, clockwise = true) {
    if (g.status !== 'playing' || g.musouTime >= 0) return false;
    if (g.energy >= 100) {
      return attack('musou', targetId);
    }
    if (g.spinCd > 0) return false;
    g.guarding = false;
    g.spinCd = 1.05;
    g.invincible = Math.max(g.invincible, 0.36);
    const targets = g.enemies.filter(
      e => e.hp > 0 && Math.hypot(e.x - g.player.x, e.z - g.player.z) <= REACH + 1.2,
    );
    const primary = findTargetOrNearest(targetId);
    if (targets.length > 0) {
      for (const foe of targets) {
        hurtEnemy(foe, foe.id === primary?.id ? 40 : 28, true, true, true);
      }
    }
    g.energy = Math.min(100, g.energy + 14);
    const slashDir = clockwise ? 'spin-cw' : 'spin-ccw';
    emit('waterWheelSpin', { clockwise, hitCount: targets.length });
    emit('allyAttack', { target: primary?.id ?? null });
    emit('impact', { heavy: true, finisher: true, hit: targets.length > 0 });
    emit('playerSlash', { heavy: true, finisher: true, stage: 3, slashDir });
    emit('message', { text: '水之呼吸 · 贰之型 水车旋斩！', duration: 1.5 });
    return true;
  }

  // Skill 2 (Air Gesture 'thrust' / Trackpad 'swipe-left'|'swipe-right' / Key '2'): Piercing Thrust
  function castThrust(targetId, lateralDir = null) {
    if (g.status !== 'playing' || g.musouTime >= 0) return false;
    g.guarding = false;
    if (lateralDir && g.hazards.some(h => h.remaining <= 0.7 && h.remaining > 0)) {
      g.invincible = Math.max(g.invincible, 0.38);
    }
    if (attack('heavy', targetId, { slashDir: 'thrust' })) {
      return true;
    }
    if (g.thrustBurstCd > 0) return false;
    g.thrustBurstCd = 0.42;
    const target = findTargetOrNearest(targetId);
    if (target) {
      hurtEnemy(target, 32, true, true, true);
    }
    emit('impact', { heavy: true, finisher: false, hit: !!target });
    emit('playerSlash', { heavy: true, finisher: false, stage: 1, slashDir: 'thrust' });
    emit('message', { text: '水之呼吸 · 柒之型 雫波纹击刺！', duration: 1.3 });
    return true;
  }

  // Skill 3 (Air Gesture 'fist-hold' & 'fist-release' / Trackpad 'hold' / Key 'Shift'): Water Guard
  function setGuard(active) {
    const next = Boolean(active) && g.status === 'playing' && g.musouTime < 0;
    if (next === g.guarding) return g.guarding;
    g.guarding = next;
    if (next) {
      g.swing = null;
      g.moveKey = null;
      emit('guardStart');
      emit('message', { text: '水之呼吸 · 流流舞 守势架刀（可弹反红光攻击）', duration: 1.5 });
    } else {
      emit('guardEnd');
    }
    return g.guarding;
  }

  // Skill 4 (Air Gesture 'open-palm' / Trackpad 'swipe-down' / Key '3'): Full-Concentration Ultimate
  function castUltimate(targetId) {
    if (g.status !== 'playing' || g.musouTime >= 0) return false;
    if (g.energy < 100) {
      if (g.ultCd > 0) {
        emit('message', { text: `全集中呼吸回气中（${g.ultCd.toFixed(1)}s）`, duration: 1.2 });
        return false;
      }
      g.energy = 100;
      g.ultCd = 5.0;
    }
    return attack('musou', targetId);
  }

  // Left-Hand Blind Floating Steering Pad (onTrackpadMove: x/y in [-1, 1])
  function setMoveAxes(x = 0, y = 0, active = false) {
    g.steerActive = Boolean(active);
    g.steerX = g.steerActive ? clamp(Number(x) || 0, -1, 1) : 0;
    g.steerY = g.steerActive ? clamp(Number(y) || 0, -1, 1) : 0;
    if (g.steerActive && Math.abs(g.steerX) > 0.62 && g.hazards.length > 0 && g.dodgeCd <= 0) {
      dodge(g.steerX > 0 ? 1 : -1);
    }
  }

  function resolveSwing(dt) {
    const s = g.swing;
    if (!s) return;
    s.time += dt;
    const m = MOVES[s.key];
    while (s.beat < m.beats.length && s.time + 1e-8 >= m.beats[s.beat]) {
      const beat = s.beat++;
      const last = beat === m.beats.length - 1;
      const damage = m.damages?.[beat] ?? m.damage;
      const pop = last && (!!m.heavy || !!m.finisher);
      let target =
        s.targetId == null
          ? null
          : g.enemies.find(e => e.id === s.targetId && e.hp > 0 && Math.hypot(e.x - g.player.x, e.z - g.player.z) <= REACH + 1.0);
      if (!target) {
        target = g.enemies
          .filter(e => e.hp > 0 && Math.hypot(e.x - g.player.x, e.z - g.player.z) <= REACH + 1.0)
          .sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0];
      }
      if (target) hurtEnemy(target, damage, !!m.heavy && last, true, pop);
      emit('impact', { heavy: !!m.heavy && last, finisher: !!m.finisher && last, hit: !!target });
      emit('playerSlash', {
        heavy: !!m.heavy,
        finisher: !!m.finisher && last,
        stage: m.stage,
        slashDir: s.slashDir || 'right',
      });
    }
    if (s.time >= m.duration) endSwing();
  }

  function dodge(direction) {
    if (g.status !== 'playing' || g.dodgeCd > 0 || g.musouTime >= 0) return false;
    const perfect = g.hazards.some(h => h.remaining <= 0.48 && h.remaining > 0);
    g.swing = null;
    g.moveKey = null;
    g.chainKind = null;
    g.chainStage = 0;
    g.chainTimer = 0;
    g.dodgeCd = 0.95;
    g.invincible = 0.5;
    g.dodgeTime = 0.48;
    g.dodgeDirection = direction >= 0 ? 1 : -1;
    emit('dodge');
    if (perfect) {
      g.perfect++;
      g.energy = Math.min(100, g.energy + 14);
      emit('perfect');
      emit('message', { text: '完美闪避 · 水车合击 +14', duration: 1.1 });
    }
    return true;
  }

  function updateAlly(dt, rootProgress) {
    const a = g.ally;
    const home = companionHome(a.side);
    if (g.musouTime >= 0) {
      const progress = clamp(rootProgress ? rootProgress(g.musouTime) : g.musouTime / (WHEEL.landingTime - 0.06), 0, 1);
      a.x = a.castStart.x;
      a.z = a.castStart.z - progress * Math.min(1.6, a.castStart.z + 3.4);
      a.yaw = Math.PI;
      a.returning = false;
      a.backing = false;
    } else {
      const foe = g.enemies
        .filter(e => e.hp > 0 && e.z > -5.5)
        .sort((p, q) => Math.hypot(p.x - a.x, p.z - a.z) - Math.hypot(q.x - a.x, q.z - a.z))[0];
      const side = a.side;
      let hx = home.x;
      let hz = home.z;
      if (foe) {
        hx = clamp(home.x + clamp((foe.x - home.x) * side, -0.2, 0.35) * side, -0.66, 0.66);
        hz = clamp(foe.z + 0.85, -2.55, -2.02);
      }
      const dx = hx - a.x;
      const dz = hz - a.z;
      const d = Math.hypot(dx, dz);
      const stepDist = Math.min(d, dt * (foe ? 2.6 : 2.1));
      a.returning = d > 0.02;
      a.backing = a.returning && dz > 0.02;
      if (d > 0.0001) {
        a.x += (dx / d) * stepDist;
        a.z += (dz / d) * stepDist;
      }
      const target = g.enemies
        .filter(e => e.hp > 0 && e.z < a.z - 0.2)
        .sort((p, q) => Math.hypot(p.x - g.ally.x, p.z - g.ally.z) - Math.hypot(q.x - g.ally.x, q.z - g.ally.z))[0];
      const desired = target
        ? Math.PI + clamp(angleDelta(Math.atan2(target.x - a.x, target.z - a.z), Math.PI), -0.5, 0.5)
        : Math.PI;
      a.yaw += angleDelta(desired, a.yaw) * Math.min(1, dt * 8);
    }
  }

  function step(dt, rootProgress) {
    if (g.status !== 'playing') return;
    g.time += dt;
    for (const key of [
      'lightCd',
      'heavyCd',
      'dodgeCd',
      'spinCd',
      'thrustBurstCd',
      'ultCd',
      'invincible',
      'dodgeTime',
      'allyCd',
    ]) {
      g[key] = Math.max(0, g[key] - dt);
    }
    if (g.guarding && g.musouTime < 0) {
      g.energy = Math.min(100, g.energy + dt * 9.5);
    }
    if (g.swing) {
      resolveSwing(dt);
    } else {
      g.chainTimer = Math.max(0, g.chainTimer - dt);
      if (g.chainTimer <= 0) {
        g.chainStage = 0;
        g.chainKind = null;
      }
    }
    if (g.dodgeTime > 0) {
      g.player.x = Math.sin((g.dodgeTime / 0.48) * Math.PI) * 0.52 * g.dodgeDirection;
    } else if (g.steerActive) {
      g.player.x = clamp(g.player.x + g.steerX * dt * 1.65, -0.68, 0.68);
      g.player.z = clamp(g.player.z - g.steerY * dt * 1.25, -0.52, 0.42);
    } else {
      g.player.x += (0 - g.player.x) * Math.min(1, dt * 6);
      g.player.z += (0 - g.player.z) * Math.min(1, dt * 6);
    }

    const close = g.enemies.some(e => e.hp > 0 && e.z > -4.8);
    const walkTarget = g.musouTime >= 0 ? 0 : g.bossSpawned && !g.bossDefeated ? 0.22 : close ? 0.38 : WALK_SPEED;
    g.speed += clamp(walkTarget - g.speed, -dt * 2.2, dt * 1.4);
    g.progress += g.speed * dt;

    const phase = g.progress < 12 ? 0 : !g.bossSpawned ? 1 : 2;
    if (phase !== g.phase) {
      g.phase = phase;
      emit('message', {
        text: phase === 1 ? '前方鬼群逼近 · 留意地面红光闪避反击' : '上弦之陆 · 堕姬现身，释放水车合击！',
        duration: 3,
      });
      if (phase === 2) emit('wave', { wave: 8 });
    }
    if (g.progress >= g.bossAt && !g.bossSpawned) {
      g.bossSpawned = true;
      for (const e of g.enemies) {
        if (!e.boss && e.hp > 0) hurtEnemy(e, 999, true, false);
      }
      g.enemies = g.enemies.filter(e => e.hp > 0);
      spawn(true);
    }
    const living = g.enemies.filter(e => e.hp > 0);
    const cap = g.progress < 10 ? 1 : 2;
    if (g.time >= g.spawnAt && living.length < cap && !g.bossSpawned) {
      spawn();
      g.spawnAt = g.time + (g.progress < 12 ? 4.4 : 3.1);
    }

    if (g.musouTime >= 0) {
      const before = g.musouTime;
      g.musouTime += dt;
      updateAlly(dt, rootProgress);
      if (before < WHEEL.swingStart && g.musouTime >= WHEEL.swingStart) emit('musouRelease');
      while (g.musouBeat < WHEEL.damageTimes.length && g.musouTime >= WHEEL.damageTimes[g.musouBeat]) {
        g.musouBeat++;
        for (const e of g.enemies) hurtEnemy(e, 56, true, false);
        emit('impact', { heavy: true });
      }
      if (g.musouTime >= WHEEL.duration) {
        g.musouTime = -1;
        emit('recover');
      }
    } else {
      updateAlly(dt, rootProgress);
    }

    for (const e of g.enemies) {
      e.flash = Math.max(0, e.flash - dt);
      e.stun = Math.max(0, e.stun - dt);
      e.tell = 0;
      if (e.hp <= 0) {
        e.dead += dt;
        continue;
      }
      e.yaw = Math.atan2(-e.x, -e.z);
      if (e.stun > 0) continue;
      const stop = e.boss ? 2.45 : e.role === 'caster' ? 2.55 : 2.25;
      if (e.z < -stop) {
        e.z = Math.min(-stop, e.z + (e.boss ? 1.6 : e.role === 'caster' ? 2.0 : 2.4) * dt);
        e.x += clamp(e.lane - e.x, -0.8 * dt, 0.8 * dt);
        continue;
      }
      if (!e.arrived) {
        e.arrived = true;
        e.cooldown = Math.max(e.cooldown, e.boss ? 1.3 : 1.0);
      }
      e.cooldown -= dt;
      if (e.cooldown <= 0 && g.musouTime < 0) {
        const duration = e.boss ? 1.45 : 1.85;
        const h = {
          id: ++g.seq,
          source: e.id,
          remaining: duration,
          duration,
          kind: e.role === 'caster' ? 'blood' : 'claw',
          label: e.boss ? '血带 · 连环杀阵' : e.role === 'caster' ? '血印爆发' : '利爪突袭',
          x: e.x,
          z: e.z,
        };
        g.hazards.push(h);
        e.cooldown = e.boss ? 3.1 : 4.2;
        emit('enemyTell');
      }
    }

    for (const h of g.hazards) {
      h.remaining -= dt;
      const source = g.enemies.find(e => e.id === h.source);
      if (source) source.tell = Math.max(0.01, h.remaining);
      if (h.remaining <= 0) {
        emit('enemyStrike');
        if (source) {
          source.tell = 0;
          source.attackKind = h.kind;
          source.attackAt = g.time;
          source.attackUntil = g.time + 0.32;
        }
        if (g.guarding) {
          g.perfect++;
          g.energy = Math.min(100, g.energy + 18);
          g.invincible = Math.max(g.invincible, 0.35);
          if (source && source.hp > 0) {
            source.stun = Math.max(source.stun, 0.55);
            source.flash = 0.14;
          }
          emit('parry', { source: h.source });
          emit('perfect');
          emit('message', { text: '水之呼吸 · 流流舞 弹反成功！水车 +18', duration: 1.3 });
        } else if (g.invincible <= 0) {
          const damage = source?.boss ? 16 : 10;
          g.hp = Math.max(0, g.hp - damage);
          g.damageTaken += damage;
          g.invincible = 0.6;
          emit('hurt');
        } else {
          emit('evaded');
        }
      }
    }
    g.hazards = g.hazards.filter(h => h.remaining > 0);

    if (g.allyCd <= 0 && g.musouTime < 0) {
      const target = g.enemies
        .filter(e => e.hp > 0 && Math.hypot(e.x - g.ally.x, e.z - g.ally.z) <= 3.2)
        .sort((p, q) => Math.hypot(p.x - g.ally.x, p.z - g.ally.z) - Math.hypot(q.x - g.ally.x, q.z - g.ally.z))[0];
      if (target) {
        hurtEnemy(target, target.boss ? 9 : 16, false, false);
        emit('allyAttack', { target: target.id });
        g.allyCd = 2.1;
      } else {
        g.allyCd = 0.4;
      }
    }

    g.enemies = g.enemies.filter(e => e.hp > 0 || e.dead < 1.05);
    while (g.enemies.length > MAX_ENEMIES) {
      const dead = g.enemies.findIndex(e => e.hp <= 0);
      if (dead < 0) break;
      g.enemies.splice(dead, 1);
    }
    resolveFormation(g);
    if (g.hp <= 0) finish(false);
    else if (g.bossDefeated && g.musouTime < 0) finish(true);
  }

  return Object.assign(g, {
    start,
    step,
    attack,
    dodge,
    stageView,
    castWaterWheel,
    castThrust,
    setGuard,
    castUltimate,
    setMoveAxes,
  });
}
