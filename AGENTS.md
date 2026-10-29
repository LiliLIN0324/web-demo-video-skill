# 演录 · web-demo-video

把网页 / 交互 demo 录成 1920×1080 / 30fps 演示视频：可见鼠标指针、真实点击、逐帧截图、按面板变化推近的镜头、按画面生成的配乐、ffmpeg 合成。

这份文件是**任何编码 agent** 的入口——Codex、Claude Code、Gemini CLI、Grok CLI、DeepSeek harness、Cursor、Windsurf、Aider 都按同样的方式用。Qoder 下的同名技能读 `SKILL.md`，内容一致。

## 何时使用

用户要求把某个网页、demo、交互原型录成视频，或要求"模拟鼠标操作""要有鼠标操作感""镜头要有重点""录个 demo 给别人看"。

## 开工前必读

1. 先读 `SKILL.md`（完整流程、坑位、镜头、配乐、iframe 场景）。
2. 复制 `scripts/record-template.mjs` 到工作目录，改 `CFG` 和末尾「编排」，不要直接改模板。
3. 产物用 `scripts/encode.mjs` 合成；配乐用 `scripts/music.mjs`（带 4 套风格模板）生成后混流。

## 不可省略的 10 条

违反任意一条，成片就会出问题：

1. **不用 `recordVideo`，不用 CDP screencast** —— 逐帧截图。前者依赖 Playwright 自带 ffmpeg（境内常下载失败），后者跟随应用帧率（常见 7fps）。
2. **截图走 CDP `Page.captureScreenshot`（`captureBeyondViewport: false`），不要用 `page.screenshot()`** —— 后者会临时改视口，之后 CDP 点击会落到 iframe 元素上、进不了应用。
3. **`chromium.launch({ channel: 'chrome', headless: true })`** —— 用系统 Chrome，不下载 Chromium；无头，避免窗口被关掉。
4. **指针是注入的 DOM**（`#__cur`，`pointer-events:none`，`z-index` 拉满），**输入走 CDP `Input.dispatchMouseEvent`** —— 系统光标不会被截图捕获，但页面要收到真实事件。
5. **点击时序：移动 → 按下 → 等 90ms → 松开 → 立刻截图**，中间不移动、不截图。
6. **路由切换时停拍**：点完不采集，等真实内容（标题、`img.naturalWidth>0`）就绪再继续，或直接跳过点击那一帧。否则会闪一帧骨架屏。
7. **每次点击前重新量坐标**，状态一变布局会位移。
8. **镜头只在变化处推近，幅度 1.4–1.7**：面板滑出、列表筛选、日期选中时 `camGlide(camFor(面板中心, 1.6), 面板内一点, 26)`；**不要做 1.05–1.25 的缩放**。放大状态下点击，`clickAt` 会自动把变换瞬时归零再点。
9. **相机挂在顶层 `iframe` 上，不要变换应用内部的 `body`** —— 后者会让 WebGL 地图掉瓦片。
10. **合成时显式 `scale=in_range=full:out_range=tv:in_color_matrix=bt709:out_color_matrix=bt709` + `color_*` 标签**，否则 H.264 比网页原图更亮更艳。

## 流程

```bash
npm i playwright                       # 唯一安装步骤
cp scripts/record-template.mjs record.mjs
# 改 CFG（url / frameMatch / hideSelectors / dsf）与编排（glide / clickAt / camGlide / mark）
node record.mjs                        # → frames/0000.png … + events.json
node scripts/encode.mjs ./frames ./out.mp4 30
node scripts/music.mjs ./frames ./events.json ./score.wav 30 light
ffmpeg -i out.mp4 -i score.wav -map 0:v -map 1:a -c:v copy \
  -bsf:v h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1:video_full_range_flag=0 \
  -af loudnorm=I=-15:TP=-1.5:LRA=11 -c:a aac -b:a 160k -shortest -movflags +faststart final.mp4
```

配乐不是固定 loop：`mark('panel')` 这类段落标记决定每段能量，`click` 对齐点击声，`cam` 在推近前加 0.5s 极轻上行。风格：`light` / `warm` / `pulse` / `minimal`。

需要 4K 超采样（放大不糊）：`CFG.dsf = 2`，编码时 `-vf "scale=1920:1080:flags=lanczos,..."`。

需要页面原声时，录制阶段把点击/打字帧号写进 `events.json`，后期对齐；页面用 TTS 的，录制时把 `speechSynthesis.speak` 换成空实现。

## 验收

抽帧拼图看点击瞬间、推近落点、状态切换、结尾；`ffprobe` 确认 `yuv420p(tv, bt709)`；音频响度 −17 ~ −15 LUFS，峰值不过 0 dBFS。中间产物（`frames/`）出片后删除。

## 文件

```
SKILL.md                      完整指南（必读）
AGENTS.md                     本文件：通用入口
scripts/record-template.mjs   录制器模板（指针、相机、点击穿透、CDP 截图）
scripts/encode.mjs            帧序列 → mp4
scripts/music.mjs             按画面生成配乐（4 套模板）
assets/                       cover.gif / 分镜 / 成片
```

依赖：Node 18+、Playwright、本机 Chrome、ffmpeg（PATH 或 `FFMPEG` 环境变量）。
