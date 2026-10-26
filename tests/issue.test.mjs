import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fakeGh, tempDir, writeConfig } from './helpers.mjs'

const script = new URL('../core/scripts/issue.mjs', import.meta.url).pathname
const R = 'repos/o/r'
const run = (args, map) => {
    const dir = tempDir('issue-')
    const gh = fakeGh(dir, map)
    const r = spawnSync(process.execPath, [script, ...args, '--config', writeConfig(dir)], { encoding: 'utf8', env: gh.env })
    return { ...r, calls: gh.calls().map((c) => c.join(' ')) }
}
const issue = { state: 'open', title: 'Do it', labels: [{ name: 'Type: Task' }, { name: 'Effort: S' }], assignees: [{ login: 'octo' }], milestone: { title: 'M1' }, html_url: 'https://github.com/o/r/issues/7', body: 'The body' }
const c = (id, body) => ({ id, user: { login: 'octo' }, created_at: `2026-01-0${id}T00:00:00Z`, body })

test('prints the header, body, comments across two pages in order, and the sub-issues in order', () => {
    const r = run(['7'], {
        [`${R}/issues/7`]: issue,
        [`${R}/issues/7/comments`]: { __pages: [[c(1, 'first'), c(2, 'second')], [c(3, 'third')]] },
        [`${R}/issues/7/sub_issues`]: [{ number: 9, state: 'closed', title: 'B' }, { number: 8, state: 'open', title: 'A' }],
    })
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /^#7 \[open\] Do it\nlabels: Type: Task, Effort: S\nassignees: octo\nmilestone: M1\nurl: https:\/\/github.com\/o\/r\/issues\/7\n\nThe body\n\n## Comments \(3\)/)
    assert.ok(r.stdout.indexOf('first') < r.stdout.indexOf('second') && r.stdout.indexOf('second') < r.stdout.indexOf('third'))
    assert.match(r.stdout, /^--- @octo 2026-01-03T00:00:00Z id 3\nthird$/m)
    assert.match(r.stdout, /## Sub-issues\n#9 \[closed\] B\n#8 \[open\] A\n$/)
    assert.ok(r.calls.every((x) => !/issue view|projects/.test(x)), 'only gh api reads')
    assert.equal(r.calls.length, 3)
})

test('an issue without labels, comments or sub-issues prints dashes and no sub-issue section', () => {
    const r = run(['7'], { [`${R}/issues/7`]: { ...issue, labels: [], assignees: [], milestone: null, body: null }, [`${R}/issues/7/comments`]: [], [`${R}/issues/7/sub_issues`]: [] })
    assert.equal(r.status, 0)
    assert.match(r.stdout, /labels: -\nassignees: -\nmilestone: -/)
    assert.match(r.stdout, /## Comments \(0\)/)
    assert.doesNotMatch(r.stdout, /Sub-issues/)
})

test('a non-number argument exits 2 before any call', () => {
    for (const a of [['7;id'], ['0'], ['x'], [], ['1', '2']]) {
        const r = run(a, {})
        assert.equal(r.status, 2, a.join(' '))
        assert.deepEqual(r.calls, [])
    }
})

test('an unreadable issue exits 2 with "cannot read issue 7"', () => {
    const r = run(['7'], { [`${R}/issues/7`]: { __status: 404, __stderr: 'Not Found' } })
    assert.equal(r.status, 2)
    assert.match(r.stderr, /cannot read issue 7/)
})
