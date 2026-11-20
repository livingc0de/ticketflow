import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ConfigError, validate } from '../core/lib/config.mjs'
import { askPatterns, codexRules, hookDecision, loadGuard } from '../core/lib/guard.mjs'
import { renderStubs } from '../core/lib/stubs.mjs'
import { routeOfPull, verificationRoute } from '../core/lib/verification.mjs'
import { config, rawConfig, tempDir } from './helpers.mjs'

const mode = new URL('../core/scripts/mode.mjs', import.meta.url).pathname
const run = (...args) => spawnSync('node', [mode, ...args], { encoding: 'utf8' })
const repoWith = (over) => {
    const dir = tempDir('tf-mode-')
    mkdirSync(join(dir, '.ticketflow'))
    const file = join(dir, '.ticketflow', 'config.json')
    writeFileSync(file, JSON.stringify(rawConfig(over), null, 2) + '\n')
    return { dir, file }
}

test('mode defaults to advanced and accepts advanced, quick and off only', () => {
    assert.equal(config().mode, 'advanced')
    for (const m of ['advanced', 'quick', 'off']) assert.equal(config({ mode: m }).mode, m)
    for (const m of ['Off', 'fast', null, true, '']) assert.throws(() => validate(rawConfig({ mode: m })), (e) => e instanceof ConfigError && /mode must be one of/.test(e.message), String(m))
})

test('mode.mjs get prints the mode, set writes it validated and keeps every other key', () => {
    const { file } = repoWith({ mode: 'quick', areas: ['Docs'] })
    assert.equal(run('get', '--config', file).stdout.trim(), 'quick')
    assert.equal(run('--config', file).stdout.trim(), 'quick')
    const r = run('set', 'off', '--config', file)
    assert.equal(r.status, 0, r.stderr)
    const after = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(after.mode, 'off')
    assert.deepEqual(after.areas, ['Docs'])
    assert.equal(after.repo, 'o/r')
    assert.match(r.stdout, /merge the pull request/)
    assert.equal(run('get', '--config', file).stdout.trim(), 'off')
})

test('mode.mjs set renders the rendered files: off drops the Claude ask rules', () => {
    const { dir, file } = repoWith({ agents: ['claude'], models: { default: { strong: null, standard: null, light: null } } })
    assert.equal(run('set', 'advanced', '--config', file).status, 0)
    const asks = () => JSON.parse(readFileSync(join(dir, '.claude', 'settings.json'), 'utf8')).permissions.ask ?? []
    assert.ok(asks().some((a) => a.includes('gh pr merge')))
    assert.equal(run('set', 'off', '--config', file).status, 0)
    assert.deepEqual(asks().filter((a) => a.includes('gh pr merge')), [])
    assert.equal(run('set', 'quick', '--config', file).status, 0)
    assert.ok(asks().some((a) => a.includes('gh pr merge')))
})

test('mode.mjs refuses a bad value, extra arguments or a bad config and leaves the file untouched', () => {
    const { file } = repoWith({})
    const before = readFileSync(file, 'utf8')
    for (const args of [['set', 'fast'], ['set'], ['set', 'off', 'x'], ['frob']]) assert.equal(run(...args, '--config', file).status, 2, args.join(' '))
    assert.equal(readFileSync(file, 'utf8'), before)
    writeFileSync(file, '{"nope":1}')
    assert.equal(run('set', 'off', '--config', file).status, 2)
    assert.equal(readFileSync(file, 'utf8'), '{"nope":1}')
})

test('off selects the Actions route whatever verify.mode says', () => {
    const pull = { title: 'Ticket #1', body: '', changed_files: 1, head: { repo: { full_name: 'o/r' } }, base: { repo: { full_name: 'o/r' } } }
    for (const m of ['ci', 'tiered', 'local']) {
        const off = config({ mode: 'off', verify: { mode: m } })
        assert.deepEqual(verificationRoute(off, pull, [], [{ labels: [] }]), { route: 'ci', reason: 'mode off' })
        assert.deepEqual(routeOfPull(off, pull, 1, () => { throw new Error('no read') }), { route: 'ci', reason: 'mode off' })
    }
    assert.equal(routeOfPull(config({ verify: { mode: 'local' } }), pull, 1).route, 'local')
})

test('off: the guard hook passes every example, no ask rules are rendered, advanced and quick still guard', () => {
    const off = config({ mode: 'off' })
    const guard = loadGuard(off)
    const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } })
    for (const e of guard.forms.flatMap((f) => f.examples)) {
        assert.deepEqual(hookDecision(bash(e.cmd), off, { cwd: '/' }), { block: false }, e.cmd)
        for (const m of ['advanced', 'quick']) assert.equal(hookDecision(bash(e.cmd), config({ mode: m }), { cwd: '/' }).block, e.codex === 'block', `${m}: ${e.cmd}`)
    }
    assert.deepEqual(askPatterns(off), [])
    assert.doesNotMatch(codexRules(off), /prefix_rule/)
    assert.match(codexRules(config()), /prefix_rule/)
    assert.deepEqual(hookDecision(bash('gh pr merge 5 --admin'), { default_branch: 'main' }, { cwd: '/' }).ask, true)   // an unloadable config (no mode) stays strict
})

