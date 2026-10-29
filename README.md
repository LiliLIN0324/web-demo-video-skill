<div align="center">

# 演录 · web-demo-video

**把网页 demo 录成能直接给人看的 1080p 演示视频**

真实鼠标轨迹 · 真实点击 · 逐帧可控 · 可选声轨

[![version](https://img.shields.io/badge/version-0.2.0-111111?style=flat-square)](CHANGELOG.md)
[![license](https://img.shields.io/badge/license-MIT-2ea44f?style=flat-square)](LICENSE)
[![node](https://img.shields.io/badge/Node.js-18%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white)](package.json)
[![chrome](https://img.shields.io/badge/Chrome-system-4285F4?style=flat-square&logo=googlechrome&logoColor=white)](#依赖)
[![stars](https://img.shields.io/github/stars/LiliLIN0324/web-demo-video-skill?style=social)](https://github.com/LiliLIN0324/web-demo-video-skill/stargazers)

[快速开始](#快速开始) · [工作方式](#工作方式) · [实测效果](#实测效果) · [English](README.en.md)

<a href="assets/cover.mp4"><img src="assets/cover.gif" alt="录屏演示：登录、创建向导、侧栏快览、查看成品" width="840"></a>

<sub>点图片看完整成片（42 秒，带合成配乐）。案例站点：推鉴 · AI 营销助手（ModelScope Studio）。</sub>

</div>

---

## 它解决什么

录一个网页 demo，通常卡在三件事上：

1. **录屏软件在低帧率页面上掉帧**——页面本身 7fps，鼠标像在飘；
2. **点击后的白屏、骨架屏被原样录进去**——成片里全是 loading；
3. **页面没有声音，或者声音和操作对不上**——点击声总是慢半拍。

这个 skill 换了个思路：**不录屏，逐帧拍。**

用系统 Chrome 打开页面，脚本按 30fps 驱动鼠标、滚动和相机，每帧截一张图；点击通过 CDP 真实派发，页面自己的 hover、筛选、跳转逻辑全部照常工作。最后用 ffmpeg 把帧和一条合成音轨拼成视频。

所以：页面再卡，成片也是顺的；加载多久，剪掉就是；要不要声音，都可以做。

## 实测效果

一个真实案例：ModelScope Studio 上的「推鉴 · AI 营销助手」，从登录一路走完创建向导、侧栏快览，直抵已完成成品。

![storyboard](assets/storyboard.png)

| | |
|---|---|
| 成片时长 | 42 秒 |
| 分辨率 / 帧率 | 1920×1080 / 30fps |
| 真实操作 | 16 次点击、1 次平滑滚动、10 个页面状态 |
| 镜头 | 4 处面板变化处真实推近（1.5–1.65×），其余 1:1，无小幅抖动 |
| 宿主环境 | iframe 内嵌应用（ms.show），外层水印/悬浮件已处理 |
| 白屏 / 骨架屏 | 0 帧（路由加载全部剪掉） |
| 声轨 | 按画面重新生成的配乐（段落能量 + 点击/推镜对齐），-15 LUFS |

## 特点

| 能力 | 说明 |
|---|---|
| **点击不会丢** | 按下 → 90ms → 松开，期间不移动指针、不截图。锚点、筛选 chip、地图列表行都能稳定点中 |
| **加载剪干净** | 路由骨架屏期间停止采集，成片直接切到新页面，而不是快进一段 loading |
| **iframe 也能录** | ModelScope Studio 这类外层包装：直接操作 app frame，并隐藏水印与悬浮客服 |
| **颜色不偏** | 显式 full→tv + bt709，成片不会比网页原图更亮更艳 |
| **看得见的鼠标** | 注入 32px 指针 + 点击涟漪，`pointer-events:none`，不挡真实点击 |
| **镜头有重点** | 只在面板滑出、列表筛选、日期选中时推近（1.5–1.65×），其余保持 1:1；推近后可继续在放大画面里点击 |
| **配乐按画面生成** | `music.mjs` 4 套风格（light/warm/pulse/minimal），段落能量跟着镜头走，点击帧对齐点击声，推镜前加 0.5s 上行 |
| **声音可选** | 记录每次操作的帧号，后期对齐音效/人声；页面静音也能做出完整声轨 |
| **无额外下载** | 系统 Chrome，不下载 Chromium；系统 ffmpeg，不用 Playwright 自带二进制 |
| **工具链的坑已趟平** | 截图走 CDP 而非 `page.screenshot()`；放大后点击自动归零相机再点；相机挂在 iframe 上，不比页面内部变换导致地图空白 |
| **出片即清理** | `frames/` 是一次性产物，附清理约定，不会留下几百 MB 截图 |

## 快速开始

依赖：Node.js 18+、本机 Chrome、ffmpeg（在 PATH 里，或设置 `FFMPEG`）。

```bash
npm i playwright

# 1. 复制模板，改 CFG（url、frameMatch、要隐藏的导航/水印、dsf）和末尾的编排
cp scripts/record-template.mjs record.mjs
node record.mjs                 # → frames/0000.png … + events.json

# 2. 合成（自动定位 ffmpeg，做 bt709/tv 转换与首尾淡入淡出）
node scripts/encode.mjs ./frames ./out.mp4 30
```

需要配乐时一条命令（`light`/`warm`/`pulse`/`minimal` 四套风格，段落能量跟着 `mark()` 走，点击帧自动对齐点击声）：

```bash
node scripts/music.mjs ./frames ./events.json ./score.wav 30 light
ffmpeg -i out.mp4 -i score.wav -map 0:v -map 1:a -c:v copy \
  -bsf:v h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1:video_full_range_flag=0 \
  -af loudnorm=I=-15:TP=-1.5:LRA=11 -c:a aac -b:a 160k -shortest -movflags +faststart final.mp4
```

## 工作方式

```
             CDP 真实输入（移动 / 按下 / 松开）
 脚本编排 ───────────────────────────────▶ 页面真实状态
   │                                          │
   │                            每帧 CDP 截图
   │                                          ▼
   │                                 frames/0000.png …
   │                                          │
   └── events.json（点击帧号）───────────────┤
                                              ▼
                              ffmpeg（+ 合成音轨）──▶ demo.mp4
```

几个关键决定：

- **为什么不用 `recordVideo`**：它依赖 Playwright 自带的 ffmpeg 二进制，境内常下载失败；而且帧率跟着页面走。
- **为什么不用 CDP screencast**：页面只有 7fps 时，它也只会给你 7fps。
- **为什么指针要自己画**：系统光标不会被截进 `page.screenshot()`，必须注入一个 DOM 指针；真实输入仍然走 CDP，所以页面反应是真的。
- **为什么加载要停拍**：逐帧截图是"实时"的，页面加载 1.3 秒就会录进 1.3 秒骨架屏。停拍再继续，成片就是一次干净的切镜。

## 在任何 agent 里用

不绑定 Qoder。仓库根目录有 `AGENTS.md`（通用入口）和 `SKILL.md`（完整指南），任何能读写文件、能跑命令的 agent 都能照做：Codex、Claude Code、Gemini CLI、Grok CLI、DeepSeek harness、Cursor、Windsurf、Aider……

**最省事的方式**——克隆到任意位置，然后对 agent 说：

```bash
git clone https://github.com/LiliLIN0324/web-demo-video-skill.git
```

> 读 `web-demo-video-skill/AGENTS.md`，把 https://example.com/demo 录成演示视频。

**装成技能**（自动触发，不用每次指路）：

| Agent | 安装位置 |
|---|---|
| Qoder | `~/.qoder/skills/web-demo-video` |
| Claude Code | `~/.claude/skills/web-demo-video` |
| 其他 | 放进你的 agent 读取的规则/技能目录 |

```bash
# 以 Qoder 为例
mkdir -p ~/.qoder/skills
cp -r web-demo-video-skill ~/.qoder/skills/web-demo-video
```

```powershell
# Windows (PowerShell)
New-Item -ItemType Directory -Force "$HOME\.qoder\skills" | Out-Null
Copy-Item -Recurse web-demo-video-skill "$HOME\.qoder\skills\web-demo-video"
```

重开会话或执行 `/skills reload`，然后用 `/web-demo-video` 调用。

**项目级**：把 `AGENTS.md`、`SKILL.md`、`scripts/` 放进你的项目，agent 打开项目就会读到。

## 目录

```
SKILL.md                     完整操作指南：点击时序、加载剪辑、iframe、颜色、声音、坑位
AGENTS.md                    通用入口：任何 agent 读这一份就能开工
CLAUDE.md / GEMINI.md        指向 AGENTS.md（给只认固定文件名的 agent）
scripts/record-template.mjs  录制器模板：指针、涟漪、90ms 点击、加载切镜、按面板推近的相机、iframe 模式
scripts/encode.mjs           帧序列 → mp4：定位 ffmpeg、淡入淡出、bt709/tv
scripts/music.mjs            按画面生成配乐：4 套模板 + 段落能量 + 点击/推镜对齐
assets/                      演示 GIF、分镜图、成片
CHANGELOG.md                 版本记录
```

## 常见坑（完整版在 SKILL.md）

| 现象 | 原因 | 处理 |
|---|---|---|
| 点击没反应，按钮却正常 | 按下与松开之间移动了指针或截了图 | 90ms 内不动不拍 |
| 点击完全到不了应用 | 用了 `page.screenshot()`，点击落到 iframe 元素上 | 改 CDP `Page.captureScreenshot` |
| 放大后点不中按钮 | iframe transform 下命中测试不稳 | 点击前瞬时归零相机，点完恢复 |
| 推近后地图空白 | 相机变换了应用内部 `body` | 相机挂到顶层 `iframe` |
| 筛选 chip 不生效 | 按压时间过长、中间拍帧 | 缩短到约 90ms |
| 成片里有 1 秒多白屏 | 路由骨架屏被录进去 | 停拍，等目标元素就绪再继续 |
| 视频比网页更亮更艳 | full→tv 没转、bt709 标签缺失 | 显式 `scale` 转换 + `color_*` |
| 录制中途浏览器消失 | 无头模式关闭、窗口被人关掉 | `headless: true` |

## 版本

当前 **0.2.0**：镜头重写与配乐模板化——相机改成「缩放 + 平移」，只在面板变化处推近 1.5–1.65×，并支持放大状态下继续点击；配乐改为按画面重新生成（4 套风格 + 段落能量 + 点击/推镜对齐）；记录并修复了三个工具链坑（`page.screenshot()` 吃掉点击、iframe transform 下命中漂移、变换 body 导致地图空白）。上一版 0.1.0 加镜头原语与一键配乐，0.0.2 通用化，0.0.1 修正点击时序与颜色，0.0.0 为首版。

完整改动见 [CHANGELOG.md](CHANGELOG.md)。

## License

[MIT](LICENSE)

<div align="center">

如果这个 skill 帮你省下一下午，点个 Star 就是最好的支持。

</div>
