// 配乐：纯 node 加法合成 → WAV，不依赖任何音频库
// 用法: node music.mjs <framesDir> <events.json> <out.wav> [fps] [style]
//   style: light(轻松/明亮) | warm(温暖叙事) | pulse(科技推进) | minimal(极简留白)
//
// 不是「一段固定 loop」：每次按画面重新编曲。
//  - events.json 里的 beat 标记（open/card/panel/detail/venue/finder/calendar/outro…）
//    决定每段的能量：镜头推近面板处更满，读详情页处变薄；
//  - click 对齐点击声（木头或柔铃，随模板变）；
//  - cam（s>1.05）在推近前 0.5s 加一道很轻的上行气声，把镜头和音乐绑在一起；
//  - 每个模板有自己的 BPM、调式、和声走向与配器密度，整段按实际长度生成。
//
// 加模板：在 PRESETS 里加一条即可，字段见文件底部注释。
import fs from 'node:fs'
import path from 'node:path'

const [dirArg, evArg, outArg, fpsArg, styleArg] = process.argv.slice(2)
if (!dirArg || !evArg || !outArg) {
  console.error('用法: node music.mjs <framesDir> <events.json> <out.wav> [fps] [style]')
  process.exit(1)
}
const fps = Number(fpsArg || 30)
const styleName = styleArg || 'light'
const frames = fs.readdirSync(dirArg).filter((f) => /^\d+\.png$/i.test(f)).length
if (!frames) { console.error(`帧目录为空: ${dirArg}`); process.exit(1) }
const events = fs.existsSync(evArg)
  ? JSON.parse(fs.readFileSync(evArg, 'utf8').replace(/^\uFEFF/, ''))
  : []
const dur = frames / fps
const SR = 44100
const N = Math.ceil(dur * SR)

// ---------- 和弦素材（以 C 大调为基准，按模板移调） ----------
const CH = {
  C: [261.63, 329.63, 392.0],
  Am: [220.0, 261.63, 329.63],
  F: [174.61, 220.0, 261.63],
  G: [196.0, 246.94, 293.66],
  Dm: [293.66, 349.23, 440.0],
  Em: [329.63, 392.0, 493.88],
  Bb: [233.08, 293.66, 349.23],
}

// ---------- 模板 ----------
const PRESETS = {
  // 轻松明亮：沙锤 + 马林巴 + 轻贝斯，底鼓很轻 —— 文创/日程/生活方式类
  light: {
    bpm: 104,
    transpose: 0,
    prog: ['C', 'Am', 'F', 'G'],
    pad: { level: 0.5, attack: 0.9, octave: 2 },
    shaker: { level: 0.5 },
    kick: { level: 0.42, pattern: [0, 10] },
    brush: { level: 0.22 },
    bass: { level: 0.3, pattern: [0, 6, 8] },
    arp: { level: 0.42, voice: 'marimba', steps: [0, 2, 4, 6, 8, 10, 12, 14], octave: 2 },
    bell: { level: 0.16 },
    tick: 'wood',
    energy: { open: 0.18, card: 0.46, panel: 0.66, detail: 0.3, venue: 0.52, finder: 0.58, calendar: 0.42, outro: 0.2 },
  },
  // 温暖叙事：慢钢琴 + 弦垫 + 轻刷子
  warm: {
    bpm: 88,
    transpose: -2,
    prog: ['F', 'C', 'Dm', 'Bb'],
    pad: { level: 0.62, attack: 1.4, octave: 2 },
    shaker: { level: 0.22 },
    kick: { level: 0.3, pattern: [0, 8] },
    brush: { level: 0.16 },
    bass: { level: 0.26, pattern: [0, 8] },
    arp: { level: 0.34, voice: 'piano', steps: [0, 3, 6, 8, 11, 14], octave: 2 },
    bell: { level: 0.2 },
    tick: 'soft',
    energy: { open: 0.15, card: 0.4, panel: 0.55, detail: 0.28, venue: 0.45, finder: 0.5, calendar: 0.38, outro: 0.18 },
  },
  // 科技推进：四拍底鼓 + 拨弦琶音 —— 工具/AI/效率类
  pulse: {
    bpm: 124,
    transpose: -3,
    prog: ['Am', 'F', 'C', 'G'],
    pad: { level: 0.4, attack: 0.35, octave: 2 },
    shaker: { level: 0.45 },
    kick: { level: 0.55, pattern: [0, 4, 8, 12] },
    brush: { level: 0.26 },
    bass: { level: 0.34, pattern: [0, 4, 8, 12] },
    arp: { level: 0.4, voice: 'pluck', steps: [0, 2, 4, 6, 8, 10, 12, 14], octave: 2 },
    bell: { level: 0.14 },
    tick: 'wood',
    energy: { open: 0.25, card: 0.55, panel: 0.75, detail: 0.4, venue: 0.6, finder: 0.68, calendar: 0.5, outro: 0.25 },
  },
  // 极简留白：只有气声垫 + 稀疏铃音
  minimal: {
    bpm: 76,
    transpose: 0,
    prog: ['C', 'G', 'Am', 'F'],
    pad: { level: 0.66, attack: 2.2, octave: 2 },
    shaker: { level: 0.12 },
    kick: { level: 0, pattern: [] },
    brush: { level: 0 },
    bass: { level: 0.18, pattern: [0] },
    arp: { level: 0.24, voice: 'bell', steps: [0, 7, 10], octave: 3 },
    bell: { level: 0.22 },
    tick: 'soft',
    energy: { open: 0.12, card: 0.32, panel: 0.45, detail: 0.22, venue: 0.34, finder: 0.4, calendar: 0.3, outro: 0.14 },
  },
}
const P = PRESETS[styleName] || PRESETS.light
console.log(`style=${styleName}  ${P.bpm} BPM  ${frames} 帧 = ${dur.toFixed(2)}s  ${events.filter((e) => e.type === 'click').length} 次点击`)

