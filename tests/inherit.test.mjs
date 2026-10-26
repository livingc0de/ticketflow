import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { description, inherit } from '../core/lib/inherit.mjs'
import { FAIL, config, fakeGh, seq as cliSeq, tempDir, writeConfig } from './helpers.mjs'

const script = new URL('../core/lib/inherit.mjs', import.meta.url).pathname
const sha = (c) => c.repeat(40)
const [R, M, H2, C, P] = [sha('1'), sha('2'), sha('3'), sha('4'), sha('5')]
const FULL = 'Local run on host1 (x86_64, Node 24.0.0)'
const status = (state, desc, context = 'CI / Gate') => ({ statuses: [{ context, state, description: desc }] })
const files = (...names) => names.map((filename) => (typeof filename === 'string' ? { filename } : filename))
const DOC = 'docs/a.md', CODE = 'apps/web/src/a.ts'
const OPTS = { docs_only: {
    docs: ['^(docs/|\\.vscode/|\\.github/ISSUE_TEMPLATE/|[^/]+\\.md$)'],
    code: ['^(docs/(schema/|scripts/|SETTINGS\\.md$))'],
} }
const cfg = config(OPTS)

// The fixture is a map from API path (without `repos/o/r/` and the query) to JSON or to a function (called per read, for a head that moves).
function fixture(over = {}) {
    return {
        'pulls/7': { base: { ref: 'main' }, head: { sha: H2 } },
        'git/ref/heads/main': { object: { sha: M } },
        [`commits/${H2}`]: { parents: [{ sha: R }, { sha: M }] },
        [`commits/${R}/status`]: status('success', FULL),
        [`compare/${R}...${H2}`]: { status: 'ahead', behind_by: 0, files: files(DOC) },
        [`compare/${R}...${M}`]: { ahead_by: 1, commits: [{ sha: C }] },
        [`commits/${C}`]: { files: files('docs/b.md') },
        [`compare/${M}...${H2}`]: { files: files(CODE) },
        ...over,
    }
}
const run = (over, c = cfg) => {
    const map = fixture(over)
    const api = (path) => {
        const key = path.replace('repos/o/r/', '').split('?')[0]
        if (!(key in map)) throw new Error(`no fixture: ${key}`)
        return typeof map[key] === 'function' ? map[key]() : map[key]
    }
    return inherit(api, c, 7, H2)
}
const yes = (over, c) => assert.deepEqual(run(over, c), { root: R })
const no = (over, why, c) => { const r = run(over, c); assert.equal(r.root, undefined); assert.match(r.no, why) }
const seq = (...values) => { let i = 0; return () => values[Math.min(i++, values.length - 1)] }
const INH = 'Inherited from 1111111: only docs merged from main'

test('one merge of a docs-only main commit into a green head inherits, with the exact description', () => {
    yes()
    assert.equal(description(cfg, R), INH)
})

test('a chain names the root, not the previous inherited head', () => {
    yes({
        [`commits/${H2}`]: { parents: [{ sha: P }, { sha: M }] },
        [`commits/${P}/status`]: status('success', INH),
        'commits/1111111': { sha: R },
    })
})

test('no full-run success to inherit: failure, pending, missing, docs-only, unknown, chain root not full', () => {
    for (const s of [status('failure', FULL), status('pending', 'Actions run #9'), { statuses: [] }, status('success', 'Actions run #9, docs only'),
        status('success', 'Docs only (host1)'), status('success', 'Local check on host1, docs only'), status('success', 'whatever'),
        status('success', FULL, 'other/context')]) no({ [`commits/${R}/status`]: s }, /no full-run/)
    const viaP = { [`commits/${H2}`]: { parents: [{ sha: P }, { sha: M }] }, [`commits/${P}/status`]: status('success', INH), 'commits/1111111': { sha: R } }
    for (const s of [status('failure', FULL), status('success', 'Actions run #9, docs only'), status('success', 'Local check on host1, docs only')]) no({ ...viaP, [`commits/${R}/status`]: s }, /no full-run/)
    no({ ...viaP, [`commits/${P}/status`]: status('success', 'Inherited from 1111111: something else') }, /no full-run/)
})

