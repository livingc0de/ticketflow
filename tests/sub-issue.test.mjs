import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fakeGh, tempDir, writeConfig } from './helpers.mjs'

const script = new URL('../core/scripts/sub-issue.mjs', import.meta.url).pathname
const R = 'repos/o/r'
const kids = (...numbers) => ({ [`${R}/issues/5/sub_issues`]: { __pages: [numbers.slice(0, 1).map((n) => ({ number: n, id: n * 1000 })), numbers.slice(1).map((n) => ({ number: n, id: n * 1000 }))] } })
function run(args, map) {
    const dir = tempDir('sub-')
    const gh = fakeGh(dir, { [`${R}/issues/9`]: { number: 9, id: 987654 }, ...map })
    const r = spawnSync(process.execPath, [script, ...args, '--config', writeConfig(dir)], { encoding: 'utf8', env: gh.env })
    const writes = gh.log().filter((c) => c.stdin).map((c) => ({ call: c.args.join(' '), body: JSON.parse(c.stdin) }))
    return { ...r, writes, calls: gh.calls() }
}

test('POSTs the REST id of the child, never its number and never replace_parent', () => {
    const r = run(['add', '5', '9'], { ...kids(1, 2), [`POST ${R}/issues/5/sub_issues`]: {} })
    assert.equal(r.status, 0, r.stderr)
    assert.deepEqual(r.writes, [{ call: `api -X POST ${R}/issues/5/sub_issues --input -`, body: { sub_issue_id: 987654 } }])
})

test('--after reorders with the REST id of the anchor; an existing child gets no POST but is still moved', () => {
    const fresh = run(['add', '5', '9', '--after', '2'], { ...kids(1, 2), [`POST ${R}/issues/5/sub_issues`]: {}, [`PATCH ${R}/issues/5/sub_issues/priority`]: {} })
    assert.equal(fresh.status, 0, fresh.stderr)
    assert.deepEqual(fresh.writes.map((w) => w.call.split(' ')[2]), ['POST', 'PATCH'])
    assert.deepEqual(fresh.writes[1].body, { sub_issue_id: 987654, after_id: 2000 })
    const kid = { number: 9, id: 987654 }
    const existing = run(['add', '5', '9', '--after', '1'], { [`${R}/issues/5/sub_issues`]: [{ number: 1, id: 1000 }, kid], [`PATCH ${R}/issues/5/sub_issues/priority`]: {} })
    assert.equal(existing.status, 0, existing.stderr)
    assert.deepEqual(existing.writes.map((w) => w.call.split(' ')[2]), ['PATCH'])
})

test('a child of another parent exits 1', () => {
    const r = run(['add', '5', '9'], { ...kids(1), [`POST ${R}/issues/5/sub_issues`]: { __status: 422, __stderr: 'Issue already has a parent' } })
    assert.equal(r.status, 1)
    assert.match(r.stderr, /another parent/)
})

test('--after with a non-child exits 1 with zero writes', () => {
    const r = run(['add', '5', '9', '--after', '3'], { ...kids(1, 2) })
    assert.equal(r.status, 1)
    assert.deepEqual(r.writes, [])
    assert.match(r.stderr, /#3 is not a sub-issue of #5/)
})

test('--after matches the anchor by repository too: the same number in another repo is not a child here', () => {
    const r = run(['add', '5', '9', '--after', '2'], { [`${R}/issues/5/sub_issues`]: [{ number: 2, id: 2000, repository_url: 'https://api.github.com/repos/other/repo' }] })
    assert.equal(r.status, 1); assert.deepEqual(r.writes, [])
})

test('non-digit or duplicate arguments exit 2 before any call', () => {
    for (const a of [['add', '5', '9;x'], ['add', 'x', '9'], ['add', '5'], ['rm', '5', '9'], ['add', '5', '5'], ['add', '5', '9', '--after', '9'], ['add', '5', '9', '--after', 'a b']]) {
        const r = run(a, {})
        assert.equal(r.status, 2, a.join(' ')); assert.deepEqual(r.calls, [])
    }
})
