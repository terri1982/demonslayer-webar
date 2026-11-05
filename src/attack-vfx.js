import * as THREE from 'three';
import { assetUrl } from './assets.js';

const attackNames = {
  tanjiro: ['DashSlash', 'SwordCombo', 'WaterWheel', 'Light1', 'Light2', 'Light3', 'Heavy1', 'Heavy2', 'Heavy3'],
};
const lifetimes = { water: 0.65, fire: 0.7 };

export function measureAttackCues(models) {
  const tables = {};
  for (const [character, m] of Object.entries(models)) {
    tables[character] = {};
    for (const name of attackNames[character] || []) {
      const clip = m.gltf.animations.find(c => c.name === name);
      if (!clip) continue;
      m.mixer.stopAllAction();
      const action = m.mixer.clipAction(clip).reset().setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.play();
      const profile = m.manifest.clips.find(c => c.name === name)?.vfx;
      const root = m.gltf.scene;
      const candidates = ['SwordTip'].map(n => root.getObjectByName(n)).filter(Boolean);
      const samples = [];
      const point = node => root.worldToLocal(node.getWorldPosition(new THREE.Vector3()));
      const count = Math.ceil(clip.duration * 120);
      for (let frame = 0; frame <= count; frame++) {
        const time = (frame / count) * clip.duration;
        action.time = Math.min(time, clip.duration - 1e-6);
        m.mixer.update(0);
        root.updateMatrixWorld(true);
        samples.push({
          time,
          points: candidates.map(point),
          grip: point(root.getObjectByName('SwordGrip')),
          root: point(root.getObjectByName('Hips')),
        });
      }
      const windows = profile?.windows || [
        { start: clip.duration * 0.12, end: clip.duration * 0.74, search: [clip.duration * 0.12, clip.duration * 0.74] },
      ];
      const cues = windows.map((win, index) => {
        let best = { speed: -1, i: 1, node: 0 };
        for (let i = 1; i < samples.length; i++) {
          const [start, end] = win.search || [win.start, win.end];
          if (samples[i].time < start || samples[i].time > end) continue;
          for (let node = 0; node < candidates.length; node++) {
            const speed = samples[i].points[node].distanceTo(samples[i - 1].points[node]) * 120;
            if (speed > (best.score ?? -Infinity)) best = { speed, score: speed, i, node };
          }
        }
        if (win.peak !== undefined) {
          best.i = samples.reduce(
            (acc, p, i) => (Math.abs(p.time - win.peak) < Math.abs(samples[acc].time - win.peak) ? i : acc),
            0,
          );
        }
        const p = samples[best.i];
        const tip = p.points[best.node];
        const position = p.grip.clone().lerp(tip, profile?.spin ? 0.68 : 0.56);
        const time = Math.max(0, p.time - 0.05);
        const trailStart = profile ? win.start : Math.max(0.02, time - 0.14);
        const trailEnd = profile ? win.end : Math.min(clip.duration * 0.78, time + 0.28);
        const maxAge = profile?.maxAge || 0.46;
        const trail = samples
          .filter(s => s.time >= trailStart && s.time <= trailEnd)
          .map(s => ({
            time: s.time,
            grip: s.grip.toArray(),
            tip: s.points[0].toArray(),
            root: s.root.toArray(),
            spin: !!profile?.spin,
          }));
        return {
          time,
          peakTime: p.time,
          peakSpeed: best.speed,
          trail,
          trailStart,
          trailEnd,
          maxAge,
          position: position.toArray(),
          rotation: [Math.PI / 2, 0, 0],
          node: candidates[best.node].name,
          scale: profile?.scale || 0.5,
          spin: !!profile?.spin,
          seed: 1207 + index,
          index,
        };
      });
      tables[character][name] = cues;
    }
    m.mixer.stopAllAction();
  }
  return tables;
}