test('the root must be an ancestor and H2 one merge of the current main', () => {
    for (const since of [{ status: 'diverged', behind_by: 2, files: files(DOC) }, { status: 'ahead', behind_by: 2, files: files(DOC) }, { status: 'identical', behind_by: 0, files: [] }]) no({ [`compare/${R}...${H2}`]: since }, /not docs-only/)
    for (const parents of [[{ sha: R }], [{ sha: R }, { sha: M }, { sha: P }], [{ sha: R }, { sha: P }]]) no({ [`commits/${H2}`]: { parents } }, /not one merge/)
})

test('a code change since the green head is a normal run, a rename counts by both names', () => {
    no({ [`compare/${R}...${H2}`]: { status: 'ahead', behind_by: 0, files: files(DOC, CODE) } }, /not docs-only/)
    no({ [`compare/${R}...${H2}`]: { status: 'ahead', behind_by: 0, files: files({ filename: 'docs/x.md', previous_filename: 'apps/x.ts' }) } }, /not docs-only/)
})

test('code on main since the root is a normal run even when the net diff is docs-only (a reverted change)', () => {
    no({ [`commits/${C}`]: { files: files(CODE) } }, /main commit 4444444 is not docs-only/)
})

test('unknown and dot-leading paths are code, editor settings are docs', () => {
    for (const name of ['.npmrc', '.env.example', 'package-lock.json']) no({ [`compare/${R}...${H2}`]: { status: 'ahead', behind_by: 0, files: files(DOC, name) } }, /not docs-only/)
    yes({ [`compare/${R}...${H2}`]: { status: 'ahead', behind_by: 0, files: files('.vscode/settings.json') } })
})

test('empty and capped lists are a normal run', () => {
    const many = (n) => files(...Array.from({ length: n }, (_, i) => `docs/f${i}.md`))
    no({ [`compare/${R}...${H2}`]: { status: 'ahead', behind_by: 0, files: [] } }, /not docs-only/)
    yes({ [`compare/${R}...${H2}`]: { status: 'ahead', behind_by: 0, files: many(299) } })
    no({ [`compare/${R}...${H2}`]: { status: 'ahead', behind_by: 0, files: many(300) } }, /not docs-only/)
    no({ [`commits/${C}`]: { files: many(300) } }, /not docs-only/)
    no({ [`commits/${C}`]: { files: [] } }, /not docs-only/)
    no({ [`compare/${R}...${M}`]: { ahead_by: 21, commits: Array.from({ length: 21 }, () => ({ sha: C })) } }, /too many/)
    no({ [`compare/${R}...${M}`]: { ahead_by: 3, commits: [{ sha: C }] } }, /too many/)
    no({ [`compare/${M}...${H2}`]: { files: many(300) } }, /CI files/)
})

test('a pull request that changes CI files never inherits: the floor, plus the configured list', () => {
    for (const name of ['.github/workflows/ci.yml', '.ticketflow/config.json', 'core/lib/inherit.mjs']) no({ [`compare/${M}...${H2}`]: { files: files(name) } }, /CI files/)
    no({ [`compare/${M}...${H2}`]: { files: files({ filename: 'docs/x.md', previous_filename: '.github/workflows/ci.yml' }) } }, /CI files/)
    no({ [`compare/${M}...${H2}`]: { files: files({ filename: 'docs/x.md', previous_filename: '.ticketflow/x' }) } }, /CI files/)
    const plain = [`compare/${M}...${H2}`]
    yes({ [plain]: { files: files('scripts/ci/docs-only.mjs') } })   // not a CI file unless the config says so
    const extra = config({ ...OPTS, gate: { ci_files: ['^scripts/ci/'] } })
    no({ [plain]: { files: files('scripts/ci/docs-only.mjs') } }, /CI files/, extra)
    yes({}, extra)
})

test('a head or main that moved, or a base that is not main, is a normal run', () => {
    const moved = { base: { ref: 'main' }, head: { sha: sha('9') } }
    no({ 'pulls/7': seq(moved) }, /not the head/)
    // `pulls/7` and `git/ref/heads/main` are read twice: first and last
    no({ 'pulls/7': seq({ base: { ref: 'main' }, head: { sha: H2 } }, moved) }, /moved while reading/)
    no({ 'git/ref/heads/main': seq({ object: { sha: M } }, { object: { sha: sha('9') } }) }, /moved while reading/)
    no({ 'pulls/7': { base: { ref: 'develop' }, head: { sha: H2 } } }, /not the head of a pull request into main/)
})

