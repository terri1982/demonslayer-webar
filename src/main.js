import * as T from 'three';
import './style.css';
import { createAudio } from './audio.js';
import { createEffects } from './effects.js';
import { createEnemyView } from './enemies.js';
import { createBattle, REACH, BOSS_AT } from './simulation.js';
import { formationStats } from './formation.js';
import {
  createCourtyard,
  createAlly,
  createSlashArc,
  createGuardShield,
  createWarnings,
  createContactShadows,
  createHandRayIndicator,
} from './scene.js';
import { createWorldPlaque } from './world-plaque.js';
import {
  detectGlassesMode,
  createPoseController,
  createRearCamera,
  createGlassesBridge,
  createMegaAnchorBridge,
  createSpatialInputBridge,
} from './container-bridge.js';

const $ = sel => document.querySelector(sel);
const videoEl = $('#camera');
const backdropEl = $('#fallback-backdrop');
const canvas = $('#ar-stage');
const uiRoot = $('#ui-root');

// Step 1: Dual-mode detection BEFORE WebGLRenderer creation!
const isGlasses = detectGlassesMode();
if (isGlasses) {
  document.documentElement.classList.add('glasses-mode');
  uiRoot.hidden = true;
  backdropEl.hidden = true;
  videoEl.hidden = true;
}

const diagnostics = {
  threeRevision: T.REVISION,
  isGlasses,
  xrSessionActive: false,
  xrError: null,
  errors: [],
  frames: 0,
};

let renderer;
try {
  renderer = new T.WebGLRenderer({
    canvas,
    alpha: !isGlasses,
    antialias: true,
    powerPreference: 'high-performance',
  });
} catch (err) {
  if (!isGlasses) {
    $('#load-status').textContent = '当前环境未启用 WebGL 3D 硬件加速，请在浏览器设置中开启后刷新。';
  }
  throw err;
}

