/**
 * dsh-kuakua — Host half.
 *
 * 只做四件事：
 *   1. 管数据目录（~/.dsh/kuakua）：config.json 与默认表情目录；
 *   2. 读写配置（页面上的设置页 POST 回来，这里落盘）；
 *   3. 扫表情目录并开一条 HTTP 路由把图喂给页面；
 *   4. 提供「让网页版 AI 生成」用的提示词。
 *
 * 页面那半边（lib/client.js）负责按钮、面板和设置界面；这里不碰 UI。
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'

const ROUTE = '/x-kuakua'
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.bmp'])
const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
}

/** 老大的 dsh 主目录；允许用环境变量挪。 */
function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

const DATA_DIR = path.join(dshHome(), 'kuakua')
const CONFIG_PATH = path.join(DATA_DIR, 'config.json')
const DEFAULT_STICKERS = path.join(DATA_DIR, 'stickers')

/**
 * 默认模板：称呼 / 夸奖 / 动作 / 颜文字 / emoji 五张表，
 * 表达式默认把前三张串起来，颜文字和 emoji 各挂一个位置。
 */
const DEFAULT_CONFIG = {
  mode: 'expr',
  repeatMode: 'append', // append=继续加一条；replace=换掉上一条（只动夸夸那一行）
  expression: '{称呼}{夸奖}（{动作}）{颜文字}{emoji}',
  // 称呼、动作这两张表故意留空：装插件的人自己填，包里不带任何人的私人说法。
  addresses: [],
  praises: ['真棒', '这活干得漂亮', '写得真清楚', '这个思路好', '办事真利索'],
  actions: [],
  kaomoji: ['(๑•̀ㅂ•́)و✧', '(๑>؂<๑)', '(*/ω＼*)'],
  emojis: ['✨', '👍', '🎉'],
  templates: ['{夸奖}（{动作}）', '{夸奖}{颜文字}', '{称呼}{夸奖}'],
  stickersDir: '',
  pinned: [],
  stickerColumns: 6,
  appendKeepsDraft: true,
  aiName: '',
  aiTraits: '',
}

function log(...args) {
  try {
    console.log('[dsh-kuakua]', ...args)
  } catch {}
}

function ensureDirs() {
  try {
    fs.mkdirSync(DEFAULT_STICKERS, { recursive: true })
  } catch (error) {
    log('创建表情目录失败:', error && error.message)
  }
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

function readConfigFile() {
  try {
    const raw = stripBom(fs.readFileSync(CONFIG_PATH, 'utf8'))
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** 读配置：默认值打底，文件里的字段覆盖上来；坏字段单独兜住。 */
function loadConfig() {
  const saved = readConfigFile()
  const config = { ...DEFAULT_CONFIG }
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    if (!(key in saved)) continue
    const expected = DEFAULT_CONFIG[key]
    const value = saved[key]
    if (Array.isArray(expected)) {
      if (Array.isArray(value)) config[key] = value.filter((item) => typeof item === 'string')
      continue
    }
    if (typeof expected === 'number') {
      if (Number.isFinite(value)) config[key] = value
      continue
    }
    if (typeof expected === 'string') {
      if (typeof value === 'string') config[key] = value
      continue
    }
    if (typeof expected === 'boolean') {
      if (typeof value === 'boolean') config[key] = value
      continue
    }
    config[key] = value
  }
  // 表情目录留空表示用默认目录；用户填了相对路径时按 dsh 主目录展开。
  config.stickersDir = resolveStickersDir(config.stickersDir)
  return config
}

function resolveStickersDir(raw) {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (!value) return DEFAULT_STICKERS
  if (value === '~') return os.homedir()
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2))
  return path.isAbsolute(value) ? value : path.join(dshHome(), value)
}

function saveConfig(patch) {
  const current = readConfigFile()
  const next = { ...current, ...patch }
  // 存盘时把表情目录还原成用户输入的原样，默认目录不落盘。
  const dirNow = resolveStickersDir(next.stickersDir)
  if (dirNow === DEFAULT_STICKERS) next.stickersDir = ''
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  return loadConfig()
}

