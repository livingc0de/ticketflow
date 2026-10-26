import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fakeGh, tempDir, writeConfig } from './helpers.mjs'

const script = new URL('../core/scripts/tracker-next.mjs', import.meta.url).pathname
const R = 'repos/o/r'
const BODY = ['Tracker intro mentions #99 in passing.', '', '## Order', '- #10 first', '', '**Any time**', '- #13, #14 small fixes', '- later ref: see #15 and #11', '', '## Notes', '- #16 not any time', ''].join('\n')
const child = (number, state = 'open') => ({ number, state, title: `T${number}`, node_id: `N${number}` })
const item = (status, number = 7, login = 'octo') => ({ project: { number, owner: { login } }, fieldValueByName: status ? { name: status } : null })
const node = (number, ...items) => ({ id: `N${number}`, projectItems: { nodes: items } })

function run(children, nodes, { body = BODY, args = ['5'], project = { owner: 'octo', number: 7 } } = {}) {
    const dir = tempDir('next-')
    const gh = fakeGh(dir, { [`${R}/issues/5`]: { body }, [`${R}/issues/5/sub_issues`]: children, 'graphql TrackerStatus': nodes })
    const r = spawnSync(process.execPath, [script, ...args, '--config', writeConfig(dir, { project })], { encoding: 'utf8', env: gh.env })
    return { ...r, calls: gh.calls() }
}

test('skips closed, In Review, Done and any-time children; prints the first open one with its status', () => {
    const kids = [child(10, 'closed'), child(11), child(12), child(13), child(14), child(15), child(16)]
    const r = run(kids, { nodes: [node(10), node(11, item('In Review')), node(12, item('Ready')), node(13), node(14), node(15), node(16)] })
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.stdout, 'Tracker #5: 7 children, 2 done, 2 any time\nnext: #12 T12 [Ready]\nany time open: #13, #14\n')
})

test('refs later in a list item and in other sections are not any time', () => {
    const kids = [child(13), child(14), child(15), child(16)]
    const r = run(kids, { nodes: kids.map((c) => node(c.number)) })
    assert.match(r.stdout, /, 2 any time\n/)
    assert.match(r.stdout, /next: #15 T15 \[no status\]/)   // #15 is mentioned late in an item: still a normal child
})

test('a Blocked first child is still next, marked [Blocked]; Done also counts as done', () => {
    const kids = [child(11), child(12)]
    const r = run(kids, { nodes: [node(11, item('Blocked')), node(12, item('Done'))] })
    assert.match(r.stdout, /next: #11 T11 \[Blocked\]/)
    assert.match(r.stdout, /1 done/)
    const none = run([child(12)], { nodes: [node(12, item('Done'))] })
    assert.match(none.stdout, /next: none/)
})

test('an item in another project (or another owner) has no status and is not done', () => {
    const r = run([child(11)], { nodes: [node(11, item('Done', 8), item('Done', 7, 'someone-else'))] })
    assert.match(r.stdout, /next: #11 T11 \[no status\]/)
    assert.match(r.stdout, /0 done/)
})

test('an any-time number of another repo does not mark a child of this repo', () => {
    const mine = 'https://api.github.com/repos/O/R', other = 'https://api.github.com/repos/x/y'
    const r = run([{ ...child(13), repository_url: other }, { ...child(14), repository_url: mine }], { nodes: [node(13), node(14)] })
    assert.match(r.stdout, /1 any time/)
    assert.match(r.stdout, /next: #13 /)
})

test('a GraphQL error exits 2 and prints no next', () => {
    const r = run([child(11)], { errors: [{ message: 'boom' }] })
    assert.equal(r.status, 2)
    assert.doesNotMatch(r.stdout, /next:/)
    assert.match(r.stderr, /boom/)
})

test('a missing project config or a bad argument exits 2 before any call', () => {
    assert.equal(run([], {}, { project: { owner: 'octo', number: 0, title: 't' } }).status, 2)
    const bad = run([], {}, { args: ['5;x'] })
    assert.equal(bad.status, 2); assert.deepEqual(bad.calls, [])
})
