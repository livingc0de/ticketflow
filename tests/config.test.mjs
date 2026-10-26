import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { ConfigError, PRACTICES, SCHEMA_VERSION, configPath, loadConfig, migrate, validate } from '../core/lib/config.mjs'
import { BASE_CONFIG, rawConfig, tempDir, writeConfig } from './helpers.mjs'

const bad = (over, re) => assert.throws(() => validate(rawConfig(over)), (e) => e instanceof ConfigError && re.test(e.message), JSON.stringify(over))

test('a minimal config loads, with defaults applied and deeply frozen', () => {
    const dir = tempDir()
    const cfg = loadConfig(writeConfig(dir))
    assert.deepEqual(
        cfg,
        { schema_version: 1, repo: 'o/r', default_branch: 'main', verify: { mode: 'ci', install: '', command: 'npm test', timeout_min: 45 },
            gate: { context: 'CI / Gate', check: 'Verify', inherit: false, ci_files: [] }, docs_only: { docs: [], code: [] }, reviewers: [], deploy_branch: null, project: null, agents: [], models: {}, plans_dir: 'docs/plans', worktrees_dir: '.claude/worktrees', live_verify_skill: null, deferred_checks_issue: null, areas: [], practices: [], ci: { push_paths: null } })
    assert.ok(Object.isFrozen(cfg) && Object.isFrozen(cfg.verify) && Object.isFrozen(cfg.gate) && Object.isFrozen(cfg.gate.ci_files) && Object.isFrozen(cfg.reviewers))
    assert.throws(() => { 'use strict'; cfg.repo = 'x/y' }, TypeError)
})

test('a full config compiles its regexes and fills reviewer defaults', () => {
    const cfg = validate(rawConfig({
        gate: { ci_files: ['^scripts/'], inherit: true }, docs_only: { docs: ['\\.md$'], code: ['^x'] }, deploy_branch: 'deploy',
        reviewers: [{ name: 'bot', login: 'review-bot[bot]', rereview_comment: '@review-bot review', no_findings_reaction: '+1', unavailable_pattern: 'usage LIMIT', stale_after_min: 30 }, { name: 'b2', login: 'b2' }],
    }))
    assert.ok(cfg.gate.ci_files[0] instanceof RegExp && cfg.docs_only.docs[0].test('a.md'))
    assert.ok(cfg.reviewers[0].unavailable_pattern.test('Usage limit reached'))
    assert.deepEqual(cfg.reviewers[1], { name: 'b2', login: 'b2', rereview_comment: null, no_findings_reaction: null, unavailable_pattern: null, done_pattern: null, stale_after_min: null })
    assert.equal(cfg.deploy_branch, 'deploy')
})

test('a missing or unreadable file and bad JSON fail closed', () => {
    const dir = tempDir()
    assert.throws(() => loadConfig(join(dir, 'nope.json')), ConfigError)
    assert.throws(() => loadConfig(dir), ConfigError)   // a directory is unreadable
    writeFileSync(join(dir, 'bad.json'), '{')
    assert.throws(() => loadConfig(join(dir, 'bad.json')), /not valid JSON/)
    writeFileSync(join(dir, 'arr.json'), '[]')
    assert.throws(() => loadConfig(join(dir, 'arr.json')), ConfigError)
})

