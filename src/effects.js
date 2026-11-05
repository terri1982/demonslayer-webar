import * as T from 'three';
import { MOVES } from './simulation.js';

export function createEffects(worldRoot, { wheelScale = 0.66, wheelFacingOffset = -Math.PI / 2, ringScale = 0.22 } = {}) {
  const max = 480;
  const parts = [];
  const dummy = new T.Object3D();
  let cursor = 0;

  const sparks = new T.InstancedMesh(
    new T.IcosahedronGeometry(0.04, 0),
    new T.MeshBasicMaterial({ color: 0xffffff }),
    max,
  );
  sparks.instanceMatrix.setUsage(T.DynamicDrawUsage);
  sparks.frustumCulled = false;
  worldRoot.add(sparks);

  for (let i = 0; i < max; i++) {
    parts.push({ life: 0 });
    dummy.scale.setScalar(0);
    dummy.updateMatrix();
    sparks.setMatrixAt(i, dummy.matrix);
  }

  const rings = [];
  function burst(x, y, z, count = 14, death = false) {
    for (let i = 0; i < count; i++) {
      const p = parts[cursor++ % max];
      const a = Math.random() * Math.PI * 2;
      const s = 0.8 + Math.random() * 2.8;
      Object.assign(p, {
        x,
        y,
        z,
        vx: Math.sin(a) * s,
        vy: 0.9 + Math.random() * 3.0,
        vz: Math.cos(a) * s,
        life: 0.28 + Math.random() * 0.4,
        max: 0.7,
        size: death ? 1.3 : 0.95,
      });
      sparks.setColorAt((cursor - 1) % max, new T.Color(death ? '#c0a2e8' : i % 3 === 0 ? '#ffe7ac' : '#b8f6ff'));
    }
    if (sparks.instanceColor) sparks.instanceColor.needsUpdate = true;
  }

  function ring(x, z, musou = false) {
    const o = new T.Mesh(
      new T.RingGeometry(0.88, 1.0, 72),
      new T.MeshBasicMaterial({
        color: musou ? '#a7f8ff' : '#89cbd3',
        transparent: true,
        opacity: 0.8,
        side: T.DoubleSide,
        depthWrite: false,
        blending: T.AdditiveBlending,
      }),
    );
    o.rotation.x = -Math.PI / 2;
    o.position.set(x, 0.04, z);
    worldRoot.add(o);
    rings.push({ o, t: 0, duration: musou ? 0.82 : 0.38, max: (musou ? 5.6 : 2.8) * ringScale });
  }

  const wheel = new T.Group();
  wheel.visible = false;
  worldRoot.add(wheel);

  const streams = [];
  for (let i = 0; i < 5; i++) {
    const points = [];
    for (let j = 0; j <= 72; j++) {
      const a = (j / 72) * Math.PI * 2;
      const rr = 1.45 + i * 0.12;
      points.push(new T.Vector3(Math.cos(a) * rr, Math.sin(a) * rr, Math.sin(a * 3 + i) * 0.08));
    }
    const curve = new T.CatmullRomCurve3(points);
    const geometry = new T.TubeGeometry(curve, 72, 0.024 + (i === 0 ? 0.024 : 0), 4, true);
    const o = new T.Mesh(
      geometry,
      new T.MeshBasicMaterial({
        color: i % 2 ? '#d1fcff' : '#45b9ef',
        transparent: true,
        opacity: 0.85,
        blending: T.AdditiveBlending,
        depthWrite: false,
      }),
    );
    o.rotation.z = i * 0.27;
    wheel.add(o);
    streams.push(o);
  }

  const glow = new T.PointLight(0x67ddff, 0, 8, 2);
  worldRoot.add(glow);

  return {
    burst,
    ring,
    update(dt, g) {
      for (let i = 0; i < max; i++) {
        const p = parts[i];
        p.life -= dt;
        if (p.life > 0) {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.z += p.vz * dt;
          p.vy -= 9.5 * dt;
          dummy.position.set(p.x, Math.max(0.03, p.y), p.z);
          dummy.scale.setScalar(p.size * Math.min(1, p.life * 4));
          dummy.rotation.set(p.life * 8, i, 0);
        } else {
          dummy.scale.setScalar(0);
        }
        dummy.updateMatrix();
        sparks.setMatrixAt(i, dummy.matrix);
      }
      sparks.instanceMatrix.needsUpdate = true;

      for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i];
        r.t += dt;
        const u = r.t / r.duration;
        r.o.scale.setScalar(0.1 + u * r.max);
        r.o.material.opacity = (1 - u) * 0.8;
        if (u >= 1) {
          worldRoot.remove(r.o);
          r.o.geometry.dispose();
          r.o.material.dispose();
          rings.splice(i, 1);
        }
      }

      const h = g.hero;
      const t = h.moveTime * MOVES.musou.speed;
      const start = MOVES.musou.releaseStart;
      const end = MOVES.musou.releaseEnd + 0.16;
      const active = h.move === 'musou' && t >= start && t < end;
      wheel.visible = active;
      if (active) {
        const envelope =
          T.MathUtils.smoothstep(t, start, start + 0.1) * (1 - T.MathUtils.smoothstep(t, end - 0.16, end));
        wheel.position.set(h.x + Math.sin(h.yaw) * 0.3, 1.38, h.z + Math.cos(h.yaw) * 0.3);
        wheel.rotation.set(0, h.yaw + Math.PI / 2 + wheelFacingOffset, 0);
        wheel.scale.setScalar((0.65 + 0.35 * T.MathUtils.smoothstep(t, start, start + 0.12)) * wheelScale);
        streams.forEach((o, i) => {
          o.rotation.z = (t - start) * (i % 2 ? 7 : -6) + i;
          o.material.opacity = 0.85 * envelope;
        });
        glow.position.copy(wheel.position);
        glow.intensity = 6 * envelope;
      } else {
        glow.intensity = Math.max(0, glow.intensity - dt * 25);
      }
    },
    stats: () => ({ wheelVisible: wheel.visible, rings: rings.length, light: glow.intensity }),
    reset() {
      for (const p of parts) p.life = 0;
      for (const r of rings) {
        worldRoot.remove(r.o);
        r.o.geometry.dispose();
        r.o.material.dispose();
      }
      rings.length = 0;
      wheel.visible = false;
      glow.intensity = 0;
    },
  };
}
