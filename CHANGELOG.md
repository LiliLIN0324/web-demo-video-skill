# Changelog

## 0.2.1 — 2026-11-06

把「文档里写了、但换个机器/换个人就会坏」的地方改成脚本自己兜住。全部数字来自本机实跑（真页面：幕景宇宙 · 咪目 AI 接待助手，723 帧 / 24.1s）。

- **P0 · 4K 帧自动降回 1080p**：`encode.mjs` 先读第 0 帧尺寸，只有和 `--size` 不一致时才插 `scale=…:flags=lanczos`。以前这条 `-vf` 要手写，忘了就得到一只 3840×2160 的成片。实测真 4K 帧降下来后与源图平均差 Y 0.38 / UV 0.29。
- **P0 · ffmpeg 定位通用化**：新增 `scripts/ffmpeg.mjs`，按 `FFMPEG` 环境变量 → PATH → 常见安装位置找，`ffprobe` 取同目录同名兄弟；`encode.mjs` / `verify.mjs` / `music.mjs` 都用它。以前挂着某台机器的绝对路径，换机器直接 spawn ENOENT。
- **P1 · 新增 `scripts/verify.mjs`**：出片前的 PASS/FAIL 表 + 关键帧拼图。查分辨率（按源帧比例推，9:16 不再误报）、色彩标签、帧数、时长、faststart（真去字节里比 `moov` / `mdat` 位置）、码率、与源 PNG 的平均 YUV 差、最差帧 PSNR、响度；有 FAIL 返回非 0，可当发布门禁。实测真页面成片 9 项全绿（Y 0.65 / UV 0.64，PSNR 39.6 dB，-15.36 LUFS）；故意错位 5 帧取样能被抓到（Y 1.95）。
- **P1 · `encode.mjs --audio`**：视频 + 归一化响度 + 混轨一条命令做完，手写的 `-bsf:v h264_metadata…` 长命令从文档里消失。响度改两趟：先量再 `linear=true` 归一，实测 -14.81 LUFS（单趟动态归一在同一素材上只有 -12.54，偏 2.5 LU）。
- **P1 · `events.json` 增量落盘**：每个事件写一次盘，并接住 SIGINT/SIGTERM。实测录制在 4K 下崩在第 141 帧（本机内存只剩 2GB，Chrome 被干掉），已录到的 4 条事件仍在文件里，配乐照样能出。
- **P2 · `CFG.dsf` 这个假开关修好了**：以前只设 `newContext({deviceScaleFactor})`，而实测它对 CDP 截图完全不起作用（设 2 仍出 1920×1080）；现在走 `Page.captureScreenshot` 的 `clip.scale`，真出 3840×2160。
- **P2 · 推近状态下的坐标测量归零了**：`getBoundingClientRect()` 在挂着 `transform` 的层里返回**变换后**的坐标，而 `glide` / `clickAt` 按页面坐标工作。以前只有点击归零、测量没归零，于是"镜头推近 → 在面板里点发送"会点到一个被放大过的坐标上：实测得到 x=1692，点击落空、回答根本没出来，而画面看着一切正常、也不报错。新增 `measurePage()`，`center()` / `centerByText()` 都走它（先归零相机、量完恢复）。这条是真页面上录封面视频时撞出来的。
- **P2 · 模板**：`CFG.park` 留 `null` 时按 `width/height` 自动推（9:16 不用手改）；新增 `CFG.pad`（帧名位数），帧数溢出时直接报错而不是让成片莫名变短；`outDir` 里混进非帧文件时不清目录、直接停手。
- **P2 · `music.mjs` 报错说人话**：帧目录不存在/不是目录（顺带提示参数顺序）、fps 非法、风格名写错（列出 4 套，不再静默退回默认）、`events.json` 缺失或格式坏，都各有明确信息。
- **H.264 色彩补齐码流 VUI**：`-color_*` 只写容器，VUI 里 `color_primaries/transfer` 仍是 `unknown`；现在同时给 `-x264-params "colorprim=bt709:transfer=bt709:colormatrix=bt709"`（本机 A/B/C 实测对比）。
- **文档**：SKILL.md 工作流改为 7 步（含验收），颜色章补 VUI 与「PSNR 不能当色差门槛」的实测理由，常见坑加 5 行（ffmpeg 8 删了 `-vsync`、`ffprobe -select_streams v:0` 会连音轨一起滤掉、单趟 loudnorm 偏目标、`dsf` 走 `clip.scale`）；AGENTS.md 的硬规则 10 → 11 条；README 双语加了「技术栈与依赖 / Stack & dependencies」对照表；`README.en.md` 标题改为英文；新增 `.gitattributes`（`* text=auto eol=lf`）与 `.gitignore` 补项。

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

