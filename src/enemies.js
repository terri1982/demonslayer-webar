import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { assetUrl } from './assets.js';
import { ENEMY_IDS, ENEMY_REVISION, enemyModelId, enemyPose } from './enemy-animation.js';

export function createEnemyView(worldRoot, { bossId = 'daki' } = {}) {
  const templates = new Map();
  const actors = new Map();
  const pool = new Map();
  const failures = [];
  const white = new T.Color('#ffffff');
  const red = new T.Color('#270609');
  let loaded = false;

  function material(source) {
    const m = source.clone();
    m.roughness = 0.85;
    m.metalness = 0;
    return m;
  }

  const ready = (async () => {
    const loader = new GLTFLoader();
    await Promise.all(
      ENEMY_IDS.map(async id => {
        try {
          templates.set(id, await loader.loadAsync(assetUrl(`assets/enemies/${id}.glb?v=${ENEMY_REVISION}`)));
        } catch (error) {
          failures.push(`${id}: ${error.message}`);
        }
      }),
    );
    if (failures.length) throw Error(`Enemy assets: ${failures.join('; ')}`);
    loaded = true;
  })();
  ready.catch(() => {});

  function acquire(id) {
    const cached = pool.get(id)?.pop();
    if (cached) {
      cached.actor.visible = true;
      return cached;
    }
    const template = templates.get(id);
    const root = clone(template.scene);
    const actor = new T.Group();
    const mixer = new T.AnimationMixer(root);
    const materials = [];
    const defaults = [];
    actor.add(root);
    worldRoot.add(actor);
    root.traverse(o => {
      defaults.push({ o, p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() });
      if (o.isMesh) {
        const convert = src => {
          const next = material(src);
          materials.push({ m: next, color: next.color.clone(), emissive: next.emissive?.clone() });
          return next;
        };
        o.material = Array.isArray(o.material) ? o.material.map(convert) : convert(o.material);
        o.castShadow = false;
        o.receiveShadow = false;
        o.frustumCulled = false;
      }
    });
    return {
      id,
      root,
      actor,
      mixer,
      materials,
      defaults,
      clips: new Map(template.animations.map(c => [c.name, c])),
      name: null,
      state: null,
      lastTime: null,
      x: 0,
      z: 0,
    };
  }

  function release(entry) {
    entry.actor.visible = false;
    entry.actor.userData.enemyId = null;
    entry.actor.userData.dead = true;
    entry.mixer.stopAllAction();
    entry.name = null;
    entry.lastTime = null;
    if (!pool.has(entry.id)) pool.set(entry.id, []);
    pool.get(entry.id).push(entry);
  }

  function pose(entry, choice) {
    const clip = entry.clips.get(choice.clip);
    if (!clip) return;
    if (entry.name !== clip.name || entry.state !== choice.state) {
      entry.mixer.stopAllAction();
      for (const { o, p, q, s } of entry.defaults) {
        o.position.copy(p);
        o.quaternion.copy(q);
        o.scale.copy(s);
      }
      entry.action = entry.mixer
        .clipAction(clip)
        .reset()
        .setLoop(choice.loop ? T.LoopRepeat : T.LoopOnce, choice.loop ? Infinity : 1);
      entry.action.clampWhenFinished = true;
      entry.action.play();
      entry.name = clip.name;
      entry.state = choice.state;
    }
    entry.action.time = choice.loop ? choice.time % clip.duration : Math.min(clip.duration - 1e-6, choice.time);
    entry.action.paused = false;
    entry.mixer.update(0);
  }

  function update(game) {
    if (!loaded) return;
    const ids = new Set(game.enemies.map(e => e.id));
    for (const [id, entry] of actors) {
      if (!ids.has(id)) {
        release(entry);
        actors.delete(id);
      }
    }
    for (const e of game.enemies) {
      const id = enemyModelId(e, bossId);
      let entry = actors.get(e.id);
      if (entry && entry.id !== id) {
        release(entry);
        actors.delete(e.id);
        entry = null;
      }
      if (!entry) {
        entry = acquire(id);
        entry.x = e.x;
        entry.z = e.z;
        actors.set(e.id, entry);
      }
      const elapsed = entry.lastTime === null ? 0 : game.time - entry.lastTime;
      const moving =
        elapsed >= 1 / 30 - 1e-6 ? Math.hypot(e.x - entry.x, e.z - entry.z) / elapsed > 0.12 : !!entry.moving;
      const hazard = game.hazards?.find(h => (h.sourceId ?? h.source) === e.id && h.remaining > 0);
      const choice = enemyPose(e, id, game.time, moving, hazard);
      if (
        entry.lastTime === null ||
        elapsed >= 1 / 30 - 1e-6 ||
        entry.state !== choice.state ||
        entry.name !== choice.clip
      ) {
        pose(entry, choice);
        entry.lastTime = game.time;
        entry.x = e.x;
        entry.z = e.z;
        entry.moving = moving;
      }
      const fade = e.dead > 0.65 ? Math.max(0, 1 - (e.dead - 0.65) / 0.6) : 1;
      const scale = e.boss ? 0.96 : e.size * 0.96;
      entry.actor.position.set(e.x, e.y || 0, e.z);
      entry.actor.rotation.set(0, e.yaw, 0);
      entry.actor.scale.setScalar(scale * fade);
      entry.actor.visible = fade > 0;
      entry.actor.userData.enemyId = e.id;
      entry.actor.userData.dead = e.hp <= 0;
      for (const { m, color, emissive } of entry.materials) {
        m.color.copy(color);
        if (e.flash > 0) m.color.lerp(white, 0.6);
        if (emissive) {
          m.emissive.copy(emissive);
          if (hazard) m.emissive.add(red);
        }
      }
    }
  }

  function getAliveActors() {
    const list = [];
    for (const entry of actors.values()) {
      if (entry.actor.visible && !entry.actor.userData.dead) {
        list.push(entry.actor);
      }
    }
    return list;
  }

  function stats() {
    return {
      ready: loaded,
      revision: ENEMY_REVISION,
      templates: templates.size,
      errors: [...failures],
      activeCount: actors.size,
      aliveActorCount: getAliveActors().length,
    };
  }

  return { ready, update, getAliveActors, stats };
}
