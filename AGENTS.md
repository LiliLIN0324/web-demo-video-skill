# 演录 · web-demo-video

把网页 / 交互 demo 录成 1920×1080 / 30fps 演示视频：可见鼠标指针、真实点击、逐帧截图、按面板变化推近的镜头、按画面生成的配乐、ffmpeg 合成。

这份文件是**任何编码 agent** 的入口——Codex、Claude Code、Gemini CLI、Grok CLI、DeepSeek harness、Cursor、Windsurf、Aider 都按同样的方式用。Qoder 下的同名技能读 `SKILL.md`，内容一致。

## 何时使用

用户要求把某个网页、demo、交互原型录成视频，或要求"模拟鼠标操作""要有鼠标操作感""镜头要有重点""录个 demo 给别人看"。

## 开工前必读

1. 先读 `SKILL.md`（完整流程、坑位、镜头、配乐、iframe 场景）。
2. 复制 `scripts/record-template.mjs` 到工作目录，改 `CFG` 和末尾「编排」，不要直接改模板。
3. 产物用 `scripts/encode.mjs` 合成；配乐用 `scripts/music.mjs`（带 4 套风格模板）生成后混流。

## 不可省略的 11 条

违反任意一条，成片就会出问题：

1. **不用 `recordVideo`，不用 CDP screencast** —— 逐帧截图。前者依赖 Playwright 自带 ffmpeg（境内常下载失败），后者跟随应用帧率（常见 7fps）。
2. **截图走 CDP `Page.captureScreenshot`（`captureBeyondViewport: false`），不要用 `page.screenshot()`** —— 后者会临时改视口，之后 CDP 点击会落到 iframe 元素上、进不了应用。
3. **`chromium.launch({ channel: 'chrome', headless: true })`** —— 用系统 Chrome，不下载 Chromium；无头，避免窗口被关掉。
4. **指针是注入的 DOM**（`#__cur`，`pointer-events:none`，`z-index` 拉满），**输入走 CDP `Input.dispatchMouseEvent`** —— 系统光标不会被截图捕获，但页面要收到真实事件。
5. **点击时序：移动 → 按下 → 等 90ms → 松开 → 立刻截图**，中间不移动、不截图。
6. **路由切换时停拍**：点完不采集，等真实内容（标题、`img.naturalWidth>0`）就绪再继续，或直接跳过点击那一帧。否则会闪一帧骨架屏。
7. **每次点击前重新量坐标**，状态一变布局会位移。
8. **镜头只在变化处推近，幅度 1.4–1.7**：面板滑出、列表筛选、日期选中时 `camGlide(camFor(面板中心, 1.6), 面板内一点, 26)`；**不要做 1.05–1.25 的缩放**。放大状态下点击，`clickAt` 会自动把变换瞬时归零再点；**量坐标同样要归零**（`center` / `centerByText` 走 `measurePage()`）——transform 下的 `getBoundingClientRect()` 返回变换后的点，点击会落到画外且毫无报错。
9. **相机挂在顶层 `iframe` 上，不要变换应用内部的 `body`** —— 后者会让 WebGL 地图掉瓦片。
10. **合成时显式 `scale=in_range=full:out_range=tv:…bt709` + `color_*` 标签，并且再补 `-x264-params "colorprim=bt709:transfer=bt709:colormatrix=bt709"`** —— 只给 `color_*` 时容器是 bt709 但码流 VUI 仍是 `unknown`，播放器按自己的默认解释，成片仍会偏亮偏艳。`encode.mjs` 两条一起发。
11. **出片先跑 `scripts/verify.mjs`** —— 它会打印 PASS/FAIL 表并把关键帧拼成一张图；有 FAIL 返回非 0。别只看"文件生成了、能播放"。

## 流程

```bash
npm i playwright                       # 唯一安装步骤
cp scripts/record-template.mjs record.mjs
# 改 CFG（url / frameMatch / hideSelectors / dsf / park / pad）与末尾编排（glide / clickAt / camGlide / mark）
node record.mjs                        # → frames/0000.png … + events.json（每个事件即时落盘，崩了也留得住）
node scripts/encode.mjs ./frames ./out.mp4 30
node scripts/music.mjs ./frames ./events.json ./score.wav 30 light
node scripts/encode.mjs ./frames ./final.mp4 30 --audio ./score.wav   # 一次做完画面 + 两趟响度归一 + 混轨
node scripts/verify.mjs ./frames ./final.mp4 --events ./events.json    # PASS/FAIL 表 + 关键帧拼图
```

配乐不是固定 loop：`mark('panel')` 这类段落标记决定每段能量，`click` 对齐点击声，`cam` 在推近前加 0.5s 极轻上行。风格：`light` / `warm` / `pulse` / `minimal`。

需要 4K 超采样（放大不糊）：`CFG.dsf = 2`，`encode.mjs` 自动 `scale=1920:1080:flags=lanczos` 降回。**`dsf` 生效的是 `Page.captureScreenshot` 的 `clip.scale`**——`newContext({deviceScaleFactor})` 对 CDP 截图不起作用（实测设 2 仍出 1920×1080），别只改那一个。

## 验收

`node scripts/verify.mjs ./frames ./final.mp4 --events ./events.json` 一屏看完：分辨率（按源帧比例推）、色彩标签（容器 + 码流）、帧数、时长、faststart（真去字节里看 `moov` 在 `mdat` 前）、码率、与源 PNG 的平均 YUV 差（≤2/255）、最差帧 PSNR（≥22 dB 的哨兵）、响度（−19 ~ −14 LUFS）。再肉眼扫一遍拼图：点击瞬间、推近落点、状态切换、结尾。中间产物（`frames/`）出片后删除。

## 文件

```
SKILL.md                      完整指南（必读）
AGENTS.md                     本文件：通用入口
scripts/record-template.mjs   录制器模板（指针、相机、点击、CDP 截图带 clip.scale、events.json 增量落盘）
scripts/encode.mjs            帧序列 → mp4（4K 自动降 1080p、bt709 容器+VUI、--audio 混轨）
scripts/verify.mjs            出片前的 PASS/FAIL 表 + 关键帧拼图
scripts/ffmpeg.mjs            ffmpeg / ffprobe 定位（环境变量 → PATH → 常见位置）
scripts/music.mjs             按画面生成配乐（4 套模板）
assets/                       cover.gif / 分镜 / 成片
```

依赖：Node 18+、Playwright、本机 Chrome、ffmpeg（PATH 或 `FFMPEG` 环境变量）。