// Step 2: Strict clearColor & WebXR setup per mode:
// - Glasses mode: opaque pure black (0x000000, 1) -> optical see-through transparent; never call getUserMedia!
// - Handheld / Fallback mode: transparent alpha (0x000000, 0) over <video> or #fallback-backdrop.
if (isGlasses) {
  renderer.setClearColor(0x000000, 1);
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local-floor');
} else {
  renderer.setClearColor(0x000000, 0);
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
renderer.outputColorSpace = T.SRGBColorSpace;
renderer.toneMapping = T.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.shadowMap.enabled = false;

// Step 3: World-space scene graph (ground y = 0, forward = -Z).
// ALL 3D objects hang under scene -> worldRoot; camera.children.length === 0 strictly!
const scene = new T.Scene();
const worldRoot = new T.Group();
worldRoot.name = 'WorldSpatialRoot';
scene.add(worldRoot);

const camera = new T.PerspectiveCamera(50, window.innerWidth / Math.max(1, window.innerHeight), 0.05, 36);
camera.position.set(0, 1.38, 0);
scene.add(camera);

const hemiLight = new T.HemisphereLight(0xe5f6ff, 0x8d8297, 2.45);
worldRoot.add(hemiLight);
const dirLight = new T.DirectionalLight(0xffe9cf, 2.4);
dirLight.position.set(1.8, 4.6, 2.6);
dirLight.castShadow = false;
worldRoot.add(dirLight);

let ally = null;
let assetsReady = false;
let pendingGlassesStart = false;
// In AR Glasses mode, Phase A opens on the 3D Spatial Welcome Plaque + Dual 3D Menu Buttons (2.14m ahead, 0% 2D DOM)!
let mode = 'welcome';
let difficulty = 'normal';
let cameraActive = false;
let battle = createBattle({ allySide: -1, bossAt: BOSS_AT, difficulty });

function syncViewportSize() {
  if (renderer.xr.isPresenting) return;
  const width = Math.max(1, window.innerWidth);
  const height = Math.max(1, window.innerHeight);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.fov = width < height ? 58 : 48;
  if (!isGlasses && mode === 'welcome') {
    if (width > height && width >= 560) {
      camera.setViewOffset(width, height, -Math.round(width * 0.21), 0, width, height);
    } else if (width <= height) {
      camera.setViewOffset(width, height, 0, Math.round(height * 0.14), width, height);
    } else {
      camera.clearViewOffset();
    }
  } else {
    camera.clearViewOffset();
  }
  camera.updateProjectionMatrix();
}
syncViewportSize();
window.addEventListener('resize', syncViewportSize);

// Spatial subsystems (all under worldRoot in scene):
const poseCtrl = createPoseController({
  onExternalRecenter() {
    if (!isGlasses && mode === 'battle') {
      showMessage('已响应容器「回正」校准正前方视角', 1.6);
    }
  },
  onOrientationChange() {
    syncViewportSize();
    window.requestAnimationFrame(syncViewportSize);
    window.setTimeout(syncViewportSize, 120);
  },
});
const rearCamera = createRearCamera(videoEl, {
  isGlasses,
  onStreamLost(msg) {
    syncBackdropVisibility(false);
    showNotice(msg);
  },
});
const megaBridge = createMegaAnchorBridge(worldRoot);
const courtyard = createCourtyard(worldRoot);
const worldPlaque = createWorldPlaque(worldRoot, { isGlasses });
const enemyView = createEnemyView(worldRoot, { bossId: 'daki' });
const effects = createEffects(worldRoot);
const warnings = createWarnings(worldRoot);
const shadows = createContactShadows(worldRoot);
const slashArc = createSlashArc(worldRoot);
const guardShield = createGuardShield(worldRoot);
const handRay = createHandRayIndicator(worldRoot);
const audio = createAudio();
audio.preload();

const glassesBridge = createGlassesBridge({
  isGlasses,
  onConnectionChange(connected) {
    if (isGlasses) return;
    $('#btn-switch-glasses').hidden = !connected;
    $('#hud-switch-glasses').hidden = !connected;
  },
});

let lastNow = performance.now();
let accumulator = 0;
let messageUntil = 0;
let hurtFlash = 0;
let slashTime = 0;
let slashHeavy = false;
let slashDir = 'right';
let lightHeld = false;
let heavyHeld = false;
let dragState = null;
let xrBaselineHeadX = null;
let battleEnteredAtMs = -10000;

// Sticky Gaze Lock & 3D Spatial Menu Dwell state:
let lockedEnemyId = null;
let gazeOnLocked = false;
let hoveredMenuId = null;
let menuProgress = 0;
let localMenuDwellSec = 0;
let gestureHint = '';
let gestureHintUntil = 0;
let xrSessionRef = null;
let handRayPinchingUntil = 0;
let simulatedHandRay = null;

const direction = new T.Vector3();
const camWorldPos = new T.Vector3();
const handOriginWorld = new T.Vector3();
const handDirWorld = new T.Vector3();
const handTempQuat = new T.Quaternion();
const tempPoint = new T.Vector3();
const targetQuat = new T.Quaternion();
const gazeRay = new T.Raycaster();
const tapNdc = new T.Vector2();

function setGestureHint(label, durationSec = 1.8) {
  gestureHint = label;
  gestureHintUntil = performance.now() + durationSec * 1000;
}

function syncBackdropVisibility(isCameraOn) {
  cameraActive = Boolean(isCameraOn && !isGlasses);
  if (isGlasses) {
    videoEl.hidden = true;
    backdropEl.hidden = true;
    return;
  }
  videoEl.hidden = !cameraActive;
  backdropEl.hidden = cameraActive;
  const badge = $('#mode-badge');
  if (badge) badge.textContent = cameraActive ? '后置相机 AR' : '3D 触控预览';
}
syncBackdropVisibility(false);

function showNotice(text) {
  if (isGlasses) return;
  const el = $('#camera-notice');
  el.hidden = !text;
  el.textContent = text || '';
}

function showMessage(text, duration = 2.4) {
  if (isGlasses) return;
  const el = $('#message');
  el.textContent = text;
  el.classList.add('show');
  messageUntil = performance.now() + duration * 1000;
}

function syncSoundButton() {
  if (isGlasses) return;
  const btn = $('#sound');
  if (btn) btn.textContent = audio.enabled ? '声音：开' : '声音：关';
}
syncSoundButton();

// Zero-Latency Sticky Gaze Lock:
// - Sweeping gaze across any alive demon immediately sets lockedEnemyId (0ms dwell wait).
// - Turning gaze away to empty space NEVER clears lockedEnemyId as long as that demon has hp > 0.
// - When the locked demon dies, automatically transfers lock to the nearest alive demon in range.
function findGazeHitEnemy(rayOrigin, rayDir) {
  let bestEnemy = null;
  let bestScore = 1.0;
  for (const e of battle.enemies) {
    if (e.hp <= 0) continue;
    // Capsule-segment gaze check across full demon stature [0.55*size .. 1.62*size]
    // so looking at either the demon's head (1.55m eye level in XREAL local-floor) or torso locks immediately:
    tempPoint.set(e.x, 1.1 * e.size, e.z).applyMatrix4(worldRoot.matrixWorld);
    const baseWorldY = tempPoint.y - 1.1 * e.size;
    const dx = tempPoint.x - rayOrigin.x;
    const dz = tempPoint.z - rayOrigin.z;
    const approxAlong = dx * rayDir.x + (tempPoint.y - rayOrigin.y) * rayDir.y + dz * rayDir.z;
    if (approxAlong <= 0.35 || approxAlong > REACH + 3.6) continue;
    const rayYAtDepth = rayOrigin.y + rayDir.y * approxAlong;
    const clampedY = T.MathUtils.clamp(rayYAtDepth, baseWorldY + 0.5 * e.size, baseWorldY + 1.65 * e.size);
    tempPoint.y = clampedY;
    tempPoint.sub(rayOrigin);
    const along = tempPoint.dot(rayDir);
    if (along <= 0.35 || along > REACH + 3.6) continue;
    const perpSq = Math.max(0, tempPoint.lengthSq() - along * along);
    const perp = Math.sqrt(perpSq);
    const hitRadius = e.boss ? 0.76 : 0.6;
    const ratio = perp / hitRadius;
    if (ratio <= 1.0 && ratio < bestScore) {
      bestScore = ratio;
      bestEnemy = e;
    }
  }
  return bestEnemy;
}

function nearestAliveEnemy() {
  return (
    battle.enemies
      .filter(e => e.hp > 0 && Math.hypot(e.x - battle.player.x, e.z - battle.player.z) <= REACH + 3.2)
      .sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0] || null
  );
}

function resolveLockedEnemy() {
  if (lockedEnemyId == null) return null;
  return battle.enemies.find(e => e.id === lockedEnemyId && e.hp > 0) || null;
}

function getCombatTargetId() {
  const locked = resolveLockedEnemy();
  if (locked) return locked.id;
  const fallback = nearestAliveEnemy();
  if (fallback) {
    lockedEnemyId = fallback.id;
    return fallback.id;
  }
  return null;
}

function triggerAttack(kind, opts = {}) {
  return battle.attack(kind, getCombatTargetId(), opts);
}

function enterBattleOrQueue() {
  if (!assetsReady) {
    pendingGlassesStart = true;
    return false;
  }
  enterBattle();
  return true;
}

function resetGlassesToWelcome() {
  audio.stop();
  effects.reset();
  warnings.clear();
  battle = createBattle({ allySide: -1, bossAt: BOSS_AT, difficulty });
  ally?.reset(battle.ally);
  mode = 'welcome';
  lockedEnemyId = null;
  gazeOnLocked = false;
  hoveredMenuId = null;
  menuProgress = 0;
  localMenuDwellSec = 0;
  spatialInput.setReticleTarget(null);
  syncViewportSize();
}

function handleSpatialMenuAction(targetId) {
  audio.unlock();
  if (targetId === 'btn-toggle-difficulty') {
    difficulty = difficulty === 'normal' ? 'hashira' : 'normal';
    battle = createBattle({ allySide: -1, bossAt: BOSS_AT, difficulty });
    ally?.reset(battle.ally);
    localMenuDwellSec = 0;
    menuProgress = 0;
    hoveredMenuId = null;
    spatialInput.setReticleTarget(null);
    audio.event({ type: 'perfect' });
    return true;
  }
  if (targetId === 'btn-back-welcome') {
    resetGlassesToWelcome();
    audio.event({ type: 'perfect' });
    return true;
  }
  return enterBattleOrQueue();
}

