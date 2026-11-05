import * as T from 'three';

// World-space 3D nameplate, 3D Gaze-Dwell Spatial Menu Button, and 3D Sticky Lock-On Halo
// built with CanvasTexture & lightweight RingGeometry strictly under scene worldRoot (never under camera).
// In AR Glasses mode (isGlasses === true), all 2D HTML UI is hidden and these 3D elements serve
// as the zero-glare optical see-through spatial guide, 2s Gaze-Dwell menu, and Sticky Gaze Lock HUD.
export function createWorldPlaque(worldRoot, { isGlasses = false } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 352;
  const ctx = canvas.getContext('2d');

  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = 4;

  const group = new T.Group();
  // Side-by-side to the right of Tanjiro (-0.46m): spans x = [-0.15m, +0.69m] (within <= 1.5m stage).
  // In XREAL optical see-through (local-floor standingHeight = 1.55m, vertical FOV tan = +-0.218 -> +-0.47m at 2.15m),
  // placing plaque at y = 1.58m and 3D button at y = 1.29m keeps BOTH simultaneously inside a single 25-deg vertical FOV!
  group.position.set(0.27, isGlasses ? 1.58 : 1.48, -2.16);
  worldRoot.add(group);

  const plaqueMesh = new T.Mesh(
    new T.PlaneGeometry(0.84, 0.29),
    new T.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      side: T.DoubleSide,
    }),
  );
  group.add(plaqueMesh);

  // --- Phase A: 3D Spatial Menu Button (2.14m ahead, inside 2.0m ~ 2.4m ergonomic plane) ---
  const menuCanvas = document.createElement('canvas');
  menuCanvas.width = 1024;
  menuCanvas.height = 304;
  const menuCtx = menuCanvas.getContext('2d');
  const menuTexture = new T.CanvasTexture(menuCanvas);
  menuTexture.colorSpace = T.SRGBColorSpace;
  menuTexture.anisotropy = 4;

  const menuGroup = new T.Group();
  menuGroup.position.set(0.2, 1.29, -2.14);
  menuGroup.visible = false;
  worldRoot.add(menuGroup);

  const menuCardMesh = new T.Mesh(
    new T.PlaneGeometry(0.76, 0.225),
    new T.MeshBasicMaterial({
      map: menuTexture,
      transparent: true,
      depthWrite: false,
      side: T.DoubleSide,
    }),
  );
  menuGroup.add(menuCardMesh);

  // Invisible slightly padded hit plane so head-gaze dwell stays rock-steady against micro head tremor:
  const menuHitMesh = new T.Mesh(
    new T.PlaneGeometry(0.96, 0.34),
    new T.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: T.DoubleSide,
    }),
  );
  menuHitMesh.userData.menuId = 'btn-start-battle';
  menuGroup.add(menuHitMesh);

  // --- Phase B: 3D Sticky Gaze Lock Halo (stays anchored on lockedEnemy even when looking away!) ---
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
    new T.RingGeometry(0.19, 0.225, 4),
    new T.MeshBasicMaterial({
      color: '#7df9ff',
      transparent: true,
      opacity: 0.92,
      side: T.DoubleSide,
      depthWrite: false,
      depthTest: false,
      blending: T.AdditiveBlending,
    }),
  );
  const lockOuterRing = new T.Mesh(
    new T.RingGeometry(0.26, 0.282, 36),
    new T.MeshBasicMaterial({
      color: '#ffe09c',
      transparent: true,
      opacity: 0.72,
      side: T.DoubleSide,
      depthWrite: false,
      depthTest: false,
      blending: T.AdditiveBlending,
    }),
  );
  lockBillboard.add(lockDiamond, lockOuterRing);

  // World-space 3D gaze reticle for AR Glasses mode (mounted under worldRoot, never under camera).
  const reticle = new T.Mesh(
    new T.RingGeometry(0.024, 0.034, 40),
    new T.MeshBasicMaterial({
      color: '#a5f1ec',
      transparent: true,
      opacity: 0.9,
      side: T.DoubleSide,
      depthWrite: false,
      depthTest: false,
    }),
  );
  reticle.visible = isGlasses;
  worldRoot.add(reticle);

  let lastSignature = '';
  let lastMenuSignature = '';
  const worldDir = new T.Vector3();
  const worldPos = new T.Vector3();
  const camPosWorld = new T.Vector3();

  function drawRoundedRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function renderPlaque(state) {
    const sig = JSON.stringify(state);
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
    ctx.strokeStyle = state.danger ? 'rgba(255, 108, 130, 0.92)' : 'rgba(165, 241, 236, 0.78)';
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
    ctx.fillText(state.title, 48, 130, canvas.width - 96);

    ctx.fillStyle = state.danger ? '#ffb5c0' : '#cde2e4';
    ctx.font = '500 25px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(state.subtitle, 48, 182, canvas.width - 96);

    if (state.showBars) {
      ctx.fillStyle = '#9fc2c6';
      ctx.font = '600 22px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillText(`守备 ${state.hp}%`, 48, 240);

      drawRoundedRect(ctx, 185, 220, 290, 18, 9);
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fill();
      drawRoundedRect(ctx, 185, 220, Math.max(8, 2.9 * state.hp), 18, 9);
      ctx.fillStyle = state.hp > 35 ? '#9ef0c8' : '#ff697d';
      ctx.fill();

      ctx.fillStyle = '#c4a7f3';
      ctx.fillText(`水车 ${state.energy}%`, 520, 240);
      drawRoundedRect(ctx, 658, 220, 310, 18, 9);
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fill();
      drawRoundedRect(ctx, 658, 220, Math.max(8, 3.1 * state.energy), 18, 9);
      ctx.fillStyle = state.energy >= 100 ? '#7df9ff' : '#9f87ec';
      ctx.fill();

      ctx.fillStyle = '#e9ce9a';
      ctx.font = '500 22px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillText(state.footer, 48, 298, canvas.width - 96);
    } else {
      ctx.fillStyle = '#a5f1ec';
      ctx.font = '500 23px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillText(state.footer, 48, 272, canvas.width - 96);
    }

    texture.needsUpdate = true;
  }

  function renderSpatialMenuButton(state) {
    const bucketProgress = Math.round(state.progress * 50) / 50;
    const sig = `${state.menuId}|${state.ready}|${state.hovered}|${bucketProgress}|${state.title}|${state.sub}`;
    if (sig === lastMenuSignature) return;
    lastMenuSignature = sig;

    menuCtx.clearRect(0, 0, menuCanvas.width, menuCanvas.height);

    const grad = menuCtx.createLinearGradient(0, 0, menuCanvas.width, menuCanvas.height);
    if (state.hovered) {
      grad.addColorStop(0, 'rgba(24, 96, 108, 0.96)');
      grad.addColorStop(1, 'rgba(18, 56, 84, 0.96)');
    } else {
      grad.addColorStop(0, 'rgba(14, 42, 58, 0.92)');
      grad.addColorStop(1, 'rgba(12, 28, 46, 0.92)');
    }
    drawRoundedRect(menuCtx, 14, 14, menuCanvas.width - 28, menuCanvas.height - 28, 26);
    menuCtx.fillStyle = grad;
    menuCtx.fill();

    menuCtx.lineWidth = state.hovered ? 5 : 3;
    menuCtx.strokeStyle = state.hovered ? '#7df9ff' : 'rgba(158, 243, 237, 0.68)';
    menuCtx.stroke();

    // Left circular Gaze-Dwell progress gauge (0% -> 100%)
    const cx = 118;
    const cy = 152;
    const radius = 64;
    menuCtx.beginPath();
    menuCtx.arc(cx, cy, radius, 0, Math.PI * 2);
    menuCtx.lineWidth = 10;
    menuCtx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    menuCtx.stroke();

    if (bucketProgress > 0) {
      menuCtx.beginPath();
      menuCtx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * bucketProgress);
      menuCtx.lineWidth = 12;
      menuCtx.lineCap = 'round';
      menuCtx.strokeStyle = '#7df9ff';
      menuCtx.stroke();
    }

    menuCtx.textAlign = 'center';
    menuCtx.textBaseline = 'middle';
    menuCtx.fillStyle = state.hovered ? '#7df9ff' : '#ecd09c';
    menuCtx.font = '700 30px "PingFang SC", "Microsoft YaHei", sans-serif';
    menuCtx.fillText(
      !state.ready ? '载入' : bucketProgress > 0.02 ? `${Math.round(bucketProgress * 100)}%` : '2s',
      cx,
      cy,
    );

    menuCtx.textAlign = 'left';
    menuCtx.textBaseline = 'alphabetic';
    menuCtx.fillStyle = '#f5fbfa';
    menuCtx.font = '700 44px "PingFang SC", "Microsoft YaHei", sans-serif';
    menuCtx.fillText(state.title, 218, 128, menuCanvas.width - 260);

    menuCtx.fillStyle = state.hovered ? '#a8fbff' : '#c6dfe2';
    menuCtx.font = '500 26px "PingFang SC", "Microsoft YaHei", sans-serif';
    menuCtx.fillText(state.sub, 218, 186, menuCanvas.width - 260);

    // Bottom dwell progress bar
    drawRoundedRect(menuCtx, 218, 222, 742, 16, 8);
    menuCtx.fillStyle = 'rgba(255, 255, 255, 0.14)';
    menuCtx.fill();
    if (bucketProgress > 0) {
      drawRoundedRect(menuCtx, 218, 222, Math.max(16, 742 * bucketProgress), 16, 8);
      menuCtx.fillStyle = '#7df9ff';
      menuCtx.fill();
    }

    menuTexture.needsUpdate = true;
  }

  return {
    group,
    menuGroup,
    menuHitMesh,
    lockGroup,
    reticle,
    getActiveMenuId(mode) {
      if (!isGlasses) return null;
      if (mode === 'welcome') return 'btn-start-battle';
      if (mode === 'result') return 'btn-play-again';
      return null;
    },
    update({
      mode,
      assetsReady = true,
      battle,
      lockedTarget,
      gazeOnTarget = false,
      hoveredMenuId = null,
      menuProgress = 0,
      gestureHint = '',
      handTracking = false,
      camera,
      xrSessionActive,
      megaSynced,
      nowSec = 0,
    }) {
      if (isGlasses) {
        group.visible = true;
      } else {
        group.visible = mode === 'welcome' && window.innerWidth >= 700;
      }

      const activeMenuId = isGlasses
        ? mode === 'welcome'
          ? 'btn-start-battle'
          : mode === 'result'
            ? 'btn-play-again'
            : null
        : null;
      menuGroup.visible = Boolean(activeMenuId);
      if (activeMenuId) {
        menuHitMesh.userData.menuId = activeMenuId;
        const hovered = hoveredMenuId === activeMenuId;
        renderSpatialMenuButton({
          menuId: activeMenuId,
          ready: assetsReady,
          hovered,
          progress: hovered ? menuProgress : 0,
          title: !assetsReady
            ? '正在唤醒炭治郎与藤花结界…'
            : activeMenuId === 'btn-start-battle'
              ? '拔刀开战 · 守护藤花结界'
              : '再来一局 · 重新拔刀迎战',
          sub: hovered
            ? '保持注视读条确认 · 或右手捏合 / 轻点手机盲操板立即进入'
            : '目光移至此 3D 牌停留 2 秒 · 或右手捏合 / 轻点触控板',
        });
        menuCardMesh.scale.setScalar(hovered ? 1.04 : 1.0);
      }

      if (isGlasses) {
        const hazard = battle.hazards[0];
        const remaining = Math.max(0, Math.ceil(battle.bossAt - battle.progress));
        const inputTag = handTracking ? '6DoF 右手隔空手势' : '双目透视 · 盲操/手势';
        const lockName = lockedTarget
          ? `${lockedTarget.boss ? '堕姬' : lockedTarget.role === 'caster' ? '血术鬼' : '恶鬼'} HP ${Math.ceil(lockedTarget.hp)}`
          : '';
        renderPlaque({
          eyebrow: '鬼灭之刃 · 夜巡街道 WebXR 空间铭牌',
          badge: xrSessionActive ? inputTag : 'AR 眼镜待命',
          title:
            mode === 'welcome'
              ? '与炭治郎并肩 · 驻守藤花结界'
              : mode === 'result'
                ? battle.status === 'victory'
                  ? '恶鬼退散 · 你与炭治郎守住了街道'
                  : '结界暂退 · 注视下方 3D 按钮再战'
                : battle.bossSpawned
                  ? '上弦之陆 · 堕姬现身！'
                  : '夜巡迎敌 · 注视秒锁恶鬼',
          subtitle:
            mode === 'welcome'
              ? '免低头体验：盯住下方「拔刀开战」2 秒或右手捏合即可开战'
              : mode === 'result'
                ? `本局击破 ${battle.kills} · 弹反/闪避 ${battle.perfect} · 水车合击 ${battle.musouCount}`
                : hazard
                  ? `【危】${hazard.label} ${hazard.remaining.toFixed(1)}s · 握拳架刀弹反 或 侧移闪避！`
                  : battle.guarding
                    ? '【流流舞·守势架刀中】松拳解除 · 自动弹反恶鬼红光攻击并聚气'
                    : lockedTarget
                      ? `已持续锁定 ${lockName}${gazeOnTarget ? '' : '（移开视线仍锁定）'} · 挥手斩 / 画圈水车 / 前刺`
                      : '目光扫过前方恶鬼零延迟秒锁 · 挥手斩 / 画圈水车 / 握拳格挡 / 张掌奥义',
          showBars: mode === 'battle',
          hp: Math.round(battle.hp),
          energy: Math.floor(battle.energy),
          danger: Boolean(hazard),
          footer:
            mode === 'battle'
              ? `${gestureHint ? `${gestureHint} · ` : ''}击破 ${battle.kills} · ${battle.bossSpawned ? '决战鬼首' : `距鬼首 ${remaining}m`}${megaSynced ? ' · Mega 已融合' : ''}`
              : '右手招式：挥手普攻 · 画圈水车 · 前刺重击 · 握拳格挡 · 张掌奥义（支持盲滑）',
        });
      } else {
        renderPlaque({
          eyebrow: 'METATOUR WEBAR · 空间锚定铭牌',
          badge: megaSynced ? 'Mega 锚点已校准' : '2.2m 真人比例',
          title: '鬼灭之刃 · 藤花结界',
          subtitle: '地面 y = 0m · 核心展项位于正前方 2.2m · 宽度 ≤ 1.5m',
          showBars: false,
          hp: 100,
          energy: 0,
          danger: false,
          footer: '支持元游手持全屏 WebAR / XREAL 眼镜手势+注视 WebXR / 桌面 3D 环视',
        });
      }

      // Update 3D Sticky Gaze Lock Halo on lockedTarget (stays locked even when head turns away!)
      const showLock = mode === 'battle' && Boolean(lockedTarget && lockedTarget.hp > 0);
      lockGroup.visible = showLock;
      if (showLock && camera) {
        lockGroup.position.set(lockedTarget.x, 0.03, lockedTarget.z);
        lockBillboard.position.set(0, 1.06 * lockedTarget.size, 0);
        camera.getWorldPosition(camPosWorld);
        lockBillboard.lookAt(camPosWorld);
        const accent = lockedTarget.boss ? '#ffd27d' : '#7df9ff';
        lockGroundRing.material.color.set(accent);
        lockDiamond.material.color.set(accent);
        lockDiamond.rotation.z = Math.PI / 4 + Math.sin(nowSec * 4) * 0.08;
        lockOuterRing.rotation.z = -nowSec * 1.6;
        const s = (lockedTarget.boss ? 1.24 : 1.0) * (gazeOnTarget ? 1.08 : 0.98);
        lockGroup.scale.setScalar(s);
      }

      if (reticle.visible && camera) {
        camera.getWorldPosition(worldPos);
        camera.getWorldDirection(worldDir);
        const dist =
          hoveredMenuId
            ? 2.12
            : gazeOnTarget && lockedTarget
              ? Math.max(1.4, Math.min(3.6, Math.hypot(lockedTarget.x, lockedTarget.z)))
              : 2.15;
        worldPos.addScaledVector(worldDir, dist);
        worldRoot.worldToLocal(worldPos);
        reticle.position.copy(worldPos);
        camera.getWorldPosition(camPosWorld);
        reticle.lookAt(camPosWorld);
        reticle.material.color.set(hoveredMenuId ? '#7df9ff' : gazeOnTarget ? '#ffd98e' : '#a5f1ec');
        reticle.scale.setScalar(hoveredMenuId ? 1.35 + menuProgress * 0.35 : gazeOnTarget ? 1.2 : 1.0);
      }
    },
  };
}
