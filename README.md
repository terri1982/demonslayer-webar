# 鬼灭之刃 · 夜巡街道（MetaTour 手持 WebAR & AR 眼镜双目 WebXR 空间版）

基于 Three.js `r165` 纯静态架构构建的空间网页体验，**同一个 HTTPS 链接自动适配三种打开方式**：

1. **手机手持后置相机 WebAR 模式（`isGlasses === false`）**
   - 在「[元游 WebAR 浏览器](https://terri.sightp.com/projects/yuanyou-webar-browser/)」（`com.sightp.metatour.webar`）或手机 Safari / Chrome 打开：
   - 底层全屏开启手机后置摄像头（`getUserMedia` `facingMode: { ideal: 'environment' }`），上层叠加透明通道 WebGL（`alpha: true`, `setClearColor(0x000000, 0)`）。
   - 姿态优先级：`window.MetaTourWebAR?.onPose(pose => ...)`（60Hz 原生姿态四元数）→ `DeviceOrientationEvent` 陀螺仪 → 触控拖拽环视。
   - 热插拔眼镜接力：检测到 `window.MetaTourWebAR?.isGlassesConnected() === true` 时自动显示 **「投送到 AR 眼镜」** 按钮，点击调用 `window.MetaTourWebAR.switchToGlasses()`。
2. **AR 眼镜双目光学透视 WebXR 模式（`isGlasses === true`）**
   - 手机或 Beam Pro 连接 XREAL Air 2 Ultra 等 AR 眼镜在「元游 WebAR 浏览器」打开（检测到 `window.__XREAL_CONTAINER__ === true` 或 `window.MetaTourWebAR?.getMode() === 'glasses'`）：
   - 自动隐藏全部 2D HTML 按钮与浮层，改用世界空间 3D `CanvasTexture` 铭牌（挂在 `scene` 下正前方 `-2.35m`、高度 `1.48m`）呈现导览与战况。
   - WebGL 背景设为纯黑不透明（`setClearColor(0x000000, 1)`，光学透视眼镜中纯黑即完全透明），**绝不调用 `getUserMedia` 抢占摄像头**。
   - 自动请求 `navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] })`，启用 `renderer.xr.enabled = true` 与 `renderer.setAnimationLoop(...)`。
3. **无相机 / 桌面浏览器降级模式（电脑 `1440px` 或拒绝相机权限）**
   - 绝不白屏、绝不弹原生报错框：自动展示藤花夜巡渐层背景 + 鼠标/触控可自由拖拽环视的 3D 炭治郎与藤花结界，一键即可进入免相机试玩。

---

## 空间尺寸与性能指标

- **世界坐标系**：单位为米（m），地面 `y = 0`，正前方为 `-Z`。
- **核心展项尺寸**：藤花结界、炭治郎与 3D 空间铭牌锚定在正前方 **`2.18m – 2.46m`**，视觉中心高度 **`1.28m – 1.56m`**，核心结界总宽度 **`1.44m`（`≤ 1.5m`）**。
- **场景树铁律**：全部 3D 内容统一挂载在 `scene -> WorldSpatialRoot` 世界根节点下，`camera.children.length === 0`。
- **渲染与包体预算**：单帧 Draw Call 约 `25–55`（远低于 `< 150` 上限），单个 `.glb` 均 `< 10MB`，禁用重度后处理 Bloom 与实时阴影贴图，全部 `three`、`.glb`、`.png`、`.mp3`、`.wasm` 均走本地相对路径 `./`，零境外 CDN 依赖。
- **EasyAR Mega 云定位消漂桥接（可选）**：调用 `window.__webar.applyMegaPose({ anchorId, position, quaternion, confidence, referenceSpace: 'local-floor' })` 或派发 `easyar:megapose` 事件时，自动转发至 `window.MetaTourWebAR?.applyMegaPose(...)`，由容器底层以 `≤ 3.5cm/帧` 平滑融合修正 SLAM 漂移，网页端绝不跳变相机矩阵。

---

## 本地开发与静态构建

```bash
npm install
npm run build
```

构建产物位于 `dist/` 目录（包含 `index.html`、`./vendor/three-r165.js`、`./vendor/app.js`、`./vendor/style.css`、`./assets/`），可直接部署至 GitHub Pages、Nginx、Cloudflare Pages 或对象存储 HTTPS 静态站点（确保配置 `.wasm` 为 `application/wasm`、`.glb` 为 `model/gltf-binary`，GitHub Pages 默认已内置支持）。
