---
name: web-demo-video
version: 0.2.2
description: 把网页/交互 demo 录成 1080p 演示视频：可见鼠标指针、真实悬停与点击、逐帧截图保顺滑、按面板变化推近的镜头、按画面生成的配乐、ffmpeg 合成。Use when asked to record a web demo, make a product/demo video from a live page, or "simulate mouse operations" for a video. 触发词：录 demo、录屏、演示视频、操作视频、鼠标演示、模拟鼠标、点按钮。
when_to_use: 用户要求把某个网页或 demo 录成视频，尤其是要求"要有鼠标操作感"或"镜头要有重点"时。
---

# 演录 · Web Demo Video

不绑定 Qoder。`AGENTS.md` 是给其他 agent（Codex / Claude Code / Gemini / Grok / DeepSeek 等）的通用入口，本文件是完整指南，二者内容一致。

## 核心思路

**不要用 Playwright 的 `recordVideo`**（它依赖自带的 ffmpeg 二进制，境内常下载失败），也不要在应用帧率低时用 CDP screencast。正确做法是：

- 用**系统已安装的 Chrome**（`channel: 'chrome'`），不下载 Chromium
- **逐帧截图**，自己驱动指针、滚动、镜头和页面状态，保证 30fps 均匀
- 鼠标指针用**注入的 DOM 光标**画出来，动作由 **CDP `Input.dispatchMouseEvent`** 派发 —— 悬停/点击是页面真实反应
- 用系统 `ffmpeg` 合成
- **声音单独做**：录制时把每次点击、每次推镜的帧号记进 `events.json`，后期按画面重新编曲

输出默认 1920×1080 / 30fps。方向不明确时先问一句（9:16 竖屏 vs 16:9 横屏），默认横屏。

## 工作流

1. **探测**：用 Chrome 打开页面，进到 demo，读实际重绘帧率。若应用自身只有 ~7fps（React 每帧 setState 重渲染很常见），逐帧截图方案更有必要。顺手量关键元素的 `getBoundingClientRect()`——镜头目标点从这儿来。
2. **搭录制器**：复制 `scripts/record-template.mjs`，改 `CFG`（url、`frameMatch`、要隐藏的导航/水印、`dsf`），再写编排（`glide` / `hold` / `clickAt` / `camGlide`）。
3. **录制**：`node record.mjs`，产出 `frames/0000.png …` 和 `events.json`（点击、推镜、段落标记）。用无头 Chrome 跑。`events.json` 每发生一个事件就落盘一次，中途崩了也留得下已经录到的部分。
4. **合成**：`node scripts/encode.mjs ./frames ./out.mp4 30`（自动找 ffmpeg，首尾淡入淡出，显式 bt709/tv，4K 帧自动降回 1080p）。
5. **配乐**：`node scripts/music.mjs ./frames ./events.json ./score.wav 30 light`，然后**重跑第 4 步并加 `--audio ./score.wav`**——一条命令做完视频 + 归一化响度，不用再手写混流命令。
6. **验收**：`node scripts/verify.mjs ./frames ./out.mp4 --events ./events.json`，出一张 PASS/FAIL 表（分辨率、色彩标签、帧数、faststart、和源图的平均色差、最差帧 PSNR、响度）+ 关键帧拼图。有 FAIL 就返回非 0，可以直接当发布前的门禁。
7. **清理**：`frames/` 是一次性产物（上千张 PNG），出片后删掉。

## 镜头：只在变化处推近

**先记住一条：1.05–1.25 的缩放不要做。** 观众只会觉得画面在抖，说不清在看什么。要么不缩放，要么把镜头推到「刚刚发生变化的那块面板」上，幅度 1.4–1.7。

模板里的相机是「缩放 + 平移」：

- `camFor(cx, cy, s, ax, ay)`：让页面坐标 `(cx,cy)` 落到屏幕 `(ax,ay)`，缩放 `s`。传面板中心进去就是"推近这块面板"。
- `camTo(target, n)`：缓动到目标机位（指针不动）。
- `camGlide(target, pt, n)`：推近的同时把指针送到 `pt`，用于"面板出现 → 镜头过去 → 指针落到面板里"。
- 平移被 `clampTx/clampTy` 限制在"内容仍铺满视口"的范围内，否则会露出底色。

