import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import { writeManifest } from '../core/lib/manifest.mjs'
import { rawConfig, tempDir } from './helpers.mjs'

const script = new URL('../core/scripts/runtime.mjs', import.meta.url).pathname
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], { cwd, encoding: 'utf8', stdio: 'pipe' }).trim()
const sha = (text) => createHash('sha256').update(text).digest('hex')
const put = (dir, p, text, mode) => { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), text); if (mode) chmodSync(join(dir, p), mode) }
const URL_ = 'https://example.invalid/ticketflow.git'

const V1 = { 'core/scripts/guard.mjs': ['#!/usr/bin/env node\nguard 1\n', 0o755], 'core/lib/a.mjs': 'a 1\n', 'core/lib/gone.mjs': 'gone\n', 'core/templates/t.txt': 't 1\n' }
const V2 = { 'core/scripts/guard.mjs': ['#!/usr/bin/env node\nguard 2\n', 0o755], 'core/lib/a.mjs': 'a 1\n', 'core/lib/new.mjs': 'new\n', 'core/templates/t.txt': 't 1\n' }

/** (Re)writes a fake source clone: a git repo with VERSION, core/, skills/init, an origin and, unless `tag` is false, the tag v<version>. */
function source(dir, files, { version = '9.9.9', tag = true, remote = URL_, practices = {} } = {}) {
    for (const f of readdirSync(dir)) if (f !== '.git') rmSync(join(dir, f), { recursive: true, force: true })
    put(dir, 'VERSION', `${version}\n`); put(dir, 'skills/init/SKILL.md', 'init\n')
    for (const [p, v] of Object.entries(files)) put(dir, p, ...(Array.isArray(v) ? v : [v]))
    for (const [n, fs] of Object.entries(practices)) for (const [f, t] of Object.entries(fs)) put(dir, `practices/${n}/${f}`, t)
    if (!existsSync(join(dir, '.git'))) { git(dir, 'init', '-q', '-b', 'main'); git(dir, 'remote', 'add', 'origin', remote) }
    git(dir, 'add', '-A'); git(dir, 'commit', '-qm', `v${version}`)
    if (tag) git(dir, 'tag', `v${version}`)
    return dir
}
const newSource = (files = V1, opts) => source(tempDir('rt-src-'), files, opts)
function newTarget(over = {}) {
    const dir = tempDir('rt-tgt-')
    git(dir, 'init', '-q', '-b', 'main')
    put(dir, '.ticketflow/config.json', JSON.stringify(rawConfig(over)))
    return dir
}
const run = (src, tgt, ...args) => spawnSync(process.execPath, [script, src, tgt, ...args], { encoding: 'utf8' })
const read = (dir, p) => readFileSync(join(dir, p), 'utf8')
const manifest = (dir) => JSON.parse(read(dir, '.ticketflow/manifest.json'))
/** Every file under dir except .git: path to bytes. */
function snapshot(dir, rel = '', out = {}) {
    for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
        const p = rel ? `${rel}/${e.name}` : e.name
        if (p === '.git') continue
        if (e.isDirectory()) snapshot(dir, p, out); else out[p] = readFileSync(join(dir, p), 'utf8')
    }
    return out
}
const lines = (r) => r.stdout.split('\n').filter((l) => /^(write|remove|keep|conflict) /.test(l))

test('a fresh install copies core/ byte for byte, keeps the modes, writes the exact manifest and leaves config.json and custom/ alone', () => {
    const src = newSource(), tgt = newTarget()
    put(tgt, '.ticketflow/custom/x.md', 'mine\n')
    const config = read(tgt, '.ticketflow/config.json')
    const r = run(src, tgt)
    assert.equal(r.status, 0, r.stderr)
    for (const [p, v] of Object.entries(V1)) assert.equal(read(tgt, p.replace(/^core/, '.ticketflow')), [v].flat()[0], p)
    assert.ok(statSync(join(tgt, '.ticketflow/scripts/guard.mjs')).mode & 0o100, 'guard.mjs is executable')
    assert.equal(statSync(join(tgt, '.ticketflow/lib/a.mjs')).mode & 0o111, 0)
    assert.deepEqual(manifest(tgt), {
        manifest_version: 1, version: '9.9.9', held: [],
        source: { url: URL_, tag: 'v9.9.9', commit: git(src, 'rev-parse', 'HEAD') },
        files: Object.fromEntries(Object.entries(V1).map(([p, v]) => [p.replace(/^core/, '.ticketflow'), sha([v].flat()[0])]).sort(([a], [b]) => (a < b ? -1 : 1))),
    })
    assert.equal(read(tgt, '.ticketflow/config.json'), config); assert.equal(read(tgt, '.ticketflow/custom/x.md'), 'mine\n')
    assert.ok(!existsSync(join(tgt, '.ticketflow/core')))
})