// ---------- 确定性随机（同输入 → 同结果，便于复现） ----------
let seed = 20261029
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296
  return seed / 4294967296
}
const noise = () => rnd() * 2 - 1

// ---------- 合成器 ----------
const L = new Float32Array(N)
const R = new Float32Array(N)
const add = (t0, len, fn) => {
  const s0 = Math.max(0, Math.floor(t0 * SR))
  const s1 = Math.min(N, s0 + Math.ceil(len * SR))
  for (let i = s0; i < s1; i++) {
    const t = (i - s0) / SR
    const [l, r] = fn(t)
    L[i] += l
    R[i] += r
  }
}
const mtof = (f, semi) => f * Math.pow(2, semi / 12)

const kick = (t0, gain, soft = false) => add(t0, soft ? 0.26 : 0.32, (t) => {
  const f = (soft ? 52 : 46) + (soft ? 60 : 108) * Math.exp(-t * (soft ? 22 : 30))
  const a = Math.exp(-t * (soft ? 11 : 9)) * Math.min(1, t / 0.003)
  const v = Math.sin(2 * Math.PI * f * t) * a * gain
  return [v, v]
})
const brush = (t0, gain) => add(t0, 0.2, (t) => {
  const a = Math.exp(-t * 22)
  const v = noise() * a * gain
  return [v * 0.9, v]
})
const shaker = (t0, gain) => add(t0, 0.055, (t) => {
  const a = Math.exp(-t * 70) * Math.min(1, t / 0.002)
  const v = noise() * a * gain
  return [v * 0.75, v]
})
const bass = (t0, freq, len, gain) => add(t0, len, (t) => {
  const a = Math.min(1, t / 0.008) * Math.exp(-t * 1.6)
  const v = Math.sin(2 * Math.PI * freq * t) * 0.9 + Math.sin(2 * Math.PI * freq * 2 * t) * 0.12
  return [v * a * gain, v * a * gain]
})
const marimba = (t0, freq, gain, pan = 0) => add(t0, 0.5, (t) => {
  const a = Math.exp(-t * 6.5) * Math.min(1, t / 0.004)
  const v = Math.sin(2 * Math.PI * freq * t) * 0.8
    + Math.sin(2 * Math.PI * freq * 4 * t) * 0.18 * Math.exp(-t * 14)
    + Math.sin(2 * Math.PI * freq * 9.2 * t) * 0.05 * Math.exp(-t * 26)
  return [v * a * gain * (1 - pan * 0.35), v * a * gain * (1 + pan * 0.35)]
})
const piano = (t0, freq, gain, pan = 0) => add(t0, 1.1, (t) => {
  const a = Math.exp(-t * 2.2) * Math.min(1, t / 0.005)
  const v = Math.sin(2 * Math.PI * freq * t) * 0.7
    + Math.sin(2 * Math.PI * freq * 2 * t) * 0.2 * Math.exp(-t * 3)
    + Math.sin(2 * Math.PI * freq * 3 * t) * 0.08 * Math.exp(-t * 5)
  return [v * a * gain * (1 - pan * 0.3), v * a * gain * (1 + pan * 0.3)]
})
const pluck = (t0, freq, gain, pan = 0) => add(t0, 0.32, (t) => {
  const a = Math.exp(-t * 9) * Math.min(1, t / 0.003)
  const v = Math.sin(2 * Math.PI * freq * t) * 0.7 + Math.sin(2 * Math.PI * freq * 2 * t) * 0.25
  return [v * a * gain * (1 - pan * 0.4), v * a * gain * (1 + pan * 0.4)]
})
const bell = (t0, freq, gain) => add(t0, 1.6, (t) => {
  const a = Math.exp(-t * 2.4) * Math.min(1, t / 0.01)
  const v = Math.sin(2 * Math.PI * freq * t) * 0.55
    + Math.sin(2 * Math.PI * freq * 2.76 * t) * 0.18 * Math.exp(-t * 3.5)
    + Math.sin(2 * Math.PI * freq * 5.4 * t) * 0.06 * Math.exp(-t * 6)
  return [v * a * gain, v * a * gain * 0.95]
})
const pad = (t0, freqs, len, gain, attack) => add(t0, len, (t) => {
  const a = Math.min(1, t / attack) * Math.min(1, Math.max(0, (len - t) / 0.9))
  let v = 0
  for (const f of freqs) {
    v += Math.sin(2 * Math.PI * f * t) * 0.06
    v += Math.sin(2 * Math.PI * f * 1.003 * t) * 0.05
  }
  return [v * a * gain, v * a * gain * 0.97]
})
const woodTick = (t0, gain) => add(t0, 0.08, (t) => {
  const a = Math.exp(-t * 55)
  const v = Math.sin(2 * Math.PI * 620 * t) * 0.6 + noise() * 0.25 * Math.exp(-t * 90)
  return [v * a * gain, v * a * gain]
})
const softTick = (t0, gain) => add(t0, 0.12, (t) => {
  const a = Math.exp(-t * 30)
  const v = Math.sin(2 * Math.PI * 1180 * t) * 0.4 + Math.sin(2 * Math.PI * 2360 * t) * 0.15
  return [v * a * gain, v * a * gain]
})
const riser = (t0, len, gain) => add(t0, len, (t) => {
  const p = t / len
  const a = Math.pow(p, 2.2) * (1 - Math.max(0, p - 0.92) / 0.08)
  const v = (noise() * 0.6 + Math.sin(2 * Math.PI * (200 + 900 * p * p) * t) * 0.25) * a * gain
  return [v * 0.8, v]
})