编排规则：

- **只在下面这些瞬间推近**：面板滑出、列表被筛选、日期被选中、状态切换。其余时间保持 1:1，不要为了"动感"随便推。
- **幅度按内容定**：小面板（400px 宽）1.6–1.7；中等面板 1.5–1.6；要同时框住"被点的格子 + 结果区"就用 1.5 并算好目标点。
- **推完要能点到**：放大状态下点击命中会飘，`clickAt` 会自动把变换瞬时归零、按页面坐标点击、再恢复（中间不拍帧），所以"推近面板 → 在面板里点按钮"是安全的。
- **但测量也要归零**：`getBoundingClientRect()` 在带 `transform` 的层里返回的是**变换后**的坐标，而 `glide` / `clickAt` 全按页面坐标工作。推近状态下量按钮 = 量到一个被放大过的点，点击会落到画外空白，页面毫无反应而画面看着一切正常。模板里的 `center()` / `centerByText()` 现在都走 `measurePage()`（先归零相机再量、量完恢复）。实测：1.7 下量「发送」得到 x=1692，那一次点击什么都没发生。
- 缩放值来自实测：先量面板的 `getBoundingClientRect()`，再 `camFor` 过去，不要凭感觉给数字。
- 指针和涟漪注入在**不会被变换的那一层**（iframe 场景是顶层文档，普通页面是 `<html>` 下与 `<body>` 平级），画面推近时光标始终 32px 锐利。
- 运镜逐帧插值（ease-in-out-cubic），不要用 CSS transition——截图节奏和 transition 时钟对不上会抖。
- 想更清晰：`CFG.dsf = 2` 出 3840×2160 帧，`encode.mjs` 自动用 lanczos 缩回 1920×1080，放大处文字不糊。**注意 `dsf` 生效的是 `Page.captureScreenshot` 的 `clip.scale`，不是 `newContext({deviceScaleFactor})`**——实测后者对 CDP 截图完全没有作用（设成 2 仍出 1920×1080），只写 deviceScaleFactor 会是个假开关。
- 指针入场/离场停在画外：`CFG.park` 留 `null` 时按 `width/height` 推（`[W+90, H+40]`），9:16 竖屏不用改；想让指针从别的方向进来才显式给坐标。
- 帧文件名位数：`CFG.pad`（默认 4）。帧数超过 `10^pad` 时录制器会直接报错停下，而不是默默把编号撑成 5 位让 `encode` 的 `%04d` 在中途断片。

## 三个会吃掉点击 / 画面的坑

现象都很像"站点不响应"，其实是工具链问题：

| 现象 | 真正原因 | 处理 |
|---|---|---|
| 点卡片没反应，手动点正常 | 用了 `page.screenshot()`，它临时改视口，之后 CDP 点击落到 iframe **元素**上，进不了应用 | 截图改走 CDP `Page.captureScreenshot`（`captureBeyondViewport: false`） |
| 放大状态下点按钮没反应 | iframe 带 CSS `transform` 时命中测试不稳定 | 点击瞬间把变换归零 → 按页面坐标点 → 立刻恢复，期间不拍帧 |
| 推近后地图变空白（"地图载入中…"） | 相机做在应用文档内部（变换 `body`），WebGL 地图掉瓦片 | 相机挂在顶层 `iframe` 上，不要变换应用内部的 `body` |

另外：路由切换的那一帧常正好截到骨架屏。点完别立刻拍，等目标内容（标题、图片 `naturalWidth>0`）真的就绪再继续，或干脆跳过点击那一帧。

## 必做的细节

