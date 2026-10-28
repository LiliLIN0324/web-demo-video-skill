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

  // 缩放运镜：对某个宿主元素逐帧设 transform: scale()。
  // iframe 内嵌应用填 'iframe'；普通页面可填 'main'/'#app' 等；null 禁用。
  // 注意：指针注入在顶层文档、不受影响；点击只允许在 scale=1 时做（见 clickAt）。
  zoomSelector: null,

  // 指针入场/离场停在画外
  park: [1980, 1160],

  // 无头模式：不弹窗、不抢用户焦点，避免录制中途被人关掉。
  // 需要肉眼盯着调试时改成 false。
  headless: true,
}

const W = CFG.width
const H = CFG.height
const FPS = CFG.fps
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

fs.rmSync(CFG.outDir, { recursive: true, force: true })
fs.mkdirSync(CFG.outDir, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome', headless: CFG.headless });
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
let cur = [...CFG.park]
const events = [] // 每次点击/运镜记帧号，后期配乐按 frame/fps 对齐

// 运镜基准：元素未缩放时的视口位置（transform-origin 要用相对元素自身的坐标）
let zoom = { s: 1, fx: W / 2, fy: H / 2 }
let zoomBase = null
if (CFG.zoomSelector) {
  zoomBase = await page.evaluate((sel) => {
    const r = document.querySelector(sel).getBoundingClientRect()
    return [r.x, r.y]
  }, CFG.zoomSelector)
}

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
  await page.evaluate(([cx, cy, rx, ry, a, zs, zfx, zfy, zsel, zbx, zby]) => {
    const c = document.getElementById('__cur')
    c.style.transform = `translate(${cx - 6.6}px, ${cy - 3.3}px)`
    const r = document.getElementById('__rip')
    if (a < 0) r.style.opacity = 0
    else {
      const p = Math.min(a / 17, 1)
      r.style.opacity = String((1 - p) * 0.9)
      r.style.transform = `translate(${rx - 22}px, ${ry - 22}px) scale(${0.4 + p * 1.1})`
    }
    // 运镜：transform-origin 相对元素自身，所以要减去元素未缩放时的位置
    if (zsel) {
      const z = document.querySelector(zsel)
      if (zs === 1) z.style.transform = 'none'
      else {
        z.style.transformOrigin = `${zfx - zbx}px ${zfy - zby}px`
        z.style.transform = `scale(${zs})`
      }
    }
  }, [x, y, ripple ? ripple.x : 0, ripple ? ripple.y : 0, age,
      zoom.s, zoom.fx, zoom.fy, CFG.zoomSelector,
      zoomBase ? zoomBase[0] : 0, zoomBase ? zoomBase[1] : 0])
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

// 缩放运镜：缓动插值 scale 与焦点，期间指针不动。
// 焦点是视口坐标；只有 scale=1 时元素坐标才等于视口坐标，点击前务必回到 1。
async function zoomTo(s, fx, fy, n) {
  if (!CFG.zoomSelector) return
  const from = { ...zoom }
  for (let i = 1; i <= n; i++) {
    const t = ease(i / n)
    zoom = {
      s: from.s + (s - from.s) * t,
      fx: from.fx + (fx - from.fx) * t,
      fy: from.fy + (fy - from.fy) * t,
    }
    await frame(cur[0], cur[1], true, ripAge())
  }
  zoom = { s, fx, fy } // 落回精确目标值，避免浮点漂移挡住 clickAt 的 s===1 检查
  events.push({ frame: idx, type: 'zoom', s })
}
// 短促推近再拉回，强调某区域（数据面板、配图、按钮）
async function zoomPunch(fx, fy, peak = 1.16, nIn = 20, holdN = 18, nOut = 18) {
  await zoomTo(peak, fx, fy, nIn)
  await hold(cur, holdN)
  await zoomTo(1, W / 2, H / 2, nOut)
}

// 真实点击的关键：按下 → 停 90ms → 松开，全程不移动指针、不截图。
// 中途挪指针或拍帧会让不少站点（<a>、筛选 chip、地图行）吞掉这次点击。
// settle 期间不拍帧：让页面重渲染完，避免白屏/跳帧。
async function clickAt(p, settle = 0) {
  // 缩放中元素视觉位置 ≠ 布局坐标，点击必飘；先 zoomTo(1, …) 再点
  if (zoom.s !== 1) throw new Error('scale≠1 时禁止点击')
  await mouse('mouseMoved', p[0], p[1])
  await mouse('mousePressed', p[0], p[1], { button: 'left', buttons: 1, clickCount: 1 })
  await sleep(90)
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: p[0], y: p[1], button: 'left', buttons: 0, clickCount: 1,
  })
  ripple = { x: p[0], y: p[1], frame: idx }
  events.push({ frame: idx, type: 'click', at: ripple })
  await frame(p[0], p[1], true, 0)
  if (settle) await sleep(settle)
}

// 页面路由切换会先渲染骨架屏/白屏。这期间不要拍帧，等内容就绪再继续 hold，
// 成片里就是一次干净的切镜，而不是 1 秒多的 loading。
async function waitFor(sel, ms = 12000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (await page.locator(sel).first().isVisible().catch(() => false)) return true
    await sleep(200)
  }
  return false
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

  // 例：点击后整页跳转（路由先渲染骨架屏）——点完不拍帧，等新页就绪再继续
  // await clickSelector('.card >> nth=0', { settle: 0, after: 0 })
  // await waitFor('.detail-title')
  // await hold(cur, 20)

  // 收尾：指针移开，停 2–3 秒再切黑
  await glide([W * 0.78, H * 0.6], 34)
  await hold([W * 0.78, H * 0.6], 84)
}

await beats()
fs.writeFileSync('events.json', JSON.stringify(events, null, 1))
await browser.close()
console.log(`frames: ${idx}  (${(idx / FPS).toFixed(2)}s)  → ${CFG.outDir}`)
