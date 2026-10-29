# Changelog

## 0.2.0 — 2026-10-29

基于「转塘艺讯（ModelScope Studio）」实战录制重写镜头与配乐。核心结论：**宁可不缩放，也不要 1.05–1.25 的小幅缩放**——那只会让人觉得画面在抖。

- **相机改成「缩放 + 平移」**：新增 `camFor()` / `camTo()` / `camGlide()`，传面板中心与目标缩放即可把镜头推到「刚刚变化的那块面板」；平移被 `clampTx/clampTy` 限制在内容仍铺满视口的范围。幅度建议 1.5–1.65（小面板 1.6–1.7，需同时框住点击点与结果区时 1.5）。
- **放大状态下也能点**：`clickAt` 在点击前把相机变换瞬时归零、按页面坐标点击、再立刻恢复，归零到恢复之间不拍帧。此前做法是「scale≠1 禁止点击」。
- **三个工具链坑（都实测踩过）**：
  1. `page.screenshot()` 会临时改视口，之后 CDP 点击落到 iframe **元素**上、进不了应用 → 截图改走 CDP `Page.captureScreenshot`（`captureBeyondViewport: false`）；
  2. iframe 带 CSS transform 时命中测试不稳 → 见上条「点击穿透」；
  3. 相机做在应用内部（变换 `body`）会让 WebGL 地图掉瓦片（页面显示"地图载入中…"）→ 相机挂到顶层 `iframe`。
- **4K 超采样**：`CFG.dsf = 2`，放大处文字不糊，成片再 `scale=1920:1080:flags=lanczos` 缩回。
- **配乐按画面重新生成**：`music.mjs` 改为 4 套模板（`light` 104BPM C大调 / `warm` 88BPM / `pulse` 124BPM / `minimal` 76BPM），由 `events.json` 的 `beat` 段落标记决定能量曲线、`click` 对齐点击声、`cam` 在推近前 0.5s 加一道极轻上行；不再是一段固定 loop。模板字段速查写在脚本末尾。
- **新增 `mark()`**：编排里标段落（open / card / panel / detail / venue / finder / calendar / outro），配乐据此编排。
- **模板结构**：`CFG.frameMatch` 一行切换 iframe 模式（自动定位 app frame、相机挂 iframe、指针注入顶层）。

## 0.1.0 — 2026-10-28

基于「推鉴 · AI 营销助手（ModelScope Studio）」实战录制，加镜头语言和一键配乐。

- **缩放运镜**：模板新增 `zoomTo()` / `zoomPunch()` 与 `CFG.zoomSelector`——对宿主元素（iframe 内嵌应用就是顶层 `iframe`）逐帧设 `transform: scale()`，缓动插值，不用 CSS transition。开场推近定场、区域强调 punch、结尾拉远收版都能一行写出来。`transform-origin` 用元素未缩放时的 rect 换算；`clickAt` 内置「scale≠1 禁止点击」硬检查。
- **合成配乐 `scripts/music.mjs`**：纯 node 加法合成写 WAV，126 BPM A 小调（kick/bass/hats/snare/琶音/pad），自动按 `events.json` 的点击帧对齐 tick 确认音；时长 = 帧数 / fps，BPM 可参数化。混流：`ffmpeg -i video.mp4 -i score.wav -c:v copy -af loudnorm=I=-15:TP=-1.5:LRA=11 -c:a aac -b:a 160k -shortest out.mp4`。
- **模板补写 `events.json`**：此前只有实战脚本在记点击帧，现在模板默认记录点击与运镜事件。
- **节奏参考**：~60s 片长可覆盖 10+ 页面状态——登录、四步创建向导、侧栏四页快览、历史记录、成品页，glide 20–30 帧、页面停留 20–40 帧。
- 文档：SKILL.md 新增「缩放运镜」章节，工作流与资源清单同步。

## 0.0.2 — 2026-10-23

不再只面向 Qoder。

- **新增 `AGENTS.md`**：通用入口，任何能读写文件、能跑命令的 agent（Codex、Claude Code、Gemini CLI、Grok CLI、DeepSeek harness、Cursor、Windsurf、Aider…）读这一份就能开工，含 8 条不可省略的硬规则与最短流程。中文表述，英文 agent 同样可执行。
- **新增 `CLAUDE.md` / `GEMINI.md`**：给只认固定文件名的 agent 做指向。
- **安装说明通用化**：README 中英双版改为「最省事（克隆 + 一句话）」「装成技能（Qoder / Claude Code / 其他）」「项目级」三种方式。
- **技能名**：对外展示名「演录」，目录名与调用名仍为 `web-demo-video`。