- **预热网络数据**：点击触发重新拉数据的按钮前，先 `fetch` 一遍同样的 URL 把缓存焐热。
- **loading 遮罩改成底色**：`div.bg-white.z-40{background:#000 !important}` 之类，把残余闪白变成黑。
- **点击后留 settle**：`await sleep(700)` 期间**不拍帧**，让 React 重渲染完；镜头同步暂停。
- **点击前才测量坐标**：状态一变按钮会移位，每次 `boundingBox()` 都要现测。
- **隐藏站点导航**：导航条常和 demo 控件重叠，甚至拦截点击。录制时用 CSS 隐藏。
- **指针 `pointer-events:none`** 且 `z-index` 拉满，否则挡住真实点击。
- **节奏**：一次点击前给 1–1.5 秒移动 + 0.2 秒悬停；每个状态至少停 1.5–2 秒；整片 10–40 秒。

## 真实点击的时序

CDP 点击不是"按下松开"这么简单，时序错了站点会**静默吞掉**这次点击：

```
mouseMoved → mousePressed → sleep(90ms) → mouseReleased → 拍下这一帧
```

- **按下和松开之间不要移动指针，也不要截图。** 中间夹一次 `screenshot()` 或 `mouseMoved`，`<a>`、筛选 chip、地图列表行都可能不响应（按钮反而常常没事，容易误判）。
- 按下到松开保持约 90ms。更短（~30ms）在锚点上会失败；更长（~700ms，尤其夹了截图）会让筛选 chip 不生效。
- 松开之后立刻拍帧，涟漪从 `age=0` 开始衰减。

## 剪掉加载

SPA 路由跳转、或点"查看完整活动"这类链接，往往会先渲染 1 秒多的骨架屏/白屏。**不要把这些帧录进去**：

1. 点击后 `settle: 0`、`after: 0`，只保留点击那一帧（甚至跳过）；
2. 轮询目标元素（标题、`.detail-title`、图片加载完成），期间**完全不拍帧**；
3. 页面就绪、图片加载完，再 `hold()` 继续。

成片里就是一次干净的切镜。注意：别用"有没有骨架屏 class"当唯一信号，不同路由实现不一样；等真实内容（`img.naturalWidth > 0`、`h1.innerText.length > 6`）更稳。

## iframe 内嵌应用（如 ModelScope Studio）

很多平台把应用塞进 iframe，外层还有水印和悬浮客服。此时：

- 顶层 `page` 只用来加载，真正操作的对象是 `page.frames().find(f => f.url().includes('<app host>'))`；所有 `evaluate` / 坐标测量都在这个 frame 里做。
- 模板里配 `CFG.frameMatch`（如 `'.ms.show'`），相机就自动挂到 `iframe` 元素上，指针注入到顶层文档。
- 隐藏外层干扰：`div[style*="data:image/png;base64"]`（水印层）、`div.acss-eluzu8` 之类悬浮客服。
- 面板打开时点右上角按钮会打到面板上。先确认 `document.elementFromPoint(x,y)` 不是 `DIALOG`，必要时按 `Escape` 或点面板关闭键。
- **点击要算在 iframe 坐标系里**：`getBoundingClientRect()` 在 frame 内部量，坐标即视口坐标（iframe 铺满且未缩放时）。

## 颜色：别让视频比网页更亮更艳

逐帧 PNG 是 full range sRGB，H.264 默认按 tv range 解释，直接编码会整体偏亮、偏艳。编码时必须显式转换并打标签：

```
-vf "...,scale=in_range=full:out_range=tv:in_color_matrix=bt709:out_color_matrix=bt709,format=yuv420p"
-color_primaries bt709 -color_trc bt709 -colorspace bt709 -color_range tv
-x264-params "colorprim=bt709:transfer=bt709:colormatrix=bt709"
```

**最后那行不能省。** `-color_*` 只写进容器（matroska/mp4 的 box），码流自己的 VUI 里 `color_primaries / transfer` 还是 `unknown`；播放器遇到 unknown 会按自己的默认解释，同一份像素换个地方就偏色。本机实测：只给 `-color_*` → 容器 bt709 但码流 unknown；两个都给 → 两边都是 bt709。`encode.mjs` 已经两行一起发。

混流用 `-c:v copy` 时标签可能丢，加 `-bsf:v h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1:video_full_range_flag=0`（用 `encode.mjs --audio` 就不用手写这条）。