// v1.5.0 Decoupled Spatial Input Bridge (Air Gestures + Blind Trackpad + Floating Steering + Dynamic Gaze Dwell):
const spatialInput = createSpatialInputBridge({
  isGlasses,
  isMenuPhase: () => mode === 'welcome' || mode === 'result',
  onSlash({ direction: dir, source }) {
    if (mode !== 'battle') return;
    audio.unlock();
    const labelMap = { left: '左挥斩', right: '右挥斩', up: '上挑斩', down: '下劈斩' };
    setGestureHint(`【${source.startsWith('hand') ? '右手手势' : '盲滑触控'}】${labelMap[dir] || '拔刀普攻'}`);
    triggerAttack('light', { slashDir: dir || 'right' });
    flushBattleEvents();
  },
  onWaterWheel({ clockwise }) {
    if (mode !== 'battle') return;
    audio.unlock();
    setGestureHint(`【贰之型·水车】${clockwise ? '顺时针旋斩' : '逆时针旋斩'}`);
    battle.castWaterWheel(getCombatTargetId(), clockwise);
    flushBattleEvents();
  },
  onThrust({ direction: latDir }) {
    if (mode !== 'battle') return;
    audio.unlock();
    setGestureHint('【柒之型·雫波纹击刺】突进破招');
    battle.castThrust(getCombatTargetId(), latDir || null);
    flushBattleEvents();
  },
  onGuardChange(active) {
    if (mode !== 'battle') {
      battle.setGuard(false);
      return;
    }
    audio.unlock();
    if (active) setGestureHint('【流流舞·守势】持续架刀弹反中', 2.4);
    battle.setGuard(active);
    flushBattleEvents();
  },
  onUltimate() {
    if (mode !== 'battle') return;
    audio.unlock();
    setGestureHint('【全集中奥义】水之呼吸·水车合击！', 2.6);
    battle.castUltimate(getCombatTargetId());
    flushBattleEvents();
  },
  onPinch({ source, allowFallbackPrimary = false }) {
    audio.unlock();
    handRayPinchingUntil = performance.now() + 240;
    // Strict v1.5.0 rule: pinch confirms Phase A spatial menu buttons ONLY;
    // in Phase B battle, normal slashes are handled by 4-way 'slash' (or 3DoF 'tap'), avoiding fist/palm transition misfires.
    if (mode === 'welcome' || mode === 'result') {
      const targetMenu =
        hoveredMenuId ||
        (allowFallbackPrimary || source === 'hand-pinch' || source === 'trackpad-tap'
          ? worldPlaque.getActiveMenuId(mode)
          : null);
      if (targetMenu) {
        spatialInput.markMenuConfirmed(targetMenu, source);
      }
    }
  },
  onMoveAxes({ x, y, active }) {
    battle.setMoveAxes(x, y, active);
  },
  onMenuProgress({ targetId, progress }) {
    if (targetId && targetId === hoveredMenuId) {
      menuProgress = progress;
    } else if (!targetId) {
      menuProgress = 0;
    }
  },
  onMenuSelect({ targetId }) {
    handleSpatialMenuAction(targetId || worldPlaque.getActiveMenuId(mode) || 'btn-start-battle');
  },
});

function findEnemyByMeshOrCone(rayOrigin, rayDir) {
  const aliveActors = enemyView.getAliveActors();
  if (aliveActors.length > 0) {
    gazeRay.set(rayOrigin, rayDir);
    gazeRay.far = REACH + 3.6;
    const meshHit = gazeRay.intersectObjects(aliveActors, true)[0];
    if (meshHit) {
      let cur = meshHit.object;
      while (cur && cur.userData?.enemyId == null) cur = cur.parent;
      const id = cur?.userData?.enemyId;
      if (id != null) {
        const found = battle.enemies.find(e => e.id === id && e.hp > 0);
        if (found) return found;
      }
    }
  }
  return findGazeHitEnemy(rayOrigin, rayDir);
}

function updateStickyGazeAndMenu(activeCam, dt, handRayInfo = null) {
  worldRoot.updateMatrixWorld(true);
  activeCam.getWorldPosition(camWorldPos);
  activeCam.getWorldDirection(direction);

  // Phase A (Welcome / Result in AR Glasses): Raycast Dual 3D Spatial Menu Buttons (right-hand ray or head gaze)!
  const menuMeshes = worldPlaque.getActiveMenuMeshes(mode);
  if (isGlasses && menuMeshes.length > 0 && worldPlaque.menuGroup.visible) {
    let hit = null;
    if (handRayInfo?.active) {
      gazeRay.set(handRayInfo.originWorld, handRayInfo.dirWorld);
      gazeRay.far = 4.5;
      hit = gazeRay.intersectObjects(menuMeshes, false)[0] || null;
    }
    if (!hit) {
      gazeRay.set(camWorldPos, direction);
      gazeRay.far = 4.5;
      hit = gazeRay.intersectObjects(menuMeshes, false)[0] || null;
    }
    const nextHoverId = hit?.object?.userData?.menuId || null;
    if (nextHoverId !== hoveredMenuId) {
      localMenuDwellSec = 0;
      menuProgress = 0;
    }
    hoveredMenuId = nextHoverId;
    const hostHandlesDwell = spatialInput.setReticleTarget(hoveredMenuId);
    const dwellMs = spatialInput.getGazeDwellMs();
    if (!hostHandlesDwell) {
      const buttonReady = hoveredMenuId === 'btn-toggle-difficulty' || hoveredMenuId === 'btn-back-welcome' || assetsReady;
      if (hoveredMenuId && buttonReady && dwellMs > 0) {
        localMenuDwellSec += dt;
        menuProgress = Math.min(1, (localMenuDwellSec * 1000) / dwellMs);
        if (menuProgress >= 1) {
          const confirmedId = hoveredMenuId;
          localMenuDwellSec = 0;
          menuProgress = 0;
          spatialInput.markMenuConfirmed(confirmedId, 'local-gaze-dwell');
        }
      } else {
        localMenuDwellSec = 0;
        menuProgress = 0;
      }
    } else if (!hoveredMenuId || dwellMs <= 0) {
      menuProgress = 0;
    }
    return null;
  }

  // Phase B (Battle): Never run Gaze Dwell timer on enemies! Zero-latency Sticky Gaze Lock:
  hoveredMenuId = null;
  menuProgress = 0;
  localMenuDwellSec = 0;
  if (isGlasses) {
    spatialInput.setReticleTarget(null);
  }

  if (mode !== 'battle') return null;

  const hitByHand =
    handRayInfo?.active ? findEnemyByMeshOrCone(handRayInfo.originWorld, handRayInfo.dirWorld) : null;
  const hitEnemy = hitByHand || findEnemyByMeshOrCone(camWorldPos, direction);
  if (hitEnemy) {
    lockedEnemyId = hitEnemy.id;
    gazeOnLocked = true;
    return hitEnemy;
  }

  gazeOnLocked = false;
  const stillLocked = resolveLockedEnemy();
  if (stillLocked) {
    // Sticky retention: head moved away to empty space, keep last locked alive demon!
    return stillLocked;
  }

  // Previous locked demon died -> auto-transfer lock to nearest alive demon if one was previously locked:
  if (lockedEnemyId !== null) {
    const nextAlive = nearestAliveEnemy();
    lockedEnemyId = nextAlive ? nextAlive.id : null;
    return nextAlive;
  }
  return null;
}

