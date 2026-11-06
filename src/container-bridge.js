import * as T from 'three';

const degToRad = T.MathUtils.degToRad;
const ENU_TO_THREE_WORLD = new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), -Math.PI / 2);

// 1. Strict Dual-Mode Detection:
// Checks window.__XREAL_CONTAINER__, window.MetaTourWebAR?.getMode() === 'glasses',
// and synchronous @JavascriptInterface objects (XrealNativePose / AndroidXrealBridge)
// so cached reloads never suffer an evaluateJavascript race.
export function detectGlassesMode() {
  const params = new URLSearchParams(window.location.search);
  return Boolean(
    window.__XREAL_CONTAINER__ === true ||
      window.MetaTourWebAR?.getMode?.() === 'glasses' ||
      window.XrealNativePose ||
      window.AndroidXrealBridge ||
      params.get('xr') === 'glasses',
  );
}

export function detectContainerMode() {
  if (detectGlassesMode()) return 'glasses';
  if (
    window.__METATOUR_HANDHELD__ === true ||
    window.MetaTourWebAR?.getMode?.() === 'handheld' ||
    window.MetaTourHandheldBridge
  ) {
    return 'handheld';
  }
  return 'browser';
}

export function orientationQuaternion(alpha, beta, gamma, screenAngle = 0) {
  return new T.Quaternion()
    .setFromEuler(new T.Euler(degToRad(beta), degToRad(alpha), degToRad(-gamma), 'YXZ'))
    .multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), -Math.PI / 2))
    .multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), -degToRad(screenAngle)));
}

// Converts Android SensorManager.getQuaternionFromVector (East-North-Up, +Z sky)
// pushed by HandheldArView -> window.MetaTourWebAR.onPose into Three.js Y-up world (-Z forward).
export function androidRotationVectorToThreeQuaternion(qx, qy, qz, qw, screenAngle = 0, target = new T.Quaternion()) {
  target.set(qx, qy, qz, qw).normalize();
  target.premultiply(ENU_TO_THREE_WORLD);
  if (screenAngle) {
    const zAxis = new T.Vector3(0, 0, 1);
    target.multiply(new T.Quaternion().setFromAxisAngle(zAxis, -degToRad(screenAngle)));
  }
  return target;
}

