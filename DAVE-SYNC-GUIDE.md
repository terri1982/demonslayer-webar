# 鬼灭之刃 Web3D → 元游 WebAR 浏览器（v1.2.0）双模改造同步说明（供 Dave 对齐）

本文档整理了「元游 WebAR 浏览器」（`com.sightp.metatour.webar` v1.2.0）最新官方网页适配规范、容器底层桥接注意事项，以及我们已经跑通真机实测的参考实现，供上游 `demonslayerAR`（`tools/musou/ar/`）对齐参考。

---

## 1. 核心入口与在线验证地址

- **元游 WebAR 浏览器官网与 APK 下载页（v1.2.0）**：https://terri.sightp.com/projects/yuanyou-webar-browser/
- **鬼灭之刃双模 WebAR 独立验证版（HTTPS 线上地址）**：https://terri1982.github.io/demonslayer-webar/
- **鬼灭之刃双模 WebAR 独立仓库**：https://github.com/terri1982/demonslayer-webar

---

## 2. 容器运行时关键对齐点（v1.2.0 实机验证总结）

在原版 `demonslayerAR/tools/musou/ar/` 基础上，适配「元游 WebAR 浏览器 v1.2.0」需重点对齐以下 6 项：

1. **双模无竞态识别（`src/container-bridge.js`）**
   - 同时检查 `window.__XREAL_CONTAINER__ === true`、`window.MetaTourWebAR?.getMode?.() === 'glasses'` 以及原生同步 `@JavascriptInterface`（`window.XrealNativePose` / `window.AndroidXrealBridge`），避免缓存刷新时 `evaluateJavascript` 注入时序竞态。
2. **AR 眼镜模式（`isGlasses === true`）严禁抢占摄像头 & 纯黑透明背景**
   - 隐藏全部 DOM 2D 按钮与 HUD，所有标题与战斗状态用 `CanvasTexture` 绘制在 `scene` 世界空间 3D 铭牌上（正前方 `-2.25m`、高度 `1.45m`、宽 `1.36m`）。
   - WebGL 设为 `alpha: false`、`renderer.setClearColor(0x000000, 1)`（光学透视眼镜中纯黑即透明），**严禁调用 `navigator.mediaDevices.getUserMedia`**。
   - 自动请求 `navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] })`，启用 `renderer.xr.enabled = true` 与 `renderer.setAnimationLoop(...)`。
3. **所有 3D 对象（含刀光特效）挂在 `scene` 世界根节点，不挂 `camera`**
   - 原版 `ar/slash.js` 将刀光 mesh 挂在 `camera` 下；在双目 WebXR / 6DoF 转头时会粘在鼻尖抖动。改造后统一挂入 `scene` 世界空间，根据当前 `camera.matrixWorld` 计算世界挥刀弧线。
4. **手机手持 60Hz 原生姿态四元数坐标系转换（关键！）**
   - `HandheldArView` 通过 `window.MetaTourWebAR.onPose(pose => ...)` 推送的 `source: 'android-rotation-vector'` 来自 Android `SensorManager.getQuaternionFromVector`（ENU 东-北-天坐标系，`+Z` 朝天）。
   - 网页端必须先左乘 `ENU_TO_THREE_WORLD = R_x(-Math.PI / 2)`（并右乘屏幕旋转角 `R_z(-screenAngle)`）转换到 Three.js `Y`-up 世界坐标系（`-Z` 正前方），否则手机竖直持握时虚拟地面会立在正前方 90°。
5. **容器原生顶部胶囊栏安全区避让与「回正」事件联动**
   - 容器手持模式顶部有原生胶囊栏（`← 首页 | 域名 | 投送到眼镜 | 回正 | 刷新`），并通过 CSS 变量 `--metatour-top-inset`（约 `80–90px`）注入网页。顶部 UI（欢迎卡片、战斗血条/倒计时、暂停弹窗）需使用 `max(env(safe-area-inset-top), var(--metatour-top-inset, 0px))` 避让。
   - 监听容器原生「回正」事件 `window.addEventListener('metatour-heading-reset', ...)` 与 `xreal-view-reset` 重置视角基准偏航角；网页内点「校准」时同步调用 `window.MetaTourWebAR?.resetHeading?.()`。
   - 监听 `window.MetaTourWebAR?.onGlassesStateChange?.(...)` 动态显隐「投送到 AR 眼镜」按钮（点击调 `window.MetaTourWebAR.switchToGlasses()`）。
