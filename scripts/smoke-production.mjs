import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { setTimeout as delay } from 'node:timers/promises'
import { backupDatabase } from './backup-db.mjs'
import { restoreDatabase } from './restore-db.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const entry = join(root, 'dist', 'server', 'index.js')
assert.ok(existsSync(entry), '先运行 pnpm build，生产冒烟测试直接运行构建产物')
const dataRoot = mkdtempSync(join(tmpdir(), 'relaycheck-production-'))
const dbPath = join(dataRoot, 'relay-check.db')
const completedId = '1111111111111111'
const interruptedId = '2222222222222222'
const completedAnswer = '生产构建持久化验证，答案是 21。'
const packageInfo = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
let child = null
let output = ''

function seedDatabase() {
  const db = new DatabaseSync(dbPath)
  try {
    db.exec(readFileSync(join(root, 'migrations', '001_init.sql'), 'utf8'))
    const insert = db.prepare(`INSERT INTO tests (
      id, address_masked, key_masked, model, effort, api_type, test_mode,
      status, verdict, question, answer, created_at, finished_at, progress_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    for (const [id, status] of [[completedId, 'completed'], [interruptedId, 'running']]) {
      const completed = status === 'completed'
      insert.run(id, 'https://s****.invalid', 'sm****test', 'smoke-fixture', 'low', 'responses', 'quick',
        status, completed ? 'pass' : null, '固定冒烟题目', completed ? completedAnswer : null,
        Date.now(), completed ? Date.now() : null,
        JSON.stringify({ current: completed ? 1 : 0, completed: completed ? 1 : 0, total: 1, stage: completed ? 'completed' : 'testing' }))
      db.prepare(`INSERT INTO probes (id, test_id, ordinal, kind, prompt, status, answer)
        VALUES (?, ?, 0, 'quick', '固定冒烟题目', ?, ?)`).run(
        id, id, status, completed ? completedAnswer : '',
      )
    }
  } finally { db.close() }
}

async function availablePort() {
  const socket = createServer()
  socket.listen(0, '127.0.0.1')
  await once(socket, 'listening')
  const port = socket.address().port
  await new Promise((resolveClose, reject) => socket.close((error) => error ? reject(error) : resolveClose()))
  return port
}

async function start(directory = dataRoot) {
  const port = await availablePort()
  const base = `http://127.0.0.1:${port}`
  output = ''
  // IPC only delivers SIGTERM to Node's existing production shutdown handler.
  // This exercises graceful shutdown on Windows as well as Linux.
  child = spawn(process.execPath, ['--input-type=module', '--eval',
    "process.on('message', message => { if (message === 'shutdown') process.emit('SIGTERM', 'SIGTERM') }); await import(process.env.RELAYCHECK_SMOKE_ENTRY)"], {
    cwd: root,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: {
      ...process.env,
      RELAYCHECK_SMOKE_ENTRY: pathToFileURL(entry).href,
      NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port), DATA_DIR: directory,
      TRUST_PROXY: 'false', ALLOW_PRIVATE_UPSTREAMS: 'false', UPSTREAM_ALLOWLIST: '',
      ADMIN_TOKEN_HASH: '', DEFAULT_UPSTREAM_URL: '', APP_NAME: 'RelayCheck Production Smoke', APP_TAGLINE: '生产验证',
      MODEL_TIERS_FILE: join(root, 'config', 'model-tiers.json'),
      TEST_TIMEOUT_MS: '300000', MAX_ANSWER_BYTES: '2097152', MAX_ACTIVE_JOBS: '4', MAX_QUEUE: '20',
      UPSTREAM_MAX_CONCURRENCY: '8', CREATE_PER_IP_PER_HOUR: '30', ACTIVE_PER_IP: '2',
      LIST_PER_MINUTE: '120', SSE_MAX_PER_IP: '3', SSE_MAX_CONNECTIONS: '200',
      PUBLIC_LIST_ENABLED: 'true', RETENTION_DAYS: '30', MAX_RECORDS: '500',
    },
  })
  child.stdout.on('data', (chunk) => { output = (output + chunk).slice(-20_000) })
  child.stderr.on('data', (chunk) => { output = (output + chunk).slice(-20_000) })
  let spawnError = null
  child.on('error', (error) => { spawnError = error })
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`生产服务启动失败\n${output}`)
    try {
      const response = await fetch(`${base}/api/v1/health`, { signal: AbortSignal.timeout(500) })
      if (response.ok) return base
    } catch { /* Wait for the child listener. */ }
    await delay(100)
  }
  throw new Error(`生产服务启动超时\n${output}`)
}

async function stop() {
  if (!child) return
  const processToStop = child
  if (processToStop.exitCode !== null || processToStop.signalCode !== null) {
    child = null
    throw new Error(`生产服务意外退出\n${output}`)
  }
  const exited = once(processToStop, 'exit')
  processToStop.send('shutdown')
  let timer
  try {
    const [code, signal] = await Promise.race([
      exited,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('生产服务未在 5 秒内优雅关闭')), 5000) }),
    ])
    assert.equal(code, 0, `关闭退出码异常: ${code}, ${signal}\n${output}`)
    child = null
  } finally { clearTimeout(timer) }
}

