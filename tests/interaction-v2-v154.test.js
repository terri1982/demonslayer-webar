import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as T from 'three';
import { createBattle } from '../src/simulation.js';
import { createPoseController, createSpatialInputBridge } from '../src/container-bridge.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_SCRIPT_PATH = path.resolve(__dirname, '../public/vendor/metatour-webar-bridge.js');

function installBridgeV154Environment(search = '?xr=glasses') {
  const listeners = new Map();
  const win = {
    location: { search },
    navigator: { userAgent: 'MetaTourWebAR/1.5.4 (Linux; Android 14; SM-S9210)' },
    screen: { orientation: { angle: 0 } },
    performance,
    CustomEvent: class CustomEvent {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    Event: class Event {
      constructor(type) {
        this.type = type;
      }
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const arr = listeners.get(type);
      if (!arr) return;
      const idx = arr.indexOf(fn);
      if (idx >= 0) arr.splice(idx, 1);
    },
    dispatchEvent(ev) {
      const arr = listeners.get(ev.type) || [];
      for (const fn of [...arr]) fn(ev);
      return true;
    },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };
  globalThis.window = win;
  globalThis.CustomEvent = win.CustomEvent;
  const code = fs.readFileSync(BRIDGE_SCRIPT_PATH, 'utf8');
  vm.runInNewContext(code, {
    window: win,
    navigator: win.navigator,
    performance,
    CustomEvent: win.CustomEvent,
    Event: win.Event,
    URLSearchParams,
    Date,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    JSON,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  });
  return win;
}

test('MetaTourWebAR v1.5.6 full contract: diagnostics green, onboarding skip, all-time blind-pad, dodge dedup, zero walk crosstalk', () => {
  const win = installBridgeV154Environment('?xr=glasses');
  assert.equal(win.MetaTourWebAR.version, '1.5.6');
  win.MetaTourWebAR.simulateInput({ kind: 'profile', profile: 'glasses-6dof' });

  const battle = createBattle({ isGlasses: true });
  battle.start();
  battle.step(0.5);

  const events = [];
  let guideClosedReason = null;

  const bridge = createSpatialInputBridge({
    isGlasses: true,
    isMenuPhase: () => bridge.isGuideOpen(),
    onSlash: e => {
      events.push(`slash:${e.source}`);
      battle.attack('light', battle.enemies[0]?.id, { slashDir: e.direction });
    },
    onDodge: e => {
      events.push(`dodge:${e.direction}`);
      battle.dodge(e.dirSign);
    },
    onWaterWheel: e => {
      events.push(`wheel:${e.direction}`);
      battle.castWaterWheel(battle.enemies[0]?.id, e.clockwise);
    },
    onThrust: e => {
      events.push(`thrust:${e.rawDirection}`);
      battle.castThrust(battle.enemies[0]?.id, e.direction);
    },
    onGuardChange: (active, src) => {
      events.push(`guard:${active}:${src}`);
      battle.setGuard(active);
    },
    onUltCharge: e => {
      events.push(`charge:${Math.round(e.progress * 100)}:${e.active}:${e.canceled}:${e.completed}`);
    },
    onUltimate: e => {
      events.push(`ult:${e.forceMusou}:${e.source}`);
      battle.castUltimate(battle.enemies[0]?.id, { forceMusou: e.forceMusou });
    },
    onMoveAxes: m => {
      battle.setMoveAxes(m.x, m.y, m.active, m.forward);
    },
    onGuideChange: g => {
      if (!g.open) guideClosedReason = g.reason;
    },
  });

  // 1. Verify all 5 v1.5.4 contracts are green with zero warnings:
  const diag = win.MetaTourWebAR.getDiagnostics();
  assert.deepEqual({ ...diag.contracts }, {
    handGesture: true,
    trackpadGesture: true,
    trackpadMove: true,
    gazeDwell: true,
    viewReset: true,
  });
  assert.equal(diag.warnings.length, 0);

  // 2. Onboarding guide opens and skips cleanly on single blind-pad tap:
  bridge.showInteractionGuide({ stereo: true, domInGlasses: false });
  assert.equal(bridge.isGuideOpen(), true);
  win.MetaTourWebAR.simulateInput({ kind: 'trackpad-gesture', type: 'tap' });
  assert.equal(bridge.isGuideOpen(), false);
  assert.equal(guideClosedReason, 'tap');

  // 3. Activate S24 right-hand tracking (handActive === true), then verify blind-pad tap + dodge STILL work 100%:
  win.MetaTourWebAR.simulateInput({ kind: 'hand-gesture', type: 'slash', direction: 'left' });
  assert.equal(bridge.isHandActivelyTracked(), true);
  assert.equal(events.at(-1), 'slash:hand-slash');

  win.MetaTourWebAR.simulateInput({ kind: 'trackpad-gesture', type: 'tap' });
  assert.equal(events.at(-1), 'slash:trackpad-tap', 'blind-pad tap must NEVER be blocked when handActive === true');

  const dodgeEventsBefore = events.filter(x => x.startsWith('dodge:')).length;
  win.MetaTourWebAR.simulateInput({ kind: 'trackpad-gesture', type: 'swipe-left', dx: -0.9, dy: 0 });
  const dodgeEventsAfter = events.filter(x => x.startsWith('dodge:'));
  assert.equal(
    dodgeEventsAfter.length - dodgeEventsBefore,
    1,
    'simultaneous onDodge + onTrackpadGesture must deduplicate to exactly 1 dodge',
  );
  assert.equal(dodgeEventsAfter.at(-1), 'dodge:left');

  // 4. Continuous >200ms trackpad push walk NEVER triggers dodge crosstalk:
  battle.step(0.5);
  battle.dodgeCd = 0;
  const startX = battle.player.x;
  const startZ = battle.player.z || 0;
  win.MetaTourWebAR.simulateInput({ kind: 'trackpad-move', x: 0.92, y: -0.65, active: true });
  battle.step(0.25);
  assert.equal(battle.dodgeCd, 0, 'continuous trackpad push must walk smoothly without firing dodge');
  assert.ok(battle.player.x - startX > 0.15, 'player strafed right smoothly');
  assert.ok((battle.player.z || 0) - startZ < -0.1, 'player walked forward smoothly');
  win.MetaTourWebAR.simulateInput({ kind: 'trackpad-move', x: 0, y: 0, active: false });
});

test('S24 right-hand v2.0 gestures: palm-hold/release sustained guard and 3-second fist-charge -> cancel -> fist-ult musou', () => {
  const win = installBridgeV154Environment('?xr=glasses');
  win.MetaTourWebAR.simulateInput({ kind: 'profile', profile: 'glasses-6dof' });

  const battle = createBattle({ isGlasses: true });
  battle.start();
  battle.step(0.5);
  battle.energy = 28; // Below 100% before 3-second fist charge

  const chargeSnapshots = [];
  const bridge = createSpatialInputBridge({
    isGlasses: true,
    isMenuPhase: () => false,
    onGuardChange: active => battle.setGuard(active),
    onUltCharge: c => chargeSnapshots.push(c),
    onUltimate: ({ forceMusou }) => battle.castUltimate(battle.enemies[0]?.id, { forceMusou }),
  });

  // 1. Upright open palm ✋ hold -> sustained guard; release -> immediate shield drop (0ms linger):
  win.MetaTourWebAR.simulateInput({ kind: 'hand-gesture', type: 'palm-hold' });
  assert.equal(battle.guarding, true);
  assert.equal(bridge.stats().palmGuardHeld, true);

  win.MetaTourWebAR.simulateInput({ kind: 'hand-gesture', type: 'palm-release' });
  assert.equal(battle.guarding, false, 'releasing palm must drop shield immediately');
  assert.equal(bridge.stats().palmGuardHeld, false);

  // 2. Fist charge 0% -> 55% -> early release (fist-charge-cancel) does NOT unleash ultimate:
  win.MetaTourWebAR.simulateInput({ kind: 'hand-gesture', type: 'fist-charge', speed: 0.55 });
  assert.equal(Math.round(bridge.stats().ultChargeProgress * 100), 55);
  assert.equal(chargeSnapshots.at(-1)?.active, true);

  win.MetaTourWebAR.simulateInput({ kind: 'hand-gesture', type: 'fist-charge-cancel' });
  assert.equal(bridge.stats().ultChargeProgress, 0);
  assert.equal(chargeSnapshots.at(-1)?.canceled, true);
  assert.equal(battle.musouCount, 0);

  // 3. Full 2.0s steady raised fist -> fist-ult unleashes full cinematic musou ultimate even from energy=28:
  win.MetaTourWebAR.simulateInput({ kind: 'hand-gesture', type: 'fist-charge', speed: 0.92 });
  assert.equal(Math.round(bridge.stats().ultChargeProgress * 100), 92);
  win.MetaTourWebAR.simulateInput({ kind: 'hand-gesture', type: 'fist-ult' });
  assert.equal(bridge.stats().ultChargeProgress, 0);
  assert.equal(chargeSnapshots.at(-1)?.completed, true);
  assert.equal(battle.musouCount, 1, '2-second fist-ult must unleash full musou ultimate');
  assert.ok(battle.musouTime >= 0, 'musou cinematic sequence started');
});

test('Zero phone/Beam Pro shake interference: createPoseController disables gyroscope & onPose when isGlasses === true', () => {
  const win = installBridgeV154Environment('?xr=glasses');
  const pose = createPoseController({ isGlasses: true });
  assert.equal(pose.stats().controllerRayDisabled, true);
  assert.equal(pose.stats().gyroPermission, 'disabled-in-glasses');

  // Inject violent phone rotation quaternion via __onMetaTourPhoneQuat:
  win.__onMetaTourPhoneQuat(0.48, -0.52, 0.35, 0.61, 2, 0);
  const q = pose.getQuaternion();
  const identity = new T.Quaternion(0, 0, 0, 1);
  assert.ok(q.angleTo(identity) < 1e-4, 'glasses mode camera pose must stay 100% immune to phone shake');
});
