import * as T from 'three';

// World-space 3D Spatial HUD for AR Glasses & Spatial Guide for Desktop Welcome:
// Strictly mounted under scene -> worldRoot (camera.children.length === 0).
// Implements MetaTour WebAR v1.5.0 ergonomic two-phase spatial UI:
//   - Phase A (welcome / result): Top 3D title plaque + Dual 3D Spatial Menu Buttons (primary + secondary)
//     fitting simultaneously inside XREAL's 25-deg vertical waveguide FOV [1.08m .. 1.80m at z = -2.14m],
//     dynamically synced with container gazeDwellMs (0 / 1000 / 2000 / 3000ms).
//   - Phase B (battle): Collapses central plaque into an ultra-slim top-rim status strip (y = 1.82m),
//     anchors a 3D floating HP + [危] hazard tag directly over the locked demon's head,
//     renders 3D off-FOV directional chevrons (◀ / ▶) around the 3D reticle when demons are > 17 deg off-axis,
//     and flashes lightweight 3D Water-Breathing calligraphy callout banners.
export function createWorldPlaque(worldRoot, { isGlasses = false } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 352;
  const ctx = canvas.getContext('2d');

  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = 4;

  const group = new T.Group();
  group.position.set(isGlasses ? 0.04 : 0.26, isGlasses ? 1.81 : 1.48, -2.16);
  worldRoot.add(group);

  const plaqueMesh = new T.Mesh(
    new T.PlaneGeometry(0.84, 0.255),
    new T.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      side: T.DoubleSide,
    }),
  );
  group.add(plaqueMesh);

  // Helper to build a Phase A 3D Spatial Menu Button (card + padded invisible hit plane)
  function createMenuButtonSlot({ width, height, hitWidth, hitHeight, y, z }) {
    const btnCanvas = document.createElement('canvas');
    btnCanvas.width = 1024;
    btnCanvas.height = 272;
    const btnCtx = btnCanvas.getContext('2d');
    const btnTex = new T.CanvasTexture(btnCanvas);
    btnTex.colorSpace = T.SRGBColorSpace;
    btnTex.anisotropy = 4;

    const slotGroup = new T.Group();
    slotGroup.position.set(0.04, y, z);
    slotGroup.visible = false;
    worldRoot.add(slotGroup);

    const cardMesh = new T.Mesh(
      new T.PlaneGeometry(width, height),
      new T.MeshBasicMaterial({
        map: btnTex,
        transparent: true,
        depthWrite: false,
        side: T.DoubleSide,
      }),
    );
    slotGroup.add(cardMesh);

    const hitMesh = new T.Mesh(
      new T.PlaneGeometry(hitWidth, hitHeight),
      new T.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: T.DoubleSide,
      }),
    );
    slotGroup.add(hitMesh);

    return {
      group: slotGroup,
      cardMesh,
      hitMesh,
      canvas: btnCanvas,
      ctx: btnCtx,
      texture: btnTex,
      lastSig: '',
    };
  }

  // Primary button (y = 1.52m, hit [1.395..1.645m] around 1.60m eye level) & Secondary button (y = 1.23m, hit [1.135..1.325m]):
  // Zero vertical hit-plane overlap (7cm gap), centered horizontally, both inside XREAL's 25-deg vertical FOV!
  const primaryBtn = createMenuButtonSlot({
    width: 0.76,
    height: 0.19,
    hitWidth: 0.94,
    hitHeight: 0.25,
    y: 1.52,
    z: -2.14,
  });
  const secondaryBtn = createMenuButtonSlot({
    width: 0.68,
    height: 0.148,
    hitWidth: 0.86,
    hitHeight: 0.19,
    y: 1.23,
    z: -2.14,
  });

  // --- Phase B: Compact Unobstructed 3D Sticky Gaze Lock Halo + Overhead HP Tag ---
  const lockGroup = new T.Group();
  lockGroup.visible = false;
  worldRoot.add(lockGroup);

  const lockGroundRing = new T.Mesh(
    new T.RingGeometry(0.41, 0.465, 48),
    new T.MeshBasicMaterial({
      color: '#7df9ff',
      transparent: true,
      opacity: 0.85,
      side: T.DoubleSide,
      depthWrite: false,
      blending: T.AdditiveBlending,
    }),
  );
  lockGroundRing.rotation.x = -Math.PI / 2;
  lockGroup.add(lockGroundRing);

  const lockBillboard = new T.Group();
  lockGroup.add(lockBillboard);

  const lockDiamond = new T.Mesh(
    new T.RingGeometry(0.105, 0.126, 4),
    new T.MeshBasicMaterial({
      color: '#7df9ff',
      transparent: true,
      opacity: 0.68,
      side: T.DoubleSide,
      depthWrite: false,
      depthTest: false,
      blending: T.AdditiveBlending,
    }),
  );
  const lockOuterRing = new T.Mesh(
    new T.RingGeometry(0.146, 0.156, 36),
    new T.MeshBasicMaterial({
      color: '#ffe09c',
      transparent: true,
      opacity: 0.36,
      side: T.DoubleSide,
      depthWrite: false,
      depthTest: false,
      blending: T.AdditiveBlending,
    }),
  );
  lockBillboard.add(lockDiamond, lockOuterRing);

  // Subtle overhead diamonds on unlocked alive demons so the player knows glance-to-switch targets:
  const unlockedMarkers = [];
  for (let i = 0; i < 2; i++) {
    const marker = new T.Mesh(
      new T.RingGeometry(0.048, 0.064, 4),
      new T.MeshBasicMaterial({
        color: '#88f2ff',
        transparent: true,
        opacity: 0.48,
        side: T.DoubleSide,
        depthWrite: false,
        depthTest: false,
        blending: T.AdditiveBlending,
      }),
    );
    marker.visible = false;
    worldRoot.add(marker);
    unlockedMarkers.push(marker);
  }

  // Compact Overhead 3D Floating Enemy Name + HP Bar + Red [危] Tag (0.52m x 0.142m -> zero torso occlusion!)
  const lockHudCanvas = document.createElement('canvas');
  lockHudCanvas.width = 640;
  lockHudCanvas.height = 180;
  const lockHudCtx = lockHudCanvas.getContext('2d');
  const lockHudTex = new T.CanvasTexture(lockHudCanvas);
  lockHudTex.colorSpace = T.SRGBColorSpace;
  const lockHudMesh = new T.Mesh(
    new T.PlaneGeometry(0.52, 0.146),
    new T.MeshBasicMaterial({
      map: lockHudTex,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: T.DoubleSide,
    }),
  );
  lockHudMesh.visible = isGlasses;
  lockGroup.add(lockHudMesh);

  // --- World-space 3D Gaze Reticle + Narrow-FOV Off-Axis Chevrons (◀ / ▶) ---
  const reticleGroup = new T.Group();
  reticleGroup.visible = isGlasses;
  worldRoot.add(reticleGroup);

  const reticle = new T.Mesh(
    new T.RingGeometry(0.016, 0.023, 40),
    new T.MeshBasicMaterial({
      color: '#a5f1ec',
      transparent: true,
      opacity: 0.86,
      side: T.DoubleSide,
      depthWrite: false,
      depthTest: false,
    }),
  );
  reticleGroup.add(reticle);

  function createChevronMesh(isLeft) {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const g = c.getContext('2d');
    g.clearRect(0, 0, 128, 128);
    g.fillStyle = '#ffd98e';
    g.strokeStyle = '#7df9ff';
    g.lineWidth = 5;
    g.beginPath();
    if (isLeft) {
      g.moveTo(26, 64);
      g.lineTo(94, 22);
      g.lineTo(76, 64);
      g.lineTo(94, 106);
    } else {
      g.moveTo(102, 64);
      g.lineTo(34, 22);
      g.lineTo(52, 64);
      g.lineTo(34, 106);
    }
    g.closePath();
    g.fill();
    g.stroke();
    const tex = new T.CanvasTexture(c);
    tex.colorSpace = T.SRGBColorSpace;
    const mesh = new T.Mesh(
      new T.PlaneGeometry(0.056, 0.056),
      new T.MeshBasicMaterial({
        map: tex,
        transparent: true,
        opacity: 0.92,
        side: T.DoubleSide,
        depthWrite: false,
        depthTest: false,
        blending: T.AdditiveBlending,
      }),
    );
    mesh.position.set(isLeft ? -0.115 : 0.115, 0, 0);
    mesh.visible = false;
    reticleGroup.add(mesh);
    return mesh;
  }
  const chevronLeft = createChevronMesh(true);
  const chevronRight = createChevronMesh(false);

  // --- Phase B: Lightweight 3D Calligraphy Skill Callout Banner ---
  const bannerCanvas = document.createElement('canvas');
  bannerCanvas.width = 768;
  bannerCanvas.height = 160;
  const bannerCtx = bannerCanvas.getContext('2d');
  const bannerTex = new T.CanvasTexture(bannerCanvas);
  bannerTex.colorSpace = T.SRGBColorSpace;
  const skillBannerMesh = new T.Mesh(
    new T.PlaneGeometry(0.66, 0.128),
    new T.MeshBasicMaterial({
      map: bannerTex,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
      side: T.DoubleSide,
    }),
  );
  skillBannerMesh.position.set(0, 1.69, -2.18);
  skillBannerMesh.visible = false;
  worldRoot.add(skillBannerMesh);

  let bannerTimer = 0;
  let bannerDuration = 1.15;
  let lastSignature = '';
  let lastLockHudSig = '';
  let offscreenDirection = null;

  const worldDir = new T.Vector3();
  const worldPos = new T.Vector3();
  const camPosWorld = new T.Vector3();
  const camInvQuat = new T.Quaternion();
  const enemyLocalToCam = new T.Vector3();
  const targetPlaquePos = new T.Vector3();
  const targetPlaqueScale = new T.Vector3(1, 1, 1);

  function drawRoundedRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function renderFullPlaque(state) {
    const sig = `full|${JSON.stringify(state)}`;
    if (sig === lastSignature) return;
    lastSignature = sig;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    grad.addColorStop(0, 'rgba(10, 22, 34, 0.92)');
    grad.addColorStop(0.5, 'rgba(17, 34, 49, 0.92)');
    grad.addColorStop(1, 'rgba(12, 24, 38, 0.92)');
    drawRoundedRect(ctx, 16, 16, canvas.width - 32, canvas.height - 32, 22);
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(165, 241, 236, 0.78)';
    ctx.stroke();

    ctx.fillStyle = '#e9ce9a';
    ctx.font = '600 22px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(state.eyebrow, 48, 66);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#a5f1ec';
    ctx.font = '600 22px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(state.badge, canvas.width - 48, 66);
    ctx.textAlign = 'left';

    ctx.fillStyle = '#f2f9f7';
    ctx.font = '700 42px "PingFang SC", "Microsoft YaHei", serif';
    ctx.fillText(state.title, 48, 132, canvas.width - 96);

    ctx.fillStyle = '#cde2e4';
    ctx.font = '500 25px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(state.subtitle, 48, 188, canvas.width - 96);

    ctx.fillStyle = '#e9ce9a';
    ctx.font = '500 23px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(state.footer, 48, 278, canvas.width - 96);

    texture.needsUpdate = true;
  }

  // Phase B Ultra-Slim Top Status Bar (uniform 1:1 aspect ratio inside a 128px slim band so text is never squashed)
  function renderCompactBattleStrip(state) {
    const sig = `compact|${JSON.stringify(state)}`;
    if (sig === lastSignature) return;
    lastSignature = sig;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const boxY = 86;
    const boxH = 128;
    drawRoundedRect(ctx, 18, boxY, canvas.width - 36, boxH, 26);
    ctx.fillStyle = state.danger ? 'rgba(34, 12, 22, 0.9)' : 'rgba(9, 22, 34, 0.86)';
    ctx.fill();
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = state.danger
      ? 'rgba(255, 98, 122, 0.95)'
      : state.guarding
        ? 'rgba(125, 249, 255, 0.95)'
        : 'rgba(158, 241, 236, 0.68)';
    ctx.stroke();

    // Left: HP gauge (1:1 un-distorted typography)
    ctx.textAlign = 'left';
    ctx.fillStyle = '#dff6f4';
    ctx.font = '700 26px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(`守备 ${state.hp}%`, 42, boxY + 42);

    drawRoundedRect(ctx, 196, boxY + 26, 132, 14, 7);
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fill();
    drawRoundedRect(ctx, 196, boxY + 26, Math.max(10, 1.32 * state.hp), 14, 7);
    ctx.fillStyle = state.hp > 35 ? '#9ef0c8' : '#ff697d';
    ctx.fill();

    // Middle: Water Wheel Energy gauge
    ctx.fillStyle = state.energy >= 100 ? '#7df9ff' : '#d8c5ff';
    ctx.fillText(state.energy >= 100 ? '水车就绪' : `水车 ${state.energy}%`, 356, boxY + 42);

    drawRoundedRect(ctx, 506, boxY + 26, 128, 14, 7);
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fill();
    drawRoundedRect(ctx, 506, boxY + 26, Math.max(10, 1.28 * state.energy), 14, 7);
    ctx.fillStyle = state.energy >= 100 ? '#7df9ff' : '#a48bf0';
    ctx.fill();

    // Right: Wave progress + Hand/Shield live pill
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffe29c';
    ctx.font = '700 25px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(state.rightTop, canvas.width - 42, boxY + 42);

    ctx.fillStyle = state.danger ? '#ffadb8' : '#a5f1ec';
    ctx.font = '600 21px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(state.rightBottom, canvas.width - 42, boxY + 98);
    ctx.textAlign = 'left';

    // Slim bottom status line
    ctx.fillStyle = '#cfe8ea';
    ctx.font = '500 21px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(state.hintLine, 42, boxY + 98, 560);

    texture.needsUpdate = true;
  }

  function renderMenuSlot(slot, state) {
    const bucketProgress = Math.round(state.progress * 50) / 50;
    const sig = `${state.menuId}|${state.ready}|${state.hovered}|${bucketProgress}|${state.dwellBadge}|${state.title}|${state.sub}|${state.secondary}`;
    if (sig === slot.lastSig) return;
    slot.lastSig = sig;

    const c = slot.ctx;
    const w = slot.canvas.width;
    const h = slot.canvas.height;
    c.clearRect(0, 0, w, h);

    const grad = c.createLinearGradient(0, 0, w, h);
    if (state.hovered) {
      grad.addColorStop(0, state.secondary ? 'rgba(42, 74, 98, 0.96)' : 'rgba(24, 96, 108, 0.96)');
      grad.addColorStop(1, 'rgba(18, 52, 80, 0.96)');
    } else {
      grad.addColorStop(0, state.secondary ? 'rgba(16, 28, 44, 0.88)' : 'rgba(14, 42, 58, 0.92)');
      grad.addColorStop(1, 'rgba(12, 24, 40, 0.9)');
    }
    drawRoundedRect(c, 12, 12, w - 24, h - 24, 24);
    c.fillStyle = grad;
    c.fill();

    c.lineWidth = state.hovered ? 5 : 3;
    c.strokeStyle = state.hovered
      ? '#7df9ff'
      : state.secondary
        ? 'rgba(233, 206, 154, 0.62)'
        : 'rgba(158, 243, 237, 0.72)';
    c.stroke();

    const cx = 112;
    const cy = h / 2;
    const radius = 58;
    c.beginPath();
    c.arc(cx, cy, radius, 0, Math.PI * 2);
    c.lineWidth = 9;
    c.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    c.stroke();

    if (bucketProgress > 0) {
      c.beginPath();
      c.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * bucketProgress);
      c.lineWidth = 11;
      c.lineCap = 'round';
      c.strokeStyle = '#7df9ff';
      c.stroke();
    }

    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = state.hovered ? '#7df9ff' : '#ecd09c';
    c.font = '700 28px "PingFang SC", "Microsoft YaHei", sans-serif';
    c.fillText(
      !state.ready ? '载入' : bucketProgress > 0.02 ? `${Math.round(bucketProgress * 100)}%` : state.dwellBadge,
      cx,
      cy,
    );

    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
    c.fillStyle = '#f5fbfa';
    c.font = state.secondary
      ? '700 36px "PingFang SC", "Microsoft YaHei", sans-serif'
      : '700 42px "PingFang SC", "Microsoft YaHei", sans-serif';
    c.fillText(state.title, 204, 112, w - 240);

    c.fillStyle = state.hovered ? '#a8fbff' : '#c6dfe2';
    c.font = '500 25px "PingFang SC", "Microsoft YaHei", sans-serif';
    c.fillText(state.sub, 204, 166, w - 240);

    drawRoundedRect(c, 204, 198, w - 252, 14, 7);
    c.fillStyle = 'rgba(255, 255, 255, 0.14)';
    c.fill();
    if (bucketProgress > 0) {
      drawRoundedRect(c, 204, 198, Math.max(14, (w - 252) * bucketProgress), 14, 7);
      c.fillStyle = '#7df9ff';
      c.fill();
    }

    slot.texture.needsUpdate = true;
  }

  function renderLockHud(state) {
    const sig = JSON.stringify(state);
    if (sig === lastLockHudSig) return;
    lastLockHudSig = sig;

    lockHudCtx.clearRect(0, 0, 640, 180);
    drawRoundedRect(lockHudCtx, 10, 10, 620, 160, 24);
    lockHudCtx.fillStyle = state.hazardText ? 'rgba(46, 10, 20, 0.92)' : 'rgba(10, 24, 38, 0.88)';
    lockHudCtx.fill();
    lockHudCtx.lineWidth = 4;
    lockHudCtx.strokeStyle = state.hazardText ? '#ff647c' : state.boss ? '#ffd27d' : '#7df9ff';
    lockHudCtx.stroke();

    lockHudCtx.textAlign = 'left';
    lockHudCtx.fillStyle = state.boss ? '#ffe19c' : '#e8fbfa';
    lockHudCtx.font = '700 35px "PingFang SC", "Microsoft YaHei", sans-serif';
    lockHudCtx.fillText(state.name, 32, 56);

    lockHudCtx.textAlign = 'right';
    lockHudCtx.fillStyle = '#a8f4ef';
    lockHudCtx.font = '700 31px "PingFang SC", "Microsoft YaHei", sans-serif';
    lockHudCtx.fillText(`HP ${state.hp}/${state.maxHp}`, 608, 56);
    lockHudCtx.textAlign = 'left';

    drawRoundedRect(lockHudCtx, 32, 76, 576, 24, 12);
    lockHudCtx.fillStyle = 'rgba(255,255,255,0.16)';
    lockHudCtx.fill();
    const ratio = Math.max(0.03, Math.min(1, state.hp / Math.max(1, state.maxHp)));
    drawRoundedRect(lockHudCtx, 32, 76, Math.round(576 * ratio), 24, 12);
    lockHudCtx.fillStyle = state.hazardText ? '#ff5d76' : state.boss ? '#ffbe6b' : '#7df9ff';
    lockHudCtx.fill();

    lockHudCtx.fillStyle = state.hazardText ? '#ffc6cf' : '#c6ecef';
    lockHudCtx.font = '600 28px "PingFang SC", "Microsoft YaHei", sans-serif';
    lockHudCtx.fillText(state.subLine, 32, 142, 576);

    lockHudTex.needsUpdate = true;
  }

  function triggerSkillBanner({ title, sub = '', accent = '#7df9ff', theme = 'default', duration = 1.15 } = {}) {
    if (!isGlasses || !title) return;
    bannerDuration = duration;
    bannerTimer = duration;
    bannerCtx.clearRect(0, 0, 768, 160);

    const bgGrad = bannerCtx.createLinearGradient(0, 16, 768, 144);
    if (theme === 'waterWheel' || theme === 'ultimate') {
      bgGrad.addColorStop(0, 'rgba(6, 30, 68, 0.94)');
      bgGrad.addColorStop(0.55, 'rgba(10, 56, 106, 0.94)');
      bgGrad.addColorStop(1, 'rgba(8, 34, 72, 0.94)');
    } else if (theme === 'interrupt') {
      bgGrad.addColorStop(0, 'rgba(46, 34, 8, 0.95)');
      bgGrad.addColorStop(0.55, 'rgba(22, 48, 56, 0.94)');
      bgGrad.addColorStop(1, 'rgba(42, 30, 8, 0.95)');
    } else if (theme === 'thrust') {
      bgGrad.addColorStop(0, 'rgba(6, 34, 42, 0.94)');
      bgGrad.addColorStop(0.55, 'rgba(14, 58, 68, 0.94)');
      bgGrad.addColorStop(1, 'rgba(8, 32, 40, 0.94)');
    } else {
      bgGrad.addColorStop(0, 'rgba(8, 22, 36, 0.88)');
      bgGrad.addColorStop(1, 'rgba(12, 30, 48, 0.88)');
    }

    drawRoundedRect(bannerCtx, 12, 16, 744, 128, 24);
    bannerCtx.fillStyle = bgGrad;
    bannerCtx.fill();
    bannerCtx.lineWidth = theme === 'interrupt' ? 5 : 4;
    bannerCtx.strokeStyle = accent;
    bannerCtx.stroke();

    // Distinct silhouette emblem on the left so peripheral vision immediately tells Wheel vs Thrust apart:
    const ex = 66;
    const ey = 80;
    bannerCtx.save();
    if (theme === 'waterWheel' || theme === 'ultimate') {
      bannerCtx.strokeStyle = '#38bdf8';
      bannerCtx.lineWidth = 5;
      bannerCtx.beginPath();
      bannerCtx.arc(ex, ey, 28, 0, Math.PI * 2);
      bannerCtx.stroke();
      bannerCtx.strokeStyle = '#f0fcff';
      bannerCtx.lineWidth = 3.5;
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2;
        bannerCtx.beginPath();
        bannerCtx.arc(ex, ey, 19, a, a + 0.95);
        bannerCtx.stroke();
      }
    } else if (theme === 'thrust' || theme === 'interrupt') {
      const rippleColor = theme === 'interrupt' ? '#ffe680' : '#9efcff';
      bannerCtx.strokeStyle = rippleColor;
      bannerCtx.lineWidth = 2.6;
      bannerCtx.beginPath();
      bannerCtx.arc(ex + 8, ey, 14, 0, Math.PI * 2);
      bannerCtx.stroke();
      bannerCtx.beginPath();
      bannerCtx.arc(ex + 8, ey, 25, 0, Math.PI * 2);
      bannerCtx.stroke();
      bannerCtx.strokeStyle = '#ffffff';
      bannerCtx.lineWidth = 4.5;
      bannerCtx.beginPath();
      bannerCtx.moveTo(ex - 26, ey);
      bannerCtx.lineTo(ex + 22, ey);
      bannerCtx.stroke();
    }
    bannerCtx.restore();

    const textCenterX = theme === 'default' ? 384 : 412;
    const maxTextW = theme === 'default' ? 700 : 636;
    bannerCtx.textAlign = 'center';
    bannerCtx.fillStyle = theme === 'waterWheel' ? '#f0fcff' : accent;
    bannerCtx.font = '700 38px "PingFang SC", "Microsoft YaHei", serif';
    bannerCtx.fillText(title, textCenterX, 76, maxTextW);
    if (sub) {
      bannerCtx.fillStyle = theme === 'waterWheel' ? '#93dcff' : theme === 'interrupt' ? '#fff3c4' : '#e5f7f8';
      bannerCtx.font = '600 24px "PingFang SC", "Microsoft YaHei", sans-serif';
      bannerCtx.fillText(sub, textCenterX, 118, maxTextW);
    }
    bannerCtx.textAlign = 'left';
    bannerTex.needsUpdate = true;
    skillBannerMesh.visible = true;
  }

  function getMenuDescriptors(mode, difficulty = 'normal') {
    if (!isGlasses) return [];
    const diffLabel = difficulty === 'hashira' ? '柱合试炼（高烈度）' : '夜巡标准';
    if (mode === 'welcome') {
      return [
        {
          slot: primaryBtn,
          id: 'btn-start-battle',
          secondary: false,
          title: '拔刀开战 · 守护藤花结界',
        },
        {
          slot: secondaryBtn,
          id: 'btn-toggle-difficulty',
          secondary: true,
          title: `试炼强度：${diffLabel}`,
        },
      ];
    }
    if (mode === 'result') {
      return [
        {
          slot: primaryBtn,
          id: 'btn-play-again',
          secondary: false,
          title: '再来一局 · 重新拔刀迎战',
        },
        {
          slot: secondaryBtn,
          id: 'btn-back-welcome',
          secondary: true,
          title: '返回庭院 · 切换试炼强度',
        },
      ];
    }
    return [];
  }

  return {
    group,
    menuGroup: primaryBtn.group,
    menuHitMesh: primaryBtn.hitMesh,
    secondaryMenuGroup: secondaryBtn.group,
    secondaryHitMesh: secondaryBtn.hitMesh,
    lockGroup,
    lockHudMesh,
    reticleGroup,
    reticle,
    skillBannerMesh,
    triggerSkillBanner,
    getActiveMenuId(mode) {
      if (!isGlasses) return null;
      if (mode === 'welcome') return 'btn-start-battle';
      if (mode === 'result') return 'btn-play-again';
      return null;
    },
    getActiveMenuMeshes(mode) {
      if (!isGlasses) return [];
      if (mode === 'welcome' || mode === 'result') {
        return [primaryBtn.hitMesh, secondaryBtn.hitMesh];
      }
      return [];
    },
    stats: () => ({
      plaqueVisible: group.visible,
      plaquePos: group.position.toArray().map(n => Number(n.toFixed(3))),
      plaqueScale: plaqueMesh.scale.toArray().map(n => Number(n.toFixed(3))),
      primaryMenuVisible: primaryBtn.group.visible,
      secondaryMenuVisible: secondaryBtn.group.visible,
      lockVisible: lockGroup.visible,
      lockHudVisible: lockGroup.visible && lockHudMesh.visible,
      offscreenDirection,
      skillBannerVisible: skillBannerMesh.visible,
    }),
    update({
      mode,
      difficulty = 'normal',
      assetsReady = true,
      battle,
      lockedTarget,
      nearestTarget = null,
      gazeOnTarget = false,
      hoveredMenuId = null,
      menuProgress = 0,
      gazeDwellMs = 2000,
      deviceModel = '',
      handTracking = false,
      handActive = false,
      gestureHint = '',
      camera,
      xrSessionActive,
      megaSynced,
      nowSec = 0,
      dt = 0.016,
    }) {
      if (isGlasses) {
        group.visible = true;
      } else {
        group.visible = mode === 'welcome' && window.innerWidth >= 700;
      }

      // Smoothly transition Plaque between Phase A (centered 3D welcome/result card) & Phase B (slim 1:1 top-rim bar)
      if (isGlasses) {
        if (mode === 'battle') {
          targetPlaquePos.set(battle.player.x || 0, 1.85, (battle.player.z || 0) - 2.24);
          targetPlaqueScale.set(0.8, 0.8, 1);
        } else {
          targetPlaquePos.set(0.04, 1.81, -2.16);
          targetPlaqueScale.set(1, 1, 1);
        }
        group.position.lerp(targetPlaquePos, Math.min(1, dt * 10));
        plaqueMesh.scale.lerp(targetPlaqueScale, Math.min(1, dt * 10));
      }

      // Phase A Dual 3D Spatial Menu Buttons
      const descriptors = getMenuDescriptors(mode, difficulty);
      if (descriptors.length === 0) {
        primaryBtn.group.visible = false;
        secondaryBtn.group.visible = false;
      } else {
        const dwellBadge =
          gazeDwellMs > 0 ? `${Math.max(1, Math.round(gazeDwellMs / 1000))}s` : handTracking ? '捏合' : '轻点';
        for (const desc of descriptors) {
          desc.slot.group.visible = true;
          desc.slot.hitMesh.userData.menuId = desc.id;
          const hovered = hoveredMenuId === desc.id;
          const confirmHint =
            gazeDwellMs > 0
              ? `保持注视 ${dwellBadge} 自动确认 · 或${handTracking ? '右手捏合 / ' : ''}轻点触控板秒选`
              : `已关闭注视读秒 · 请${handTracking ? '右手隔空捏合 或 ' : ''}轻点触控板确认`;
          const idleHint = desc.secondary
            ? gazeDwellMs > 0
              ? `目光移此停留 ${dwellBadge} 切换${mode === 'welcome' ? '试炼难度' : '返回庭院'}`
              : `瞄准此牌后${handTracking ? '右手捏合' : '轻点触控板'}切换`
            : gazeDwellMs > 0
              ? `注视此牌 ${dwellBadge} 自动开战 · 不看屏轻点触控板亦可立即开战`
              : `${handTracking ? '右手隔空捏合' : '轻点触控板'}立即拔刀开战`;
          renderMenuSlot(desc.slot, {
            menuId: desc.id,
            secondary: desc.secondary,
            ready: assetsReady || desc.secondary,
            hovered,
            progress: hovered ? menuProgress : 0,
            dwellBadge,
            title: !assetsReady && !desc.secondary ? '正在唤醒炭治郎与藤花结界…' : desc.title,
            sub: hovered ? confirmHint : idleHint,
          });
          desc.slot.cardMesh.scale.setScalar(hovered ? 1.035 : 1.0);
        }
      }

      if (isGlasses) {
        const hazard = battle.hazards[0];
        const remaining = Math.max(0, Math.ceil(battle.bossAt - battle.progress));
        const cleanModel =
          deviceModel && deviceModel !== 'Phone' && deviceModel !== 'Browser' ? deviceModel : 'AR 眼镜';
        const inputTag = handTracking
          ? `${cleanModel} · 6DoF 手势`
          : `${cleanModel} · 双目透视盲滑`;

        if (mode === 'battle') {
          const handStatus = handActive
            ? '🖐️ 右手手势追踪中 · 左手推盘走位'
            : handTracking
              ? '🖐️ 抬右手出招 · 📱 盲操已自动兜底'
              : '📱 点斩 · 上拂水车 · 横拂/双击突刺 · 双指架盾';
          renderCompactBattleStrip({
            hp: Math.round(battle.hp),
            energy: Math.floor(battle.energy),
            danger: Boolean(hazard),
            guarding: Boolean(battle.guarding),
            rightTop: `${battle.kills} 击破 · ${battle.bossSpawned ? '决战堕姬' : `距鬼首 ${remaining}m`}`,
            rightBottom: hazard
              ? `【危】${hazard.label} ${hazard.remaining.toFixed(1)}s`
              : battle.guarding
                ? '【流流舞 · 水镜守势弹反中】'
                : handStatus,
            hintLine:
              gestureHint ||
              (difficulty === 'hashira' ? '柱合试炼 · ' : '') +
                (lockedTarget
                  ? `已锁${lockedTarget.boss ? '堕姬' : '恶鬼'}（转头不丢锁）· 目光扫向别处恶鬼即刻换锁`
                  : '目光扫过前方恶鬼零延迟秒锁'),
          });
        } else {
          renderFullPlaque({
            eyebrow: '鬼灭之刃 · 夜巡街道 WebXR 空间铭牌',
            badge: xrSessionActive ? inputTag : 'AR 眼镜待命',
            title:
              mode === 'welcome'
                ? '与炭治郎并肩 · 驻守藤花结界'
                : battle.status === 'victory'
                  ? '恶鬼退散 · 你与炭治郎守住了街道'
                  : '结界暂退 · 注视下方 3D 按钮再战',
            subtitle:
              mode === 'welcome'
                ? `当前试炼：${difficulty === 'hashira' ? '柱合试炼（高烈度）' : '夜巡标准'} · 平视下方按钮或轻点手机开战`
                : `本局击破 ${battle.kills} · 弹反/破招 ${battle.perfect} · 水车合击 ${battle.musouCount}`,
            footer: handTracking
              ? '右手手势（挥斩·画圈·前刺·握拳·张掌）与手机盲操动态协同 · 左手推盘走位'
              : '手机盲操：点按挥斩 · 上拂水车 · 左右拂突刺 · 双指架盾 · 按住走位',
          });
        }
      } else {
        renderFullPlaque({
          eyebrow: 'METATOUR WEBAR · 空间锚定铭牌',
          badge: megaSynced ? 'Mega 锚点已校准' : '2.2m 真人比例',
          title: '鬼灭之刃 · 藤花结界',
          subtitle: '地面 y = 0m · 核心展项位于正前方 2.2m · 宽度 ≤ 1.5m',
          footer: '支持元游手持全屏 WebAR / XREAL 眼镜手势+注视 WebXR / 桌面 3D 环视',
        });
      }

      // Update 3D Sticky Gaze Lock Halo + Overhead 3D Enemy HP/Hazard Tag
      const showLock = mode === 'battle' && Boolean(lockedTarget && lockedTarget.hp > 0);
      lockGroup.visible = showLock;
      if (showLock && camera) {
        lockGroup.position.set(lockedTarget.x, 0.03, lockedTarget.z);
        lockBillboard.position.set(0, 1.04 * lockedTarget.size, 0);
        camera.getWorldPosition(camPosWorld);
        lockBillboard.lookAt(camPosWorld);

        const targetHazard = battle.hazards.find(
          h => (h.sourceId ?? h.source) === lockedTarget.id && h.remaining > 0,
        );
        const accent = targetHazard ? '#ff5d76' : lockedTarget.boss ? '#ffd27d' : '#7df9ff';
        lockGroundRing.material.color.set(accent);
        lockDiamond.material.color.set(accent);
        lockDiamond.rotation.z = Math.PI / 4 + Math.sin(nowSec * 4) * 0.08;
        lockOuterRing.rotation.z = -nowSec * 1.6;
        const s = (lockedTarget.boss ? 1.18 : 1.0) * (gazeOnTarget ? 1.05 : 0.98);
        lockGroup.scale.setScalar(s);

        if (isGlasses) {
          lockHudMesh.visible = true;
          const distToCam = Math.hypot(lockedTarget.x - camPosWorld.x, lockedTarget.z - camPosWorld.z);
          const distScale = Math.max(0.88, Math.min(1.12, distToCam / 3.1));
          lockHudMesh.position.set(0, 1.78 * lockedTarget.size, 0);
          lockHudMesh.scale.setScalar(distScale);
          lockHudMesh.lookAt(camPosWorld);
          const enemyTitle = lockedTarget.boss
            ? '上弦之陆 · 堕姬'
            : lockedTarget.role === 'caster'
              ? '血鬼术 · 咒血鬼'
              : '夜巡恶鬼';
          renderLockHud({
            boss: Boolean(lockedTarget.boss),
            name: enemyTitle,
            hp: Math.max(0, Math.ceil(lockedTarget.hp)),
            maxHp: Math.max(1, Math.ceil(lockedTarget.maxHp || 60)),
            hazardText: Boolean(targetHazard),
            subLine: targetHazard
              ? `【危 ${targetHazard.remaining.toFixed(1)}s】握拳/双指弹反 或 前刺破招！`
              : gazeOnTarget
                ? '视线已锁 · 挥斩 / 画圈水车 / 前刺'
                : '粘性保持（看别处恶鬼即换锁）',
          });
        }
      }

      // Update secondary dim diamond markers on unlocked alive demons (AR Glasses):
      const secondaryEnemies =
        isGlasses && mode === 'battle'
          ? battle.enemies.filter(e => e.hp > 0 && e.id !== lockedTarget?.id).slice(0, unlockedMarkers.length)
          : [];
      for (let i = 0; i < unlockedMarkers.length; i++) {
        const marker = unlockedMarkers[i];
        const foe = secondaryEnemies[i];
        marker.visible = Boolean(foe);
        if (foe && camera) {
          marker.position.set(foe.x, 1.62 * foe.size, foe.z);
          marker.lookAt(camPosWorld);
          marker.rotation.z = Math.PI / 4;
        }
      }

      // Update 3D Skill Callout Banner fade (follows player footwork so it stays centered in FOV)
      if (bannerTimer > 0) {
        bannerTimer = Math.max(0, bannerTimer - dt);
        const t = 1 - bannerTimer / Math.max(0.1, bannerDuration);
        const alpha = t < 0.14 ? t / 0.14 : t > 0.72 ? (1 - t) / 0.28 : 1;
        skillBannerMesh.visible = alpha > 0.02;
        skillBannerMesh.material.opacity = Math.max(0, Math.min(1, alpha));
        skillBannerMesh.position.set(battle.player.x || 0, 1.69, (battle.player.z || 0) - 2.18);
        if (camera) {
          camera.getWorldPosition(camPosWorld);
          skillBannerMesh.lookAt(camPosWorld);
        }
      } else if (skillBannerMesh.visible) {
        skillBannerMesh.visible = false;
      }

      // Update World-Space 3D Reticle + Off-FOV Chevrons (◀ / ▶)
      offscreenDirection = null;
      if (reticleGroup.visible && camera) {
        camera.getWorldPosition(worldPos);
        camera.getWorldDirection(worldDir);
        const dist = hoveredMenuId
          ? 2.11
          : gazeOnTarget && lockedTarget
            ? Math.max(1.4, Math.min(3.4, Math.hypot(lockedTarget.x, lockedTarget.z)))
            : 2.14;
        worldPos.addScaledVector(worldDir, dist);
        worldRoot.worldToLocal(worldPos);
        reticleGroup.position.copy(worldPos);
        camera.getWorldPosition(camPosWorld);
        reticleGroup.lookAt(camPosWorld);

        reticle.material.color.set(hoveredMenuId ? '#7df9ff' : gazeOnTarget ? '#ffd98e' : '#a5f1ec');
        reticle.scale.setScalar(hoveredMenuId ? 1.32 + menuProgress * 0.35 : gazeOnTarget ? 1.18 : 1.0);

        const guideEnemy = mode === 'battle' ? lockedTarget || nearestTarget : null;
        if (guideEnemy && guideEnemy.hp > 0) {
          enemyLocalToCam.set(guideEnemy.x, 1.15, guideEnemy.z).applyMatrix4(worldRoot.matrixWorld);
          enemyLocalToCam.sub(camPosWorld);
          camera.getWorldQuaternion(camInvQuat).invert();
          enemyLocalToCam.applyQuaternion(camInvQuat);
          // In Three.js camera space: -Z is forward, -X is viewer's LEFT, +X is viewer's RIGHT.
          // reticleGroup.lookAt(camPosWorld) aligns local +Z to camera and local +X to viewer's RIGHT.
          const yawOff = Math.atan2(enemyLocalToCam.x, -enemyLocalToCam.z);
          if (Math.abs(yawOff) > 0.3) {
            const pulse = 0.88 + Math.sin(nowSec * 9) * 0.16;
            if (yawOff < 0) {
              offscreenDirection = 'left';
              chevronLeft.position.set(-0.115, 0, 0);
              chevronLeft.visible = true;
              chevronRight.visible = false;
              chevronLeft.scale.setScalar(pulse);
            } else {
              offscreenDirection = 'right';
              chevronRight.position.set(0.115, 0, 0);
              chevronRight.visible = true;
              chevronLeft.visible = false;
              chevronRight.scale.setScalar(pulse);
            }
          } else {
            chevronLeft.visible = false;
            chevronRight.visible = false;
          }
        } else {
          chevronLeft.visible = false;
          chevronRight.visible = false;
        }
      }
    },
  };
}