/** 扫一个目录（只扫一层），返回图片清单；顺手把目录建出来。 */
async function scanStickers(dir) {
  try {
    await fsp.mkdir(dir, { recursive: true })
  } catch (error) {
    return { items: [], error: `建目录失败：${error && error.message}` }
  }
  let dirents = []
  try {
    dirents = await fsp.readdir(dir, { withFileTypes: true })
  } catch (error) {
    return { items: [], error: `读目录失败：${error && error.message}` }
  }
  const items = []
  for (const dirent of dirents) {
    if (!dirent.isFile()) continue
    const ext = path.extname(dirent.name).toLowerCase()
    if (!IMAGE_EXT.has(ext)) continue
    let size = 0
    let mtime = 0
    try {
      const stat = await fsp.stat(path.join(dir, dirent.name))
      size = stat.size
      mtime = stat.mtimeMs || 0
    } catch {
      continue
    }
    items.push({
      name: dirent.name,
      base: path.basename(dirent.name, ext),
      ext: ext.slice(1),
      size,
      mtime,
      url: `${ROUTE}/img/${encodeURIComponent(dirent.name)}`,
    })
  }
  items.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
  return { items }
}

function json(res, status, body) {
  const text = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(text)
}

function isLoopback(req) {
  const address = String(req.socket?.remoteAddress ?? '')
  return /^127\./u.test(address) || address === '::1' || /^::ffff:127\./iu.test(address)
}

