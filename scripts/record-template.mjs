// 网页 demo 逐帧录制模板
// 用法：npm i playwright && node record-template.mjs
// 只改 CFG 和末尾「编排」两处。产出 frames/0000.png …
import { chromium } from 'playwright'
import fs from 'node:fs'

const CFG = {
  url: 'https://example.com/#/demo',
  outDir: './frames',
  width: 1920,
  height: 1080,
  fps: 30,

  // 进入 demo 的按钮（页面内切换，不是新开页）；没有就设 null
  openSelector: null,
  // demo 就绪的标志
  readySelector: 'body',
  // 录制时隐藏的站点导航（常与 demo 控件重叠、甚至拦截点击）
  hideSelectors: ['header', '[role="banner"]'],
  // 额外 CSS：把残余 loading 白底改黑等
  extraCss: '',
  // 点击前预热的数据 URL，避免切状态时白屏 1–2 秒
  prewarm: [],

  // 需要自己驱动相机时填（Plotly 3D 示例）；不需要就设 null
  camera: {
    selector: '.js-plotly-plot',
    stopSelector: 'button:has-text("Stop")', // 停掉自带自动旋转，否则 React 会覆盖相机
    radius: 2.12,
    z: 1.5,
    speed: 0.3,          // 弧度/秒
    start: 0.35,
  },

  // 指针入场/离场停在画外
  park: [1980, 1160],
}

const W = CFG.width
const H = CFG.height
const FPS = CFG.fps
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

fs.rmSync(CFG.outDir, { recursive: true, force: true })
fs.mkdirSync(CFG.outDir, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome' })
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: 1,
})
const page = await ctx.newPage()
await page.goto(CFG.url, { waitUntil: 'networkidle', timeout: 90000 })

if (CFG.openSelector) await page.click(CFG.openSelector)
await page.waitForSelector(CFG.readySelector, { timeout: 60000 })

if (CFG.hideSelectors.length) {
  await page.addStyleTag({
    content: CFG.hideSelectors.map((s) => `${s} { display: none !important; }`).join('\n'),
  })
}

if (CFG.prewarm.length) {
  await page.evaluate(async (urls) => {
    await Promise.all(urls.map((u) => fetch(u).then((r) => r.text()).catch(() => '')))
  }, CFG.prewarm)
}

if (CFG.camera?.stopSelector) {
  await page.click(CFG.camera.stopSelector)
  await sleep(400)
}

// 注入可见指针 + 点击涟漪
await page.evaluate((extraCss) => {
  const s = document.createElement('style')
  s.textContent = `
  #__cur{position:fixed;left:0;top:0;width:32px;height:32px;z-index:2147483647;pointer-events:none;
    filter:drop-shadow(0 2px 6px rgba(0,0,0,.65)) drop-shadow(0 0 1px rgba(255,255,255,.5));will-change:transform}
  #__rip{position:fixed;left:0;top:0;width:44px;height:44px;border-radius:50%;border:1.5px solid #fff;
    pointer-events:none;z-index:2147483646;opacity:0;will-change:transform,opacity}
  ${extraCss}
  `
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
}, CFG.extraCss)

const cdp = await ctx.newCDPSession(page)
const mouse = (type, x, y, extra = {}) =>
  cdp.send('Input.dispatchMouseEvent', {
    type, x, y, button: 'none', buttons: 0, clickCount: 0, ...extra,
  })

const cam = CFG.camera
let theta = cam ? cam.start : 0
let idx = 0
let ripple = null
let dragging = false
let cur = [...CFG.park]

const setAngle = async (t) => {
  if (!cam) return
  await page.evaluate(([sel, th, r, z]) => {
    const gd = document.querySelector(sel)
    return window.Plotly.relayout(gd, {
      'scene.camera.eye': { x: r * Math.cos(th), y: r * Math.sin(th), z },
    })
  }, [cam.selector, t, cam.radius, cam.z])
}

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const ripAge = () => (ripple ? idx - ripple.frame : -1)

