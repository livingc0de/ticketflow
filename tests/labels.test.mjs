import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fakeGh, tempDir, writeConfig } from './helpers.mjs'

const script = new URL('../core/scripts/labels.mjs', import.meta.url).pathname
const R = 'repos/o/r'
const WANTED = [{ name: 'Type: Bug', color: 'D73A4A', description: 'Broken' }, { name: 'Effort: S', color: 'bfdadc', description: '' }]
const live = (name, color, description = '', defaultValue) => ({ name, color, description, ...(defaultValue === undefined ? {} : { default: defaultValue }) })

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
const allIssues = (pages) => ({ [`${R}/issues?state=all&per_page=100`]: { __pages: pages } })
const repo = (has_discussions) => ({ [R]: { has_discussions } })

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
    assert.equal(run(['--prune', '--dry-run'], map).status, 1)   // a delete alone is still pending in a dry run
})

test('--prune-defaults deletes only unused, unmodified GitHub defaults and scans paginated issue/PR labels exactly', () => {
    const map = {
        ...labelsAt([[
            live('Type: Bug', 'd73a4a', 'Broken'), live('Effort: S', 'bfdadc'),
            live('bug', 'd73a4a', "Something isn't working", true),
            live('enhancement', 'a2eeef', 'New feature or request', true),
            live('question', 'd876e3', 'Further information is requested', true),
            live('documentation', '0075ca', 'Customized', true),
            live('Mine', 'ffffff', '', false),
            live('Good First Issue', '7057ff', 'Good for newcomers', true),
        ]]),
        ...repo(false),
        ...allIssues([
            [{ number: 1, state: 'open', labels: [{ name: 'enhancement' }] }],
            [{ number: 2, state: 'closed', labels: [{ name: 'question' }] }],
        ]),
        [`DELETE ${R}/labels/bug`]: null,
    }
    const r = run(['--prune-defaults'], map)
    assert.equal(r.status, 0, r.stderr)
    assert.deepEqual(r.writes, ['DELETE labels/bug'])
    assert.ok(r.calls.some((c) => c.includes(`${R}/issues?state=all&per_page=100`) && c.includes('--paginate') && c.includes('--slurp')))
    assert.ok(!r.calls.some((c) => c.join(' ').includes('issues?labels=')), 'default usage is not checked with one query per label')
    assert.match(r.stdout, /extra: bug \(unused\)/)
    assert.match(r.stdout, /extra: enhancement \(in use\)/)
    assert.match(r.stdout, /extra: documentation \(kept \(not an unmodified default\)\)/)
    assert.match(r.stdout, /extra: Mine \(kept \(not an unmodified default\)\)/)
    assert.match(r.stdout, /extra: Good First Issue \(kept \(not an unmodified default\)\)/)
})

test('--prune-defaults preserves configured defaults and never deletes when discussion usage is uncertain', () => {
    const labels = [live('bug', 'd73a4a', "Something isn't working", true), live('enhancement', 'a2eeef', 'New feature or request', true), live('Type: Bug', 'd73a4a', 'Broken'), live('Effort: S', 'bfdadc')]
    const configured = run(['--prune-defaults'], { ...labelsAt([labels]), ...repo(false), ...allIssues([[]]), [`DELETE ${R}/labels/enhancement`]: null }, [{ name: 'bug', color: 'd73a4a', description: "Something isn't working" }, ...WANTED])
    assert.equal(configured.status, 0, configured.stderr)
    assert.deepEqual(configured.writes, ['DELETE labels/enhancement'])

    for (const has_discussions of [true, undefined, 'false']) {
        const map = { ...labelsAt([[...labels]]), ...repo(has_discussions), [`POST ${R}/labels`]: {} }
        const r = run(['--prune-defaults'], map)
        assert.equal(r.status, 0, `${has_discussions}: ${r.stderr}`)
        assert.deepEqual(r.writes, [])
        assert.match(r.stdout, /default prune skipped:/)
        assert.ok(!r.calls.some((c) => c.includes(`${R}/issues?state=all&per_page=100`)))
    }
})

test('--prune-defaults preserves defaults with missing or malformed metadata', () => {
    const map = {
        ...labelsAt([[
            live('bug', 'd73a4a', "Something isn't working", 'true'),
            live('question', null, 'Further information is requested', true),
            live('Type: Bug', 'd73a4a', 'Broken'), live('Effort: S', 'bfdadc'),
        ]]),
    }
    const r = run(['--prune-defaults'], map)
    assert.equal(r.status, 0, r.stderr)
    assert.deepEqual(r.writes, [])
    assert.match(r.stdout, /extra: bug \(kept \(not an unmodified default\)\)/)
    assert.match(r.stdout, /extra: question \(kept \(not an unmodified default\)\)/)
})

