import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fakeGh, tempDir, writeConfig } from './helpers.mjs'

const script = new URL('../core/scripts/labels.mjs', import.meta.url).pathname
const R = 'repos/o/r'
const WANTED = [{ name: 'Type: Bug', color: 'D73A4A', description: 'Broken' }, { name: 'Effort: S', color: 'bfdadc', description: '' }]
const live = (name, color, description = '') => ({ name, color, description })

function run(args, map, wanted = WANTED, { over, custom } = {}) {
    const dir = tempDir('labels-')
    if (custom !== undefined) { mkdirSync(join(dir, 'custom')); writeFileSync(join(dir, 'custom', 'labels.json'), typeof custom === 'string' ? custom : JSON.stringify(custom)) }
    const file = join(dir, 'labels.json')
    writeFileSync(file, typeof wanted === 'string' ? wanted : JSON.stringify(wanted))
    const gh = fakeGh(dir, map)
    const r = spawnSync(process.execPath, [script, 'sync', file, ...args, '--config', writeConfig(dir, over)], { encoding: 'utf8', env: gh.env })
    const writes = gh.log().filter((c) => /-X (POST|PATCH|DELETE)/.test(c.args.join(' '))).map((c) => `${c.args[2]} ${c.args[3].replace(`${R}/`, '')}${c.stdin ? ` ${c.stdin}` : ''}`)
    return { ...r, writes, calls: gh.calls() }
}
const labelsAt = (pages) => ({ [`${R}/labels?per_page=100`]: { __pages: pages } })
const issues = (name, n) => ({ [`${R}/issues?labels=${encodeURIComponent(name)}&state=all&per_page=1`]: Array.from({ length: n }, () => ({ number: 1 })) })

test('creates the missing label and never changes a core label the repo has; a custom label is kept in line; a second run writes nothing', () => {
    const first = run([], { ...labelsAt([[live('type: bug', '000000', 'Mine'), live('mine', '000000')]]), [`POST ${R}/labels`]: {}, [`PATCH ${R}/labels/mine`]: {} }, WANTED, { custom: [{ name: 'Mine', color: 'aaaaaa', description: 'Ours' }] })
    assert.equal(first.status, 0, first.stderr)
    assert.deepEqual(first.writes, [
        `POST labels {"name":"Effort: S","color":"bfdadc","description":""}`,
        `PATCH labels/mine {"new_name":"Mine","color":"aaaaaa","description":"Ours"}`,
    ])
    const synced = run([], labelsAt([[live('Type: Bug', 'D73A4A', 'Broken'), live('Effort: S', 'bfdadc', null)]]))   // the state after the first run
    assert.deepEqual(synced.writes, [])
})

test('--prune deletes only unused extras; a label in use and a label with a comma are never deleted', () => {
    const map = {
        ...labelsAt([[live('Type: Bug', 'd73a4a', 'Broken'), live('Effort: S', 'bfdadc')], [live('old', 'ffffff'), live('busy', 'ffffff'), live('a,b', 'ffffff')]]),
        ...issues('old', 0), ...issues('busy', 2), [`DELETE ${R}/labels/old`]: null,
    }
    const r = run(['--prune'], map)
    assert.equal(r.status, 0, r.stderr)
    assert.deepEqual(r.writes, ['DELETE labels/old'])
    assert.match(r.stdout, /extra: busy \(in use\)/); assert.match(r.stdout, /extra: a,b \(in use\)/); assert.match(r.stdout, /extra: old \(unused\)/)
    assert.ok(!r.calls.some((c) => c.join(' ').includes('a%2Cb')), 'no usage query for a comma name')
    assert.deepEqual(run([], map).writes, [])   // without --prune nothing is deleted
})

test('--dry-run writes nothing and exits 1 while a create or update is pending, even with --prune', () => {
    const map = { ...labelsAt([[live('Type: Bug', 'ffffff', 'Broken'), live('Mine', 'ffffff'), live('old', 'ffffff')]]), ...issues('old', 0) }
    const r = run(['--dry-run', '--prune'], map, WANTED, { custom: [{ name: 'Mine', color: 'aaaaaa' }] })
    assert.equal(r.status, 1)
    assert.deepEqual(r.writes, [])
    assert.match(r.stdout, /would update Mine/); assert.match(r.stdout, /would create Effort: S/); assert.match(r.stdout, /would delete old/)
    assert.doesNotMatch(r.stdout, /Type: Bug/)
    assert.equal(run(['--dry-run'], labelsAt([[live('Type: Bug', 'd73a4a', 'Broken'), live('Effort: S', 'bfdadc')]])).status, 0)
})

test('an invalid file exits 2 with zero calls', () => {
    const bad = [
        '{}', '[', '[{"name":"","color":"ffffff"}]', `[{"name":"${'x'.repeat(51)}","color":"ffffff"}]`, '[{"name":"a","color":"fff"}]',
        '[{"name":"a","color":"gggggg"}]', `[{"name":"a","color":"ffffff","description":"${'d'.repeat(101)}"}]`,
        '[{"name":"a","color":"ffffff"},{"name":"A","color":"ffffff"}]',
    ]
    for (const file of bad) {
        const r = run([], {}, file)
        assert.equal(r.status, 2, file); assert.deepEqual(r.calls, [], file)
    }
})

test('the shipped core/templates/labels.json is valid', () => {
    const r = run([], { ...labelsAt([[]]), [`POST ${R}/labels`]: {} }, readFileSync(new URL('../core/templates/labels.json', import.meta.url), 'utf8'))
    assert.equal(r.status, 0, r.stderr)
})

test('areas become Area: labels, created when missing and never updated; custom/labels.json is added; a duplicate name exits 2 with zero calls', () => {
    const map = { ...labelsAt([[live('Type: Bug', 'd73a4a', 'Broken'), live('Effort: S', 'bfdadc'), live('Area: Api', '000000', 'mine')]]), [`POST ${R}/labels`]: {} }
    const r = run([], map, WANTED, { over: { areas: ['Api', 'Docs'] }, custom: [{ name: 'Mine', color: 'ABCDEF', description: 'x' }] })
    assert.equal(r.status, 0, r.stderr)
    assert.deepEqual(r.writes, ['POST labels {"name":"Area: Docs","color":"c5def5","description":"Area of the product"}', 'POST labels {"name":"Mine","color":"abcdef","description":"x"}'])
    for (const [custom, over] of [[[{ name: 'type: bug', color: 'ffffff' }], undefined], [[{ name: 'Area: api', color: 'ffffff' }], { areas: ['Api'] }], ['{', undefined], [[{ name: 'x', color: 'zz' }], undefined]]) {
        const bad = run([], {}, WANTED, { over, custom })
        assert.equal(bad.status, 2, JSON.stringify(custom)); assert.deepEqual(bad.calls, [])
    }
    assert.deepEqual(run(['--dry-run'], labelsAt([[live('Type: Bug', 'd73a4a', 'Broken'), live('Effort: S', 'bfdadc')]]), WANTED, { over: { areas: ['Api'] } }).writes, [])
    assert.equal(run(['--dry-run'], labelsAt([[live('Type: Bug', 'd73a4a', 'Broken'), live('Effort: S', 'bfdadc')]]), WANTED, { over: { areas: ['Api'] } }).status, 1)
})
