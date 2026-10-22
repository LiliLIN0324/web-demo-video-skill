# Web Demo Video — Qoder Skill

把网页 demo 录成 1080p 演示视频：可见鼠标指针、真实悬停与点击、逐帧截图保顺滑、ffmpeg 合成，可选音效与配音。

Record a web demo as a 1080p video with a visible cursor, real hover and clicks, deterministic frame capture, and optional sound design.

当前版本 **0.0.1**（上一版 0.0.0）· 改动见 [CHANGELOG.md](CHANGELOG.md)
Current version **0.0.1** (previous: 0.0.0) · see [CHANGELOG.md](CHANGELOG.md)

---

## 中文

### 这是什么

一个 [Qoder](https://qoder.com) 技能，用于把网页 / 交互 demo 录成演示视频。它不依赖录屏软件，而是用系统 Chrome 逐帧截图，因此即使页面本身只有 7fps，成片也能是均匀顺滑的 30fps。

### 特点

- **看得见的鼠标**：注入 32px 指针 + 点击涟漪，悬停和点击由 CDP 真实派发，页面自己的 hover / 点击逻辑全部生效
- **点击不会丢**：按下 → 90ms → 松开，全程不移动、不截图；锚点、筛选 chip、地图列表行都能稳定点中
- **加载剪干净**：路由骨架屏期间停止采集，成片直接切到新页面
- **iframe 也能录**：ModelScope Studio 这类外层包装，直接操作 app frame，并隐藏水印与悬浮客服
- **逐帧可控**：相机、滚动、时间轴都由脚本驱动，不靠页面动画
- **无下载依赖**：用系统 Chrome，不下载 Chromium；用系统 ffmpeg，不用 Playwright 自带二进制
- **颜色准确**：显式 full→tv + bt709，成片不会比网页原图更亮更艳
- **声音可选**：记录每次点击 / 打字的帧号，后期对齐音效和人声；页面静音也能做出完整声轨
- **避坑清单**：白屏、loading 闪白、坐标位移、header 拦截点击、TTS 中途复位等

### 包含

```
SKILL.md                     操作指南：核心思路、工作流、点击时序、加载剪辑、iframe、颜色、常见坑
scripts/record-template.mjs  录制器模板：指针、涟漪、90ms 真实点击、加载切镜、相机、编排示例
scripts/encode.mjs           帧序列 → mp4：自动定位 ffmpeg，首尾淡入淡出，bt709/tv
CHANGELOG.md                 版本记录（0.0.0 → 0.0.1）
```

### 安装

克隆后把文件夹放到 Qoder 技能目录，目录名必须是 `web-demo-video`：

```bash
git clone https://github.com/LiliLIN0324/web-demo-video-skill.git
mkdir -p ~/.qoder/skills
cp -r web-demo-video-skill ~/.qoder/skills/web-demo-video
```

Windows（PowerShell）:

```powershell
git clone https://github.com/LiliLIN0324/web-demo-video-skill.git
New-Item -ItemType Directory -Force "$HOME\.qoder\skills" | Out-Null
Copy-Item -Recurse web-demo-video-skill "$HOME\.qoder\skills\web-demo-video"
```

然后重启会话或执行 `/skills reload`，用 `/web-demo-video` 调用。

### 快速开始

```bash
npm i playwright

# 1. 复制模板，改 CFG（url、进入 demo 的按钮、要隐藏的导航、预热 URL）和编排
cp scripts/record-template.mjs record.mjs
node record.mjs                 # 产出 frames/0000.png …

# 2. 合成（自动找 ffmpeg）
node scripts/encode.mjs ./frames ./out.mp4 30
```

默认输出 1920×1080 / 30fps。需要声音时，录制过程中把点击和打字的帧号写进 `events.json`，再按 `frame / fps` 对齐音效与人声；详见 `SKILL.md` 的「声音」一节。

### 依赖

- Node.js 18+
- Playwright（`npm i playwright`）
- 本机安装的 Chrome
- ffmpeg（在 PATH，或设置 `FFMPEG` 环境变量）

### 适用场景

产品 demo、交互原型、数据可视化、3D 场景、后台操作流程，以及任何“希望看起来像真人在点”的网页录像。不适合需要真实系统音频的录屏（请用专业录屏工具）。

---

## English

### What it is

A [Qoder](https://qoder.com) skill that turns a web demo into a presentation video. Instead of using a screen recorder, it captures deterministic screenshots frame by frame with your installed Chrome — so even a page running at 7 fps comes out as smooth 30 fps footage.

### Features

- **Visible cursor**: an injected 32px pointer with click ripples; hover and clicks are dispatched through CDP, so the page's own interactions actually fire
- **Clicks that land**: press → 90ms → release with no pointer movement or screenshot in between; anchors, filter chips and map rows all respond
- **Clean cuts through loading**: capture pauses while the skeleton screen renders, so the video cuts straight to the new view
- **Iframe-hosted apps**: works with wrappers like ModelScope Studio — drive the app frame and hide watermarks/assistant bubbles
- **Full control**: camera, scrolling, and timeline are script-driven, not dependent on page animation
- **No extra downloads**: system Chrome instead of Chromium; system ffmpeg instead of Playwright's bundled binary
- **Accurate color**: explicit full→tv + bt709 conversion, so output never looks brighter or more saturated than the page
- **Optional audio**: log the frame number of every click and keystroke, then align SFX and voice-over in post — even when the site is silent
- **Pitfall checklist**: white flashes, loading overlays, shifting coordinates, headers intercepting clicks, TTS state resetting mid-capture

### What's inside

```
SKILL.md                     Guide: approach, workflow, click timing, load cuts, iframes, color, pitfalls
scripts/record-template.mjs  Recorder template: cursor, ripples, 90ms real clicks, load cuts, camera, example choreography
scripts/encode.mjs           Frame sequence → mp4: locates ffmpeg, adds fades, bt709/tv
CHANGELOG.md                 Version history (0.0.0 → 0.0.1)
```

### Install

Clone and place the folder in your Qoder skills directory. The folder name must be `web-demo-video`:

```bash
git clone https://github.com/LiliLIN0324/web-demo-video-skill.git
mkdir -p ~/.qoder/skills
cp -r web-demo-video-skill ~/.qoder/skills/web-demo-video
```

Windows (PowerShell):

```powershell
git clone https://github.com/LiliLIN0324/web-demo-video-skill.git
New-Item -ItemType Directory -Force "$HOME\.qoder\skills" | Out-Null
Copy-Item -Recurse web-demo-video-skill "$HOME\.qoder\skills\web-demo-video"
```

Restart the session or run `/skills reload`, then invoke `/web-demo-video`.

### Quick start

```bash
npm i playwright

# 1. Copy the template; edit CFG (url, demo entry button, selectors to hide, prewarm URLs) and choreography
cp scripts/record-template.mjs record.mjs
node record.mjs                 # writes frames/0000.png …

# 2. Encode (ffmpeg is auto-detected)
node scripts/encode.mjs ./frames ./out.mp4 30
```

Output defaults to 1920×1080 at 30 fps. For sound, log click and keystroke frames into `events.json` while recording, then align SFX and voice-over by `frame / fps` — see the “声音 / Audio” section in `SKILL.md`.

### Requirements

- Node.js 18+
- Playwright (`npm i playwright`)
- Chrome installed locally
- ffmpeg on your PATH, or set the `FFMPEG` environment variable

### When to use

Product demos, interactive prototypes, data visualizations, 3D scenes, admin workflows — anything that should look like a real person operating the page. Not intended for recordings that need true system audio; use a dedicated screen recorder for that.