test('another default branch: the base, the ref and the description follow the config', () => {
    const trunk = config({ ...OPTS, default_branch: 'trunk' })
    const t = { 'pulls/7': { base: { ref: 'trunk' }, head: { sha: H2 } }, 'git/ref/heads/trunk': { object: { sha: M } } }
    no({}, /not the head of a pull request into trunk/, trunk)   // base is main
    yes(t, trunk)
    assert.equal(description(trunk, R), 'Inherited from 1111111: only docs merged from trunk')
    no({ ...t, [`commits/${C}`]: { files: files(CODE) } }, /trunk commit 4444444 is not docs-only/, trunk)
})

test('a custom gate.context is the status that is read and the chain is matched against this branch', () => {
    const c = config({ ...OPTS, gate: { context: 'my/gate' } })
    no({}, /no full-run/, c)   // the fixture's status is CI / Gate
    yes({ [`commits/${R}/status`]: status('success', FULL, 'my/gate') }, c)
})

test('a chain whose description names another branch is not a full run', () => {
    const viaP = { [`commits/${H2}`]: { parents: [{ sha: P }, { sha: M }] }, 'commits/1111111': { sha: R } }
    no({ ...viaP, [`commits/${P}/status`]: status('success', 'Inherited from 1111111: only docs merged from trunk') }, /no full-run/)
    no({ ...viaP, [`commits/${P}/status`]: status('success', 'Inherited from 1111111: only docs merged from main!') }, /no full-run/)
})

test('a failed read throws, so nothing is inherited', () => {
    assert.throws(() => inherit(() => { throw new Error('gh: 502') }, cfg, 7, H2), /502/)
    assert.throws(() => run({ [`commits/${R}/status`]: undefined }), /./)
})

// The CLI through the fake `gh`.
function cli(map, args = ['7', H2], over = OPTS) {
    const dir = tempDir('inherit-')
    const gh = fakeGh(dir, Object.fromEntries(Object.entries(map).map(([k, v]) => [`repos/o/r/${k}`, v])))
    const result = spawnSync(process.execPath, [script, ...args, '--config', writeConfig(dir, over)], { encoding: 'utf8', env: gh.env })
    return { ...result, calls: gh.calls().map((c) => c.join(' ')) }
}

test('the CLI prints exactly one description line and only reads', () => {
    const r = cli(fixture())
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.stdout, `description=${description(cfg, R)}\n`)
    assert.ok(r.calls.length > 5 && r.calls.every((c) => /^api repos\/o\/r\/\S+$/.test(c)), r.calls.join('\n'))
    assert.ok(!r.calls.some((c) => /statuses|-X|--method|-f |-F |--input/.test(c)))
    assert.ok(r.calls.filter((c) => /\/status/.test(c)).every((c) => c.endsWith('/status?per_page=100')))
})

test('the CLI prints nothing on stdout for a normal run, a failed read, a config error and bad arguments', () => {
    const normal = cli(fixture({ [`commits/${C}`]: { files: files(CODE) } }))
    assert.equal(normal.status, 0)
    assert.equal(normal.stdout, '')
    assert.match(normal.stderr, /normal run: main commit 4444444/)
    const failing = cli(fixture({ [`compare/${R}...${H2}`]: FAIL }))
    assert.notEqual(failing.status, 0)
    assert.equal(failing.stdout, '')
    const badConfig = cli(fixture(), undefined, { bogus: 1 })
    assert.equal(badConfig.status, 2)
    assert.equal(badConfig.stdout, '')
    assert.deepEqual(badConfig.calls, [])
    for (const args of [[], ['7'], ['x', H2], ['7', 'main'], ['7', sha('a').toUpperCase()], ['7', H2, 'extra'], ['o/r', '7', H2]]) {
        const bad = cli(fixture(), args)
        assert.equal(bad.status, 2, args.join(' '))
        assert.equal(bad.stdout, '')
        assert.deepEqual(bad.calls, [])
    }
})

test('the CLI re-reads the pull request: a head that moves is a normal run', () => {
    const r = cli(fixture({ 'pulls/7': cliSeq({ base: { ref: 'main' }, head: { sha: H2 } }, { base: { ref: 'main' }, head: { sha: sha('9') } }) }))
    assert.equal(r.status, 0)
    assert.equal(r.stdout, '')
    assert.match(r.stderr, /moved while reading/)
})
