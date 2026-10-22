// 帧序列 → mp4
// 用法：node encode.mjs <framesDir> <out.mp4> [fps]
// 自动定位 ffmpeg（PATH / FFMPEG 环境变量 / D:\dsh-tools\bin），加首尾淡入淡出
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const [dirArg, outArg, fpsArg] = process.argv.slice(2)
if (!dirArg || !outArg) {
  console.error('用法: node encode.mjs <framesDir> <out.mp4> [fps]')
  process.exit(1)
}

const dir = path.resolve(dirArg)
const out = path.resolve(outArg)
const fps = Number(fpsArg || 30)
const isWin = process.platform === 'win32'

if (!fs.existsSync(dir)) {
  console.error(`帧目录不存在: ${dir}`)
  process.exit(1)
}

const frames = fs.readdirSync(dir).filter((f) => /^\d+\.png$/i.test(f)).sort()
if (!frames.length) {
  console.error(`帧目录里没有 0000.png 这类文件: ${dir}`)
  process.exit(1)
}

const width = frames[0].replace(/\.png$/i, '').length
const pattern = `%0${width}d.png`

const duration = frames.length / fps
const FADE_IN = 0.4
const FADE_OUT = 0.7
const fadeOutStart = Math.max(0, duration - FADE_OUT)
const vf =
  `fade=t=in:st=0:d=${FADE_IN},` +
  `fade=t=out:st=${fadeOutStart.toFixed(3)}:d=${FADE_OUT},` +
  // 显式 full→tv + bt709，否则 H.264 出来比网页原图更亮更艳
  'scale=in_range=full:out_range=tv:in_color_matrix=bt709:out_color_matrix=bt709,' +
  'format=yuv420p'

const candidates = [
  process.env.FFMPEG,
  'ffmpeg',
  'D:/dsh-tools/bin/ffmpeg.exe',
  'D:/dsh-tools/bin/ffmpeg.cmd',
  path.join(process.env.USERPROFILE || '', '.dsh/tools/ffmpeg/ffmpeg.exe'),
].filter(Boolean)

// .cmd/.bat 需要 shell，.exe 直接起；shell 下拼成单条命令避免参数未转义
const quote = (s) => (/[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s)
const needsShell = (c) => isWin && /\.(cmd|bat)$/i.test(c)
const runCmd = (c, args, opts) =>
  needsShell(c)
    ? spawnSync([c, ...args].map(quote).join(' '), { shell: true, ...opts })
    : spawnSync(c, args, opts)

let ffmpeg = null
for (const cand of candidates) {
  const r = runCmd(cand, ['-version'], { stdio: 'ignore' })
  if (r.status === 0) {
    ffmpeg = cand
    break
  }
}

if (!ffmpeg) {
  console.error('找不到 ffmpeg。装好后重试，或设置 FFMPEG 环境变量指向可执行文件。')
  console.error('已尝试: ' + candidates.join(', '))
  process.exit(1)
}

console.log(`ffmpeg: ${ffmpeg}`)
console.log(`${frames.length} 帧 @ ${fps}fps = ${duration.toFixed(2)}s → ${out}`)

const args = [
  '-y',
  '-framerate', String(fps),
  '-start_number', '0',
  '-i', path.join(dir, pattern),
  '-vf', vf,
  '-c:v', 'libx264',
  '-crf', '18',
  '-preset', 'slow',
  '-r', String(fps),
  '-color_primaries', 'bt709',
  '-color_trc', 'bt709',
  '-colorspace', 'bt709',
  '-color_range', 'tv',
  '-movflags', '+faststart',
  out,
]

const run = runCmd(ffmpeg, args, { stdio: 'inherit' })

if (run.status !== 0) process.exit(run.status || 1)
console.log('done:', out)
