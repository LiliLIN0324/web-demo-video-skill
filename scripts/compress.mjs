// 压缩已有的 mp4（封面片段、历史片子），压完自己验收。
// 用法：node compress.mjs <in.mp4> <out.mp4> [--crf 29] [--width 1920] [--preset slow]
//                      [--no-check] [--ffmpeg <路径>]
//
// 这里的原则和 encode.mjs 不一样：encode 是「帧 → 片」，帧率自己定；
// compress 是「片 → 片」，源已经是成片了，动帧率等于往里面插重复帧。
// 所以本脚本没有 --fps / -r 参数：帧率照搬源，只在源比 --width 宽时降分辨率，永不放大。
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { findFfmpeg, findFfprobe, runCmd } from './ffmpeg.mjs'

const argv = process.argv.slice(2)
const flags = {}
const pos = []
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a.startsWith('--')) {
    if (a === '--no-check') { flags[a.slice(2)] = true; continue }
    flags[a.slice(2)] = argv[++i]
  } else pos.push(a)
}
const [srcArg, dstArg] = pos
if (!srcArg || !dstArg) {
  console.error('用法: node compress.mjs <in.mp4> <out.mp4> [--crf 29] [--width 1920] [--preset slow]')
  process.exit(1)
}
const src = path.resolve(srcArg)
const dst = path.resolve(dstArg)
if (!fs.existsSync(src)) { console.error(`源不存在: ${src}`); process.exit(1) }
const CRF = flags.crf || '29'
const MAXW = Number(flags.width || 1920)
const PRESET = flags.preset || 'slow'

const { path: ffmpeg } = findFfmpeg({ cliArg: flags.ffmpeg })
const ffprobe = findFfprobe(ffmpeg)
const run = (exe, args) => runCmd(exe === 'ffmpeg' ? ffmpeg : ffprobe, args,
  // runCmd 默认 30s 超时是给探测用的；转码和逐帧取样要跑到分钟级
  { encoding: 'utf8', maxBuffer: 1 << 28, timeout: Number(flags.timeout || 3600000) })

// 每个键取第一次出现；值一律 trim（Windows 下 ffprobe 行尾带 \r）。
// 视频流探测带 -select_streams v:0，否则音频流的 avg_frame_rate=0/0 会把视频的那个键盖掉。
const kv = (txt) => {
  const o = {}
  for (const line of String(txt).split('\n')) {
    const i = line.indexOf('=')
    if (i < 0) continue
    const k = line.slice(0, i).trim(), v = line.slice(i + 1).trim()
    if (!(k in o)) o[k] = v
  }
  return o
}
const fmt = (f) => kv(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size,bit_rate', '-of', 'default=nw=1:nk=0', f]).stdout)
const vid = (f) => kv(run('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
  '-show_entries', 'stream=codec_name,width,height,avg_frame_rate,nb_frames,pix_fmt,color_range,color_space,color_transfer,color_primaries',
  '-of', 'default=nw=1:nk=0', f]).stdout)
const hasAudio = (f) => run('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', f]).stdout.trim() !== ''