// 2. Handheld / Desktop Pose Controller:
// Priority 1: window.MetaTourWebAR?.onPose(pose => ...) (60Hz native container quaternion)
// Priority 2: DeviceOrientationEvent 3DoF gyroscope
// Priority 3: Touch / Mouse orbit-look drag
export function createPoseController({ onExternalRecenter, onOrientationChange } = {}) {
  let nativePoseActive = false;
  let nativePoseSource = '';
  let lastHeadingGen = null;
  let latestContainerAngle = null;
  let gyroActive = false;
  let gyroPermission = 'unknown';
  let latestGyro = null;
  let baselineYaw = null;
  let dragYaw = 0;
  let dragPitch = -0.06;
  let nativePoseCount = 0;
  let resettingInternally = false;

  const nativeQuat = new T.Quaternion();
  const rawQuat = new T.Quaternion();
  const outQuat = new T.Quaternion();
  const upAxis = new T.Vector3(0, 1, 0);
  const forward = new T.Vector3();

  function screenAngle(pose = null) {
    if (pose && pose.screenAngle !== undefined && Number.isFinite(Number(pose.screenAngle))) {
      latestContainerAngle = Number(pose.screenAngle);
      return latestContainerAngle;
    }
    if (latestContainerAngle !== null && Number.isFinite(latestContainerAngle)) {
      return latestContainerAngle;
    }
    const hostAngle = window.MetaTourWebAR?.getScreenAngle?.();
    if (hostAngle !== undefined && Number.isFinite(Number(hostAngle))) {
      return Number(hostAngle);
    }
    return Number(window.screen?.orientation?.angle ?? window.orientation ?? 0);
  }

  function parseQuat(q) {
    if (Array.isArray(q) && q.length >= 4) {
      const [x, y, z, w] = q.map(Number);
      if ([x, y, z, w].every(Number.isFinite)) return { x, y, z, w };
    }
    if (q && typeof q === 'object') {
      const x = Number(q.x);
      const y = Number(q.y);
      const z = Number(q.z);
      const w = Number(q.w);
      if ([x, y, z, w].every(Number.isFinite)) return { x, y, z, w };
    }
    return null;
  }

  function resetLocalHeading() {
    baselineYaw = null;
    dragYaw = 0;
    dragPitch = -0.06;
  }

  function ingestNativePose(pose) {
    const parsed = parseQuat(pose?.quaternion ?? pose?.rotation ?? pose);
    if (!parsed) return;

    const source = String(
      pose?.source || (window.__METATOUR_HANDHELD__ ? 'android-rotation-vector' : 'three-world'),
    );
    nativePoseSource = source;

    if (Number.isFinite(Number(pose?.headingGen))) {
      const gen = Number(pose.headingGen);
      if (lastHeadingGen !== null && gen !== lastHeadingGen) {
        resetLocalHeading();
      }
      lastHeadingGen = gen;
    }

    if (source === 'android-rotation-vector') {
      androidRotationVectorToThreeQuaternion(
        parsed.x,
        parsed.y,
        parsed.z,
        parsed.w,
        screenAngle(pose),
        nativeQuat,
      );
    } else {
      nativeQuat.set(parsed.x, parsed.y, parsed.z, parsed.w).normalize();
    }

    nativePoseActive = true;
    nativePoseCount++;
    if (baselineYaw === null) {
      forward.set(0, 0, -1).applyQuaternion(nativeQuat);
      baselineYaw = Math.atan2(-forward.x, -forward.z);
    }
  }

  // Subscribe to MetaTourWebAR 60Hz native pose stream & v1.4.0 orientation change hooks if present.
  let boundHost = null;
  function handleOrientationSignal(detail = null) {
    if (detail && detail.screenAngle !== undefined && Number.isFinite(Number(detail.screenAngle))) {
      latestContainerAngle = Number(detail.screenAngle);
    } else {
      latestContainerAngle = null;
    }
    if (!nativePoseActive) {
      baselineYaw = null;
    }
    onOrientationChange?.({
      screenAngle: screenAngle(),
      landscape: window.innerWidth > window.innerHeight,
    });
  }

  function tryBindMetaTourPose() {
    const host = window.MetaTourWebAR;
    if (!host || host === boundHost) return;
    if (typeof host.onPose === 'function') {
      boundHost = host;
      try {
        host.onPose(pose => ingestNativePose(pose));
      } catch {}
      try {
        host.onOrientationChange?.(detail => handleOrientationSignal(detail));
      } catch {}
      try {
        host.setPreferredOrientation?.('auto');
      } catch {}
    }
  }
  tryBindMetaTourPose();
  window.addEventListener('metatour:pose', e => ingestNativePose(e?.detail ?? e));

  const onHostResetEvent = () => {
    if (resettingInternally) return;
    resetLocalHeading();
    onExternalRecenter?.();
  };
  window.addEventListener('metatour-heading-reset', onHostResetEvent);
  window.addEventListener('metatour-view-reset', onHostResetEvent);
  window.addEventListener('xreal-view-reset', onHostResetEvent);
  window.addEventListener('metatour-orientation', e => handleOrientationSignal(e?.detail ?? null));
  window.addEventListener('orientationchange', () => handleOrientationSignal(null));
  window.screen?.orientation?.addEventListener?.('change', () => handleOrientationSignal(null));

  function onDeviceOrientation(e) {
    if (![e.alpha, e.beta, e.gamma].every(Number.isFinite)) return;
    if (e.alpha === 0 && e.beta === 0 && e.gamma === 0) return;
    latestGyro = { alpha: e.alpha, beta: e.beta, gamma: e.gamma };
    gyroActive = true;
  }
  window.addEventListener('deviceorientation', onDeviceOrientation);

  async function requestSensors() {
    tryBindMetaTourPose();
    if (typeof DeviceOrientationEvent === 'undefined') {
      gyroPermission = 'unavailable';
      return false;
    }
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const res = await DeviceOrientationEvent.requestPermission();
        gyroPermission = res;
        return res === 'granted';
      } catch {
        gyroPermission = 'denied';
        return false;
      }
    }
    gyroPermission = 'granted';
    return true;
  }

  function getQuaternion() {
    tryBindMetaTourPose();
    if (nativePoseActive) {
      outQuat.setFromAxisAngle(upAxis, -(baselineYaw || 0) + dragYaw).multiply(nativeQuat);
      return outQuat;
    }
    if (gyroActive && latestGyro) {
      rawQuat.copy(orientationQuaternion(latestGyro.alpha, latestGyro.beta, latestGyro.gamma, screenAngle()));
      if (baselineYaw === null) {
        forward.set(0, 0, -1).applyQuaternion(rawQuat);
        baselineYaw = Math.atan2(-forward.x, -forward.z);
      }
      outQuat.setFromAxisAngle(upAxis, -baselineYaw + dragYaw).multiply(rawQuat);
      return outQuat;
    }
    outQuat.setFromEuler(new T.Euler(dragPitch, dragYaw, 0, 'YXZ'));
    return outQuat;
  }

  return {
    requestSensors,
    ingestNativePose,
    getQuaternion,
    recenter({ notifyHost = true } = {}) {
      resetLocalHeading();
      if (notifyHost && typeof window.MetaTourWebAR?.resetHeading === 'function') {
        resettingInternally = true;
        try {
          window.MetaTourWebAR.resetHeading();
        } catch {
        } finally {
          resettingInternally = false;
        }
      }
    },
    drag(dx, dy) {
      dragYaw -= dx * 0.0032;
      if (!nativePoseActive && !gyroActive) {
        dragPitch = T.MathUtils.clamp(dragPitch - dy * 0.0026, -0.75, 0.55);
      }
    },
    setPreferredOrientation(pref = 'auto') {
      try {
        return Boolean(window.MetaTourWebAR?.setPreferredOrientation?.(pref));
      } catch {
        return false;
      }
    },
    stats: () => ({
      containerMode: detectContainerMode(),
      containerVersion: window.MetaTourWebAR?.version || null,
      screenAngle: screenAngle(),
      source: nativePoseActive ? 'metatour-native-60hz' : gyroActive ? 'device-orientation' : 'touch-mouse-drag',
      nativePoseActive,
      nativePoseSource,
      nativePoseCount,
      lastHeadingGen,
      gyroActive,
      gyroPermission,
      dragYaw: Number(dragYaw.toFixed(4)),
      dragPitch: Number(dragPitch.toFixed(4)),
    }),
  };
}

