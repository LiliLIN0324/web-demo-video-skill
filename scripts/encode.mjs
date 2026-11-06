// 帧序列 → mp4（1080p / 30fps / bt709 tv）
// 用法：node encode.mjs <framesDir> <out.mp4> [fps] [--size 1920x1080] [--audio score.wav] [--ffmpeg <路径>]
//                    [--crf 18] [--preset slow] [--lufs -15] [--no-fade]
//
// 三件事替你做了，别退回手写命令：
//  1) 帧比目标尺寸大（模板默认 dsf=2 出 4K 帧）时自动 lanczos 降回 1920×1080；
//  2) 显式 full→tv + bt709，并把 bt709 写进 H.264 码流的 VUI（光给 -color_* 标签，
//     容器层有了、码流里 primaries/transfer 还是 unknown，播放器会按默认解释偏色）；
//  3) --audio 一次合成里直接混配乐，省掉那条手写的 loudnorm + bitstream 长命令。
import fs from 'node:fs'
import path from 'node:path'
import { findFfmpeg, runCmd } from './ffmpeg.mjs'

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

const [dirArg, outArg, fpsArg] = pos
if (!dirArg || !outArg) {
  console.error('用法: node encode.mjs <framesDir> <out.mp4> [fps] [--size 1920x1080] [--audio score.wav]')
  process.exit(1)
}

const dir = path.resolve(dirArg)
const out = path.resolve(outArg)
const fps = Number(fpsArg || flags.fps || 30)
if (!Number.isFinite(fps) || fps <= 0) {
  console.error(`fps 不是一个正数: ${fpsArg}`)
  process.exit(1)
}
if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
  console.error(`帧目录不存在或不是目录: ${dir}`)
  process.exit(1)
}

const frames = fs.readdirSync(dir).filter((f) => /^\d+\.png$/i.test(f)).sort()
if (!frames.length) {
  console.error(`帧目录里没有 0000.png 这类文件: ${dir}`)
  process.exit(1)
}

// 帧号位数按第一帧推断，并检查是否连续——缺号时 ffmpeg 会静默截短，成片莫名变短就是这么来的
const pad = frames[0].replace(/\.png$/i, '').length
const nums = frames.map((f) => Number(f.replace(/\.png$/i, '')))
if (nums[0] !== 0) console.error(`警告: 首帧不是 0000（是 ${frames[0]}），成片会从第 ${nums[0]} 帧开始缺画面`)
const gaps = []
for (let i = 1; i < nums.length; i++) {
  if (nums[i] !== nums[i - 1] + 1) gaps.push(`${String(nums[i - 1] + 1).padStart(pad, '0')}…${String(nums[i] - 1).padStart(pad, '0')}`)
}
if (gaps.length) {
  console.error(`警告: 帧不连续，缺 ${gaps.join(', ')} —— ffmpeg 会在缺口处停下，成片比预期短`)
  console.error('确认录制是否中途断过；需要整段保留时把缺失帧补成重复帧（-loop 1）或重录。')
}

// 读 PNG 头拿真实像素尺寸（IHDR 的 width/height），不额外起进程
function pngSize(file) {
  const b = fs.readFileSync(file)
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) return null
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
}
const src = pngSize(path.join(dir, frames[0])) || { w: 1920, h: 1080 }

let [tw, th] = [1920, 1080]
if (flags.size) {
  if (flags.size.toLowerCase() === 'keep') { tw = src.w; th = src.h }
  else {
    const m = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(flags.size)
    if (!m) { console.error(`--size 要写成 1920x1080 或 keep，收到: ${flags.size}`); process.exit(1) }
    tw = Number(m[1]); th = Number(m[2])
  }
} else if (src.w > 1920 || src.h > 1080) {
  // 4K 帧缩回 1080p；比例不一致就按高度等比，避免拉扁
  tw = Math.round(1080 * (src.w / src.h))
  th = 1080
  if (src.w / src.h === 16 / 9) { tw = 1920 }
}
if (tw % 2 || th % 2) { tw -= (tw % 2); th -= (th % 2) }

const duration = frames.length / fps
const FADE_IN = 0.4
const FADE_OUT = 0.7
const noFade = !!flags['no-fade'] || duration < FADE_IN + FADE_OUT + 0.2
if (duration < FADE_IN + FADE_OUT + 0.2 && !flags['no-fade']) {
  console.log(`提示: 全片只有 ${duration.toFixed(2)}s，短于淡入淡出总长，自动关掉 fade`)
}
const fadeOutStart = Math.max(0, duration - FADE_OUT)

