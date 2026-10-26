import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { ConfigError, SCHEMA_VERSION, configPath, loadConfig, migrate, validate } from '../core/lib/config.mjs'
import { BASE_CONFIG, rawConfig, tempDir, writeConfig } from './helpers.mjs'

const bad = (over, re) => assert.throws(() => validate(rawConfig(over)), (e) => e instanceof ConfigError && re.test(e.message), JSON.stringify(over))

test('a minimal config loads, with defaults applied and deeply frozen', () => {
    const dir = tempDir()
    const cfg = loadConfig(writeConfig(dir))
    assert.deepEqual(
        cfg,
        { schema_version: 1, repo: 'o/r', default_branch: 'main', verify: { mode: 'ci', install: '', command: 'npm test', timeout_min: 45 },
            gate: { context: 'ci/gate', check: 'Verify', inherit: false, ci_files: [] }, docs_only: { docs: [], code: [] }, reviewers: [], deploy_branch: null })
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
    assert.deepEqual(cfg.reviewers[1], { name: 'b2', login: 'b2', rereview_comment: null, no_findings_reaction: null, unavailable_pattern: null, stale_after_min: null })
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