function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('请求体太大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** 「让网页版 AI 生成」用的提示词：名字和特点留空时保留 XXXXXX，用户自己填。 */
function generationPrompt(config, override) {
  const name = String((override && override.name) || config.aiName || '').trim() || 'XXXXXX'
  const traits = String((override && override.traits) || config.aiTraits || '').trim() || 'XXXXXX'
  return [
    `帮我写一批中文夸夸句子，用来夸奖一个叫「${name}」的 AI 小伙伴（是用户夸小伙伴，不是小伙伴夸用户），这个伙伴有「${traits}」的特点`,
    '',
    '要求：',
    '1. 一行一句，不要编号、不要引号、不要解释；',
    '2. 用上这些占位符：{称呼} {夸奖} {动作} {颜文字} {emoji}，我会自己替换；',
    '3. 「夸奖」要具体，能夸到点上，比如「这次活做得漂亮」「做的真好」，别是空泛的「真棒」；',
    '4. 「动作」是括号里的动作描写，可以皮一点、亲密一点，比如「摸头」「摸脸蛋」；',
    '5. 三十句左右，长短混着来，别都是一个腔调。',
    '',
    '直接给我句子就行。',
  ].join('\n')
}


/* ==================================================================
 * 从 QQ 导入：只认经典的自定义表情目录，读文件头判断真实格式再复制
 * ================================================================== */

const MAGIC = [
  { ext: 'png', head: [0x89, 0x50, 0x4e, 0x47] },
  { ext: 'gif', head: [0x47, 0x49, 0x46, 0x38] },
  { ext: 'jpg', head: [0xff, 0xd8, 0xff] },
  { ext: 'bmp', head: [0x42, 0x4d] },
]

/** 只认头几个字节：QQ 里有把 PNG 写成 .gif 的，按扩展名来会打不开。 */
function sniffExt(buf) {
  for (const rule of MAGIC) {
    if (rule.head.every((byte, index) => buf[index] === byte)) return rule.ext
  }
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp'
  return null
}

/** 极简 glob：只处理路径里的 * 段。 */
async function expandGlob(pattern) {
  const parts = pattern.split(path.sep).filter(Boolean)
  let current = [path.isAbsolute(pattern) ? path.sep : '.']
  for (const part of parts) {
    const next = []
    for (const base of current) {
      if (!part.includes('*')) {
        next.push(path.join(base, part))
        continue
      }
      const re = new RegExp('^' + part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$')
      let entries = []
      try {
        entries = await fsp.readdir(base)
      } catch {
        continue
      }
      for (const name of entries) if (re.test(name)) next.push(path.join(base, name))
    }
    current = next
    if (current.length === 0) break
  }
  return current.filter((item) => path.isAbsolute(item))
}

function qqCandidates() {
  const home = os.homedir()
  if (process.platform === 'darwin') {
    const base = path.join(home, 'Library/Containers/com.tencent.qq/Data/Library/Application Support/QQ')
    return [
      { id: 'qq-personal', label: 'QQ 自定义表情', globs: [path.join(base, 'nt_qq_*', 'nt_data/Emoji/personal_emoji/Ori')] },
      { id: 'qq-recv', label: 'QQ 收到的表情', globs: [path.join(base, 'nt_qq_*', 'nt_data/Emoji/emoji-recv/*/Ori')] },
    ]
  }
  if (process.platform === 'win32') {
    const docs = path.join(home, 'Documents')
    const bases = [
      path.join(docs, 'Tencent Files'),
      path.join('C:\\Users', 'Public', 'Documents', 'Tencent Files'),
      path.join(docs, 'Tencent Files', 'nt_qq'),
    ]
    const globs = []
    for (const base of bases) {
      globs.push(path.join(base, '*', 'nt_qq', 'nt_data', 'Emoji', 'personal_emoji', 'Ori'))
      globs.push(path.join(base, '*', 'nt_data', 'Emoji', 'personal_emoji', 'Ori'))
      globs.push(path.join(base, '*', 'nt_qq', 'nt_data', 'Emoji', 'emoji-recv', '*', 'Ori'))
    }
    return [{ id: 'qq-personal', label: 'QQ 自定义表情', globs }]
  }
  return []
}

/** 数一个目录里能认出来的图（认不出的跳过，微信那种加密文件就数不出来）。 */
async function scanImageDir(dir) {
  let names = []
  try {
    names = await fsp.readdir(dir)
  } catch (error) {
    return { dir, count: 0, bytes: 0, error: String(error && error.message) }
  }
  let count = 0
  let bytes = 0
  for (const name of names) {
    const file = path.join(dir, name)
    let stat
    try {
      stat = await fsp.stat(file)
    } catch {
      continue
    }
    if (!stat.isFile()) continue
    if (stat.size < 16) continue
    let head
    try {
      const handle = await fsp.open(file, 'r')
      try {
        head = Buffer.alloc(16)
        await handle.read(head, 0, 16, 0)
      } finally {
        await handle.close()
      }
    } catch {
      continue
    }
    if (sniffExt(head)) {
      count += 1
      bytes += stat.size
    }
  }
  return { dir, count, bytes }
}

const allowedDirs = new Set()

async function scanQq() {
  const sources = []
  for (const candidate of qqCandidates()) {
    const dirs = []
    for (const pattern of candidate.globs) {
      for (const dir of await expandGlob(pattern)) dirs.push(dir)
    }
    let count = 0
    let bytes = 0
    const dirList = []
    for (const dir of dirs) {
      const result = await scanImageDir(dir)
      if (result.count > 0) {
        dirList.push({ dir: result.dir, count: result.count })
        count += result.count
        bytes += result.bytes
      }
    }
    if (dirList.length > 0) {
      for (const item of dirList) allowedDirs.add(path.resolve(item.dir))
      sources.push({ id: candidate.id, label: candidate.label, count, bytes, dirs: dirList })
    }
  }
  return { sources, platform: process.platform, home: os.homedir() }
}

/** 复制：读头认格式、改名、同名同大小跳过。 */
async function importFromDirs(dirs, targetDir) {
  await fsp.mkdir(targetDir, { recursive: true })
  const result = { copied: 0, skipped: 0, failed: 0, files: [] }
  for (const dir of dirs) {
    let names = []
    try {
      names = await fsp.readdir(dir)
    } catch {
      continue
    }
    for (const name of names) {
      const from = path.join(dir, name)
      let stat
      try {
        stat = await fsp.stat(from)
      } catch {
        continue
      }
      if (!stat.isFile() || stat.size < 16) continue
      let buf
      try {
        buf = await fsp.readFile(from)
      } catch {
        result.failed += 1
        continue
      }
      const ext = sniffExt(buf)
      if (!ext) continue
      const stem = path.basename(name, path.extname(name)).replace(/[^A-Za-z0-9._-]/g, '').slice(0, 16) || 'emoji'
      const out = path.join(targetDir, `qq_${stem}.${ext}`)
      try {
        const existing = await fsp.stat(out).catch(() => null)
        if (existing && existing.size === stat.size) {
          result.skipped += 1
          continue
        }
        await fsp.writeFile(out, buf)
        result.copied += 1
        if (result.files.length < 6) result.files.push(path.basename(out))
      } catch {
        result.failed += 1
      }
    }
  }
  return result
}

export const name = 'dsh-kuakua'

export function apply(ctx) {
  ensureDirs()
  log('数据目录', DATA_DIR)

  ctx.inject(['webServer'], (wctx) => {
    wctx.effect(() => wctx.webServer.register({
      kind: 'prefix',
      path: ROUTE,
      handler: async (req, res) => {
        try {
          const url = new URL(req.url ?? '/', 'http://x')
          const rest = url.pathname.slice(ROUTE.length)
          const config = loadConfig()

          if (rest === '/state') {
            const scan = await scanStickers(config.stickersDir)
            const pinned = Array.isArray(config.pinned) ? config.pinned : []
            const order = (name) => {
              const index = pinned.indexOf(name)
              return index === -1 ? Number.MAX_SAFE_INTEGER : index
            }
            scan.items.sort((a, b) => {
              const diff = order(a.name) - order(b.name)
              if (diff !== 0) return diff
              if ((b.mtime || 0) !== (a.mtime || 0)) return (b.mtime || 0) - (a.mtime || 0)
              return a.name.localeCompare(b.name, 'zh-Hans-CN')
            })
            const stickers = scan.items.map((item) => ({ ...item, pinned: pinned.includes(item.name), url: `${ROUTE}/img/${encodeURIComponent(item.name)}` }))
            const view = {
              ok: true,
              config: { ...config, stickersDir: config.stickersDir },
              defaultDir: DEFAULT_STICKERS,
              dir: config.stickersDir,
              stickers,
              error: scan.error ?? null,
            }
            // 设置页正在改路径时也要看到新目录，所以 state 每次重扫，不缓存。
            json(res, 200, view)
            return
          }

          if (rest === '/config') {
            if (req.method !== 'POST' && req.method !== 'PUT') {
              json(res, 405, { ok: false, error: 'method' })
              return
            }
            if (!isLoopback(req)) {
              json(res, 403, { ok: false, error: 'local-only' })
              return
            }
            let patch
            try {
              patch = JSON.parse(await readBody(req))
            } catch (error) {
              json(res, 400, { ok: false, error: `配置不是合法 JSON：${error && error.message}` })
              return
            }
            if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
              json(res, 400, { ok: false, error: '配置得是个对象' })
              return
            }
            const saved = saveConfig(patch)
            const scan = await scanStickers(saved.stickersDir)
            json(res, 200, { ok: true, config: saved, dir: saved.stickersDir, stickers: scan.items, error: scan.error ?? null })
            return
          }

          if (rest === '/prompt') {
            const q = new URL(req.url ?? '/', 'http://x').searchParams
            json(res, 200, {
              ok: true,
              prompt: generationPrompt(loadConfig(), { name: q.get('name') || '', traits: q.get('traits') || '' }),
            })
            return
          }

          if (rest === '/qq/scan') {
            const manual = url.searchParams.get('dir')
            if (manual) {
              const dir = resolveStickersDir(manual)
              const result = await scanImageDir(dir)
              json(res, 200, {
                ok: true,
                platform: process.platform,
                sources: result.count > 0
                  ? [{ id: 'manual', label: '手填目录', count: result.count, bytes: result.bytes, dirs: [{ dir: result.dir, count: result.count }] }]
                  : [],
                dir: result.dir,
                error: result.error ?? null,
              })
              return
            }
            const scanned = await scanQq()
            json(res, 200, { ok: true, ...scanned })
            return
          }

          if (rest === '/qq/list') {
            const id = url.searchParams.get('id') || ''
            const limit = Math.min(60, Math.max(1, Number(url.searchParams.get('limit')) || 18))
            const scanned = await scanQq()
            const source = scanned.sources.find((item) => item.id === id)
            if (!source) {
              json(res, 200, { ok: true, items: [] })
              return
            }
            const items = []
            for (const entry of source.dirs) {
              let names = []
              try { names = await fsp.readdir(entry.dir) } catch { continue }
              for (const name of names) {
                if (items.length >= limit) break
                const file = path.join(entry.dir, name)
                let buf = null
                try {
                  const handle = await fsp.open(file, 'r')
                  try {
                    const head = Buffer.alloc(16)
                    await handle.read(head, 0, 16, 0)
                    if (!sniffExt(head)) continue
                  } finally {
                    await handle.close()
                  }
                  buf = true
                } catch { continue }
                if (!buf) continue
                items.push({
                  name,
                  url: `${ROUTE}/qq/img?dir=${encodeURIComponent(entry.dir)}&name=${encodeURIComponent(name)}`,
                })
              }
            }
            json(res, 200, { ok: true, items })
            return
          }

          if (rest === '/qq/img') {
            const dir = resolveStickersDir(url.searchParams.get('dir') || '')
            const name = url.searchParams.get('name') || ''
            if (!allowedDirs.has(path.resolve(dir)) || !name || name.includes('/') || name.includes(path.sep)) {
              res.statusCode = 403
              res.end()
              return
            }
            const file = path.join(dir, name)
            if (path.dirname(path.resolve(file)) !== path.resolve(dir)) {
              res.statusCode = 403
              res.end()
              return
            }
            let buf
            try {
              buf = await fsp.readFile(file)
            } catch {
              res.statusCode = 404
              res.end()
              return
            }
            const ext = sniffExt(buf)
            if (!ext) {
              res.statusCode = 415
              res.end()
              return
            }
            res.statusCode = 200
            res.setHeader('Content-Type', ext === 'jpg' ? 'image/jpeg' : `image/${ext}`)
            res.setHeader('Cache-Control', 'max-age=60')
            res.end(req.method === 'HEAD' ? undefined : buf)
            return
          }

          if (rest === '/qq/import') {
            if (req.method !== 'POST') {
              json(res, 405, { ok: false, error: 'method' })
              return
            }
            if (!isLoopback(req)) {
              json(res, 403, { ok: false, error: 'local-only' })
              return
            }
            let body
            try {
              body = JSON.parse(await readBody(req))
            } catch (error) {
              json(res, 400, { ok: false, error: `请求体不是合法 JSON：${error && error.message}` })
              return
            }
            const wanted = Array.isArray(body && body.sources) ? body.sources : []
            const scanned = await scanQq()
            const dirs = []
            for (const source of scanned.sources) {
              if (!wanted.includes(source.id)) continue
              for (const item of source.dirs) dirs.push(item.dir)
            }
            if (body && body.dir) {
              const manual = resolveStickersDir(String(body.dir))
              const probe = await scanImageDir(manual)
              if (probe.count > 0) dirs.push(manual)
            }
            if (dirs.length === 0) {
              json(res, 400, { ok: false, error: '没有可导入的目录，先扫描一下' })
              return
            }
            const target = loadConfig().stickersDir
            const report = await importFromDirs(dirs, target)
            json(res, 200, { ok: true, ...report, dir: target })
            return
          }

          if (rest === '/stickers/pin' || rest === '/stickers/delete' || rest === '/stickers/add') {
            if (req.method !== 'POST') {
              json(res, 405, { ok: false, error: 'method' })
              return
            }
            if (!isLoopback(req)) {
              json(res, 403, { ok: false, error: 'local-only' })
              return
            }
            let body
            try {
              body = JSON.parse(await readBody(req, 8 * 1024 * 1024))
            } catch (error) {
              json(res, 400, { ok: false, error: `请求体不是合法 JSON：${error && error.message}` })
              return
            }
            const current = loadConfig()
            const dir = current.stickersDir
            const name = typeof (body && body.name) === 'string' ? body.name : ''

            if (rest === '/stickers/pin') {
              if (!name) { json(res, 400, { ok: false, error: '缺名字' }); return }
              const pinned = Array.isArray(current.pinned) ? current.pinned.filter((item) => item !== name) : []
              if (body && body.pinned) pinned.unshift(name)
              const saved = saveConfig({ pinned })
              json(res, 200, { ok: true, pinned: saved.pinned })
              return
            }

            if (rest === '/stickers/delete') {
              if (!name || name.includes('/') || name.includes(path.sep)) { json(res, 400, { ok: false, error: '名字不对' }); return }
              const file = path.join(dir, name)
              if (path.dirname(path.resolve(file)) !== path.resolve(dir)) { json(res, 403, { ok: false, error: '越界' }); return }
              try {
                await fsp.unlink(file)
              } catch (error) {
                json(res, 404, { ok: false, error: String(error && error.message) })
                return
              }
              const pinned = (current.pinned || []).filter((item) => item !== name)
              saveConfig({ pinned })
              json(res, 200, { ok: true })
              return
            }

            // /stickers/add：把对话里的图存进表情目录
            const raw = typeof (body && body.data) === 'string' ? body.data : ''
            if (!raw) { json(res, 400, { ok: false, error: '没有图片数据' }); return }
            const buf = Buffer.from(raw.replace(/^data:[^,]*,/, ''), 'base64')
            if (buf.length < 16) { json(res, 400, { ok: false, error: '图太小' }); return }
            const ext = sniffExt(buf)
            if (!ext) { json(res, 415, { ok: false, error: '认不出图片格式' }); return }
            if (buf.length > 8 * 1024 * 1024) { json(res, 413, { ok: false, error: '图太大（限 8MB）' }); return }
            await fsp.mkdir(dir, { recursive: true })
            const safe = String(name || '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 24)
            const stem = safe ? safe.replace(/\.[^.]*$/, '') : `chat_${Date.now()}`
            const target = path.join(dir, `${stem}.${ext}`)
            await fsp.writeFile(target, buf)
            json(res, 200, { ok: true, name: path.basename(target), dir })
            return
          }

          if (rest === '/reveal') {
            if (!isLoopback(req)) {
              json(res, 403, { ok: false, error: 'local-only' })
              return
            }
            const dir = loadConfig().stickersDir
            try {
              await fsp.mkdir(dir, { recursive: true })
              const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open'
              execFile(opener, [dir], () => {})
              json(res, 200, { ok: true, dir })
            } catch (error) {
              json(res, 500, { ok: false, error: String(error && error.message) })
            }
            return
          }

          if (rest.startsWith('/img/')) {
            if (req.method !== 'GET' && req.method !== 'HEAD') {
              res.statusCode = 405
              res.end()
              return
            }
            let name = ''
            try {
              name = decodeURIComponent(rest.slice('/img/'.length))
            } catch {
              res.statusCode = 400
              res.end()
              return
            }
            // 只认目录里的文件名，不接受任何路径分隔符，防止越界读文件。
            if (!name || name.includes('/') || name.includes('\\') || name.startsWith('.')) {
              res.statusCode = 400
              res.end()
              return
            }
            const ext = path.extname(name).toLowerCase()
            if (!IMAGE_EXT.has(ext)) {
              res.statusCode = 403
              res.end()
              return
            }
            const file = path.join(config.stickersDir, name)
            if (path.dirname(path.resolve(file)) !== path.resolve(config.stickersDir)) {
              res.statusCode = 403
              res.end()
              return
            }
            let stat
            try {
              stat = await fsp.stat(file)
            } catch {
              res.statusCode = 404
              res.end()
              return
            }
            res.statusCode = 200
            res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream')
            res.setHeader('Content-Length', String(stat.size))
            res.setHeader('Cache-Control', 'no-store')
            if (req.method === 'HEAD') {
              res.end()
              return
            }
            fs.createReadStream(file).on('error', () => res.end()).pipe(res)
            return
          }

          res.statusCode = 404
          res.end()
        } catch (error) {
          log('路由出错:', error && error.message)
          try {
            json(res, 500, { ok: false, error: String(error && error.message) })
          } catch {}
        }
      },
    }), 'dsh-kuakua: http route')
  })
}
