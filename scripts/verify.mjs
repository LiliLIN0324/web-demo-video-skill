// 出片后的机器验收：色彩标签 / 颜色有没有漂 / 帧数对不对 / 响度 / 关键帧拼图
// 用法：node verify.mjs <framesDir> <video.mp4> [--events events.json] [--size 1920x1080]
//                    [--ffmpeg <路径>] [--samples 8] [--out verify-sheet.png] [--no-fade]
//
// 这一步以前全靠手敲四条命令（ffprobe 看标签、抽帧拼图、和源 PNG 比亮度、loudnorm 看响度），
// 现在一条命令出结论表；任何一项 FAIL 就返回非 0，可以直接接在发布前当门禁。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { findFfmpeg, findFfprobe, runCmd } from './ffmpeg.mjs'

const argv = process.argv.slice(2)
const flags = {}
const pos = []
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a.startsWith('--')) {
    if (a === '--no-fade') { flags[a.slice(2)] = true; continue }
    flags[a.slice(2)] = argv[++i]
  } else pos.push(a)
}
const [dirArg, vidArg] = pos
if (!dirArg || !vidArg) {
  console.error('用法: node verify.mjs <framesDir> <video.mp4> [--events events.json] [--samples 8]')
  process.exit(1)
}
const dir = path.resolve(dirArg)
const vid = path.resolve(vidArg)
for (const [what, p] of [['帧目录', dir], ['成片', vid]]) {
  if (!fs.existsSync(p)) { console.error(`${what}不存在: ${p}`); process.exit(1) }
}

const { path: ffmpeg } = findFfmpeg({ cliArg: flags.ffmpeg })
const ffprobe = findFfprobe(ffmpeg)

const frames = fs.readdirSync(dir).filter((f) => /^\d+\.png$/i.test(f)).sort()
if (!frames.length) { console.error(`帧目录里没有数字帧: ${dir}`); process.exit(1) }
const pad = frames[0].replace(/\.png$/i, '').length