function flushBattleEvents() {
  for (const e of battle.events) {
    audio.event(e);
    if (e.type === 'message') showMessage(e.text, e.duration);
    if (e.type === 'skillCallout') worldPlaque.triggerSkillBanner(e);
    if (e.type === 'playerSlash') {
      slashDir = e.slashDir || 'right';
      slashTime = slashDir.startsWith('spin') ? 0.38 : 0.25;
      slashHeavy = !!(e.heavy || e.finisher);
      navigator.vibrate?.(slashHeavy ? 18 : 8);
    }
    if (e.type === 'waterWheelSpin') {
      effects.ring(0, -2.05, true);
    }
    if (e.type === 'parry') {
      hurtFlash = 0;
      effects.ring(battle.player.x, -1.45, false);
      navigator.vibrate?.(14);
    }
    if (e.type === 'hit') effects.burst(e.x, e.y, e.z, e.dead ? 18 : 9, e.dead);
    if (e.type === 'hurt') {
      hurtFlash = 0.36;
      navigator.vibrate?.([18, 22, 18]);
    }
    if (e.type === 'perfect') {
      hurtFlash = 0;
      effects.ring(0, -1.6, false);
    }
    if (e.type === 'allyAttack') ally?.attack();
    if (e.type === 'attack' && e.kind === 'musou') {
      if (!isGlasses) $('#technique').hidden = false;
      showMessage('炭治郎：水之呼吸 · 贰之型 水车！', 2);
      lightHeld = false;
      heavyHeld = false;
    }
    if (e.type === 'musouRelease') effects.ring(0, -2.15, true);
    if (e.type === 'recover' && !isGlasses) $('#technique').hidden = true;
    if (e.type === 'end') {
      mode = 'result';
      lightHeld = false;
      heavyHeld = false;
      lockedEnemyId = null;
      gazeOnLocked = false;
      hoveredMenuId = null;
      menuProgress = 0;
      localMenuDwellSec = 0;
      if (!isGlasses) {
        $('#technique').hidden = true;
        $('#hud').hidden = true;
        $('#result').hidden = false;
        $('#result-title').textContent = e.victory ? '你与炭治郎守住了街道' : '结界被恶鬼冲散';
        $('#result-eyebrow').textContent = e.victory ? '街道恢复平静 · 恶鬼退散' : '深呼吸 · 再次握紧日轮刀';
        $('#result-copy').textContent = e.victory
          ? '炭治郎收刀向你致意：谢谢你并肩作战到最后一刻。'
          : '留意地面红光预警，向左右闪避后再用重斩打断恶鬼。';
        $('#result-kills').textContent = String(battle.kills);
        $('#result-perfect').textContent = String(battle.perfect);
        $('#result-musou').textContent = String(battle.musouCount);
        $('#dawn').style.opacity = e.victory ? '0.62' : '0';
      }
    }
  }
  battle.events.length = 0;
}

function enterBattle() {
  battle = createBattle({ allySide: -1, bossAt: BOSS_AT, difficulty });
  effects.reset();
  warnings.clear();
  ally?.reset(battle.ally);
  mode = 'battle';
  battleEnteredAtMs = performance.now();
  lockedEnemyId = null;
  gazeOnLocked = false;
  hoveredMenuId = null;
  menuProgress = 0;
  localMenuDwellSec = 0;
  spatialInput.setSqueezeHeld(false, 'enter-battle-reset');
  spatialInput.setReticleTarget(null);
  syncViewportSize();
  if (!isGlasses) {
    $('#welcome').hidden = true;
    $('#pause-menu').hidden = true;
    $('#result').hidden = true;
    $('#technique').hidden = true;
    $('#hud').hidden = false;
    $('#dawn').style.opacity = '0';
  }
  audio.stop();
  audio.unlock();
  battle.start();
  flushBattleEvents();
}

