import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { createBattle } from '../src/simulation.js';
import { createSlashArc, createSpatialCombatVfx } from '../src/scene.js';
import { createSpatialInputBridge } from '../src/container-bridge.js';

function installMinimalBrowserGlobals() {
  globalThis.window = {
    location: { search: '?xr=glasses' },
    addEventListener() {},
    removeEventListener() {},
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };
}

test('Water Wheel (贰之型·水车) deals 3-beat AOE spin damage and triggers allyWaterWheel, never thrustWave', () => {
  const b = createBattle({ isGlasses: true });
  b.start();
  b.step(1.0);
  // Spawn a second demon nearby so AOE multi-target sweep is verified:
  b.enemies.push({
    id: 99,
    x: 0.42,
    z: -3.2,
    y: 0,
    yaw: 0,
    size: 0.86,
    hp: 90,
    maxHp: 90,
    boss: false,
    elite: false,
    role: 'claw',
    phase: 0,
    dead: 0,
    spin: 1,
    flash: 0,
    stun: 0,
    tell: 0,
    cooldown: 3,
    lane: 0.4,
    arrived: true,
    vx: 0,
    vz: 0,
    vy: 0,
    radius: 0.35,
  });
  b.enemies[0].z = -2.8;
  b.enemies[0].hp = 90;
  b.enemies[0].maxHp = 90;
  b.events.length = 0;

  const ok = b.castWaterWheel(b.enemies[0].id, true);
  assert.equal(ok, true);

  const types = b.events.map(e => e.type);
  assert.ok(types.includes('waterWheelSpin'), 'should emit waterWheelSpin');
  assert.ok(types.includes('allyWaterWheel'), 'should emit allyWaterWheel for Tanjiro somersault');
  assert.ok(!types.includes('thrustWave'), 'must never emit thrustWave');
  assert.ok(!types.includes('allyAttack'), 'must not fall back to generic Light1 allyAttack');
  const callout = b.events.find(e => e.type === 'skillCallout');
  assert.equal(callout?.theme, 'waterWheel');

  // Immediate Beat 1 hit both enemies:
  const hpAfterBeat1 = b.enemies[0].hp;
  const splashAfterBeat1 = b.enemies[1].hp;
  assert.equal(hpAfterBeat1, 90 - 22);
  assert.equal(splashAfterBeat1, 90 - 16);

  // Advance through Beat 2 (+0.17s) and Beat 3 (+0.35s):
  b.events.length = 0;
  b.step(0.2);
  assert.ok(b.events.some(e => e.type === 'waterWheelTick' && e.tick === 2));
  assert.equal(b.enemies[0].hp, 90 - 22 - 18);

  b.events.length = 0;
  b.step(0.2);
  assert.ok(b.events.some(e => e.type === 'waterWheelTick' && e.tick === 3 && e.heavy === true));
  assert.equal(b.enemies[0].hp, 90 - 22 - 18 - 24);
  assert.equal(b.enemies[1].hp, 90 - 16 - 14 - 18);
});

test('Thrust (柒之型·雫波纹击刺) pierces at 8.8m, shatters hazards, emits allyThrust, and NEVER emits curved swing/playerSlash', () => {
  const b = createBattle({ isGlasses: true });
  b.start();
  b.step(1.0);
  const farDemon = b.enemies[0];
  farDemon.x = 0;
  farDemon.z = -8.6; // Beyond normal REACH (5.4m), inside THRUST_REACH (9.2m)
  farDemon.hp = 120;
  farDemon.maxHp = 120;
  b.hazards.push({
    id: 501,
    source: farDemon.id,
    remaining: 1.2,
    duration: 1.5,
    kind: 'blood',
    label: '血印爆发',
    x: 0,
    z: -8.6,
  });
  b.events.length = 0;

  const ok = b.castThrust(farDemon.id);
  assert.equal(ok, true);
  assert.equal(b.swing, null, 'Thrust must NOT start a Heavy1..Heavy3 swing combo');
  assert.equal(b.hazards.length, 0, 'Thrust must shatter active crimson hazard');
  assert.equal(b.perfect, 1);
  assert.equal(farDemon.hp, 120 - 72);

  const types = b.events.map(e => e.type);
  assert.ok(types.includes('thrustWave'));
  assert.ok(types.includes('allyThrust'));
  assert.ok(!types.includes('swing'), 'must NEVER emit curved swing');
  assert.ok(!types.includes('playerSlash'), 'must NEVER emit curved playerSlash');
  assert.ok(!types.includes('waterWheelSpin'), 'must NEVER emit waterWheelSpin');
  const callout = b.events.find(e => e.type === 'skillCallout');
  assert.equal(callout?.theme, 'interrupt');
});

