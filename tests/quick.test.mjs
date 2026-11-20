import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ConfigError, validate } from '../core/lib/config.mjs'
import { fullRunReasons, quickTests, selectTests } from '../core/lib/quick.mjs'
import { QUICK_GATE, ciGate, localGate } from '../core/lib/verification.mjs'
import { config, fakeGh, rawConfig, tempDir } from './helpers.mjs'

const quickCfg = (over = {}) => config({ mode: 'quick', verify: { quick_command: 'node --test $TICKETFLOW_TESTS' }, docs_only: { docs: ['\\.md$'] }, ...over })
const tracked = ['src/cart.js', 'src/util/money.js', 'tests/cart.test.js', 'tests/money.test.js', 'tests/helpers.js', 'README.md', 'pkg/calc.go', 'pkg/calc_test.go', 'py/pricing.py', 'tests/test_pricing.py', 'web/a.ts', 'web/a.spec.ts']
const sel = (changed, t = tracked) => selectTests(changed, t, quickCfg())

test('verify.quick_command must run the selected tests ($TICKETFLOW_TESTS), is optional, and never blank', () => {
    assert.equal(config().verify.quick_command, null)
    assert.equal(quickCfg().verify.quick_command, 'node --test $TICKETFLOW_TESTS')
    for (const c of ['', '  ', 'npm test', 7]) assert.throws(() => validate(rawConfig({ verify: { quick_command: c } })), (e) => e instanceof ConfigError, String(c))
})

test('selectTests: a changed test is selected, a code file selects the tests that share its stem, docs are skipped', () => {
    assert.deepEqual(sel(['tests/cart.test.js']), { ok: true, tests: ['tests/cart.test.js'], unmatched: [], covers: {}, why: null })
    assert.deepEqual(sel(['src/cart.js', 'README.md']).tests, ['tests/cart.test.js'])
    assert.deepEqual(sel(['pkg/calc.go']).tests, ['pkg/calc_test.go'])
    assert.deepEqual(sel(['py/pricing.py']).tests, ['tests/test_pricing.py'])
    assert.deepEqual(sel(['web/a.ts']).tests, ['web/a.spec.ts'])
    assert.deepEqual(sel(['src/cart.js', 'src/util/money.js']).tests, ['tests/cart.test.js', 'tests/money.test.js'])
})

test('selectTests: anything undeterminable is not ok, so the full command runs', () => {
    assert.equal(sel(['tests/helpers.js', 'src/cart.js']).ok, false)   // a shared test helper can affect every test
    assert.match(sel(['tests/helpers.js']).why, /helper or fixture/)
    assert.equal(sel(['README.md']).ok, false)                          // nothing selected
    assert.equal(sel(['tests/gone.test.js']).ok, false)                 // a deleted test selects nothing
    assert.equal(sel(['src/cart.js'], []).ok, false)                    // nothing tracked
    const lone = sel(['src/cart.js', 'src/orphan.js'])
    assert.deepEqual([lone.ok, lone.unmatched], [true, ['src/orphan.js']])   // the gate runs the subset; the full run after the merge covers the orphan
    const many = Array.from({ length: 201 }, (_, i) => `t/a${i}.test.js`)
    assert.match(selectTests(many, many, quickCfg()).why, /more than 200/)
    assert.match(selectTests(['t/a b.test.js'], ['t/a b.test.js'], quickCfg()).why, /not shell-safe/)
    assert.match(selectTests(['t/$(x).test.js'], ['t/$(x).test.js'], quickCfg()).why, /not shell-safe/)
})

