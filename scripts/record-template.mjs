// 网页 demo 逐帧录制模板（v0.2.0）
// 用法：npm i playwright && cp scripts/record-template.mjs record.mjs && node record.mjs
// 只改 CFG 和末尾「编排」两处。产出 frames/0000.png … + events.json
//
// 三条硬经验（都踩过，别改回去）：
//  1) 截图必须走 CDP Page.captureScreenshot，不要用 page.screenshot()：
//     后者会临时改变视口，之后 CDP 点击会落到 iframe 元素上、进不了应用。
//  2) 镜头是「缩放 + 平移」，对宿主做 transform；放大状态下点击命中不稳，
//     所以 clickAt 会先把变换瞬时归零、按页面坐标点击、再立刻恢复（归零期间不拍帧）。
//  3) 相机不要做在应用文档内部（变换 body）：带 WebGL 地图的页面会掉瓦片。
//     iframe 内嵌应用就把相机挂在顶层 iframe 上。
import { chromium } from 'playwright'
import fs from 'node:fs'

const CFG = {
  url: 'https://example.com/#/demo',
  outDir: './frames',
  width: 1920,
  height: 1080,
  fps: 30,
  // 2 = 双倍渲染（3840×2160），放大时文字仍然干净，成片再缩回 1080p；1 = 常规
  dsf: 2,

  // 应用在 iframe 里（ModelScope Studio、CodePen 预览、嵌入式 demo）时填匹配串，
  // 例如 '.ms.show'；普通页面留 null。
  frameMatch: null,

  // 顶层要隐藏的站点导航 / 水印（iframe 场景常需要）
  hideSelectors: ['header', '[role="banner"]'],
  extraCss: '',

  // 指针入场/离场停在画外
  park: [2010, 1180],

  // 无头模式：不弹窗、不抢焦点，避免录制中途被人关掉
  headless: true,
}

const W = CFG.width
const H = CFG.height
const FPS = CFG.fps
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

fs.rmSync(CFG.outDir, { recursive: true, force: true })
fs.mkdirSync(CFG.outDir, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome', headless: CFG.headless })
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: CFG.dsf,
})
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 160)))
await page.goto(CFG.url, { waitUntil: 'domcontentloaded', timeout: 90000 })

// ---- 定位被操作的应用：iframe 内嵌还是主文档 ----
const inFrame = !!CFG.frameMatch
let app = null
if (inFrame) {
  for (let i = 0; i < 120; i++) {
    app = page.frames().find((f) => f.url().includes(CFG.frameMatch))
    if (app) break
    await sleep(500)
  }
  if (!app) throw new Error(`找不到 iframe: ${CFG.frameMatch}`)
} else {
  app = page.mainFrame()
}
const evalApp = (fn, arg) => (inFrame ? app.evaluate(fn, arg) : page.evaluate(fn, arg))

await page.waitForTimeout(2500)
if (CFG.hideSelectors.length) {
  await page.addStyleTag({
    content: CFG.hideSelectors.map((s) => `${s} { display: none !important; }`).join('\n') + '\n' + CFG.extraCss,
  })
} else if (CFG.extraCss) {
  await page.addStyleTag({ content: CFG.extraCss })
}

