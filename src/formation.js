// Spatial formation calibrated for Handheld Rear-Camera WebAR & AR Glasses Optical WebXR:
// World units in meters, ground y = 0, forward = -Z.
// Core companion & shrine stage sits at z = -2.18m ~ -2.35m within <= 1.5m width so both
// phone cameras and ~46-52 deg FOV AR glasses keep the action comfortably framed.
export const BODY = { ally: 0.38, enemy: 0.36, boss: 0.44, player: 0.28, gap: 0.08 };
export const FIELD = { left: -1.12, right: 1.12, back: -10.5, front: -1.35 };

export const companionHome = (side, isGlasses = false) => ({
  x: (side === 1 ? 1 : -1) * (isGlasses ? 0.58 : 0.46),
  z: isGlasses ? -2.28 : -2.22,
  yaw: Math.PI,
  radius: BODY.ally,
});

export function bodyRadius(e) {
  return e.hp <= 0 ? Math.max(e.radius || BODY.enemy, 0.65 * (e.size || 1)) : e.radius || BODY.enemy;
}

export function bodyFootprint(e) {
  return { id: e.id, x: e.x, z: e.z, radius: bodyRadius(e) };
}

export function separationMargin(a, b) {
  const pa = bodyFootprint(a);
  const pb = bodyFootprint(b);
  return Math.hypot(pa.x - pb.x, pa.z - pb.z) - pa.radius - pb.radius - BODY.gap;
}

function placeOutside(body, obstacles) {
  const radius = bodyRadius(body);
  const left = FIELD.left + radius;
  const right = FIELD.right - radius;
  const back = FIELD.back + radius;
  const front = FIELD.front - radius;
  const ox = body.x;
  const oz = body.z;
  const valid = (x, z) =>
    obstacles.every(o => Math.hypot(x - o.x, z - o.z) >= radius + bodyRadius(o) + BODY.gap - 1e-7);
  const bound = (n, min, max) => Math.max(min, Math.min(max, n));
  body.x = bound(body.x, left, right);
  body.z = bound(body.z, back, front);
  if (valid(body.x, body.z)) return;

  let best = null;
  let score = Infinity;
  function candidate(x, z) {
    const cx = bound(x, left, right);
    const cz = bound(z, back, front);
    const d = (cx - ox) ** 2 + (cz - oz) ** 2;
    if (d < score && valid(cx, cz)) {
      score = d;
      best = { x: cx, z: cz };
    }
  }
  for (const o of obstacles) {
    const r = radius + bodyRadius(o) + BODY.gap + 0.0001;
    const angle =
      Math.hypot(ox - o.x, oz - o.z) > 0.0001
        ? Math.atan2(oz - o.z, ox - o.x)
        : (body.id || 1) * 2.39996;
    candidate(o.x + Math.cos(angle) * r, o.z + Math.sin(angle) * r);
    for (let i = 0; i < 36; i++) {
      const a = angle + (i * Math.PI) / 18;
      candidate(o.x + Math.cos(a) * r, o.z + Math.sin(a) * r);
    }
  }
  if (!best) {
    for (let x = left; x <= right; x += 0.12) {
      for (let z = back; z <= front; z += 0.16) candidate(x, z);
    }
  }
  if (best) {
    body.x = best.x;
    body.z = best.z;
  }
}

export function resolveFormation(g) {
  const bodies = g.enemies.map(e => bodyFootprint(e));
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    const x = body.x;
    const z = body.z;
    placeOutside(body, [g.player, g.ally, ...bodies.filter(other => other !== body)]);
    g.enemies[i].x += body.x - x;
    g.enemies[i].z += body.z - z;
  }
}

export function formationStats(g) {
  let minimum = Infinity;
  for (let i = 0; i < g.enemies.length; i++) {
    const e = g.enemies[i];
    minimum = Math.min(minimum, separationMargin(e, g.player), separationMargin(e, g.ally));
    for (let j = i + 1; j < g.enemies.length; j++) {
      minimum = Math.min(minimum, separationMargin(e, g.enemies[j]));
    }
  }
  return { minimumMargin: Number.isFinite(minimum) ? minimum : null, bodyGap: BODY.gap };
}
