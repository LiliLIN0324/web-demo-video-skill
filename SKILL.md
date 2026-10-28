---
name: web-demo-video
version: 0.1.0
description: 把网页/交互 demo 录成 1080p 演示视频：可见鼠标指针、真实悬停与点击、逐帧截图保顺滑、缩放运镜、合成配乐、ffmpeg 合成。Use when asked to record a web demo, make a product/demo video from a live page, or "simulate mouse operations" for a video. 触发词：录 demo、录屏、演示视频、操作视频、鼠标演示、模拟鼠标、点按钮。
when_to_use: 用户要求把某个网页或 demo 录成视频，尤其是要求"要有鼠标操作感"时。
---

# 演录 · Web Demo Video

不绑定 Qoder。`AGENTS.md` 是给其他 agent（Codex / Claude Code / Gemini / Grok / DeepSeek 等）的通用入口，本文件是完整指南，二者内容一致。

## 核心思路

**不要用 Playwright 的 `recordVideo`**（它依赖自带的 ffmpeg 二进制，境内常下载失败），也不要在应用帧率低时用 CDP screencast。正确做法是：

- 用**系统已安装的 Chrome**（`channel: 'chrome'`），不下载 Chromium
- **逐帧 `page.screenshot()`**，自己驱动动画状态（相机/滚动/时间），保证 30fps 均匀
- 鼠标指针用**注入的 DOM 光标**画出来，动作由 **CDP `Input.dispatchMouseEvent`** 派发 —— 悬停/点击是页面真实反应
- 用系统 `ffmpeg` 合成
- **声音单独做**：逐帧截图没有音轨。录制时把每次点击/打字的帧号记进 `events.json`，后期按帧对齐合成音效与人声

输出默认 1920×1080 / 30fps。方向不明确时先问一句（9:16 竖屏 vs 16:9 横屏），默认横屏。

## 工作流

1. **探测**：用 Chrome 打开页面，进到 demo，读 `WEBGL_debug_renderer_info` 和实际重绘帧率。若应用自身只有 ~7fps（React 每帧 setState 重渲染很常见），逐帧截图方案更有必要。
2. **搭录制器**：复制 [scripts/record-template.mjs](scripts/record-template.mjs)，改 `CFG`（url、进入 demo 的按钮、要隐藏的站点导航、预热 URL、`zoomSelector`），再写编排（`glide` / `hold` / `clickSelector` / `zoomPunch`）。
3. **录制**：`node record.mjs`，产出 `frames/0000.png …` 和 `events.json`（点击/运镜帧号）。用无头 Chrome 跑，避免弹窗抢焦点、或被人中途关掉。
4. **合成**：`node scripts/encode.mjs ./frames ./out.mp4 30`（自动找 ffmpeg，加首尾淡入淡出，显式 bt709/tv 转换）。
5. **声音**：`node scripts/music.mjs ./frames ./events.json ./score.wav 30` 合成配乐（点击帧自动对齐 tick 音），再用 `-c:v copy -af loudnorm=I=-15:TP=-1.5 -c:a aac -shortest` 混流。
6. **验收**：抽帧拼图看一遍，重点看点击瞬间、状态切换、结尾；再看一眼响度。给用户看文件路径和节奏表。
7. **清理**：`frames/` 是临时产物（上千张 PNG，常达几百 MB），出片后删掉；只留成片和三件套脚本。

## 必做的细节

- **预热网络数据**：点击触发重新拉数据的按钮（切 K 值、切图层）前，先 `fetch` 一遍同样的 URL 把缓存焐热，否则会出现 1–2 秒白屏/loading。
- **loading 遮罩改成底色**：`div.bg-white.z-40{background:#000 !important}` 之类，把残余闪白变成黑，几乎看不出来。
- **点击后留 settle**：`await sleep(700)` 期间**不拍帧**，让 React 重新渲染完；同时镜头暂停（不推进角度），下一帧画面才不会跳。
- **点击前才测量坐标**：状态一变按钮会移位（如出现 `Reset View` 后底部按钮整体上移）。每次 `boundingBox()` 都要现测。
- **隐藏站点导航**：导航条常和 demo 控件重叠，甚至会拦截点击（`<header>` intercepts pointer events）。录制时用 CSS 隐藏。
- **指针 `pointer-events:none`** 且 `z-index` 拉满，否则挡住真实点击。
- **指针要能看见**：32px 白箭头 + 深色描边 + 阴影，黑底才看得清；点击加 44px 涟漪环（17 帧左右）+ 指针缩到 0.86。
- **节奏**：一次点击前给 1–1.5 秒移动 + 0.2 秒悬停；每个状态至少停 1.5–2 秒；整片 10–35 秒。

