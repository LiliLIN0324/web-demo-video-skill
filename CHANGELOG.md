# Changelog

## 0.0.1 — 2026-10-22

首次带版本号的更新，基于「转塘艺讯」实战录制。

- **修正真实点击时序**：按下 → 停 90ms → 松开，期间不移动指针、不截图。此前模板会在按下和松开之间拍一帧，导致 `<a>`、筛选 chip、地图列表行的点击被站点吞掉。
- **剪掉路由加载**：新增 `waitFor()`，跳转后停止采集，等目标内容就绪再继续，成片是一次干净切镜，不再出现 1 秒多的骨架屏。
- **iframe 内嵌应用**：补充 ModelScope Studio 一类外层包装的处理（操作 app frame、隐藏水印/悬浮客服、指针注入时机、面板遮挡）。
- **颜色修正**：`encode.mjs` 显式做 full→tv + bt709 转换并写入 `color_*` 标签，避免 H.264 比网页原图更亮更艳。
- **无头录制**：模板默认 `headless: true`，不抢焦点、不会被人中途关掉。
- **工作目录清理**：`frames/` 等中间产物出片后删除，README 注明。

## 0.0.0 — 2026-10-22

首个版本：系统 Chrome + 逐帧截图 + 注入鼠标指针 + CDP 真实输入 + ffmpeg 合成，含双语 README 与避坑清单。

---

## 0.0.1 — 2026-10-22

First versioned release, based on a real recording of "转塘艺讯".

- **Fixed real click timing**: press → 90ms → release, with no pointer movement or screenshot in between. The old template captured a frame while the button was held, which made some sites (anchors, filter chips, map rows) silently drop the click.
- **Skip route loading**: added `waitFor()`; stop capturing during navigation and resume once the new view is ready. The result is a clean cut instead of a second-long skeleton screen.
- **Iframe-hosted apps**: documented ModelScope Studio-style wrappers (drive the app frame, hide watermark/assistant, inject the cursor inside the frame, wait out overlays).
- **Color fix**: `encode.mjs` now converts full→tv and tags bt709 explicitly, so the video no longer looks brighter or more saturated than the page.
- **Headless capture**: template defaults to `headless: true` — no stolen focus, no accidental close.
- **Cleanup**: delete `frames/` and other intermediates after delivery.

## 0.0.0 — 2026-10-22

Initial version: system Chrome + deterministic screenshots + injected cursor + real CDP input + ffmpeg encoding, with a bilingual README and a pitfall checklist.
