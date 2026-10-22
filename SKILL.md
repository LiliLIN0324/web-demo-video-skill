---
name: web-demo-video
description: 把网页/交互 demo 录成 1080p 演示视频：可见鼠标指针、真实悬停与点击、逐帧截图保顺滑、ffmpeg 合成。Use when asked to record a web demo, make a product/demo video from a live page, or "simulate mouse operations" for a video. 触发词：录 demo、录屏、演示视频、操作视频、鼠标演示、模拟鼠标、点按钮。
when_to_use: 用户要求把某个网页或 demo 录成视频，尤其是要求"要有鼠标操作感"时。
---

# Web Demo Video

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
2. **搭录制器**：复制 [scripts/record-template.mjs](scripts/record-template.mjs)，改 `CFG`（url、进入 demo 的按钮、要隐藏的站点导航、预热 URL），再写编排（`glide` / `hold` / `clickSelector`）。
3. **录制**：`node record.mjs`，产出 `frames/0000.png …`。
4. **合成**：`node scripts/encode.mjs ./frames ./out.mp4 30`（自动找 ffmpeg，加首尾黑场）。
5. **声音**：需要声音时，按 `events.json` 合成音轨，再用 `-c:v copy -c:a aac -b:a 192k -shortest` 混流。
6. **验收**：抽帧拼图看一遍，重点看点击瞬间、状态切换、结尾；再看一眼频谱和响度。给用户看文件路径和节奏表。

## 必做的细节

- **预热网络数据**：点击触发重新拉数据的按钮（切 K 值、切图层）前，先 `fetch` 一遍同样的 URL 把缓存焐热，否则会出现 1–2 秒白屏/loading。
- **loading 遮罩改成底色**：`div.bg-white.z-40{background:#000 !important}` 之类，把残余闪白变成黑，几乎看不出来。
- **点击后留 settle**：`await sleep(700)` 期间**不拍帧**，让 React 重新渲染完；同时镜头暂停（不推进角度），下一帧画面才不会跳。
- **点击前才测量坐标**：状态一变按钮会移位（如出现 `Reset View` 后底部按钮整体上移）。每次 `boundingBox()` 都要现测。
- **隐藏站点导航**：导航条常和 demo 控件重叠，甚至会拦截点击（`<header>` intercepts pointer events）。录制时用 CSS 隐藏。
- **指针 `pointer-events:none`** 且 `z-index` 拉满，否则挡住真实点击。
- **指针要能看见**：32px 白箭头 + 深色描边 + 阴影，黑底才看得清；点击加 44px 涟漪环（17 帧左右）+ 指针缩到 0.86。
- **节奏**：一次点击前给 1–1.5 秒移动 + 0.2 秒悬停；每个状态至少停 1.5–2 秒；整片 10–25 秒。

## 常见坑

| 现象 | 原因 | 处理 |
|---|---|---|
| 画面卡顿、只有 7fps | 应用每帧重渲染 | 逐帧截图 + 自己驱动动画状态 |
| 点击后白屏 1–2 秒 | 重新 fetch 数据 | 预热缓存 + 遮罩改黑 + settle 跳过 |
| 录制时点击没反应 | 站点 header 拦截 | 隐藏 header 或点其下方空位 |
| 指针不在按钮上 | 状态变化导致布局位移 | 点击前重新测量坐标 |
| 切状态后镜头跳一下 | React 用旧 camera 重渲染 | 点完 settle，再继续写相机 |
| 视频倒放/倍速不对 | 帧数 ≠ 时长 | 用 `frames/fps` 校正淡出起点 |
| `browserContext.newPage: Executable doesn't exist … ffmpeg` | 用了 recordVideo | 去掉 recordVideo，改截图 |
| 下载 Chromium 卡住 | 网络受限 | `channel: 'chrome'` 用系统浏览器 |
| READ ALOUD 状态中途复位 | 真实 TTS 早已播完，截图还没拍完 | 录制时 stub `speechSynthesis.speak`，声音后期合成 |

## 声音

逐帧截图不带音轨，先探测页面怎么出声：

- 查 DOM 的 `audio/video`、是否创建 `AudioContext`、是否调用 `speechSynthesis.speak`。
- 页面自带音频且要原声：用 WebAudio 接管（`createMediaStreamDestination` + `MediaRecorder`），或系统环回；很多笔记本没有 Stereo Mix。
- 页面静音、只有 TTS：后期合成。**录制时把 `window.speechSynthesis.speak` 换成空实现**，否则朗读在漫长的截图过程里早就结束，按钮会中途复位；声音在后期放。
- 录制器把每次点击/打字的帧号写进 `events.json`；音频生成器按 `frame/fps` 对齐点击声、打字声、翻纸声、人声。
- Windows TTS：PowerShell `System.Speech`，选 `Microsoft David Desktop`，`Rate = -1`，输出 wav；人声起点 = read-aloud 点击帧 + 0.2s。
- 氛围音压到 -33 dB 左右，语音约 -20 dB；混完用 `loudnorm` 检查（-17 ~ -15 LUFS），峰值别过 0 dBFS。
- 视频先无音轨编码，最后 `ffmpeg -i video.mp4 -i audio.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -shortest -movflags +faststart out.mp4`。

## 相机/动画驱动

不是所有页面都有"相机"。可选做法：

- **Plotly 3D**：每帧 `Plotly.relayout(gd, {'scene.camera.eye': {x: r·cosθ, y: r·sinθ, z}})`；先点 Stop 停掉自带自动旋转，否则 React 会覆盖相机。
- **地图**：`map.setCenter()` / `panTo()`，逐帧插值。
- **普通网页**：可做平滑滚动（`window.scrollTo` 插值）、或让页面静止只演指针。
- **没有 API**：用 CDP 拖拽（`mousePressed` → 多次 `mouseMoved` → `mouseReleased`）模拟真实拖拽。

## 合成参数

```
ffmpeg -framerate 30 -i frames/%04d.png \
  -vf "fade=t=in:st=0:d=0.4,fade=t=out:st=<dur-0.7>:d=0.7,format=yuv420p" \
  -c:v libx264 -crf 18 -preset slow -r 30 -movflags +faststart out.mp4
```

帧数不一致时可用 `xfade` 拼接多段（每段同一机位，溶解时才不跳）。

## 资源

- [scripts/record-template.mjs](scripts/record-template.mjs) — 录制器模板（指针、涟漪、CDP 点击、相机、编排示例）
- [scripts/encode.mjs](scripts/encode.mjs) — 帧序列 → mp4（自动定位 ffmpeg，首尾淡入淡出）
- 依赖：`npm i playwright`，且本机装有 Chrome
