# 演录 · web-demo-video

把网页 / 交互 demo 录成 1920×1080 / 30fps 演示视频：可见鼠标指针、真实点击、逐帧截图、ffmpeg 合成、可选音轨。

这份文件是**任何编码 agent** 的入口——Codex、Claude Code、Gemini CLI、Grok CLI、DeepSeek harness、Cursor、Windsurf、Aider 都按同样的方式用。Qoder 下的同名技能读 `SKILL.md`，内容一致。

## 何时使用

用户要求把某个网页、demo、交互原型录成视频，或要求"模拟鼠标操作""要有鼠标操作感""录个 demo 给别人看"。

## 开工前必读

1. 先读 `SKILL.md`（完整流程、坑位、声音、相机驱动）。
2. 复制 `scripts/record-template.mjs` 到工作目录，改 `CFG` 和末尾「编排」，不要直接改模板。
3. 产物用 `scripts/encode.mjs` 合成。

## 不可省略的 8 条

违反任意一条，成片就会出问题：

1. **不用 `recordVideo`，不用 CDP screencast** —— 逐帧 `page.screenshot()`。前者依赖 Playwright 自带 ffmpeg（境内常下载失败），后者跟随应用帧率（常见 7fps）。
2. **`chromium.launch({ channel: 'chrome', headless: true })`** —— 用系统 Chrome，不下载 Chromium；无头，避免窗口被关掉。
3. **指针是注入的 DOM**（`#__cur`，`pointer-events:none`，`z-index` 拉满），**输入走 CDP `Input.dispatchMouseEvent`** —— 系统光标不会被截图捕获，但页面要收到真实事件。
4. **点击时序：移动 → 按下 → 等 90ms → 松开 → 立刻截图**，中间不移动、不截图。否则 `<a>`、筛选 chip、列表行的点击会被站点吞掉。
5. **路由切换时停拍**：点击后不采集，轮询目标元素（或 `waitFor`）出现再继续。成片是干净切镜，不会录进 1 秒多骨架屏。
6. **每次点击前重新量坐标**（`boundingBox()`），状态一变布局会位移。
7. **隐藏站点导航 / 遮罩**：`header` 之类常与 demo 控件重叠甚至拦截点击。
8. **合成时显式 `scale=in_range=full:out_range=tv:in_color_matrix=bt709:out_color_matrix=bt709` + `color_*` 标签**，否则 H.264 比网页原图更亮更艳。

## 流程

```bash
npm i playwright                       # 唯一安装步骤
cp scripts/record-template.mjs record.mjs
# 改 CFG（url / 进入 demo 的按钮 / 隐藏选择器 / 预热 URL）与编排
node record.mjs                        # → frames/0000.png …
node scripts/encode.mjs ./frames ./out.mp4 30
```

需要声音时，录制阶段把每次点击/打字的帧号写进 `events.json`，后期按 `frame / fps` 对齐；页面用 TTS 的，录制时把 `speechSynthesis.speak` 换成空实现，声音后期合成。

## 验收

抽帧拼图看点击瞬间、状态切换、结尾；`ffprobe` 确认 `yuv420p(tv, bt709)`；音频响度 −17 ~ −15 LUFS，峰值不过 0 dBFS。中间产物（`frames/`）出片后删除，只留成片与三个脚本。

## 文件

```
SKILL.md                      完整指南（必读）
AGENTS.md                     本文件：通用入口
scripts/record-template.mjs   录制器模板
scripts/encode.mjs            帧序列 → mp4
assets/                       demo.gif / 分镜 / 成片
```

依赖：Node 18+、Playwright、本机 Chrome、ffmpeg（PATH 或 `FFMPEG` 环境变量）。