test('a second run writes nothing and the manifest bytes do not change', () => {
    const src = newSource(), tgt = newTarget()
    assert.equal(run(src, tgt).status, 0)
    const before = snapshot(tgt)
    const r = run(src, tgt)
    assert.equal(r.status, 0, r.stderr); assert.deepEqual(lines(r), [])
    assert.deepEqual(snapshot(tgt), before)
})

test('an upgrade replaces a changed file, deletes a removed one, writes an added one and keeps the other manifest keys', () => {
    const dir = newSource(), tgt = newTarget()
    assert.equal(run(dir, tgt).status, 0)
    writeManifest(tgt, { claude_settings: { allow: ['Bash(x)'], ask: [] } })
    source(dir, V2, { version: '9.9.10' })
    const r = run(dir, tgt)
    assert.equal(r.status, 0, r.stderr)
    assert.deepEqual(lines(r), ['remove .ticketflow/lib/gone.mjs', 'write .ticketflow/lib/new.mjs', 'write .ticketflow/scripts/guard.mjs'])
    assert.equal(read(tgt, '.ticketflow/scripts/guard.mjs'), '#!/usr/bin/env node\nguard 2\n'); assert.ok(!existsSync(join(tgt, '.ticketflow/lib/gone.mjs')))
    const m = manifest(tgt)
    assert.equal(m.version, '9.9.10'); assert.equal(m.source.tag, 'v9.9.10'); assert.deepEqual(m.claude_settings, { allow: ['Bash(x)'], ask: [] })
    assert.deepEqual(Object.keys(m.files), ['.ticketflow/lib/a.mjs', '.ticketflow/lib/new.mjs', '.ticketflow/scripts/guard.mjs', '.ticketflow/templates/t.txt'])
})

test('a removed file takes its empty directories with it', () => {
    const dir = newSource({ ...V1, 'core/deep/er/f.txt': 'x\n' }), tgt = newTarget()
    assert.equal(run(dir, tgt).status, 0)
    source(dir, V1, { version: '9.9.10' })
    assert.equal(run(dir, tgt).status, 0)
    assert.ok(!existsSync(join(tgt, '.ticketflow/deep')) && existsSync(join(tgt, '.ticketflow/lib')))
})

test('a hand-edited file is a conflict (exit 1, the tree byte-identical); --keep leaves it and records it held; a kept file dropped from the source stays', () => {
    const dir = newSource(), tgt = newTarget()
    assert.equal(run(dir, tgt).status, 0)
    put(tgt, '.ticketflow/lib/a.mjs', 'my edit\n'); put(tgt, '.ticketflow/lib/gone.mjs', 'my edit of a file that goes away\n')
    source(dir, V2, { version: '9.9.10' })
    const before = snapshot(tgt)
    const r = run(dir, tgt)
    assert.equal(r.status, 1); assert.deepEqual(lines(r).filter((l) => l.startsWith('conflict')), ['conflict .ticketflow/lib/a.mjs', 'conflict .ticketflow/lib/gone.mjs'])
    assert.deepEqual(snapshot(tgt), before)
    source(dir, { ...V2, 'core/lib/a.mjs': 'a 2\n' }, { version: '9.9.11' })
    assert.equal(run(dir, tgt).status, 1); assert.deepEqual(snapshot(tgt), before)
    const kept = run(dir, tgt, '--keep', '.ticketflow/lib/a.mjs', '--keep', '.ticketflow/lib/gone.mjs')
    assert.equal(kept.status, 0, kept.stderr)
    assert.equal(read(tgt, '.ticketflow/lib/a.mjs'), 'my edit\n'); assert.equal(read(tgt, '.ticketflow/lib/gone.mjs'), 'my edit of a file that goes away\n')
    const m = manifest(tgt)
    assert.deepEqual(m.held, ['.ticketflow/lib/a.mjs', '.ticketflow/lib/gone.mjs'])
    assert.equal(m.files['.ticketflow/lib/a.mjs'], sha('a 1\n'), 'the hash of the kept file stays the installed one, so the edit is still seen')
    assert.equal(run(dir, tgt, '--keep', '.ticketflow/lib/a.mjs', '--keep', '.ticketflow/lib/gone.mjs').status, 0)
    assert.equal(run(dir, tgt).status, 1, 'without --keep the edits are conflicts again')
})

test('an edited file that was then deleted is written fresh; a CRLF-only change is not an edit', () => {
    const dir = newSource(), tgt = newTarget()
    assert.equal(run(dir, tgt).status, 0)
    rmSync(join(tgt, '.ticketflow/lib/a.mjs'))
    put(tgt, '.ticketflow/templates/t.txt', 't 1\r\n')
    source(dir, { ...V1, 'core/lib/a.mjs': 'a 2\n', 'core/templates/t.txt': 't 2\n' }, { version: '9.9.10' })
    const r = run(dir, tgt)
    assert.equal(r.status, 0, r.stderr)
    assert.equal(read(tgt, '.ticketflow/lib/a.mjs'), 'a 2\n'); assert.equal(read(tgt, '.ticketflow/templates/t.txt'), 't 2\n')
})