test('unknown keys, missing required keys and wrong types fail closed', () => {
    bad({ extra: 1 }, /unknown key extra/)
    for (const k of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) assert.throws(() => validate(JSON.parse(`{"${k}":{},"schema_version":1,"repo":"o/r","default_branch":"main","verify":{"mode":"ci","command":"x"}}`)), /unknown key/, k)
    bad({ verify: { constructor: 1 } }, /unknown key verify\.constructor/)
    bad({ verify: { extra: 1 } }, /unknown key verify\.extra/)
    bad({ gate: { extra: 1 } }, /unknown key gate\.extra/)
    bad({ reviewers: [{ name: 'a', login: 'a', extra: 1 }] }, /unknown key reviewers\[0\]\.extra/)
    for (const k of ['repo', 'default_branch', 'verify']) bad({ [k]: undefined }, new RegExp(`missing ${k}`))
    bad({ verify: { mode: undefined } }, /missing verify\.mode/)
    bad({ verify: { command: undefined } }, /missing verify\.command/)
    bad({ verify: { command: '' } }, /verify\.command/)
    bad({ verify: { mode: 'both' } }, /verify\.mode/)
    bad({ verify: { install: 3 } }, /verify\.install/)
    for (const t of [0, 361, 1.5, '45', null]) bad({ verify: { timeout_min: t } }, /timeout_min/)
    bad({ gate: { inherit: 'yes' } }, /gate\.inherit/)
    bad({ gate: { context: '' } }, /gate\.context/)
    bad({ gate: { ci_files: '^a' } }, /gate\.ci_files must be a list/)
    bad({ gate: { ci_files: [1] } }, /gate\.ci_files\[0\]/)
    bad({ docs_only: [] }, /docs_only must be an object/)
    bad({ reviewers: {} }, /reviewers must be a list/)
    bad({ reviewers: [{ name: 'a' }] }, /missing reviewers\[0\]\.login/)
    for (const login of ['a b', null, true, 42, ['bot']]) bad({ reviewers: [{ name: 'a', login }] }, /login/)
    bad({ reviewers: [{ name: 'a', login: 'a', stale_after_min: 0 }] }, /stale_after_min/)
    for (const r of ['o/r/x', 'o', '../..', 'o/..', 'o r/x', '', 5]) bad({ repo: r }, /repo/)
    for (const b of ['-x', 'a..b', 'a/', 'a b', 'x.lock', 'a.lock/b', 'a/.b', 'a.', 'HEAD', 'a/HEAD', '', 'a//b']) bad({ default_branch: b }, /default_branch/)
})

