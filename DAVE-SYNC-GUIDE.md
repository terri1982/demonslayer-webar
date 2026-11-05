# 鬼灭之刃 Web3D → 元游 WebAR 版（v1.4.0）双模与横竖屏改造同步说明（供 Dave 对齐）

本文档整理了「元游 WebAR 版」（`com.sightp.metatour.webar` v1.4.0）最新官方网页适配规范、手机手持横竖屏自动旋转与紧凑 HUD 排布要点，以及我们已经跑通真机实测的参考实现，供上游 `demonslayerAR`（`tools/musou/ar/`）对齐参考。

---

## 1. 核心入口与在线验证地址

- **元游 WebAR 版官网与 APK 下载页（v1.4.0）**：https://terri.sightp.com/projects/yuanyou-webar-browser/
- **鬼灭之刃双模 WebAR 独立验证版（HTTPS 线上地址）**：https://terri1982.github.io/demonslayer-webar/
- **鬼灭之刃双模 WebAR 独立仓库**：https://github.com/terri1982/demonslayer-webar

---

## 2. 容器运行时关键对齐点（v1.4.0 真机横竖屏验证总结）

在原版 `demonslayerAR/tools/musou/ar/` 基础上，适配「元游 WebAR 版 v1.4.0」需重点对齐以下 7 项：

1. **清晰的中文 `<title>`（联动顶部胶囊栏与「大家都在玩」广场）**
   - 建议设置为 `<title>鬼灭之刃 · 夜巡街道</title>`：容器顶部胶囊栏会直接显示简明标题，且用户在历史记录勾选「共享」后会以该 `<title>` 展示在「大家都在玩」共享广场中。
2. **双模无竞态识别（`src/container-bridge.js`）**
   - 同时检查 `window.__XREAL_CONTAINER__ === true`、`window.MetaTourWebAR?.getMode?.() === 'glasses'` 以及原生同步 `@JavascriptInterface`（`window.XrealNativePose` / `window.AndroidXrealBridge`），避免缓存刷新时 `evaluateJavascript` 注入时序竞态。
3. **AR 眼镜模式（`isGlasses === true`）严禁抢占摄像头 & 纯黑透明背景**
   - 隐藏全部 DOM 2D 按钮与 HUD，所有标题与战斗状态用 `CanvasTexture` 绘制在 `scene` 世界空间 3D 铭牌上（正前方 `-2.25m`、高度 `1.45m`、宽 `1.36m`）。
   - WebGL 设为 `alpha: false`、`renderer.setClearColor(0x000000, 1)`（光学透视眼镜中纯黑即透明），**严禁调用 `navigator.mediaDevices.getUserMedia`**。
   - 自动请求 `navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] })`，启用 `renderer.xr.enabled = true` 与 `renderer.setAnimationLoop(...)`。
4. **所有 3D 对象（含刀光特效）挂在 `scene` 世界根节点，不挂 `camera`**
   - 原版 `ar/slash.js` 将刀光 mesh 挂在 `camera` 下；在双目 WebXR / 6DoF 转头时会粘在鼻尖抖动。改造后统一挂入 `scene` 世界空间，根据当前 `camera.matrixWorld` 计算世界挥刀弧线。
5. **手机手持 60Hz 原生姿态与 `pose.screenAngle` 横竖屏补偿（关键！）**
   - `v1.4.0` 手持模式默认开启传感器自由横竖屏（也可按需调用 `window.MetaTourWebAR?.setPreferredOrientation?.('auto' | 'landscape' | 'portrait')`），并通过 `window.MetaTourWebAR.onPose(pose => ...)` 推送 ENU 四元数 `{x, y, z, w}` 与屏幕旋转角 `pose.screenAngle`（`0 / 90 / 180 / 270`）。
   - 网页端必须先左乘 `ENU_TO_THREE_WORLD = R_x(-Math.PI / 2)`，再右乘 `R_z(-degToRad(pose.screenAngle))` 转换到 Three.js `Y`-up 世界坐标系，并在 `window.MetaTourWebAR?.onOrientationChange?.(...)` / `resize` 时实时更新渲染器尺寸与相机 `aspect`。