// 3. Rear Camera Controller (STRICTLY disabled when isGlasses === true):
export function createRearCamera(videoEl, { isGlasses = false, onStreamLost } = {}) {
  let stream = null;
  let active = false;
  let lastReason = '';
  let getUserMediaCalls = 0;

  function stop() {
    active = false;
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      stream = null;
    }
    if (videoEl) {
      videoEl.pause?.();
      videoEl.srcObject = null;
    }
  }

  async function start() {
    // CRITICAL RULE: NEVER invoke getUserMedia in AR Glasses optical see-through mode!
    if (isGlasses) {
      return { ok: false, skippedForGlasses: true, message: '' };
    }
    stop();
    if (!window.isSecureContext) {
      lastReason = 'InsecureContext';
      return {
        ok: false,
        reason: lastReason,
        message: '当前非 HTTPS 环境，已平滑切换为 3D 触控预览模式。',
      };
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      lastReason = 'Unavailable';
      return {
        ok: false,
        reason: lastReason,
        message: '当前浏览器不支持摄像头接口，已自动开启 3D 触控预览模式。',
      };
    }
    try {
      getUserMediaCalls++;
      const acquired = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      stream = acquired;
      videoEl.srcObject = acquired;
      for (const track of acquired.getVideoTracks()) {
        track.addEventListener('ended', () => {
          if (stream === acquired) {
            active = false;
            onStreamLost?.('后置摄像头已断开，已平滑保留 3D 触控预览。');
          }
        });
      }
      await videoEl.play();
      active = true;
      lastReason = '';
      return { ok: true, message: '后置实景相机已开启' };
    } catch (err) {
      stop();
      lastReason = err?.name || 'CameraError';
      const friendly =
        lastReason === 'NotAllowedError'
          ? '未授予相机权限，已平滑切换为 3D 触控预览模式（可随时拖动画面环视）。'
          : lastReason === 'NotFoundError'
            ? '未检测到后置摄像头，已自动进入桌面 / 免相机 3D 预览模式。'
            : '相机暂不可用，已平滑切换为 3D 触控预览模式。';
      return { ok: false, reason: lastReason, message: friendly };
    }
  }

  return {
    start,
    stop,
    stats: () => ({
      active,
      isGlasses,
      getUserMediaCalls,
      lastReason,
      width: videoEl?.videoWidth || 0,
      height: videoEl?.videoHeight || 0,
    }),
  };
}

// 4. Glasses Hot-Plug & Switch Detector (v1.2.0 onGlassesStateChange + metatour-glasses-state):
export function createGlassesBridge({ isGlasses = false, onConnectionChange } = {}) {
  let connected = false;
  let switchCalls = 0;
  let boundHost = null;

  function applyConnected(next) {
    if (isGlasses) return false;
    const flag = Boolean(next);
    if (flag !== connected) {
      connected = flag;
      onConnectionChange?.(connected);
    }
    return connected;
  }

  function tryBindHostListener() {
    if (isGlasses) return;
    const host = window.MetaTourWebAR;
    if (!host || host === boundHost) return;
    if (typeof host.onGlassesStateChange === 'function') {
      boundHost = host;
      try {
        host.onGlassesStateChange(state => {
          if (state && typeof state === 'object' && 'glassesConnected' in state) {
            applyConnected(state.glassesConnected);
          } else {
            check();
          }
        });
      } catch {}
    }
  }

  function check() {
    if (isGlasses) return false;
    tryBindHostListener();
    return applyConnected(window.MetaTourWebAR?.isGlassesConnected?.());
  }

  const timer = isGlasses ? null : window.setInterval(check, 800);
  window.addEventListener('metatour-glasses-state', e => {
    const detail = e?.detail;
    if (detail && typeof detail === 'object' && 'glassesConnected' in detail) {
      applyConnected(detail.glassesConnected);
    } else {
      check();
    }
  });
  window.addEventListener('metatour:glasses-connected', () => check());
  check();

  return {
    check,
    switchToGlasses() {
      switchCalls++;
      return window.MetaTourWebAR?.switchToGlasses?.();
    },
    dispose() {
      if (timer) window.clearInterval(timer);
    },
    stats: () => ({ connected, switchCalls }),
  };
}