## 真实点击的时序（0.0.1 修正）

CDP 点击不是"按下松开"这么简单，时序错了站点会**静默吞掉**这次点击：

```
mouseMoved → mousePressed → sleep(90ms) → mouseReleased → 拍下这一帧
```

- **按下和松开之间不要移动指针，也不要截图。** 中间夹一次 `screenshot()` 或 `mouseMoved`，`<a>`、筛选 chip、地图列表行都可能不响应（按钮反而常常没事，容易误判）。
- 按下到松开保持约 90ms。更短（~30ms）在锚点上会失败；更长（~700ms，尤其夹了截图）会让筛选 chip 不生效。
- 松开之后立刻拍帧，涟漪从 `age=0` 开始衰减。

## 剪掉加载（0.0.1 新增）

SPA 路由跳转、或点"查看完整活动"这类链接，往往会先渲染 1 秒多的骨架屏/白屏。**不要把这些帧录进去**：

1. 点击后 `settle: 0`、`after: 0`，只保留点击那一帧；
2. 轮询目标元素（`.detail-title`、`.calendar-day` 等），期间**完全不拍帧**；
3. 页面就绪、图片加载完，再 `hold()` 继续。

成片里就是一次干净的切镜。配合点击音效，观众只会觉得"跳转很快"。先固定等 1.5–2.5 秒再轮询更稳，某些站点加载文案会晚一步出现。注意：别用"有没有骨架屏 class"当唯一信号，不同路由实现不一样。

## iframe 内嵌应用（如 ModelScope Studio）

很多平台把应用塞进 iframe，外层还有水印和悬浮客服。此时：

- 顶层 `page` 只用来加载，真正操作的对象是 `page.frames().find(f => f.url().includes('<app host>'))`；所有 `evaluate` / 坐标测量都在这个 frame 里做。
- iframe 通常铺满视口（offset 0,0）；先量 `getBoundingClientRect()`，把偏移加到 CDP 坐标上，别默认是 0。
- 隐藏外层干扰：`page.addStyleTag({ content: '.<客服class>{display:none!important} div[style*="base64"]{display:none!important}' })`。
- 指针要注入到 **iframe 内部**，否则坐标对、但光标被外层裁掉。
- 面板打开时点右上角按钮会打到面板上。先确认 `document.elementFromPoint(x,y)` 不是 `DIALOG`，必要时按 `Escape` 或点面板关闭键，等动画结束再继续。

## 颜色：别让视频比网页更亮更艳

逐帧 PNG 是 full range sRGB，H.264 默认按 tv range 解释，直接编码会整体偏亮、偏艳。编码时必须显式转换并打标签：

```
-vf "...,scale=in_range=full:out_range=tv:in_color_matrix=bt709:out_color_matrix=bt709,format=yuv420p"
-color_primaries bt709 -color_trc bt709 -colorspace bt709 -color_range tv
```

混流用 `-c:v copy` 时标签可能丢，加 `-bsf:v h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1:video_full_range_flag=0`。验收：`ffprobe` 里应显示 `yuv420p(tv, bt709)`，并把成片解码帧与源 PNG 比一下平均亮度（差值应在 1–2/255 内）。

## 常见坑

| 现象 | 原因 | 处理 |
|---|---|---|
| 画面卡顿、只有 7fps | 应用每帧重渲染 | 逐帧截图 + 自己驱动动画状态 |
| 点击后白屏 1–2 秒 | 重新 fetch 数据 / 路由骨架屏 | 预热缓存 + 加载期间停拍，成片直接切镜 |
| 点击没反应（按钮却正常） | 按下与松开之间移动了指针或截了图 | 90ms 内不动不拍，见「真实点击的时序」 |
| 筛选 chip 不生效 | 按压时间过长、中间拍帧 | 缩短到 ~90ms |
| 录制中途浏览器消失 | 无头模式关闭，或窗口被用户关掉 | `headless: true` |
| 光标位置对但没有光标 | 应用在 iframe 里，指针注入到了外层 | 注入到 app frame |
| 右上角按钮点不到 | 面板还开着，`DIALOG` 在拦截 | 先关闭面板 / Escape，等动画结束 |
| 视频比网页原图更亮更艳 | full→tv 没转、bt709 标签缺失 | 显式 scale 转换 + `color_*` 参数 |

## 声音

逐帧截图不带音轨，先探测页面怎么出声：