// ---- 指针 + 涟漪：放在「不会被相机变换」的那一层 ----
// iframe 场景 → 顶层文档；普通页面 → <html> 下、与 body 平级
const pointerRoot = inFrame ? 'page' : 'html'
if (inFrame) {
  await page.evaluate(() => {
    const s = document.createElement('style')
    s.textContent = `
    #__cur{position:fixed;left:0;top:0;width:32px;height:32px;z-index:2147483647;pointer-events:none;
      filter:drop-shadow(0 2px 7px rgba(0,0,0,.55)) drop-shadow(0 0 1.5px rgba(255,255,255,.6));will-change:transform}
    #__rip{position:fixed;left:0;top:0;width:44px;height:44px;border-radius:50%;border:1.5px solid #fff;
      box-shadow:0 0 0 1px rgba(0,0,0,.25);pointer-events:none;z-index:2147483646;opacity:0;will-change:transform,opacity}`
    document.head.appendChild(s)
    const c = document.createElement('div')
    c.id = '__cur'
    c.innerHTML = `<svg width="32" height="32" viewBox="0 0 24 24">
      <path d="M5 2.5 L5 19.2 L9.5 15.2 L12.3 21.6 L15.2 20.2 L12.4 14 L18.2 13.8 Z"
        fill="#ffffff" stroke="#0b0b0b" stroke-width="1.7" stroke-linejoin="round"/></svg>`
    document.body.appendChild(c)
    const r = document.createElement('div')
    r.id = '__rip'
    document.body.appendChild(r)
  })
} else {
  await page.evaluate(() => {
    const s = document.createElement('style')
    s.textContent = `
    #__cur{position:fixed;left:0;top:0;width:32px;height:32px;z-index:2147483647;pointer-events:none;will-change:transform}
    #__rip{position:fixed;left:0;top:0;width:44px;height:44px;border-radius:50%;border:1.5px solid #fff;
      pointer-events:none;z-index:2147483646;opacity:0;will-change:transform,opacity}`
    document.documentElement.appendChild(s)
    document.documentElement.style.overflow = 'hidden'
    const c = document.createElement('div')
    c.id = '__cur'
    c.innerHTML = `<svg width="32" height="32" viewBox="0 0 24 24">
      <path d="M5 2.5 L5 19.2 L9.5 15.2 L12.3 21.6 L15.2 20.2 L12.4 14 L18.2 13.8 Z"
        fill="#ffffff" stroke="#0b0b0b" stroke-width="1.7" stroke-linejoin="round"/></svg>`
    document.documentElement.appendChild(c)
    const r = document.createElement('div')
    r.id = '__rip'
    document.documentElement.appendChild(r)
  })
}

const cdp = await ctx.newCDPSession(page)
const capture = async (file) => {
  const { data } = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false, // 关键：不要捕获视口外，否则会改视口
    fromSurface: true,
  })
  fs.writeFileSync(file, Buffer.from(data, 'base64'))
}
const mouse = (type, x, y, extra = {}) =>
  cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'none', buttons: 0, clickCount: 0, ...extra })

let idx = 0
let ripple = null
let cur = [...CFG.park]                 // 指针的页面坐标
let cam = { s: 1, tx: 0, ty: 0 }        // 相机：translate(tx,ty) scale(s)
let lastMouse = [-1, -1]
const events = []

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const ripAge = () => (ripple ? idx - ripple.frame : -1)

// 相机只能平移到「内容仍铺满视口」的范围内，否则会露出底色
const clampTx = (tx, s) => Math.min(0, Math.max(W - W * s, tx))
const clampTy = (ty, s) => Math.min(0, Math.max(H - H * s, ty))
// 让页面坐标 (cx,cy) 落在屏幕 (ax,ay)，缩放 s —— 推近某个面板就靠它
const camFor = (cx, cy, s, ax = W / 2, ay = H / 2) => ({
  s,
  tx: clampTx(ax - cx * s, s),
  ty: clampTy(ay - cy * s, s),
})
const mapPt = (p) => [cam.tx + p[0] * cam.s, cam.ty + p[1] * cam.s]

const applyCam = async (s, tx, ty) => {
  await page.evaluate(([host, s2, tx2, ty2]) => {
    const el = host === 'iframe' ? document.querySelector('iframe') : document.body
    if (!el) return
    if (s2 === 1 && tx2 === 0 && ty2 === 0) {
      el.style.transform = 'none'
      el.style.transformOrigin = ''
    } else {
      el.style.transformOrigin = '0 0'
      el.style.transform = `translate(${tx2}px, ${ty2}px) scale(${s2})`
    }
  }, [inFrame ? 'iframe' : 'body', s, tx, ty])
}

