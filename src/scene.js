import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { assetUrl } from './assets.js';
import { createToonVariants } from './toon.js';
import { createAttackVfx, measureAttackCues } from './attack-vfx.js';
import { clamp } from './simulation.js';
import { companionHome } from './formation.js';

// Core spatial shrine centered at z = -2.25m, ground y = 0, total width 1.44m (<= 1.5m), height <= 1.58m.
export function createCourtyard(worldRoot) {
  const group = new T.Group();
  worldRoot.add(group);

  const mat = c => new T.MeshStandardMaterial({ color: c, roughness: 0.85, metalness: 0.05 });
  const wood = mat('#7c333f');
  const dark = mat('#242b36');
  const gold = mat('#cda96d');

  function box(w, h, d, x, y, z, m) {
    const mesh = new T.Mesh(new T.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    group.add(mesh);
    return mesh;
  }

  // Ground wisteria seal rings (outer radius 0.72m -> 1.44m total width <= 1.5m).
  const sealMaterial = new T.MeshBasicMaterial({
    color: '#bda3ff',
    transparent: true,
    opacity: 0.68,
    side: T.DoubleSide,
    depthWrite: false,
  });
  for (const r of [0.54, 0.63, 0.72]) {
    const ring = new T.Mesh(new T.RingGeometry(r - 0.012, r, 96), sealMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(0, 0.012, -2.22);
    group.add(ring);
  }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const marker = box(0.036, 0.01, 0.11, Math.sin(a) * 0.63, 0.016, -2.22 + Math.cos(a) * 0.63, gold);
    marker.rotation.y = a;
  }

  // Open-arch wisteria torii frame at z = -2.46m, total span 1.48m (<= 1.5m), crossbeams raised above 2.02m so 1.55m eye-level demon combat view is 100% unobstructed.
  for (const side of [-1, 1]) {
    box(0.075, 2.22, 0.075, side * 0.66, 1.11, -2.46, wood);
    box(0.12, 0.06, 0.12, side * 0.66, 0.03, -2.46, dark);
  }
  box(1.44, 0.075, 0.09, 0, 2.22, -2.46, wood);
  box(1.48, 0.045, 0.11, 0, 2.295, -2.46, dark);
  box(1.28, 0.05, 0.065, 0, 2.02, -2.46, wood);

  const portal = new T.Mesh(
    new T.PlaneGeometry(1.22, 1.94),
    new T.MeshBasicMaterial({
      color: '#7954ac',
      transparent: true,
      opacity: 0.08,
      side: T.DoubleSide,
      depthWrite: false,
    }),
  );
  portal.position.set(0, 1.0, -2.47);
  group.add(portal);

  // Instanced wisteria blossoms within <= 0.73m radius around z = -2.22m.
  const blossom = new T.InstancedMesh(
    new T.IcosahedronGeometry(0.028, 0),
    new T.MeshStandardMaterial({ color: '#c8abfa', emissive: '#5a2c7c', emissiveIntensity: 0.5 }),
    96,
  );
  const dummy = new T.Object3D();
  for (let i = 0; i < 96; i++) {
    const a = i * 2.39996;
    const r = 0.58 + Math.sin(i * 7) * 0.11;
    dummy.position.set(Math.sin(a) * r, 0.05 + (i % 6) * 0.045, -2.22 + Math.cos(a) * r);
    dummy.scale.setScalar(0.65 + (i % 4) * 0.14);
    dummy.updateMatrix();
    blossom.setMatrixAt(i, dummy.matrix);
  }
  group.add(blossom);

  // Floating wisteria petals inside the 1.44m x 1.6m spatial stage.
  const points = new Float32Array(72 * 3);
  for (let i = 0; i < 72; i++) {
    points[i * 3] = Math.sin(i * 91) * 0.68;
    points[i * 3 + 1] = (i % 16) * 0.095;
    points[i * 3 + 2] = -2.22 + Math.cos(i * 13) * 0.55;
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.BufferAttribute(points, 3));
  const petals = new T.Points(
    geometry,
    new T.PointsMaterial({
      size: 0.022,
      color: '#dec6ff',
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
    }),
  );
  group.add(petals);

  return {
    group,
    update(t, dawn = 0) {
      sealMaterial.opacity = 0.48 + Math.sin(t * 1.8) * 0.12;
      portal.material.opacity = 0.07 + Math.sin(t * 2) * 0.03;
      for (let i = 0; i < 72; i++) {
        points[i * 3 + 1] = ((i % 16) * 0.095 + t * (0.045 + (i % 3) * 0.01)) % 1.56;
      }
      geometry.attributes.position.needsUpdate = true;
      sealMaterial.color.set(dawn ? '#ffe1aa' : '#bda3ff');
    },
  };
}

export async function createAlly(worldRoot, renderer, onProgress) {
  onProgress?.('正在唤醒炭治郎与日轮刀…');
  const manifest = await fetch(assetUrl('assets/characters/tanjiro.json')).then(r => {
    if (!r.ok) throw Error('角色配置加载失败');
    return r.json();
  });
  const gltf = await new GLTFLoader().loadAsync(
    assetUrl(`assets/characters/tanjiro.glb?v=${encodeURIComponent(manifest.revision)}`),
  );
  const actor = new T.Group();
  actor.add(gltf.scene);
  worldRoot.add(actor);

  gltf.scene.traverse(o => {
    if (o.isMesh) {
      o.frustumCulled = false;
      o.castShadow = false;
      o.receiveShadow = false;
    }
  });

  const model = {
    actor,
    gltf,
    manifest,
    mixer: new T.AnimationMixer(gltf.scene),
    materials: createToonVariants(gltf.scene),
    action: null,
    name: '',
  };
  model.materials.setOutlines(true);
  model.materials.apply();

  const hips = gltf.scene.getObjectByName('Hips');
  const wheel = gltf.animations.find(c => c.name === 'WaterWheel');
  const samples = [];
  const origin = new T.Vector3();
  const count = Math.ceil(wheel.duration * 120);
  const interval = wheel.duration / count;
  const sampling = model.mixer.clipAction(wheel).reset().setLoop(T.LoopOnce, 1);
  sampling.clampWhenFinished = true;
  sampling.play();
  for (let i = 0; i <= count; i++) {
    sampling.time = Math.min(wheel.duration - 1e-6, i * interval);
    model.mixer.update(0);
    gltf.scene.updateMatrixWorld(true);
    const p = hips.getWorldPosition(new T.Vector3());
    if (i === 0) origin.copy(p);
    samples.push({ x: p.x - origin.x, z: p.z - origin.z });
  }
  model.mixer.stopAllAction();

  const chainNames = ['Light1', 'Light2', 'Light3', 'Heavy1', 'Heavy2', 'Heavy3'];
  const roots = {};
  function bankFor(clip) {
    const localSamples = [];
    const localOrigin = new T.Vector3();
    const n = Math.max(1, Math.ceil(clip.duration * 60));
    const step = clip.duration / n;
    const action = model.mixer.clipAction(clip).reset().setLoop(T.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    for (let i = 0; i <= n; i++) {
      action.time = Math.min(clip.duration - 1e-6, i * step);
      model.mixer.update(0);
      gltf.scene.updateMatrixWorld(true);
      const p = hips.getWorldPosition(new T.Vector3());
      if (i === 0) localOrigin.copy(p);
      localSamples.push({ x: p.x - localOrigin.x, z: p.z - localOrigin.z });
    }
    model.mixer.stopAllAction();
    return { samples: localSamples, count: n, interval: step };
  }
  for (const name of chainNames) {
    const clip = gltf.animations.find(c => c.name === name);
    if (clip) roots[name] = bankFor(clip);
  }

  function rootOn(bank, time) {
    const { samples: s, count: n, interval: step } = bank;
    const at = clamp(time / step, 0, n);
    const i = Math.floor(at);
    const j = Math.min(n, i + 1);
    const f = at - i;
    return { x: T.MathUtils.lerp(s[i].x, s[j].x, f), z: T.MathUtils.lerp(s[i].z, s[j].z, f) };
  }

  function rootAt(time) {
    const at = clamp(time / interval, 0, count);
    const i = Math.floor(at);
    const j = Math.min(count, i + 1);
    const f = at - i;
    return { x: T.MathUtils.lerp(samples[i].x, samples[j].x, f), z: T.MathUtils.lerp(samples[i].z, samples[j].z, f) };
  }

  let vfx = null;
  let recover = null;
  let attackTime = -1;
  let miniWheelTime = -1;
  let thrustAnimTime = -1;
  let showingSwing = false;

  function play(name, fade = 0.12, enableBladeTrail = true) {
    if (model.name === name) return;
    const clip = gltf.animations.find(c => c.name === name) || gltf.animations.find(c => c.name === 'CombatIdle');
    const previous = model.action;
    const next = model.mixer.clipAction(clip);
    next.reset().setEffectiveWeight(1).setEffectiveTimeScale(1);
    const loop = manifest.clips.find(c => c.name === name)?.loop;
    next.setLoop(loop ? T.LoopRepeat : T.LoopOnce, loop ? Infinity : 1);
    next.clampWhenFinished = true;
    next.play();
    if (previous && previous !== next) {
      previous.fadeOut(fade);
      next.fadeIn(fade);
    }
    model.action = next;
    model.name = name;
    if (enableBladeTrail) {
      vfx?.begin('tanjiro');
    } else {
      vfx?.clear();
    }
  }

  play('CombatIdle', 0);
  onProgress?.('正在汇聚水之呼吸刀纹…');
  try {
    vfx = await createAttackVfx({
      renderer,
      worldRoot,
      models: { tanjiro: model },
      cues: measureAttackCues({ tanjiro: model }),
    });
  } catch (e) {
    console.warn('Water VFX fallback:', e.message);
  }

  model.mixer.stopAllAction();
  model.name = '';
  play('CombatIdle', 0);

  const home = companionHome(-1);
  actor.position.set(home.x, 0, home.z);
  actor.rotation.y = home.yaw;

  function update(dt, g) {
    actor.position.set(g.ally.x, 0, g.ally.z);
    actor.rotation.y = g.ally.yaw;
    const casting = g.musouTime >= 0;
    if (casting) {
      miniWheelTime = -1;
      thrustAnimTime = -1;
      if (model.name !== 'WaterWheel') {
        play('WaterWheel', 0.055);
        recover = null;
        attackTime = -1;
      }
      model.mixer.update(dt);
      model.action.time = Math.min(wheel.duration - 1e-6, g.musouTime);
      model.action.paused = false;
      model.mixer.update(0);
      const p = rootAt(g.musouTime);
      gltf.scene.position.set(-p.x, 0, -p.z);
    } else if (miniWheelTime >= 0) {
      // Dedicated Skill 1 (贰之型·水车): compact 0.74s vertical somersault slice (0.60s -> 1.66s of WaterWheel clip)
      showingSwing = false;
      miniWheelTime += dt;
      const miniDur = 0.74;
      if (miniWheelTime >= miniDur) {
        miniWheelTime = -1;
        recover = { x: 0, z: 0, time: 0 };
        play('CombatIdle', 0.12);
        gltf.scene.position.set(0, 0, 0);
      } else {
        if (model.name !== 'WaterWheel') {
          play('WaterWheel', 0.045);
          recover = null;
          attackTime = -1;
        }
        const u = clamp(miniWheelTime / miniDur, 0, 1);
        const clipTime = Math.min(wheel.duration - 1e-6, 0.6 + u * 1.06);
        model.action.setEffectiveTimeScale(1);
        model.mixer.update(dt);
        model.action.time = clipTime;
        model.action.paused = false;
        model.mixer.update(0);
        const p = rootAt(clipTime);
        const arcForward = Math.sin(u * Math.PI) * 0.36;
        gltf.scene.position.set(-p.x, 0, -p.z + arcForward);
      }
    } else if (thrustAnimTime >= 0) {
      // Dedicated Skill 2 (柒之型·雫波纹击刺): crisp linear forward stab (Heavy1 thrust window ONLY, never Heavy2/Heavy3!)
      showingSwing = false;
      thrustAnimTime += dt;
      const thrustDur = 0.5;
      if (thrustAnimTime >= thrustDur || !roots.Heavy1) {
        thrustAnimTime = -1;
        recover = { x: 0, z: 0, time: 0 };
        play('CombatIdle', 0.1);
        gltf.scene.position.set(0, 0, 0);
      } else {
        if (model.name !== 'Heavy1') {
          play('Heavy1', 0.04, false);
          recover = null;
          attackTime = -1;
        }
        vfx?.clear();
        const u = clamp(thrustAnimTime / thrustDur, 0, 1);
        // Rapid thrust extension over first 42%, brief hold, crisp snap back:
        const stabPhase = u < 0.42 ? u / 0.42 : 1 - ((u - 0.42) / 0.58) * 0.25;
        const clipTime = Math.min(model.action.getClip().duration - 1e-6, 0.07 + clamp(stabPhase, 0, 1) * 0.44);
        model.action.setEffectiveTimeScale(1);
        model.mixer.update(dt);
        model.action.time = clipTime;
        model.action.paused = false;
        model.mixer.update(0);
        const p = rootOn(roots.Heavy1, clipTime);
        const lungeForward = Math.sin(Math.pow(u, 0.72) * Math.PI) * 0.64;
        gltf.scene.position.set(-p.x, 0, -p.z + lungeForward);
      }
    } else {
      const swing = g.swing;
      showingSwing = !!(swing?.clip && roots[swing.clip]);
      if (swing?.clip && roots[swing.clip]) {
        if (model.name !== swing.clip) {
          play(swing.clip, 0.05);
          recover = null;
          attackTime = -1;
        }
        const span = model.action.getClip().duration;
        const t = Math.min(span - 1e-6, swing.time * swing.speed);
        model.action.setEffectiveTimeScale(1);
        model.mixer.update(dt);
        model.action.time = t;
        model.action.paused = false;
        model.mixer.update(0);
        const p = rootOn(roots[swing.clip], t);
        gltf.scene.position.set(-p.x, 0, -p.z);
      } else {
        if (model.name === 'WaterWheel') {
          recover = { ...rootAt(model.action.time), time: 0 };
          play('CombatIdle', 0.14);
        } else if (roots[model.name] && attackTime < 0) {
          recover = { ...rootOn(roots[model.name], model.action.time), time: 0 };
          play('CombatIdle', 0.12);
        }
        if (attackTime >= 0) {
          attackTime += dt;
          if (attackTime > 0.55) {
            attackTime = -1;
            play('CombatIdle');
          }
        } else if (g.status !== 'victory' && g.status !== 'defeat') {
          const out = g.ally.returning && !g.ally.backing;
          play(out ? 'Run' : g.ally.returning || (g.speed || 0) > 0.3 ? 'Walk' : 'CombatIdle');
        }
        if (g.status === 'victory') {
          play(gltf.animations.some(c => c.name === 'Victory') ? 'Victory' : 'CombatIdle');
        }
        model.action.setEffectiveTimeScale(
          model.name === 'Walk' ? clamp(((g.speed || 0) - (g.ally.backing ? 2.5 : 0)) / 1.3, -1, 1.25) : 1,
        );
        model.mixer.update(dt);
        if (roots[model.name]) {
          const p = rootOn(roots[model.name], model.action.time);
          gltf.scene.position.set(-p.x, 0, -p.z);
        } else if (recover) {
          recover.time += dt;
          const weight = Math.max(0, 1 - recover.time / 0.14);
          gltf.scene.position.set(-recover.x * weight, 0, -recover.z * weight);
          if (weight === 0) recover = null;
        } else {
          gltf.scene.position.set(0, 0, 0);
        }
      }
    }
    model.materials.update(dt);
    model.materials.apply();
    actor.updateMatrixWorld(true);
    vfx?.update(dt);
  }

  return {
    actor,
    model,
    update,
    travelAt(time) {
      const p = rootAt(time);
      const end = samples.at(-1);
      return Math.hypot(p.x, p.z) / Math.max(0.01, Math.hypot(end.x, end.z));
    },
    attack() {
      if (model.name === 'WaterWheel' || miniWheelTime >= 0 || thrustAnimTime >= 0 || showingSwing) return;
      attackTime = 0;
      play('Light1');
    },
    spinWaterWheel() {
      thrustAnimTime = -1;
      attackTime = -1;
      miniWheelTime = 0;
      play('WaterWheel', 0.045);
    },
    thrustLunge() {
      miniWheelTime = -1;
      attackTime = -1;
      thrustAnimTime = 0;
      vfx?.clear();
      play('Heavy1', 0.04, false);
    },
    draw(camera) {
      vfx?.draw(camera);
    },
    reset(pose = home) {
      model.mixer.stopAllAction();
      model.name = '';
      recover = null;
      attackTime = -1;
      miniWheelTime = -1;
      thrustAnimTime = -1;
      gltf.scene.position.set(0, 0, 0);
      actor.position.set(pose.x, 0, pose.z);
      actor.rotation.y = pose.yaw;
      vfx?.clear();
      play('CombatIdle', 0);
    },
    stats: () => ({
      clip: model.name,
      miniWheelActive: miniWheelTime >= 0,
      thrustActive: thrustAnimTime >= 0,
      position: actor.position.toArray(),
      revision: manifest.revision,
      vfx: vfx?.stats(),
    }),
  };
}

// Mounted strictly under worldRoot in scene (NEVER under camera) so camera.children.length === 0.
export function createSlashArc(worldRoot) {
  const slash = new T.Group();
  slash.visible = false;
  worldRoot.add(slash);

  for (let i = 0; i < 3; i++) {
    const mesh = new T.Mesh(
      new T.RingGeometry(0.46 + i * 0.1, 0.475 + i * 0.1, 48, 1, 0.15, Math.PI * 1.25),
      new T.MeshBasicMaterial({
        color: i === 0 ? '#e5ffff' : '#7ddfe8',
        transparent: true,
        opacity: 0.8,
        side: T.DoubleSide,
        depthWrite: false,
        depthTest: false,
        blending: T.AdditiveBlending,
      }),
    );
    mesh.position.z = -0.02 * i;
    mesh.rotation.z = -0.8 + i * 0.08;
    slash.add(mesh);
  }

  const forward = new T.Vector3();
  const worldPos = new T.Vector3();
  const localQuat = new T.Quaternion();
  const invRootQuat = new T.Quaternion();
  const rollQuat = new T.Quaternion();
  const zAxis = new T.Vector3(0, 0, 1);

  return {
    group: slash,
    update(camera, slashTime, slashHeavy, active, slashDir = 'right') {
      // NEVER render curved blade arc on 柒之型·雫波纹击刺 ('thrust') so Thrust is 100% linear water-lance + ripples!
      if (slashDir === 'thrust') {
        slash.visible = false;
        return;
      }
      slash.visible = active && slashTime > 0;
      if (!slash.visible) return;
      camera.getWorldPosition(worldPos);
      camera.getWorldDirection(forward);
      worldPos.addScaledVector(forward, slashDir?.startsWith('spin') ? 1.24 : 1.15);
      worldRoot.worldToLocal(worldPos);
      slash.position.copy(worldPos);

      worldRoot.getWorldQuaternion(invRootQuat).invert();
      camera.getWorldQuaternion(localQuat).premultiply(invRootQuat);
      const isSpin = Boolean(slashDir?.startsWith('spin'));
      const duration = isSpin ? 0.56 : 0.25;
      const t = clamp(1 - slashTime / duration, 0, 1);

      let baseAngle = -0.5;
      let sweep = 1.8;
      if (slashDir === 'left') {
        baseAngle = 2.64;
        sweep = -1.85;
      } else if (slashDir === 'up') {
        baseAngle = -2.05;
        sweep = 1.75;
      } else if (slashDir === 'down') {
        baseAngle = 1.05;
        sweep = -1.75;
      } else if (slashDir === 'spin-cw') {
        baseAngle = 0;
        sweep = -Math.PI * 3.1;
      } else if (slashDir === 'spin-ccw') {
        baseAngle = 0;
        sweep = Math.PI * 3.1;
      }
      rollQuat.setFromAxisAngle(zAxis, baseAngle + t * sweep);
      localQuat.multiply(rollQuat);
      slash.quaternion.copy(localQuat);
      const scaleBase = isSpin ? 1.42 : slashHeavy ? 1.22 : 0.96;
      slash.scale.setScalar(scaleBase);
      for (let i = 0; i < slash.children.length; i++) {
        const m = slash.children[i];
        m.material.color.set(
          isSpin
            ? i === 0
              ? '#ffffff'
              : i === 1
                ? '#38bdf8'
                : '#0284c7'
            : i === 0
              ? '#e5ffff'
              : '#7ddfe8',
        );
        m.material.opacity = (1 - t) * (isSpin ? 0.92 : 0.86);
      }
    },
  };
}

// 3D Water Breathing Guard Barrier ('fist-hold' / 'hold' in AR Glasses & Shift on Desktop)
// Mounted strictly under worldRoot (camera.children.length === 0).
export function createGuardShield(worldRoot) {
  const group = new T.Group();
  group.visible = false;
  worldRoot.add(group);

  const outerRing = new T.Mesh(
    new T.RingGeometry(0.26, 0.274, 56),
    new T.MeshBasicMaterial({
      color: '#6ff3ff',
      transparent: true,
      opacity: 0.48,
      side: T.DoubleSide,
      depthWrite: false,
      depthTest: false,
      blending: T.AdditiveBlending,
    }),
  );
  const innerRing = new T.Mesh(
    new T.RingGeometry(0.165, 0.176, 6),
    new T.MeshBasicMaterial({
      color: '#bdfbff',
      transparent: true,
      opacity: 0.44,
      side: T.DoubleSide,
      depthWrite: false,
      depthTest: false,
      blending: T.AdditiveBlending,
    }),
  );
  group.add(outerRing, innerRing);

  const worldPos = new T.Vector3();
  const forward = new T.Vector3();
  const invRootQuat = new T.Quaternion();
  const localQuat = new T.Quaternion();

  return {
    group,
    update(camera, active, nowSec) {
      group.visible = Boolean(active);
      if (!group.visible) return;
      camera.getWorldPosition(worldPos);
      camera.getWorldDirection(forward);
      worldPos.addScaledVector(forward, 1.32);
      worldPos.y -= 0.06;
      worldRoot.worldToLocal(worldPos);
      group.position.copy(worldPos);

      worldRoot.getWorldQuaternion(invRootQuat).invert();
      camera.getWorldQuaternion(localQuat).premultiply(invRootQuat);
      group.quaternion.copy(localQuat);

      outerRing.rotation.z = nowSec * 1.8;
      innerRing.rotation.z = -nowSec * 2.4;
      const pulse = 0.96 + Math.sin(nowSec * 6) * 0.05;
      group.scale.setScalar(pulse);
    },
  };
}

export function createWarnings(worldRoot) {
  const group = new T.Group();
  worldRoot.add(group);
  const meshes = new Map();

  function dispose(item) {
    group.remove(item);
    item.geometry.dispose();
    item.material.dispose();
  }

  function update(g) {
    for (const [id, mesh] of meshes) {
      if (!g.hazards.some(h => h.id === id)) {
        dispose(mesh);
        meshes.delete(id);
      }
    }
    for (const h of g.hazards) {
      let mesh = meshes.get(h.id);
      if (!mesh) {
        const blood = h.kind === 'blood';
        mesh = new T.Mesh(
          blood ? new T.RingGeometry(0.14, 0.72, 56) : new T.PlaneGeometry(0.62, 1),
          new T.MeshBasicMaterial({
            color: '#ff263b',
            transparent: true,
            opacity: 0.32,
            side: T.DoubleSide,
            depthWrite: false,
          }),
        );
        mesh.rotation.order = 'YXZ';
        mesh.rotation.x = -Math.PI / 2;
        if (blood) {
          mesh.position.set(g.player.x, 0.04, -1.55);
        } else {
          const dx = g.player.x - h.x;
          const dz = -1.2 - h.z;
          const len = Math.hypot(dx, dz) + 0.4;
          mesh.position.set((h.x + g.player.x) / 2, 0.04, (h.z - 1.2) / 2);
          mesh.rotation.y = Math.atan2(-dx, -dz);
          mesh.scale.y = len;
        }
        group.add(mesh);
        meshes.set(h.id, mesh);
      }
      mesh.material.opacity = 0.22 + (1 - h.remaining / h.duration) * 0.36 + Math.sin(g.time * 20) * 0.05;
      if (h.kind === 'blood') {
        mesh.scale.setScalar(0.75 + (1 - h.remaining / h.duration) * 0.22);
      }
    }
  }

  return {
    update,
    clear() {
      for (const mesh of meshes.values()) dispose(mesh);
      meshes.clear();
    },
  };
}

export function createContactShadows(worldRoot) {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(0,0,0,0.42)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);

  const material = new T.MeshBasicMaterial({
    map: new T.CanvasTexture(canvas),
    transparent: true,
    depthWrite: false,
  });
  const geometry = new T.PlaneGeometry(0.72, 0.54);
  const shadows = [];
  for (let i = 0; i < 5; i++) {
    const mesh = new T.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.visible = false;
    worldRoot.add(mesh);
    shadows.push(mesh);
  }

  return {
    update(enemies, ally) {
      const actors = [...enemies.filter(e => e.hp > 0), ...(ally?.visible ? [ally.position] : [])];
      for (let i = 0; i < shadows.length; i++) {
        shadows[i].visible = !!actors[i];
        if (actors[i]) shadows[i].position.set(actors[i].x, 0.02, actors[i].z);
      }
    },
  };
}

// 6DoF Right-Hand Spatial Ray Indicator for XREAL Air 2 Ultra (mounted strictly under worldRoot):
// Only 2 draw calls (cyan Water-Breathing tapered ray + fingertip target ring), pure-black additive friendly.
export function createHandRayIndicator(worldRoot) {
  const group = new T.Group();
  group.visible = false;
  worldRoot.add(group);

  const beamGeom = new T.CylinderGeometry(0.0018, 0.0052, 1, 8, 1, true);
  beamGeom.rotateX(-Math.PI / 2);
  beamGeom.translate(0, 0, -0.5);
  const beamMat = new T.MeshBasicMaterial({
    color: '#67f2ff',
    transparent: true,
    opacity: 0,
    side: T.DoubleSide,
    depthWrite: false,
    blending: T.AdditiveBlending,
  });
  const beamMesh = new T.Mesh(beamGeom, beamMat);
  group.add(beamMesh);

  const tipRing = new T.Mesh(
    new T.RingGeometry(0.015, 0.024, 32),
    new T.MeshBasicMaterial({
      color: '#bffdff',
      transparent: true,
      opacity: 0,
      side: T.DoubleSide,
      depthWrite: false,
      depthTest: false,
      blending: T.AdditiveBlending,
    }),
  );
  group.add(tipRing);

  let fade = 0;
  let wasEverActive = false;
  const originLocal = new T.Vector3();
  const endWorld = new T.Vector3();
  const endLocal = new T.Vector3();
  const dirLocal = new T.Vector3();
  const negZ = new T.Vector3(0, 0, -1);
  const camWorld = new T.Vector3();

  return {
    group,
    update({
      active = false,
      originWorld = null,
      dirWorld = null,
      length = 1.9,
      hovered = false,
      pinching = false,
      camera = null,
      dt = 0.016,
    } = {}) {
      if (active && originWorld && dirWorld) {
        wasEverActive = true;
        fade = Math.min(1, fade + dt * 9);
        originLocal.copy(originWorld);
        worldRoot.worldToLocal(originLocal);

        endWorld.copy(originWorld).addScaledVector(dirWorld, length);
        endLocal.copy(endWorld);
        worldRoot.worldToLocal(endLocal);

        dirLocal.subVectors(endLocal, originLocal);
        const localLen = Math.max(0.15, dirLocal.length());
        dirLocal.normalize();

        beamMesh.position.copy(originLocal);
        beamMesh.quaternion.setFromUnitVectors(negZ, dirLocal);
        beamMesh.scale.set(1, 1, localLen);

        tipRing.position.copy(endLocal);
        if (camera) {
          camera.getWorldPosition(camWorld);
          tipRing.lookAt(camWorld);
        }
      } else {
        fade = Math.max(0, fade - dt * 2.4);
      }

      group.visible = fade > 0.015;
      if (!group.visible) return;

      beamMat.color.set(pinching ? '#ffffff' : hovered ? '#9efcff' : '#67f2ff');
      beamMat.opacity = fade * (hovered ? 0.72 : 0.48);
      tipRing.material.color.set(pinching ? '#ffe299' : hovered ? '#7df9ff' : '#bffdff');
      tipRing.material.opacity = fade * 0.9;
      tipRing.scale.setScalar(pinching ? 0.72 : hovered ? 1.28 : 1.0);
    },
    stats: () => ({
      visible: group.visible,
      fade: Number(fade.toFixed(3)),
      wasEverActive,
    }),
  };
}

// Zero-GC Eye-Level (y = 1.15m..1.65m) 3D Spatial Water-Breathing VFX Pool for AR Glasses & WebAR:
// Strictly mounted under worldRoot (camera.children.length === 0).
// Pre-allocates <= 11 lightweight AdditiveBlending meshes (0 draw calls when idle) so every skill,
// enemy crimson telegraph, and footwork steering input has unmistakable 1:1 3D feedback inside XREAL's 25-deg vertical FOV.
function buildWaterWheelTexture() {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d');
  if (!g) return null;
  const cx = 256;
  const cy = 256;
  g.clearRect(0, 0, 512, 512);

  // Deep ocean sapphire & azure radial water current band:
  const ringGrad = g.createRadialGradient(cx, cy, 118, cx, cy, 246);
  ringGrad.addColorStop(0.0, 'rgba(2, 132, 199, 0)');
  ringGrad.addColorStop(0.26, 'rgba(14, 165, 233, 0.42)');
  ringGrad.addColorStop(0.62, 'rgba(29, 78, 216, 0.82)');
  ringGrad.addColorStop(0.84, 'rgba(56, 189, 248, 0.95)');
  ringGrad.addColorStop(0.95, 'rgba(240, 252, 255, 0.92)');
  ringGrad.addColorStop(1.0, 'rgba(255, 255, 255, 0)');
  g.fillStyle = ringGrad;
  g.beginPath();
  g.arc(cx, cy, 248, 0, Math.PI * 2);
  g.fill();

  // 6 Ukiyo-e swirling white sea-foam blades + inner water wheel spokes:
  for (let i = 0; i < 6; i++) {
    const base = (i / 6) * Math.PI * 2;
    g.save();
    g.translate(cx, cy);
    g.rotate(base);

    g.strokeStyle = 'rgba(240, 252, 255, 0.95)';
    g.lineWidth = 13;
    g.lineCap = 'round';
    g.beginPath();
    g.arc(0, 0, 206, -0.18, 0.68);
    g.stroke();

    g.strokeStyle = 'rgba(56, 189, 248, 0.88)';
    g.lineWidth = 8;
    g.beginPath();
    g.arc(0, 0, 168, 0.04, 0.78);
    g.stroke();

    // Sweeping foam crest fin:
    g.fillStyle = 'rgba(255, 255, 255, 0.92)';
    g.beginPath();
    g.moveTo(190, -28);
    g.quadraticCurveTo(242, 8, 224, 58);
    g.quadraticCurveTo(198, 22, 176, -8);
    g.closePath();
    g.fill();

    // Sea spray droplets:
    for (let d = 0; d < 4; d++) {
      const ang = 0.22 + d * 0.17;
      const rad = 228 + (d % 2) * 14;
      g.beginPath();
      g.arc(Math.cos(ang) * rad, Math.sin(ang) * rad, 4.5 - d * 0.7, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }

  const tex = new T.CanvasTexture(c);
  tex.colorSpace = T.SRGBColorSpace;
  return tex;
}

function buildThrustSpiralTexture() {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d');
  if (!g) return null;
  g.clearRect(0, 0, 256, 256);

  const vGrad = g.createLinearGradient(0, 0, 0, 256);
  vGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
  vGrad.addColorStop(0.18, 'rgba(180, 252, 255, 0.55)');
  vGrad.addColorStop(0.78, 'rgba(240, 255, 255, 0.96)');
  vGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
  g.strokeStyle = vGrad;
  g.lineCap = 'round';
  for (let i = -2; i < 6; i++) {
    g.lineWidth = i % 2 === 0 ? 10 : 5;
    g.beginPath();
    g.moveTo(i * 56, 0);
    g.lineTo(i * 56 + 112, 256);
    g.stroke();
  }
  const tex = new T.CanvasTexture(c);
  tex.colorSpace = T.SRGBColorSpace;
  tex.wrapS = T.RepeatWrapping;
  tex.wrapT = T.ClampToEdgeWrapping;
  return tex;
}

function buildThrustCoreTexture() {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const g = c.getContext('2d');
  if (!g) return null;
  // Cylinder V=0 is bottom (near player), V=1 is top (far tip at enemy): fade smoothly at near base!
  const grad = g.createLinearGradient(0, 256, 0, 0);
  grad.addColorStop(0.0, 'rgba(255, 255, 255, 0)');
  grad.addColorStop(0.16, 'rgba(224, 255, 255, 0.72)');
  grad.addColorStop(0.75, 'rgba(255, 255, 255, 0.98)');
  grad.addColorStop(0.96, 'rgba(255, 255, 255, 1.0)');
  grad.addColorStop(1.0, 'rgba(255, 255, 255, 0.2)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 256);
  const tex = new T.CanvasTexture(c);
  tex.colorSpace = T.SRGBColorSpace;
  return tex;
}

function buildThrustStarTexture() {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d');
  if (!g) return null;
  const cx = 128;
  const cy = 128;
  g.clearRect(0, 0, 256, 256);

  // Soft central water-droplet glow (strictly zero edge alpha so never a square!):
  const glow = g.createRadialGradient(cx, cy, 2, cx, cy, 74);
  glow.addColorStop(0.0, 'rgba(255, 255, 255, 0.98)');
  glow.addColorStop(0.28, 'rgba(186, 252, 255, 0.65)');
  glow.addColorStop(0.68, 'rgba(56, 189, 248, 0.16)');
  glow.addColorStop(1.0, 'rgba(56, 189, 248, 0)');
  g.fillStyle = glow;
  g.beginPath();
  g.arc(cx, cy, 76, 0, Math.PI * 2);
  g.fill();

  // 4 razor-sharp needle cross-flares + 4 delicate diagonal droplet needles:
  for (let i = 0; i < 8; i++) {
    const major = i % 2 === 0;
    const len = major ? 118 : 62;
    const halfW = major ? 6.5 : 3.2;
    g.save();
    g.translate(cx, cy);
    g.rotate((i * Math.PI) / 4);
    const rayGrad = g.createLinearGradient(0, -len, 0, len);
    rayGrad.addColorStop(0.0, 'rgba(255, 255, 255, 0)');
    rayGrad.addColorStop(0.38, 'rgba(185, 252, 255, 0.85)');
    rayGrad.addColorStop(0.5, 'rgba(255, 255, 255, 1)');
    rayGrad.addColorStop(0.62, 'rgba(185, 252, 255, 0.85)');
    rayGrad.addColorStop(1.0, 'rgba(255, 255, 255, 0)');
    g.fillStyle = rayGrad;
    g.beginPath();
    g.moveTo(0, -len);
    g.quadraticCurveTo(halfW, 0, 0, len);
    g.quadraticCurveTo(-halfW, 0, 0, -len);
    g.closePath();
    g.fill();
    g.restore();
  }

  const tex = new T.CanvasTexture(c);
  tex.colorSpace = T.SRGBColorSpace;
  return tex;
}

export function createSpatialCombatVfx(worldRoot) {
  const root = new T.Group();
  root.name = 'SpatialCombatVfxPool';
  worldRoot.add(root);

  // 1. 3D Giant Vertical Rolling Water Wheel ('circle' / 'swipe-up' -> 贰之型·水车):
  //    1.76m diameter double-layered painted ocean-foam wheel + glowing azure water tube + floor splash ring
  const wheelGroup = new T.Group();
  wheelGroup.visible = false;
  root.add(wheelGroup);

  const wheelTex = buildWaterWheelTexture();
  const wheelDiscMatA = new T.MeshBasicMaterial({
    map: wheelTex,
    color: '#ffffff',
    transparent: true,
    opacity: 0,
    side: T.DoubleSide,
    depthWrite: false,
    blending: T.AdditiveBlending,
  });
  const wheelDiscA = new T.Mesh(new T.PlaneGeometry(1.48, 1.48), wheelDiscMatA);
  wheelDiscA.rotation.y = 0.22;
  wheelGroup.add(wheelDiscA);

  const wheelDiscMatB = new T.MeshBasicMaterial({
    map: wheelTex,
    color: '#7dd3fc',
    transparent: true,
    opacity: 0,
    side: T.DoubleSide,
    depthWrite: false,
    blending: T.AdditiveBlending,
  });
  const wheelDiscB = new T.Mesh(new T.PlaneGeometry(1.3, 1.3), wheelDiscMatB);
  wheelDiscB.rotation.y = -0.26;
  wheelDiscB.position.z = 0.06;
  wheelGroup.add(wheelDiscB);

  const wheelTorusMat = new T.MeshBasicMaterial({
    color: '#1ca8ff',
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: T.AdditiveBlending,
  });
  const wheelTorus = new T.Mesh(new T.TorusGeometry(0.7, 0.03, 12, 64), wheelTorusMat);
  wheelGroup.add(wheelTorus);

  const wheelSplashMat = new T.MeshBasicMaterial({
    color: '#7dd3fc',
    transparent: true,
    opacity: 0,
    side: T.DoubleSide,
    depthWrite: false,
    blending: T.AdditiveBlending,
  });
  const wheelSplash = new T.Mesh(new T.RingGeometry(0.38, 0.88, 48), wheelSplashMat);
  wheelSplash.rotation.x = -Math.PI / 2;
  wheelSplash.position.y = -0.96;
  wheelGroup.add(wheelSplash);

  // 2. 3D 9.2m Straight-Line Piercing Water Lance + 4 Concentric '雫波纹' Droplet Ripples ('thrust' -> 柒之型·雫波纹击刺):
  //    Zero curved slash arcs! Sleek off-axis sword-hand water-lance + distance-adaptive concentric pond ripples!
  const thrustGroup = new T.Group();
  thrustGroup.visible = false;
  root.add(thrustGroup);

  const spearCoreGeom = new T.CylinderGeometry(0.0045, 0.011, 1, 12, 1, true);
  spearCoreGeom.rotateX(-Math.PI / 2);
  spearCoreGeom.translate(0, 0, -0.5);
  const spearMat = new T.MeshBasicMaterial({
    map: buildThrustCoreTexture(),
    color: '#ecffff',
    transparent: true,
    opacity: 0,
    side: T.DoubleSide,
    depthWrite: false,
    depthTest: false,
    blending: T.AdditiveBlending,
  });
  const spearMesh = new T.Mesh(spearCoreGeom, spearMat);
  thrustGroup.add(spearMesh);

  const spearVortexGeom = new T.CylinderGeometry(0.007, 0.038, 1, 16, 1, true);
  spearVortexGeom.rotateX(-Math.PI / 2);
  spearVortexGeom.translate(0, 0, -0.5);
  const spearVortexMat = new T.MeshBasicMaterial({
    map: buildThrustSpiralTexture(),
    color: '#67f2ff',
    transparent: true,
    opacity: 0,
    side: T.DoubleSide,
    depthWrite: false,
    blending: T.AdditiveBlending,
  });
  const spearVortexMesh = new T.Mesh(spearVortexGeom, spearVortexMat);
  thrustGroup.add(spearVortexMesh);

  const spearStarMat = new T.MeshBasicMaterial({
    map: buildThrustStarTexture(),
    color: '#ffffff',
    transparent: true,
    opacity: 0,
    side: T.DoubleSide,
    depthWrite: false,
    depthTest: false,
    blending: T.AdditiveBlending,
  });
  const spearImpactStar = new T.Mesh(new T.PlaneGeometry(0.52, 0.52), spearStarMat);
  thrustGroup.add(spearImpactStar);

  const rippleRings = [];
  for (let i = 0; i < 4; i++) {
    const rMat = new T.MeshBasicMaterial({
      color: '#b8fcff',
      transparent: true,
      opacity: 0,
      side: T.DoubleSide,
      depthWrite: false,
      depthTest: false,
      blending: T.AdditiveBlending,
    });
    const innerR = i === 0 ? 0.14 : 0.15 + (i - 1) * 0.04;
    const outerR = innerR + (i === 0 ? 0.024 : 0.032);
    const rMesh = new T.Mesh(new T.RingGeometry(innerR, outerR, 48), rMat);
    thrustGroup.add(rMesh);
    rippleRings.push(rMesh);
  }

  // 3. Eye-Level Contracting Crimson Enemy Hazard Ring + Golden Parry Shockwave: 2 draw calls when active
  const hazardMat = new T.MeshBasicMaterial({
    color: '#ff3858',
    transparent: true,
    opacity: 0,
    side: T.DoubleSide,
    depthWrite: false,
    depthTest: false,
    blending: T.AdditiveBlending,
  });
  const hazardRingMesh = new T.Mesh(new T.RingGeometry(0.39, 0.445, 48), hazardMat);
  hazardRingMesh.visible = false;
  root.add(hazardRingMesh);

  const parryMat = new T.MeshBasicMaterial({
    color: '#ffe299',
    transparent: true,
    opacity: 0,
    side: T.DoubleSide,
    depthWrite: false,
    depthTest: false,
    blending: T.AdditiveBlending,
  });
  const parryWaveMesh = new T.Mesh(new T.RingGeometry(0.2, 0.26, 48), parryMat);
  parryWaveMesh.visible = false;
  root.add(parryWaveMesh);

  // 4. 3D Ultimate Water Dragon Spiral & Breath Surge Vortex ('open-palm' / 'musou'): 2 draw calls when active
  const ultGroup = new T.Group();
  ultGroup.visible = false;
  root.add(ultGroup);

  const dragonMat = new T.MeshBasicMaterial({
    color: '#3ae0ff',
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: T.AdditiveBlending,
  });
  const dragonHelix = new T.Mesh(new T.TorusKnotGeometry(0.56, 0.018, 64, 8, 2, 3), dragonMat);
  ultGroup.add(dragonHelix);

  const surgeMat = new T.MeshBasicMaterial({
    color: '#74eeff',
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: T.AdditiveBlending,
  });
  const surgeHalo = new T.Mesh(new T.TorusGeometry(0.58, 0.015, 10, 56), surgeMat);
  surgeHalo.rotation.x = Math.PI / 2;
  ultGroup.add(surgeHalo);

  // 5. Lower-FOV 3D Footwork Steering Compass (y = 1.18m, z = -1.92m): 1 draw call only while steering
  const footworkMat = new T.MeshBasicMaterial({
    color: '#7df9ff',
    transparent: true,
    opacity: 0,
    side: T.DoubleSide,
    depthWrite: false,
    depthTest: false,
    blending: T.AdditiveBlending,
  });
  const footworkRing = new T.Mesh(new T.RingGeometry(0.085, 0.112, 6), footworkMat);
  footworkRing.rotation.x = -Math.PI * 0.34;
  footworkRing.visible = false;
  root.add(footworkRing);

  let wheelTimer = 0;
  let wheelClockwise = true;
  let wheelBaseZ = -2.25;
  let thrustTimer = 0;
  let thrustInterrupted = false;
  let parryTimer = 0;
  let surgeTimer = 0;
  let footworkFade = 0;

  const thrustFrom = new T.Vector3();
  const thrustTo = new T.Vector3();
  const thrustDir = new T.Vector3();
  const spearSpinQuat = new T.Quaternion();
  const negZ = new T.Vector3(0, 0, -1);
  const camWorld = new T.Vector3();

  return {
    root,
    triggerWaterWheel({ x = 0, z = -2.25, clockwise = true } = {}) {
      wheelTimer = 0.78;
      wheelClockwise = clockwise !== false;
      wheelBaseZ = z;
      wheelGroup.position.set(x, 1.02, z + 0.12);
      wheelGroup.rotation.set(0.12, wheelClockwise ? 0.22 : -0.22, 0);
      wheelDiscA.scale.set(wheelClockwise ? 1 : -1, 1, 1);
      wheelDiscB.scale.set(wheelClockwise ? 1 : -1, 1, 1);
      wheelGroup.visible = true;
    },
    triggerThrust({ fromX = 0, fromZ = 0, toX = 0, toZ = -3.6, interrupted = false } = {}) {
      thrustTimer = 0.72;
      thrustInterrupted = Boolean(interrupted);
      // Originate from right-hand Nichirin stance (x + 0.24m, y = 1.18m, z - 1.15m) so perspective projects a razor-sharp diagonal lance!
      thrustFrom.set(fromX + 0.24, 1.18, fromZ - 1.15);
      thrustTo.set(toX, 1.22, toZ);
      thrustGroup.visible = true;
    },
    triggerParry({ x = 0, z = -1.9 } = {}) {
      parryTimer = 0.42;
      parryWaveMesh.position.set(x, 1.24, z);
      parryWaveMesh.visible = true;
    },
    triggerBreathSurge({ x = 0, z = 0 } = {}) {
      surgeTimer = 0.72;
      ultGroup.position.set(x, 1.24, z - 1.95);
      ultGroup.visible = true;
    },
    reset() {
      wheelTimer = 0;
      thrustTimer = 0;
      parryTimer = 0;
      surgeTimer = 0;
      footworkFade = 0;
      wheelGroup.visible = false;
      thrustGroup.visible = false;
      hazardRingMesh.visible = false;
      parryWaveMesh.visible = false;
      ultGroup.visible = false;
      footworkRing.visible = false;
    },
    update({ battle, active = false, camera = null, nowSec = 0, dt = 0.016 } = {}) {
      if (!active || !battle) {
        wheelGroup.visible = false;
        thrustGroup.visible = false;
        hazardRingMesh.visible = false;
        parryWaveMesh.visible = false;
        ultGroup.visible = false;
        footworkRing.visible = false;
        return;
      }

      if (camera) {
        camera.getWorldPosition(camWorld);
      }

      // 1. Update 3D Giant Vertical Rolling Water Wheel (贰之型·水车)
      if (wheelTimer > 0) {
        wheelTimer = Math.max(0, wheelTimer - dt);
        const p = 1 - wheelTimer / 0.78;
        const spinSign = wheelClockwise ? -1 : 1;
        wheelGroup.position.z = wheelBaseZ + 0.16 - p * 0.34;
        wheelDiscA.rotation.z = spinSign * p * Math.PI * 3.8;
        wheelDiscB.rotation.z = spinSign * (p * Math.PI * 4.5 + 0.55);
        wheelTorus.rotation.z = spinSign * p * Math.PI * 3.4;
        const s = 0.84 + Math.sin(Math.min(1, p * 1.35) * Math.PI * 0.5) * 0.24;
        wheelGroup.scale.setScalar(s);
        wheelSplash.position.y = -0.96 / Math.max(0.6, s);
        wheelSplash.scale.setScalar(0.72 + p * 0.85);
        const alpha = p < 0.72 ? 1 : (1 - p) / 0.28;
        wheelDiscMatA.opacity = alpha * 0.86;
        wheelDiscMatB.opacity = alpha * 0.62;
        wheelTorusMat.opacity = alpha * 0.78;
        wheelSplashMat.opacity = alpha * (1 - p * 0.5) * 0.62;
        wheelGroup.visible = wheelTimer > 0.005;
      } else {
        wheelGroup.visible = false;
      }

      // 2. Update 3D 9.2m Straight-Line Piercing Water Lance + 4 Concentric '雫波纹' Droplet Ripples (柒之型·雫波纹击刺)
      if (thrustTimer > 0) {
        thrustTimer = Math.max(0, thrustTimer - dt);
        const p = 1 - thrustTimer / 0.72;
        thrustDir.subVectors(thrustTo, thrustFrom);
        const fullLen = Math.max(0.7, thrustDir.length());
        thrustDir.normalize();
        const reachFrac = Math.min(1, p * 6.0);
        const curLen = fullLen * reachFrac;
        const distScale = clamp(Math.abs(thrustTo.z - (battle.player.z || 0)) / 2.9, 1.0, 2.55);

        spearMesh.position.copy(thrustFrom);
        spearMesh.quaternion.setFromUnitVectors(negZ, thrustDir);
        const coreThin = Math.max(0.25, 1 - Math.max(0, p - 0.18) * 1.15);
        spearMesh.scale.set(coreThin, coreThin, curLen);
        spearMat.color.set(thrustInterrupted ? '#fff7cc' : '#eaffff');
        spearMat.opacity = Math.max(0, (1 - p * 1.12) * 0.94);

        spearVortexMesh.position.copy(thrustFrom);
        spearVortexMesh.quaternion.copy(spearMesh.quaternion);
        spearSpinQuat.setFromAxisAngle(negZ, p * Math.PI * 5.8);
        spearVortexMesh.quaternion.multiply(spearSpinQuat);
        const coneScale = 0.85 + p * 0.42;
        spearVortexMesh.scale.set(coneScale, coneScale, curLen * 0.98);
        spearVortexMat.color.set(thrustInterrupted ? '#ffe680' : '#5ceeff');
        spearVortexMat.opacity = Math.max(0, (1 - p * 1.18) * 0.68);

        spearImpactStar.position.copy(thrustTo).addScaledVector(thrustDir, -0.06);
        if (camera) spearImpactStar.lookAt(camWorld);
        spearImpactStar.rotation.z = p * 2.4;
        const starFade = p < 0.1 ? p / 0.1 : Math.max(0, 1 - (p - 0.1) / 0.52);
        spearImpactStar.scale.setScalar((0.68 + p * (thrustInterrupted ? 1.85 : 1.4)) * distScale);
        spearStarMat.color.set(thrustInterrupted ? '#fff4b8' : '#ffffff');
        spearStarMat.opacity = starFade * 0.95;

        // Ring 0 = mid-shaft sonic water ring; Rings 1..3 = 3 huge concentric pond-droplet ripples blooming at impact!
        for (let i = 0; i < rippleRings.length; i++) {
          const ring = rippleRings[i];
          if (i === 0) {
            ring.position.copy(thrustFrom).addScaledVector(thrustDir, fullLen * 0.45);
            if (camera) ring.lookAt(camWorld);
            const rp0 = clamp(p / 0.58, 0, 1);
            ring.scale.setScalar((0.55 + rp0 * 1.25) * Math.sqrt(distScale));
            ring.material.color.set(thrustInterrupted ? '#ffe680' : '#9efcff');
            ring.material.opacity = (1 - rp0) * 0.72;
          } else {
            const waveIdx = i - 1; // 0, 1, 2 concentric waves at impact chest
            ring.position.copy(thrustTo).addScaledVector(thrustDir, -0.04 * (waveIdx + 1));
            if (camera) ring.lookAt(camWorld);
            const delay = 0.02 + waveIdx * 0.095;
            const rp = clamp((p - delay) / (0.88 - delay), 0, 1);
            const maxExpand = thrustInterrupted ? 2.45 + waveIdx * 0.35 : 1.95 + waveIdx * 0.32;
            ring.scale.setScalar((0.32 + rp * maxExpand) * distScale);
            ring.material.color.set(
              thrustInterrupted
                ? waveIdx === 0
                  ? '#fff7cc'
                  : '#ffe066'
                : waveIdx === 0
                  ? '#f0ffff'
                  : '#7ef9ff',
            );
            ring.material.opacity = p >= delay && rp < 1 ? (1 - rp * 0.85) * 0.92 : 0;
          }
        }
        thrustGroup.visible = thrustTimer > 0.005;
      } else {
        thrustGroup.visible = false;
      }

      // 3. Update Eye-Level Contracting Crimson Enemy Hazard Ring
      const urgentHazard =
        battle.hazards && battle.hazards.length > 0
          ? battle.hazards.reduce((best, h) => (!best || h.remaining < best.remaining ? h : best), null)
          : null;
      const hazardSource = urgentHazard
        ? battle.enemies.find(e => e.id === urgentHazard.source && e.hp > 0)
        : null;
      if (urgentHazard && hazardSource) {
        hazardRingMesh.visible = true;
        hazardRingMesh.position.set(hazardSource.x, 1.2 * hazardSource.size, hazardSource.z);
        if (camera) hazardRingMesh.lookAt(camWorld);
        const ratio = clamp(urgentHazard.remaining / Math.max(0.2, urgentHazard.duration), 0, 1);
        hazardRingMesh.scale.setScalar(0.36 + ratio * 1.08);
        hazardRingMesh.rotation.z = nowSec * 5;
        hazardMat.color.set(ratio < 0.32 ? '#ff9db0' : '#ff3355');
        hazardMat.opacity = 0.45 + (1 - ratio) * 0.5;
      } else {
        hazardRingMesh.visible = false;
      }

      // 4. Update Golden Parry Shockwave
      if (parryTimer > 0) {
        parryTimer = Math.max(0, parryTimer - dt);
        const p = 1 - parryTimer / 0.42;
        if (camera) parryWaveMesh.lookAt(camWorld);
        parryWaveMesh.scale.setScalar(0.55 + p * 2.35);
        parryMat.opacity = (1 - p) * 0.92;
        parryWaveMesh.visible = parryTimer > 0.005;
      } else {
        parryWaveMesh.visible = false;
      }

      // 5. Update 3D Ultimate Water Dragon Spiral / Breath Surge Vortex
      if (battle.musouTime >= 0) {
        const mp = clamp(battle.musouTime / Math.max(0.5, battle.invincible || 2.2), 0, 1);
        ultGroup.visible = true;
        ultGroup.position.set(battle.player.x, 1.28, battle.player.z - 1.65 - mp * 2.1);
        dragonHelix.visible = true;
        dragonHelix.rotation.set(nowSec * 3.2, nowSec * 2.1, nowSec * 4.4);
        dragonHelix.scale.setScalar(0.92 + Math.sin(mp * Math.PI) * 0.42);
        dragonMat.opacity = 0.54;
        surgeHalo.rotation.z = -nowSec * 4.5;
        surgeHalo.scale.setScalar(1.12 + Math.sin(nowSec * 8) * 0.14);
        surgeMat.opacity = 0.44;
      } else if (surgeTimer > 0) {
        surgeTimer = Math.max(0, surgeTimer - dt);
        const sp = 1 - surgeTimer / 0.72;
        ultGroup.visible = surgeTimer > 0.005;
        ultGroup.position.set(battle.player.x, 1.02 + sp * 0.48, battle.player.z - 1.9);
        dragonHelix.visible = false;
        surgeHalo.rotation.z = nowSec * 5.2;
        surgeHalo.scale.setScalar(0.76 + sp * 0.58);
        surgeMat.opacity = (1 - sp) * 0.52;
      } else {
        ultGroup.visible = false;
      }

      // 6. Update Lower-FOV 3D Footwork Steering Compass
      if (battle.steerActive) {
        footworkFade = Math.min(1, footworkFade + dt * 10);
      } else {
        footworkFade = Math.max(0, footworkFade - dt * 4);
      }
      footworkRing.visible = footworkFade > 0.02;
      if (footworkRing.visible) {
        footworkRing.position.set(
          battle.player.x + battle.steerX * 0.24,
          1.18,
          (battle.player.z || 0) - 1.92 - (battle.steerForward || 0) * 0.22,
        );
        footworkRing.rotation.z = Math.atan2(-battle.steerX, battle.steerForward || 0.001);
        footworkMat.opacity = footworkFade * 0.68;
      }
    },
    stats: () => ({
      wheelVisible: wheelGroup.visible,
      thrustVisible: thrustGroup.visible,
      hazardRingVisible: hazardRingMesh.visible,
      parryVisible: parryWaveMesh.visible,
      ultVisible: ultGroup.visible,
      footworkVisible: footworkRing.visible,
    }),
  };
}
