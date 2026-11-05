export const ENEMY_REVISION = 'after-sunset-enemies-20261021-v1';
export const MINIONS = ['demon-1', 'demon-2', 'demon-3', 'demon-4', 'demon-5'];
export const ENEMY_IDS = [...MINIONS, 'daki', 'gyutaro'];

export function enemyModelId(e, bossId = 'daki') {
  return e.boss ? bossId : MINIONS[((e.id || 1) - 1) % MINIONS.length];
}

const ATTACKS = {
  claw: { clip: 'Lib_Zombie_Scratch', contact: 0.9 },
  rush: { clip: 'Lib_Punch_Cross', contact: 0.48 },
  slam: { clip: 'Lib_Melee_Hook', contact: 0.25 },
  blood: { clip: 'Lib_Spell_Simple_Shoot', contact: 0.3 },
};

export function enemyAttack(id, kind) {
  if (id === 'daki') {
    return kind === 'blood'
      ? { clip: 'Lib_Daki_Thrust', contact: 0.9 }
      : { clip: 'Lib_Daki_Sweep', contact: 1.1 };
  }
  if (id === 'gyutaro') {
    return kind === 'blood'
      ? { clip: 'Lib_Sword_Regular_C', contact: 0.63 }
      : { clip: 'Lib_Sword_Regular_A', contact: 0.22 };
  }
  return ATTACKS[kind] || ATTACKS.claw;
}

export function enemyPose(e, id, time, moving, hazard) {
  if (e.hp <= 0) return { clip: 'Lib_Death01', time: Math.min(2.416, e.dead * 2), state: 'death' };
  if (e.flash > 0 || e.stun > 0) {
    return { clip: 'Lib_Hit_Chest', time: Math.min(0.34, Math.max(0, 0.35 - (e.stun || e.flash))), state: 'hit' };
  }
  if (hazard) {
    const attack = enemyAttack(id, hazard.kind);
    const elapsed = hazard.time ?? hazard.duration - hazard.remaining;
    return { ...attack, time: Math.max(0, (elapsed / Math.max(0.01, hazard.duration)) * attack.contact), state: 'attack' };
  }
  if (e.attackUntil > time) {
    const attack = enemyAttack(id, e.attackKind);
    return { ...attack, time: attack.contact + Math.max(0, time - e.attackAt), state: 'recover' };
  }
  return {
    clip: moving ? 'Lib_Jog_Fwd_Loop' : 'Lib_Idle_No_Loop',
    time: time + (e.phase || 0),
    state: moving ? 'run' : 'idle',
    loop: true,
  };
}