function bladeRibbon(worldRoot, foamTex, noiseTex) {
  const count = 80;
  const rawPoints = [];
  for (const t of [foamTex, noiseTex]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
  }

  function buildStripGeometry() {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 6);
    const ages = new Float32Array(count * 2);
    const uv = new Float32Array(count * 4);
    const indices = [];
    for (let i = 0; i < count; i++) {
      uv.set([0, i / (count - 1), 1, i / (count - 1)], i * 4);
      if (i < count - 1) {
        const n = i * 2;
        indices.push(n, n + 1, n + 2, n + 1, n + 3, n + 2);
      }
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('birth', new THREE.BufferAttribute(ages, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2).setUsage(THREE.DynamicDrawUsage));
    geometry.setIndex(indices);
    return { geometry, positions, ages, uv };
  }

  const primary = buildStripGeometry();
  const crest = buildStripGeometry();

  const vertexShader = `
    attribute float birth;
    varying vec2 vUv;
    varying float vAge;
    uniform float now;
    void main() {
      vUv = uv;
      vAge = max(0.0, now - birth);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  const primaryMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      now: { value: 0 },
      maxAge: { value: 0.34 },
      deep: { value: new THREE.Color('#08336e') },
      body: { value: new THREE.Color('#1488e8') },
      edge: { value: new THREE.Color('#e2fcff') },
      foamMap: { value: foamTex },
      noiseMap: { value: noiseTex },
    },
    vertexShader,
    fragmentShader: `
      varying vec2 vUv;
      varying float vAge;
      uniform float now;
      uniform float maxAge;
      uniform vec3 deep;
      uniform vec3 body;
      uniform vec3 edge;
      uniform sampler2D foamMap;
      uniform sampler2D noiseMap;
      void main() {
        float life = clamp(1.0 - vAge / maxAge, 0.0, 1.0);
        if (life <= 0.001) discard;
        float s1 = texture2D(noiseMap, vec2(vUv.y * 2.8 - now * 3.4, vUv.x * 1.6)).a;
        float s2 = texture2D(noiseMap, vec2(vUv.y * 5.2 - now * 5.0 + 0.37, vUv.x * 2.8 - s1 * 0.25)).a;
        float claw = texture2D(foamMap, vec2(fract(vUv.y * 2.6 - now * 2.2), clamp(vUv.x * 1.15 - 0.08, 0.02, 0.98))).a;
        float wave = (s1 - 0.5) * 0.14 + sin(vUv.y * 28.0 - now * 14.0) * 0.04;
        float innerFade = smoothstep(0.06, 0.34, vUv.x + wave * 0.5);
        float outerFade = 1.0 - smoothstep(0.76, 0.98, vUv.x - wave * 0.35);
        float endsFade = smoothstep(0.0, 0.14, vUv.y) * smoothstep(1.0, 0.86, vUv.y);
        float flow = s1 * 0.55 + s2 * 0.45;
        float erosion = smoothstep((1.0 - life) * 0.68, (1.0 - life) * 0.68 + 0.32, flow * 0.75 + vUv.x * 0.35);
        float outerCrest = smoothstep(0.58, 0.82, vUv.x + (s2 - 0.5) * 0.22) * outerFade * smoothstep(0.28, 0.75, s1 + claw * 0.6);
        float innerRibs = smoothstep(0.66, 0.88, flow + claw * 0.45) * smoothstep(0.22, 0.75, vUv.x);
        float foamMask = clamp(outerCrest * 1.15 + innerRibs * 0.75 + claw * 0.65 * outerFade, 0.0, 1.0);
        vec3 col = mix(deep, body, smoothstep(0.16, 0.64, vUv.x + (s1 - 0.5) * 0.25));
        col = mix(col, edge, foamMask);
        float alpha = pow(life, 0.85) * innerFade * outerFade * endsFade * erosion * (0.58 + foamMask * 0.38);
        gl_FragColor = vec4(col * (1.05 + foamMask * 0.28), clamp(alpha, 0.0, 0.90));
      }
    `,
  });

  const crestMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      now: { value: 0 },
      maxAge: { value: 0.34 },
      body: { value: new THREE.Color('#2ca8ff') },
      edge: { value: new THREE.Color('#ffffff') },
      foamMap: { value: foamTex },
      noiseMap: { value: noiseTex },
    },
    vertexShader,
    fragmentShader: `
      varying vec2 vUv;
      varying float vAge;
      uniform float now;
      uniform float maxAge;
      uniform vec3 body;
      uniform vec3 edge;
      uniform sampler2D foamMap;
      uniform sampler2D noiseMap;
      void main() {
        float life = clamp(1.0 - vAge / maxAge, 0.0, 1.0);
        if (life <= 0.001) discard;
        float streak = texture2D(noiseMap, vec2(vUv.y * 4.2 - now * 4.6, vUv.x * 2.2)).a;
        float claw = texture2D(foamMap, vec2(fract(vUv.y * 3.0 - now * 2.8), clamp(vUv.x * 1.1, 0.02, 0.98))).a;
        float band = smoothstep(0.18, 0.55, vUv.x) * (1.0 - smoothstep(0.68, 0.96, vUv.x));
        float ends = smoothstep(0.0, 0.18, vUv.y) * smoothstep(1.0, 0.82, vUv.y);
        float curl = smoothstep(0.45, 0.85, claw * 0.8 + streak * 0.55);
        vec3 col = mix(body, edge, smoothstep(0.45, 0.88, claw + streak * 0.35));
        float alpha = life * life * band * ends * curl * 0.65;
        gl_FragColor = vec4(col * 1.15, alpha);
      }
    `,
  });

  const mesh = new THREE.Mesh(primary.geometry, primaryMaterial);
  const crestMesh = new THREE.Mesh(crest.geometry, crestMaterial);
  for (const m of [mesh, crestMesh]) {
    m.frustumCulled = false;
    m.visible = false;
    m.renderOrder = 2;
    worldRoot.add(m);
  }

  let activeMaxAge = 0.34;
  function pushSample(grip, tip, time, isSpin, rootPos) {
    const bladeVec = tip.clone().sub(grip);
    const inner = grip.clone().addScaledVector(bladeVec, isSpin ? 0.24 : 0.28);
    const outer = grip.clone().addScaledVector(bladeVec, isSpin ? 1.14 : 1.06);
    if (isSpin && rootPos) {
      const radial = outer.clone().sub(rootPos);
      radial.y = 0;
      if (radial.lengthSq() > 1e-4) {
        radial.normalize();
        outer.addScaledVector(radial, 0.18);
      }
    }
    const upOffset = new THREE.Vector3(0, isSpin ? 0.14 : 0.09, 0);
    const crestInner = inner.clone().lerp(outer, 0.45).sub(upOffset.clone().multiplyScalar(0.25));
    const crestOuter = outer.clone().add(upOffset);
    rawPoints.push({ inner, tip: outer, crestInner, crestOuter, time });
    if (rawPoints.length > count) rawPoints.shift();
  }

  return {
    clear() {
      rawPoints.length = 0;
      mesh.visible = false;
      crestMesh.visible = false;
    },
    add(root, time, isSpin = false, maxAge = 0.34) {
      activeMaxAge = maxAge;
      const grip = worldRoot.worldToLocal(root.getObjectByName('SwordGrip').getWorldPosition(new THREE.Vector3()));
      const tip = worldRoot.worldToLocal(root.getObjectByName('SwordTip').getWorldPosition(new THREE.Vector3()));
      const rootPos = worldRoot.worldToLocal(root.getObjectByName('Hips').getWorldPosition(new THREE.Vector3()));
      pushSample(grip, tip, time, isSpin, rootPos);
    },
    update(time) {
      primaryMaterial.uniforms.now.value = time;
      primaryMaterial.uniforms.maxAge.value = activeMaxAge;
      crestMaterial.uniforms.now.value = time;
      crestMaterial.uniforms.maxAge.value = activeMaxAge;
      while (rawPoints.length && time - rawPoints[0].time > activeMaxAge) rawPoints.shift();
      const visible = rawPoints.length > 1;
      mesh.visible = visible;
      crestMesh.visible = visible;
      if (!visible) return;

      let smoothed = rawPoints;
      if (rawPoints.length >= 3) {
        const innerCurve = new THREE.CatmullRomCurve3(rawPoints.map(p => p.inner));
        const outerCurve = new THREE.CatmullRomCurve3(rawPoints.map(p => p.tip));
        const cInnerCurve = new THREE.CatmullRomCurve3(rawPoints.map(p => p.crestInner));
        const cOuterCurve = new THREE.CatmullRomCurve3(rawPoints.map(p => p.crestOuter));
        smoothed = [];
        for (let i = 0; i < count; i++) {
          const u = i / (count - 1);
          const sample = u * (rawPoints.length - 1);
          const lo = Math.min(Math.floor(sample), rawPoints.length - 2);
          const birth = THREE.MathUtils.lerp(rawPoints[lo].time, rawPoints[lo + 1].time, sample - lo);
          smoothed.push({
            inner: innerCurve.getPoint(u),
            tip: outerCurve.getPoint(u),
            crestInner: cInnerCurve.getPoint(u),
            crestOuter: cOuterCurve.getPoint(u),
            time: birth,
          });
        }
      }

      const nPts = smoothed.length;
      for (let i = 0; i < nPts; i++) {
        const p = smoothed[i];
        const v = i / Math.max(1, nPts - 1);
        p.inner.toArray(primary.positions, i * 6);
        p.tip.toArray(primary.positions, i * 6 + 3);
        primary.ages.set([p.time, p.time], i * 2);
        primary.uv.set([0, v, 1, v], i * 4);
        p.crestInner.toArray(crest.positions, i * 6);
        p.crestOuter.toArray(crest.positions, i * 6 + 3);
        crest.ages.set([p.time, p.time], i * 2);
        crest.uv.set([0, v, 1, v], i * 4);
      }
      primary.geometry.setDrawRange(0, (nPts - 1) * 6);
      primary.geometry.attributes.position.needsUpdate = true;
      primary.geometry.attributes.birth.needsUpdate = true;
      primary.geometry.attributes.uv.needsUpdate = true;
      crest.geometry.setDrawRange(0, (nPts - 1) * 6);
      crest.geometry.attributes.position.needsUpdate = true;
      crest.geometry.attributes.birth.needsUpdate = true;
      crest.geometry.attributes.uv.needsUpdate = true;
    },
    get count() {
      return rawPoints.length;
    },
  };
}

export async function createAttackVfx({ renderer, worldRoot, models, cues }) {
  const texLoader = new THREE.TextureLoader();
  const [foamTex, noiseTex] = await Promise.all([
    texLoader.loadAsync(assetUrl('assets/vfx/resources/T_WaterFoam01.png')),
    texLoader.loadAsync(assetUrl('assets/vfx/resources/T_NoiseStreak01.png')),
  ]);
  const ribbon = bladeRibbon(worldRoot, foamTex, noiseTex);
  const light = new THREE.PointLight(0x67caff, 0, 3, 2);
  worldRoot.add(light);

  // Optional Effekseer burst layer for non-XR monocular view; WebXR stereo relies on native 3D ribbon + Three.js particles.
  let context = null;
  let waterEffect = null;
  if (window.effekseer && !renderer.xr.enabled) {
    try {
      await new Promise((resolve, reject) =>
        window.effekseer.initRuntime(
          assetUrl('vendor/effekseer/effekseer.wasm'),
          resolve,
          () => reject(Error('Effekseer init failed')),
        ),
      );
      context = window.effekseer.createContext();
      context.init(renderer.getContext(), { instanceMaxCount: 512, squareMaxCount: 2048 });
      renderer.resetState();
      context.setRestorationOfStatesFlag(false);
      waterEffect = await new Promise((resolve, reject) => {
        let effect;
        effect = context.loadEffect(
          assetUrl('assets/vfx/VFX_Breath_Water.efk'),
          1,
          () => resolve(effect),
          reason => reject(Error(String(reason))),
        );
      });
    } catch {
      context = null;
      waterEffect = null;
    }
  }

  const active = [];
  const trackers = new Map();
  let clock = 0;

  function clear() {
    for (let i = active.length - 1; i >= 0; i--) {
      active[i].handle?.stop?.();
      active.splice(i, 1);
    }
    ribbon.clear();
    light.intensity = 0;
  }

  function begin(character) {
    clear();
    trackers.set(character, { name: models[character].name, time: 0, fired: new Set() });
  }

  function spawn(character, cue, age = 0) {
    if (!context || !waterEffect || renderer.xr.isPresenting || age >= lifetimes.water) return;
    const root = models[character].gltf.scene;
    const position = root.localToWorld(new THREE.Vector3(...cue.position));
    const handle = context.play(waterEffect, ...position.toArray());
    const quaternion = root.getWorldQuaternion(new THREE.Quaternion());
    const rotation = new THREE.Euler().setFromQuaternion(quaternion);
    handle.setRotation(rotation.x, rotation.y, rotation.z);
    handle.setScale(cue.scale, cue.scale, cue.scale);
    handle.setRandomSeed(cue.seed);
    if (age > 0) handle.setFrame(age * 60);
    active.push({ handle, birth: clock - age, position });
  }

  return {
    begin,
    clear,
    setMode() {},
    update(dt) {
      clock += dt;
      if (context && !renderer.xr.isPresenting) context.update(dt * 60);
      for (const [character, m] of Object.entries(models)) {
        if (!m.gltf.scene.visible) continue;
        const track = trackers.get(character);
        if (!track || track.name !== m.name) {
          begin(character);
          continue;
        }
        const time = m.action.time;
        const clipCues = cues[character]?.[m.name] || [];
        for (const cue of clipCues) {
          if (!track.fired.has(cue.index) && time >= cue.time) {
            track.fired.add(cue.index);
            spawn(character, cue, Math.max(0, time - cue.time));
          }
        }
        if (clipCues.some(c => time >= c.trailStart && time <= c.trailEnd)) {
          m.gltf.scene.updateMatrixWorld(true);
          ribbon.add(m.gltf.scene, clock, !!clipCues[0]?.spin, clipCues[0]?.maxAge || 0.34);
        }
        track.time = time;
      }
      for (let i = active.length - 1; i >= 0; i--) {
        if (clock - active[i].birth >= lifetimes.water || !active[i].handle?.exists) {
          active[i].handle?.stop?.();
          active.splice(i, 1);
        }
      }
      ribbon.update(clock);
      light.intensity = ribbon.count > 2 ? 0.85 : 0;
    },
    draw(camera) {
      if (!context || !active.length || renderer.xr.isPresenting) return;
      context.setProjectionMatrix(Float32Array.from(camera.projectionMatrix.elements));
      context.setCameraMatrix(Float32Array.from(camera.matrixWorldInverse.elements));
      context.draw();
      renderer.resetState();
    },
    stats: () => ({
      ready: true,
      effekseerEnabled: Boolean(context),
      trailSamples: ribbon.count,
      activeBursts: active.length,
    }),
  };
}