async function json(base, path) {
  const response = await fetch(base + path, { signal: AbortSignal.timeout(5000) })
  assert.equal(response.status, 200, `${path} HTTP ${response.status}`)
  assert.match(response.headers.get('cache-control') || '', /no-store/)
  return response.json()
}

try {
  seedDatabase()
  let base = await start()
  const health = await json(base, '/api/v1/health')
  assert.equal(health.ok, true)
  assert.equal(health.version, packageInfo.version)
  const config = await json(base, '/api/v1/config')
  assert.equal(config.config.appName, 'RelayCheck Production Smoke')
  assert.equal(config.config.publicListEnabled, true)
  assert.equal(config.config.modes.length, 6)

  const page = await fetch(base, { signal: AbortSignal.timeout(5000) })
  assert.equal(page.status, 200)
  assert.match(page.headers.get('content-type') || '', /text\/html/)
  assert.match(page.headers.get('cache-control') || '', /no-cache/)
  assert.match(page.headers.get('content-security-policy') || '', /frame-ancestors 'none'/)
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff')
  const html = await page.text()
  const script = html.match(/<script[^>]+src="([^"]+)"/)
  assert.ok(script, '生产首页必须引用编译后的脚本')
  const asset = await fetch(new URL(script[1], base), { signal: AbortSignal.timeout(5000) })
  assert.equal(asset.status, 200)
  assert.match(asset.headers.get('cache-control') || '', /immutable/)
  assert.ok((await asset.text()).length > 100)
  const question = await fetch(base + config.config.questions.questionImage, { signal: AbortSignal.timeout(5000) })
  assert.equal(question.status, 200)
  assert.match(question.headers.get('content-type') || '', /image\/png/)
  await question.arrayBuffer()
  for (const path of ['/assets/definitely-missing.js', '/api/v1/missing', '/api/v1/admin/stats']) {
    const missing = await fetch(base + path, { signal: AbortSignal.timeout(5000) })
    assert.equal(missing.status, 404, path)
    await missing.arrayBuffer()
  }

  const record = (await json(base, `/api/v1/tests/${completedId}`)).test
  assert.equal(record.answer, completedAnswer)
  const summaries = await json(base, `/api/v1/tests/summaries?ids=${completedId}`)
  assert.equal(summaries.records.length, 1)
  assert.equal('answer' in summaries.records[0], false)
  assert.equal('probes' in summaries.records[0], false)
  const interrupted = (await json(base, `/api/v1/tests/${interruptedId}`)).test
  assert.equal(interrupted.status, 'failed')
  assert.equal(interrupted.progress.stage, 'failed')
  assert.equal(interrupted.probes[0].status, 'failed')
  const events = await fetch(`${base}/api/v1/tests/${completedId}/events`, { signal: AbortSignal.timeout(5000) })
  assert.equal(events.status, 200)
  assert.match(events.headers.get('content-type') || '', /text\/event-stream/)
  assert.match(events.headers.get('content-security-policy') || '', /frame-ancestors 'none'/)
  assert.match(await events.text(), new RegExp(completedId))

  const rejected = await fetch(`${base}/api/v1/tests`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(5000),
    body: JSON.stringify({ address: 'http://127.0.0.1', key: 'smoke-key-never-forwarded', apiType: 'responses', model: 'smoke', effort: 'low', testMode: 'quick' }),
  })
  assert.equal(rejected.status, 400, '生产构建必须拒绝私网目标')
  assert.equal((await rejected.json()).error.code, 'UPSTREAM_URL_REJECTED')

  // Back up while the production process has SQLite open, then restore into a
  // distinct directory. Neither operation touches the user's data directory.
  const backupPath = join(dataRoot, 'backups', 'smoke.db')
  await backupDatabase(dbPath, backupPath)
  await assert.rejects(backupDatabase(dbPath, backupPath), /已存在/)
  const restoredDirectory = join(dataRoot, 'restored')
  await restoreDatabase(backupPath, restoredDirectory)
  await assert.rejects(restoreDatabase(backupPath, restoredDirectory), /已有数据库/)
  await stop()

  base = await start()
  assert.equal((await json(base, `/api/v1/tests/${completedId}`)).test.answer, completedAnswer)
  await stop()
  base = await start(restoredDirectory)
  assert.equal((await json(base, `/api/v1/tests/${completedId}`)).test.answer, completedAnswer)
  assert.equal((await json(base, `/api/v1/tests/${interruptedId}`)).test.status, 'failed')
  await stop()
  console.log('生产冒烟测试通过：构建产物、静态资源、安全响应头、API、SSE、私网拒绝、重启恢复、在线备份及恢复。')
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit')
    child.kill('SIGKILL')
    await exited
  }
  rmSync(dataRoot, { recursive: true, force: true })
}