function probeStream() {
  // 不能加 -select_streams v:0：那会把音频流从输出里整个去掉，「有没有音轨」就永远看不出来
  const r = runCmd(ffprobe, [
    '-v', 'error',
    '-show_entries', 'stream=codec_type,codec_name,width,height,pix_fmt,color_range,color_space,color_primaries,color_transfer,nb_frames,avg_frame_rate',
    '-show_entries', 'format=duration,size',
    '-of', 'json', vid,
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  if (r.status !== 0) { console.error('ffprobe 失败:', r.stderr?.toString().slice(0, 300)); process.exit(1) }
  return JSON.parse(r.stdout.toString())
}

function out1(args) {
  const r = runCmd(ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  return { text: (r.stderr?.toString() || '') + (r.stdout?.toString() || ''), status: r.status }
}

const info = probeStream()
const v = info.streams.find((s) => s.codec_type === 'video')
if (!v) { console.error(`探不到视频流，这个文件不像视频：${vid}`); process.exit(1) }
const hasAudio = info.streams.some((s) => s.codec_type === 'audio')
const fpsNum = (() => { const [a, b] = (v.avg_frame_rate || '0/1').split('/').map(Number); return b ? a / b : 0 })()
const frameCount = Number(v.nb_frames || 0)
const duration = Number(info.format?.duration || 0)
const size = Number(info.format?.size || 0)

const results = []
// pass: true / false / 'skip'（这一项本次不适用，不算失败也不算通过）
const add = (name, expect, got, pass) => results.push({ name, expect, got, pass })

// 期望尺寸按帧的真实比例推：横屏 16:9 → 1920x1080，竖屏 9:16 → 1080x1920，
// 其余比例或需要覆盖时用 --size 1234x567 明确告诉它。
function pngSize(file) {
  const b = fs.readFileSync(file)
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) return null
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
}
const srcSize = pngSize(path.join(dir, frames[0])) || { w: 1920, h: 1080 }
let expW = 1920, expH = 1080
if (srcSize.h > srcSize.w) [expW, expH] = [1080, 1920]
if (flags.size) {
  const m = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(flags.size)
  if (!m) { console.error(`--size 要写成 1920x1080，收到: ${flags.size}`); process.exit(1) }
  expW = Number(m[1]); expH = Number(m[2])
}
add('分辨率', `${expW}x${expH}`, `${v.width}x${v.height}`, v.width === expW && v.height === expH)
add('像素格式/色彩', 'yuv420p(tv, bt709)', `${v.pix_fmt}, range=${v.color_range}, space=${v.color_space}, trc=${v.color_transfer}, primaries=${v.color_primaries}`,
  v.pix_fmt === 'yuv420p' && /tv/i.test(v.color_range || '') && v.color_space === 'bt709' && v.color_transfer === 'bt709' && v.color_primaries === 'bt709')
add('帧数一致', `${frames.length} 帧`, `${frameCount} 帧`, frameCount === frames.length || Math.abs(frameCount - frames.length) <= 1)
add('时长', `${(frames.length / (fpsNum || 30)).toFixed(2)}s`, `${duration.toFixed(2)}s`, Math.abs(duration - frames.length / (fpsNum || 30)) < 0.35)
// faststart 真的去文件头找 box：moov 出现在 mdat 之前才算。没找到 moov 但找到 mdat，
// 说明 moov 在整段视频数据后面（播放器要先下完才起播），判 FAIL。
const head = (() => {
  const fd = fs.openSync(vid, 'r')
  const n = Math.min(8 * 1048576, fs.fstatSync(fd).size)
  const b = Buffer.alloc(n)
  fs.readSync(fd, b, 0, n, 0)
  fs.closeSync(fd)
  return b
})()
const moovAt = head.indexOf('moov')
const mdatAt = head.indexOf('mdat')
add('faststart', 'moov 排在 mdat 前',
  moovAt >= 0 && mdatAt >= 0 ? `moov@${moovAt} mdat@${mdatAt}` : moovAt >= 0 ? `moov@${moovAt}（mdat 在后头）` : mdatAt >= 0 ? `moov 不在前 8MB，mdat@${mdatAt}` : '没找到 box',
  moovAt >= 0 && (mdatAt < 0 || moovAt < mdatAt))
add('码率体量', '< 12 Mbps', `${((size * 8) / Math.max(duration, 0.01) / 1e6).toFixed(1)} Mbps`, (size * 8) / Math.max(duration, 0.01) < 12e6)

// ---- 颜色有没有漂：抽第 N 帧与源 PNG 同尺寸比 PSNR ----
// 取样必须避开首尾 fade：encode 默认淡入 0.4s、淡出 0.7s，落进渐变区的帧本来就比源图暗，
// 比 PSNR 只会得到一个假的 FAIL（实测 7 dB）。
const FADE_IN_S = Number(flags['fade-in'] ?? 0.4)
const FADE_OUT_S = Number(flags['fade-out'] ?? 0.7)
// encode.mjs 在总长 < 淡入+淡出 时会自己关掉 fade，verify 跟着放开窗口——
// 否则 1 秒的短片只剩 1 帧可比（实测：30 帧只取到第 12 帧）。
const noFade = flags['no-fade'] || duration < FADE_IN_S + FADE_OUT_S
const fi = noFade ? 0 : FADE_IN_S
const fo = noFade ? 0 : FADE_OUT_S
const lo = Math.min(frames.length - 1, Math.ceil(fi * fpsNum))
const hi = Math.max(lo, frames.length - 1 - Math.ceil(fo * fpsNum))

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wdv-verify-'))
function sampleIndexes() {
  const idxs = new Set()
  const evPath = flags.events ? path.resolve(flags.events) : (fs.existsSync('events.json') ? path.resolve('events.json') : null)
  if (evPath) {
    try {
      const evs = JSON.parse(fs.readFileSync(evPath, 'utf8').replace(/^/, ''))
      for (const e of evs) if (e.type === 'click' || e.type === 'beat') idxs.add(Number(e.frame))
    } catch (err) { console.error(`events.json 读不动，跳过点击取样: ${err.message}`) }
  }
  const want = Number(flags.samples || 8)
  for (let i = 0; i <= want + 2; i++) idxs.add(Math.round(lo + ((hi - lo) * i) / (want + 2)))
  const usable = [...idxs].filter((n) => Number.isFinite(n) && n >= lo && n <= hi).sort((a, b) => a - b)
  return usable.slice(0, 12)
}

// 主判据是「和源图逐像素平均差」，不是 PSNR：实测同样一条正确编码，testsrc2 这种满屏噪点
// 的 PSNR 天花板只有 29 dB（拿错 5 帧才掉到 22），而平均色差稳在 Y≈1.1 / UV≈1.4。
// 色差才是「成片别比网页亮/艳」这件事本身，PSNR 只留着当"帧有没有抽错、压得太狠"的哨兵。
const DIFF_FILTER = '[0:v]format=rgb24[a];[1:v]format=rgb24[b];[a][b]blend=all_mode=difference[s];[s]signalstats,metadata=print'
let worstY = 0, worstUV = 0, worstPsnr = Infinity, compared = 0, lastExtractErr = ''
const picked = sampleIndexes()
for (const n of picked) {
  const srcPng = path.join(dir, `${String(n).padStart(pad, '0')}.png`)
  if (!fs.existsSync(srcPng)) { lastExtractErr = `源帧缺失 ${path.basename(srcPng)}`; continue }
  const vFrame = path.join(tmp, `v${n}.png`)
  const sFrame = path.join(tmp, `s${n}.png`)
  // 不带 -vsync/-fps_mode：ffmpeg 8 删了前者、旧版没后者，这里只要 select 出来的第一帧
  const ex = out1(['-y', '-v', 'error', '-i', vid, '-vf', `select=eq(n\\,${n})`, '-frames:v', '1', vFrame])
  out1(['-y', '-v', 'error', '-i', srcPng, '-vf', `scale=${v.width}:${v.height}:flags=lanczos`, '-frames:v', '1', sFrame])
  if (!fs.existsSync(vFrame) || !fs.existsSync(sFrame)) {
    lastExtractErr = `第 ${n} 帧抽不出：${(ex.text || '').trim().split('\n').filter(Boolean).slice(-1)[0] || 'ffmpeg 没报错也没出文件'}`
    continue
  }
  const { text: dtext } = out1(['-v', 'info', '-i', vFrame, '-i', sFrame, '-filter_complex', DIFF_FILTER, '-f', 'null', '-'])
  const stat = (key) => {
    const m = [...dtext.matchAll(new RegExp(key + '=([0-9.]+)', 'g'))]
    return m.length ? Number(m[m.length - 1][1]) : null
  }
  const y = stat('YAVG'), u = stat('UAVG'), vv = stat('VAVG')
  if (y === null) { lastExtractErr = `第 ${n} 帧比不出：${dtext.trim().split('\n').filter(Boolean).slice(-1)[0] || ''}`; continue }
  compared++
  worstY = Math.max(worstY, y)
  worstUV = Math.max(worstUV, u ?? 0, vv ?? 0)
  const { text } = out1(['-v', 'info', '-i', vFrame, '-i', sFrame, '-filter_complex', '[0:v][1:v]psnr', '-f', 'null', '-'])
  const m = /average:\s*([0-9.inf]+)/.exec(text)
  if (m) worstPsnr = Math.min(worstPsnr, m[1] === 'inf' ? 999 : Number(m[1]))
}
const none = (fallback) => compared ? fallback : `一帧都没比上 —— ${lastExtractErr || '取样帧号越界'}`
add('颜色不漂（与源图平均差）', 'Y ≤ 2 / UV ≤ 2.5（/255）',
  compared ? `Y ${worstY.toFixed(2)}  UV ${worstUV.toFixed(2)}（比了 ${compared} 帧）` : none('没数据'),
  compared > 0 && worstY <= 2 && worstUV <= 2.5)
add('帧对齐与细节（最差帧 PSNR）', '≥ 22 dB',
  compared ? (Number.isFinite(worstPsnr) ? `${worstPsnr.toFixed(1)} dB` : 'psnr 没输出') : none('没数据'),
  compared > 0 && worstPsnr >= 22)

// ---- 响度 ----
if (hasAudio) {
  const { text } = out1(['-v', 'info', '-i', vid, '-af', 'loudnorm=print_format=json', '-f', 'null', '-'])
  const m = /\{[^{}]*"input_i"[^{}]*\}/s.exec(text)
  if (m) {
    const j = JSON.parse(m[0])
    add('响度', '-19 ~ -14 LUFS', `${j.input_i} LUFS (TP ${j.input_tp}, LRA ${j.input_lra})`, Number(j.input_i) >= -19 && Number(j.input_i) <= -14 && Number(j.input_tp) <= -1.0)
  } else add('响度', '-19 ~ -14 LUFS', 'loudnorm 没输出 JSON', false)
} else {
  add('响度', '有音轨', '无声轨 —— 没配乐就跳过；要声音先跑 music.mjs 再用 encode --audio', 'skip')
}

// ---- 关键帧拼图 ----
// 拼图和 PSNR 取样分开：拼图要看首尾（fade、结尾停帧），PSNR 只能比中间不渐变的帧。
const sheetIdx = [...new Set([0, ...picked, frames.length - 1])].sort((a, b) => a - b)
let sheetPath = null
if (sheetIdx.length) {
  sheetIdx.forEach((n, i) => {
    const f = path.join(tmp, `p${String(i).padStart(2, '0')}.png`)
    out1(['-y', '-v', 'error', '-i', vid, '-vf', `select=eq(n\\,${n}),scale=480:-2`, '-frames:v', '1', f])
  })
  const cols = Math.min(4, sheetIdx.length)
  const rows = Math.ceil(sheetIdx.length / cols)
  sheetPath = path.resolve(flags.out || 'verify-sheet.png')
  // 上面按序号存成 p00.png…pNN.png，正好能用 image2 序列喂给 tile
  out1(['-y', '-v', 'error', '-framerate', '1', '-i', path.join(tmp, 'p%02d.png'), '-vf', `tile=${cols}x${rows}`, '-frames:v', '1', sheetPath])
  if (!fs.existsSync(sheetPath)) { console.error('拼图没生成（成片帧数太少或 ffmpeg 不支持 tile），其余检查仍然有效'); sheetPath = null }
}

// ---- 报告 ----
const W = (s, n) => String(s).padEnd(n)
console.log('\n验收表  ' + path.basename(vid))
console.log(W('项目', 26) + W('期望', 22) + W('实测', 44) + '结论')
console.log('-'.repeat(100))
for (const r of results) console.log(W(r.name, 26) + W(r.expect, 22) + W(r.got, 44) + (r.pass === 'skip' ? '跳过' : r.pass ? 'PASS' : 'FAIL'))
console.log('-'.repeat(100))
console.log(`色差取样帧号: ${picked.join(', ')}  ${noFade ? '（这条片没有淡入淡出，全片可比）' : '（避开首尾 fade，可用 --fade-in / --fade-out / --no-fade 调）'}`)
console.log(`拼图帧号: ${sheetIdx.join(', ')}`)
if (sheetPath) console.log(`关键帧拼图: ${sheetPath}`)
fs.rmSync(tmp, { recursive: true, force: true })

const fails = results.filter((r) => r.pass === false)
if (fails.length) {
  console.error(`\n${fails.length} 项没通过: ${fails.map((f) => f.name).join('、')}`)
  process.exit(1)
}
console.log('\n全部通过。中间产物 frames/ 可以删了。')