6. **手机横屏高密度 UI 排布与 `--metatour-top-inset` 防重复叠加（实机踩坑重点！）**
   - 容器手持模式注入 `--metatour-top-inset`（竖屏 `76px`、横屏紧凑胶囊栏 `60px`）。安卓旗舰（如 Samsung S22 横屏 CSS 视口仅 `780×360`）扣除顶部 `60px` 后可用高度仅 **`300px`**：
     - **严禁重复叠加安全区**：若 `.hud-top` 已用 `top: calc(var(--metatour-top-inset, 0px) + 4px)` 定位，横屏媒体查询切勿再加 `padding-top: var(--metatour-top-inset)`，否则顶部栏下移至 `~132px` 会直接撞上中央准星与提示条。
     - **战斗 HUD 分层无碰撞**：横屏下中央计分牌改为单行胶囊，提示条（`+42px`）、危字预警（`+68px`）、准星（`52%`）分层排布；圆形技能按钮（如「水车」）用 `padding: 0` + Flex 居中，避免横向 `padding` 挤压文字溢出圆环。
     - **首屏与暂停弹窗双列布局**：横屏高度 `<= 520px` 时，首屏卡片固定左侧（右侧通过 `camera.setViewOffset` 留白完整展示 3D 炭治郎与鸟居），按钮与暂停弹窗选项改为双列网格，确保在 `360px` 高度内零滚动、零底部裁切。
7. **可选 EasyAR Mega 空间锚点平滑消漂桥接**
   - 拿到 Mega 位姿后调用 `window.MetaTourWebAR?.applyMegaPose({ anchorId, position, quaternion, confidence, referenceSpace: 'local-floor' })`，由容器底层以每帧 `<= 3.5cm` 平滑融合消漂，网页端不直接瞬移跳变相机矩阵。

---

## 3. 官方最新版「一键复制 AI 适配提示词」原文（v1.4.0）