## 0.0.1 — 2026-10-22

首次带版本号的更新，基于「转塘艺讯」实战录制。

- **修正真实点击时序**：按下 → 停 90ms → 松开，期间不移动指针、不截图。此前模板会在按下和松开之间拍一帧，导致 `<a>`、筛选 chip、地图列表行的点击被站点吞掉。
- **剪掉路由加载**：新增 `waitFor()`，跳转后停止采集，等目标内容就绪再继续，成片是一次干净切镜，不再出现 1 秒多的骨架屏。
- **iframe 内嵌应用**：补充 ModelScope Studio 一类外层包装的处理（操作 app frame、隐藏水印/悬浮客服、指针注入时机、面板遮挡）。
- **颜色修正**：`encode.mjs` 显式做 full→tv + bt709 转换并写入 `color_*` 标签，避免 H.264 比网页原图更亮更艳。
- **无头录制**：模板默认 `headless: true`，不抢焦点、不会被人中途关掉。
- **工作目录清理**：`frames/` 等中间产物出片后删除，README 注明。
- **文档重写**：README 改为项目式布局（演示 GIF、分镜图、徽章、快速开始），中英文拆分为 `README.md` / `README.en.md`。

## 0.0.0 — 2026-10-22

首个版本：系统 Chrome + 逐帧截图 + 注入鼠标指针 + CDP 真实输入 + ffmpeg 合成，含双语 README 与避坑清单。

---

## 0.2.0 — 2026-10-29

Rewritten camera and soundtrack, based on a real recording of "转塘艺讯" (ModelScope Studio). Main conclusion: **never use a 1.05–1.25 zoom** — it just reads as the frame wobbling.

- **Camera is now translate + scale**: `camFor()` / `camTo()` / `camGlide()` push in on the panel that just changed; panning is clamped so content still covers the viewport. 1.5–1.65 is the useful range (1.6–1.7 for small panels, 1.5 when the clicked cell and the result area must share the frame).
- **Clicks still land while zoomed**: `clickAt` zeroes the camera transform, clicks in page coordinates, then restores it — no frame is captured during that round trip. The old rule "no clicks when scale≠1" is gone.
- **Three toolchain traps, all reproduced and fixed**: `page.screenshot()` temporarily resizes the viewport, after which CDP clicks hit the iframe *element* instead of the app (capture via CDP `Page.captureScreenshot` instead); hit-testing under an iframe CSS transform is unreliable (hence the zero-and-restore click); transforming the app `body` makes WebGL maps drop their tiles (keep the camera on the outer iframe).
- **4K supersampling**: `CFG.dsf = 2` keeps zoomed text crisp; downscale to 1920×1080 with `flags=lanczos` when encoding.
- **Score generated per cut**: `music.mjs` now ships four presets (`light` 104BPM C major, `warm` 88BPM, `pulse` 124BPM, `minimal` 76BPM). `beat` marks drive section energy, `click` frames get ticks, `cam` events get a soft riser 0.5s ahead. No fixed loop.
- **New `mark()`**: label sections in the choreography (open / card / panel / detail / venue / finder / calendar / outro) for the score to follow.
- **Template structure**: `CFG.frameMatch` switches to iframe mode (locates the app frame, mounts the camera on the iframe, injects the cursor in the top document).


## 0.0.1 — 2026-10-22

First versioned release, based on a real recording of "转塘艺讯".

- **Fixed real click timing**: press → 90ms → release, with no pointer movement or screenshot in between. The old template captured a frame while the button was held, which made some sites (anchors, filter chips, map rows) silently drop the click.
- **Skip route loading**: added `waitFor()`; stop capturing during navigation and resume once the new view is ready. The result is a clean cut instead of a second-long skeleton screen.
- **Iframe-hosted apps**: documented ModelScope Studio-style wrappers (drive the app frame, hide watermark/assistant, inject the cursor inside the frame, wait out overlays).
- **Color fix**: `encode.mjs` now converts full→tv and tags bt709 explicitly, so the video no longer looks brighter or more saturated than the page.
- **Headless capture**: template defaults to `headless: true` — no stolen focus, no accidental close.
- **Cleanup**: delete `frames/` and other intermediates after delivery.
- **Docs rewrite**: project-style README with demo GIF, storyboard, badges and quick start; split into `README.md` (zh) and `README.en.md` (en).

## 0.0.0 — 2026-10-22

Initial version: system Chrome + deterministic screenshots + injected cursor + real CDP input + ffmpeg encoding, with a bilingual README and a pitfall checklist.