// ---------- 段落能量：由 beat 标记决定，边界 0.6s 缓入 ----------
const marks = events.filter((e) => e.type === 'beat').sort((a, b) => a.frame - b.frame)
const energyAtMarks = marks.map((m) => ({ t: m.frame / fps, e: P.energy[m.name] ?? 0.4 }))
if (!energyAtMarks.length) energyAtMarks.push({ t: 0, e: 0.5 })
if (energyAtMarks[0].t > 0) energyAtMarks.unshift({ t: 0, e: energyAtMarks[0].e })
const energy = (t) => {
  let e = energyAtMarks[0].e
  for (let i = 0; i < energyAtMarks.length; i++) {
    const cur = energyAtMarks[i]
    if (t >= cur.t) {
      const nxt = energyAtMarks[i + 1]
      if (!nxt) e = cur.e
      else {
        const k = Math.min(1, Math.max(0, (t - cur.t) / Math.min(0.6, Math.max(0.05, nxt.t - cur.t))))
        e = cur.e + (nxt.e - cur.e) * k
      }
    }
  }
  return e
}

// ---------- 编曲 ----------
const beat = 60 / P.bpm
const bar = beat * 4
const step16 = beat / 4
const chords = P.prog.map((k) => CH[k].map((f) => mtof(f, P.transpose)))
const chordAt = (i) => chords[i % chords.length]