## 0.2.1 — 2026-11-06

Moved the things that were only written down into documentation into the scripts themselves, so they keep working on someone else's machine. Every number below comes from a real run on a live page (Mimi AI reception demo, 723 frames / 24.1 s).

- **P0 · 4K frames now downscale automatically**: `encode.mjs` reads frame 0 and inserts `scale=…:flags=lanczos` only when its size differs from `--size`. This was a hand-written `-vf` before; forgetting it produced a 3840×2160 deliverable. Measured on real 4K frames: mean YUV diff Y 0.38 / UV 0.29 after downscale.
- **P0 · portable ffmpeg discovery**: new `scripts/ffmpeg.mjs` resolves `FFMPEG` → PATH → common install dirs, and derives `ffprobe` from the same directory; `encode.mjs`, `verify.mjs` and `music.mjs` all use it. It used to hardcode one machine's absolute paths and died with `spawn ENOENT` on another.
- **P1 · new `scripts/verify.mjs`**: a PASS/FAIL table plus a keyframe montage before you ship — resolution (expected size derived from the frame aspect, so 9:16 no longer false-fails), colour tags, frame count, duration, faststart (reads the actual bytes to compare `moov` vs `mdat` positions), bitrate, mean YUV diff against the source PNGs, worst-frame PSNR, loudness. Exits non-zero on any FAIL. All 9 green on the real clip (Y 0.65 / UV 0.64, PSNR 39.6 dB, −15.36 LUFS); deliberately sampling 5 frames off-truth is caught (Y 1.95).
- **P1 · `encode.mjs --audio`**: one command now produces the muxed, loudness-normalised file, so the long hand-written `-bsf:v h264_metadata…` line disappears from the docs. Loudnorm became two-pass (measure, then `linear=true`): measured −14.81 LUFS, versus −12.54 with single-pass dynamic on the same material (2.5 LU off target).
- **P1 · `events.json` is flushed per event**, and on SIGINT/SIGTERM. Real case: the 4K recording died at frame 141 (Chrome was killed with ~2 GB RAM left on this machine) and the 4 events already captured were still on disk, so the score could still be written.
- **P2 · `CFG.dsf` was a fake switch and now isn't**: it only set `newContext({deviceScaleFactor})`, which has no effect on CDP screenshots (still 1920×1080 at 2). It now drives `Page.captureScreenshot`'s `clip.scale` and really produces 3840×2160.
- **P2 · measurements are taken with the camera zeroed**: `getBoundingClientRect()` inside a transformed layer returns *transformed* coordinates, while `glide` / `clickAt` work in page coordinates. Clicks used to zero the camera but measurements did not, so "push in on the panel → click send inside it" clicked a scaled-up point: measured x=1692 in practice, the click landed off the panel, the answer never rendered, and nothing raised an error. New `measurePage()` is what `center()` / `centerByText()` now use (zero, measure, restore). Found while recording a real cover clip.
- **P2 · template**: `CFG.park` derives from `width/height` when left `null` (9:16 needs no manual change); new `CFG.pad` for frame-name width, with a hard stop instead of a silently short video if the frame count overflows; the output directory is no longer wiped if it contains files that aren't frames.
- **P2 · `music.mjs` errors say what happened**: missing/non-directory frames path (with a hint about argument order), invalid fps, unknown style name (lists the four presets instead of falling back silently), absent or malformed `events.json`.
- **H.264 bitstream VUI is tagged too**: `-color_*` only fills the container, leaving `color_primaries/transfer` as `unknown` in the stream; `encode.mjs` now also passes `-x264-params "colorprim=bt709:transfer=bt709:colormatrix=bt709"` (A/B/C verified locally).
- **Docs**: SKILL.md workflow is now 7 steps including verification; the colour chapter explains the VUI and why PSNR can't be the colour metric; +5 pitfall rows (ffmpeg 8 removed `-vsync`, `ffprobe -select_streams v:0` hides the audio track, single-pass loudnorm drift, `dsf` needs `clip.scale`). AGENTS.md grew from 10 to 11 non-negotiables. Both READMEs gained a stack/dependencies table; `README.en.md` title is in English; added `.gitattributes` (`* text=auto eol=lf`) and more `.gitignore` entries.