// Step 4: AR Glasses Auto WebXR Session Startup (immersive-vr + local-floor + hand-tracking)
async function startGlassesWebXRSession() {
  if (!isGlasses || diagnostics.xrSessionActive) return false;
  if (!navigator.xr?.requestSession) {
    diagnostics.xrError = 'navigator.xr unavailable';
    return false;
  }
  try {
    const session = await navigator.xr.requestSession('immersive-vr', {
      optionalFeatures: ['local-floor', 'hand-tracking'],
    });
    xrSessionRef = session;
    diagnostics.xrSessionActive = true;
    diagnostics.xrError = null;
    session.addEventListener('end', () => {
      xrSessionRef = null;
      diagnostics.xrSessionActive = false;
      xrBaselineHeadX = null;
      spatialInput.setSqueezeHeld(false, 'xr-session-end');
    });
    session.addEventListener('selectstart', ev => {
      if (ev?.inputSource?.hand) {
        handRayPinchingUntil = performance.now() + 260;
      }
    });
    session.addEventListener('select', ev => {
      audio.unlock();
      // Guard against MetaTourWebAR's Gaze-Dwell select event firing an accidental action on frame 1 of battle:
      if (
        spatialInput.lastMenuConfirmAgeMs() < 550 ||
        performance.now() - battleEnteredAtMs < 480
      ) {
        return;
      }
      const src = ev?.inputSource || null;
      if (src?.hand) {
        handRayPinchingUntil = performance.now() + 240;
      }
      if (mode === 'welcome' || mode === 'result') {
        const targetMenu =
          hoveredMenuId ||
          (src?.targetRayMode !== 'gaze' ? worldPlaque.getActiveMenuId(mode) || 'btn-start-battle' : null);
        if (targetMenu) {
          spatialInput.markMenuConfirmed(targetMenu, src?.hand ? 'xr-hand-select' : 'xr-select');
        }
        return;
      }
      if (mode === 'battle') {
        // Gaze is strictly Sticky Lock only; Hand uses 6 air gestures; MetaTour 3DoF pad uses onTrackpadGesture('tap').
        // Only fire fallback slash on generic non-MetaTour WebXR controllers!
        if (src?.targetRayMode === 'gaze' || src?.hand || window.MetaTourWebAR) return;
        triggerAttack('light', { slashDir: 'right' });
        flushBattleEvents();
      }
    });
    session.addEventListener('squeezestart', ev => {
      audio.unlock();
      if (mode === 'battle') {
        spatialInput.setSqueezeHeld(true, ev?.inputSource?.hand ? 'xr-hand-squeeze' : 'xr-pad-squeeze');
        flushBattleEvents();
      }
    });
    session.addEventListener('squeezeend', ev => {
      spatialInput.setSqueezeHeld(false, ev?.inputSource?.hand ? 'xr-hand-squeeze-end' : 'xr-pad-squeeze-end');
    });
    await renderer.xr.setSession(session);
    return true;
  } catch (err) {
    diagnostics.xrError = err?.message || String(err);
    return false;
  }
}

if (isGlasses) {
  startGlassesWebXRSession();
  window.addEventListener(
    'pointerdown',
    () => {
      audio.unlock();
      if (!diagnostics.xrSessionActive) startGlassesWebXRSession();
      if (window.MetaTourWebAR) return; // In native MetaTour container, ControlPadView / Hand / Gaze handle input
      if (mode === 'welcome' || mode === 'result') {
        spatialInput.markMenuConfirmed(worldPlaque.getActiveMenuId(mode) || 'btn-start-battle', 'pointer');
      } else if (mode === 'battle') {
        triggerAttack('light', { slashDir: 'right' });
        flushBattleEvents();
      }
    },
    { passive: true },
  );
}