```text
请帮我做一个同时适配「手机后置相机手持 WebAR（含横竖屏）」与「AR 眼镜双目透视 WebXR」的空间网页，并发布成一个 HTTPS 网址。请从零完成代码编写与静态托管指引，最后告诉我最终 HTTPS 网址。

【运行容器与观看方式】
- 容器 App：「元游 WebAR 版」（包名 `com.sightp.metatour.webar`，下载地址 https://terri.sightp.com/projects/yuanyou-webar-browser/ ）。
- 网页建议填写清晰的中文 `<title>`（例如 `<title>景区名 · 空间导览名称</title>`）：用户在「元游 WebAR 版」历史记录里勾选「☐ 共享」后，会自动读取 `<title>` 出现在所有「元游 WebAR 版」首页的「大家都在玩」共享广场中。
- 一个链接同时支持三种打开方式，网页必须自动适配：
  1. 手机手持模式（未插 AR 眼镜时在「元游 WebAR 版」或系统手机浏览器打开）：全屏开启手机后置摄像头实景（`getUserMedia` `facingMode: 'environment'`）叠加透明 Three.js 3D 场景，默认支持手机竖屏与横屏自动旋转，结合 60Hz 原生姿态（`window.MetaTourWebAR`）与触控环视。
  2. AR 眼镜模式（手机或 Beam Pro 连接 XREAL Air 2 Ultra 等眼镜打开）：容器自动注入 `window.__XREAL_CONTAINER__ = true` 与标准 WebXR（`navigator.xr` `immersive-vr`、`local-floor`）及原生零延迟 ATW 合成，输出双目 6DoF/3DoF 光学透视画面。
  3. 无相机 / 桌面浏览器降级模式（电脑 1440px 打开或用户拒绝相机权限）：绝不白屏或报错，自动显示美观的渐层背景 + 可鼠标/触控拖动的 3D 预览，并提供清晰的中文提示按钮。

【网页开发规范】
1. 纯静态技术栈：
   - 使用 Three.js（建议 r150–r165），纯静态结构（`index.html` + 本地相对路径资源文件夹），将 `three`、`.glb` 模型与 `.webp/.png` 贴图保存在同目录，不依赖境外不稳定 CDN。
2. 双模自动分流与手机横竖屏规范（关键！）：
   - 先检测眼镜容器：`const isGlasses = !!window.__XREAL_CONTAINER__;`（或 `window.MetaTourWebAR?.getMode() === 'glasses'`）。
   - 【当在 AR 眼镜模式（`isGlasses === true`）】：
     - 隐藏所有 HTML 按钮和 2D 浮层（眼镜光学透视中不需要 2D 网页栏，需展示的导览标题请用 `CanvasTexture` 做成世界空间 3D 铭牌）。
     - WebGL 背景设为纯黑不透明（`setClearColor(0x000000, 1)`，光学透视眼镜中纯黑即完全透明），**禁止在眼镜模式下调用 `getUserMedia` 抢占摄像头**。
     - 自动调用 `navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] })`，启用 `renderer.xr.enabled = true` 与 `renderer.setAnimationLoop(...)`。
   - 【当在手机手持或普通浏览器模式（`isGlasses === false`）】：
     - WebGL 设为透明通道（`alpha: true`, `setClearColor(0x000000, 0)`），底层铺满 `<video autoplay playsinline muted>`。
     - 调用 `navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' } } })` 开启后置相机；若权限被拒或无摄像头，捕获异常并平滑保留 3D 触控/陀螺仪预览，不弹原生报错框。
     - 横竖屏方向控制：手持容器默认开启传感器自由横竖屏（`auto`）；若作品专为横屏宽画幅设计，可在初始化时调用 `window.MetaTourWebAR?.setPreferredOrientation?.('landscape')`（支持 `'auto' | 'landscape' | 'portrait'`）。顶部 HUD 请预留 `padding-top: var(--metatour-top-inset, calc(max(12px, env(safe-area-inset-top)) + 60px))` 避开容器胶囊栏与摄像头挖孔。
     - 60Hz 原生姿态与横竖屏角度补偿（防止横屏画面倾斜 90°）：优先读取 `window.MetaTourWebAR?.onPose(pose => ...)`。`pose` 包含硬件传感器 ENU 四元数 `{x, y, z, w}` 与当前屏幕旋转角 `pose.screenAngle`（`0 / 90 / 180 / 270`）。转换到 Three.js 相机四元数的标准公式为：
       `const ENU_TO_THREE = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);`
       `camQuat.set(pose.x, pose.y, pose.z, pose.w).normalize().premultiply(ENU_TO_THREE);`
       `if (pose.screenAngle) camQuat.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -THREE.MathUtils.degToRad(pose.screenAngle)));`
       普通浏览器回退使用 `DeviceOrientationEvent` + 触控拖拽，并在 `window.addEventListener('resize', ...)` 中实时更新渲染尺寸与相机 `aspect`。
     - 若检测到 `window.MetaTourWebAR?.isGlassesConnected()` 为 `true`，可在页面显示「投送到 AR 眼镜」按钮，点击调用 `window.MetaTourWebAR.switchToGlasses()`。
3. 空间尺寸与性能：
   - 世界坐标单位为米，地面 `y = 0`，正前方为 `-Z`。核心展项放在正前方约 `2.0–2.5` 米、高度 `1.2–1.6` 米处，整体宽度控制在 `1.5` 米内。
   - 所有 3D 内容挂在 `scene` 世界根节点下，切勿挂在 `camera` 下，确保转头与走动时模型稳固锚定在真实空间。
   - 单帧 Draw Call 控制在 150 以内，单个 GLB 小于 10MB，不使用重度后处理 Bloom 或实时阴影。
4. （可选）接入 EasyAR Mega 云定位空间锚点消漂：
   - 若业务已接入 EasyAR Mega WebAR 定位，拿到云端空间锚点位姿后直接调用：
     `window.MetaTourWebAR?.applyMegaPose({ anchorId, position: {x, y, z}, quaternion: {x, y, z, w}, confidence, referenceSpace: 'local-floor' })`
   - 容器底层会自动以每帧 `<= 3.5cm` 的平滑速率融合修正 SLAM 漂移，严禁网页端直接瞬移跳变相机矩阵。

【发布与自检要求】
- 必须部署为 **HTTPS** 网址（WebXR、摄像头 `getUserMedia` 与「大家都在玩」共享广场均要求公网 HTTPS 安全上下文）。
- 交付前请自检桌面 `1440px`、手机竖屏 `390×844` 与手机横屏 `844×390` 三个视口：首屏排版无遮挡、无文字裁切、无横向滚动条、控制台零报错，并附上最终 HTTPS 链接与测试说明。
```