## 0.2.0 — 2026-10-29

Rewritten camera and soundtrack, based on a real recording of "转塘艺讯" (ModelScope Studio). Main conclusion: **never use a 1.05–1.25 zoom** — it just reads as the frame wobbling.

- **Camera is now translate + scale**: `camFor()` / `camTo()` / `camGlide()` push in on the panel that just changed; panning is clamped so content still covers the viewport. 1.5–1.65 is the useful range (1.6–1.7 for small panels, 1.5 when the clicked cell and the result area must share the frame).
- **Clicks still land while zoomed**: `clickAt` zeroes the camera transform, clicks in page coordinates, then restores it — no frame is captured during that round trip. The old rule "no clicks when scale≠1" is gone.
- **Three toolchain traps, all reproduced and fixed**: `page.screenshot()` temporarily resizes the viewport, after which CDP clicks hit the iframe *element* instead of the app (capture via CDP `Page.captureScreenshot` instead); hit-testing under an iframe CSS transform is unreliable (hence the zero-and-restore click); transforming the app `body` makes WebGL maps drop their tiles (keep the camera on the outer iframe).
- **4K supersampling**: `CFG.dsf = 2` keeps zoomed text crisp; downscale to 1920×1080 with `flags=lanczos` when encoding.
- **Score generated per cut**: `music.mjs` now ships four presets (`light` 104BPM C major, `warm` 88BPM, `pulse` 124BPM, `minimal` 76BPM). `beat` marks drive section energy, `click` frames get ticks, `cam` events get a soft riser 0.5s ahead. No fixed loop.
- **New `mark()`**: label sections in the choreography (open / card / panel / detail / venue / finder / calendar / outro) for the score to follow.
- **Template structure**: `CFG.frameMatch` switches to iframe mode (locates the app frame, mounts the camera on the iframe, injects the cursor in the top document).

## 0.1.0 — 2026-10-28

Based on a real recording of the "推鉴 · AI Marketing Assistant" (ModelScope Studio). Added camera primitives and a one-command score.

- **Zoom choreography**: `zoomTo()` / `zoomPunch()` plus `CFG.zoomSelector` set `transform: scale()` on the host element (the outer `iframe` for embedded apps) frame by frame, interpolated in the script rather than with a CSS transition. `transform-origin` is computed from the unscaled rect; `clickAt` carried a hard "no clicks while scale≠1" check (removed in 0.2.0).
- **`scripts/music.mjs`**: additive synthesis written straight to WAV in Node — 126 BPM A minor (kick/bass/hats/snare/arpeggio/pad), ticks aligned to the click frames recorded in `events.json`, duration = frames / fps, BPM parameterisable. Mux with `ffmpeg -c:v copy -af loudnorm=I=-15:TP=-1.5:LRA=11 -c:a aac -b:a 160k -shortest`.
- **The template writes `events.json`**: previously only the production script recorded click frames; the template now logs clicks and camera moves by default.
- **Pacing reference**: ~60 s covers 10+ page states — login, four-step wizard, four sidebar pages, history, result; glides of 20–30 frames, 20–40 frames of hold per state.
- Docs: new zoom chapter in SKILL.md; workflow and resource list updated.

## 0.0.2 — 2026-10-23

No longer Qoder-only.

- **New `AGENTS.md`**: a universal entry point — any agent that can read files and run commands (Codex, Claude Code, Gemini CLI, Grok CLI, DeepSeek harness, Cursor, Windsurf, Aider…) can start from it, with 8 non-negotiable rules (11 as of 0.2.1) and the shortest workflow. Written in Chinese but executable for English-speaking agents too.
- **New `CLAUDE.md` / `GEMINI.md`**: pointers for agents that only read fixed filenames.
- **Installation instructions generalised**: both READMEs now offer "quickest path (clone + one sentence)", "install as a skill (Qoder / Claude Code / others)" and "project-level".
- **Naming**: the display name is 演录 (Demo Reel); the directory and invocation name remain `web-demo-video`.

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
