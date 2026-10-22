<div align="center">

# 演录 · web-demo-video

**把网页 demo 录成能直接给人看的 1080p 演示视频**

真实鼠标轨迹 · 真实点击 · 逐帧可控 · 可选声轨

[![version](https://img.shields.io/badge/version-0.0.2-111111?style=flat-square)](CHANGELOG.md)
[![license](https://img.shields.io/badge/license-MIT-2ea44f?style=flat-square)](LICENSE)
[![node](https://img.shields.io/badge/Node.js-18%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white)](package.json)
[![chrome](https://img.shields.io/badge/Chrome-system-4285F4?style=flat-square&logo=googlechrome&logoColor=white)](#依赖)
[![stars](https://img.shields.io/github/stars/LiliLIN0324/web-demo-video-skill?style=social)](https://github.com/LiliLIN0324/web-demo-video-skill/stargazers)

[快速开始](#快速开始) · [工作方式](#工作方式) · [实测效果](#实测效果) · [English](README.en.md)

<a href="assets/demo.mp4"><img src="assets/demo.gif" alt="录屏演示：地图、活动详情、找场地、夜间模式与日历" width="840"></a>

<sub>点图片看完整成片（33 秒，带音轨）。案例站点：转塘艺讯。</sub>

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

一个真实案例：地图型文化日程站「转塘艺讯」，从首页一路点到日历。

![storyboard](assets/storyboard.png)

| | |
|---|---|
| 成片时长 | 33 秒 |
| 分辨率 / 帧率 | 1920×1080 / 30fps |
| 真实操作 | 13 次点击、1 次筛选、1 次滚动、1 次主题切换 |
| 页面自身帧率 | 明显低于 30fps（地图 + React 重渲染） |
| 白屏 / 骨架屏 | 0 帧（路由加载全部剪掉） |
| 声轨 | 全合成：氛围垫 + 点击/过场音效，-16 LUFS |

## 特点

| 能力 | 说明 |
|---|---|
| **点击不会丢** | 按下 → 90ms → 松开，期间不移动指针、不截图。锚点、筛选 chip、地图列表行都能稳定点中 |
| **加载剪干净** | 路由骨架屏期间停止采集，成片直接切到新页面，而不是快进一段 loading |
| **iframe 也能录** | ModelScope Studio 这类外层包装：直接操作 app frame，并隐藏水印与悬浮客服 |
| **颜色不偏** | 显式 full→tv + bt709，成片不会比网页原图更亮更艳 |
| **看得见的鼠标** | 注入 32px 指针 + 点击涟漪，`pointer-events:none`，不挡真实点击 |
| **声音可选** | 记录每次操作的帧号，后期对齐音效/人声；页面静音也能做出完整声轨 |
| **无额外下载** | 系统 Chrome，不下载 Chromium；系统 ffmpeg，不用 Playwright 自带二进制 |
| **出片即清理** | `frames/` 是一次性产物，附清理约定，不会留下几百 MB 截图 |

## 快速开始

依赖：Node.js 18+、本机 Chrome、ffmpeg（在 PATH 里，或设置 `FFMPEG`）。

```bash
npm i playwright

# 1. 复制模板，改 CFG（url、要隐藏的导航、预热接口）和末尾的编排
cp scripts/record-template.mjs record.mjs
node record.mjs                 # → frames/0000.png …

# 2. 合成（自动定位 ffmpeg，做 bt709/tv 转换与首尾淡入淡出）
node scripts/encode.mjs ./frames ./out.mp4 30
```

需要声音时，录制过程中会把每次点击的帧号写进 `events.json`；按 `frame / fps` 对齐音效，再混流：

```bash
ffmpeg -i video.mp4 -i audio.wav -map 0:v -map 1:a \
  -c:v copy -c:a aac -b:a 192k -shortest -movflags +faststart out.mp4
```

## 工作方式

```
             CDP 真实输入（移动 / 按下 / 松开）
 脚本编排 ───────────────────────────────▶ 页面真实状态
   │                                          │
   │                            每帧 page.screenshot()
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
scripts/record-template.mjs  录制器模板：指针、涟漪、90ms 点击、加载切镜、相机
scripts/encode.mjs           帧序列 → mp4：定位 ffmpeg、淡入淡出、bt709/tv
assets/                      演示 GIF、分镜图、成片
CHANGELOG.md                 版本记录
```

## 常见坑（完整版在 SKILL.md）

| 现象 | 原因 | 处理 |
|---|---|---|
| 点击没反应，按钮却正常 | 按下与松开之间移动了指针或截了图 | 90ms 内不动不拍 |
| 筛选 chip 不生效 | 按压时间过长、中间拍帧 | 缩短到约 90ms |
| 成片里有 1 秒多白屏 | 路由骨架屏被录进去 | 停拍，等目标元素就绪再继续 |
| 视频比网页更亮更艳 | full→tv 没转、bt709 标签缺失 | 显式 `scale` 转换 + `color_*` |
| 录制中途浏览器消失 | 无头模式关闭、窗口被人关掉 | `headless: true` |

## 版本

当前 **0.0.2**：通用化——新增 `AGENTS.md` 通用入口，Qoder 之外的 Codex / Claude Code / Gemini / Grok / DeepSeek 等 agent 可直接使用。上一版 0.0.1 修正点击时序、加载切镜、iframe、颜色与无头录制；0.0.0 为首版。

完整改动见 [CHANGELOG.md](CHANGELOG.md)。

## License

[MIT](LICENSE)

<div align="center">

如果这个 skill 帮你省下一下午，点个 Star 就是最好的支持。

</div>