验收别只看标签，要看像素：`verify.mjs` 把成片解码帧和源 PNG 做 `blend=difference` 再 `signalstats` 取平均 YUV 差，正确时 Y/UV 都在 1–2/255；实测错位 5 帧会跳到 Y≈1.95。**不要拿 PSNR 当色差门槛**——指针涟漪、字体抗锯齿这类噪声内容即使完全对齐也只有 ~29 dB，PSNR 只留着当「≥22 dB 说明没拿错帧」的哨兵。

## 压缩已有视频（不是自己录的片子）

手上已经有一条 mp4，只想变小一点（封面片段、历史片子）时，规则和自己出的片不一样：

```bash
node scripts/compress.mjs ./in.mp4 ./out-lite.mp4            # 默认 CRF 29
node scripts/compress.mjs ./in.mp4 ./out-lite.mp4 --crf 23   # 片子里有字幕/小字时
```

- **不要重采样帧率。** 源是 23/25fps 就照搬，只有需要降分辨率时才插 `scale`。一律加 `-r 30` 会重复插帧：23fps 的源压成 30fps，每 30 帧里只有 23 帧是新的（实测 196 秒那条从 4512 帧变成 5883 帧）。文件略大是小事，帧时序错位才是麻烦。`compress.mjs` 没有帧率参数，想犯错也没入口。
- **按时间点取样比色差的闸门，帧时序一变就废。** 错位后同一时间戳落到不同源帧，静止画面实际只差 0.04/255，整段 YAVG 却报 2.1–2.9，看着像偏色。就算保住了帧率也别用时间取样：VFR 源上精确 seek 会落在帧边界两侧，一个镜头切换能把 Y 顶到 13/255。**比的是帧号**：`-vf select=eq(n\,i)` 取第 i 帧，两边同一序号必然是同一帧（`compress.mjs` 已这么做）。
- **CRF 档位靠 1:1 裁切定，不靠指标。** 实测一条 1380×774 的宣传片字幕，CRF 29 各项指标全绿，裁出字幕区域 1:1 看边缘已经发糊；CRF 23 的字幕边缘和原片一致。取样看文字、细线、logo 边缘，码率只当次级证据。
- **派生版另开一个 key，别覆盖原片。** CDN 对象带 `max-age=31536000, immutable`，覆盖后同 URL 的旧内容还在边缘缓存里；新版走新路径，改引用一处即可回退。

## 常见坑

| 现象 | 原因 | 处理 |
|---|---|---|
| 画面卡顿、只有 7fps | 应用每帧重渲染 | 逐帧截图 + 自己驱动动画状态 |
| 点击后白屏 1–2 秒 | 重新 fetch 数据 / 路由骨架屏 | 预热缓存 + 加载期间停拍 |
| 点击没反应（按钮却正常） | 按下与松开之间移动了指针或截了图 | 90ms 内不动不拍 |
| 筛选 chip 不生效 | 按压时间过长、中间拍帧 | 缩短到 ~90ms |
| 点击完全到不了应用 | 用了 `page.screenshot()` | 改 CDP `Page.captureScreenshot` |
| 放大后点不中按钮 | iframe transform 下的命中测试 | `clickAt` 点击前瞬时归零相机 |
| 推近状态下点了按钮页面没反应，坐标看着又"在画面里" | `getBoundingClientRect()` 在带 transform 的层里返回变换后的坐标 | 测量走 `measurePage()`：先归零相机、量完恢复（模板的 `center` / `centerByText` 已内置） |
| 推近后地图空白 | 相机变换了应用内部 `body` | 相机挂到顶层 `iframe` |
| 成片里闪一帧骨架屏 | 点击那一帧正好截到路由过渡 | 点完跳过拍摄，等真实内容就绪 |
| 视频比网页原图更亮更艳 | full→tv 没转、bt709 标签缺失 | 显式 scale 转换 + `color_*`，再加 `-x264-params` 写进码流 VUI |
| 设了 `dsf = 2` 帧还是 1920×1080 | `deviceScaleFactor` 对 CDP 截图不起作用 | 用 `Page.captureScreenshot` 的 `clip.scale` |
| ffmpeg 报 `Unrecognized option 'vsync'` | ffmpeg 8（Lavf63）删掉了 `-vsync` | 不写帧率同步参数，需要时用 `-fps_mode` |
| 验收里响度永远是"没有声轨" | `ffprobe -select_streams v:0` 会把音频流整个滤掉 | 探测两种流都别带 `-select_streams` |
| 响度偏离目标 2–3 LU | 单趟 `loudnorm` 是动态归一，短素材尤其不准（实测 -12.54 vs 目标 -15） | 先量再 `linear=true` 第二趟（`encode.mjs` 已内置，实测落在 -14.8） |
| PSNR 只有 29 dB 以为坏了 | 涟漪/抗锯齿这类噪声内容 PSNR 上限本就低 | 平均 YUV 差当主指标，PSNR 只当 ≥22 dB 的哨兵 |
| 录制中途浏览器消失 | 无头模式关闭、窗口被人关掉 | `headless: true` |