test('a bad regex fails closed, in each place a regex is accepted', () => {
    bad({ gate: { ci_files: ['('] } }, /gate\.ci_files\[0\] is not a valid regex/)
    bad({ docs_only: { docs: ['['] } }, /docs_only\.docs\[0\]/)
    bad({ docs_only: { code: ['*'] } }, /docs_only\.code\[0\]/)
    bad({ reviewers: [{ name: 'a', login: 'a', unavailable_pattern: '(' }] }, /unavailable_pattern/)
    bad({ reviewers: [{ name: 'a', login: 'a', done_pattern: '(' }] }, /done_pattern/)
    bad({ reviewers: [{ name: 'a', login: 'a', done_pattern: 'state (?<other>[0-9a-f]+)' }] }, /done_pattern must contain a named group \(\?<sha>/)
    assert.equal(validate(rawConfig({ reviewers: [{ name: 'a', login: 'a', done_pattern: 'state (?<sha>[0-9a-f]{7,40})' }] })).reviewers[0].done_pattern.exec('state abcdef1').groups.sha, 'abcdef1')
})

test('the schema version must equal the core: older says run sync, newer says core older than config', () => {
    assert.equal(SCHEMA_VERSION, 1)
    bad({ schema_version: 0 }, /older.*run sync/)
    bad({ schema_version: 2 }, /newer.*core older than config: sync/)
    bad({ schema_version: '1' }, /schema_version/)
    bad({ schema_version: undefined }, /missing schema_version/)
})

test('deploy_branch, gate.context and reaction have cross-field and enum checks', () => {
    bad({ deploy_branch: 'main' }, /deploy_branch must differ/)
    bad({ gate: { context: 'Verify' } }, /context must differ/)
    bad({ gate: { context: 'X', check: 'X' } }, /context must differ/)
    bad({ deploy_branch: 'a b' }, /deploy_branch/)
    bad({ reviewers: [{ name: 'a', login: 'a', no_findings_reaction: 'thumbsup' }] }, /no_findings_reaction/)
    for (const r of ['+1', '-1', 'laugh', 'confused', 'heart', 'hooray', 'rocket', 'eyes', null]) validate(rawConfig({ reviewers: [{ name: 'a', login: 'a', no_findings_reaction: r }] }))
})

test('migrate applies the steps in order and throws on a gap; loadConfig never migrates', () => {
    const steps = { 1: (c) => ({ ...c, a: 1 }), 2: (c) => ({ ...c, b: c.a + 1 }) }
    assert.deepEqual(migrate({ schema_version: 1 }, steps, 3), { schema_version: 3, a: 1, b: 2 })
    assert.deepEqual(migrate({ schema_version: 2, a: 5 }, steps, 3), { schema_version: 3, a: 5, b: 6 })
    assert.deepEqual(migrate({ schema_version: 3 }, steps, 3), { schema_version: 3 })
    assert.throws(() => migrate({ schema_version: 1 }, { 2: (c) => c }, 3), /no migration from schema_version 1/)
    assert.throws(() => migrate({ schema_version: 4 }, steps, 3), /newer/)
    assert.throws(() => migrate({ schema_version: 1 }, { 1: () => undefined }, 2), /did not return a config/)
    assert.throws(() => migrate({}, steps, 3), /integer/)
    assert.deepEqual(migrate({ ...BASE_CONFIG }), BASE_CONFIG)   // the real table is empty at schema 1
    const dir = tempDir()
    writeFileSync(join(dir, 'old.json'), JSON.stringify({ ...BASE_CONFIG, schema_version: 0 }))
    assert.throws(() => loadConfig(join(dir, 'old.json')), /run sync/)
})

test('configPath is .ticketflow/config.json in the git toplevel, from any subdirectory', () => {
    const dir = tempDir()
    spawnSync('git', ['init', '-q', dir])
    mkdirSync(join(dir, 'a', 'b'), { recursive: true })
    const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8' }).stdout.trim()
    assert.equal(configPath(join(dir, 'a', 'b')), join(top, '.ticketflow', 'config.json'))
    assert.throws(() => configPath(tempDir('nogit-')), ConfigError)
})

test('project: owner and number are required, title is required while the number is 0, views are a unique subset', () => {
    const ok = validate(rawConfig({ project: { owner: 'octo', number: 3 } }))
    assert.deepEqual(ok.project, { owner: 'octo', number: 3, title: null, views: [] })
    assert.deepEqual(validate(rawConfig({ project: { owner: 'octo', number: 0, title: 't', views: ['All Work', 'P0/P1 Open'] } })).project.views, ['All Work', 'P0/P1 Open'])
    bad({ project: { owner: 'octo', number: 0 } }, /project\.title is required/)
    bad({ project: { owner: 'octo' } }, /missing project\.number/)
    bad({ project: { number: 1 } }, /missing project\.owner/)
    bad({ project: { owner: 'octo', number: -1 } }, /project\.number must be an integer/)
    bad({ project: { owner: 'octo', number: 1, views: ['Roadmap'] } }, /project\.views\[0\] must be one of/)
    bad({ project: { owner: 'octo', number: 1, views: ['All Work', 'All Work'] } }, /duplicate/)
    bad({ project: { owner: 'octo', number: 1, extra: 1 } }, /unknown key project\.extra/)
})

test('agents are a unique list of known agents; each one needs a model per class (null inherits)', () => {
    const M = { strong: 'opus', standard: 'sonnet', light: null }
    const ok = validate(rawConfig({ agents: ['claude', 'codex'], models: { claude: M, codex: { strong: 'gpt-5.1-codex', standard: 'gpt-5:x[1m]', light: null } } }))
    assert.deepEqual(ok.models.claude, M)
    assert.deepEqual(validate(rawConfig({ agents: ['codex'], models: { codex: M } })).agents, ['codex'])
    bad({ agents: ['claude', 'claude'] }, /agents has a duplicate/)
    bad({ agents: ['gemini'] }, /agents\[0\] must be one of/)
    bad({ agents: ['claude'] }, /models\.claude is required/)
    bad({ agents: ['claude'], models: { codex: M } }, /models\.claude is required/)
    bad({ models: { gemini: M } }, /unknown key models\.gemini/)
    bad({ models: { claude: { strong: 'a', standard: 'b' } } }, /missing models\.claude\.light/)
    bad({ models: { claude: { ...M, extra: 'x' } } }, /unknown key models\.claude\.extra/)
    for (const m of ['', 'a b', 'a;b', 3, '$(x)']) bad({ models: { claude: { ...M, light: m } } }, /models\.claude\.light must be a model id/)
    bad({ models: [] }, /models must be an object/)
})

test('plans_dir and worktrees_dir are safe relative paths; live_verify_skill is a skill name; deferred_checks_issue a positive integer', () => {
    const ok = validate(rawConfig({ plans_dir: 'plans', worktrees_dir: 'tmp/wt.1', live_verify_skill: 'browser-check', deferred_checks_issue: 7 }))
    assert.deepEqual([ok.plans_dir, ok.worktrees_dir, ok.live_verify_skill, ok.deferred_checks_issue], ['plans', 'tmp/wt.1', 'browser-check', 7])
    for (const k of ['plans_dir', 'worktrees_dir']) for (const v of ['', '/abs', '../x', 'a/../b', 'a//b', 'a/', '.', 'a b', 'a\nb', 3, null]) bad({ [k]: v }, new RegExp(k))
    for (const v of ['', 'Live', 'a b', 3]) bad({ live_verify_skill: v }, /live_verify_skill/)
    for (const v of [0, -1, 1.5, '3']) bad({ deferred_checks_issue: v }, /deferred_checks_issue/)
})

test('areas are unique labels of at most 44 characters; ci.push_paths is null, [] or globs, and unfiltered while deploy_branch is set', () => {
    assert.deepEqual(validate(rawConfig({ areas: ['API & Data', 'Docs: "x"', 'a'.repeat(44)] })).areas.length, 3)
    for (const a of [[''], ['a'.repeat(45)], ['a,b'], ['a\nb'], ['{{x}}'], [3], ['a', 'a']]) bad({ areas: a }, /areas/)
    bad({ areas: 'x' }, /areas must be a list/)
    for (const v of [null, [], ['package-lock.json', 'src/**']]) assert.deepEqual(validate(rawConfig({ ci: { push_paths: v } })).ci.push_paths, v)
    for (const v of ['x', [''], [1], ['a\nb']]) bad({ ci: { push_paths: v } }, /ci\.push_paths/)
    bad({ ci: { extra: 1 } }, /unknown key ci\.extra/)
    bad({ deploy_branch: 'deploy', ci: { push_paths: ['x'] } }, /push_paths must be null or \[\]/)
    validate(rawConfig({ deploy_branch: 'deploy', ci: { push_paths: [] } }))
    validate(rawConfig({ deploy_branch: 'deploy' }))
})

test('values written into the CI workflow are refused when they could break out of their line or run an expression', () => {
    for (const v of ['CI / Gate\u0085env: {X: 1}', 'a\nb', 'a"b', '${{ secrets.X }}', 'a$b', 'a{b', 'a\u2028b', 'a`b']) { bad({ gate: { context: v } }, /gate\.context/); bad({ gate: { check: v } }, /gate\.check/) }
    validate(rawConfig({ gate: { context: 'CI / Gate (main) #1', check: 'Verify & Build' } }))
    for (const v of ['npm test\r      - name: x', 'a\u0085b', 'a\u2028b', 'a\u0007b', 'echo ${{ secrets.X }}']) { bad({ verify: { command: v } }, /verify\.command/); bad({ verify: { install: v } }, /verify\.install/) }
    validate(rawConfig({ verify: { command: 'npm ci\r\nnpm test\n\techo "a b" $HOME', install: 'a\tb' } }))
    bad({ areas: ['None'] }, /areas/)
})

test('ci.push_paths, areas and gate names refuse expressions, line breaks and padding', () => {
    for (const g of ['${{ github.token }}', 'a\u0085b', 'a b']) bad({ ci: { push_paths: [g] } }, /push_paths/)
    for (const a of [' x', 'x ', ' None ', 'none', ' ', 'a\u0085b']) bad({ areas: [a] }, /areas/)
    for (const g of [' Verify', 'Verify ', ' ']) bad({ gate: { check: g } }, /gate\.check/)
})

test('practices is a unique list of practice names, default []', () => {
    assert.deepEqual(validate(rawConfig({ practices: ['i18n', 'live-verify'] })).practices, ['i18n', 'live-verify'])
    for (const v of [[''], ['I18n'], ['a b'], ['../x'], [3], ['a', 'a']]) bad({ practices: v }, /practices/)
    bad({ practices: 'x' }, /practices must be a list/)
})

const cli = (...args) => spawnSync(process.execPath, [new URL('../core/lib/config.mjs', import.meta.url).pathname, ...args], { encoding: 'utf8' })

test('config.mjs validate: ok exits 0 and prints config valid; a bad key exits 2 naming the key', () => {
    const dir = tempDir()
    const ok = cli('validate', writeConfig(dir))
    assert.equal(ok.status, 0, ok.stderr); assert.equal(ok.stdout, 'config valid\n')
    const file = join(dir, 'bad.json')
    writeFileSync(file, JSON.stringify({ ...BASE_CONFIG, bogus_key: 1 }))
    const r = cli('validate', file)
    assert.equal(r.status, 2); assert.match(r.stderr, /bogus_key/)
    assert.equal(cli('validate', join(dir, 'missing.json')).status, 2)
    assert.equal(cli('validate').status, 2); assert.equal(cli('frob', file).status, 2); assert.equal(cli('validate', file, '--write').status, 2)
})

test('config.mjs migrate: a current config is left byte for byte; a gap or a newer schema exits 2 and writes nothing', () => {
    const dir = tempDir()
    const file = join(dir, 'config.json')
    const put = (obj) => writeFileSync(file, JSON.stringify(obj) + '\n')
    put(BASE_CONFIG)
    const before = readFileSync(file, 'utf8')
    for (const flags of [[], ['--write']]) {
        const r = cli('migrate', file, ...flags)
        assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /already at schema_version 1/)
        assert.equal(readFileSync(file, 'utf8'), before)
    }
    for (const version of [0, 2]) {
        put({ ...BASE_CONFIG, schema_version: version })
        const stale = readFileSync(file, 'utf8')
        const r = cli('migrate', file, '--write')
        assert.equal(r.status, 2, `schema_version ${version}`); assert.match(r.stderr, /schema_version/)
        assert.equal(readFileSync(file, 'utf8'), stale)
    }
    writeFileSync(file, '{nope')
    assert.equal(cli('migrate', file, '--write').status, 2)
})

test('the CLI also runs through a symlinked path (macOS temp directories are under /var, a symlink)', () => {
    const dir = tempDir()
    const link = join(dir, 'link')
    symlinkSync(new URL('../core/lib', import.meta.url).pathname, link)
    const bad = join(dir, 'bad.json')
    writeFileSync(bad, JSON.stringify({ ...BASE_CONFIG, bogus_key: 1 }))
    const r = spawnSync(process.execPath, [join(link, 'config.mjs'), 'validate', bad], { encoding: 'utf8' })
    assert.equal(r.status, 2); assert.match(r.stderr, /bogus_key/)
    assert.equal(spawnSync(process.execPath, [join(link, 'config.mjs'), 'validate', writeConfig(dir)], { encoding: 'utf8' }).stdout, 'config valid\n')
})

test('practices only accepts the shipped practice names', () => {
    assert.equal(PRACTICES.length, 10); assert.ok(Object.isFrozen(PRACTICES))
    assert.deepEqual(validate(rawConfig({ practices: [...PRACTICES] })).practices, [...PRACTICES])
    bad({ practices: ['nope'] }, /practices\[0\] must be one of live-verify/)
})
