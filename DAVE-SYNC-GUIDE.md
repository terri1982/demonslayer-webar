# 鬼灭之刃 Web3D → 元游 WebAR 版（v1.5.0）空间手势、注视锁定与全屏双模改造同步说明（供 Dave 对齐）

本文档整理了「元游 WebAR 版」（`com.sightp.metatour.webar` v1.5.0）最新官方网页适配规范：四档终端统一解耦空间输入（**视野中央注视持续软锁定 Sticky Gaze Lock + 右手 6 种隔空手势 + 无手势眼镜盲操回退 + 左手手机浮动方向盘 + 3D 空间菜单 2 秒注视确认**）、手机手持全屏无常驻顶栏与紧凑四角 HUD 排布，以及已通过 **Samsung S24 + XREAL Air 2 Ultra 真机**与 **Samsung S22 真机**联调验证的参考实现，供上游 `demonslayerAR`（`tools/musou/ar/`）对齐参考。

---

## 1. 核心入口与在线验证地址

- **元游 WebAR 版官网与 APK 下载页（v1.5.0）**：https://terri.sightp.com/projects/yuanyou-webar-browser/
- **鬼灭之刃双模 WebAR 独立验证版（HTTPS 线上地址）**：https://terri1982.github.io/demonslayer-webar/
- **鬼灭之刃双模 WebAR 独立仓库**：https://github.com/terri1982/demonslayer-webar

---

## 2. 容器运行时关键对齐点（v1.5.0 空间交互与全屏横竖屏总结）

容器严格保持**零业务耦合**（只输出原始硬件位姿与通用空间输入原语，所有锁敌、招式与 HUD 逻辑全部由网页端通过可选链 `window.MetaTourWebAR?.xxx?.()` 订阅）：

1. **清晰的中文 `<title>`（联动「大家都在玩」共享广场）**
   - 设置 `<title>鬼灭之刃 · 夜巡街道 WebAR 空间版</title>`：用户在容器历史记录勾选「共享」后会自动提取展示。
2. **四档终端能力查询（`getCapabilities()`）与双模无竞态分流（`src/container-bridge.js`）**
   - 同时检查 `window.__XREAL_CONTAINER__ === true`、`window.MetaTourWebAR?.getMode?.() === 'glasses'` 及同步 `@JavascriptInterface`（`window.XrealNativePose` / `window.AndroidXrealBridge`）。
   - AR 眼镜模式（`isGlasses === true`）隐藏全部 2D HTML 图层，WebGL 设为 `alpha: false` + `setClearColor(0x000000, 1)`（光学透视纯黑即透明），**严禁调用 `getUserMedia` 抢占摄像头**，自动调用 `navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'hand-tracking'] })`。
3. **两阶段免低头人体工学（Phase A 3D 菜单 2 秒注视 + Phase B 注视秒锁与隔空手势）**
   - **Phase A（开场 / 结算 3D 按钮牌）**：在世界空间正前方 `2.14m`（`2.0m ~ 2.4m` 焦平面内，XREAL `local-floor` 站姿眼高 `1.55m` 视野内 `y = 1.29m`）放置 `CanvasTexture` 3D 按钮 Mesh；每帧射线检测头部正前方是否指向该菜单按钮并调用 `window.MetaTourWebAR?.setReticleTarget?.(hoveredMenuId)`（仅菜单按钮开启 2s 驻留读条，战斗瞄鬼传 `null`），监听 `onGazeProgress` / `onGazeSelect` 绘制环形充能条并自动开战/重开，同时支持右手 `pinch` 捏合或触控板 `tap` 立即确认。
   - **Phase B（Sticky Gaze Lock 视线持续软锁定）**：每帧用头部射线检测存活恶鬼——目光扫过恶鬼**零延迟秒锁**（并在恶鬼身上绘制世界空间 3D 锁定光环），**视线移开到空白处时保留最后一个存活锁定目标不丢失**，直至该恶鬼被击破后自动切换到最近存活恶鬼。
4. **右手 6 种隔空手势 + 无手势眼镜盲操回退 + 左手浮动方向盘**
   - `window.MetaTourWebAR?.onHandGesture?.(ev => ...)`（XREAL Air 2 Ultra 26 关节右手追踪）：
     - `'slash'`（`left|right|up|down`）→ 普通三段连斩（刀光弧线随挥手方向旋转）
     - `'circle'`（`clockwise`）→ 技能 1：水之呼吸·贰之型「水车」旋斩 / 满气合击
     - `'thrust'` → 技能 2：柒之型·雫波纹击刺（重击破招打断红光预警）
     - `'fist-hold'` / `'fist-release'` → 技能 3：流流舞·守势架刀（展开 3D 水纹护盾，弹反红光攻击并聚气）
     - `'open-palm'`（张掌稳态 0.4s）→ 技能 4：全集中·水车合击奥义
     - `'pinch'` → 菜单态立即确认 3D 按钮；战斗态触发拔刀斩
   - `window.MetaTourWebAR?.onTrackpadGesture?.(ev => ...)`（无手势 3DoF 眼镜或右手放下时自动回退）：
     - `'tap'` → 普攻 / 确认菜单；`'swipe-up'` → 水车旋斩；`'swipe-left'|'swipe-right'` → 突刺重击；`'hold'` → 架刀格挡；`'swipe-down'` → 全集中奥义。
   - `window.MetaTourWebAR?.onTrackpadMove?.(({ x, y, active }) => ...)`：左手按住手机屏幕任意位置推拉即「落指即圆心」浮动方向盘，平滑控制玩家横向/前后走位与红光闪避。
5. **手机手持全屏无常驻顶栏与极简四角 HUD**
   - `v1.5.0` 手持模式已去除常驻顶栏实现 100% 全屏沉浸（`--metatour-top-inset` 默认为 `0px`）。网页顶部角标统一使用 `top: calc(max(env(safe-area-inset-top), var(--metatour-top-inset, 0px)) + 6px)`，左上保留超薄血条与单行里程胶囊，右上仅保留单枚圆形 `Ⅱ` 暂停按钮，战斗字幕置于底部操控区中央空档。
6. **所有 3D 内容挂在 `scene` 世界根节点 + 可选 EasyAR Mega 平滑消漂**
   - 刀光、护盾、锁定环、3D 铭牌全部挂在 `worldRoot` 下（`camera.children.length === 0`）；接入 Mega 云定位时调用 `window.MetaTourWebAR?.applyMegaPose(...)`（每帧 `<= 3.5cm` 平滑消漂）。

---

## 3. 官方最新版「一键复制 AI 适配提示词」（v1.5.0 摘要）

完整提示词见容器工程 `webar-compatibility-prompt.txt` 及 https://terri.sightp.com/projects/yuanyou-webar-browser/ ：
- 四档终端通过 `window.MetaTourWebAR?.getCapabilities?.()` 自动识别（6DoF 手势眼镜 / 3DoF 盲操眼镜 / 手机手持全屏 WebAR / 桌面降级预览）；
- 严禁在眼镜游玩过程中要求用户低头看手机虚拟按钮；
- 所有容器接口均通过 `window.MetaTourWebAR?.xxx?.()` 可选链调用，确保普通手机浏览器与电脑浏览器零报错运行。