## 配乐：每次按画面重新生成

**不要套同一段 loop。** 同一个模板也要按这条片的段落重新编曲。`scripts/music.mjs` 用 `events.json` 里的三类事件：

| 事件 | 由谁写 | 作用 |
|---|---|---|
| `beat`（open / card / panel / detail / venue / finder / calendar / outro…） | 编排里的 `mark('panel')` | 决定每段能量：推近面板处更满，读详情页处变薄 |
| `click` | `clickAt` 自动写 | 对齐点击声（木头 / 柔铃，随模板变） |
| `cam` | `camTo` / `camGlide` 自动写 | 推近前 0.5s 加一道极轻的上行气声，把镜头和音乐绑在一起 |

内置模板：

| 名称 | BPM | 调式 | 配器 | 适合 |
|---|---|---|---|---|
| `light` | 104 | C 大调 C–Am–F–G | 沙锤 + 马林巴 + 轻贝斯，底鼓很轻 | 文创 / 日程 / 生活方式，偏轻松 |
| `warm` | 88 | 降 B 大调 F–C–Dm–Bb | 慢钢琴 + 弦垫 + 轻刷子 | 叙事、纪录片感、情感型产品 |
| `pulse` | 124 | A 小调 Am–F–C–G | 四拍底鼓 + 拨弦琶音 | 工具、AI、效率类，需要推进感 |
| `minimal` | 76 | C 大调 C–G–Am–F | 只有气声垫 + 稀疏铃音 | 慢节奏、阅读型，突出画面本身 |

```bash
node scripts/music.mjs ./frames ./events.json ./score.wav 30 light
node scripts/encode.mjs ./frames ./final.mp4 30 --audio ./score.wav
```

`--audio` 是同一条编码命令里直接混轨：先跑一趟 `loudnorm` 预量（拿到 `input_i/tp/lra/thresh/target_offset`），第二趟用 `linear=true` 归一，省掉以前那段手写的 `ffmpeg -c:v copy … -bsf:v h264_metadata …`，也就不会出现"混流时标签丢了、颜色又变一次"。响度目标用 `--lufs` 改（默认 -15）。

加风格：在 `music.mjs` 的 `PRESETS` 里加一条（bpm / transpose / prog / pad / kick / bass / arp / tick / energy），文件末尾有字段速查。

## 页面自带声音时

- 查 DOM 的 `audio/video`、是否创建 `AudioContext`、是否调用 `speechSynthesis.speak`。
- 要原声：WebAudio 接管（`createMediaStreamDestination` + `MediaRecorder`）或系统环回（很多笔记本没有 Stereo Mix）。
- 只有 TTS：录制时把 `window.speechSynthesis.speak` 换成空实现（否则朗读在漫长截图里早就结束、按钮会中途复位），声音后期放。
- Windows TTS：PowerShell `System.Speech`，`Microsoft David Desktop`，`Rate = -1`，输出 wav；人声起点 = 点击帧 + 0.2s。
- 氛围音压到 -33 dB 左右，语音约 -20 dB；混完 `loudnorm` 检查（-17 ~ -15 LUFS），峰值别过 0 dBFS。

## 相机/动画驱动

不是所有页面都有"相机"。可选做法：