test('an untracked file in .ticketflow/ is a conflict; with no manifest, leftovers identical to the files to be written are a resumed install, different ones a conflict', () => {
    const dir = newSource(), tgt = newTarget()
    assert.equal(run(dir, tgt).status, 0)
    put(tgt, '.ticketflow/scripts/extra.mjs', 'x\n')
    const before = snapshot(tgt)
    const r = run(dir, tgt)
    assert.equal(r.status, 1); assert.deepEqual(lines(r), ['conflict .ticketflow/scripts/extra.mjs']); assert.deepEqual(snapshot(tgt), before)
    assert.equal(run(dir, tgt, '--keep', '.ticketflow/scripts/extra.mjs').status, 0)

    const t2 = newTarget()
    put(t2, '.ticketflow/lib/a.mjs', 'a 1\n')
    const resumed = run(dir, t2)
    assert.equal(resumed.status, 0, resumed.stderr); assert.ok(existsSync(join(t2, '.ticketflow/manifest.json')))
    const t3 = newTarget()
    put(t3, '.ticketflow/lib/a.mjs', 'other\n')
    const differs = run(dir, t3)
    assert.equal(differs.status, 1); assert.deepEqual(lines(differs).filter((l) => l.startsWith('conflict')), ['conflict .ticketflow/lib/a.mjs']); assert.ok(!existsSync(join(t3, '.ticketflow/manifest.json')))
})

test('practices: an enabled one is copied, a disabled one is removed, an unknown one exits 2', () => {
    const dir = newSource(V1, { practices: { i18n: { 'README.md': 'a\n', 'SKILL.md': 's\n' }, database: { 'README.md': 'b\n' } } })
    const tgt = newTarget({ practices: ['i18n'] })
    assert.equal(run(dir, tgt).status, 0)
    assert.equal(read(tgt, '.ticketflow/practices/i18n/SKILL.md'), 's\n'); assert.ok(!existsSync(join(tgt, '.ticketflow/practices/database')))
    assert.ok(Object.hasOwn(manifest(tgt).files, '.ticketflow/practices/i18n/README.md'))
    put(tgt, '.ticketflow/config.json', JSON.stringify(rawConfig({ practices: ['database'] })))
    const r = run(dir, tgt)
    assert.equal(r.status, 0, r.stderr)
    assert.ok(!existsSync(join(tgt, '.ticketflow/practices/i18n')) && read(tgt, '.ticketflow/practices/database/README.md') === 'b\n')
    put(tgt, '.ticketflow/config.json', JSON.stringify(rawConfig({ practices: ['nope'] })))
    const before = snapshot(tgt)
    assert.equal(run(dir, tgt).status, 2); assert.deepEqual(snapshot(tgt), before)
})

test('every exit-2 case writes nothing', () => {
    const cases = {
        'VERSION missing': (src) => rmSync(join(src, 'VERSION')),
        'core/custom present': (src) => put(src, 'core/custom/x.md', 'x'),
        'core/config.json present': (src) => put(src, 'core/config.json', '{}'),
        'a symlink in core': (src) => symlinkSync('/etc/hostname', join(src, 'core/link')),
        'skills/init missing': (src) => rmSync(join(src, 'skills/init'), { recursive: true }),
    }
    for (const [name, spoil] of Object.entries(cases)) {
        const src = newSource(), tgt = newTarget(), before = snapshot(tgt)
        spoil(src)
        const r = run(src, tgt)
        assert.equal(r.status, 2, `${name}: ${r.stderr}`); assert.deepEqual(snapshot(tgt), before, name)
    }
    const src = newSource()
    git(src, 'tag', 'v1.0.0'); git(src, 'tag', '-d', 'v9.9.9')   // the tag is not v<VERSION>
    const t1 = newTarget(), b1 = snapshot(t1)
    assert.match(run(src, t1).stderr, /expected v9\.9\.9/); assert.equal(run(src, t1).status, 2); assert.deepEqual(snapshot(t1), b1)

    const ok = newSource()
    const noCfg = tempDir('rt-tgt-'); git(noCfg, 'init', '-q', '-b', 'main')
    assert.equal(run(ok, noCfg).status, 2); assert.ok(!existsSync(join(noCfg, '.ticketflow')))
    const notRepo = tempDir('rt-norepo-'); put(notRepo, '.ticketflow/config.json', JSON.stringify(rawConfig()))
    assert.equal(run(ok, notRepo).status, 2); assert.ok(!existsSync(join(notRepo, '.ticketflow/lib')))
    const badManifest = newTarget(); put(badManifest, '.ticketflow/manifest.json', '{nope')
    assert.equal(run(ok, badManifest).status, 2); assert.ok(!existsSync(join(badManifest, '.ticketflow/lib')))
    const link = newTarget(); symlinkSync('/etc/hostname', join(link, '.ticketflow/lib-link'))
    assert.equal(run(ok, link).status, 2)
    const checkout = newTarget(); put(checkout, 'core/x', 'x'); put(checkout, 'skills/init/SKILL.md', 'x')
    const co = run(ok, checkout)
    assert.equal(co.status, 2); assert.match(co.stderr, /ticketflow checkout/); assert.ok(!existsSync(join(checkout, '.ticketflow/lib')))
    const sub = newTarget()
    assert.equal(run(ok, join(sub, '.ticketflow')).status, 2)
    for (const bad of ['../x', '/abs', 'a//b', '']) assert.equal(run(ok, newTarget(), '--keep', bad).status, 2, bad)
    assert.equal(run(ok).status, 2)
})