test('3D VFX separation: createSlashArc stays hidden on thrust, while wheelVisible and thrustVisible never overlap unintentionally', () => {
  const worldRoot = new T.Group();
  const cam = new T.PerspectiveCamera(45, 1, 0.1, 50);
  cam.position.set(0, 1.6, 0);
  cam.updateMatrixWorld(true);

  const slashArc = createSlashArc(worldRoot);
  slashArc.update(cam, 0.25, true, true, 'thrust');
  assert.equal(slashArc.group.visible, false, 'curved slashArc must stay hidden on thrust');

  slashArc.update(cam, 0.4, true, true, 'spin-cw');
  assert.equal(slashArc.group.visible, true, 'curved spin ribbon is visible on Water Wheel');

  const vfx = createSpatialCombatVfx(worldRoot);
  const b = createBattle({ isGlasses: true });
  b.start();

  vfx.triggerThrust({ fromX: 0, fromZ: 0, toX: 0, toZ: -4.2, interrupted: true });
  vfx.update({ battle: b, active: true, camera: cam, nowSec: 1.0, dt: 0.05 });
  assert.equal(vfx.stats().thrustVisible, true);
  assert.equal(vfx.stats().wheelVisible, false);

  vfx.reset();
  vfx.triggerWaterWheel({ x: 0, z: -2.4, clockwise: true });
  vfx.update({ battle: b, active: true, camera: cam, nowSec: 1.2, dt: 0.05 });
  assert.equal(vfx.stats().wheelVisible, true);
  assert.equal(vfx.stats().thrustVisible, false);
});

test('Blind trackpad axial cone filter & double-tap thrust prevent oblique flick crosstalk', () => {
  installMinimalBrowserGlobals();
  const log = [];
  const bridge = createSpatialInputBridge({
    isGlasses: true,
    isMenuPhase: () => false,
    onSlash: e => log.push(`slash:${e.direction}:${e.source}`),
    onWaterWheel: e => log.push(`wheel:${e.source}`),
    onThrust: e => log.push(`thrust:${e.direction || 'center'}:${e.source}`),
    onUltimate: e => log.push(`ult:${e.source}`),
  });

  // 1. Clean vertical flick -> Water Wheel:
  bridge.simulateTrackpadGesture({ type: 'swipe-up', dx: 0.12, dy: -0.88, timestampMs: 1000 });
  assert.equal(log.at(-1), 'wheel:trackpad-swipe-up');

  // 2. Ambiguous 42-deg diagonal flick -> demoted to oblique slash, NOT misfired as Water Wheel or Thrust!
  bridge.simulateTrackpadGesture({ type: 'swipe-up', dx: 0.66, dy: -0.72, timestampMs: 1400 });
  assert.equal(log.at(-1), 'slash:up:trackpad-oblique-slash');

  bridge.simulateTrackpadGesture({ type: 'swipe-right', dx: 0.72, dy: -0.65, timestampMs: 1800 });
  assert.equal(log.at(-1), 'slash:right:trackpad-oblique-slash');

  // 3. Clean horizontal flick -> Thrust:
  bridge.simulateTrackpadGesture({ type: 'swipe-right', dx: 0.9, dy: -0.18, timestampMs: 2200 });
  assert.equal(log.at(-1), 'thrust:right:trackpad-swipe-right');

  // 4. Rapid double-tap (<= 255ms) -> crisp poke followed immediately by Thrust!
  bridge.simulateTrackpadGesture({ type: 'tap', dx: 0, dy: 0, timestampMs: 3000 });
  bridge.simulateTrackpadGesture({ type: 'tap', dx: 0, dy: 0, timestampMs: 3170 });
  assert.deepEqual(log.slice(-2), ['slash:right:trackpad-tap', 'thrust:center:trackpad-double-tap']);
});