// 5. EasyAR Mega Cloud Spatial Anchor Drift-Free Bridge:
// Forwards cloud anchor poses to window.MetaTourWebAR?.applyMegaPose(...) so the native container
// fuses SLAM drift at <= 3.5cm/frame. In plain H5 fallback, slews worldRoot smoothly at <= 3.5cm/frame
// and NEVER teleports or modifies the camera matrix.
export function createMegaAnchorBridge(worldRoot) {
  let anchorCount = 0;
  let lastAnchorId = null;
  let lastConfidence = 0;
  let lastNativeStatus = null;
  let boundHost = null;
  const targetOffset = new T.Vector3(0, 0, 0);
  const currentOffset = new T.Vector3(0, 0, 0);
  const stageTranslation = new T.Vector3(0, 0, 0);
  const smoothedStageTranslation = new T.Vector3(0, 0, 0);
  const deltaVec = new T.Vector3();
  let targetYaw = 0;
  let currentYaw = 0;

  function tryBindMegaStatus() {
    const host = window.MetaTourWebAR;
    if (!host || host === boundHost) return;
    if (typeof host.onMegaStatus === 'function') {
      boundHost = host;
      try {
        host.onMegaStatus(st => {
          lastNativeStatus = st;
        });
      } catch {}
    }
  }
  tryBindMegaStatus();
  window.addEventListener('metatour-mega-status', e => {
    if (e?.detail) lastNativeStatus = e.detail;
  });

  function applyMegaPose(raw) {
    if (!raw || typeof raw !== 'object') return false;
    tryBindMegaStatus();
    const anchorId = String(raw.anchorId || 'kimetsu-street-anchor');
    const pos = raw.position || { x: 0, y: 0, z: 0 };
    const quat = raw.quaternion || { x: 0, y: 0, z: 0, w: 1 };
    const confidence = Number.isFinite(Number(raw.confidence)) ? Number(raw.confidence) : 1;
    const payload = {
      anchorId,
      position: { x: Number(pos.x) || 0, y: Number(pos.y) || 0, z: Number(pos.z) || 0 },
      quaternion: {
        x: Number(quat.x) || 0,
        y: Number(quat.y) || 0,
        z: Number(quat.z) || 0,
        w: Number.isFinite(Number(quat.w)) ? Number(quat.w) : 1,
      },
      confidence,
      referenceSpace: raw.referenceSpace || 'local-floor',
    };

    anchorCount++;
    lastAnchorId = anchorId;
    lastConfidence = confidence;

    // Native MetaTour container handles <= 3.5cm/frame SLAM fusion directly in local-floor space:
    if (typeof window.MetaTourWebAR?.applyMegaPose === 'function') {
      const res = window.MetaTourWebAR.applyMegaPose(payload);
      if (res) lastNativeStatus = res;
      return Boolean(res?.ok ?? true);
    }

    // Plain browser fallback: smoothly slew worldRoot anchor (<= 3.5cm/frame), never touching camera!
    targetOffset.set(
      T.MathUtils.clamp(payload.position.x, -0.6, 0.6),
      T.MathUtils.clamp(payload.position.y, -0.25, 0.25),
      T.MathUtils.clamp(payload.position.z, -0.6, 0.6),
    );
    const q = new T.Quaternion(
      payload.quaternion.x,
      payload.quaternion.y,
      payload.quaternion.z,
      payload.quaternion.w,
    ).normalize();
    const fwd = new T.Vector3(0, 0, -1).applyQuaternion(q);
    targetYaw = T.MathUtils.clamp(Math.atan2(-fwd.x, -fwd.z), -0.35, 0.35);
    return true;
  }

  window.addEventListener('easyar:megapose', e => applyMegaPose(e?.detail ?? e));

  function setStageTranslation(x = 0, y = 0, z = 0, immediate = false) {
    stageTranslation.set(Number(x) || 0, Number(y) || 0, Number(z) || 0);
    if (immediate) {
      smoothedStageTranslation.copy(stageTranslation);
      worldRoot.position.copy(currentOffset).add(smoothedStageTranslation);
    }
  }

  function update(dt = 0.016) {
    tryBindMegaStatus();
    const blend = 1 - Math.exp(-Math.max(0.001, dt) * 18);
    smoothedStageTranslation.lerp(stageTranslation, blend);

    if (typeof window.MetaTourWebAR?.applyMegaPose === 'function') {
      // Native container fuses Mega anchor in local-floor; worldRoot carries pure player footwork stage offset:
      worldRoot.position.copy(smoothedStageTranslation);
      return;
    }
    deltaVec.subVectors(targetOffset, currentOffset);
    const dist = deltaVec.length();
    const maxStepPerFrame = 0.035; // <= 3.5cm per frame
    if (dist > 1e-5) {
      if (dist <= maxStepPerFrame) currentOffset.copy(targetOffset);
      else currentOffset.addScaledVector(deltaVec.normalize(), maxStepPerFrame);
    }
    worldRoot.position.copy(currentOffset).add(smoothedStageTranslation);
    const dYaw = Math.atan2(Math.sin(targetYaw - currentYaw), Math.cos(targetYaw - currentYaw));
    if (Math.abs(dYaw) > 1e-4) {
      const maxYawStep = 0.018;
      currentYaw += Math.abs(dYaw) <= maxYawStep ? dYaw : Math.sign(dYaw) * maxYawStep;
      worldRoot.rotation.y = currentYaw;
    }
  }

  return {
    applyMegaPose,
    setStageTranslation,
    update,
    stats: () => ({
      anchorCount,
      lastAnchorId,
      lastConfidence,
      lastNativeStatus,
      stageTranslation: smoothedStageTranslation.toArray().map(n => Number(n.toFixed(3))),
      worldRootOffset: worldRoot.position.toArray().map(n => Number(n.toFixed(3))),
    }),
  };
}