const pull = { title: 'Ticket #7', body: '' }
const reader = (labels) => (path) => (path.endsWith('/issues/7') ? { labels: labels.map((name) => ({ name })) } : (() => { throw new Error(path) })())
test('quickTests: only a quick flow with a quick_command and a determinable selection', () => {
    const c = quickCfg(), changed = ['src/cart.js']
    assert.deepEqual(quickTests(c, pull, 1, changed, tracked, reader([])).tests, ['tests/cart.test.js'])
    assert.equal(quickTests(c, pull, 1, changed, tracked, reader(['Tier: Critical'])), null)
    assert.equal(quickTests(c, pull, 1, changed, tracked, reader(['Flow: Advanced'])), null)
    assert.equal(quickTests(config({ mode: 'advanced', verify: { quick_command: 'x $TICKETFLOW_TESTS' } }), pull, 1, changed, tracked, reader([])), null)
    assert.ok(quickTests(config({ mode: 'advanced', verify: { quick_command: 'x $TICKETFLOW_TESTS' } }), pull, 1, changed, tracked, reader(['Flow: Quick'])))
    assert.equal(quickTests(quickCfg({ mode: 'off' }), pull, 1, changed, tracked, reader(['Flow: Quick'])), null)
    assert.equal(quickTests(config({ mode: 'quick' }), pull, 1, changed, tracked, reader([])), null)   // no quick_command
    assert.equal(quickTests(c, { title: 'no ticket', body: '' }, 1, changed, tracked, reader([])), null)
    assert.equal(quickTests(c, pull, 1, ['README.md'], tracked, reader([])), null)
})

const F = (filename, additions = 5, deletions = 0) => ({ filename, additions, deletions })
test('fullRunReasons: one case per trigger, and a clean small tested change needs none', () => {
    const c = quickCfg(), ok = sel(['src/cart.js', 'tests/cart.test.js'])
    const reasons = (files, labels = [], s = ok, cfg = c) => fullRunReasons(files, labels, cfg, s)
    assert.deepEqual(reasons([F('src/cart.js'), F('tests/cart.test.js')]), [])
    assert.match(reasons([F('src/cart.js')], ['Tier: High'])[0], /Tier: High/)
    assert.match(reasons([F('package-lock.json')]).join(), /always needs a review/)
    assert.match(reasons([F('db/migrations/001.sql')]).join(), /always needs a review/)
    assert.match(reasons([F('.github/workflows/ci.yml')]).join(), /always needs a review/)
    assert.match(reasons([F('vite.config.js')]).join(), /shared or verification file/)
    assert.match(reasons([F('tsconfig.json')]).join(), /shared or verification file/)
    assert.deepEqual(reasons([F('README.md')]), [])   // docs at the root are not shared config
    assert.match(reasons([F('src/cart.js', 200)]).join(), /changed code lines/)
    assert.match(reasons([F('src/cart.js')], [], { ok: false, tests: [], unmatched: [], why: 'no test selected' }).join(), /undeterminable/)
    assert.match(reasons([F('src/orphan.js')], [], sel(['src/cart.js', 'src/orphan.js'])).join(), /without a matching existing test: src\/orphan\.js/)
    assert.match(reasons([{ filename: 'x', additions: 'a' }])[0], /could not be read/)
    assert.match(reasons([F('src/cart.js')], [], ok, quickCfg({ gate: { ci_files: ['^build/'] } })).join(), /^$/)
    assert.match(reasons([F('build/x.js')], [], ok, quickCfg({ gate: { ci_files: ['^build/'] } })).join(), /shared or verification file build\/x\.js/)
})

test('gate descriptions: quick runs are recognized on both routes and never look like a full or inherited gate', () => {
    for (const d of ['Actions quick run #5', 'Local quick run on h (x)', 'Local fallback quick run on h (x)']) assert.ok(QUICK_GATE.test(d), d)
    for (const d of ['Actions run #5', 'Local run on h', 'Inherited from abc1234: docs']) assert.ok(!QUICK_GATE.test(d), d)
    assert.ok(ciGate('Actions quick run #5') && ciGate('Local fallback quick run on h') && !ciGate('Local quick run on h'))
    assert.ok(localGate('Local quick run on h') && !localGate('Actions quick run #5'))
})