// 铺底 pad：每小节换和弦
for (let t = 0, b = 0; t < dur; t += bar, b++) {
  const e = energy(t + bar * 0.3)
  pad(t, chordAt(b).map((f) => f * P.pad.octave), bar + 0.4, P.pad.level * (0.55 + 0.45 * e), P.pad.attack)
}
// 打击 / 贝斯 / 琶音：按 16 分网格排，能量不够的声部自动不进
for (let t = 0, b = 0; t < dur - 0.05; t += bar, b++) {
  const chord = chordAt(b)
  const root = mtof(CH[P.prog[b % P.prog.length]][0], P.transpose) / 2
  for (let s = 0; s < 16; s++) {
    const tt = t + s * step16 * (s % 2 ? 1 + 0.06 : 1) // 轻微 swing
    if (tt >= dur - 0.05) break
    const e = energy(tt)
    if (P.kick.level > 0 && P.kick.pattern.includes(s) && e > 0.34) {
      kick(tt, P.kick.level * (0.55 + 0.45 * e) * (s === 0 ? 1 : 0.7), styleName !== 'pulse')
    }
    if (P.brush.level > 0 && (s === 4 || s === 12) && e > 0.5) brush(tt, P.brush.level * (0.6 + 0.5 * e))
    if (P.shaker.level > 0 && s % 2 === 0 && e > 0.1) {
      shaker(tt, P.shaker.level * (s % 4 === 2 ? 1 : 0.62) * (0.5 + 0.6 * e) * (0.85 + rnd() * 0.3))
    }
    if (P.bass.level > 0 && P.bass.pattern.includes(s) && e > 0.26) {
      bass(tt, root * (s === 8 ? 1.5 : 1), step16 * 3.4, P.bass.level * (0.5 + 0.6 * e))
    }
    if (P.arp.level > 0 && P.arp.steps.includes(s) && e > 0.24) {
      const idx = P.arp.steps.indexOf(s) % chord.length
      const oct = P.arp.octave * (s % 8 === 6 ? 2 : 1)
      const f = chord[idx] * oct
      const g = P.arp.level * (0.5 + 0.55 * e) * (0.8 + rnd() * 0.4)
      const pan = s % 2 ? 0.35 : -0.35
      if (P.arp.voice === 'marimba') marimba(tt, f, g, pan)
      else if (P.arp.voice === 'piano') piano(tt, f, g, pan)
      else if (P.arp.voice === 'pluck') pluck(tt, f, g, pan)
      else bell(tt, f, g)
    }
  }
}
// 换段的铃音：给观众一个呼吸点
for (let i = 1; i < marks.length; i++) {
  const t = marks[i].frame / fps
  bell(t, chordAt(Math.floor(t / bar))[1] * 2, P.bell.level)
}
// 点击声
for (const c of events.filter((e) => e.type === 'click')) {
  const t = c.frame / fps
  if (t >= dur) continue
  if (P.tick === 'wood') woodTick(t, 0.5)
  else softTick(t, 0.45)
}
// 镜头推近前的极轻上行
for (const e of events.filter((x) => x.type === 'cam' && x.s > 1.05)) {
  const t = e.frame / fps - 0.55
  if (t > 0.3) riser(t, 0.55, 0.5)
}

// ---------- 母带 ----------
const fadeOut = 1.4
for (let i = 0; i < Math.min(N, Math.floor(fadeOut * SR)); i++) {
  const g = 1 - i / (fadeOut * SR)
  L[N - 1 - i] *= g
  R[N - 1 - i] *= g
}
const fadeIn = 0.6
for (let i = 0; i < Math.floor(fadeIn * SR); i++) {
  const g = i / (fadeIn * SR)
  L[i] *= g
  R[i] *= g
}
let peak = 0
for (let i = 0; i < N; i++) {
  L[i] = Math.tanh(L[i] * 1.25)
  R[i] = Math.tanh(R[i] * 1.25)
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]))
}
const norm = 0.7 / (peak || 1)
for (let i = 0; i < N; i++) { L[i] *= norm; R[i] *= norm }

// ---------- 写 16-bit PCM WAV ----------
const buf = Buffer.alloc(44 + N * 4)
buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVE', 8)
buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22)
buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34)
buf.write('data', 36); buf.writeUInt32LE(N * 4, 40)
for (let i = 0; i < N; i++) {
  buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(L[i] * 32767))), 44 + i * 4)
  buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(R[i] * 32767))), 44 + i * 4 + 2)
}
fs.writeFileSync(path.resolve(outArg), buf)
console.log('done:', path.resolve(outArg), `${(buf.length / 1048576).toFixed(1)}MB`, `sections=${marks.length}`)

// 模板字段速查：
//   bpm            速度
//   transpose      整体移调（半音）
//   prog           和弦走向，可用 C / Am / F / G / Dm / Em / Bb
//   pad            铺底（level / attack / octave）
//   kick           底鼓（pattern 是 16 分网格位置；level=0 表示不用）
//   brush/shaker   刷子 / 沙锤
//   bass           贝斯（pattern / level）
//   arp            琶音（voice: marimba|piano|pluck|bell，steps 同 16 分网格）
//   bell           换段铃音
//   tick           点击声音色：wood | soft
//   energy         各段目标能量 0–1（键名对应 mark() 里用的名字）
