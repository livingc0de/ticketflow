import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { runtimeFiles, hashFile, writeManifest } from '../core/lib/manifest.mjs'
import { fakeGh, rawConfig, tempDir } from './helpers.mjs'

const CORE = new URL('../core/', import.meta.url).pathname
const CHILDREN = ['gen-stubs', 'render', 'guard', 'labels', 'project', 'protect']
const GOOD_GH = { 'user': { __raw: 'HTTP/2.0 200 OK\r\nX-Oauth-Scopes: repo, project, workflow, read:org\r\nContent-Type: application/json\r\n\r\n{"login":"someone"}' } }
const which = (cmd) => execFileSync('which', [cmd], { encoding: 'utf8' }).trim()
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], { cwd, encoding: 'utf8', stdio: 'pipe' }).trim()
const put = (dir, p, text) => { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), text) }
function snapshot(dir, rel = '', out = {}) {
    for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
        const p = rel ? `${rel}/${e.name}` : e.name
        if (p === '.git') continue
        if (e.isDirectory()) snapshot(dir, p, out); else out[p] = readFileSync(join(dir, p), 'utf8')
    }
    return out
}

/**
 * A repo whose runtime (the real doctor and lib, stub child scripts that log their argv) is in `.ticketflow/`, or in `core/` with `repoMode`.
 * `gh`: the fixtures of the fake gh, or null for no gh on PATH. `timeout: false` leaves `timeout` off PATH.
 */