// ---- the CLI
function cliRepo(files, fixtures, over) {
    const dir = tempDir('quick-')
    spawnSync('git', ['init', '-q'], { cwd: dir })
    for (const f of files) { mkdirSync(join(dir, f, '..'), { recursive: true }); writeFileSync(join(dir, f), 'x') }
    spawnSync('git', ['add', '.'], { cwd: dir })
    const gh = fakeGh(dir, fixtures)
    const cfgFile = join(dir, 'cfg.json')
    writeFileSync(cfgFile, JSON.stringify(rawConfig({ mode: 'quick', verify: { quick_command: 'echo "$TICKETFLOW_TESTS" > ran.txt; exit 3' }, ...over })))
    const quick = new URL('../core/lib/quick.mjs', import.meta.url).pathname
    return { dir, run: (args, input = '') => spawnSync(process.execPath, [quick, ...args, '--config', cfgFile], { cwd: dir, input, encoding: 'utf8', env: gh.env }) }
}
test('quick.mjs <PR> prints the selected tests; any error prints nothing and exits 2 (a full run)', () => {
    const fx = { 'repos/o/r/pulls/5': pull, 'repos/o/r/issues/7': { labels: [] } }
    const t = cliRepo(['src/cart.js', 'tests/cart.test.js'], fx)
    const r = t.run(['5'], 'src/cart.js\0')
    assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout.trim(), 'tests/cart.test.js')
    const none = t.run(['5'], 'README.md\0')
    assert.equal(none.status, 0); assert.equal(none.stdout, '')
    const bad = cliRepo(['src/cart.js'], { 'repos/o/r/pulls/5': { __status: 404, __stderr: 'nope' } }).run(['5'], 'src/cart.js\0')
    assert.equal(bad.status, 2); assert.equal(bad.stdout, '')
    assert.equal(t.run(['x']).status, 2)
})
test('quick.mjs --run runs verify.quick_command with $TICKETFLOW_TESTS and passes its exit code through', () => {
    const t = cliRepo(['a'], {})
    const r = spawnSync(process.execPath, [new URL('../core/lib/quick.mjs', import.meta.url).pathname, '--run', '--config', join(t.dir, 'cfg.json')], { cwd: t.dir, encoding: 'utf8', env: { ...process.env, TICKETFLOW_TESTS: 'a.test.js b.test.js' } })
    assert.equal(r.status, 3)
    assert.equal(spawnSync('cat', ['ran.txt'], { cwd: t.dir, encoding: 'utf8' }).stdout.trim(), 'a.test.js b.test.js')
    const unset = cliRepo(['a'], {}, { verify: { quick_command: null } })
    assert.equal(unset.run(['--run']).status, 2)
})

test('the flow is resolved per named ticket and the strictest wins: a second ticket cannot pick the quick flow', () => {
    const two = (labels7, labels8) => (path) => ({ labels: (path.endsWith('/issues/7') ? labels7 : labels8).map((name) => ({ name })) })
    const hidden = { title: 'Ticket #7', body: '<!-- Ticket #8 -->' }
    const adv = config({ mode: 'advanced', verify: { quick_command: 'x $TICKETFLOW_TESTS' } })
    assert.equal(quickTests(adv, hidden, 1, ['src/cart.js'], tracked, two([], ['Flow: Quick'])), null)
    assert.ok(quickTests(adv, hidden, 1, ['src/cart.js'], tracked, two(['Flow: Quick'], ['Flow: Quick'])))
    assert.equal(quickTests(quickCfg(), hidden, 1, ['src/cart.js'], tracked, two([], ['Tier: Critical'])), null)
})

test('fullRunReasons: a test the pull request adds next to its own code is not coverage; an old matching test is', () => {
    const c = quickCfg()
    const files = [{ filename: 'src/cart.js', additions: 5, deletions: 0, status: 'modified' }, { filename: 'tests/cart.test.js', additions: 3, deletions: 0, status: 'added' }]
    const s = selectTests(['src/cart.js', 'tests/cart.test.js'], tracked, c)
    assert.match(fullRunReasons(files, [], c, s).join(), /code without a matching existing test: src\/cart\.js/)
    const old = [files[0], { ...files[1], status: 'modified' }]
    assert.deepEqual(fullRunReasons(old, [], c, s), [])
})