// Step 5: Handheld & Desktop UI Interactions
if (!isGlasses) {
  const syncHandheldContainerHint = () => {
    if (poseCtrl.stats().containerMode === 'handheld') {
      $('#pose-hint').textContent = '已接入元游 WebAR 全屏 60Hz 原生姿态 · 转动手机或拖动即可环视';
    }
  };
  syncHandheldContainerHint();
  window.setTimeout(syncHandheldContainerHint, 250);

  $('#btn-camera-ar').addEventListener('click', async () => {
    audio.unlock();
    $('#btn-camera-ar').disabled = true;
    const sensorTask = poseCtrl.requestSensors();
    const camResult = await rearCamera.start();
    await sensorTask;
    $('#btn-camera-ar').disabled = false;
    syncBackdropVisibility(camResult.ok);
    if (!camResult.ok && camResult.message) {
      showNotice(camResult.message);
    } else {
      showNotice('');
    }
    poseCtrl.recenter();
    if (assetsReady) {
      enterBattle();
      if (!camResult.ok && camResult.message) {
        showMessage(camResult.message, 3.2);
      }
    }
  });

  $('#btn-touch-preview').addEventListener('click', () => {
    audio.unlock();
    rearCamera.stop();
    syncBackdropVisibility(false);
    poseCtrl.recenter();
    if (assetsReady) enterBattle();
  });

  const onSwitchGlasses = () => glassesBridge.switchToGlasses();
  $('#btn-switch-glasses').addEventListener('click', onSwitchGlasses);
  $('#hud-switch-glasses').addEventListener('click', onSwitchGlasses);

  $('#recenter-hud')?.addEventListener('click', () => {
    poseCtrl.recenter();
    showMessage('已将结界校准回当前正前方', 1.6);
  });

  $('#sound').addEventListener('click', () => {
    audio.unlock();
    audio.toggle();
    syncSoundButton();
  });

  $('#pause').addEventListener('click', () => {
    if (mode !== 'battle') return;
    mode = 'paused';
    battle.status = 'paused';
    battle.setGuard(false);
    lightHeld = false;
    heavyHeld = false;
    audio.pause();
    $('#pause-menu').hidden = false;
  });

  $('#resume').addEventListener('click', () => {
    if (mode !== 'paused') return;
    audio.unlock();
    mode = 'battle';
    battle.status = 'playing';
    audio.resume();
    $('#pause-menu').hidden = true;
  });

  $('#recenter').addEventListener('click', () => {
    poseCtrl.recenter();
    $('#pause-copy').textContent = '藤花结界已重新对齐到当前正前方。';
  });

  $('#toggle-camera-pause').addEventListener('click', async () => {
    if (cameraActive) {
      rearCamera.stop();
      syncBackdropVisibility(false);
      $('#pause-copy').textContent = '已切换为免相机 3D 渐层预览背景。';
    } else {
      const res = await rearCamera.start();
      syncBackdropVisibility(res.ok);
      $('#pause-copy').textContent = res.message;
    }
  });

  $('#restart').addEventListener('click', () => enterBattle());
  $('#again').addEventListener('click', () => enterBattle());

  const backToWelcome = () => {
    rearCamera.stop();
    syncBackdropVisibility(false);
    audio.stop();
    effects.reset();
    warnings.clear();
    battle = createBattle({ allySide: -1, bossAt: BOSS_AT, difficulty });
    ally?.reset(battle.ally);
    mode = 'welcome';
    lockedEnemyId = null;
    gazeOnLocked = false;
    syncViewportSize();
    $('#hud').hidden = true;
    $('#pause-menu').hidden = true;
    $('#result').hidden = true;
    $('#welcome').hidden = false;
    $('#dawn').style.opacity = '0';
    $('#danger-wash').style.opacity = '0';
  };
  $('#leave').addEventListener('click', backToWelcome);
  $('#exit').addEventListener('click', backToWelcome);

  function bindHold(selector, onDown, onUp) {
    const button = $(selector);
    let activePointer = null;
    button.addEventListener('pointerdown', e => {
      e.preventDefault();
      if (mode !== 'battle' || activePointer !== null) return;
      activePointer = e.pointerId;
      button.setPointerCapture(e.pointerId);
      onDown();
    });
    const release = e => {
      if (e.pointerId !== activePointer) return;
      activePointer = null;
      onUp();
    };
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
  }

  bindHold(
    '#light',
    () => {
      lightHeld = true;
      triggerAttack('light', { slashDir: 'right' });
      flushBattleEvents();
    },
    () => {
      lightHeld = false;
    },
  );
  bindHold(
    '#heavy',
    () => {
      heavyHeld = true;
      triggerAttack('heavy', { slashDir: 'thrust' });
      flushBattleEvents();
    },
    () => {
      heavyHeld = false;
    },
  );
  $('#musou').addEventListener('click', () => {
    triggerAttack('musou');
    flushBattleEvents();
  });
  $('#dodge-left').addEventListener('click', () => {
    battle.dodge(-1);
    flushBattleEvents();
  });
  $('#dodge-right').addEventListener('click', () => {
    battle.dodge(1);
    flushBattleEvents();
  });

  // Mouse & touch drag works immediately on #welcome AND in battle; quick tap on an enemy locks it!
  canvas.addEventListener('pointerdown', e => {
    dragState = { id: e.pointerId, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    if (!dragState || dragState.id !== e.pointerId) return;
    poseCtrl.drag(e.clientX - dragState.x, e.clientY - dragState.y);
    dragState.x = e.clientX;
    dragState.y = e.clientY;
  });
  canvas.addEventListener('pointerup', e => {
    if (dragState && dragState.id === e.pointerId && mode === 'battle') {
      const moved = Math.hypot(e.clientX - dragState.startX, e.clientY - dragState.startY);
      if (moved < 12) {
        tapNdc.set((e.clientX / Math.max(1, window.innerWidth)) * 2 - 1, -(e.clientY / Math.max(1, window.innerHeight)) * 2 + 1);
        gazeRay.setFromCamera(tapNdc, camera);
        const tappedEnemy = findGazeHitEnemy(gazeRay.ray.origin, gazeRay.ray.direction);
        if (tappedEnemy) {
          lockedEnemyId = tappedEnemy.id;
        }
      }
    }
    dragState = null;
  });
  canvas.addEventListener('pointercancel', () => {
    dragState = null;
  });

  window.addEventListener('keydown', e => {
    if ([' ', 'ArrowLeft', 'ArrowRight', 'Shift'].includes(e.key)) e.preventDefault();
    if (e.repeat) return;
    if (e.key === 'Escape') {
      if (mode === 'battle') $('#pause').click();
      else if (mode === 'paused') $('#resume').click();
      return;
    }
    if (mode !== 'battle') return;
    const k = e.key.toLowerCase();
    if (k === 'j' || e.key === ' ') {
      lightHeld = k === 'j';
      triggerAttack('light', { slashDir: 'right' });
      flushBattleEvents();
    }
    if (k === 'k' || e.key === '2') {
      if (k === 'k') heavyHeld = true;
      battle.castThrust(getCombatTargetId());
      flushBattleEvents();
    }
    if (e.key === '1') {
      battle.castWaterWheel(getCombatTargetId(), true);
      flushBattleEvents();
    }
    if (e.key === '3' || k === 'i') {
      battle.castUltimate(getCombatTargetId());
      flushBattleEvents();
    }
    if (e.key === 'Shift') {
      battle.setGuard(true);
      flushBattleEvents();
    }
    if (e.key === 'ArrowLeft' || k === 'a') {
      battle.dodge(-1);
      flushBattleEvents();
    }
    if (e.key === 'ArrowRight' || k === 'd') {
      battle.dodge(1);
      flushBattleEvents();
    }
  });
  window.addEventListener('keyup', e => {
    const k = e.key.toLowerCase();
    if (k === 'j') lightHeld = false;
    if (k === 'k') heavyHeld = false;
    if (e.key === 'Shift') battle.setGuard(false);
  });
}

function updateHud(target) {
  if (isGlasses || mode !== 'battle') return;
  $('#reticle').classList.toggle('locked', !!target);
  $('#target-label').textContent = target
    ? `${target.boss ? '堕姬' : target.role === 'caster' ? '血术鬼' : '恶鬼'} · ${Math.ceil(target.hp)}`
    : '';
  $('#edge-arrow').hidden = !!target || !battle.enemies.some(e => e.hp > 0);
  const hpPct = Math.round(battle.hp);
  $('#health').style.width = `${hpPct}%`;
  $('#hp-text').textContent = `${hpPct}%`;
  $('#phase').textContent = ['沿街前行 · 并肩迎敌', '鬼群逼近 · 闪避反击', '鬼首拦路 · 水车合击'][battle.phase];

  const remaining = Math.max(0, Math.ceil(battle.bossAt - battle.progress));
  $('#timer').textContent = battle.bossSpawned ? '鬼首' : `${remaining} m`;
  $('#clock-label').textContent = battle.bossSpawned ? '堕姬现身' : '距鬼首';
  $('#kills').textContent = `${battle.kills} 击破`;

  $('#energy-label').textContent = battle.energy >= 100 ? '就绪' : `${Math.floor(battle.energy)}%`;
  $('#energy-ring').style.strokeDashoffset = String(282.75 * (1 - battle.energy / 100));
  $('#musou').classList.toggle('ready', battle.energy >= 100);
  $('#musou').setAttribute('aria-disabled', String(battle.energy < 100));

  const numerals = '①②③';
  const light = battle.stageView('light');
  const heavy = battle.stageView('heavy');
  $('#light-name').textContent = numerals[light.stage - 1];
  $('#light-stage').textContent = light.label;
  $('#light').classList.toggle('chaining', battle.chainKind === 'light' && battle.chainStage > 0);

  $('#heavy-name').textContent = numerals[heavy.stage - 1];
  $('#heavy-stage').textContent = heavy.cooling ? `${battle.heavyCd.toFixed(1)}s` : heavy.label;
  $('#heavy').classList.toggle('cooldown', heavy.cooling);
  $('#heavy').classList.toggle('chaining', battle.chainKind === 'heavy' && battle.chainStage > 0);

  const hazard = battle.hazards.reduce((best, h) => (!best || h.remaining < best.remaining ? h : best), null);
  $('#danger').hidden = !hazard;
  $('#danger-name').textContent = hazard?.label || '';
  $('#danger-time').textContent = hazard ? `${hazard.remaining.toFixed(1)} 秒 · 点击左右闪避` : '';
  $('#danger-wash').style.opacity = hazard ? String(0.14 + (1 - hazard.remaining / hazard.duration) * 0.24) : '0';

  const boss = battle.enemies.find(e => e.boss && e.hp > 0);
  $('#boss-hud').hidden = !boss;
  if (boss) $('#boss-health').style.width = `${(boss.hp / boss.maxHp) * 100}%`;
}

function effectState() {
  const p = ally?.actor.position || { x: -0.42, z: -2.18 };
  return {
    time: battle.time,
    hero: {
      x: p.x,
      z: p.z,
      yaw: Math.PI,
      move: battle.musouTime >= 0 ? 'musou' : null,
      moveTime: Math.max(0, battle.musouTime),
    },
  };
}

function extractRightHandRay(xrFrame) {
  if (simulatedHandRay && Array.isArray(simulatedHandRay.origin) && Array.isArray(simulatedHandRay.direction)) {
    handOriginWorld.fromArray(simulatedHandRay.origin);
    handDirWorld.fromArray(simulatedHandRay.direction).normalize();
    return { active: true, originWorld: handOriginWorld, dirWorld: handDirWorld };
  }
  if (!isGlasses || !xrFrame || !xrSessionRef?.inputSources) {
    return { active: false, originWorld: null, dirWorld: null };
  }
  const refSpace = renderer.xr.getReferenceSpace?.();
  if (!refSpace) {
    return { active: false, originWorld: null, dirWorld: null };
  }
  for (const src of xrSessionRef.inputSources) {
    if (!src.hand || (src.handedness && src.handedness !== 'right') || !src.targetRaySpace) continue;
    try {
      const pose = xrFrame.getPose(src.targetRaySpace, refSpace);
      if (pose?.transform) {
        const p = pose.transform.position;
        const o = pose.transform.orientation;
        handOriginWorld.set(p.x, p.y, p.z);
        handTempQuat.set(o.x, o.y, o.z, o.w).normalize();
        handDirWorld.set(0, 0, -1).applyQuaternion(handTempQuat).normalize();
        return { active: true, originWorld: handOriginWorld, dirWorld: handDirWorld };
      }
    } catch {}
  }
  return { active: false, originWorld: null, dirWorld: null };
}

// Step 6: Unified Render Loop via renderer.setAnimationLoop (works for both WebXR stereo & handheld/desktop!)
renderer.setAnimationLoop((now, xrFrame) => {
  const dt = Math.min(0.06, Math.max(0.001, (now - lastNow) / 1000));
  lastNow = now;
  diagnostics.frames++;

  const xrPresenting = renderer.xr.isPresenting;
  const activeCamera = xrPresenting ? renderer.xr.getCamera() : camera;

  if (!xrPresenting) {
    camera.position.set(battle.player.x, 1.38, battle.player.z || 0);
    targetQuat.copy(poseCtrl.getQuaternion());
    camera.quaternion.slerp(targetQuat, 1 - Math.exp(-dt * 22));
    camera.updateMatrixWorld(true);
  } else {
    // 6DoF lateral head-step dodge in AR Glasses local-floor space:
    activeCamera.getWorldPosition(camWorldPos);
    if (xrBaselineHeadX === null) xrBaselineHeadX = camWorldPos.x;
    const lateralDelta = camWorldPos.x - xrBaselineHeadX;
    if (mode === 'battle' && battle.hazards.length > 0 && Math.abs(lateralDelta) > 0.22) {
      if (battle.dodge(lateralDelta > 0 ? 1 : -1)) {
        xrBaselineHeadX = camWorldPos.x;
        flushBattleEvents();
      }
    } else {
      xrBaselineHeadX += (camWorldPos.x - xrBaselineHeadX) * Math.min(1, dt * 1.5);
    }
  }

  megaBridge.update();

  if (gestureHint && now > gestureHintUntil) {
    gestureHint = '';
  }

  const handRayState = extractRightHandRay(xrFrame);
  const lockedTarget = updateStickyGazeAndMenu(activeCamera, dt, handRayState);

  if (mode === 'battle' && assetsReady) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= 1 / 60 && steps++ < 5 && mode === 'battle') {
      if (heavyHeld) triggerAttack('heavy', { slashDir: 'thrust' });
      if (lightHeld) triggerAttack('light', { slashDir: 'right' });
      battle.step(1 / 60, ally.travelAt);
      flushBattleEvents();
      ally.update(1 / 60, battle);
      effects.update(1 / 60, effectState());
      accumulator -= 1 / 60;
    }
    updateHud(lockedTarget);
  } else {
    accumulator = 0;
    if (assetsReady) {
      ally.update(dt, battle);
      effects.update(dt, effectState());
    }
  }

  if (!isGlasses && performance.now() > messageUntil) {
    $('#message').classList.remove('show');
  }
  hurtFlash = Math.max(0, hurtFlash - dt);
  if (!isGlasses) $('#hit-flash').style.opacity = String(hurtFlash * 1.5);

  slashTime = Math.max(0, slashTime - dt);
  slashArc.update(activeCamera, slashTime, slashHeavy, mode === 'battle', slashDir);
  guardShield.update(activeCamera, mode === 'battle' && battle.guarding, now * 0.001);
  handRay.update({
    active: handRayState.active,
    originWorld: handRayState.originWorld,
    dirWorld: handRayState.dirWorld,
    length: hoveredMenuId ? 1.95 : lockedTarget ? Math.min(3.2, Math.hypot(lockedTarget.x, lockedTarget.z)) : 1.95,
    hovered: Boolean(hoveredMenuId || (gazeOnLocked && lockedTarget)),
    pinching: now < handRayPinchingUntil,
    camera: activeCamera,
    dt,
  });

  courtyard.update(now * 0.001, battle.status === 'victory' ? 1 : 0);
  warnings.update(mode === 'battle' ? battle : { hazards: [], time: 0, player: battle.player });
  enemyView.update(mode === 'battle' || mode === 'result' ? battle : { enemies: [], time: 0 });
  shadows.update(mode === 'battle' ? battle.enemies : [], ally?.actor);
  const caps = spatialInput.getCapabilities();
  const inputState = spatialInput.getInputState();
  worldPlaque.update({
    mode,
    difficulty,
    assetsReady,
    battle,
    lockedTarget,
    nearestTarget: nearestAliveEnemy(),
    gazeOnTarget: gazeOnLocked,
    hoveredMenuId,
    menuProgress,
    gazeDwellMs: spatialInput.getGazeDwellMs(),
    deviceModel: caps.deviceModel || '',
    handTracking: Boolean(caps.handTracking),
    handActive: handRayState.active || Boolean(inputState?.handActive),
    gestureHint,
    camera: activeCamera,
    xrSessionActive: diagnostics.xrSessionActive || xrPresenting,
    megaSynced: megaBridge.stats().anchorCount > 0,
    nowSec: now * 0.001,
    dt,
  });

  renderer.render(scene, camera);
  if (ally?.actor.visible && !xrPresenting) {
    ally.draw(camera);
  }
});

