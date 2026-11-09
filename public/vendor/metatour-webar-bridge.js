/**
 * MetaTour WebAR Unified Runtime Bridge (window.MetaTourWebAR)
 * Supports three execution environments from a single webpage:
 *  - 'glasses'  : AR Glasses stereo 6DoF/3DoF WebXR container (Display #7, ATW v2)
 *  - 'handheld' : Phone fullscreen rear-camera WebAR container (Display #0, HandheldArView, portrait & landscape)
 *  - 'browser'  : Standard mobile/desktop browser (Safari / Chrome / WeChat fallback)
 */
(function () {
  'use strict';

  if (window.MetaTourWebAR && window.MetaTourWebAR.__initialized) {
    return;
  }

  var poseListeners = [];
  var modeListeners = [];
  var megaListeners = [];
  var orientationListeners = [];
  var inputStateListeners = [];
  var handGestureListeners = [];
  var trackpadMoveListeners = [];
  var trackpadGestureListeners = [];
  var dodgeListeners = [];
  var gazeProgressListeners = [];
  var gazeSelectListeners = [];
  var viewResetListeners = [];
  var squeezeListeners = [];
  var guideListeners = [];
  var baroListeners = [];
  var locationListeners = [];
  var bleBaroListeners = [];
  var sensorStatusListeners = [];
  var browserGeoWatchId = null;
  var pushedGlassesConnected = null;
  var pushedScreenAngle = null;
  var pushedCapabilities = null;
  var simProfile = 'real';
  var viewResetCount = 0;
  var lastApiResetWallMs = -10000;
  var MAX_DEV_EVENTS = 16;
  var devEventLog = [];
  var devUiRefreshHook = null;

  var domSubscribed = {
    handGesture: false,
    trackpadGesture: false,
    trackpadMove: false,
    gaze: false,
    viewReset: false
  };

  if (typeof window.addEventListener === 'function') {
    var origWinAddEventListener = window.addEventListener.bind(window);
    try {
      window.addEventListener = function (type, listener, options) {
        if (type === 'metatour-view-reset' || type === 'xreal-view-reset' || type === 'metatour-heading-reset') {
          domSubscribed.viewReset = true;
        } else if (type === 'metatour-hand-gesture') {
          domSubscribed.handGesture = true;
        } else if (type === 'metatour-trackpad-gesture') {
          domSubscribed.trackpadGesture = true;
        } else if (type === 'metatour-trackpad-move') {
          domSubscribed.trackpadMove = true;
        } else if (type === 'metatour-gaze-progress' || type === 'metatour-gaze-select') {
          domSubscribed.gaze = true;
        }
        return origWinAddEventListener(type, listener, options);
      };
    } catch (_) {
      // Ignore read-only window.addEventListener in restricted sandboxes
    }
  }

  function formatDevClock() {
    var d = new Date();
    var hh = String(d.getHours()).padStart(2, '0');
    var mm = String(d.getMinutes()).padStart(2, '0');
    var ss = String(d.getSeconds()).padStart(2, '0');
    var cs = String(Math.floor(d.getMilliseconds() / 10)).padStart(2, '0');
    return hh + ':' + mm + ':' + ss + '.' + cs;
  }

  function recordBridgeEvent(category, summary) {
    var entry = {
      time: formatDevClock(),
      category: String(category || 'INFO'),
      summary: String(summary || ''),
      timestamp: Date.now()
    };
    devEventLog.push(entry);
    if (devEventLog.length > MAX_DEV_EVENTS) {
      devEventLog.splice(0, devEventLog.length - MAX_DEV_EVENTS);
    }
    if (typeof devUiRefreshHook === 'function') {
      try { devUiRefreshHook(); } catch (_) {}
    }
  }

  function cleanZero(v) {
    var n = Number(v);
    if (!Number.isFinite(n) || Math.abs(n) < 1e-7) return 0;
    return n;
  }

  var moveAxes = {
    x: 0,
    y: 0,
    active: false
  };

  var squeezeState = {
    active: false,
    source: 'none'
  };

  var handRuntime = {
    active: false,
    handedness: 'right',
    palmGuard: false,
    chargeProgress: 0,
    lastGesture: null
  };

  var gazeState = {
    dwellMs: 2000,
    targetId: null,
    enterMs: 0,
    firedForTarget: false,
    lastTriggerMs: -10000,
    rafId: 0
  };
  var GAZE_RETRIGGER_COOLDOWN_MS = 1200;

  var guideState = {
    open: false,
    skipOnTap: true,
    styleEl: null,
    dialogEl: null,
    stereoHost: null,
    prevInertSiblings: [],
    onClose: null
  };

  var latestHandheldPose = {
    x: 0,
    y: 0,
    z: 0,
    w: 1,
    screenAngle: 0,
    timestamp: 0,
    headingGen: 0,
    source: 'none'
  };

  var lastFallbackMegaStatus = {
    active: false,
    anchorId: '',
    confidence: 0,
    referenceSpace: 'local-floor',
    pendingDistM: 0,
    pendingYawDeg: 0,
    appliedYawDeg: 0,
    updates: 0
  };

  function detectRawMode() {
    if (window.__XREAL_CONTAINER__ || window.XrealNativePose || window.AndroidXrealBridge) {
      return 'glasses';
    }
    if (window.__METATOUR_HANDHELD__ || window.MetaTourHandheldBridge) {
      return 'handheld';
    }
    return 'browser';
  }

  function detectMode() {
    if (simProfile === 'glasses-6dof' || simProfile === 'glasses-3dof') {
      return 'glasses';
    }
    if (simProfile === 'handheld') {
      return 'handheld';
    }
    if (simProfile === 'browser') {
      return 'browser';
    }
    return detectRawMode();
  }

  function normalizeAngle(deg) {
    var n = Number(deg);
    if (!Number.isFinite(n)) return 0;
    n = ((Math.round(n / 90) * 90) % 360 + 360) % 360;
    return n;
  }

  function getScreenAngle() {
    if (pushedScreenAngle !== null && Number.isFinite(pushedScreenAngle)) {
      return pushedScreenAngle;
    }
    try {
      if (window.MetaTourHandheldBridge && typeof window.MetaTourHandheldBridge.getScreenAngle === 'function') {
        return normalizeAngle(window.MetaTourHandheldBridge.getScreenAngle());
      }
    } catch (e) {
      // Ignore bridge error
    }
    try {
      if (window.screen && window.screen.orientation && typeof window.screen.orientation.angle === 'number') {
        return normalizeAngle(window.screen.orientation.angle);
      }
      if (typeof window.orientation === 'number') {
        return normalizeAngle(window.orientation);
      }
    } catch (e2) {
      // Ignore browser API error
    }
    return 0;
  }

  function setPreferredOrientation(mode) {
    var raw = typeof mode === 'string' ? mode.trim().toLowerCase() : 'auto';
    var normalized = 'auto';
    if (raw === 'landscape' || raw === 'landscape-primary' || raw === 'landscape-secondary') {
      normalized = 'landscape';
    } else if (raw === 'portrait' || raw === 'portrait-primary' || raw === 'portrait-secondary') {
      normalized = 'portrait';
    } else if (raw === 'auto' || raw === 'any' || raw === 'natural') {
      normalized = 'auto';
    } else {
      return false;
    }

    try {
      if (window.MetaTourHandheldBridge && typeof window.MetaTourHandheldBridge.setPreferredOrientation === 'function') {
        return !!window.MetaTourHandheldBridge.setPreferredOrientation(normalized);
      }
    } catch (e) {
      // Ignore bridge error
    }

    try {
      if (window.screen && window.screen.orientation) {
        if (normalized === 'auto' && typeof window.screen.orientation.unlock === 'function') {
          window.screen.orientation.unlock();
          return true;
        }
        if (normalized !== 'auto' && typeof window.screen.orientation.lock === 'function') {
          window.screen.orientation.lock(normalized).catch(function () {});
          return true;
        }
      }
    } catch (e2) {
      // Ignore unsupported orientation lock error
    }
    return false;
  }

  function isGlassesConnected() {
    if (simProfile === 'glasses-6dof' || simProfile === 'glasses-3dof') return true;
    if (simProfile === 'handheld' || simProfile === 'browser') return false;
    if (detectMode() === 'glasses') return true;
    try {
      if (window.MetaTourHandheldBridge && typeof window.MetaTourHandheldBridge.isGlassesConnected === 'function') {
        return !!window.MetaTourHandheldBridge.isGlassesConnected();
      }
    } catch (e) {
      // Ignore bridge error
    }
    return pushedGlassesConnected === true;
  }

  function switchToGlasses() {
    try {
      if (window.MetaTourHandheldBridge && typeof window.MetaTourHandheldBridge.switchToGlasses === 'function') {
        return !!window.MetaTourHandheldBridge.switchToGlasses();
      }
    } catch (e) {
      // Ignore bridge error
    }
    return false;
  }

  function clearTransientInputOnReset() {
    var hadMove = moveAxes.active || moveAxes.x !== 0 || moveAxes.y !== 0;
    moveAxes.x = 0;
    moveAxes.y = 0;
    moveAxes.active = false;
    if (typeof window.__updateMetaTourTrackpadAxes === 'function') {
      try { window.__updateMetaTourTrackpadAxes(0, 0, false); } catch (_) {}
    }
    if (hadMove) {
      var zeroSnap = { x: 0, y: 0, forward: 0, strafe: 0, active: false };
      for (var i = 0; i < trackpadMoveListeners.length; i++) {
        try { trackpadMoveListeners[i](zeroSnap); } catch (_) {}
      }
      try {
        window.dispatchEvent(new CustomEvent('metatour-trackpad-move', { detail: zeroSnap }));
      } catch (_) {}
    }
    setReticleTarget(null);
    gazeState.enterMs = 0;
    gazeState.firedForTarget = false;
    notifyInputStateListeners();
  }

  function dispatchUnifiedViewReset(tsMs, source) {
    viewResetCount += 1;
    latestHandheldPose.headingGen += 1;
    clearTransientInputOnReset();
    recordBridgeEvent('重置', '视角重置 #' + viewResetCount + ' (' + (source || 'bridge') + ')');
    var detail = {
      count: viewResetCount,
      generation: latestHandheldPose.headingGen,
      timestampMs: Number.isFinite(Number(tsMs)) ? Number(tsMs) : Date.now(),
      source: source || 'bridge'
    };
    for (var i = 0; i < viewResetListeners.length; i++) {
      try { viewResetListeners[i](detail); } catch (_) {}
    }
    try {
      window.dispatchEvent(new CustomEvent('metatour-heading-reset', {
        detail: { generation: latestHandheldPose.headingGen }
      }));
      window.dispatchEvent(new CustomEvent('xreal-view-reset', { detail: detail }));
      window.dispatchEvent(new CustomEvent('metatour-view-reset', { detail: detail }));
    } catch (e2) {
      // Ignore event error
    }
    return detail;
  }

  function resetView() {
    var nowWall = Date.now();
    lastApiResetWallMs = nowWall;
    try {
      if (window.MetaTourSpatialBridge && typeof window.MetaTourSpatialBridge.resetView === 'function' && detectMode() === 'glasses') {
        window.MetaTourSpatialBridge.resetView();
      } else if (window.MetaTourHandheldBridge && typeof window.MetaTourHandheldBridge.resetHeading === 'function') {
        window.MetaTourHandheldBridge.resetHeading();
      } else if (window.AndroidXrealBridge && typeof window.AndroidXrealBridge.recenterPose === 'function') {
        window.AndroidXrealBridge.recenterPose();
      }
    } catch (e) {
      // Ignore bridge error
    }
    return dispatchUnifiedViewReset(nowWall, 'api');
  }

  function resetHeading() {
    return resetView();
  }

  window.__onMetaTourViewReset = function (tsMs) {
    if (Date.now() - lastApiResetWallMs < 120) {
      return;
    }
    dispatchUnifiedViewReset(tsMs, 'native');
  };

  function safeParseJson(raw, fallback) {
    if (!raw || typeof raw !== 'string') return fallback;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function applyMegaPose(poseInput) {
    if (!poseInput || typeof poseInput !== 'object') {
      return { ok: false, reason: 'invalid_pose_object' };
    }
    var pos = poseInput.position || {};
    var quat = poseInput.quaternion || {};
    var px = Number(pos.x);
    var py = Number(pos.y);
    var pz = Number(pos.z);
    var qx = Number(quat.x || 0);
    var qy = Number(quat.y || 0);
    var qz = Number(quat.z || 0);
    var qw = ('w' in quat) ? Number(quat.w) : 1;
    if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz) ||
        !Number.isFinite(qx) || !Number.isFinite(qy) || !Number.isFinite(qz) || !Number.isFinite(qw)) {
      return { ok: false, reason: 'non_finite_coordinates' };
    }
    var payload = {
      anchorId: String(poseInput.anchorId || 'mega-anchor'),
      position: { x: px, y: py, z: pz },
      quaternion: { x: qx, y: qy, z: qz, w: qw },
      confidence: Number.isFinite(Number(poseInput.confidence)) ? Number(poseInput.confidence) : 1.0,
      referenceSpace: poseInput.referenceSpace === 'local' ? 'local' : 'local-floor',
      timestampMs: Number.isFinite(Number(poseInput.timestampMs)) ? Number(poseInput.timestampMs) : Date.now()
    };

    try {
      if (window.MetaTourSpatialBridge && typeof window.MetaTourSpatialBridge.applyMegaAnchorJson === 'function') {
        var resRaw = window.MetaTourSpatialBridge.applyMegaAnchorJson(JSON.stringify(payload));
        var res = safeParseJson(resRaw, { ok: true });
        notifyMegaListeners(getSpatialStatus());
        return res;
      }
    } catch (e) {
      return { ok: false, reason: 'native_bridge_error' };
    }

    // Pure browser / preview fallback record so web developers can debug Mega callbacks on desktop too.
    lastFallbackMegaStatus = {
      active: payload.confidence >= 0.35,
      anchorId: payload.anchorId,
      confidence: payload.confidence,
      referenceSpace: payload.referenceSpace,
      targetPosition: payload.position,
      targetQuaternion: payload.quaternion,
      pendingDistM: 0,
      pendingYawDeg: 0,
      appliedYawDeg: 0,
      updates: (lastFallbackMegaStatus.updates || 0) + 1
    };
    notifyMegaListeners(lastFallbackMegaStatus);
    return { ok: true, simulated: true, status: lastFallbackMegaStatus };
  }

  function clearMegaPose() {
    try {
      if (window.MetaTourSpatialBridge && typeof window.MetaTourSpatialBridge.clearMegaAnchor === 'function') {
        window.MetaTourSpatialBridge.clearMegaAnchor();
      }
    } catch (e) {
      // Ignore bridge error
    }
    lastFallbackMegaStatus = {
      active: false,
      anchorId: '',
      confidence: 0,
      referenceSpace: 'local-floor',
      pendingDistM: 0,
      pendingYawDeg: 0,
      appliedYawDeg: 0,
      updates: 0
    };
    notifyMegaListeners(getSpatialStatus());
    return { ok: true };
  }

  function getSpatialStatus() {
    try {
      if (window.MetaTourSpatialBridge && typeof window.MetaTourSpatialBridge.getSpatialStatusJson === 'function') {
        var parsed = safeParseJson(window.MetaTourSpatialBridge.getSpatialStatusJson(), null);
        if (parsed) return parsed;
      }
    } catch (e) {
      // Ignore bridge error
    }
    return lastFallbackMegaStatus;
  }

  function notifyMegaListeners(status) {
    for (var i = 0; i < megaListeners.length; i++) {
      try { megaListeners[i](status); } catch (e) { /* ignore */ }
    }
    try {
      window.dispatchEvent(new CustomEvent('metatour-mega-status', { detail: status }));
    } catch (e2) { /* ignore */ }
  }

  function nowMs() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }

  function normalizeDwellMs(ms) {
    var n = Number(ms);
    if (!Number.isFinite(n) || n <= 0) return 0;
    if (n <= 1500) return 1000;
    if (n <= 2500) return 2000;
    return 3000;
  }

  function getGazeDwellMs() {
    try {
      if (window.MetaTourSpatialBridge && typeof window.MetaTourSpatialBridge.getGazeDwellMs === 'function') {
        gazeState.dwellMs = normalizeDwellMs(window.MetaTourSpatialBridge.getGazeDwellMs());
      }
    } catch (e) { /* ignore */ }
    return gazeState.dwellMs;
  }

  function setGazeDwellMs(ms) {
    var norm = normalizeDwellMs(ms);
    gazeState.dwellMs = norm;
    try {
      if (window.MetaTourSpatialBridge && typeof window.MetaTourSpatialBridge.setGazeDwellMs === 'function') {
        window.MetaTourSpatialBridge.setGazeDwellMs(norm);
      }
    } catch (e) { /* ignore */ }
    if (norm === 0 && gazeState.targetId !== null) {
      emitGazeProgress(gazeState.targetId, 0, 0, false);
    }
    notifyInputStateListeners();
    return norm;
  }

  function getSimulatedCapabilities(profile) {
    var dwell = gazeState.dwellMs > 0 ? gazeState.dwellMs : 2000;
    if (profile === 'glasses-6dof') {
      var gList = [
        'pinch',
        'slash',
        'wave-combo',
        'circle',
        'thrust',
        'palm-hold',
        'palm-release',
        'fist-charge',
        'fist-charge-cancel',
        'fist-ult',
        'fist-hold',
        'fist-release',
        'open-palm'
      ];
      return {
        mode: 'glasses',
        deviceModel: 'Simulated Samsung S24 + XREAL Air 2 Ultra',
        dof: 6,
        handHardwareSupported: true,
        handStreamHealthy: true,
        handTracking: true,
        handGestures: gList.slice(),
        handGestureSet: gList.slice(),
        gaze: true,
        gazeInput: true,
        gazeDwellMs: dwell,
        trackpad: true,
        trackpadSteering: true,
        controllerRay: false,
        rearCamera: false,
        simulated: true,
        simProfile: profile
      };
    }
    if (profile === 'glasses-3dof') {
      return {
        mode: 'glasses',
        deviceModel: 'Simulated AR Glasses (Blind-Pad + Gaze)',
        dof: 3,
        handHardwareSupported: false,
        handStreamHealthy: false,
        handTracking: false,
        handGestures: [],
        handGestureSet: [],
        gaze: true,
        gazeInput: true,
        gazeDwellMs: dwell,
        trackpad: true,
        trackpadSteering: true,
        controllerRay: false,
        rearCamera: false,
        simulated: true,
        simProfile: profile
      };
    }
    if (profile === 'handheld') {
      return {
        mode: 'handheld',
        deviceModel: 'Simulated Phone Handheld',
        dof: 3,
        handHardwareSupported: false,
        handStreamHealthy: false,
        handTracking: false,
        handGestures: [],
        handGestureSet: [],
        gaze: false,
        gazeInput: false,
        gazeDwellMs: 0,
        trackpad: false,
        trackpadSteering: false,
        controllerRay: false,
        rearCamera: true,
        simulated: true,
        simProfile: profile
      };
    }
    return {
      mode: 'browser',
      deviceModel: 'Simulated Desktop Browser',
      dof: 0,
      handHardwareSupported: false,
      handStreamHealthy: false,
      handTracking: false,
      handGestures: [],
      handGestureSet: [],
      gaze: false,
      gazeInput: false,
      gazeDwellMs: 0,
      trackpad: false,
      trackpadSteering: false,
      controllerRay: false,
      rearCamera: true,
      simulated: true,
      simProfile: 'browser'
    };
  }

  function getCapabilities() {
    if (simProfile !== 'real') {
      return getSimulatedCapabilities(simProfile);
    }
    if (pushedCapabilities && typeof pushedCapabilities === 'object') {
      return Object.assign({}, pushedCapabilities, { gazeDwellMs: getGazeDwellMs() });
    }
    try {
      if (window.MetaTourSpatialBridge && typeof window.MetaTourSpatialBridge.getCapabilitiesJson === 'function') {
        var parsed = safeParseJson(window.MetaTourSpatialBridge.getCapabilitiesJson(), null);
        if (parsed && typeof parsed === 'object') {
          pushedCapabilities = parsed;
          if (typeof window.__setMetaTourHandSupported === 'function') {
            try { window.__setMetaTourHandSupported(!!parsed.handTracking); } catch (e0) {}
          }
          return Object.assign({}, parsed);
        }
      }
    } catch (e) { /* ignore */ }
    var m = detectMode();
    if (m === 'glasses') {
      return {
        mode: 'glasses',
        deviceModel: 'AR Glasses',
        dof: 6,
        handHardwareSupported: false,
        handStreamHealthy: false,
        handTracking: false,
        handGestures: [],
        handGestureSet: [],
        gaze: true,
        gazeInput: true,
        gazeDwellMs: getGazeDwellMs(),
        trackpad: true,
        trackpadSteering: true,
        controllerRay: false,
        rearCamera: false
      };
    }
    return {
      mode: m,
      deviceModel: m === 'handheld' ? 'Phone' : 'Browser',
      dof: m === 'handheld' ? 3 : 0,
      handHardwareSupported: false,
      handStreamHealthy: false,
      handTracking: false,
      handGestures: [],
      handGestureSet: [],
      gaze: false,
      gazeInput: false,
      gazeDwellMs: 0,
      trackpad: false,
      trackpadSteering: false,
      controllerRay: false,
      rearCamera: true
    };
  }

  function queryHandStreamHealthy(caps) {
    if (simProfile !== 'real') {
      return !!(caps && caps.handStreamHealthy);
    }
    try {
      if (window.MetaTourSpatialBridge && typeof window.MetaTourSpatialBridge.isHandStreamHealthy === 'function') {
        return !!window.MetaTourSpatialBridge.isHandStreamHealthy();
      }
    } catch (_) {}
    if (caps && typeof caps.handStreamHealthy === 'boolean') {
      return caps.handStreamHealthy;
    }
    return !!(caps && caps.handTracking);
  }

  function queryHandHardwareSupported(caps) {
    if (simProfile !== 'real') {
      return !!(caps && caps.handHardwareSupported);
    }
    try {
      if (window.MetaTourSpatialBridge && typeof window.MetaTourSpatialBridge.isHandHardwareSupported === 'function') {
        return !!window.MetaTourSpatialBridge.isHandHardwareSupported();
      }
    } catch (_) {}
    if (caps && typeof caps.handHardwareSupported === 'boolean') {
      return caps.handHardwareSupported;
    }
    return !!(caps && caps.handTracking);
  }

  function getInputState() {
    var caps = getCapabilities();
    var streamHealthy = queryHandStreamHealthy(caps);
    var hwSupported = queryHandHardwareSupported(caps);
    var fwd = moveAxes.active ? cleanZero(-moveAxes.y) : 0;
    var str = moveAxes.active ? cleanZero(moveAxes.x) : 0;
    return {
      mode: caps.mode,
      deviceModel: caps.deviceModel,
      simulated: !!caps.simulated,
      simProfile: simProfile,
      activeRayMode: handRuntime.active ? 'hand' : (caps.mode === 'glasses' ? 'gaze' : 'screen'),
      handHardwareSupported: hwSupported,
      handStreamHealthy: streamHealthy,
      handSupported: !!(caps.handTracking && streamHealthy),
      handActive: handRuntime.active,
      handedness: handRuntime.handedness,
      palmGuardActive: handRuntime.palmGuard,
      fistChargeProgress: handRuntime.chargeProgress,
      controllerRay: false,
      trackpadActive: moveAxes.active,
      squeezeActive: squeezeState.active,
      moveX: moveAxes.x,
      moveY: moveAxes.y,
      forward: fwd,
      strafe: str,
      gazeDwellMs: caps.gazeDwellMs,
      gazeTargetId: gazeState.targetId
    };
  }

  function notifyInputStateListeners() {
    var st = getInputState();
    for (var i = 0; i < inputStateListeners.length; i++) {
      try { inputStateListeners[i](st); } catch (e) { /* ignore */ }
    }
    try {
      window.dispatchEvent(new CustomEvent('metatour-input-state', { detail: st }));
    } catch (e2) { /* ignore */ }
  }

  var lastGazeProgressPct = 0;

  function emitGazeProgress(targetId, progress, dwellMs, triggered) {
    lastGazeProgressPct = targetId ? Math.max(0, Math.min(1, Number(progress) || 0)) : 0;
    if (typeof devUiRefreshHook === 'function' && (triggered || targetId === null || Math.round(lastGazeProgressPct * 10) !== Math.round(((Number(progress) || 0) - 0.05) * 10))) {
      try { devUiRefreshHook(); } catch (_) {}
    }
    var detail = {
      targetId: targetId,
      progress: progress,
      dwellMs: dwellMs,
      triggered: !!triggered
    };
    for (var i = 0; i < gazeProgressListeners.length; i++) {
      try { gazeProgressListeners[i](detail); } catch (e) { /* ignore */ }
    }
    try {
      window.dispatchEvent(new CustomEvent('metatour-gaze-progress', { detail: detail }));
    } catch (e2) { /* ignore */ }
  }

  function resolveEffectiveDwellMs() {
    var caps = getCapabilities();
    if (caps && Number.isFinite(Number(caps.gazeDwellMs)) && Number(caps.gazeDwellMs) > 0) {
      return Number(caps.gazeDwellMs);
    }
    return getGazeDwellMs();
  }

  function tickGazeDwell() {
    gazeState.rafId = 0;
    if (gazeState.targetId === null) return;
    var dwell = resolveEffectiveDwellMs();
    if (!(dwell > 0)) return;
    var now = nowMs();
    if (gazeState.firedForTarget) {
      return;
    }
    if (now - gazeState.lastTriggerMs < GAZE_RETRIGGER_COOLDOWN_MS) {
      gazeState.enterMs = now;
      emitGazeProgress(gazeState.targetId, 0, dwell, false);
      if (typeof requestAnimationFrame === 'function') {
        gazeState.rafId = requestAnimationFrame(tickGazeDwell);
      }
      return;
    }
    var elapsed = Math.max(0, now - gazeState.enterMs);
    var progress = Math.min(1, elapsed / dwell);
    if (progress >= 1) {
      gazeState.firedForTarget = true;
      gazeState.lastTriggerMs = now;
      var selectedId = gazeState.targetId;
      recordBridgeEvent('注视', 'gazeSelect -> ' + selectedId + ' (' + dwell + 'ms)');
      emitGazeProgress(selectedId, 1, dwell, true);
      if (typeof window.__triggerMetaTourGazeSelect === 'function') {
        try { window.__triggerMetaTourGazeSelect(); } catch (e0) {}
      }
      var selDetail = { targetId: selectedId, dwellMs: dwell, timestamp: Date.now() };
      for (var i = 0; i < gazeSelectListeners.length; i++) {
        try { gazeSelectListeners[i](selDetail); } catch (e1) {}
      }
      try {
        window.dispatchEvent(new CustomEvent('metatour-gaze-select', { detail: selDetail }));
      } catch (e2) {}
      return;
    }
    emitGazeProgress(gazeState.targetId, progress, dwell, false);
    if (typeof requestAnimationFrame === 'function') {
      gazeState.rafId = requestAnimationFrame(tickGazeDwell);
    }
  }

  function setReticleTarget(idOrNull) {
    var cleanId = null;
    if (idOrNull !== null && idOrNull !== undefined && idOrNull !== '') {
      if (typeof idOrNull === 'string' || typeof idOrNull === 'number') {
        var s = String(idOrNull).trim();
        if (s.length > 0 && s.length <= 128) {
          cleanId = s;
        }
      }
    }
    if (cleanId === gazeState.targetId) {
      return;
    }
    if (cleanId === null) {
      gazeState.targetId = null;
      gazeState.firedForTarget = false;
      if (gazeState.rafId && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(gazeState.rafId);
        gazeState.rafId = 0;
      }
      emitGazeProgress(null, 0, resolveEffectiveDwellMs(), false);
      notifyInputStateListeners();
      return;
    }
    gazeState.targetId = cleanId;
    gazeState.enterMs = nowMs();
    gazeState.firedForTarget = false;
    var dwell = resolveEffectiveDwellMs();
    emitGazeProgress(cleanId, 0, dwell, false);
    notifyInputStateListeners();
    if (dwell > 0 && !gazeState.rafId && typeof requestAnimationFrame === 'function') {
      gazeState.rafId = requestAnimationFrame(tickGazeDwell);
    }
  }

  window.__onMetaTourCapabilities = function (capsObj) {
    if (!capsObj || typeof capsObj !== 'object') return;
    pushedCapabilities = capsObj;
    if (Number.isFinite(Number(capsObj.gazeDwellMs))) {
      gazeState.dwellMs = normalizeDwellMs(capsObj.gazeDwellMs);
    }
    if (typeof window.__setMetaTourHandSupported === 'function') {
      try { window.__setMetaTourHandSupported(!!capsObj.handTracking); } catch (e) {}
    }
    notifyInputStateListeners();
  };

  window.__onMetaTourGazeConfig = function (dwellMs) {
    gazeState.dwellMs = normalizeDwellMs(dwellMs);
    if (gazeState.dwellMs === 0) {
      if (gazeState.rafId && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(gazeState.rafId);
        gazeState.rafId = 0;
      }
      if (gazeState.targetId !== null) {
        emitGazeProgress(gazeState.targetId, 0, 0, false);
      }
    } else if (gazeState.targetId !== null && !gazeState.firedForTarget && !gazeState.rafId && typeof requestAnimationFrame === 'function') {
      gazeState.enterMs = nowMs();
      gazeState.rafId = requestAnimationFrame(tickGazeDwell);
    }
    notifyInputStateListeners();
  };

  window.__onMetaTourHandActiveChange = function (active, handedness) {
    var nextAct = !!active;
    var prevAct = handRuntime.active;
    handRuntime.active = nextAct;
    if (handedness === 'left' || handedness === 'right') {
      handRuntime.handedness = handedness;
    }
    if (prevAct !== nextAct) {
      recordBridgeEvent('协同', nextAct ? '右手入镜 (handActive=true)' : '右手放下·盲操接管 (handActive=false)');
    }
    notifyInputStateListeners();
  };

  window.__onMetaTourHandGesture = function (type, direction, clockwise, speedMps, rightHand, tsMs) {
    if (typeof type !== 'string' || !type) return;
    var rawSpeed = Number.isFinite(Number(speedMps)) ? Number(speedMps) : 0;
    var chargePct = type === 'fist-charge'
      ? Math.max(0, Math.min(1, rawSpeed))
      : (type === 'fist-ult' ? 1 : 0);
    var ev = {
      type: type,
      direction: (typeof direction === 'string' && direction.length > 0) ? direction : null,
      clockwise: !!clockwise,
      speed: rawSpeed,
      chargeProgress: chargePct,
      handedness: rightHand === false ? 'left' : 'right',
      timestamp: Number.isFinite(Number(tsMs)) ? Number(tsMs) : Date.now()
    };
    handRuntime.lastGesture = ev;
    if (type === 'palm-hold') {
      handRuntime.palmGuard = true;
      notifyInputStateListeners();
    } else if (type === 'palm-release') {
      handRuntime.palmGuard = false;
      notifyInputStateListeners();
    } else if (type === 'fist-charge') {
      handRuntime.chargeProgress = chargePct;
      if (typeof devUiRefreshHook === 'function') {
        try { devUiRefreshHook(); } catch (_) {}
      }
    } else if (type === 'fist-ult' || type === 'fist-charge-cancel' || type === 'fist-release') {
      handRuntime.chargeProgress = 0;
      notifyInputStateListeners();
    }

    if (type !== 'fist-charge') {
      var extra = '';
      if (ev.type === 'slash' && ev.direction) {
        extra = ' (' + ev.direction + (ev.speed > 0 ? ', ' + ev.speed.toFixed(1) + 'm/s' : '') + ')';
      } else if (ev.type === 'wave-combo') {
        extra = ' (水车 ' + (ev.direction === 'rlr' ? '右-左-右' : '左-右-左') + ')';
      } else if (ev.type === 'circle') {
        extra = ' (' + (ev.clockwise ? '顺时针' : '逆时针') + ')';
      } else if (ev.type === 'thrust') {
        extra = ' (突刺' + (ev.speed > 0 ? ', ' + ev.speed.toFixed(1) + 'm/s' : '') + ')';
      } else if (ev.type === 'palm-hold') {
        extra = ' (竖掌✋持续格挡)';
      } else if (ev.type === 'palm-release') {
        extra = ' (放手收盾)';
      } else if (ev.type === 'fist-ult') {
        extra = ' (抬手握拳2秒蓄满·释放大招!)';
      } else if (ev.type === 'fist-charge-cancel') {
        extra = ' (握拳未满2秒·取消蓄力)';
      }
      recordBridgeEvent('隔空', ev.type + extra);
    }

    if (guideState.open && guideState.skipOnTap && type === 'pinch') {
      dismissInteractionGuide('pinch');
      return;
    }

    for (var i = 0; i < handGestureListeners.length; i++) {
      try { handGestureListeners[i](ev); } catch (e) { /* ignore */ }
    }
    try {
      window.dispatchEvent(new CustomEvent('metatour-hand-gesture', { detail: ev }));
    } catch (e2) { /* ignore */ }
  };

  window.__onMetaTourTrackpadMove = function (mx, my, active) {
    var wasActive = moveAxes.active;
    var isAct = !!active;
    moveAxes.x = isAct && Number.isFinite(Number(mx)) ? cleanZero(Math.max(-1, Math.min(1, Number(mx)))) : 0;
    moveAxes.y = isAct && Number.isFinite(Number(my)) ? cleanZero(Math.max(-1, Math.min(1, Number(my)))) : 0;
    moveAxes.active = isAct;
    if (typeof window.__updateMetaTourTrackpadAxes === 'function') {
      try { window.__updateMetaTourTrackpadAxes(moveAxes.x, moveAxes.y, moveAxes.active); } catch (e0) {}
    }
    var snap = {
      x: moveAxes.x,
      y: moveAxes.y,
      forward: isAct ? cleanZero(-moveAxes.y) : 0,
      strafe: isAct ? cleanZero(moveAxes.x) : 0,
      active: moveAxes.active
    };
    if (!wasActive && isAct) {
      recordBridgeEvent('走位', '持续推盘走位 (fwd=' + snap.forward.toFixed(2) + ', str=' + snap.strafe.toFixed(2) + ')');
    } else if (wasActive && !isAct) {
      recordBridgeEvent('走位', '松手归零');
    } else if (typeof devUiRefreshHook === 'function') {
      try { devUiRefreshHook(); } catch (_) {}
    }
    for (var i = 0; i < trackpadMoveListeners.length; i++) {
      try { trackpadMoveListeners[i](snap); } catch (e1) { /* ignore */ }
    }
    try {
      window.dispatchEvent(new CustomEvent('metatour-trackpad-move', { detail: snap }));
    } catch (e2) { /* ignore */ }
  };

  window.__onMetaTourTrackpadGesture = function (type, dx, dy, tsMs) {
    if (typeof type !== 'string' || !type) return;
    var actionTag = type === 'swipe-left'
      ? 'dodge-left'
      : (type === 'swipe-right' ? 'dodge-right' : (type === 'tap' ? 'attack' : null));
    var ev = {
      type: type,
      action: actionTag,
      dx: Number.isFinite(Number(dx)) ? Number(dx) : 0,
      dy: Number.isFinite(Number(dy)) ? Number(dy) : 0,
      timestamp: Number.isFinite(Number(tsMs)) ? Number(tsMs) : Date.now()
    };
    var tagSuffix = actionTag === 'dodge-left'
      ? ' (快速左滑·左闪)'
      : (actionTag === 'dodge-right' ? ' (快速右滑·右闪)' : (actionTag === 'attack' ? ' (点按普攻/确认)' : ''));
    recordBridgeEvent('盲操', ev.type + tagSuffix);

    if (guideState.open && guideState.skipOnTap && type === 'tap') {
      dismissInteractionGuide('tap');
      return;
    }

    if (actionTag === 'dodge-left' || actionTag === 'dodge-right') {
      var dodgeEv = {
        direction: actionTag === 'dodge-left' ? 'left' : 'right',
        action: actionTag,
        type: type,
        dx: ev.dx,
        dy: ev.dy,
        timestamp: ev.timestamp
      };
      for (var di = 0; di < dodgeListeners.length; di++) {
        try { dodgeListeners[di](dodgeEv); } catch (_) {}
      }
      try {
        window.dispatchEvent(new CustomEvent('metatour-dodge', { detail: dodgeEv }));
      } catch (_) {}
    }

    for (var i = 0; i < trackpadGestureListeners.length; i++) {
      try { trackpadGestureListeners[i](ev); } catch (e) { /* ignore */ }
    }
    try {
      window.dispatchEvent(new CustomEvent('metatour-trackpad-gesture', { detail: ev }));
    } catch (e2) { /* ignore */ }
  };

  window.__onMetaTourSqueezeChange = function (active, source) {
    var nextAct = !!active;
    var src = typeof source === 'string' && source ? source : 'trackpad';
    var changed = squeezeState.active !== nextAct || squeezeState.source !== src;
    squeezeState.active = nextAct;
    squeezeState.source = src;
    if (changed) {
      recordBridgeEvent('护盾', (nextAct ? '按住持续防御' : '松开防御') + ' (' + src + ')');
    }
    var detail = {
      active: nextAct,
      source: src,
      timestamp: Date.now()
    };
    for (var i = 0; i < squeezeListeners.length; i++) {
      try { squeezeListeners[i](detail); } catch (_) {}
    }
    try {
      window.dispatchEvent(new CustomEvent('metatour-squeeze-change', { detail: detail }));
    } catch (_) {}
    notifyInputStateListeners();
  };

  // Native push hook called by HandheldArView at ~60Hz with phone game-rotation ENU quaternion + screenAngle
  window.__onMetaTourPhoneQuat = function (qx, qy, qz, qw, gen, screenAngle) {
    latestHandheldPose.x = Number(qx) || 0;
    latestHandheldPose.y = Number(qy) || 0;
    latestHandheldPose.z = Number(qz) || 0;
    latestHandheldPose.w = Number.isFinite(Number(qw)) ? Number(qw) : 1;
    if (Number.isFinite(Number(screenAngle))) {
      pushedScreenAngle = normalizeAngle(screenAngle);
    }
    latestHandheldPose.screenAngle = getScreenAngle();
    latestHandheldPose.timestamp = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    if (Number.isFinite(Number(gen))) latestHandheldPose.headingGen = Number(gen);
    latestHandheldPose.source = 'android-rotation-vector';
    for (var i = 0; i < poseListeners.length; i++) {
      try { poseListeners[i](latestHandheldPose); } catch (e) { /* ignore */ }
    }
  };

  window.__onMetaTourOrientation = function (angleDeg) {
    pushedScreenAngle = normalizeAngle(angleDeg);
    latestHandheldPose.screenAngle = pushedScreenAngle;
    var detail = {
      screenAngle: pushedScreenAngle,
      landscape: pushedScreenAngle === 90 || pushedScreenAngle === 270,
      mode: detectMode()
    };
    for (var i = 0; i < orientationListeners.length; i++) {
      try { orientationListeners[i](detail); } catch (e) { /* ignore */ }
    }
    try {
      window.dispatchEvent(new CustomEvent('metatour-orientation', { detail: detail }));
    } catch (e2) { /* ignore */ }
  };

  window.__onMetaTourGlassesState = function (connected) {
    pushedGlassesConnected = !!connected;
    var info = { mode: detectMode(), glassesConnected: pushedGlassesConnected };
    for (var i = 0; i < modeListeners.length; i++) {
      try { modeListeners[i](info); } catch (e) { /* ignore */ }
    }
    try {
      window.dispatchEvent(new CustomEvent('metatour-glasses-state', { detail: info }));
    } catch (e2) { /* ignore */ }
  };

  function sensorNowMs() {
    try {
      if (window.MetaTourSpatialBridge && typeof window.MetaTourSpatialBridge.nowElapsedRealtimeMs === 'function') {
        var t = Number(window.MetaTourSpatialBridge.nowElapsedRealtimeMs());
        if (Number.isFinite(t) && t >= 0) return t;
      }
    } catch (e) { /* ignore */ }
    return nowMs();
  }

  function getSensorCapabilities() {
    try {
      if (window.MetaTourSpatialBridge && typeof window.MetaTourSpatialBridge.getSensorCapabilitiesJson === 'function') {
        var parsed = safeParseJson(window.MetaTourSpatialBridge.getSensorCapabilitiesJson(), null);
        if (parsed && typeof parsed === 'object') {
          return {
            barometer: !!parsed.barometer,
            gps: !!parsed.gps,
            ble: !!parsed.ble,
            rotationVector: !!parsed.rotationVector
          };
        }
      }
    } catch (e) { /* ignore */ }
    return {
      barometer: false,
      gps: !!(typeof navigator !== 'undefined' && navigator.geolocation),
      ble: false,
      rotationVector: typeof window.DeviceOrientationEvent !== 'undefined'
    };
  }

  function updateNativeBarometerSubscription() {
    var want = baroListeners.length > 0;
    try {
      if (window.MetaTourSpatialBridge && typeof window.MetaTourSpatialBridge.setBarometerActive === 'function') {
        return !!window.MetaTourSpatialBridge.setBarometerActive(want);
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  function updateLocationSubscription() {
    var want = locationListeners.length > 0;
    try {
      if (window.MetaTourSpatialBridge && typeof window.MetaTourSpatialBridge.setLocationActive === 'function') {
        return !!window.MetaTourSpatialBridge.setLocationActive(want);
      }
    } catch (e) { /* ignore */ }

    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      if (want && browserGeoWatchId === null) {
        try {
          browserGeoWatchId = navigator.geolocation.watchPosition(function (pos) {
            var c = pos && pos.coords ? pos.coords : {};
            var monoMs = sensorNowMs();
            window.__onMetaTourLocation({
              lat: Number(c.latitude),
              lon: Number(c.longitude),
              hasAltitude: c.altitude !== null && c.altitude !== undefined && Number.isFinite(Number(c.altitude)),
              alt: (c.altitude !== null && c.altitude !== undefined && Number.isFinite(Number(c.altitude))) ? Number(c.altitude) : null,
              accuracy: Number.isFinite(Number(c.accuracy)) ? Number(c.accuracy) : null,
              verticalAccuracy: Number.isFinite(Number(c.altitudeAccuracy)) ? Number(c.altitudeAccuracy) : null,
              speed: Number.isFinite(Number(c.speed)) ? Number(c.speed) : null,
              bearing: Number.isFinite(Number(c.heading)) ? Number(c.heading) : null,
              provider: 'web-geolocation',
              timestampNs: Math.round(monoMs * 1e6),
              timestampMs: monoMs,
              utcTimeMs: pos && Number.isFinite(Number(pos.timestamp)) ? Number(pos.timestamp) : Date.now()
            });
          }, function () {}, { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 });
          return true;
        } catch (e2) { /* ignore */ }
      } else if (!want && browserGeoWatchId !== null) {
        try { navigator.geolocation.clearWatch(browserGeoWatchId); } catch (e3) { /* ignore */ }
        browserGeoWatchId = null;
      }
    }
    return false;
  }

  function scanBleBaro() {
    try {
      if (window.MetaTourSpatialBridge && typeof window.MetaTourSpatialBridge.startBleBaroScan === 'function') {
        return !!window.MetaTourSpatialBridge.startBleBaroScan();
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  function stopBleBaro() {
    try {
      if (window.MetaTourSpatialBridge && typeof window.MetaTourSpatialBridge.stopBleBaroScan === 'function') {
        window.MetaTourSpatialBridge.stopBleBaroScan();
        return true;
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  window.__onMetaTourBaro = function (sample) {
    if (!sample || typeof sample !== 'object') return;
    var hPa = Number(sample.hPa !== undefined ? sample.hPa : sample.pressureHpa);
    if (!Number.isFinite(hPa) || hPa <= 0) return;
    var tsMs = Number.isFinite(Number(sample.timestampMs)) ? Number(sample.timestampMs) : sensorNowMs();
    var tsNs = Number.isFinite(Number(sample.timestampNs)) ? Number(sample.timestampNs) : Math.round(tsMs * 1e6);
    var ev = {
      hPa: hPa,
      pressureHpa: hPa,
      pressurePa: Number.isFinite(Number(sample.pressurePa)) ? Number(sample.pressurePa) : hPa * 100,
      accuracy: Number.isFinite(Number(sample.accuracy)) ? Number(sample.accuracy) : 0,
      timestampNs: tsNs,
      timestampMs: tsMs
    };
    for (var i = 0; i < baroListeners.length; i++) {
      try { baroListeners[i](ev); } catch (e) { /* ignore */ }
    }
    try {
      window.dispatchEvent(new CustomEvent('metatour-sensor-baro', { detail: ev }));
    } catch (e2) { /* ignore */ }
  };

  window.__onMetaTourLocation = function (loc) {
    if (!loc || typeof loc !== 'object') return;
    var lat = Number(loc.lat);
    var lon = Number(loc.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    var tsMs = Number.isFinite(Number(loc.timestampMs)) ? Number(loc.timestampMs) : sensorNowMs();
    var tsNs = Number.isFinite(Number(loc.timestampNs)) ? Number(loc.timestampNs) : Math.round(tsMs * 1e6);
    var hasAlt = loc.alt !== null && loc.alt !== undefined && Number.isFinite(Number(loc.alt));
    var ev = {
      lat: lat,
      lon: lon,
      alt: hasAlt ? Number(loc.alt) : null,
      hasAltitude: !!loc.hasAltitude && hasAlt,
      accuracy: (loc.accuracy !== null && loc.accuracy !== undefined && Number.isFinite(Number(loc.accuracy))) ? Number(loc.accuracy) : null,
      verticalAccuracy: (loc.verticalAccuracy !== null && loc.verticalAccuracy !== undefined && Number.isFinite(Number(loc.verticalAccuracy))) ? Number(loc.verticalAccuracy) : null,
      speed: (loc.speed !== null && loc.speed !== undefined && Number.isFinite(Number(loc.speed))) ? Number(loc.speed) : null,
      bearing: (loc.bearing !== null && loc.bearing !== undefined && Number.isFinite(Number(loc.bearing))) ? Number(loc.bearing) : null,
      provider: typeof loc.provider === 'string' ? loc.provider : 'gps',
      timestampNs: tsNs,
      timestampMs: tsMs,
      utcTimeMs: Number.isFinite(Number(loc.utcTimeMs)) ? Number(loc.utcTimeMs) : Date.now()
    };
    for (var i = 0; i < locationListeners.length; i++) {
      try { locationListeners[i](ev); } catch (e) { /* ignore */ }
    }
    try {
      window.dispatchEvent(new CustomEvent('metatour-sensor-location', { detail: ev }));
    } catch (e2) { /* ignore */ }
  };

  window.__onMetaTourBleBaro = function (pkt) {
    if (!pkt || typeof pkt !== 'object') return;
    var pa = Number(pkt.pressurePa);
    if (!Number.isFinite(pa) || pa <= 0) return;
    var hPa = Number.isFinite(Number(pkt.pressureHpa)) ? Number(pkt.pressureHpa) : (pa / 100);
    var tsMs = Number.isFinite(Number(pkt.timestampMs)) ? Number(pkt.timestampMs) : sensorNowMs();
    var tsNs = Number.isFinite(Number(pkt.timestampNs)) ? Number(pkt.timestampNs) : Math.round(tsMs * 1e6);
    var ev = {
      mac: typeof pkt.mac === 'string' ? pkt.mac : '00:00:00:00:00:00',
      name: typeof pkt.name === 'string' ? pkt.name : 'RuuviTag',
      rssi: Number.isFinite(Number(pkt.rssi)) ? Number(pkt.rssi) : 0,
      pressurePa: pa,
      pressureHpa: hPa,
      hPa: hPa,
      temperatureC: (pkt.temperatureC !== null && pkt.temperatureC !== undefined && Number.isFinite(Number(pkt.temperatureC))) ? Number(pkt.temperatureC) : null,
      humidityPct: (pkt.humidityPct !== null && pkt.humidityPct !== undefined && Number.isFinite(Number(pkt.humidityPct))) ? Number(pkt.humidityPct) : null,
      accelXg: (pkt.accelXg !== null && pkt.accelXg !== undefined && Number.isFinite(Number(pkt.accelXg))) ? Number(pkt.accelXg) : null,
      accelYg: (pkt.accelYg !== null && pkt.accelYg !== undefined && Number.isFinite(Number(pkt.accelYg))) ? Number(pkt.accelYg) : null,
      accelZg: (pkt.accelZg !== null && pkt.accelZg !== undefined && Number.isFinite(Number(pkt.accelZg))) ? Number(pkt.accelZg) : null,
      batteryMv: (pkt.batteryMv !== null && pkt.batteryMv !== undefined && Number.isFinite(Number(pkt.batteryMv))) ? Number(pkt.batteryMv) : null,
      txPowerDbm: (pkt.txPowerDbm !== null && pkt.txPowerDbm !== undefined && Number.isFinite(Number(pkt.txPowerDbm))) ? Number(pkt.txPowerDbm) : null,
      movementCounter: (pkt.movementCounter !== null && pkt.movementCounter !== undefined && Number.isFinite(Number(pkt.movementCounter))) ? Number(pkt.movementCounter) : null,
      sequence: (pkt.sequence !== null && pkt.sequence !== undefined && Number.isFinite(Number(pkt.sequence))) ? Number(pkt.sequence) : null,
      timestampNs: tsNs,
      timestampMs: tsMs
    };
    for (var i = 0; i < bleBaroListeners.length; i++) {
      try { bleBaroListeners[i](ev); } catch (e) { /* ignore */ }
    }
    try {
      window.dispatchEvent(new CustomEvent('metatour-sensor-ble-baro', { detail: ev }));
    } catch (e2) { /* ignore */ }
  };

  window.__onMetaTourSensorStatus = function (st) {
    if (!st || typeof st !== 'object') return;
    for (var i = 0; i < sensorStatusListeners.length; i++) {
      try { sensorStatusListeners[i](st); } catch (e) { /* ignore */ }
    }
    try {
      window.dispatchEvent(new CustomEvent('metatour-sensor-status', { detail: st }));
    } catch (e2) { /* ignore */ }
  };

  var sensorsApi = {
    getSensorCapabilities: getSensorCapabilities,
    now: sensorNowMs,
    onBaro: function (fn) {
      if (typeof fn === 'function') {
        baroListeners.push(fn);
        updateNativeBarometerSubscription();
      }
      return function () {
        var idx = baroListeners.indexOf(fn);
        if (idx >= 0) {
          baroListeners.splice(idx, 1);
          updateNativeBarometerSubscription();
        }
      };
    },
    onLocation: function (fn) {
      if (typeof fn === 'function') {
        locationListeners.push(fn);
        updateLocationSubscription();
      }
      return function () {
        var idx = locationListeners.indexOf(fn);
        if (idx >= 0) {
          locationListeners.splice(idx, 1);
          updateLocationSubscription();
        }
      };
    },
    scanBleBaro: scanBleBaro,
    stopBleBaro: stopBleBaro,
    onBleBaro: function (fn) {
      if (typeof fn === 'function') bleBaroListeners.push(fn);
      return function () {
        var idx = bleBaroListeners.indexOf(fn);
        if (idx >= 0) bleBaroListeners.splice(idx, 1);
      };
    },
    onStatus: function (fn) {
      if (typeof fn === 'function') sensorStatusListeners.push(fn);
      return function () {
        var idx = sensorStatusListeners.indexOf(fn);
        if (idx >= 0) sensorStatusListeners.splice(idx, 1);
      };
    }
  };

  // Transparently bridge standard screen.orientation.lock()/unlock() inside the handheld WebView container
  if (detectMode() === 'handheld' && window.screen && window.screen.orientation) {
    try {
      var origLock = window.screen.orientation.lock
        ? window.screen.orientation.lock.bind(window.screen.orientation)
        : null;
      window.screen.orientation.lock = function (orientationType) {
        if (setPreferredOrientation(String(orientationType || 'auto'))) {
          return Promise.resolve();
        }
        return origLock ? origLock(orientationType) : Promise.reject(new Error('Unsupported orientation'));
      };
      var origUnlock = window.screen.orientation.unlock
        ? window.screen.orientation.unlock.bind(window.screen.orientation)
        : null;
      window.screen.orientation.unlock = function () {
        setPreferredOrientation('auto');
        if (origUnlock) {
          try { origUnlock(); } catch (_) {}
        }
      };
    } catch (_) {
      // Ignore read-only property on restricted WebView implementations
    }
  }

  function setSimProfile(nextProfile) {
    var allowed = ['real', 'glasses-6dof', 'glasses-3dof', 'handheld', 'browser'];
    var norm = typeof nextProfile === 'string' ? nextProfile.trim().toLowerCase() : 'real';
    if (allowed.indexOf(norm) < 0) {
      return { ok: false, reason: 'invalid_profile' };
    }
    simProfile = norm;
    var caps = getCapabilities();
    if (norm === 'glasses-3dof' || norm === 'handheld' || norm === 'browser') {
      if (handRuntime.active) {
        handRuntime.active = false;
      }
      if (typeof window.__setMetaTourHandSupported === 'function') {
        try { window.__setMetaTourHandSupported(false); } catch (_) {}
      }
      if (typeof window.__updateMetaTourHand === 'function') {
        try { window.__updateMetaTourHand(false, true, 0, 0, 0, 0, 0, 0, 1); } catch (_) {}
      }
    } else if (norm === 'glasses-6dof') {
      if (typeof window.__setMetaTourHandSupported === 'function') {
        try { window.__setMetaTourHandSupported(true); } catch (_) {}
      }
    }
    recordBridgeEvent('档位', '切换模拟环境 -> ' + norm + ' (' + caps.deviceModel + ')');
    var modeInfo = { mode: detectMode(), glassesConnected: isGlassesConnected(), simulated: norm !== 'real', simProfile: norm };
    for (var i = 0; i < modeListeners.length; i++) {
      try { modeListeners[i](modeInfo); } catch (_) {}
    }
    try {
      window.dispatchEvent(new CustomEvent('metatour-glasses-state', { detail: modeInfo }));
    } catch (_) {}
    notifyInputStateListeners();
    return { ok: true, profile: norm, capabilities: caps };
  }

  function simulateInput(action) {
    if (!action || typeof action !== 'object') {
      return { ok: false, reason: 'invalid_action' };
    }
    var kind = String(action.kind || '').trim().toLowerCase();
    if (kind === 'profile') {
      return setSimProfile(action.profile);
    }
    if (kind === 'hand-active') {
      var isAct = !!action.active;
      var handSide = action.handedness === 'left' ? 'left' : 'right';
      if (isAct && simProfile === 'real' && detectRawMode() === 'browser') {
        setSimProfile('glasses-6dof');
      }
      if (typeof window.__updateMetaTourHand === 'function') {
        try {
          window.__updateMetaTourHand(isAct, handSide === 'right', 0.16, -0.10, -0.38, 0, 0, 0, 1);
        } catch (_) {}
      }
      window.__onMetaTourHandActiveChange(isAct, handSide);
      return { ok: true, handActive: handRuntime.active, handedness: handRuntime.handedness };
    }
    if (kind === 'hand-gesture') {
      var gType = String(action.type || '').trim();
      if (!gType) return { ok: false, reason: 'missing_gesture_type' };
      var rightHand = action.handedness === 'left' ? false : true;
      var dir = typeof action.direction === 'string' ? action.direction : null;
      var cw = action.clockwise !== undefined ? !!action.clockwise : true;
      var spd = Number.isFinite(Number(action.speed)) ? Number(action.speed) : (gType === 'slash' ? 1.85 : (gType === 'thrust' ? 1.45 : 0));
      if (action.autoHandActive !== false && !handRuntime.active && (simProfile === 'glasses-6dof' || detectRawMode() === 'browser')) {
        if (simProfile === 'real' && detectRawMode() === 'browser') {
          setSimProfile('glasses-6dof');
        }
        window.__onMetaTourHandActiveChange(true, rightHand ? 'right' : 'left');
      }
      if (gType === 'pinch' && typeof window.__metaTourHandButton === 'function') {
        try {
          window.__metaTourHandButton('select', true);
          window.__metaTourHandButton('select', false);
        } catch (_) {}
      } else if (gType === 'palm-hold') {
        if (typeof window.__metaTourHandButton === 'function') {
          try { window.__metaTourHandButton('squeeze', true); } catch (_) {}
        }
        window.__onMetaTourSqueezeChange(true, 'hand');
      } else if (gType === 'palm-release') {
        if (typeof window.__metaTourHandButton === 'function') {
          try { window.__metaTourHandButton('squeeze', false); } catch (_) {}
        }
        window.__onMetaTourSqueezeChange(false, 'hand');
      }
      window.__onMetaTourHandGesture(gType, dir, cw, spd, rightHand, Date.now());
      return { ok: true, type: gType };
    }
    if (kind === 'trackpad-gesture') {
      var tpType = String(action.type || '').trim();
      if (!tpType) return { ok: false, reason: 'missing_trackpad_gesture' };
      var dx = Number.isFinite(Number(action.dx)) ? Number(action.dx) : 0;
      var dy = Number.isFinite(Number(action.dy)) ? Number(action.dy) : 0;
      if (tpType === 'tap' && typeof window.xrealControllerButton === 'function') {
        try {
          window.xrealControllerButton('select', true);
          window.xrealControllerButton('select', false);
        } catch (_) {}
      }
      window.__onMetaTourTrackpadGesture(tpType, dx, dy, Date.now());
      return { ok: true, type: tpType };
    }
    if (kind === 'trackpad-move') {
      var activeMove = action.active !== undefined ? !!action.active : true;
      var mx = action.x !== undefined ? Number(action.x) : (action.strafe !== undefined ? Number(action.strafe) : 0);
      var my = action.y !== undefined ? Number(action.y) : (action.forward !== undefined ? -Number(action.forward) : 0);
      window.__onMetaTourTrackpadMove(mx, my, activeMove);
      return { ok: true, axes: { x: moveAxes.x, y: moveAxes.y, forward: activeMove ? cleanZero(-moveAxes.y) : 0, strafe: activeMove ? cleanZero(moveAxes.x) : 0, active: moveAxes.active } };
    }
    if (kind === 'squeeze') {
      var sqDown = action.active !== undefined ? !!action.active : !!action.down;
      var sqSrc = action.source === 'hand' ? 'hand' : 'trackpad';
      if (sqSrc === 'hand' && typeof window.__metaTourHandButton === 'function') {
        try { window.__metaTourHandButton('squeeze', sqDown); } catch (_) {}
      } else if (typeof window.xrealControllerButton === 'function') {
        try { window.xrealControllerButton('squeeze', sqDown); } catch (_) {}
      }
      window.__onMetaTourSqueezeChange(sqDown, sqSrc);
      return { ok: true, active: squeezeState.active };
    }
    if (kind === 'gaze-target') {
      var tid = action.targetId !== undefined ? action.targetId : null;
      setReticleTarget(tid);
      if (tid && action.instantSelect) {
        var effDwell = resolveEffectiveDwellMs() || 2000;
        gazeState.firedForTarget = true;
        gazeState.lastTriggerMs = nowMs();
        recordBridgeEvent('注视', 'gazeSelect (模拟即刻完成) -> ' + tid);
        emitGazeProgress(String(tid), 1, effDwell, true);
        if (typeof window.__triggerMetaTourGazeSelect === 'function') {
          try { window.__triggerMetaTourGazeSelect(); } catch (_) {}
        }
        var selObj = { targetId: String(tid), dwellMs: effDwell, timestamp: Date.now(), simulated: true };
        for (var gi = 0; gi < gazeSelectListeners.length; gi++) {
          try { gazeSelectListeners[gi](selObj); } catch (_) {}
        }
        try {
          window.dispatchEvent(new CustomEvent('metatour-gaze-select', { detail: selObj }));
        } catch (_) {}
      }
      return { ok: true, targetId: gazeState.targetId };
    }
    if (kind === 'view-reset') {
      var rDetail = resetView();
      return { ok: true, detail: rDetail };
    }
    return { ok: false, reason: 'unknown_action_kind' };
  }

  function getDiagnostics() {
    var contracts = {
      handGesture: handGestureListeners.length > 0 || domSubscribed.handGesture,
      trackpadGesture: trackpadGestureListeners.length > 0 || dodgeListeners.length > 0 || domSubscribed.trackpadGesture,
      trackpadMove: trackpadMoveListeners.length > 0 || domSubscribed.trackpadMove,
      gazeDwell: gazeProgressListeners.length > 0 || gazeSelectListeners.length > 0 || domSubscribed.gaze,
      viewReset: viewResetListeners.length > 0 || domSubscribed.viewReset
    };
    var warnings = [];
    if (!contracts.viewReset) {
      warnings.push('未检测到 onViewReset / metatour-view-reset 监听，按重置按钮可能无法归零业务偏移');
    }
    if (contracts.handGesture && !contracts.trackpadGesture) {
      warnings.push('已接入隔空手势但未监听 onTrackpadGesture，右手放下或无手势眼镜时将缺少点按普攻/快滑闪避兜底');
    }
    return {
      version: '1.5.6',
      mode: detectMode(),
      rawMode: detectRawMode(),
      simProfile: simProfile,
      devToolsOpen: !!devToolsState.open,
      guideOpen: !!guideState.open,
      contracts: contracts,
      warnings: warnings,
      inputState: getInputState(),
      events: devEventLog.slice()
    };
  }

  // ---------------------------------------------------------------------------
  // Reusable Onboarding Spatial Interaction Guide (v1.5.6)
  // Native <dialog closedby="any"> in 2D; dual-eye SBS or 3D state sync in Glasses.
  // Built strictly via createElement / textContent / replaceChildren (zero innerHTML).
  // ---------------------------------------------------------------------------
  var DEFAULT_GUIDE_ITEMS = [
    { key: '① 抬手前左右滑 (S24)', desc: '水车旋斩（抬右手至前方左-右-左连挥，下方自然垂手防误触）' },
    { key: '② 右手向前出拳 / 出指 (S24)', desc: '突刺冲锋（朝正前方快速推出）' },
    { key: '③ 右手手掌 ✋ 竖起朝前 (S24)', desc: '持续格挡架盾（放手收盾；手机双指按住亦可格挡）' },
    { key: '④ 抬手握拳保持 2 秒 (S24)', desc: '前方巨型读圈蓄满 2 秒释放必杀大招（70% 激活区时间占比防误触）' },
    { key: '⑤ 轻点盲操板', desc: '普通攻击 / 菜单确认（无需低头找按键）' },
    { key: '⑥ 盲操板快速左/右滑', desc: '左闪 / 右闪（<=200ms 快速横拂触发闪避，与推盘走位零串扰）' },
    { key: '⑦ 按住盲操板推 (>200ms)', desc: '持续平滑走位（上推前进、下拉后退、左右横移）' },
    { key: '⑧ 免晃动手机 / Beam Pro', desc: '机身陀螺仪射线已彻底关闭，握持移动机身零干扰' }
  ];

  var GUIDE_CSS = [
    'dialog.mt-guide-dialog { border: 1px solid rgba(244, 194, 106, 0.55); border-radius: 18px; padding: 0; background: rgba(11, 22, 35, 0.96); color: #f8fafc; width: min(580px, calc(100vw - 24px)); max-height: calc(100dvh - 28px); box-shadow: 0 24px 56px rgba(0, 0, 0, 0.65); font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", sans-serif; }',
    'dialog.mt-guide-dialog[open] { display: flex; flex-direction: column; overflow: hidden; }',
    'dialog.mt-guide-dialog:modal { overscroll-behavior: contain; }',
    'dialog.mt-guide-dialog::backdrop { background: rgba(2, 6, 23, 0.68); backdrop-filter: blur(6px); overflow: hidden; overscroll-behavior: contain; }',
    '.mt-guide-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 18px 12px; border-bottom: 1px solid rgba(148, 163, 184, 0.22); background: rgba(15, 23, 42, 0.92); }',
    '.mt-guide-title { margin: 0; font-size: 17px; font-weight: 800; color: #f4c26a; line-height: 1.3; }',
    '.mt-guide-skip-btn { appearance: none; min-height: 44px; min-width: 96px; padding: 8px 16px; border-radius: 999px; border: 1px solid rgba(255, 232, 185, 0.85); background: linear-gradient(135deg, #f4c26a 0%, #e59934 100%); color: #0f172a; font-size: 13.5px; font-weight: 800; cursor: pointer; flex-shrink: 0; }',
    '.mt-guide-skip-btn:hover { filter: brightness(1.06); }',
    '.mt-guide-skip-btn:focus-visible { outline: 3px solid #38bdf8; outline-offset: 3px; }',
    '.mt-guide-body { padding: 12px 18px 14px; overflow-y: auto; overscroll-behavior: contain; touch-action: pan-y; display: flex; flex-direction: column; gap: 8px; }',
    '.mt-guide-anim { width: 100%; height: 112px; border-radius: 12px; border: 1px solid rgba(56, 189, 248, 0.38); background: rgba(6, 14, 24, 0.92); display: block; }',
    '.mt-guide-sub { margin: 0 0 2px; font-size: 12.5px; color: #cbd5e1; line-height: 1.45; }',
    '.mt-guide-list { margin: 0; padding: 0; list-style: none; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }',
    '.mt-guide-item { background: rgba(30, 41, 59, 0.72); border: 1px solid rgba(148, 163, 184, 0.22); border-radius: 10px; padding: 8px 10px; }',
    '.mt-guide-k { display: block; font-size: 12.5px; font-weight: 700; color: #38bdf8; margin-bottom: 2px; }',
    '.mt-guide-v { display: block; font-size: 11.5px; color: #e2e8f0; line-height: 1.35; }',
    '.mt-guide-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 18px 14px; border-top: 1px solid rgba(148, 163, 184, 0.18); font-size: 11.5px; color: #94a3b8; }',
    '.mt-sbs-guide-host { position: fixed; inset: 0; z-index: 2147483635; display: grid; grid-template-columns: 1fr 1fr; align-items: center; justify-items: center; background: rgba(0, 0, 0, 0.55); font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif; }',
    '.mt-sbs-card { width: min(82%, 520px); background: rgba(11, 22, 35, 0.95); border: 2px solid rgba(244, 194, 106, 0.65); border-radius: 18px; padding: 16px 18px; color: #f8fafc; display: flex; flex-direction: column; gap: 10px; }',
    '@media (max-width: 600px) { .mt-guide-list { grid-template-columns: minmax(0, 1fr); } .mt-guide-head { padding: 12px 14px 10px; } .mt-guide-body { padding: 12px 14px; } .mt-guide-foot { padding: 10px 14px 12px; } }'
  ].join('\n');

  function ensureGuideStyles(doc) {
    if (guideState.styleEl && guideState.styleEl.parentNode) return;
    var st = doc.createElement('style');
    st.id = 'metatour-guide-styles';
    st.textContent = GUIDE_CSS;
    (doc.head || doc.documentElement).appendChild(st);
    guideState.styleEl = st;
  }

  function notifyGuideListeners(open, reason) {
    var detail = { open: !!open, reason: reason || null, timestamp: Date.now() };
    for (var i = 0; i < guideListeners.length; i++) {
      try { guideListeners[i](detail); } catch (_) {}
    }
    try {
      window.dispatchEvent(new CustomEvent('metatour-guide-change', { detail: detail }));
    } catch (_) {}
  }

  function buildGuideCardContent(doc, opts, titleId, isAriaClone) {
    var frag = doc.createDocumentFragment();
    var head = makeEl(doc, 'div', 'mt-guide-head');
    var h2 = makeEl(doc, 'h2', 'mt-guide-title', (opts && opts.title) || 'AR 空间操作说明');
    if (titleId && !isAriaClone) h2.id = titleId;
    var skipBtn = makeBtn(doc, (opts && opts.skipLabel) || '跳过说明 →', function () {
      dismissInteractionGuide('skip-button');
    }, 'mt-guide-skip-btn');
    if (!isAriaClone) {
      skipBtn.setAttribute('autofocus', '');
    } else {
      skipBtn.tabIndex = -1;
    }
    head.appendChild(h2);
    head.appendChild(skipBtn);
    frag.appendChild(head);

    var body = makeEl(doc, 'div', 'mt-guide-body');
    var subText = (opts && opts.subtitle) || '视线看向哪个目标即自动软锁定；随时轻点手机盲操板、隔空捏合或点击右上角「跳过说明」即可直接开始：';
    body.appendChild(makeEl(doc, 'p', 'mt-guide-sub', subText));

    var ul = makeEl(doc, 'ul', 'mt-guide-list');
    ul.setAttribute('role', 'list');
    var items = (opts && Array.isArray(opts.items) && opts.items.length > 0) ? opts.items : DEFAULT_GUIDE_ITEMS;
    for (var i = 0; i < items.length; i++) {
      var it = items[i] || {};
      var li = makeEl(doc, 'li', 'mt-guide-item');
      li.appendChild(makeEl(doc, 'span', 'mt-guide-k', String(it.key || '')));
      li.appendChild(makeEl(doc, 'span', 'mt-guide-v', String(it.desc || '')));
      ul.appendChild(li);
    }
    body.appendChild(ul);
    frag.appendChild(body);

    var foot = makeEl(doc, 'div', 'mt-guide-foot');
    foot.appendChild(makeEl(doc, 'span', '', '支持盲操轻点 / 隔空捏合 / Esc 键随时跳过'));
    frag.appendChild(foot);
    return { fragment: frag, skipBtn: skipBtn };
  }

  function dismissInteractionGuide(reason) {
    var wasOpen = guideState.open;
    guideState.open = false;
    var cb = guideState.onClose;
    guideState.onClose = null;

    if (guideState.dialogEl) {
      var dlg = guideState.dialogEl;
      guideState.dialogEl = null;
      try {
        if (dlg.open && typeof dlg.close === 'function') dlg.close();
      } catch (_) {}
      try {
        if (dlg.parentNode) dlg.parentNode.removeChild(dlg);
      } catch (_) {}
    }

    if (guideState.stereoHost) {
      var sh = guideState.stereoHost;
      guideState.stereoHost = null;
      try {
        if (sh.parentNode) sh.parentNode.removeChild(sh);
      } catch (_) {}
    }

    if (guideState.prevInertSiblings.length > 0) {
      for (var i = 0; i < guideState.prevInertSiblings.length; i++) {
        try { guideState.prevInertSiblings[i].inert = false; } catch (_) {}
      }
      guideState.prevInertSiblings = [];
    }

    if (wasOpen) {
      recordBridgeEvent('引导', '关闭操作说明 (' + (reason || 'dismiss') + ')');
      if (typeof cb === 'function') {
        try { cb(reason || 'dismiss'); } catch (_) {}
      }
      notifyGuideListeners(false, reason || 'dismiss');
    }
    return wasOpen;
  }

  function showInteractionGuide(opts) {
    opts = opts || {};
    dismissInteractionGuide('reopen');

    guideState.open = true;
    guideState.skipOnTap = opts.skipOnTap !== false;
    guideState.onClose = typeof opts.onClose === 'function' ? opts.onClose : null;
    recordBridgeEvent('引导', '展示开场空间操作说明');

    var isRawGlasses = detectRawMode() === 'glasses' || opts.stereo === true;
    if (isRawGlasses && opts.domInGlasses === false) {
      notifyGuideListeners(true, 'open-3d');
      return true;
    }

    if (!window.document || !window.document.body) {
      notifyGuideListeners(true, 'open-headless');
      return true;
    }

    var doc = window.document;
    ensureGuideStyles(doc);

    if (isRawGlasses) {
      // Custom dual-eye SBS overlay so neither eye crosses the 50% stereo seam
      var host = makeEl(doc, 'div', 'mt-sbs-guide-host');
      var leftCard = makeEl(doc, 'div', 'mt-sbs-card');
      leftCard.setAttribute('role', 'dialog');
      leftCard.setAttribute('aria-labelledby', 'mt-sbs-guide-title');
      var leftBuilt = buildGuideCardContent(doc, opts, 'mt-sbs-guide-title', false);
      leftCard.appendChild(leftBuilt.fragment);

      var rightCard = makeEl(doc, 'div', 'mt-sbs-card');
      rightCard.setAttribute('aria-hidden', 'true');
      var rightBuilt = buildGuideCardContent(doc, opts, '', true);
      rightCard.appendChild(rightBuilt.fragment);

      host.appendChild(leftCard);
      host.appendChild(rightCard);

      var kids = doc.body.children;
      guideState.prevInertSiblings = [];
      for (var k = 0; k < kids.length; k++) {
        var child = kids[k];
        if (child && child.id !== 'metatour-webar-devtools-host' && !child.inert) {
          try {
            child.inert = true;
            guideState.prevInertSiblings.push(child);
          } catch (_) {}
        }
      }
      doc.body.appendChild(host);
      guideState.stereoHost = host;
      try { leftBuilt.skipBtn.focus(); } catch (_) {}
      notifyGuideListeners(true, 'open-sbs');
      return true;
    }

    // Standard 2D mode: native <dialog closedby="any"> opened via showModal()
    var dlg = doc.createElement('dialog');
    dlg.className = 'mt-guide-dialog';
    dlg.setAttribute('closedby', 'any');
    dlg.setAttribute('aria-labelledby', 'mt-guide-dialog-title');
    var built = buildGuideCardContent(doc, opts, 'mt-guide-dialog-title', false);
    dlg.appendChild(built.fragment);

    dlg.addEventListener('close', function () {
      dlg.returnValue = '';
      if (guideState.open && guideState.dialogEl === dlg) {
        dismissInteractionGuide('dialog-close');
      }
    });

    if (typeof HTMLDialogElement !== 'undefined' && !('closedBy' in HTMLDialogElement.prototype)) {
      var outside = function (e) {
        var r = dlg.getBoundingClientRect();
        return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
      };
      var pressedOutside = false;
      dlg.addEventListener('pointerdown', function (e) { pressedOutside = outside(e); });
      dlg.addEventListener('pointerup', function (e) {
        if (pressedOutside && outside(e)) dismissInteractionGuide('backdrop');
      });
    }

    doc.body.appendChild(dlg);
    guideState.dialogEl = dlg;
    if (typeof dlg.showModal === 'function') {
      try {
        dlg.showModal();
      } catch (_) {
        dlg.setAttribute('open', '');
      }
    } else {
      dlg.setAttribute('open', '');
    }
    try { built.skipBtn.focus(); } catch (_) {}
    notifyGuideListeners(true, 'open-modal');
    return true;
  }

  function isInteractionGuideOpen() {
    return !!guideState.open;
  }

  // ---------------------------------------------------------------------------
  // Zero-dependency Shadow DOM Spatial Interaction DevTools (v1.5.5)
  // Built strictly via createElement / textContent (zero innerHTML).
  // ---------------------------------------------------------------------------
  var sharedDevSheet = null;
  var devToolsState = {
    open: false,
    collapsed: false,
    host: null,
    palmHeld: false,
    fistChargeTimer: 0,
    fistChargeStartMs: 0,
    liveTimer: 0,
    lastPoliteText: ''
  };

  var DEVTOOLS_CSS = [
    ':host { all: initial; position: fixed; top: 12px; right: 12px; z-index: 2147483640; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", sans-serif; color: #f1f5f9; }',
    '*, *::before, *::after { box-sizing: border-box; }',
    '.mt-panel { width: 344px; max-width: calc(100vw - 24px); max-height: calc(100vh - 24px); display: flex; flex-direction: column; background: rgba(11, 18, 32, 0.94); border: 1px solid rgba(56, 189, 248, 0.42); border-radius: 14px; box-shadow: 0 18px 42px rgba(0, 0, 0, 0.55); backdrop-filter: blur(14px); overflow: hidden; }',
    '.mt-panel[data-collapsed="true"] { width: auto; }',
    '.mt-panel[data-collapsed="true"] .mt-body { display: none; }',
    '.mt-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px; background: rgba(15, 23, 42, 0.95); border-bottom: 1px solid rgba(148, 163, 184, 0.18); }',
    '.mt-panel[data-collapsed="true"] .mt-head { border-bottom: none; }',
    '.mt-title { font-size: 13px; font-weight: 700; color: #38bdf8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
    '.mt-head-btns { display: flex; gap: 6px; flex-shrink: 0; }',
    '.mt-body { padding: 10px; overflow-y: auto; overscroll-behavior: contain; touch-action: pan-y; display: flex; flex-direction: column; gap: 9px; }',
    '.mt-sec-label { font-size: 11px; font-weight: 600; color: #94a3b8; letter-spacing: 0.02em; margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center; }',
    '.mt-grid-4 { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 5px; }',
    '.mt-grid-3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 5px; }',
    '.mt-grid-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }',
    'button { appearance: none; border: 1px solid rgba(148, 163, 184, 0.28); background: rgba(30, 41, 59, 0.88); color: #e2e8f0; border-radius: 8px; font-size: 11.5px; font-weight: 600; padding: 6px 6px; min-height: 36px; cursor: pointer; transition: background 0.14s, border-color 0.14s, transform 0.08s; line-height: 1.2; text-align: center; }',
    'button:hover { background: rgba(51, 65, 85, 0.95); border-color: rgba(56, 189, 248, 0.55); }',
    'button:active { transform: scale(0.97); }',
    'button:focus-visible { outline: 2px solid #38bdf8; outline-offset: 2px; }',
    'button[aria-pressed="true"], button[data-active="true"] { background: rgba(14, 116, 144, 0.65); border-color: #38bdf8; color: #ffffff; }',
    'button.mt-warn[aria-pressed="true"] { background: rgba(180, 83, 9, 0.72); border-color: #fbbf24; color: #fffbeb; }',
    '.mt-icon-btn { min-width: 36px; min-height: 34px; padding: 4px 8px; font-size: 11px; }',
    '.mt-pad-row { display: grid; grid-template-columns: 124px minmax(0, 1fr); gap: 8px; align-items: stretch; }',
    '.mt-pad-box { --thumb-x: 0px; --thumb-y: 0px; position: relative; width: 124px; height: 124px; border-radius: 12px; background: radial-gradient(circle at center, rgba(30, 41, 59, 0.95) 0%, rgba(15, 23, 42, 0.98) 100%); border: 1px solid rgba(56, 189, 248, 0.4); touch-action: none; user-select: none; cursor: crosshair; overflow: hidden; }',
    '.mt-pad-cross-h, .mt-pad-cross-v { position: absolute; background: rgba(148, 163, 184, 0.16); pointer-events: none; }',
    '.mt-pad-cross-h { left: 10px; right: 10px; top: 50%; height: 1px; }',
    '.mt-pad-cross-v { top: 10px; bottom: 10px; left: 50%; width: 1px; }',
    '.mt-pad-thumb { position: absolute; left: 50%; top: 50%; width: 24px; height: 24px; margin-left: -12px; margin-top: -12px; border-radius: 50%; background: rgba(56, 189, 248, 0.85); border: 2px solid #e0f2fe; box-shadow: 0 0 12px rgba(56, 189, 248, 0.65); transform: translate(var(--thumb-x), var(--thumb-y)); pointer-events: none; }',
    '.mt-pad-hint { position: absolute; bottom: 4px; left: 0; right: 0; text-align: center; font-size: 9.5px; color: #94a3b8; pointer-events: none; }',
    '.mt-pad-side { display: flex; flex-direction: column; justify-content: space-between; gap: 5px; }',
    '.mt-readout { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10.5px; color: #cbd5e1; background: rgba(2, 6, 23, 0.68); border: 1px solid rgba(148, 163, 184, 0.18); border-radius: 8px; padding: 6px 7px; line-height: 1.38; }',
    '.mt-gaze-bar { height: 6px; border-radius: 999px; background: rgba(30, 41, 59, 0.9); overflow: hidden; margin-top: 4px; }',
    '.mt-gaze-fill { --gaze-pct: 0%; height: 100%; width: var(--gaze-pct); background: linear-gradient(90deg, #38bdf8, #34d399); transition: width 0.06s linear; }',
    '.mt-badges { display: flex; flex-wrap: wrap; gap: 4px; }',
    '.mt-badge { font-size: 10px; padding: 2px 6px; border-radius: 999px; border: 1px solid rgba(148, 163, 184, 0.25); color: #94a3b8; background: rgba(15, 23, 42, 0.8); }',
    '.mt-badge[data-ok="true"] { color: #6ee7b7; border-color: rgba(52, 211, 153, 0.45); background: rgba(6, 78, 59, 0.45); }',
    '.mt-log { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; line-height: 1.42; color: #cbd5e1; background: rgba(2, 6, 23, 0.82); border: 1px solid rgba(148, 163, 184, 0.18); border-radius: 8px; padding: 6px 8px; max-height: 98px; overflow-y: auto; white-space: pre-wrap; word-break: break-word; }',
    '.mt-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }',
    '@media (max-width: 600px) {',
    '  :host { top: auto; bottom: 8px; right: 8px; left: 8px; }',
    '  .mt-panel { width: 100%; max-width: 100%; max-height: 62vh; }',
    '  .mt-panel[data-collapsed="true"] { width: auto; margin-left: auto; }',
    '  button { min-height: 44px; font-size: 11px; }',
    '  .mt-icon-btn { min-width: 44px; min-height: 44px; }',
    '}'
  ].join('\n');

  function makeEl(doc, tag, className, text) {
    var el = doc.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined && text !== null) el.textContent = String(text);
    return el;
  }

  function makeBtn(doc, label, onClick, className) {
    var btn = makeEl(doc, 'button', className || '', label);
    btn.type = 'button';
    if (typeof onClick === 'function') {
      btn.addEventListener('click', onClick);
    }
    return btn;
  }

  function openDevTools(opts) {
    if (!window.document || !window.document.body || typeof window.document.createElement !== 'function') {
      return false;
    }
    if (devToolsState.open && devToolsState.host) {
      if (opts && typeof opts.collapsed === 'boolean') {
        devToolsState.collapsed = opts.collapsed;
      } else {
        devToolsState.collapsed = false;
      }
      if (typeof devUiRefreshHook === 'function') devUiRefreshHook();
      return true;
    }

    var doc = window.document;
    var host = doc.createElement('div');
    host.id = 'metatour-webar-devtools-host';
    var root = host;
    if (typeof host.attachShadow === 'function') {
      root = host.attachShadow({ mode: 'open', delegatesFocus: true });
      var appliedConstructable = false;
      try {
        if (typeof window.CSSStyleSheet === 'function' && 'adoptedStyleSheets' in root) {
          if (!sharedDevSheet) {
            sharedDevSheet = new window.CSSStyleSheet();
            if (typeof sharedDevSheet.replaceSync === 'function') {
              sharedDevSheet.replaceSync(DEVTOOLS_CSS);
            }
          }
          if (sharedDevSheet && typeof sharedDevSheet.replaceSync === 'function') {
            root.adoptedStyleSheets = [sharedDevSheet];
            appliedConstructable = true;
          }
        }
      } catch (_) {
        appliedConstructable = false;
      }
      if (!appliedConstructable) {
        var styleFallback = doc.createElement('style');
        styleFallback.textContent = DEVTOOLS_CSS;
        root.appendChild(styleFallback);
      }
    }

    devToolsState.collapsed = !!(opts && opts.collapsed);
    var panel = makeEl(doc, 'section', 'mt-panel');
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', '元游 AR 眼镜空间交互模拟器');
    panel.setAttribute('data-collapsed', devToolsState.collapsed ? 'true' : 'false');

    var head = makeEl(doc, 'div', 'mt-head');
    var titleEl = makeEl(doc, 'div', 'mt-title', '🛠️ 眼镜空间交互模拟器 v1.5.6');
    var headBtns = makeEl(doc, 'div', 'mt-head-btns');
    var guideBtn = makeBtn(doc, '说明', function () {
      showInteractionGuide();
    }, 'mt-icon-btn');
    var collapseBtn = makeBtn(doc, devToolsState.collapsed ? '展开' : '折叠', function () {
      devToolsState.collapsed = !devToolsState.collapsed;
      panel.setAttribute('data-collapsed', devToolsState.collapsed ? 'true' : 'false');
      collapseBtn.textContent = devToolsState.collapsed ? '展开' : '折叠';
    }, 'mt-icon-btn');
    var closeBtn = makeBtn(doc, '关闭', function () {
      closeDevTools();
    }, 'mt-icon-btn');
    headBtns.appendChild(guideBtn);
    headBtns.appendChild(collapseBtn);
    headBtns.appendChild(closeBtn);
    head.appendChild(titleEl);
    head.appendChild(headBtns);
    panel.appendChild(head);

    var body = makeEl(doc, 'div', 'mt-body');
    var srLive = makeEl(doc, 'div', 'mt-sr-only');
    srLive.setAttribute('aria-live', 'polite');
    body.appendChild(srLive);

    // 1. Hardware Profile Selector
    var profSec = makeEl(doc, 'div', '');
    profSec.appendChild(makeEl(doc, 'div', 'mt-sec-label', '① 终端能力档位模拟 (免晃机身射线)'));
    var profGrid = makeEl(doc, 'div', 'mt-grid-4');
    var profDefs = [
      { id: 'glasses-6dof', label: 'S24手势镜' },
      { id: 'glasses-3dof', label: '无手势镜' },
      { id: 'handheld', label: '手机手持' },
      { id: 'real', label: '真实硬件' }
    ];
    var profBtns = {};
    profDefs.forEach(function (p) {
      var b = makeBtn(doc, p.label, function () {
        simulateInput({ kind: 'profile', profile: p.id });
      });
      profBtns[p.id] = b;
      profGrid.appendChild(b);
    });
    profSec.appendChild(profGrid);
    body.appendChild(profSec);

    // 2. Dynamic handActive & Dual-Finger Squeeze Shield
    var stateSec = makeEl(doc, 'div', '');
    stateSec.appendChild(makeEl(doc, 'div', 'mt-sec-label', '② 主辅通道与防御状态'));
    var stateGrid = makeEl(doc, 'div', 'mt-grid-2');
    var handToggleBtn = makeBtn(doc, '🖐 右手入镜: 关', function () {
      simulateInput({ kind: 'hand-active', active: !handRuntime.active, handedness: 'right' });
    });
    var shieldToggleBtn = makeBtn(doc, '🛡️ 双指护盾: 松开', function () {
      simulateInput({ kind: 'squeeze', active: !squeezeState.active, source: 'trackpad' });
    }, 'mt-warn');
    stateGrid.appendChild(handToggleBtn);
    stateGrid.appendChild(shieldToggleBtn);
    stateSec.appendChild(stateGrid);
    body.appendChild(stateSec);

    // 3. Air Hand Gestures (v2.0 S24 Spatial Spec)
    var airSec = makeEl(doc, 'div', '');
    airSec.appendChild(makeEl(doc, 'div', 'mt-sec-label', '③ S24 右手隔空手势发射器 (v2.0)'));
    var slashGrid = makeEl(doc, 'div', 'mt-grid-4');
    slashGrid.appendChild(makeBtn(doc, '挥砍 ←', function () {
      simulateInput({ kind: 'hand-gesture', type: 'slash', direction: 'left', speed: 1.9 });
    }));
    slashGrid.appendChild(makeBtn(doc, '挥砍 →', function () {
      simulateInput({ kind: 'hand-gesture', type: 'slash', direction: 'right', speed: 1.9 });
    }));
    slashGrid.appendChild(makeBtn(doc, '水车 左右左', function () {
      simulateInput({ kind: 'hand-gesture', type: 'wave-combo', direction: 'lrl', speed: 1.8 });
    }));
    slashGrid.appendChild(makeBtn(doc, '水车 右左右', function () {
      simulateInput({ kind: 'hand-gesture', type: 'wave-combo', direction: 'rlr', speed: 1.8 });
    }));
    airSec.appendChild(slashGrid);

    var airGrid2 = makeEl(doc, 'div', 'mt-grid-4');
    airGrid2.style.marginTop = '5px';
    airGrid2.appendChild(makeBtn(doc, '突刺 出拳/指', function () {
      if (devToolsState.fistChargeTimer) {
        clearInterval(devToolsState.fistChargeTimer);
        devToolsState.fistChargeTimer = 0;
        simulateInput({ kind: 'hand-gesture', type: 'fist-charge-cancel' });
      }
      simulateInput({ kind: 'hand-gesture', type: 'thrust', direction: 'forward', speed: 1.55 });
    }));
    var palmBtn = makeBtn(doc, '竖掌✋格挡', function () {
      devToolsState.palmHeld = !devToolsState.palmHeld;
      simulateInput({ kind: 'hand-gesture', type: devToolsState.palmHeld ? 'palm-hold' : 'palm-release' });
    }, 'mt-warn');
    airGrid2.appendChild(palmBtn);
    var fistUltBtn = makeBtn(doc, '握拳2s大招', function () {
      if (devToolsState.fistChargeTimer) {
        clearInterval(devToolsState.fistChargeTimer);
        devToolsState.fistChargeTimer = 0;
        simulateInput({ kind: 'hand-gesture', type: 'fist-charge-cancel' });
        simulateInput({ kind: 'hand-gesture', type: 'fist-release' });
        if (typeof devUiRefreshHook === 'function') devUiRefreshHook();
        return;
      }
      devToolsState.fistChargeStartMs = nowMs();
      simulateInput({ kind: 'hand-gesture', type: 'fist-hold' });
      simulateInput({ kind: 'hand-gesture', type: 'fist-charge', speed: 0.08 });
      devToolsState.fistChargeTimer = setInterval(function () {
        var elapsed = nowMs() - devToolsState.fistChargeStartMs;
        if (elapsed >= 2000) {
          clearInterval(devToolsState.fistChargeTimer);
          devToolsState.fistChargeTimer = 0;
          simulateInput({ kind: 'hand-gesture', type: 'fist-charge', speed: 1.0 });
          simulateInput({ kind: 'hand-gesture', type: 'fist-ult', speed: 1.0 });
          simulateInput({ kind: 'hand-gesture', type: 'fist-release' });
          if (typeof devUiRefreshHook === 'function') devUiRefreshHook();
        } else {
          simulateInput({ kind: 'hand-gesture', type: 'fist-charge', speed: Math.min(0.99, elapsed / 2000) });
        }
      }, 100);
    }, 'mt-warn');
    airGrid2.appendChild(fistUltBtn);
    airGrid2.appendChild(makeBtn(doc, '捏合 Pinch', function () {
      simulateInput({ kind: 'hand-gesture', type: 'pinch' });
    }));
    airSec.appendChild(airGrid2);
    body.appendChild(airSec);

    // 4. Virtual Blind Trackpad + Dodge Flicks + Continuous Push Walk + View Reset
    var padSec = makeEl(doc, 'div', '');
    padSec.appendChild(makeEl(doc, 'div', 'mt-sec-label', '④ 盲操触控板 (点按普攻/快左·右滑闪避/按住推走位)'));
    var padRow = makeEl(doc, 'div', 'mt-pad-row');
    var padBox = makeEl(doc, 'div', 'mt-pad-box');
    padBox.setAttribute('aria-label', '虚拟方形盲操触控板');
    padBox.appendChild(makeEl(doc, 'div', 'mt-pad-cross-h'));
    padBox.appendChild(makeEl(doc, 'div', 'mt-pad-cross-v'));
    var padThumb = makeEl(doc, 'div', 'mt-pad-thumb');
    padBox.appendChild(padThumb);
    padBox.appendChild(makeEl(doc, 'div', 'mt-pad-hint', '快滑=左/右闪 · 持续推=走位'));

    var padSide = makeEl(doc, 'div', 'mt-pad-side');
    var axesReadout = makeEl(doc, 'div', 'mt-readout', 'mode: browser\nfwd: 0.00  str: 0.00');
    var flickQuickGrid = makeEl(doc, 'div', 'mt-grid-2');
    flickQuickGrid.appendChild(makeBtn(doc, '点按普攻', function () {
      simulateInput({ kind: 'trackpad-gesture', type: 'tap', dx: 0, dy: 0 });
    }));
    flickQuickGrid.appendChild(makeBtn(doc, '重置视角', function () {
      simulateInput({ kind: 'view-reset' });
    }));
    flickQuickGrid.appendChild(makeBtn(doc, '左闪 ←', function () {
      simulateInput({ kind: 'trackpad-gesture', type: 'swipe-left', dx: -72, dy: 0 });
    }));
    flickQuickGrid.appendChild(makeBtn(doc, '右闪 →', function () {
      simulateInput({ kind: 'trackpad-gesture', type: 'swipe-right', dx: 72, dy: 0 });
    }));
    padSide.appendChild(axesReadout);
    padSide.appendChild(flickQuickGrid);
    padRow.appendChild(padBox);
    padRow.appendChild(padSide);
    padSec.appendChild(padRow);
    body.appendChild(padSec);

    // Pointer gesture recognizer on padBox (<=200ms quick flick = dodge vs >200ms continuous push = smooth walk)
    var pState = { active: false, pointerId: -1, startX: 0, startY: 0, lastX: 0, lastY: 0, downMs: 0, steering: false, holdTimer: 0 };
    var PAD_RADIUS = 46;
    function updatePadSteer(clientX, clientY) {
      var dx = clientX - pState.startX;
      var dy = clientY - pState.startY;
      var dist = Math.hypot(dx, dy);
      var clampedX = dx;
      var clampedY = dy;
      if (dist > PAD_RADIUS && dist > 1e-5) {
        clampedX = (dx / dist) * PAD_RADIUS;
        clampedY = (dy / dist) * PAD_RADIUS;
      }
      padBox.style.setProperty('--thumb-x', clampedX.toFixed(1) + 'px');
      padBox.style.setProperty('--thumb-y', clampedY.toFixed(1) + 'px');
      var normX = Math.max(-1, Math.min(1, dx / PAD_RADIUS));
      var normY = Math.max(-1, Math.min(1, dy / PAD_RADIUS));
      simulateInput({ kind: 'trackpad-move', x: normX, y: normY, active: true });
    }

    padBox.addEventListener('pointerdown', function (ev) {
      if (pState.active) return;
      pState.active = true;
      pState.pointerId = ev.pointerId;
      pState.startX = ev.clientX;
      pState.startY = ev.clientY;
      pState.lastX = ev.clientX;
      pState.lastY = ev.clientY;
      pState.downMs = nowMs();
      pState.steering = false;
      if (typeof padBox.setPointerCapture === 'function') {
        try { padBox.setPointerCapture(ev.pointerId); } catch (_) {}
      }
      if (pState.holdTimer) clearTimeout(pState.holdTimer);
      pState.holdTimer = setTimeout(function () {
        pState.holdTimer = 0;
        if (!pState.active || pState.steering) return;
        pState.steering = true;
        updatePadSteer(pState.lastX, pState.lastY);
      }, 200);
    });

    padBox.addEventListener('pointermove', function (ev) {
      if (!pState.active || ev.pointerId !== pState.pointerId) return;
      pState.lastX = ev.clientX;
      pState.lastY = ev.clientY;
      if (!pState.steering && (nowMs() - pState.downMs) > 200) {
        pState.steering = true;
      }
      if (pState.steering) {
        updatePadSteer(ev.clientX, ev.clientY);
      }
    });

    function finishPadPointer(ev) {
      if (!pState.active || (ev && ev.pointerId !== undefined && ev.pointerId !== pState.pointerId)) return;
      if (pState.holdTimer) {
        clearTimeout(pState.holdTimer);
        pState.holdTimer = 0;
      }
      var elapsed = nowMs() - pState.downMs;
      var dx = pState.lastX - pState.startX;
      var dy = pState.lastY - pState.startY;
      var wasSteering = pState.steering;
      pState.active = false;
      pState.steering = false;
      padBox.style.setProperty('--thumb-x', '0px');
      padBox.style.setProperty('--thumb-y', '0px');
      if (wasSteering) {
        simulateInput({ kind: 'trackpad-move', x: 0, y: 0, active: false });
      } else {
        var dist = Math.hypot(dx, dy);
        if (dist < 14 && elapsed < 260) {
          simulateInput({ kind: 'trackpad-gesture', type: 'tap', dx: 0, dy: 0 });
        } else if (dist >= 14 && elapsed <= 200) {
          var swipeType = Math.abs(dx) >= Math.abs(dy)
            ? (dx > 0 ? 'swipe-right' : 'swipe-left')
            : (dy > 0 ? 'swipe-down' : 'swipe-up');
          simulateInput({ kind: 'trackpad-gesture', type: swipeType, dx: Math.round(dx), dy: Math.round(dy) });
        }
      }
    }
    padBox.addEventListener('pointerup', finishPadPointer);
    padBox.addEventListener('pointercancel', finishPadPointer);

    // 5. Gaze Dwell + Contract Linter + Event Stream
    var diagSec = makeEl(doc, 'div', '');
    var gazeLabelRow = makeEl(doc, 'div', 'mt-sec-label');
    var gazeTitleSpan = makeEl(doc, 'span', '', '⑤ 注视读条与接入合规自检');
    var gazeTargetSpan = makeEl(doc, 'span', '', 'gaze: 无');
    gazeLabelRow.appendChild(gazeTitleSpan);
    gazeLabelRow.appendChild(gazeTargetSpan);
    diagSec.appendChild(gazeLabelRow);

    var gazeBar = makeEl(doc, 'div', 'mt-gaze-bar');
    var gazeFill = makeEl(doc, 'div', 'mt-gaze-fill');
    gazeBar.appendChild(gazeFill);
    diagSec.appendChild(gazeBar);

    var badgeRow = makeEl(doc, 'div', 'mt-badges');
    badgeRow.style.marginTop = '6px';
    var badgeDefs = [
      { key: 'handGesture', label: '隔空手势' },
      { key: 'trackpadGesture', label: '点按/闪避' },
      { key: 'trackpadMove', label: '推盘走位' },
      { key: 'gazeDwell', label: '注视驻留' },
      { key: 'viewReset', label: '视角重置' }
    ];
    var badgeEls = {};
    badgeDefs.forEach(function (bd) {
      var bEl = makeEl(doc, 'span', 'mt-badge', bd.label);
      badgeEls[bd.key] = bEl;
      badgeRow.appendChild(bEl);
    });
    diagSec.appendChild(badgeRow);

    var logBox = makeEl(doc, 'div', 'mt-log', '等待空间输入或点击上方模拟按钮…');
    logBox.style.marginTop = '6px';
    diagSec.appendChild(logBox);
    body.appendChild(diagSec);

    panel.appendChild(body);
    root.appendChild(panel);
    doc.body.appendChild(host);

    devToolsState.open = true;
    devToolsState.host = host;

    devUiRefreshHook = function () {
      if (!devToolsState.open) return;
      panel.setAttribute('data-collapsed', devToolsState.collapsed ? 'true' : 'false');
      collapseBtn.textContent = devToolsState.collapsed ? '展开' : '折叠';
      var st = getInputState();
      var diag = getDiagnostics();
      Object.keys(profBtns).forEach(function (k) {
        profBtns[k].setAttribute('aria-pressed', simProfile === k ? 'true' : 'false');
      });
      handToggleBtn.setAttribute('aria-pressed', st.handActive ? 'true' : 'false');
      handToggleBtn.textContent = st.handActive ? '🖐 右手入镜: 开' : '📱 右手放下: 关';
      shieldToggleBtn.setAttribute('aria-pressed', st.squeezeActive ? 'true' : 'false');
      shieldToggleBtn.textContent = st.squeezeActive ? '🛡️ 护盾状态: 架起' : '🛡️ 护盾状态: 松开';
      devToolsState.palmHeld = !!st.palmGuardActive;
      palmBtn.setAttribute('aria-pressed', devToolsState.palmHeld ? 'true' : 'false');
      palmBtn.textContent = devToolsState.palmHeld ? '竖掌✋: 架盾中' : '竖掌✋格挡';
      var charging = !!devToolsState.fistChargeTimer || st.fistChargeProgress > 0.01;
      fistUltBtn.setAttribute('aria-pressed', charging ? 'true' : 'false');
      fistUltBtn.textContent = charging
        ? ('蓄力 ' + Math.round(st.fistChargeProgress * 100) + '% (点取消)')
        : '握拳2s大招';

      axesReadout.textContent =
        'mode: ' + st.mode + (st.simulated ? ' (模拟)' : '') + '\n' +
        'ray : ' + st.activeRayMode + ' (机身零晃)\n' +
        'fwd : ' + st.forward.toFixed(2) + '  str: ' + st.strafe.toFixed(2);

      gazeTargetSpan.textContent = st.gazeTargetId
        ? ('🎯 ' + st.gazeTargetId + ' (' + Math.round(lastGazeProgressPct * 100) + '%)')
        : 'gaze: 无目标';
      gazeFill.style.setProperty('--gaze-pct', Math.round(lastGazeProgressPct * 100) + '%');

      Object.keys(badgeEls).forEach(function (k) {
        var ok = !!diag.contracts[k];
        badgeEls[k].setAttribute('data-ok', ok ? 'true' : 'false');
        var def = badgeDefs.find(function (d) { return d.key === k; });
        badgeEls[k].textContent = (ok ? '✓ ' : '○ ') + (def ? def.label : k);
      });

      if (devEventLog.length > 0) {
        var lines = [];
        var startIdx = Math.max(0, devEventLog.length - 12);
        for (var li = devEventLog.length - 1; li >= startIdx; li--) {
          var item = devEventLog[li];
          lines.push(item.time + ' [' + item.category + '] ' + item.summary);
        }
        logBox.textContent = lines.join('\n');
        var newest = devEventLog[devEventLog.length - 1];
        var politeMsg = newest.category + ' ' + newest.summary;
        if (politeMsg !== devToolsState.lastPoliteText) {
          devToolsState.lastPoliteText = politeMsg;
          if (devToolsState.liveTimer) clearTimeout(devToolsState.liveTimer);
          devToolsState.liveTimer = setTimeout(function () {
            srLive.textContent = politeMsg;
          }, 350);
        }
      }
    };

    // If opened on desktop browser in 'real' ('browser') mode, pre-select 6DoF glasses simulation for 1-click testing!
    if (simProfile === 'real' && detectRawMode() === 'browser' && !(opts && opts.keepProfile)) {
      setSimProfile('glasses-6dof');
    } else {
      devUiRefreshHook();
    }
    return true;
  }

  function closeDevTools() {
    if (devToolsState.fistChargeTimer) {
      clearInterval(devToolsState.fistChargeTimer);
      devToolsState.fistChargeTimer = 0;
    }
    if (devToolsState.liveTimer) {
      clearTimeout(devToolsState.liveTimer);
      devToolsState.liveTimer = 0;
    }
    if (devToolsState.host) {
      try {
        if (typeof devToolsState.host.remove === 'function') {
          devToolsState.host.remove();
        } else if (devToolsState.host.parentNode) {
          devToolsState.host.parentNode.removeChild(devToolsState.host);
        }
      } catch (_) {}
    }
    devToolsState.open = false;
    devToolsState.host = null;
    devUiRefreshHook = null;
    return true;
  }

  function toggleDevTools(opts) {
    if (devToolsState.open) {
      closeDevTools();
      return false;
    }
    return openDevTools(opts);
  }

  // Prime initial capabilities & gaze dwell configuration on script load
  getCapabilities();

  window.MetaTourWebAR = {
    __initialized: true,
    version: '1.5.6',
    sensors: sensorsApi,
    getMode: detectMode,
    getCapabilities: getCapabilities,
    getInputState: getInputState,
    getDiagnostics: getDiagnostics,
    simulateInput: simulateInput,
    openDevTools: openDevTools,
    closeDevTools: closeDevTools,
    toggleDevTools: toggleDevTools,
    showInteractionGuide: showInteractionGuide,
    dismissInteractionGuide: dismissInteractionGuide,
    isInteractionGuideOpen: isInteractionGuideOpen,
    onInteractionGuideChange: function (fn) {
      if (typeof fn === 'function') guideListeners.push(fn);
      return function () {
        var idx = guideListeners.indexOf(fn);
        if (idx >= 0) guideListeners.splice(idx, 1);
      };
    },
    onInputStateChange: function (fn) {
      if (typeof fn === 'function') inputStateListeners.push(fn);
      return function () {
        var idx = inputStateListeners.indexOf(fn);
        if (idx >= 0) inputStateListeners.splice(idx, 1);
      };
    },
    onHandGesture: function (fn) {
      if (typeof fn === 'function') handGestureListeners.push(fn);
      return function () {
        var idx = handGestureListeners.indexOf(fn);
        if (idx >= 0) handGestureListeners.splice(idx, 1);
      };
    },
    onSqueezeChange: function (fn) {
      if (typeof fn === 'function') squeezeListeners.push(fn);
      return function () {
        var idx = squeezeListeners.indexOf(fn);
        if (idx >= 0) squeezeListeners.splice(idx, 1);
      };
    },
    getMoveAxes: function () {
      return {
        x: moveAxes.x,
        y: moveAxes.y,
        forward: moveAxes.active ? cleanZero(-moveAxes.y) : 0,
        strafe: moveAxes.active ? cleanZero(moveAxes.x) : 0,
        active: moveAxes.active
      };
    },
    onTrackpadMove: function (fn) {
      if (typeof fn === 'function') trackpadMoveListeners.push(fn);
      return function () {
        var idx = trackpadMoveListeners.indexOf(fn);
        if (idx >= 0) trackpadMoveListeners.splice(idx, 1);
      };
    },
    onTrackpadGesture: function (fn) {
      if (typeof fn === 'function') trackpadGestureListeners.push(fn);
      return function () {
        var idx = trackpadGestureListeners.indexOf(fn);
        if (idx >= 0) trackpadGestureListeners.splice(idx, 1);
      };
    },
    onDodge: function (fn) {
      if (typeof fn === 'function') dodgeListeners.push(fn);
      return function () {
        var idx = dodgeListeners.indexOf(fn);
        if (idx >= 0) dodgeListeners.splice(idx, 1);
      };
    },
    setReticleTarget: setReticleTarget,
    onGazeProgress: function (fn) {
      if (typeof fn === 'function') gazeProgressListeners.push(fn);
      return function () {
        var idx = gazeProgressListeners.indexOf(fn);
        if (idx >= 0) gazeProgressListeners.splice(idx, 1);
      };
    },
    onGazeSelect: function (fn) {
      if (typeof fn === 'function') gazeSelectListeners.push(fn);
      return function () {
        var idx = gazeSelectListeners.indexOf(fn);
        if (idx >= 0) gazeSelectListeners.splice(idx, 1);
      };
    },
    getGazeDwellMs: getGazeDwellMs,
    setGazeDwellMs: setGazeDwellMs,
    isGlassesConnected: isGlassesConnected,
    switchToGlasses: switchToGlasses,
    resetView: resetView,
    resetHeading: resetHeading,
    onViewReset: function (fn) {
      if (typeof fn === 'function') viewResetListeners.push(fn);
      return function () {
        var idx = viewResetListeners.indexOf(fn);
        if (idx >= 0) viewResetListeners.splice(idx, 1);
      };
    },
    getScreenAngle: getScreenAngle,
    setPreferredOrientation: setPreferredOrientation,
    getHandheldPose: function () {
      return {
        x: latestHandheldPose.x,
        y: latestHandheldPose.y,
        z: latestHandheldPose.z,
        w: latestHandheldPose.w,
        screenAngle: getScreenAngle(),
        timestamp: latestHandheldPose.timestamp,
        headingGen: latestHandheldPose.headingGen,
        source: latestHandheldPose.source
      };
    },
    onPose: function (fn) {
      if (typeof fn === 'function') poseListeners.push(fn);
      return function () {
        var idx = poseListeners.indexOf(fn);
        if (idx >= 0) poseListeners.splice(idx, 1);
      };
    },
    onOrientationChange: function (fn) {
      if (typeof fn === 'function') orientationListeners.push(fn);
      return function () {
        var idx = orientationListeners.indexOf(fn);
        if (idx >= 0) orientationListeners.splice(idx, 1);
      };
    },
    onGlassesStateChange: function (fn) {
      if (typeof fn === 'function') modeListeners.push(fn);
      return function () {
        var idx = modeListeners.indexOf(fn);
        if (idx >= 0) modeListeners.splice(idx, 1);
      };
    },
    applyMegaPose: applyMegaPose,
    clearMegaPose: clearMegaPose,
    getSpatialStatus: getSpatialStatus,
    onMegaStatus: function (fn) {
      if (typeof fn === 'function') megaListeners.push(fn);
      return function () {
        var idx = megaListeners.indexOf(fn);
        if (idx >= 0) megaListeners.splice(idx, 1);
      };
    }
  };

  if (typeof window.addEventListener === 'function') {
    window.addEventListener('keydown', function (ev) {
      if (ev && ev.altKey && ev.shiftKey && (ev.code === 'KeyM' || ev.key === 'M' || ev.key === 'm')) {
        if (typeof ev.preventDefault === 'function') ev.preventDefault();
        toggleDevTools();
      }
    });
  }

  try {
    var searchStr = (window.location && typeof window.location.search === 'string') ? window.location.search : '';
    var shouldAutoDev = false;
    if (typeof URLSearchParams === 'function' && searchStr) {
      var params = new URLSearchParams(searchStr);
      shouldAutoDev = params.get('mtdev') === '1' || params.get('devtools') === '1';
    } else if (searchStr.indexOf('mtdev=1') >= 0 || searchStr.indexOf('devtools=1') >= 0) {
      shouldAutoDev = true;
    }
    if (shouldAutoDev) {
      if (window.document && window.document.body) {
        setTimeout(function () { openDevTools(); }, 0);
      } else if (window.document && typeof window.document.addEventListener === 'function') {
        window.document.addEventListener('DOMContentLoaded', function () { openDevTools(); });
      }
    }
  } catch (_) {
    // Ignore URL parse issues in custom sandboxes
  }
})();