- 查 DOM 的 `audio/video`、是否创建 `AudioContext`、是否调用 `speechSynthesis.speak`。
- 页面自带音频且要原声：用 WebAudio 接管（`createMediaStreamDestination` + `MediaRecorder`），或系统环回；很多笔记本没有 Stereo Mix。
- 页面静音、只有 TTS：后期合成。**录制时把 `window.speechSynthesis.speak` 换成空实现**，否则朗读在漫长的截图过程里早就结束，按钮会中途复位；声音在后期放。
- 录制器把每次点击/打字的帧号写进 `events.json`；音频生成器按 `frame/fps` 对齐点击声、打字声、翻纸声、人声。
- Windows TTS：PowerShell `System.Speech`，选 `Microsoft David Desktop`，`Rate = -1`，输出 wav；人声起点 = read-aloud 点击帧 + 0.2s。
- 氛围音压到 -33 dB 左右，语音约 -20 dB；混完用 `loudnorm` 检查（-17 ~ -15 LUFS），峰值别过 0 dBFS。
- 视频先无音轨编码，最后 `ffmpeg -i video.mp4 -i audio.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -shortest -movflags +faststart out.mp4`。

## 缩放运镜（0.1.0 新增）

页面本身没有相机 API 时，最直接的"镜头语言"是对宿主元素做 CSS 缩放。模板里两个原语：

- `zoomTo(s, fx, fy, n)`：缓动插值 scale 与焦点；开场 `1.14 → 1` 是经典推近定场，结尾 `→ 0.94` 是拉远收版。
- `zoomPunch(fx, fy, peak, nIn, holdN, nOut)`：短促推近再拉回，用来强调数据面板、配图区、刚更新完的按钮。

规则：

- **对宿主元素做 `transform: scale()`**，不要改布局（`zoom`/`width`），否则页面会重排、元素位移。iframe 内嵌应用就对顶层 `iframe` 元素做，配 `CFG.zoomSelector = 'iframe'`。
- `transform-origin` 相对元素自身，而你的焦点是视口坐标——先记下元素未缩放时的 `getBoundingClientRect()`，原点 = 焦点 − 元素左上。
- **scale≠1 时禁止点击**：缩放中视觉位置 ≠ 布局坐标，`boundingBox()` 量出来的点必飘。`clickAt` 里有硬检查；编排上把 zoomPunch 放在两次点击之间，回到 1 再点。
- 指针和涟漪注入在顶层文档（`position:fixed`），不受宿主缩放影响——这正是你要的：画面推近，光标保持锐利。
- 运镜逐帧插值（缓动用 ease-in-out-cubic），不要用 CSS transition——截图节奏和 transition 时钟对不上会抖。

## 相机/动画驱动

不是所有页面都有"相机"。可选做法：

- **Plotly 3D**：每帧 `Plotly.relayout(gd, {'scene.camera.eye': {x: r·cosθ, y: r·sinθ, z}})`；先点 Stop 停掉自带自动旋转，否则 React 会覆盖相机。
- **地图**：`map.setCenter()` / `panTo()`，逐帧插值。
- **普通网页**：可做平滑滚动（`window.scrollTo` 插值）、或让页面静止只演指针。
- **没有 API**：用 CDP 拖拽（`mousePressed` → 多次 `mouseMoved` → `mouseReleased`）模拟真实拖拽。

## 合成参数

```
ffmpeg -framerate 30 -i frames/%04d.png \
  -vf "fade=t=in:st=0:d=0.4,fade=t=out:st=<dur-0.7>:d=0.7,scale=in_range=full:out_range=tv:in_color_matrix=bt709:out_color_matrix=bt709,format=yuv420p" \
  -c:v libx264 -crf 18 -preset slow -r 30 \
  -color_primaries bt709 -color_trc bt709 -colorspace bt709 -color_range tv \
  -movflags +faststart out.mp4
```

页面本身没有音频时，用 `scripts/music.mjs` 合成一条：126 BPM A 小调（kick/bass/hats/snare/琶音/pad），按 `events.json` 的点击帧落 tick 音，`loudnorm` 到 -17 ~ -15 LUFS、真峰值低于 -2 dBFS。BPM 和调式在脚本参数/常量里改。

帧数不一致时可用 `xfade` 拼接多段（每段同一机位，溶解时才不跳）。

## 资源

- [scripts/record-template.mjs](scripts/record-template.mjs) — 录制器模板（指针、涟漪、90ms 真实点击、加载切镜、缩放运镜、相机、events.json）
- [scripts/encode.mjs](scripts/encode.mjs) — 帧序列 → mp4（自动定位 ffmpeg，首尾淡入淡出，bt709/tv）
- [scripts/music.mjs](scripts/music.mjs) — 合成配乐（kick/bass/hats/snare/琶音/pad + 点击 tick 对齐，纯 node 写 WAV）
- [CHANGELOG.md](CHANGELOG.md) — 版本与改动
- 依赖：`npm i playwright`，且本机装有 Chrome