const chain = []
if (!noFade) {
  chain.push(`fade=t=in:st=0:d=${FADE_IN}`, `fade=t=out:st=${fadeOutStart.toFixed(3)}:d=${FADE_OUT}`)
}
if (src.w !== tw || src.h !== th) chain.push(`scale=${tw}:${th}:flags=lanczos`)
// 显式 full→tv + bt709，否则 H.264 比网页原图更亮更艳
chain.push('scale=in_range=full:out_range=tv:in_color_matrix=bt709:out_color_matrix=bt709', 'format=yuv420p')
const vf = chain.join(',')

const { path: ffmpeg } = findFfmpeg({ cliArg: flags.ffmpeg })

const audio = flags.audio ? path.resolve(flags.audio) : null
if (audio && !fs.existsSync(audio)) {
  console.error(`音轨不存在: ${audio}`)
  process.exit(1)
}

// 配乐要两趟 loudnorm。单趟是动态归一化，短片段（整片 10–40s）根本走不到目标：
// 实测 3s 片子目标 -15 LUFS，单趟出来 -12.5。先量再按量好的值线性施加。
const LN = { I: flags.lufs ?? -15, TP: -1.5, LRA: 11 }
function measureLoudnorm(file) {
  const r = runCmd(ffmpeg, ['-v', 'info', '-i', file, '-af', `loudnorm=I=${LN.I}:TP=${LN.TP}:LRA=${LN.LRA}:print_format=json`, '-f', 'null', '-'],
    { stdio: ['ignore', 'pipe', 'pipe'] })
  const text = (r.stderr?.toString() || '') + (r.stdout?.toString() || '')
  const m = /\{[^{}]*"input_i"[^{}]*\}/s.exec(text)
  if (!m) return null
  try { return JSON.parse(m[0]) } catch { return null }
}

let af = null
if (audio) {
  const m = measureLoudnorm(audio)
  if (m) {
    af = `loudnorm=I=${LN.I}:TP=${LN.TP}:LRA=${LN.LRA}`
      + `:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}`
      + `:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true:print_format=summary`
    console.log(`响度：量得 ${m.input_i} LUFS / TP ${m.input_tp} → 线性归一到 I=${LN.I}`)
  } else {
    af = `loudnorm=I=${LN.I}:TP=${LN.TP}:LRA=${LN.LRA}`
    console.error('警告: 响度预量失败，退回单趟动态 loudnorm —— 短片段可能比目标响 2–3 LUFS，出片后用 verify.mjs 复查')
  }
}

console.log(`${frames.length} 帧（源 ${src.w}×${src.h}）@ ${fps}fps = ${duration.toFixed(2)}s → ${tw}×${th}`)
if (audio) console.log(`音轨: ${audio}`)

// -color_* 只写进容器；H.264 码流的 VUI 里 primaries/transfer 仍是 unknown，播放器按默认解释会偏色
// （本机 A/B/C 实测：只给 -color_* → unknown；再加 -x264-params → bt709）。两者要一起给。
const args = ['-y', '-framerate', String(fps), '-start_number', '0', '-i', path.join(dir, `%0${pad}d.png`)]
if (audio) args.push('-i', audio)
args.push(
  '-vf', vf,
  '-c:v', 'libx264',
  '-crf', String(flags.crf || 18),
  '-preset', String(flags.preset || 'slow'),
  '-r', String(fps),
  '-color_primaries', 'bt709',
  '-color_trc', 'bt709',
  '-colorspace', 'bt709',
  '-color_range', 'tv',
  '-x264-params', 'colorprim=bt709:transfer=bt709:colormatrix=bt709',
)
if (audio) args.push('-map', '0:v:0', '-map', '1:a:0', '-c:a', 'aac', '-b:a', '160k', '-af', af, '-shortest')
args.push('-movflags', '+faststart', out)

const run = runCmd(ffmpeg, args, { stdio: 'inherit' })
if (run.status !== 0) process.exit(run.status || 1)

const size = fs.existsSync(out) ? fs.statSync(out).size : 0
console.log(`done: ${out}  ${(size / 1048576).toFixed(1)} MB`)
console.log(`下一步：node scripts/verify.mjs ${dirArg} ${outArg}`)
