import * as T from 'three';

// World-space 3D nameplate & spatial HUD built with CanvasTexture under scene worldRoot.
// Placed at (0, 1.48, -2.35): 2.35m ahead (-Z), 1.48m height (1.2-1.6m), 1.08m width (<= 1.5m).
// In AR Glasses mode (isGlasses === true), all 2D HTML UI is hidden and this 3D plaque serves
// as the zero-glare optical see-through spatial guide & combat HUD.
export function createWorldPlaque(worldRoot, { isGlasses = false } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 352;
  const ctx = canvas.getContext('2d');

  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = 4;

  const group = new T.Group();
  // Side-by-side to the right of Tanjiro (-0.46m): spans x = [-0.15m, +0.69m] (within <= 1.5m stage),
  // y = 1.46m (inside 1.2-1.6m), z = -2.16m (inside 2.0-2.5m), zero hair occlusion!
  group.position.set(0.27, 1.46, -2.16);
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

  // World-space 3D gaze reticle for AR Glasses mode (mounted under worldRoot, never under camera).
  const reticle = new T.Mesh(
    new T.RingGeometry(0.026, 0.036, 40),
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
  const worldDir = new T.Vector3();
  const worldPos = new T.Vector3();

  function drawRoundedRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function renderPlaque(state) {
    const sig = JSON.stringify(state);
    if (sig === lastSignature) return;
    lastSignature = sig;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Translucent dark slate backing (near-black outer feather for optical see-through comfort).
    const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    grad.addColorStop(0, 'rgba(10, 22, 34, 0.92)');
    grad.addColorStop(0.5, 'rgba(17, 34, 49, 0.92)');
    grad.addColorStop(1, 'rgba(12, 24, 38, 0.92)');
    drawRoundedRect(16, 16, canvas.width - 32, canvas.height - 32, 22);
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.lineWidth = 3;
    ctx.strokeStyle = state.danger ? 'rgba(255, 108, 130, 0.92)' : 'rgba(165, 241, 236, 0.78)';
    ctx.stroke();

    // Top eyebrow
    ctx.fillStyle = '#e9ce9a';
    ctx.font = '600 22px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(state.eyebrow, 48, 66);

    // Right badge
    ctx.textAlign = 'right';
    ctx.fillStyle = '#a5f1ec';
    ctx.font = '600 22px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(state.badge, canvas.width - 48, 66);
    ctx.textAlign = 'left';

    // Main title
    ctx.fillStyle = '#f2f9f7';
    ctx.font = '700 44px "PingFang SC", "Microsoft YaHei", serif';
    ctx.fillText(state.title, 48, 132);

    // Subtitle / live battle instruction
    ctx.fillStyle = state.danger ? '#ffb5c0' : '#cde2e4';
    ctx.font = '500 26px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(state.subtitle, 48, 184);

    if (state.showBars) {
      // HP bar
      ctx.fillStyle = '#9fc2c6';
      ctx.font = '600 22px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillText(`守备 ${state.hp}%`, 48, 242);

      drawRoundedRect(185, 222, 290, 18, 9);
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fill();
      drawRoundedRect(185, 222, Math.max(8, 2.9 * state.hp), 18, 9);
      ctx.fillStyle = state.hp > 35 ? '#9ef0c8' : '#ff697d';
      ctx.fill();

      // Energy bar
      ctx.fillStyle = '#c4a7f3';
      ctx.fillText(`水车 ${state.energy}%`, 520, 242);
      drawRoundedRect(658, 222, 310, 18, 9);
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fill();
      drawRoundedRect(658, 222, Math.max(8, 3.1 * state.energy), 18, 9);
      ctx.fillStyle = state.energy >= 100 ? '#7df9ff' : '#9f87ec';
      ctx.fill();

      // Footer telemetry
      ctx.fillStyle = '#e9ce9a';
      ctx.font = '500 23px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillText(state.footer, 48, 300);
    } else {
      ctx.fillStyle = '#a5f1ec';
      ctx.font = '500 24px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillText(state.footer, 48, 272);
    }

    texture.needsUpdate = true;
  }

  return {
    group,
    reticle,
    update({ mode, battle, target, camera, xrSessionActive, megaSynced }) {
      // In AR Glasses mode (all 2D HTML hidden), always display the 3D CanvasTexture world plaque.
      // On desktop (>= 700px) welcome screen, show it side-by-side with Tanjiro; on narrow 390px portrait, keep 3D view uncluttered above the bottom card.
      if (isGlasses) {
        group.visible = true;
      } else {
        group.visible = mode === 'welcome' && window.innerWidth >= 700;
      }

      if (isGlasses) {
        const hazard = battle.hazards[0];
        const remaining = Math.max(0, Math.ceil(battle.bossAt - battle.progress));
        renderPlaque({
          eyebrow: '鬼灭之刃 · 夜巡街道 WebXR 空间铭牌',
          badge: xrSessionActive ? '双目光学透视 · 6DoF' : 'AR 眼镜待命',
          title:
            mode === 'result'
              ? battle.status === 'victory'
                ? '恶鬼退散 · 你与炭治郎守住了街道'
                : '结界暂退 · 捏合或点击再次迎战'
              : battle.bossSpawned
                ? '上弦之陆 · 堕姬现身！'
                : '与炭治郎并肩 · 守护藤花结界',
          subtitle: hazard
            ? `【危】${hazard.label} ${hazard.remaining.toFixed(1)}s · 左右侧移头部闪避！`
            : target
              ? `已锁定${target.boss ? '堕姬' : '恶鬼'}（HP ${Math.ceil(target.hp)}）· 注视自动连斩 / 扳机重击`
              : '注视前方恶鬼自动挥刀 · 蓄满自动释放水之呼吸贰之型·水车',
          showBars: true,
          hp: Math.round(battle.hp),
          energy: Math.floor(battle.energy),
          danger: Boolean(hazard),
          footer: `击破 ${battle.kills} · ${battle.bossSpawned ? '决战鬼首' : `距鬼首 ${remaining}m`}${megaSynced ? ' · Mega 空间锚点已融合' : ''}`,
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
          footer: '支持元游手持后置相机 WebAR / XREAL 眼镜双目透视 / 桌面 3D 触控环视',
        });
      }

      if (reticle.visible && camera) {
        camera.getWorldPosition(worldPos);
        camera.getWorldDirection(worldDir);
        const dist = target ? Math.max(1.4, Math.min(3.5, Math.hypot(target.x, target.z))) : 2.15;
        worldPos.addScaledVector(worldDir, dist);
        worldRoot.worldToLocal(worldPos);
        reticle.position.copy(worldPos);
        reticle.lookAt(camera.position);
        reticle.material.color.set(target ? '#7df9ff' : '#a5f1ec');
        reticle.scale.setScalar(target ? 1.25 : 1.0);
      }
    },
  };
}