// orbit=true 时这一帧相机前进 1/fps 秒；状态切换后先 settle 再继续
async function frame(x, y, orbit = true, age = -1) {
  if (orbit && cam) theta += cam.speed / FPS
  cur = [x, y]
  await setAngle(theta)
  await mouse('mouseMoved', Math.round(x), Math.round(y))
  await page.evaluate(([cx, cy, rx, ry, a, down]) => {
    const c = document.getElementById('__cur')
    c.style.transform = `translate(${cx - 6.6}px, ${cy - 3.3}px) scale(${down ? 0.86 : 1})`
    const r = document.getElementById('__rip')
    if (a < 0) r.style.opacity = 0
    else {
      const p = Math.min(a / 17, 1)
      r.style.opacity = String((1 - p) * 0.9)
      r.style.transform = `translate(${rx - 22}px, ${ry - 22}px) scale(${0.4 + p * 1.1})`
    }
  }, [x, y, ripple ? ripple.x : 0, ripple ? ripple.y : 0, age, dragging])
  await page.screenshot({ path: `${CFG.outDir}/${String(idx).padStart(4, '0')}.png` })
  idx++
}

async function glide(to, n, orbit = true) {
  const from = cur
  for (let i = 1; i <= n; i++) {
    const t = ease(i / n)
    await frame(from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, orbit, ripAge())
  }
}

async function hold(p, n, orbit = true) {
  for (let i = 0; i < n; i++) await frame(p[0], p[1], orbit, ripAge())
}

// settle 期间不拍帧：让 React 重渲染完，避免白屏/跳帧
async function clickAt(p, settle = 0) {
  await mouse('mouseMoved', p[0], p[1])
  await mouse('mousePressed', p[0], p[1], { button: 'left', buttons: 1, clickCount: 1 })
  dragging = true
  await frame(p[0], p[1], true, -1)
  dragging = false
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: p[0], y: p[1], button: 'left', buttons: 0, clickCount: 1,
  })
  ripple = { x: p[0], y: p[1], frame: idx - 1 }
  if (settle) await sleep(settle)
}

// 坐标必须现测：状态一变布局会位移
const center = async (sel) => {
  const b = await page.locator(sel).first().boundingBox()
  if (!b) throw new Error(`找不到元素或不可见: ${sel}`)
  return [b.x + b.width / 2, b.y + b.height / 2]
}

// 通用：移到元素上 → 悬停 → 点击 → 停留
async function clickSelector(sel, { glideFrames = 40, hover = 6, settle = 0, after = 14 } = {}) {
  const p = await center(sel)
  await glide(p, glideFrames)
  await hold(p, hover)
  await clickAt(p, settle)
  await hold([p[0] + 3, p[1] + 1], after)
  return p
}

// ===== 编排：改成你要点的东西 =====
const beats = async () => {
  // 开场 1 秒：指针在画外，只让场景动
  for (let i = 0; i < FPS; i++) await frame(CFG.park[0], CFG.park[1], true, -1)

  // 例：点一个按钮，等 700ms 让它渲染完
  await clickSelector('button:has-text("Primary Action")', { settle: 700 })

  // 例：切状态（会重新拉数据）——先把缓存焐热、坐标现测
  // await page.evaluate(() => fetch('/data/other.json').then((r) => r.text()))
  // await clickSelector('button:text-is("B")', { settle: 800 })

  // 例：点列表/图例里的某一项（索引从 0 开始，坐标每次现测）
  // await clickSelector('.legend .legendtoggle >> nth=2')

  // 收尾：指针移开，停 2–3 秒再切黑
  await glide([W * 0.78, H * 0.6], 34)
  await hold([W * 0.78, H * 0.6], 84)
}

await beats()
await browser.close()
console.log(`frames: ${idx}  (${(idx / FPS).toFixed(2)}s)  → ${CFG.outDir}`)
