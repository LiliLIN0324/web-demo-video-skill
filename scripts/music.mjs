// 合成配乐：纯 node 生成 PCM → WAV，不依赖任何音频库
// 读取录制器写出的 events.json，把点击帧对齐成 tick 确认音；
// 时长自动取「帧数 / fps」。默认 126 BPM A 小调：kick + bass + hats + snare + 琶音 + pad。
// 用法: node music.mjs <framesDir> <events.json> <out.wav> [fps] [bpm]
// 之后混流: ffmpeg -i video.mp4 -i score.wav -map 0:v -map 1:a -c:v copy \
//           -af loudnorm=I=-15:TP=-1.5:LRA=11 -c:a aac -b:a 160k -shortest -movflags +faststart out.mp4
import fs from 'node:fs'
import path from 'node:path'

const [dirArg, evArg, outArg, fpsArg, bpmArg] = process.argv.slice(2)
if (!dirArg || !evArg || !outArg) {
  console.error('用法: node music.mjs <framesDir> <events.json> <out.wav> [fps] [bpm]')
  process.exit(1)
}
const fps = Number(fpsArg || 30)
const BPM = Number(bpmArg || 126)
const frames = fs.readdirSync(dirArg).filter((f) => /^\d+\.png$/i.test(f)).length
if (!frames) { console.error(`帧目录为空: ${dirArg}`); process.exit(1) }
const events = fs.existsSync(evArg) ? JSON.parse(fs.readFileSync(evArg, 'utf8')) : []
const dur = frames / fps
const SR = 44100
const N = Math.ceil(dur * SR)
console.log(`${frames} 帧 = ${dur.toFixed(2)}s，${events.filter((e) => e.type === 'click').length} 次点击，${BPM} BPM`)

const beat = 60 / BPM
const bar = beat * 4

const L = new Float32Array(N)
const R = new Float32Array(N)
const add = (t0, fn, len) => {
  const s0 = Math.max(0, Math.floor(t0 * SR))
  const s1 = Math.min(N, s0 + Math.ceil(len * SR))
  for (let i = s0; i < s1; i++) {
    const t = (i - s0) / SR
    const [l, r] = fn(t, i)
    L[i] += l
    R[i] += r
  }
}
const noise = () => Math.random() * 2 - 1

// —— 乐器（全部是简单加法合成，可按口味调参） ——
// kick: 150→44Hz 扫频正弦
const kick = (t0) => add(t0, (t) => {
  const f = 44 + 106 * Math.exp(-t * 28)
  const a = Math.exp(-t * 9) * (t < 0.002 ? t / 0.002 : 1)
  const v = Math.sin(2 * Math.PI * f * t) * a * 0.9
  return [v, v]
}, 0.32)
// bass: 方波感（前 4 次谐波衰减叠加）
const bass = (t0, freq, len) => add(t0, (t) => {
  const a = Math.min(1, t / 0.01) * Math.exp(-t * 2.2)
  let v = 0
  for (let h = 1; h <= 4; h++) v += Math.sin(2 * Math.PI * freq * h * t) / (h * 1.8)
  return [v * a * 0.34, v * a * 0.34]
}, len)
// hat: 高通噪声
const hat = (t0, open = false) => add(t0, (t) => {
  const a = Math.exp(-t * (open ? 22 : 90))
  const v = noise() * a * 0.1
  return [v * 0.8, v]
}, open ? 0.18 : 0.05)
// snare: 带通噪声 + 195Hz 体
const snare = (t0) => add(t0, (t) => {
  const a = Math.exp(-t * 16)
  const v = (noise() * 0.6 + Math.sin(2 * Math.PI * 195 * t) * 0.5) * a * 0.32
  return [v, v * 0.9]
}, 0.22)
// pluck: 琶音拨弦
const pluck = (t0, freq, pan = 0) => add(t0, (t) => {
  const a = Math.exp(-t * 7) * Math.min(1, t / 0.004)
  const v = (Math.sin(2 * Math.PI * freq * t) + Math.sin(2 * Math.PI * freq * 2 * t) * 0.35 + Math.sin(2 * Math.PI * freq * 3 * t) * 0.12) * a * 0.12
  return [v * (1 - pan * 0.5), v * (1 + pan * 0.5)]
}, 0.3)
// pad: 长音和声垫底（微失谐双振荡）
const pad = (t0, freqs, len) => add(t0, (t) => {
  const a = Math.min(1, t / 0.5) * Math.min(1, (len - t) / 0.6)
  let v = 0
  for (const f of freqs) v += Math.sin(2 * Math.PI * f * t) * 0.05 + Math.sin(2 * Math.PI * f * 1.005 * t) * 0.04
  return [v * a, v * a * 0.95]
}, len)
// tick: 点击帧对齐的确认音
const tick = (t0) => add(t0, (t) => {
  const a = Math.exp(-t * 60)
  const v = Math.sin(2 * Math.PI * 2400 * t) * a * 0.16
  return [v, v]
}, 0.06)

