import * as T from 'three';
import './style.css';
import { createAudio } from './audio.js';
import { createEffects } from './effects.js';
import { createEnemyView } from './enemies.js';
import { createBattle, REACH, BOSS_AT } from './simulation.js';
import { formationStats } from './formation.js';
import { createCourtyard, createAlly, createSlashArc, createWarnings, createContactShadows } from './scene.js';
import { createWorldPlaque } from './world-plaque.js';
import {
  detectGlassesMode,
  createPoseController,
  createRearCamera,
  createGlassesBridge,
  createMegaAnchorBridge,
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
let mode = isGlasses ? 'battle' : 'welcome';
let cameraActive = false;
let battle = createBattle({ allySide: -1, bossAt: BOSS_AT });

function syncViewportSize() {
  if (renderer.xr.isPresenting) return;
  const width = Math.max(1, window.innerWidth);
  const height = Math.max(1, window.innerHeight);
  renderer.setSize(width, height, false);
  // Slightly wider vertical FOV on narrow portrait phones so the 1.44m stage at z=-2.2m fits with generous margin.
  camera.aspect = width / height;
  camera.fov = width < height ? 58 : 48;
  // On the Welcome screen, shift the optical frustum into the open half of the viewport
  // (right half on desktop/landscape, upper half on portrait) so Tanjiro & the Wisteria torii are never occluded by the card.
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
let lightHeld = false;
let heavyHeld = false;
let dragState = null;
let gazeHoldSec = 0;
let xrBaselineHeadX = null;

const direction = new T.Vector3();
const camWorldPos = new T.Vector3();
const tempPoint = new T.Vector3();
const targetQuat = new T.Quaternion();

function syncBackdropVisibility(isCameraOn) {
  cameraActive = Boolean(isCameraOn && !isGlasses);
  if (isGlasses) {
    videoEl.hidden = true;
    backdropEl.hidden = true;
    return;
  }
  videoEl.hidden = !cameraActive;
  backdropEl.hidden = cameraActive;
  $('#mode-badge').textContent = cameraActive ? '后置相机 AR' : '3D 触控预览';
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
  $('#sound').textContent = audio.enabled ? '声音 开' : '声音 关';
}
syncSoundButton();

function findAimTarget(activeCam) {
  activeCam.getWorldPosition(camWorldPos);
  activeCam.getWorldDirection(direction);
  let bestTarget = null;
  let bestDot = 0.87;
  for (const e of battle.enemies) {
    if (e.hp <= 0) continue;
    tempPoint.set(e.x, 1.05 * e.size, e.z).sub(camWorldPos);
    const dist = tempPoint.length();
    if (dist > REACH + 0.8) continue;
    const dot = tempPoint.normalize().dot(direction);
    if (dot > bestDot) {
      bestDot = dot;
      bestTarget = e;
    }
  }
  return bestTarget;
}

function triggerAttack(kind) {
  const activeCam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  return battle.attack(kind, findAimTarget(activeCam)?.id);
}

function flushBattleEvents() {
  for (const e of battle.events) {
    audio.event(e);
    if (e.type === 'message') showMessage(e.text, e.duration);
    if (e.type === 'playerSlash') {
      slashTime = 0.25;
      slashHeavy = !!(e.heavy || e.finisher);
      navigator.vibrate?.(slashHeavy ? 18 : 8);
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
  battle = createBattle({ allySide: -1, bossAt: BOSS_AT });
  effects.reset();
  warnings.clear();
  ally?.reset(battle.ally);
  mode = 'battle';
  gazeHoldSec = 0;
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

// Step 4: AR Glasses Auto WebXR Session Startup (immersive-vr + local-floor)
async function startGlassesWebXRSession() {
  if (!isGlasses || diagnostics.xrSessionActive) return false;
  if (!navigator.xr?.requestSession) {
    diagnostics.xrError = 'navigator.xr unavailable';
    return false;
  }
  try {
    const session = await navigator.xr.requestSession('immersive-vr', {
      optionalFeatures: ['local-floor'],
    });
    diagnostics.xrSessionActive = true;
    diagnostics.xrError = null;
    session.addEventListener('end', () => {
      diagnostics.xrSessionActive = false;
      xrBaselineHeadX = null;
    });
    session.addEventListener('select', () => {
      audio.unlock();
      if (mode === 'result') {
        enterBattle();
        return;
      }
      if (battle.energy >= 100) triggerAttack('musou');
      else triggerAttack('light');
      flushBattleEvents();
    });
    session.addEventListener('squeeze', () => {
      audio.unlock();
      if (mode === 'battle') {
        triggerAttack('heavy');
        flushBattleEvents();
      }
    });
    await renderer.xr.setSession(session);
    return true;
  } catch (err) {
    // Some desktop test browsers block auto-requestSession until user activation; retry silently on first tap.
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
      else if (mode === 'result') enterBattle();
      else if (mode === 'battle') {
        if (battle.energy >= 100) triggerAttack('musou');
        else triggerAttack('light');
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
      $('#pose-hint').textContent = '已接入元游 WebAR 浏览器 60Hz 原生姿态 · 转动手机或拖动即可环视';
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

  $('#recenter-hud').addEventListener('click', () => {
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
    battle = createBattle({ allySide: -1, bossAt: BOSS_AT });
    ally?.reset(battle.ally);
    mode = 'welcome';
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
      triggerAttack('light');
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
      triggerAttack('heavy');
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

  // Mouse & touch drag works immediately on first screen (#welcome) AND in battle!
  canvas.addEventListener('pointerdown', e => {
    dragState = { id: e.pointerId, x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    if (!dragState || dragState.id !== e.pointerId) return;
    poseCtrl.drag(e.clientX - dragState.x, e.clientY - dragState.y);
    dragState = { id: e.pointerId, x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener('pointerup', () => {
    dragState = null;
  });
  canvas.addEventListener('pointercancel', () => {
    dragState = null;
  });

  window.addEventListener('keydown', e => {
    if ([' ', 'ArrowLeft', 'ArrowRight'].includes(e.key)) e.preventDefault();
    if (e.repeat) return;
    if (e.key === 'Escape') {
      if (mode === 'battle') $('#pause').click();
      else if (mode === 'paused') $('#resume').click();
      return;
    }
    if (mode !== 'battle') return;
    const k = e.key.toLowerCase();
    if (k === 'j') {
      lightHeld = true;
      triggerAttack('light');
      flushBattleEvents();
    }
    if (k === 'k') {
      heavyHeld = true;
      triggerAttack('heavy');
      flushBattleEvents();
    }
    if (k === 'i' || e.key === ' ') {
      triggerAttack('musou');
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

// Step 6: Unified Render Loop via renderer.setAnimationLoop (works for both WebXR stereo & handheld/desktop!)
renderer.setAnimationLoop(now => {
  const dt = Math.min(0.06, Math.max(0.001, (now - lastNow) / 1000));
  lastNow = now;
  diagnostics.frames++;

  const xrPresenting = renderer.xr.isPresenting;
  const activeCamera = xrPresenting ? renderer.xr.getCamera() : camera;

  if (!xrPresenting) {
    camera.position.set(battle.player.x, 1.38, 0);
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

  const aimTarget = findAimTarget(activeCamera);

  if (mode === 'battle' && assetsReady) {
    // In AR Glasses mode, gaze-lock auto-chains slashes so hands-free optical viewing is effortless.
    if (isGlasses && aimTarget) {
      gazeHoldSec += dt;
      if (gazeHoldSec >= 0.22) {
        if (battle.energy >= 100) triggerAttack('musou');
        else triggerAttack('light');
      }
    } else {
      gazeHoldSec = 0;
    }

    accumulator += dt;
    let steps = 0;
    while (accumulator >= 1 / 60 && steps++ < 5 && mode === 'battle') {
      if (heavyHeld) triggerAttack('heavy');
      if (lightHeld) triggerAttack('light');
      battle.step(1 / 60, ally.travelAt);
      flushBattleEvents();
      ally.update(1 / 60, battle);
      effects.update(1 / 60, effectState());
      accumulator -= 1 / 60;
    }
    updateHud(aimTarget);
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
  slashArc.update(activeCamera, slashTime, slashHeavy, mode === 'battle');

  courtyard.update(now * 0.001, battle.status === 'victory' ? 1 : 0);
  warnings.update(mode === 'battle' ? battle : { hazards: [], time: 0, player: battle.player });
  enemyView.update(mode === 'battle' || mode === 'result' ? battle : { enemies: [], time: 0 });
  shadows.update(mode === 'battle' ? battle.enemies : [], ally?.actor);
  worldPlaque.update({
    mode,
    battle,
    target: aimTarget,
    camera: activeCamera,
    xrSessionActive: diagnostics.xrSessionActive || xrPresenting,
    megaSynced: megaBridge.stats().anchorCount > 0,
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
      enterBattle();
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

// Read-only diagnostics & EasyAR Mega spatial anchor hook:
window.__webar = {
  applyMegaPose: pose => megaBridge.applyMegaPose(pose),
  recenter: () => poseCtrl.recenter(),
  checkGlasses: () => glassesBridge.check(),
  snapshot: () => ({
    threeRevision: T.REVISION,
    isGlasses,
    mode,
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
    rearCamera: rearCamera.stats(),
    pose: poseCtrl.stats(),
    glassesBridge: glassesBridge.stats(),
    megaAnchor: megaBridge.stats(),
    ally: ally?.stats() || null,
    enemies: enemyView.stats(),
    formation: formationStats(battle),
    battle: {
      status: battle.status,
      hp: battle.hp,
      energy: battle.energy,
      kills: battle.kills,
      progress: Number(battle.progress.toFixed(2)),
      enemyCount: battle.enemies.length,
    },
    diagnostics: { ...diagnostics },
  }),
};
