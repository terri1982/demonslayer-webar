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
export function createPoseController({ onExternalRecenter } = {}) {
  let nativePoseActive = false;
  let nativePoseSource = '';
  let lastHeadingGen = null;
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
    if (Number.isFinite(Number(pose?.screenAngle))) {
      return Number(pose.screenAngle);
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

  // Subscribe to MetaTourWebAR 60Hz native pose stream if present, and re-bind if injected slightly after DOM start.
  let boundHost = null;
  function tryBindMetaTourPose() {
    const host = window.MetaTourWebAR;
    if (!host || host === boundHost) return;
    if (typeof host.onPose === 'function') {
      boundHost = host;
      try {
        host.onPose(pose => ingestNativePose(pose));
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
  window.addEventListener('xreal-view-reset', onHostResetEvent);
  const onScreenOrientationChange = () => {
    baselineYaw = null;
  };
  window.addEventListener('orientationchange', onScreenOrientationChange);
  window.screen?.orientation?.addEventListener?.('change', onScreenOrientationChange);
  try {
    window.MetaTourWebAR?.setPreferredOrientation?.('auto');
  } catch {}

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
    stats: () => ({
      containerMode: detectContainerMode(),
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

  function update() {
    tryBindMegaStatus();
    if (typeof window.MetaTourWebAR?.applyMegaPose === 'function') return;
    deltaVec.subVectors(targetOffset, currentOffset);
    const dist = deltaVec.length();
    const maxStepPerFrame = 0.035; // <= 3.5cm per frame
    if (dist > 1e-5) {
      if (dist <= maxStepPerFrame) currentOffset.copy(targetOffset);
      else currentOffset.addScaledVector(deltaVec.normalize(), maxStepPerFrame);
      worldRoot.position.copy(currentOffset);
    }
    const dYaw = Math.atan2(Math.sin(targetYaw - currentYaw), Math.cos(targetYaw - currentYaw));
    if (Math.abs(dYaw) > 1e-4) {
      const maxYawStep = 0.018;
      currentYaw += Math.abs(dYaw) <= maxYawStep ? dYaw : Math.sign(dYaw) * maxYawStep;
      worldRoot.rotation.y = currentYaw;
    }
  }

  return {
    applyMegaPose,
    update,
    stats: () => ({
      anchorCount,
      lastAnchorId,
      lastConfidence,
      lastNativeStatus,
      worldRootOffset: worldRoot.position.toArray(),
    }),
  };
}
