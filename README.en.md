<div align="center">

# 演录 · web-demo-video

**Turn any web demo into a 1080p video people will actually watch**

Real cursor movement · real clicks · deterministic frames · optional soundtrack

[![version](https://img.shields.io/badge/version-0.1.0-111111?style=flat-square)](CHANGELOG.md)
[![license](https://img.shields.io/badge/license-MIT-2ea44f?style=flat-square)](LICENSE)
[![node](https://img.shields.io/badge/Node.js-18%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white)](package.json)
[![chrome](https://img.shields.io/badge/Chrome-system-4285F4?style=flat-square&logo=googlechrome&logoColor=white)](#requirements)
[![stars](https://img.shields.io/github/stars/LiliLIN0324/web-demo-video-skill?style=social)](https://github.com/LiliLIN0324/web-demo-video-skill/stargazers)

[Quick start](#quick-start) · [How it works](#how-it-works) · [中文](README.md)

<a href="assets/demo.mp4"><img src="assets/demo.gif" alt="Demo: map, event detail, venue finder, night mode and calendar" width="840"></a>

<sub>Click to watch the full 33-second cut with sound. Demo site: 转塘艺讯.</sub>

</div>

---

## Why

Recording a web demo usually goes wrong in three places:

1. **Screen recorders drop frames** on slow pages — the cursor stutters and floats.
2. **Loading screens end up in the cut** — a second of white skeleton right after every click.
3. **There is no sound**, or the click SFX lands late.

This skill takes a different route: **frame capture, not screen recording.**

System Chrome opens the page; the script drives cursor, scroll and camera at 30fps and takes one screenshot per frame. Clicks are dispatched through CDP, so the page's own hover, filters and navigation all fire for real. ffmpeg then joins the frames with an optional synthesized soundtrack.

The page can render at 7fps — the output is still smooth. Loading can take as long as it wants — it gets cut. Sound is a choice, not a limitation.

## In practice

A real case: a map-based culture calendar, from the home map all the way to the calendar.

![storyboard](assets/storyboard.png)

| | |
|---|---|
| Runtime | 33 s |
| Resolution / fps | 1920×1080 / 30fps |
| Interactions | 13 real clicks, 1 filter, 1 scroll, 1 theme switch |
| Page's own frame rate | well below 30fps (map + React re-renders) |
| Skeleton / white frames | 0 (route loading cut out) |
| Audio | fully synthesized: ambient pad + click/transition SFX at -16 LUFS |

## Features

| | |
|---|---|
| **Clicks that land** | press → 90ms → release, with no pointer movement or screenshot in between; anchors, filter chips and map rows all respond |
| **Clean load cuts** | capture pauses while a route renders its skeleton, so the video cuts straight to the new view |
| **Iframe-ready** | wrappers like ModelScope Studio: drive the app frame, hide watermark and assistant bubble |
| **Accurate color** | explicit full→tv + bt709 conversion, so output never looks brighter or more saturated than the page |
| **Visible cursor** | injected 32px pointer + click ripple with `pointer-events:none` |
| **Optional audio** | log a frame number per action and align SFX/voice-over in post — even for silent sites |
| **No extra downloads** | system Chrome instead of Chromium; system ffmpeg instead of Playwright's binary |
| **Clean workspace** | `frames/` is disposable; the workflow deletes it after the cut is rendered |

## Quick start

Requirements: Node.js 18+, Chrome installed, ffmpeg on `PATH` (or set `FFMPEG`).

```bash
npm i playwright

# 1. Copy the template; edit CFG (url, selectors to hide, prewarm endpoints) and the choreography
cp scripts/record-template.mjs record.mjs
node record.mjs                 # → frames/0000.png …

# 2. Encode (locates ffmpeg, applies bt709/tv and fades)
node scripts/encode.mjs ./frames ./out.mp4 30
```

When you need sound, the recorder logs every click's frame number into `events.json`; align SFX by `frame / fps`, then mux:

```bash
ffmpeg -i video.mp4 -i audio.wav -map 0:v -map 1:a \
  -c:v copy -c:a aac -b:a 192k -shortest -movflags +faststart out.mp4
```

## How it works

```
            CDP input (move / press / release)
 script ───────────────────────────────────▶ real page state
   │                                             │
   │                                page.screenshot() per frame
   │                                             ▼
   │                                    frames/0000.png …
   │                                             │
   └── events.json (click frames) ──────────────┤
                                                 ▼
                                 ffmpeg (+ soundtrack) ──▶ demo.mp4
```

Key decisions:

- **No `recordVideo`**: it depends on Playwright's bundled ffmpeg (often blocked), and its frame rate follows the page.
- **No CDP screencast**: a 7fps page gives you 7fps.
- **Draw the cursor yourself**: system cursors are not captured by `page.screenshot()`. Input still goes through CDP, so the page reacts for real.
- **Stop capturing during loads**: capture runs in real time, so a 1.3s skeleton becomes 1.3s of footage. Pause, wait, resume — that is your clean cut.

## Use it with any agent

Not tied to Qoder. The repo root ships `AGENTS.md` (universal entry) and `SKILL.md` (full guide), so any agent that can read files and run commands can follow it: Codex, Claude Code, Gemini CLI, Grok CLI, DeepSeek harness, Cursor, Windsurf, Aider…

**Quickest path** — clone it anywhere, then tell your agent:

```bash
git clone https://github.com/LiliLIN0324/web-demo-video-skill.git
```

> Read `web-demo-video-skill/AGENTS.md` and record https://example.com/demo as a demo video.

**Install as a skill** (auto-triggered, no need to point at it every time):

| Agent | Install path |
|---|---|
| Qoder | `~/.qoder/skills/web-demo-video` |
| Claude Code | `~/.claude/skills/web-demo-video` |
| Others | your agent's rules/skills directory |

```bash
# Qoder example
mkdir -p ~/.qoder/skills
cp -r web-demo-video-skill ~/.qoder/skills/web-demo-video
```

```powershell
# Windows (PowerShell)
New-Item -ItemType Directory -Force "$HOME\.qoder\skills" | Out-Null
Copy-Item -Recurse web-demo-video-skill "$HOME\.qoder\skills\web-demo-video"
```

Restart the session or run `/skills reload`, then invoke `/web-demo-video`.

**Project-level**: drop `AGENTS.md`, `SKILL.md` and `scripts/` into your project — the agent reads them when it opens the repo.

## Layout

```
SKILL.md                     Full guide: click timing, load cuts, iframes, color, audio, pitfalls
AGENTS.md                    Universal entry: any agent can start from this file
CLAUDE.md / GEMINI.md        Pointers to AGENTS.md for agents that only read fixed filenames
scripts/record-template.mjs  Recorder template: cursor, ripple, 90ms clicks, load cuts, camera
scripts/encode.mjs           Frames → mp4: locates ffmpeg, fades, bt709/tv
assets/                      Demo GIF, storyboard, full video
CHANGELOG.md                 Version history
```

## Pitfalls (full list in SKILL.md)

| Symptom | Cause | Fix |
|---|---|---|
| Clicks do nothing, buttons work | pointer moved or a frame was captured between press and release | keep it still for 90ms |
| Filter chip never applies | press held too long, screenshot in the middle | shorten to ~90ms |
| A second of white in the cut | route skeleton was captured | pause, wait for the target element |
| Video looks brighter / more saturated | missing full→tv conversion and bt709 tags | explicit `scale` + `color_*` |
| Browser disappears mid-run | headful window closed by the user | `headless: true` |

## Version

Current **0.1.0**: camera language and one-command soundtrack — zoom primitives (`zoomTo`/`zoomPunch`, `CFG.zoomSelector`) and a pure-node synthesized score `scripts/music.mjs` (click frames auto-aligned ticks); the template now writes `events.json` by default. 0.0.2 made the skill agent-agnostic (`AGENTS.md`); 0.0.1 fixed click timing, load cuts, iframes, color and headless capture; 0.0.0 was the first release.

See [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE)

<div align="center">

If this skill saved you an afternoon, a star is the best thanks.

</div>