test('guard.mjs --self-test passes in every mode', () => {
    const guard = new URL('../core/scripts/guard.mjs', import.meta.url).pathname
    for (const m of ['advanced', 'quick', 'off']) {
        const { file } = repoWith({ mode: m })
        const r = spawnSync('node', [guard, '--self-test', '--config', file], { encoding: 'utf8' })
        assert.equal(r.status, 0, `${m}: ${r.stderr}`)
    }
})

test('every stub starts with the off line, in pointer, inline and TOML form', () => {
    const adapter = (name) => ({ name, ...JSON.parse(readFileSync(new URL(`../core/adapters/${name}.json`, import.meta.url), 'utf8')) })
    const skills = [{ name: 'implement-ticket', description: 'Use when x.', body: 'Body.\n', src: 'skills/implement-ticket/SKILL.md' }]
    const roles = [{ name: 'pr-reviewer', description: 'Use when y.', model_class: 'standard', effort: 'high', tools: 'read-only', body: 'Role.\n', src: 'agents/pr-reviewer.md' }]
    const cfg = config({ agents: ['claude', 'codex', 'gemini'], models: { default: { strong: null, standard: null, light: null } } })
    for (const runtimeRel of ['.ticketflow', 'core']) {
        const out = renderStubs({ skills, roles, adapters: ['claude', 'codex', 'gemini'].map(adapter), cfg, runtimeRel, version: '1.0.0' })
        assert.ok(out.size >= 3)
        for (const [path, text] of out) {
            if (!/\.(md|toml)$/.test(path)) continue
            const body = path.endsWith('.toml') ? JSON.parse(/developer_instructions = (.*)/.exec(text)[1]) : text.split('\n\n').slice(1).join('\n\n')
            assert.ok(body.startsWith('If `.ticketflow/config.json` has `"mode": "off"`'), `${path}: ${body.slice(0, 80)}`)
        }
    }
})

test('the local-mode workflow skips Actions only while the mode is not off', () => {
    const { dir, file } = repoWith({ verify: { mode: 'local' } })
    assert.equal(run('set', 'advanced', '--config', file).status, 0)
    const ci = readFileSync(join(dir, '.github', 'workflows', 'ci.yml'), 'utf8')
    assert.ok(ci.includes('git show HEAD^1:.ticketflow/config.json 2>/dev/null | node .ticketflow/scripts/mode.mjs get --config /dev/stdin 2>/dev/null)" != off ]'), 'the scope step reads the base config')
})

test('no allow rule lets an agent run mode.mjs set without a prompt', () => {
    const t = JSON.parse(readFileSync(new URL('../core/templates/claude-settings.json', import.meta.url), 'utf8'))
    const re = (p) => new RegExp(`^${p.replace(/^Bash\(|\)$/g, '').split('*').map((s) => s.replace(/[.+?^${}()|[\]\\/]/g, '\\$&')).join('.*')}$`)
    for (const rule of t.permissions.allow) assert.ok(!re(rule).test('node {{runtime}}/scripts/mode.mjs set off'), rule)
})

test('mode.mjs set: a render conflict exits 1 with the new mode written; a config outside <repo>/.ticketflow exits 2', () => {
    const { dir, file } = repoWith({})
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
    writeFileSync(join(dir, '.github', 'workflows', 'ci.yml'), 'name: mine\n')   // a file without markers is a render conflict
    const r = run('set', 'quick', '--config', file)
    assert.equal(r.status, 1, r.stderr + r.stdout)
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).mode, 'quick')
    const stray = join(dir, 'x.json')
    writeFileSync(stray, readFileSync(file))
    assert.equal(run('set', 'off', '--config', stray).status, 2)
    assert.equal(JSON.parse(readFileSync(stray, 'utf8')).mode, 'quick')
})

test('the CI scope reads the mode of the pull request base (HEAD^1), not of the test merge commit', () => {
    const dir = tempDir('tf-scope-')
    const git = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...a], { cwd: dir, encoding: 'utf8' })
    git('init', '-q'); mkdirSync(join(dir, '.ticketflow'))
    const put = (m) => writeFileSync(join(dir, '.ticketflow', 'config.json'), JSON.stringify(rawConfig({ mode: m })))
    put('off'); git('add', '.'); git('commit', '-q', '-m', 'base')
    put('advanced'); git('commit', '-qam', 'head')   // HEAD = the switch, HEAD^1 = the base that is still off
    const snippet = `git show HEAD^1:.ticketflow/config.json 2>/dev/null | node ${mode} get --config /dev/stdin 2>/dev/null`
    assert.equal(spawnSync('bash', ['-c', snippet], { cwd: dir, encoding: 'utf8' }).stdout.trim(), 'off')
})