test('an untagged source records tag null and warns; a credential in the origin url is not recorded', () => {
    const src = newSource(V1, { tag: false, remote: 'https://user:secret@example.invalid/ticketflow.git' }), tgt = newTarget()
    const r = run(src, tgt)
    assert.equal(r.status, 0, r.stderr); assert.match(r.stderr, /warning: .*not at a release tag/)
    const m = manifest(tgt)
    assert.equal(m.source.tag, null); assert.equal(m.source.url, 'https://example.invalid/ticketflow.git')
    assert.doesNotMatch(read(tgt, '.ticketflow/manifest.json'), /secret/)
})

test('--dry-run prints the plan and writes nothing: exit 1 while something is pending, 0 when in sync', () => {
    const dir = newSource(), tgt = newTarget(), before = snapshot(tgt)
    const r = run(dir, tgt, '--dry-run')
    assert.equal(r.status, 1); assert.equal(lines(r).length, 4); assert.deepEqual(snapshot(tgt), before)
    assert.equal(run(dir, tgt).status, 0)
    assert.equal(run(dir, tgt, '--dry-run').status, 0)
    put(tgt, '.ticketflow/lib/a.mjs', 'edit\n')
    source(dir, V2, { version: '9.9.10' })
    assert.equal(run(dir, tgt, '--dry-run').status, 1)
    const edited = snapshot(tgt)
    const conflict = run(dir, tgt, '--dry-run')
    assert.equal(conflict.status, 1); assert.match(conflict.stdout, /^conflict \.ticketflow\/lib\/a\.mjs$/m); assert.match(conflict.stderr, /nothing was written/)
    assert.deepEqual(snapshot(tgt), edited)
})

test('a changed executable bit alone is rewritten; a directory where a file belongs is an error with nothing written; an ssh url keeps its user', () => {
    const dir = newSource(), tgt = newTarget()
    assert.equal(run(dir, tgt).status, 0)
    chmodSync(join(tgt, '.ticketflow/scripts/guard.mjs'), 0o644)
    const r = run(dir, tgt)
    assert.equal(r.status, 0, r.stderr); assert.deepEqual(lines(r), ['write .ticketflow/scripts/guard.mjs'])
    assert.ok(statSync(join(tgt, '.ticketflow/scripts/guard.mjs')).mode & 0o100)
    rmSync(join(tgt, '.ticketflow/lib/a.mjs')); rmSync(join(tgt, '.ticketflow/lib/gone.mjs')); rmSync(join(tgt, '.ticketflow/scripts/guard.mjs'))
    mkdirSync(join(tgt, '.ticketflow/scripts/guard.mjs'))
    const before = snapshot(tgt)
    const bad = run(dir, tgt)
    assert.equal(bad.status, 2); assert.match(bad.stderr, /not a regular file/); assert.deepEqual(snapshot(tgt), before); assert.ok(!existsSync(join(tgt, '.ticketflow/lib/a.mjs')))
    const ssh = newSource(V1, { remote: 'ssh://git:pw@example.invalid/o/ticketflow.git' }), t2 = newTarget()
    assert.equal(run(ssh, t2).status, 0)
    assert.equal(manifest(t2).source.url, 'ssh://git@example.invalid/o/ticketflow.git'); assert.doesNotMatch(read(t2, '.ticketflow/manifest.json'), /pw/)
})

test('--keep of a file outside the runtime is only recorded as held', () => {
    const dir = newSource(), tgt = newTarget()
    const r = run(dir, tgt, '--keep', '.github/workflows/ci.yml')
    assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /keep \.github\/workflows\/ci\.yml/)
    assert.deepEqual(manifest(tgt).held, ['.github/workflows/ci.yml'])
    assert.ok(!existsSync(join(tgt, '.github')))
})