window.addEventListener('error', e => diagnostics.errors.push(e.message));
window.addEventListener('unhandledrejection', e => diagnostics.errors.push(String(e.reason)));

Promise.all([
  createAlly(worldRoot, renderer, text => {
    if (!isGlasses) $('#load-status').textContent = text;
  }),
  enemyView.ready,
])
  .then(([loadedAlly]) => {
    ally = loadedAlly;
    assetsReady = true;
    ally.reset(battle.ally);
    ally.actor.visible = true;
    if (isGlasses) {
      if (pendingGlassesStart) {
        pendingGlassesStart = false;
        enterBattle();
      }
    } else {
      $('#load-status').textContent = '炭治郎与藤花结界已就绪 · 选择后置相机 AR 或直接 3D 试玩';
    }
  })
  .catch(err => {
    diagnostics.errors.push(err.message);
    if (!isGlasses) {
      $('#load-status').textContent = `3D 资源载入提示：${err.message}`;
    }
  });

// Read-only diagnostics, v1.5.0 Spatial Input test hooks & EasyAR Mega spatial anchor hook:
window.__webar = {
  applyMegaPose: pose => megaBridge.applyMegaPose(pose),
  recenter: () => poseCtrl.recenter(),
  checkGlasses: () => glassesBridge.check(),
  spatialInput: {
    simulateHandGesture: ev => spatialInput.simulateHandGesture(ev),
    simulateTrackpadGesture: ev => spatialInput.simulateTrackpadGesture(ev),
    simulateTrackpadMove: ev => spatialInput.simulateTrackpadMove(ev),
    simulateGazeSelect: id => spatialInput.simulateGazeSelect(id),
    simulateSqueezeHeld: (down, source) => spatialInput.setSqueezeHeld(down, source),
    simulateHandRay: poseOrNull => {
      simulatedHandRay = poseOrNull;
    },
    stats: () => spatialInput.stats(),
  },
  snapshot: () => ({
    threeRevision: T.REVISION,
    isGlasses,
    mode,
    difficulty,
    assetsReady,
    cameraActive,
    cameraChildrenCount: camera.children.length,
    worldRootChildrenCount: worldRoot.children.length,
    drawCalls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    clearAlpha: renderer.getClearAlpha(),
    clearColorHex: `#${renderer.getClearColor(new T.Color()).getHexString()}`,
    xrEnabled: renderer.xr.enabled,
    xrPresenting: renderer.xr.isPresenting,
    lockedEnemyId,
    gazeOnLocked,
    hoveredMenuId,
    menuProgress: Number(menuProgress.toFixed(3)),
    worldPlaque: worldPlaque.stats(),
    handRay: handRay.stats(),
    rearCamera: rearCamera.stats(),
    pose: poseCtrl.stats(),
    glassesBridge: glassesBridge.stats(),
    megaAnchor: megaBridge.stats(),
    spatialInput: spatialInput.stats(),
    ally: ally?.stats() || null,
    enemies: enemyView.stats(),
    formation: formationStats(battle),
    battle: {
      difficulty: battle.difficulty,
      status: battle.status,
      hp: battle.hp,
      energy: Number(battle.energy.toFixed(1)),
      kills: battle.kills,
      perfect: battle.perfect,
      musouCount: battle.musouCount,
      guarding: battle.guarding,
      playerX: Number(battle.player.x.toFixed(3)),
      playerZ: Number((battle.player.z || 0).toFixed(3)),
      progress: Number(battle.progress.toFixed(2)),
      enemyCount: battle.enemies.length,
    },
    diagnostics: { ...diagnostics },
  }),
};
