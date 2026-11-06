// ffmpeg / ffprobe 定位：命令行参数 > 环境变量 > PATH > where.exe > 常见安装目录
// encode.mjs 与 verify.mjs 共用。不猜版本：跑一次 -version，太老的构建直接跳过。
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const isWin = process.platform === 'win32'

// Windows 下 .cmd/.bat 必须走 shell，且参数要自己拼引号（Node 的 execFile 跑不了 .cmd）
export const quote = (s) => (/[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s)
const needsShell = (c) => isWin && /\.(cmd|bat)$/i.test(c)

export function runCmd(c, args, opts = {}) {
  return needsShell(c)
    ? spawnSync([c, ...args].map(quote).join(' '), { shell: true, timeout: 30000, ...opts })
    : spawnSync(c, args, { timeout: 30000, ...opts })
}

// 返回首行版本串，跑不通返回 null
function probe(c) {
  try {
    const r = runCmd(c, ['-version'], { stdio: ['ignore', 'pipe', 'ignore'] })
    if (r.status !== 0) return null
    return (r.stdout?.toString() || '').split('\n')[0].trim() || null
  } catch {
    return null
  }
}

// 老构建（< 5.0）没有可用的 loudnorm/scale 范围转换，跳过并说明
function versionMajor(line) {
  const m = /version\s+(\d+)\.(\d+)/.exec(line || '')
  return m ? Number(m[1]) : null
}

function winCommon() {
  const home = os.homedir()
  const dirs = [
    'C:/ffmpeg/bin/ffmpeg.exe',
    'C:/ProgramData/chocolatey/bin/ffmpeg.exe',
    path.join(home, 'scoop/shims/ffmpeg.exe'),
    path.join(home, 'AppData/Local/Microsoft/WinGet/Links/ffmpeg.exe'),
  ]
  // winget 装的 Gyan.FFmpeg 目录名带哈希，展开一层通配
  const winget = path.join(home, 'AppData/Local/Microsoft/WinGet/Packages')
  try {
    for (const d of fs.readdirSync(winget)) {
      if (!/^Gyan\.FFmpeg/i.test(d)) continue
      const base = path.join(winget, d)
      for (const rel of ['ffmpeg.exe', 'bin/ffmpeg.exe']) {
        const p = path.join(base, 'ffmpeg-master-latest-win64-gpl', rel)
        if (fs.existsSync(p)) dirs.push(p)
      }
      try {
        for (const sub of fs.readdirSync(base)) {
          const p = path.join(base, sub, 'bin', 'ffmpeg.exe')
          if (fs.existsSync(p)) dirs.push(p)
        }
      } catch {}
    }
  } catch {}
  return dirs
}

function unixCommon() {
  return ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg']
}

// where.exe 找 PATH 上的可执行文件。注意 .cmd/.bat 包装脚本也能用（上面 needsShell 会走 shell），
// 很多 Windows 机器 PATH 上只有 ffmpeg.cmd，只认 .exe 会把能用的那个筛掉。
function winWhere(exe) {
  const r = spawnSync('where.exe', [exe], { stdio: ['ignore', 'pipe', 'ignore'] })
  const lines = r.status === 0 ? (r.stdout?.toString() || '').split('\n').map((l) => l.trim()) : []
  return lines.filter((l) => l && /\.(exe|cmd|bat)$/i.test(l))
}

// PATH 目录自己扫一遍：where.exe 不在（某些精简环境）时也能找到
function pathDirs(bin) {
  const sep = isWin ? ';' : ':'
  const exts = isWin ? ['.exe', '.cmd', '.bat', ''] : ['']
  const hits = []
  for (const d of (process.env.PATH || '').split(sep)) {
    if (!d) continue
    for (const e of exts) {
      const p = path.join(d, bin + e)
      if (fs.existsSync(p)) { hits.push(p); break }
    }
  }
  return hits.filter((p) => /\.exe$/i.test(p)).concat(hits.filter((p) => !/\.exe$/i.test(p)))
}

/**
 * 找到可用的 ffmpeg。
 * @param {{cliArg?: string, log?: (s: string) => void}} opts
 * @returns {{path: string, version: string}}
 */
export function findFfmpeg({ cliArg, log = console.log } = {}) {
  const tried = []
  const seen = new Set()
  const raw = [
    ['--ffmpeg 参数', cliArg],
    ['FFMPEG 环境变量', process.env.FFMPEG],
    ['FFMPEG_PATH 环境变量', process.env.FFMPEG_PATH],
    ...winWhere('ffmpeg').map((p) => ['where.exe', p]),
    ...pathDirs('ffmpeg').map((p) => ['PATH 目录扫描', p]),
    ...(isWin ? winCommon().map((p) => ['常见安装目录', p]) : unixCommon().map((p) => ['常见安装目录', p])),
    ['PATH 上的 ffmpeg', 'ffmpeg'],
  ].filter(([, p]) => !!p)
  const candidates = raw.filter(([, p]) => {
    const k = String(p).toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })

  for (const [from, p] of candidates) {
    const line = probe(p)
    if (!line) {
      tried.push(`${p}（${from}：跑不通）`)
      continue
    }
    const major = versionMajor(line)
    if (major !== null && major < 5) {
      tried.push(`${p}（${from}：${line.split(' ')[1] || '?'}，太旧，需要 5.0+）`)
      continue
    }
    tried.push(`${p}（${from}：命中）`)
    log(`ffmpeg: ${p}`)
    return { path: p, version: line }
  }

  console.error('找不到可用的 ffmpeg（需要 5.0 以上，含 loudnorm 与 scale 范围转换）。')
  console.error('任选一种：--ffmpeg <路径> / 设 FFMPEG 环境变量 / 装到 PATH（Windows: winget install Gyan.FFmpeg）')
  console.error('已尝试：')
  for (const t of tried) console.error('  ' + t)
  process.exit(2)
}

/** 由 ffmpeg 路径推出同目录的 ffprobe；推不出就用 PATH 上的 ffprobe */
export function findFfprobe(ffmpegPath, log = console.log) {
  const dir = path.dirname(ffmpegPath)
  const exe = isWin ? 'ffprobe.exe' : 'ffprobe'
  const guesses = [
    path.join(dir, exe),
    path.join(dir, 'ffprobe'),
    ...(isWin ? winWhere('ffprobe') : []),
    'ffprobe',
  ]
  for (const g of guesses) {
    if (!g) continue
    const r = runCmd(g, ['-version'], { stdio: ['ignore', 'ignore', 'ignore'] })
    if (r.status === 0) {
      log(`ffprobe: ${g}`)
      return g
    }
  }
  console.error('找到 ffmpeg 但找不到 ffprobe（验收需要它读色彩标签）。')
  process.exit(2)
}