const before = fmt(src), bv = vid(src)
const srcAudio = hasAudio(src)
// 有些文件容器里不写帧数，色差取样要用它，补一次实读
if (!Number(bv.nb_frames)) bv.nb_frames = String(run('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
  '-count_frames', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', src]).stdout.trim())

const vf = []
if (Number(bv.width) > MAXW) vf.push(`scale='if(gt(iw,${MAXW}),${MAXW},iw)':-2:flags=lanczos`)
const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', src]
if (vf.length) args.push('-vf', vf.join(','))
args.push(
  '-c:v', 'libx264', '-preset', PRESET, '-crf', CRF, '-pix_fmt', 'yuv420p',
  '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
  // 容器和码流 VUI 都要写，只给 -color_* 的话码流里还是 unknown
  '-x264-params', 'colorprim=bt709:transfer=bt709:colormatrix=bt709',
  '-movflags', '+faststart')
args.push(...(srcAudio ? ['-c:a', 'aac', '-b:a', flags['audio-bitrate'] || '128k'] : ['-an']))
args.push(dst)

const t0 = Date.now()
const r = run('ffmpeg', args)
if (r.status !== 0) { console.error('ffmpeg 失败:\n' + (r.stderr || r.stdout)); process.exit(1) }

const after = fmt(dst), av = vid(dst)
const MB = (n) => (Number(n) / 1e6).toFixed(1) + ' MB'
const Mbps = (o) => (Number(o.bit_rate) / 1e6).toFixed(2) + ' Mbps'
console.log([
  `${path.basename(src)} → ${path.basename(dst)}（CRF ${CRF} · ${PRESET}）`,
  `  ${bv.width}x${bv.height} → ${av.width}x${av.height} · ${bv.avg_frame_rate} → ${av.avg_frame_rate} fps`,
  `  ${MB(before.size)} → ${MB(after.size)}（省 ${(100 - Number(after.size) / Number(before.size) * 100).toFixed(0)}%）· ${Mbps(before)} → ${Mbps(after)}`,
  `  ${Number(before.duration).toFixed(1)}s → ${Number(after.duration).toFixed(1)}s · 帧 ${bv.nb_frames} → ${av.nb_frames} · 音频 ${srcAudio ? '保留' : '源无音轨'} · 耗时 ${((Date.now() - t0) / 1000).toFixed(0)}s`,
].join('\n'))

if (flags.noCheck) process.exit(0)

// 验收：时长/帧数没被动过、色彩标签、不放大、音轨还在、faststart、同时间取样比色差
const rows = []
const ok = (name, pass, detail) => rows.push(`${pass ? '通过  ' : '不通过'}  ${name.padEnd(8)} ${detail}`)
const oDur = Number(before.duration), lDur = Number(after.duration)
ok('时长', Math.abs(oDur - lDur) < 0.5, `${oDur.toFixed(1)}s → ${lDur.toFixed(1)}s`)
ok('帧数', Number(av.nb_frames) <= Number(bv.nb_frames) + 2, `${bv.nb_frames} → ${av.nb_frames}（涨了说明帧率被重采样）`)
ok('体积', Number(after.size) < Number(before.size), `${MB(before.size)} → ${MB(after.size)}`)
ok('色彩', ['color_space', 'color_transfer', 'color_primaries'].every((k) => av[k] === 'bt709')
  && av.color_range === 'tv' && av.pix_fmt === 'yuv420p',
  `${av.pix_fmt} range=${av.color_range} ${av.color_space}/${av.color_transfer}/${av.color_primaries}`)
ok('不放大', Number(av.width) <= Number(bv.width), `${bv.width}x${bv.height} → ${av.width}x${av.height}`)
ok('音轨', !srcAudio || hasAudio(dst), `原 ${srcAudio ? '有' : '无'} → 新 ${hasAudio(dst) ? '有' : '无'}`)

const head = fs.readFileSync(dst).subarray(0, 8 << 20)
const at = (tag) => { for (let i = 0; i + 8 < head.length; i++) if (head.toString('latin1', i, i + 4) === tag) return i; return -1 }
const moov = at('moov'), mdat = at('mdat')
ok('faststart', moov >= 0 && (mdat < 0 || moov < mdat), `moov@${moov} mdat@${mdat}`)

// 色差：按帧号对齐取样，不按时间戳。
// 转码保住了源帧率，两边第 i 帧基本是同一帧内容——这比时间戳可靠：
// 时间戳精确 seek 在 VFR 源上会落到帧边界两侧，一个镜头切过去能把差顶到 Y 13/255（实测），
// 看着像严重偏色，其实取的根本不是同一帧。（-ss 放在 -i 之后已经是精确 seek，仍躲不开 VFR 的边界。）
// 但 VFR 源归一化后可能少一帧（实测 3311 → 3310），序号会整体错开一位，
// 所以每个取样点在 ±3 帧的窗口里找差最小的那一帧来配——真偏色是配不掉的，怎么都比不动。
// 闸门为什么是 Y ≤ 2.5 / U ≤ 1.5，而不是 verify.mjs 那条 Y < 2：
// 转码后运动帧剩下的是压缩残差，几乎全在 Y（色度二次采样后 UV 基本不动）。
// 实测同一条片子静止帧能到 Y 0.02、运动帧 1.7–2.1，U 全程 ≤ 1.0；
// range/matrix 搞错则是每个取样点一起高，不会因为画面静止而落到 0.02。
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wdv-compress-'))
const stat = (x, y) => {
  const out = run('ffmpeg', ['-hide_banner', '-loglevel', 'info', '-i', x, '-i', y,
    '-filter_complex', `[0:v][1:v]blend=all_mode=difference,format=yuv420p,signalstats,`
      + `metadata=print:key=lavfi.signalstats.YAVG:file=-,metadata=print:key=lavfi.signalstats.UAVG:file=-`,
    '-f', 'null', '-']).stdout
  return { y: Number((out.match(/YAVG=([\d.]+)/) || [])[1] || 0), u: Number((out.match(/UAVG=([\d.]+)/) || [])[1] || 0) }
}
const pick = (f, i, o) => run('ffmpeg', ['-y', '-loglevel', 'error', '-i', f,
  '-vf', `select=eq(n\\,${i}),scale=960:-2`, '-fps_mode', 'passthrough', '-frames:v', '1', o])
const W = 3
const samples = []
for (const ratio of [0.15, 0.5, 0.85]) {
  const i = Math.floor(Number(bv.nb_frames) * ratio)
  const lite = path.join(tmp, 'lite.png')
  pick(dst, i, lite)
  run('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-start_number', '0',
    '-vf', `select=between(n\\,${Math.max(0, i - W)}\\,${i + W}),scale=960:-2`, '-fps_mode', 'passthrough',
    path.join(tmp, 's_%02d.png')])
  const cands = fs.readdirSync(tmp).filter((f) => /^s_\d+\.png$/.test(f)).sort()
  let best = { y: Infinity, u: 0, off: 0 }
  for (const [k, f] of cands.entries()) {
    const s = stat(path.join(tmp, f), lite)
    if (s.y < best.y) best = { ...s, off: k - (i - Math.max(0, i - W)) }
  }
  samples.push({ i, ...best })
  for (const f of cands) fs.rmSync(path.join(tmp, f))
}
fs.rmSync(tmp, { recursive: true, force: true })
const wy = Math.max(...samples.map((s) => s.y)), wu = Math.max(...samples.map((s) => s.u))
ok('色差', wy <= 2.5 && wu <= 1.5,
  samples.map((s) => `帧${s.i}${s.off ? `(${s.off > 0 ? '+' : ''}${s.off})` : ''} Y ${s.y.toFixed(2)}/U ${s.u.toFixed(2)}`).join(' · '))

const bad = rows.filter((s) => s.startsWith('不通过')).length
console.log(rows.join('\n'))
console.log(bad ? `→ ${bad} 项不通过，这条别用\n` : '→ 全部通过\n')
process.exit(bad ? 1 : 0)