test('--prune-defaults fails before writes when repository or issue usage reads fail or are malformed', () => {
    const labels = [live('bug', 'd73a4a', "Something isn't working", true), live('Type: Bug', 'd73a4a', 'Broken'), live('Effort: S', 'bfdadc')]
    for (const map of [
        { ...labelsAt([[labels]]), [R]: { __status: 500 }, },
        { ...labelsAt([[labels]]), ...repo(false), [`${R}/issues?state=all&per_page=100`]: { __status: 500 } },
        { ...labelsAt([[labels]]), ...repo(false), ...allIssues([[{ number: 1, labels: [{}] }]]) },
    ]) {
        const r = run(['--prune-defaults'], map)
        assert.equal(r.status, 2)
        assert.deepEqual(r.writes, [])
    }
})

test('--prune-defaults dry runs deletion, is idempotent after removal, and cannot be combined with --prune', () => {
    const before = { ...labelsAt([[live('bug', 'd73a4a', "Something isn't working", true), live('Type: Bug', 'd73a4a', 'Broken'), live('Effort: S', 'bfdadc')]]), ...repo(false), ...allIssues([[]]) }
    const dry = run(['--prune-defaults', '--dry-run'], before)
    assert.equal(dry.status, 1)
    assert.deepEqual(dry.writes, [])
    assert.match(dry.stdout, /would delete bug/)

    const after = { ...labelsAt([[live('Type: Bug', 'd73a4a', 'Broken'), live('Effort: S', 'bfdadc')]]) }
    assert.deepEqual(run(['--prune-defaults'], after).writes, [])
    const both = run(['--prune', '--prune-defaults'], {})
    assert.equal(both.status, 2)
    assert.deepEqual(both.calls, [])
})

test('--dry-run writes nothing and exits 1 while a create or update is pending, even with --prune', () => {
    const map = { ...labelsAt([[live('Type: Bug', 'ffffff', 'Broken'), live('Mine', 'ffffff'), live('old', 'ffffff')]]), ...issues('old', 0) }
    const r = run(['--dry-run', '--prune'], map, WANTED, { custom: [{ name: 'Mine', color: 'aaaaaa' }] })
    assert.equal(r.status, 1)
    assert.deepEqual(r.writes, [])
    assert.match(r.stdout, /would update Mine/); assert.match(r.stdout, /would create Effort: S/); assert.match(r.stdout, /would delete old/)
    assert.doesNotMatch(r.stdout, /would update Type: Bug/)
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

test('areas and environments become labels, created when missing and never updated; custom/labels.json is added; a duplicate name exits 2 with zero calls', () => {
    const map = { ...labelsAt([[live('Type: Bug', 'd73a4a', 'Broken'), live('Effort: S', 'bfdadc'), live('Area: Api', '000000', 'mine'), live('Environment: Production', '000000', 'mine')]]), [`POST ${R}/labels`]: {} }
    const r = run([], map, WANTED, { over: { areas: ['Api', 'Docs'], environments: ['Production', 'Staging'] }, custom: [{ name: 'Mine', color: 'ABCDEF', description: 'x' }] })
    assert.equal(r.status, 0, r.stderr)
    assert.deepEqual(r.writes, ['POST labels {"name":"Area: Docs","color":"c5def5","description":"Area of the product"}', 'POST labels {"name":"Environment: Staging","color":"c5def5","description":"Deployment environment"}', 'POST labels {"name":"Mine","color":"abcdef","description":"x"}'])
    for (const [custom, over] of [[[{ name: 'type: bug', color: 'ffffff' }], undefined], [[{ name: 'Area: api', color: 'ffffff' }], { areas: ['Api'] }], ['{', undefined], [[{ name: 'x', color: 'zz' }], undefined]]) {
        const bad = run([], {}, WANTED, { over, custom })
        assert.equal(bad.status, 2, JSON.stringify(custom)); assert.deepEqual(bad.calls, [])
    }
    assert.deepEqual(run(['--dry-run'], labelsAt([[live('Type: Bug', 'd73a4a', 'Broken'), live('Effort: S', 'bfdadc')]]), WANTED, { over: { areas: ['Api'] } }).writes, [])
    assert.equal(run(['--dry-run'], labelsAt([[live('Type: Bug', 'd73a4a', 'Broken'), live('Effort: S', 'bfdadc')]]), WANTED, { over: { areas: ['Api'] } }).status, 1)
})

test('a TicketFlow label the repo styled differently is listed as differs and kept; --restyle (the owner\'s choice) updates it', () => {
    const map = { ...labelsAt([[live('type: bug', '000000', 'Mine'), live('Effort: S', 'bfdadc')]]), [`PATCH ${R}/labels/type%3A%20bug`]: {} }
    const kept = run(['--dry-run'], map)
    assert.equal(kept.status, 0, kept.stderr)   // nothing pending: a difference is not drift
    assert.match(kept.stdout, /^differs: type: bug \(yours: #000000 "Mine"; TicketFlow: Type: Bug #d73a4a "Broken"\), kept$/m)
    const restyled = run(['--restyle'], map)
    assert.equal(restyled.status, 0, restyled.stderr)
    assert.deepEqual(restyled.writes, [`PATCH labels/type%3A%20bug {"new_name":"Type: Bug","color":"d73a4a","description":"Broken"}`])
    assert.equal(run(['--restyle', '--dry-run'], map).status, 1)
})