// —— 编曲：A 小调 Am F C G 循环 ——
const roots = [110, 87.31, 130.81, 98]       // A2 F2 C3 G2
const chords = [
  [440, 523.25, 659.25],   // Am
  [349.23, 440, 523.25],   // F
  [523.25, 659.25, 784],   // C
  [392, 493.88, 587.33],   // G
]
const tEnd = dur
// pad 铺满全场
for (let t = 0; t < tEnd; t += bar) pad(t, chords[Math.floor(t / bar) % 4], bar)
// 鼓组从第 2 小节进（开场留一拍呼吸）
const drumsFrom = bar
for (let t = drumsFrom; t < tEnd - 0.1; t += beat) kick(t)
for (let b = Math.ceil(drumsFrom / bar); b * bar < tEnd - 0.1; b++) {
  snare(b * bar + beat)
  snare(b * bar + beat * 3)
}
// bass 八分音符走根音
for (let t = drumsFrom; t < tEnd - 0.1; t += beat / 2) bass(t, roots[Math.floor(t / bar) % 4], beat / 2)
// hats：反拍 + 每小节末尾一个开镲
for (let t = drumsFrom; t < tEnd - 0.1; t += beat / 2) hat(t + beat / 4, false)
for (let b = Math.ceil(drumsFrom / bar); b * bar < tEnd - 0.1; b++) hat(b * bar + beat * 3.5, true)
// arp：16 分音符，左右交替
const seq = [0, 1, 2, 1, 0, 2, 1, 2, 0, 1, 2, 1, 0, 2, 1, 2]
for (let t = 0; t < tEnd - 0.1; t += beat / 4) {
  const barIdx = Math.floor(t / bar) % 4
  const step = Math.round((t % bar) / (beat / 4)) % 16
  pluck(t, chords[barIdx][seq[step]] * 2, (step % 2) * 0.6 - 0.3)
}
// 点击 tick 对齐（frame / fps 秒）
for (const e of events) {
  if (e.type !== 'click') continue
  const t = e.frame / fps
  if (t < tEnd) tick(t)
}
// 尾 1.2s 淡出，头 0.15s 淡入
const fadeN = Math.min(N, Math.floor(1.2 * SR))
for (let i = 0; i < fadeN; i++) {
  const g = 1 - i / fadeN
  L[N - 1 - i] *= g
  R[N - 1 - i] *= g
}
const inN = Math.floor(0.15 * SR)
for (let i = 0; i < inN; i++) {
  const g = i / inN
  L[i] *= g
  R[i] *= g
}
// 软限幅
for (let i = 0; i < N; i++) {
  L[i] = Math.tanh(L[i] * 1.4) * 0.85
  R[i] = Math.tanh(R[i] * 1.4) * 0.85
}

// 写 16-bit PCM 立体声 WAV
const buf = Buffer.alloc(44 + N * 4)
buf.write('RIFF', 0)
buf.writeUInt32LE(36 + N * 4, 4)
buf.write('WAVE', 8)
buf.write('fmt ', 12)
buf.writeUInt32LE(16, 16)
buf.writeUInt16LE(1, 20)
buf.writeUInt16LE(2, 22)
buf.writeUInt32LE(SR, 24)
buf.writeUInt32LE(SR * 4, 28)
buf.writeUInt16LE(4, 32)
buf.writeUInt16LE(16, 34)
buf.write('data', 36)
buf.writeUInt32LE(N * 4, 40)
for (let i = 0; i < N; i++) {
  buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(L[i] * 32767))), 44 + i * 4)
  buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(R[i] * 32767))), 44 + i * 4 + 2)
}
fs.writeFileSync(path.resolve(outArg), buf)
console.log('done:', path.resolve(outArg), `${(buf.length / 1048576).toFixed(1)}MB`)