- **Plotly 3D**：每帧 `Plotly.relayout(gd, {'scene.camera.eye': {x: r·cosθ, y: r·sinθ, z}})`；先点 Stop 停掉自带自动旋转，否则 React 会覆盖相机。
- **地图**：`map.setCenter()` / `panTo()`，逐帧插值。
- **普通网页**：平滑滚动（`window.scrollTo` 插值），或让页面静止只演指针。
- **没有 API**：用 CDP 拖拽（`mousePressed` → 多次 `mouseMoved` → `mouseReleased`）模拟真实拖拽。

## 合成参数

日常只用一条命令：

```bash
node scripts/encode.mjs ./frames ./final.mp4 30 --audio ./score.wav
#                    [--size 1080x1920] [--crf 18] [--preset slow] [--lufs -15] [--no-fade] [--ffmpeg <路径>]
```

它替你做的事，等价于手工这条（列出是为了让你知道每条都不能省）：

```
ffmpeg -framerate 30 -i frames/%04d.png \
  -vf "scale=1920:1080:flags=lanczos,fade=t=in:st=0:d=0.4,fade=t=out:st=<dur-0.7>:d=0.7,\
scale=in_range=full:out_range=tv:in_color_matrix=bt709:out_color_matrix=bt709,format=yuv420p" \
  -c:v libx264 -crf 18 -preset slow -r 30 \
  -color_primaries bt709 -color_trc bt709 -colorspace bt709 -color_range tv \
  -x264-params "colorprim=bt709:transfer=bt709:colormatrix=bt709" \
  -movflags +faststart out.mp4
```

- **4K 帧（`dsf = 2`）自动降回 1080p**：`encode.mjs` 先读第 0 帧的尺寸，只有和 `--size` 不一致时才插 `scale=…:flags=lanczos`。以前这条要手写，忘了就得到一只 3840×2160、体积翻四倍、播放器还可能不认的片子（实测真页面 4K 帧 30 张 → 1920×1080，色差 Y 0.38 / UV 0.29）。
- **ffmpeg 路径不再写死**：`scripts/ffmpeg.mjs` 按 `FFMPEG` 环境变量 → PATH → 常见安装位置找，`ffprobe` 用同一个目录下的同名兄弟。以前脚本里挂着某台机器的绝对路径，换台机器就报 spawn ENOENT。
- **总长比淡入+淡出还短**（比如试录 1 秒）时自动关掉 fade，不会让渐变吃掉整条片。
- 帧数不一致时可用 `xfade` 拼接多段（每段同一机位，溶解时才不跳）。

## 资源

- [scripts/record-template.mjs](scripts/record-template.mjs) — 录制器模板（指针、涟漪、90ms 真实点击、加载切镜、按面板推近的相机、iframe 模式、CDP 截图带 clip.scale、events.json 增量落盘）
- [scripts/encode.mjs](scripts/encode.mjs) — 帧序列 → mp4（4K 自动降 1080p、bt709 写进容器和码流 VUI、两趟响度归一、`--audio` 一次混完）
- [scripts/verify.mjs](scripts/verify.mjs) — 出片前的 PASS/FAIL 表 + 关键帧拼图（分辨率、色彩标签、帧数、faststart、色差、PSNR 哨兵、响度）；有 FAIL 返回非 0
- [scripts/compress.mjs](scripts/compress.mjs) — 已有 mp4 → 更小的 mp4：不动帧率、只降宽度（永不放大）、bt709 容器+VUI、留音轨，压完自己出 PASS/FAIL 表
- [scripts/ffmpeg.mjs](scripts/ffmpeg.mjs) — ffmpeg / ffprobe 定位（`FFMPEG` 环境变量 → PATH → 常见安装位置），encode 和 verify 共用
- [scripts/music.mjs](scripts/music.mjs) — 按画面生成配乐（4 套模板 + 段落能量 + 点击/推镜对齐，纯 node 写 WAV）
- [CHANGELOG.md](CHANGELOG.md) — 版本与改动
- 依赖：`npm i playwright`，且本机装有 Chrome、ffmpeg（PATH 或 `FFMPEG`）