6. **可选 EasyAR Mega 空间锚点平滑消漂桥接**
   - 拿到 Mega 位姿后调用 `window.MetaTourWebAR?.applyMegaPose({ anchorId, position, quaternion, confidence, referenceSpace: 'local-floor' })`，由容器底层以每帧 `<= 3.5cm` 平滑融合消漂，网页端不直接瞬移跳变相机矩阵。

---

## 3. 官方最新版「一键复制 AI 适配提示词」原文（v1.2.0）

```text
请帮我做一个同时适配「手机后置相机手持 WebAR」与「AR 眼镜双目透视 WebXR」的空间网页，并发布成一个 HTTPS 网址。请从零完成代码编写与静态托管指引，最后告诉我最终 HTTPS 网址。

【运行容器与观看方式】
- 容器 App：「元游 WebAR 浏览器」（包名 `com.sightp.metatour.webar`，下载地址 https://terri.sightp.com/projects/yuanyou-webar-browser/ ）。
- 一个链接同时支持三种打开方式，网页必须自动适配：
  1. 手机手持模式（未插 AR 眼镜时在「元游 WebAR 浏览器」或系统手机浏览器打开）：全屏开启手机后置摄像头实景（`getUserMedia` `facingMode: 'environment'`）叠加透明 Three.js 3D 场景，结合陀螺仪/原生姿态（`window.MetaTourWebAR`）与触控环视。
  2. AR 眼镜模式（手机或 Beam Pro 连接 XREAL Air 2 Ultra 等眼镜打开）：容器自动注入 `window.__XREAL_CONTAINER__ = true` 与标准 WebXR（`navigator.xr` `immersive-vr`、`local-floor`）及原生零延迟 ATW 合成，输出双目 6DoF/3DoF 光学透视画面。
  3. 无相机 / 桌面浏览器降级模式（电脑 1440px 打开或用户拒绝相机权限）：绝不白屏或报错，自动显示美观的渐层背景 + 可鼠标/触控拖动的 3D 预览，并提供清晰的中文提示按钮。

【网页开发规范】
1. 纯静态技术栈：
   - 使用 Three.js（建议 r150–r165），纯静态结构（`index.html` + 本地相对路径资源文件夹），将 `three`、`.glb` 模型与 `.webp/.png` 贴图保存在同目录，不依赖境外不稳定 CDN。
2. 双模自动分流逻辑（关键！）：
   - 先检测眼镜容器：`const isGlasses = !!window.__XREAL_CONTAINER__;`（或 `window.MetaTourWebAR?.getMode() === 'glasses'`）。
   - 【当在 AR 眼镜模式（`isGlasses === true`）】：
     - 隐藏所有 HTML 按钮和 2D 浮层（眼镜光学透视中不需要 2D 网页栏，需展示的导览标题请用 `CanvasTexture` 做成世界空间 3D 铭牌）。
     - WebGL 背景设为纯黑不透明（`setClearColor(0x000000, 1)`，光学透视眼镜中纯黑即完全透明），**禁止在眼镜模式下调用 `getUserMedia` 抢占摄像头**。
     - 自动调用 `navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] })`，启用 `renderer.xr.enabled = true` 与 `renderer.setAnimationLoop(...)`。
   - 【当在手机手持或普通浏览器模式（`isGlasses === false`）】：
     - WebGL 设为透明通道（`alpha: true`, `setClearColor(0x000000, 0)`），底层铺满 `<video autoplay playsinline muted>`。
     - 调用 `navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' } } })` 开启后置相机；若权限被拒或无摄像头，捕获异常并平滑保留 3D 触控/陀螺仪预览，不弹原生报错框。
     - 优先读取 `window.MetaTourWebAR?.onPose(pose => ...)` 获取容器推送的 60Hz 原生手机姿态四元数，回退使用 `DeviceOrientationEvent` + 触控拖拽。
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
- 必须部署为 **HTTPS** 网址（WebXR 与摄像头 `getUserMedia` 均要求 HTTPS 安全上下文）。
- 交付前请自检桌面 `1440px` 与手机 `390px` 两个视口：首屏排版无遮挡、无文字裁切、无横向滚动条、控制台零报错，并附上最终 HTTPS 链接与测试说明。
```