function setup({ cfg = {}, gh = GOOD_GH, timeout = true, repoMode = false, manifest = true, commit = true } = {}) {
    const dir = tempDir('doctor-'), logs = tempDir('doctor-logs-')
    const rt = repoMode ? 'core' : '.ticketflow'
    git(dir, 'init', '-q', '-b', 'main'); git(dir, 'remote', 'add', 'origin', 'https://github.com/o/r.git')
    cpSync(join(CORE, 'lib'), join(dir, rt, 'lib'), { recursive: true })
    cpSync(join(CORE, 'guard.json'), join(dir, rt, 'guard.json'))
    mkdirSync(join(dir, rt, 'scripts'), { recursive: true })
    copyFileSync(join(CORE, 'scripts/doctor.mjs'), join(dir, rt, 'scripts/doctor.mjs'))
    for (const n of CHILDREN) {
        put(dir, `${rt}/scripts/${n}.mjs`, `import { appendFileSync, existsSync, readFileSync } from 'node:fs'
const d = ${JSON.stringify(logs)}
appendFileSync(d + '/calls.log', JSON.stringify(['${n}', ...process.argv.slice(2)]) + '\\n')
for (const [ext, out] of [['out', process.stdout], ['err', process.stderr]]) if (existsSync(d + '/${n}.' + ext)) out.write(readFileSync(d + '/${n}.' + ext, 'utf8'))
process.exitCode = existsSync(d + '/${n}.exit') ? Number(readFileSync(d + '/${n}.exit', 'utf8')) : 0
`)
        chmodSync(join(dir, rt, 'scripts', `${n}.mjs`), 0o755)
    }
    put(dir, '.ticketflow/config.json', JSON.stringify(rawConfig(cfg)))
    put(dir, '.gitignore', '.claude/worktrees/\n')
    if (!repoMode && manifest) writeManifest(dir, { version: '1.0.0', files: Object.fromEntries(runtimeFiles(dir).map((p) => [p, hashFile(join(dir, p))])), held: [] })
    if (commit) { git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'x') }
    const g = fakeGh(logs, gh ?? {})
    const bin = join(logs, 'bin')
    if (gh === null) rmSync(join(bin, 'gh'))
    symlinkSync(which('git'), join(bin, 'git'))
    if (timeout) symlinkSync(which('timeout'), join(bin, 'timeout'))
    const env = { ...process.env, PATH: bin }
    const run = (...args) => {
        const r = spawnSync(process.execPath, [join(dir, rt, 'scripts/doctor.mjs'), ...args], { cwd: dir, encoding: 'utf8', env })
        return { ...r, out: r.stdout, lines: r.stdout.split('\n') }
    }
    const child = (n, code, { out = '', err = '' } = {}) => { writeFileSync(join(logs, `${n}.exit`), String(code)); writeFileSync(join(logs, `${n}.out`), out); writeFileSync(join(logs, `${n}.err`), err) }
    const calls = () => (existsSync(join(logs, 'calls.log')) ? readFileSync(join(logs, 'calls.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [])
    return { dir, rt, run, child, calls, ghCalls: () => g.calls(), put: (p, t) => put(dir, p, t) }
}
const has = (r, re) => assert.match(r.out, re)

test('everything fine: preflight, local and full all exit 0 and end with the summary', () => {
    const t = setup({ cfg: { project: { owner: 'o', number: 1 } } })
    for (const flag of [['--preflight'], ['--local'], []]) {
        const r = t.run(...flag)
        assert.equal(r.status, 0, `${flag}\n${r.out}${r.stderr}`)
        assert.equal(r.lines.filter(Boolean).at(-1), 'doctor: 0 failed, 0 warnings', flag.join())
    }
    has(t.run(), /^ok runtime: \d+ files match the manifest/m)
    assert.deepEqual(t.calls().filter(([n]) => n === 'gen-stubs').at(-1), ['gen-stubs', '.ticketflow', '.', '--check'])
    assert.deepEqual(t.calls().filter(([n]) => n === 'render').at(-1), ['render', '.ticketflow/templates', '.', '--check'])
    assert.deepEqual(t.calls().filter(([n]) => n === 'labels').at(-1), ['labels', 'sync', '.ticketflow/templates/labels.json', '--dry-run'])
    assert.deepEqual(t.calls().filter(([n]) => n === 'project').at(-1), ['project', 'setup', '--dry-run'])
    assert.deepEqual(t.calls().filter(([n]) => n === 'protect').at(-1), ['protect'])
})

test('preflight: an old gh, a missing scope, no scope header, no gh, no timeout, not a repo, a dirty tree', () => {
    let r = setup({ gh: { ...GOOD_GH, '--version': 'gh version 2.47.0 (2025-01-01)' } }).run('--preflight')
    assert.equal(r.status, 1); has(r, /^fail gh: 2\.47\.0 is older than 2\.48\.0/m)
    r = setup({ gh: { ...GOOD_GH, '--version': 'gh version 2.48.0 (2025-01-01)' } }).run('--preflight')
    assert.equal(r.status, 0, r.out)
    r = setup({ gh: { user: { __raw: 'HTTP/2.0 200 OK\r\nX-Oauth-Scopes: repo, workflow\r\n\r\n{}' } } }).run('--preflight')
    assert.equal(r.status, 1); has(r, /^fail gh-auth: missing scope project: run gh auth refresh -h github\.com -s project$/m)
    r = setup({ gh: { user: { __raw: 'HTTP/2.0 200 OK\r\nContent-Type: application/json\r\n\r\n{}' } } }).run('--preflight')
    assert.equal(r.status, 0); has(r, /^warn gh-auth: scopes unverifiable; Projects may need a classic token$/m); has(r, /1 warnings/)
    r = setup({ gh: { user: { __status: 401, __stderr: 'bad credentials' } } }).run('--preflight')
    assert.equal(r.status, 1); has(r, /^fail gh-auth: not logged in: run gh auth login$/m)
    r = setup({ gh: null }).run('--preflight')
    assert.equal(r.status, 1); has(r, /^fail gh: not on PATH/m)
    r = setup({ timeout: false }).run('--preflight')
    assert.equal(r.status, 0); has(r, /^warn timeout: not on PATH/m)
    const dirty = setup(); dirty.put('stray.txt', 'x')
    r = dirty.run('--preflight')
    assert.equal(r.status, 1); has(r, /^fail tree: the working tree is not clean/m)
    assert.equal(setup().run('--local').out.includes('tree:'), false, 'the tree check is preflight only')
    const bare = tempDir('doctor-bare-')
    const t = setup()
    r = spawnSync(process.execPath, [join(t.dir, '.ticketflow/scripts/doctor.mjs'), '--preflight'], { cwd: bare, encoding: 'utf8', env: { ...process.env, PATH: join(dirname(t.dir), 'x') + ':' + dirname(which('git')) + ':' + dirname(process.execPath) } })
    assert.equal(r.status, 1); assert.match(r.stdout, /^fail repo: not inside a git repository/m)
})

test('with gh absent or not logged in the GitHub checks are skipped', () => {
    const t = setup({ gh: null, cfg: { project: { owner: 'o', number: 1 } } })
    const r = t.run()
    assert.equal(r.status, 1)
    has(r, /^skip labels: gh is not usable$/m); has(r, /^skip project: gh is not usable$/m); has(r, /^skip protection: gh is not usable$/m)
    assert.ok(!t.calls().some(([n]) => ['labels', 'project', 'protect'].includes(n)))
})

test('config: missing or invalid fails and the dependent checks skip; repo different from origin fails', () => {
    const t = setup()
    rmSync(join(t.dir, '.ticketflow/config.json'))
    let r = t.run('--local')
    assert.equal(r.status, 1); has(r, /^fail config: .*cannot read config/m)
    for (const c of ['runtime', 'stubs', 'templates', 'guard', 'gitignore']) has(r, new RegExp(`^skip ${c}: no valid config$`, 'm'))
    assert.deepEqual(t.calls(), [])
    const other = setup({ cfg: { repo: 'o/else' } })
    r = other.run('--local')
    assert.equal(r.status, 1); has(r, /^fail config: repo is o\/else, origin is o\/r/m); has(r, /^skip stubs: no valid config$/m)
})

test('runtime: edited, missing and untracked files fail with their paths; CRLF is fine; held files warn and render gets --keep', () => {
    const t = setup()
    t.put('.ticketflow/scripts/render.mjs', readFileSync(join(t.dir, '.ticketflow/scripts/render.mjs'), 'utf8').replaceAll('\n', '\r\n'))
    assert.equal(t.run('--local').status, 0, 'a CRLF-only difference is not an edit')
    t.put('.ticketflow/lib/cli.mjs', readFileSync(join(t.dir, '.ticketflow/lib/cli.mjs'), 'utf8') + '// edit\n'); rmSync(join(t.dir, '.ticketflow/scripts/labels.mjs')); t.put('.ticketflow/scripts/extra.mjs', 'x\n')
    let r = t.run('--local')
    assert.equal(r.status, 1)
    has(r, /^fail runtime: edited: \.ticketflow\/lib\/cli\.mjs; missing: \.ticketflow\/scripts\/labels\.mjs; untracked: \.ticketflow\/scripts\/extra\.mjs;/m)
    writeManifest(t.dir, { held: ['.ticketflow/lib/cli.mjs', '.ticketflow/scripts/labels.mjs', '.ticketflow/scripts/extra.mjs', '.github/workflows/ci.yml', 'not/rendered.txt'] })
    r = t.run('--local')
    assert.equal(r.status, 0, r.out); has(r, /^warn runtime: ok, held \(kept on purpose\):/m)
    assert.deepEqual(t.calls().filter(([n]) => n === 'render').at(-1), ['render', '.ticketflow/templates', '.', '--check', '--keep', '.github/workflows/ci.yml'])
    const none = setup({ manifest: false })
    r = none.run('--local')
    assert.equal(r.status, 1); has(r, /^fail runtime: no \.ticketflow\/manifest\.json with files: run init/m)
    none.put('.ticketflow/manifest.json', '{"nope":1}')
    has(none.run('--local'), /^fail runtime: manifest: unknown key nope/m)
})

test('each child exit code is mapped: 0 ok, 1 fail with the next action, 2 fail; the output is indented and at most 20 lines', () => {
    const t = setup({ cfg: { project: { owner: 'o', number: 1 } } })
    const checks = { 'gen-stubs': 'stubs', render: 'templates', guard: 'guard', labels: 'labels', project: 'project', protect: 'protection' }
    for (const [child, check] of Object.entries(checks)) {
        t.child(child, 1, { out: Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n') })
        let r = t.run()
        assert.equal(r.status, 1, child); has(r, new RegExp(`^fail ${check}: `, 'm'))
        const shown = r.lines.filter((l) => /^ {4}line \d+$/.test(l))
        assert.equal(shown.length, 20, child); has(r, /^ {4}\.\.\. 10 more line\(s\)$/m)
        t.child(child, 2, { err: 'broken' })
        r = t.run()
        assert.equal(r.status, 1, child); has(r, new RegExp(`^fail ${check}: exit 2`, 'm')); has(r, /^ {4}broken$/m)
        t.child(child, 0)
        assert.equal(t.run().status, 0, child)
    }
})

test('project null spawns no project child; protect "upgrade to GitHub Pro" is a warning', () => {
    const t = setup()
    t.run()
    assert.ok(!t.calls().some(([n]) => n === 'project'))
    has(t.run(), /^skip project: the config has no project$/m)
    t.child('protect', 2, { err: 'protect: HTTP 403: Upgrade to GitHub Pro or make this repository public to enable this feature.' })
    const r = t.run()
    assert.equal(r.status, 0, r.out); has(r, /^warn protection: rulesets unavailable on this plan; merge\.mjs and the guard remain$/m)
})

test('--local makes no gh call and runs no GitHub check', () => {
    const t = setup({ cfg: { project: { owner: 'o', number: 1 } } })
    const r = t.run('--local')
    assert.equal(r.status, 0, r.out)
    assert.deepEqual(t.ghCalls(), [])
    assert.ok(!t.calls().some(([n]) => ['labels', 'project', 'protect'].includes(n)))
    assert.doesNotMatch(r.out, /labels:|protection:|gh/)
})

test('repo mode: runtime is skipped, gen-stubs is called with core . --check, render with core/templates, unmanaged files only warn', () => {
    const t = setup({ repoMode: true })
    t.child('render', 1, { out: 'conflict: AGENTS.md: the file exists and has no ticketflow markers\n' })
    const r = t.run('--local')
    assert.equal(r.status, 0, r.out)
    has(r, /^skip runtime: ticketflow repo: the runtime is core\/$/m); has(r, /^warn templates: files without ticketflow markers/m)
    assert.deepEqual(t.calls().filter(([n]) => n === 'gen-stubs').at(-1), ['gen-stubs', 'core', '.', '--check'])
    assert.deepEqual(t.calls().filter(([n]) => n === 'render').at(-1), ['render', 'core/templates', '.', '--check'])
    t.child('render', 1, { out: 'out of date: AGENTS.md\n' })
    assert.equal(t.run('--local').status, 1, 'drift in repo mode still fails')
})

test('doctor is read-only; usage errors exit 2', () => {
    const t = setup({ cfg: { project: { owner: 'o', number: 1 } } })
    const before = snapshot(t.dir)
    for (const flag of [['--preflight'], ['--local'], []]) t.run(...flag)
    assert.deepEqual(snapshot(t.dir), before)
    for (const bad of [['--preflight', '--local'], ['--nope'], ['extra']]) {
        const r = t.run(...bad)
        assert.equal(r.status, 2, bad.join()); assert.match(r.stderr, /usage: doctor/)
    }
    assert.equal(t.run('--local', '--config', join(t.dir, 'missing.json')).status, 1)
})

test('--config is passed to the children that take it, and a guard script without its executable bit fails', () => {
    const t = setup({ cfg: { project: { owner: 'o', number: 1 } } })
    const cfg = join(t.dir, 'other-config.json')
    writeFileSync(cfg, JSON.stringify(rawConfig({ project: { owner: 'o', number: 1 } })))
    assert.equal(t.run('--config', cfg).status, 0)
    for (const n of ['guard', 'labels', 'project', 'protect']) assert.deepEqual(t.calls().filter(([c]) => c === n).at(-1).slice(-2), ['--config', cfg], n)
    for (const n of ['gen-stubs', 'render']) assert.ok(!t.calls().filter(([c]) => c === n).at(-1).includes('--config'), n)
    chmodSync(join(t.dir, '.ticketflow/scripts/guard.mjs'), 0o644)
    const r = t.run('--local')
    assert.equal(r.status, 1); has(r, /^fail guard: scripts\/guard\.mjs is missing or not executable/m)
})

test('practices: a missing folder fails, live-verify without live_verify_skill warns', () => {
    const t = setup({ cfg: { practices: ['i18n'] } })
    const r = t.run('--local')
    assert.equal(r.status, 1); has(r, /^fail practices: i18n enabled in the config but not in \.ticketflow\/practices\/: run sync$/m)
    const w = setup({ cfg: { practices: ['live-verify'] } })
    w.put('.ticketflow/practices/live-verify/README.md', 'x\n')
    writeManifest(w.dir, { files: Object.fromEntries(runtimeFiles(w.dir).map((p) => [p, hashFile(join(w.dir, p))])) })
    const v = w.run('--local')
    assert.equal(v.status, 0, v.out); has(v, /^warn practices: live-verify is enabled but live_verify_skill is null/m)
})

test('ci-steps: verify.command in two steps of ci.yml warns, once is ok, no ci.yml skips', () => {
    const t = setup()
    has(t.run('--local'), /^skip ci-steps: no \.github\/workflows\/ci\.yml$/m)
    t.put('.github/workflows/ci.yml', 'jobs:\n  v:\n    steps:\n      - run: npm test\n')
    has(t.run('--local'), /^ok ci-steps: verify\.command appears once$/m)
    t.put('.github/workflows/ci.yml', 'jobs:\n  v:\n    steps:\n      - run: npm test\n      - name: Verify\n        run: |\n          npm test\n')
    const r = t.run('--local')
    assert.equal(r.status, 0, r.out); has(r, /^warn ci-steps: verify\.command appears 2 times in ci\.yml/m)
    const d = setup()
    mkdirSync(join(d.dir, '.github/workflows/ci.yml'), { recursive: true })   // unreadable: a directory
    const u = d.run('--local')
    has(u, /^warn ci-steps: cannot read \.github\/workflows\/ci\.yml: EISDIR$/m); has(u, /^doctor: 0 failed/m)
})
