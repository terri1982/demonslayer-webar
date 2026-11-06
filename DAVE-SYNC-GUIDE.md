# 鬼灭之刃 Web3D → 元游 WebAR 版（v1.5.2）空间手势、动态盲操协同与全屏双模改造同步说明（供 Dave 对齐）

本文档整理了「元游 WebAR 版」（`com.sightp.metatour.webar` v1.5.0 / v1.5.2）最新官方网页适配规范：四档终端统一解耦空间输入（**纯头部视线持续软锁定 Sticky Gaze Lock + 右手 6 种隔空手势 + `handActive` 动态盲操零死锁协同 + 左手手机浮动方向盘真实步法 + 1.60m 平视居中 3D 菜单**）、平视级 3D 水之呼吸特效池，以及已通过 **Samsung S24 + XREAL Air 2 Ultra 真机**与 **Samsung S22 真机**联调验证的参考实现，供上游 `demonslayerAR`（`tools/musou/ar/`）对齐参考。

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
   - **Phase A（1.60m 眼高平视居中双 3D 按钮牌 + 动态 `gazeDwellMs` 同步）**：在世界空间正前方 `2.14m`（统一 `1.60m` 站姿眼高的 `25°` 垂直视场内，水平居中 `x = 0.04m`）布置主、副两枚 `CanvasTexture` 3D 按钮牌（`y = 1.52m` 拔刀开战 / 再来一局、`y = 1.23m` 试炼强度切换 / 返回庭院），实时读取 `getInputState().gazeDwellMs`（动态同步容器 `关 / 1s / 2s / 3s` 设置），支持头部注视驻留或右手 6DoF 射线悬停 + 右手 `pinch` 捏合 / 触控板 `tap` 立即确认。
   - **Phase B（纯头部视线粘性锁敌 + 无遮挡紧凑血条 + 平视 3D 水之呼吸特效）**：进入战斗后锁定完全由 `activeCamera` 头部视线驱动（右手挥斩不带偏锁定目标），恶鬼头顶血条精简至 `0.52m × 0.146m`，炭治郎外移左翼 `x = -0.58m` 让出正面视线；并在平视高度（`y = 1.18m..1.65m`）预分配零 GC 3D 水车、9.2m 雫波纹水矛、恶鬼胸前收缩红光预警环与水龙奥义浪潮。
4. **右手 6 种隔空手势 + `handActive` 动态主辅协同 + 左手真实空间步法**
   - `window.MetaTourWebAR?.onHandGesture?.(ev => ...)`（XREAL Air 2 Ultra 26 关节右手追踪，并在 `XRFrame` 中读取右手 `targetRaySpace` 绘制青色水息 6DoF 空间射线）：
     - `'slash'`（`left|right|up|down`）→ 普通三段连斩（0ms 刀光弧线随挥手方向旋转 + `280ms` 连招缓冲）
     - `'circle'`（`clockwise`）→ 技能 1：水之呼吸·贰之型「水车」顺/逆时针立体水轮旋斩
     - `'thrust'` → 技能 2：柒之型·雫波纹击刺（`9.2m` 远程水矛贯穿打断红光蓄力）
     - `'fist-hold'` / `'fist-release'` → 技能 3：流流舞·守势持续架刀（展开平视 3D 水纹护盾弹反红光）
     - `'open-palm'`（张掌稳态 0.4s）→ 技能 4：满气释放水龙合击奥义 / 未满气触发全集中常中聚气 `+25%`
     - `'pinch'` → 专职菜单态立即确认 3D 按钮（战斗态不混发普攻，避免握拳/张掌过渡误触）
   - **`v1.5.2` 动态主辅协同准则（严禁因 `caps.handTracking === true` 一刀切屏蔽触控板）**：网页根据 `isHandActivelyTracked()`（右手当前真实入镜）动态协同——右手在视野内时由隔空手势主控出招、手机专职左手推盘走位；当右手自然放下或任意机型底层手势流未激活时，手机盲操板自动零缝隙兜底全部招式（`tap` 挥斩、`swipe-up` 水车、`swipe-left/right` 突刺、双指轻点 `0.95s` 瞬身弹反 / 双指长按持续架盾、`swipe-down` 奥义）。
   - `window.MetaTourWebAR?.onTrackpadMove?.(({ x, y, forward, strafe, active }) => ...)`：优先读取语义轴 `forward = -y`（上推前进 `-Z`）与 `strafe = x`，通过 `megaBridge.setStageTranslation(-player.x, 0, -player.z)` 平滑驱动 WebXR 世界舞台位移，松指保持战术站位不回弹，监听 `metatour-view-reset` 同步归零步法。
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