// 6. v1.5.2 Dynamic Coexistence Spatial Input Bridge (Zero-Coupling Hardware Primitives):
// Adapts MetaTourWebAR v1.5.0 / v1.5.2 raw spatial primitives with dynamic hand/trackpad fallback:
//   - Right-hand 6 air gestures (onHandGesture: slash / circle / thrust / fist-hold / fist-release / open-palm / pinch)
//   - Dynamic blind-touch fallback (onTrackpadGesture: tap / swipe-up / swipe-left / swipe-right / swipe-down / hold)
//     automatically taking over whenever the right hand is lowered or hand stream is inactive (zero deadlock!)
//   - Left-hand floating steering wheel (onTrackpadMove: { x, y, forward, strafe, active })
//   - 3D spatial menu Gaze Dwell (setReticleTarget + onGazeProgress + onGazeSelect)
export function createSpatialInputBridge({
  isGlasses = false,
  isMenuPhase = () => false,
  onSlash,
  onWaterWheel,
  onThrust,
  onGuardChange,
  onUltimate,
  onPinch,
  onMoveAxes,
  onMenuProgress,
  onMenuSelect,
  onViewReset,
} = {}) {
  let boundHost = null;
  let reticleTargetId = null;
  let lastProgress = 0;
  let lastProgressTargetId = null;
  let lastMenuSelectAt = -10000;
  let lastHandActiveAt = -10000;
  let lastTapAt = -10000;
  let squeezeDownAt = 0;
  let lastGestureSummary = '';
  let handGestureCount = 0;
  let trackpadGestureCount = 0;
  let moveEventCount = 0;
  let gazeSelectCount = 0;
  let holdReleaseTimer = null;
  let squeezeHeld = false;
  const moveState = { x: 0, y: 0, forward: 0, strafe: 0, active: false };
  let latestInputState = null;

  function nowMs() {
    return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  }

  function noteExternalHandActive(active) {
    if (active) {
      lastHandActiveAt = nowMs();
    }
  }

  function getCapabilities() {
    const hostCaps = window.MetaTourWebAR?.getCapabilities?.();
    if (hostCaps && typeof hostCaps === 'object') {
      return hostCaps;
    }
    const mode = detectContainerMode();
    return {
      mode,
      deviceModel: isGlasses ? 'AR Glasses' : mode === 'handheld' ? 'Phone' : 'Browser',
      dof: isGlasses ? 6 : mode === 'handheld' ? 3 : 0,
      handTracking: false,
      standingHeight: isGlasses ? 1.6 : 1.38,
      gaze: isGlasses,
      gazeInput: isGlasses,
      gazeDwellMs: isGlasses ? 2000 : 0,
      trackpad: isGlasses,
      trackpadSteering: isGlasses,
      rearCamera: !isGlasses,
    };
  }

  function getInputState() {
    const st = window.MetaTourWebAR?.getInputState?.();
    if (st && typeof st === 'object') {
      latestInputState = st;
      if (st.handActive) lastHandActiveAt = nowMs();
      return st;
    }
    return (
      latestInputState || {
        mode: detectContainerMode(),
        handSupported: Boolean(getCapabilities().handTracking),
        handStreamHealthy: handGestureCount > 0,
        handActive: nowMs() - lastHandActiveAt < 900,
        handedness: 'right',
        trackpadActive: moveState.active,
        moveX: moveState.x,
        moveY: moveState.y,
        forward: moveState.forward,
        strafe: moveState.strafe,
        gazeDwellMs: getCapabilities().gazeDwellMs ?? (isGlasses ? 2000 : 0),
        gazeTargetId: reticleTargetId,
      }
    );
  }

  function isHandActivelyTracked() {
    const st = getInputState();
    if (st?.handActive) {
      lastHandActiveAt = nowMs();
      return true;
    }
    return nowMs() - lastHandActiveAt < 900;
  }

  function fireMenuSelectDedup(targetId, source = 'gaze-dwell') {
    if (!targetId) return false;
    const t = nowMs();
    if (t - lastMenuSelectAt < 420) return false;
    lastMenuSelectAt = t;
    gazeSelectCount++;
    lastGestureSummary = `${source}:${targetId}`;
    onMenuSelect?.({ targetId, source });
    return true;
  }

  function triggerInstantParryWindow(source = 'instant-parry', durationMs = 950) {
    if (holdReleaseTimer) window.clearTimeout(holdReleaseTimer);
    onGuardChange?.(true, source);
    holdReleaseTimer = window.setTimeout(() => {
      holdReleaseTimer = null;
      if (!squeezeHeld) {
        onGuardChange?.(false, `${source}-end`);
      }
    }, durationMs);
  }

  function handleHandGesture(ev) {
    if (!ev || typeof ev.type !== 'string') return;
    tryBindHost();
    handGestureCount++;
    lastHandActiveAt = nowMs();
    const type = ev.type;
    const direction = ev.direction || 'right';
    const clockwise = ev.clockwise !== false && ev.direction !== 'ccw';
    lastGestureSummary = `hand:${type}${ev.direction ? `(${ev.direction})` : ''}`;

    switch (type) {
      case 'slash':
        onSlash?.({ direction, speed: Number(ev.speed) || 0, source: 'hand-slash' });
        break;
      case 'circle':
        onWaterWheel?.({ clockwise, source: 'hand-circle' });
        break;
      case 'thrust':
        onThrust?.({ source: 'hand-thrust' });
        break;
      case 'fist-hold':
        if (holdReleaseTimer) {
          window.clearTimeout(holdReleaseTimer);
          holdReleaseTimer = null;
        }
        onGuardChange?.(true, 'hand-fist-hold');
        break;
      case 'fist-release':
        onGuardChange?.(false, 'hand-fist-release');
        break;
      case 'open-palm':
        onUltimate?.({ source: 'hand-open-palm' });
        break;
      case 'pinch':
        onPinch?.({ source: 'hand-pinch', allowFallbackPrimary: false });
        break;
      default:
        break;
    }
  }

  function setSqueezeHeld(down, source = 'xr-squeeze') {
    const nextDown = Boolean(down);
    if (nextDown) {
      squeezeHeld = true;
      squeezeDownAt = nowMs();
      if (holdReleaseTimer) {
        window.clearTimeout(holdReleaseTimer);
        holdReleaseTimer = null;
      }
      onGuardChange?.(true, source);
      return;
    }
    const heldMs = squeezeDownAt > 0 ? nowMs() - squeezeDownAt : 9999;
    squeezeHeld = false;
    squeezeDownAt = 0;
    const isSystemReset = source === 'enter-battle-reset' || source === 'xr-session-end';
    if (!isSystemReset && !isMenuPhase() && heldMs < 260) {
      // Quick 2-finger tap (or legacy v1.5.0 0ms squeeze pulse) -> 0.95s Instant Water-Mirror Parry Window!
      triggerInstantParryWindow('two-finger-parry', 950);
      return;
    }
    if (holdReleaseTimer) {
      window.clearTimeout(holdReleaseTimer);
      holdReleaseTimer = null;
    }
    onGuardChange?.(false, source);
  }

  function getGazeDwellMs() {
    const st = getInputState();
    if (st && Number.isFinite(Number(st.gazeDwellMs))) {
      return Math.max(0, Number(st.gazeDwellMs));
    }
    const caps = getCapabilities();
    if (caps && Number.isFinite(Number(caps.gazeDwellMs))) {
      return Math.max(0, Number(caps.gazeDwellMs));
    }
    return isGlasses ? 2000 : 0;
  }

  function handleTrackpadGesture(ev) {
    if (!ev || typeof ev.type !== 'string') return;
    tryBindHost();
    trackpadGestureCount++;
    const type = ev.type;
    lastGestureSummary = `trackpad:${type}`;

    if (isMenuPhase()) {
      if (type === 'tap' || type === 'swipe-up') {
        onPinch?.({ source: `trackpad-${type}`, allowFallbackPrimary: true });
      }
      return;
    }

    // v1.5.2 Dynamic Coexistence Rule (eliminates GetHandData error:1 deadlock!):
    // - 2-finger / hold guard is ALWAYS honored regardless of hand state.
    // - When the right hand is actively tracked in FOV (isHandActivelyTracked() === true),
    //   air gestures lead combat while the phone screen acts purely as the left-hand steering wheel
    //   (suppressing swipe/tap crosstalk while steering).
    // - Whenever the right hand is lowered out of FOV or hand stream is inactive, full blind-pad
    //   combat skills (tap / swipe-up / swipe-left / swipe-right / swipe-down / hold) engage seamlessly!
    if (type === 'hold') {
      if (!squeezeHeld) {
        triggerInstantParryWindow('trackpad-hold', 1100);
      }
      return;
    }

    if (isHandActivelyTracked()) {
      return;
    }

    // Axial Cone Filter (|tan| <= 0.58, ~±30 deg) + Rapid Double-Tap Thrust (<= 255ms):
    // Eliminates oblique 40..50 deg thumb-flick crosstalk between Water Wheel (swipe-up) & Thrust (swipe-left/right)!
    const OBLIQUE_TAN = 0.58;
    const hasVector = ev.dx !== undefined || ev.dy !== undefined;
    const ax = Math.abs(Number(ev.dx) || 0);
    const ay = Math.abs(Number(ev.dy) || 0);
    const vectorValid = hasVector && ax + ay > 0.015;

    if (type === 'tap') {
      const eventTs = Number.isFinite(Number(ev.timestampMs)) ? Number(ev.timestampMs) : nowMs();
      if (eventTs - lastTapAt >= 45 && eventTs - lastTapAt <= 255) {
        lastTapAt = -10000;
        lastGestureSummary = 'trackpad:double-tap->thrust';
        onThrust?.({ direction: null, source: 'trackpad-double-tap' });
        return;
      }
      lastTapAt = eventTs;
      onSlash?.({ direction: 'right', speed: 1, source: 'trackpad-tap' });
    } else if (type === 'swipe-up') {
      lastTapAt = -10000;
      if (vectorValid && ax > OBLIQUE_TAN * ay) {
        lastGestureSummary = 'trackpad:oblique-up->slash';
        onSlash?.({ direction: 'up', speed: 1.15, source: 'trackpad-oblique-slash' });
        return;
      }
      onWaterWheel?.({ clockwise: true, source: 'trackpad-swipe-up' });
    } else if (type === 'swipe-left' || type === 'swipe-right') {
      lastTapAt = -10000;
      const latDir = type === 'swipe-left' ? 'left' : 'right';
      if (vectorValid && ay > OBLIQUE_TAN * ax) {
        lastGestureSummary = `trackpad:oblique-${latDir}->slash`;
        onSlash?.({ direction: latDir, speed: 1.15, source: 'trackpad-oblique-slash' });
        return;
      }
      onThrust?.({
        direction: latDir,
        source: `trackpad-${type}`,
      });
    } else if (type === 'swipe-down') {
      lastTapAt = -10000;
      if (vectorValid && ax > 0.65 * ay) {
        lastGestureSummary = 'trackpad:oblique-down->slash';
        onSlash?.({ direction: 'down', speed: 1.15, source: 'trackpad-oblique-slash' });
        return;
      }
      onUltimate?.({ source: 'trackpad-swipe-down' });
    }
  }

  function handleTrackpadMove(m) {
    if (!m || typeof m !== 'object') return;
    moveEventCount++;
    const active = Boolean(m.active);
    const rawX = Number(m.strafe ?? m.x ?? m.moveX) || 0;
    const rawY = Number(m.y ?? m.moveY) || 0;
    const rawForward = m.forward !== undefined ? Number(m.forward) || 0 : -rawY;
    moveState.active = active;
    moveState.x = active ? T.MathUtils.clamp(rawX, -1, 1) : 0;
    moveState.y = active ? T.MathUtils.clamp(rawY, -1, 1) : 0;
    moveState.strafe = moveState.x;
    moveState.forward = active ? T.MathUtils.clamp(rawForward, -1, 1) : 0;
    onMoveAxes?.({
      x: moveState.x,
      y: moveState.y,
      forward: moveState.forward,
      strafe: moveState.strafe,
      active: moveState.active,
    });
  }

  function handleGazeProgress(ev) {
    if (!ev || typeof ev !== 'object') return;
    const targetId = ev.targetId ?? null;
    const progress = T.MathUtils.clamp(Number(ev.progress) || 0, 0, 1);
    lastProgressTargetId = targetId;
    lastProgress = progress;
    onMenuProgress?.({ targetId, progress, triggered: Boolean(ev.triggered) });
    if (ev.triggered && targetId) {
      fireMenuSelectDedup(targetId, 'gaze-progress-triggered');
    }
  }

  function handleGazeSelect(ev) {
    const targetId = ev?.targetId ?? reticleTargetId;
    if (targetId) {
      fireMenuSelectDedup(targetId, 'gaze-select');
    }
  }

  function tryBindHost() {
    const host = window.MetaTourWebAR;
    if (!host || host === boundHost) return Boolean(boundHost);
    boundHost = host;
    try {
      host.onInputStateChange?.(st => {
        latestInputState = st;
        if (st?.handActive) lastHandActiveAt = nowMs();
      });
    } catch {}
    try {
      host.onHandGesture?.(ev => handleHandGesture(ev));
    } catch {}
    try {
      host.onTrackpadGesture?.(ev => handleTrackpadGesture(ev));
    } catch {}
    try {
      host.onTrackpadMove?.(ev => handleTrackpadMove(ev));
    } catch {}
    try {
      host.onGazeProgress?.(ev => handleGazeProgress(ev));
    } catch {}
    try {
      host.onGazeSelect?.(ev => handleGazeSelect(ev));
    } catch {}
    return true;
  }

  tryBindHost();

  let lastResetEventAt = -10000;
  function handleHostViewReset() {
    const t = nowMs();
    if (t - lastResetEventAt < 120) return;
    lastResetEventAt = t;
    moveState.active = false;
    moveState.x = 0;
    moveState.y = 0;
    moveState.forward = 0;
    moveState.strafe = 0;
    onMoveAxes?.({ x: 0, y: 0, forward: 0, strafe: 0, active: false });
    onViewReset?.();
  }
  window.addEventListener('metatour-view-reset', handleHostViewReset);
  window.addEventListener('xreal-view-reset', handleHostViewReset);

  // Pure-browser CustomEvent fallbacks (only active when MetaTourWebAR listener API is not present, avoiding double dispatch):
  window.addEventListener('metatour-input-state', e => {
    if (boundHost?.onInputStateChange) return;
    if (e?.detail) {
      latestInputState = e.detail;
      if (e.detail.handActive) lastHandActiveAt = nowMs();
    }
  });
  window.addEventListener('metatour-hand-gesture', e => {
    if (boundHost?.onHandGesture) return;
    handleHandGesture(e?.detail ?? e);
  });
  window.addEventListener('metatour-trackpad-gesture', e => {
    if (boundHost?.onTrackpadGesture) return;
    handleTrackpadGesture(e?.detail ?? e);
  });
  window.addEventListener('metatour-trackpad-move', e => {
    if (boundHost?.onTrackpadMove) return;
    handleTrackpadMove(e?.detail ?? e);
  });
  window.addEventListener('metatour-gaze-progress', e => {
    if (boundHost?.onGazeProgress) return;
    handleGazeProgress(e?.detail ?? e);
  });
  window.addEventListener('metatour-gaze-select', e => {
    if (boundHost?.onGazeSelect) return;
    handleGazeSelect(e?.detail ?? e);
  });

  function setReticleTarget(idOrNull) {
    tryBindHost();
    const clean = idOrNull ? String(idOrNull) : null;
    const hostHasGaze = typeof window.MetaTourWebAR?.setReticleTarget === 'function';
    if (clean !== reticleTargetId) {
      reticleTargetId = clean;
      if (!clean) {
        lastProgress = 0;
        lastProgressTargetId = null;
        onMenuProgress?.({ targetId: null, progress: 0, triggered: false });
      }
    }
    if (hostHasGaze) {
      try {
        window.MetaTourWebAR.setReticleTarget(clean);
      } catch {}
    }
    return hostHasGaze;
  }

  return {
    tryBindHost,
    getCapabilities,
    getInputState,
    isHandActivelyTracked,
    noteExternalHandActive,
    getGazeDwellMs,
    setSqueezeHeld,
    setReticleTarget,
    hasHostGazeDwell: () => typeof window.MetaTourWebAR?.setReticleTarget === 'function',
    lastMenuConfirmAgeMs: () => nowMs() - lastMenuSelectAt,
    markMenuConfirmed(targetId, source = 'manual') {
      return fireMenuSelectDedup(targetId, source);
    },
    simulateHandGesture: ev => handleHandGesture(ev),
    simulateTrackpadGesture: ev => handleTrackpadGesture(ev),
    simulateTrackpadMove: ev => handleTrackpadMove(ev),
    simulateGazeSelect: targetId => fireMenuSelectDedup(targetId, 'simulated-gaze'),
    stats: () => ({
      boundHost: Boolean(boundHost),
      capabilities: getCapabilities(),
      inputState: getInputState(),
      handActivelyTracked: isHandActivelyTracked(),
      gazeDwellMs: getGazeDwellMs(),
      squeezeHeld,
      reticleTargetId,
      lastProgressTargetId,
      lastProgress: Number(lastProgress.toFixed(3)),
      lastGestureSummary,
      handGestureCount,
      trackpadGestureCount,
      moveEventCount,
      gazeSelectCount,
      moveState: { ...moveState },
    }),
  };
}