async function frame(x, y, age = -1) {
  cur = [x, y]
  const [vx, vy] = mapPt([x, y])
  const mx = Math.round(vx)
  const my = Math.round(vy)
  if (mx !== lastMouse[0] || my !== lastMouse[1]) {
    await mouse('mouseMoved', mx, my)
    lastMouse = [mx, my]
  }
  const [rx, ry] = ripple ? mapPt([ripple.x, ripple.y]) : [0, 0]
  await page.evaluate(([cx, cy, rx2, ry2, a, host, s, tx, ty]) => {
    const c = document.getElementById('__cur')
    if (c) c.style.transform = `translate(${cx - 6.6}px, ${cy - 3.3}px)`
    const r = document.getElementById('__rip')
    if (r) {
      if (a < 0) r.style.opacity = 0
      else {
        const p = Math.min(a / 17, 1)
        r.style.opacity = String((1 - p) * 0.9)
        r.style.transform = `translate(${rx2 - 22}px, ${ry2 - 22}px) scale(${0.4 + p * 1.1})`
      }
    }
    const el = host === 'iframe' ? document.querySelector('iframe') : document.body
    if (!el) return
    if (s === 1 && tx === 0 && ty === 0) { el.style.transform = 'none'; el.style.transformOrigin = '' }
    else {
      el.style.transformOrigin = '0 0'
      el.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`
    }
  }, [vx, vy, rx, ry, age, inFrame ? 'iframe' : 'body', cam.s, cam.tx, cam.ty])
  await capture(`${CFG.outDir}/${String(idx).padStart(4, '0')}.png`)
  idx++
}

async function glide(to, n) {
  const from = cur
  for (let i = 1; i <= n; i++) {
    const t = ease(i / n)
    await frame(from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, ripAge())
  }
}
async function hold(p, n) { for (let i = 0; i < n; i++) await frame(p[0], p[1], ripAge()) }

// 镜头：只做缩放（指针不动）
async function camTo(target, n) {
  const from = { ...cam }
  for (let i = 1; i <= n; i++) {
    const t = ease(i / n)
    cam = {
      s: from.s + (target.s - from.s) * t,
      tx: from.tx + (target.tx - from.tx) * t,
      ty: from.ty + (target.ty - from.ty) * t,
    }
    await frame(cur[0], cur[1], ripAge())
  }
  cam = { ...target }
  events.push({ frame: idx, type: 'cam', s: cam.s })
}
// 镜头 + 指针同时动：推近某个面板时，指针顺势落到面板上
async function camGlide(target, to, n) {
  const from = { ...cam }
  const p0 = [...cur]
  for (let i = 1; i <= n; i++) {
    const t = ease(i / n)
    cam = {
      s: from.s + (target.s - from.s) * t,
      tx: from.tx + (target.tx - from.tx) * t,
      ty: from.ty + (target.ty - from.ty) * t,
    }
    await frame(p0[0] + (to[0] - p0[0]) * t, p0[1] + (to[1] - p0[1]) * t, ripAge())
  }
  cam = { ...target }
  cur = [...to]
  events.push({ frame: idx, type: 'cam', s: cam.s })
}

// 真实点击：按下 → 停 90ms → 松开，全程不移动指针、不截图。
// 如果此刻相机会放大，先把变换归零（否则命中会飘），点完立刻恢复；这一来一回不拍帧。
async function clickAt(p, settle = 0) {
  const zoomed = cam.s !== 1 || cam.tx !== 0 || cam.ty !== 0
  if (zoomed) {
    await applyCam(1, 0, 0)
    await sleep(50)
  }
  const x = Math.round(p[0])
  const y = Math.round(p[1])
  await mouse('mouseMoved', x, y)
  await sleep(40)
  await mouse('mousePressed', x, y, { button: 'left', buttons: 1, clickCount: 1 })
  await sleep(90)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
  ripple = { x: p[0], y: p[1], frame: idx }
  events.push({ frame: idx, type: 'click', at: { x, y } })
  if (zoomed) {
    await applyCam(cam.s, cam.tx, cam.ty)
    await sleep(180) // 给合成器一帧时间重新栅格化
  }
  lastMouse = [-1, -1]
  await frame(p[0], p[1], 0)
  if (settle) await sleep(settle)
}

// 坐标现测（状态一变布局会位移）
const center = async (sel) => {
  const p = await evalApp((s) => {
    const el = document.querySelector(s)
    if (!el) return null
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) return null
    return [r.x + r.width / 2, r.y + r.height / 2]
  }, sel)
  if (!p) throw new Error(`找不到元素或不可见: ${sel}`)
  return p
}
const centerByText = async (text, { exact = true, scope = 'a,button,[role=button]' } = {}) => {
  const p = await evalApp(([t, ex, sc]) => {
    const cand = []
    for (const el of document.querySelectorAll(sc)) {
      const s = (el.innerText || '').trim()
      const ok = ex ? s === t : s.startsWith(t)
      if (!ok) continue
      const r = el.getBoundingClientRect()
      if (r.width < 10 || r.height < 2) continue
      cand.push({ a: r.width * r.height, p: [r.x + r.width / 2, r.y + r.height / 2] })
    }
    if (!cand.length) return null
    cand.sort((a, b) => a.a - b.a)
    return cand[0].p
  }, [text, exact, scope])
  if (!p) throw new Error(`找不到文本: ${text}`)
  return p
}
// 路由切换会先渲染骨架屏。这期间停拍，等内容就绪再继续 → 成片是一次干净切镜
const waitFor = async (sel, ms = 20000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const ok = await evalApp((s) => {
      const el = document.querySelector(s)
      if (!el) return false
      const r = el.getBoundingClientRect()
      return r.width > 2 && r.height > 2
    }, sel).catch(() => false)
    if (ok) return true
    await sleep(200)
  }
  return false
}
// 切镜：相机复位、指针移到画外，这一帧不拍
const cut = async () => {
  cam = { s: 1, tx: 0, ty: 0 }
  cur = [...CFG.park]
  ripple = null
  lastMouse = [-1, -1]
  await applyCam(1, 0, 0)
  await mouse('mouseMoved', CFG.park[0], CFG.park[1])
}
// 段落标记：配乐按它决定每段能量
const mark = (name) => {
  events.push({ frame: idx, type: 'beat', name })
  console.log(`  [mark] ${name} @ ${(idx / FPS).toFixed(1)}s`)
}

// ===== 编排：改成你要点的东西 =====
const beats = async () => {
  mark('open')
  await hold(cur, 12) // 开场 0.4s，指针在画外

  // 例：点第一张卡片，等 900ms 让面板滑出
  const card = await center('.card')
  mark('card')
  await glide(card, 40)
  await hold(card, 8)
  await clickAt(card, 900)
  await hold([card[0] + 2, card[1] + 1], 10)

  // 例：面板出现了 —— 推近它，指针顺势落到面板里，再在放大画面里点按钮。
  // 缩放值 1.4–1.7 才有「镜头感」；1.05–1.25 只会让人觉得画面在抖。
  mark('panel')
  await camGlide(camFor(1690, 340, 1.65), [1690, 360], 26)
  await hold([1690, 360], 30)
  const more = await centerByText('查看更多', { exact: false })
  await glide(more, 26)
  await hold(more, 6)
  await clickAt(more, 0)

  // 例：整页跳转 —— 点完不拍帧，等新页就绪再继续
  await waitFor('.detail-title')
  await cut()
  mark('detail')
  await hold(cur, 32)

  // 收尾：拉回 1:1，指针移开，停 1 秒
  mark('outro')
  await glide([1500, 300], 18)
  await camTo({ s: 1, tx: 0, ty: 0 }, 30)
  await hold(cur, 14)
}

await beats()
fs.writeFileSync('events.json', JSON.stringify(events, null, 1))
await browser.close()
console.log(`frames: ${idx}  (${(idx / FPS).toFixed(2)}s)  → ${CFG.outDir}`)
