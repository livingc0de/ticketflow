import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fakeGh, tempDir, writeConfig } from './helpers.mjs'

const script = new URL('../core/scripts/ticket.mjs', import.meta.url).pathname
const R = 'repos/o/r'
const PROJECT = {
    'graphql ProjectTarget': {
        repository: { issue: { id: 'I1', projectItems: { nodes: [{ id: 'IT1', project: { id: 'P1' } }] } } },
        repositoryOwner: { projectV2: { id: 'P1', field: { id: 'F', options: [{ id: 'O1', name: 'In Progress' }, { id: 'O2', name: 'In Review' }] } } },
    },
    'graphql SetProjectStatus': {},
}

function run(args, { body = 'Planning: inline: x', comments = [], project = true, extra = {}, input } = {}) {
    const dir = tempDir('ticket-')
    const gh = fakeGh(dir, {
        user: { login: 'me' }, [`${R}/issues/7/comments`]: comments, [`POST ${R}/issues/7/comments`]: {}, [`POST ${R}/issues/7/assignees`]: {},
        ...(project ? PROJECT : {}), ...extra,
    })
    const cfg = writeConfig(dir, project ? { project: { owner: 'o', number: 3 } } : {})
    const r = spawnSync(process.execPath, [script, ...args, '--config', cfg], { encoding: 'utf8', env: gh.env, input: input ?? body })
    const posts = gh.log().filter((c) => c.args[0] === 'api' && c.args.includes('POST') && c.stdin).map((c) => ({ path: c.args.find((a) => a.startsWith('repos/')), body: JSON.parse(c.stdin) }))
    return { ...r, posts, names: gh.log().filter((c) => c.stdin && /"query"/.test(c.stdin)).map((c) => /(?:query|mutation) (\w+)/.exec(JSON.parse(c.stdin).query)[1]) }
}

test('claim assigns, sets In Progress and posts the marked claim comment', () => {
    const r = run(['claim', '7'])
    assert.equal(r.status, 0, r.stderr)
    assert.deepEqual(r.posts.map((p) => p.path), [`${R}/issues/7/assignees`, `${R}/issues/7/comments`])
    assert.deepEqual(r.posts[0].body, { assignees: ['me'] })
    assert.equal(r.posts[1].body.body, '<!-- ticketflow:claim -->\nPlanning: inline: x')
    assert.deepEqual(r.names, ['ProjectTarget', 'SetProjectStatus'])
    assert.equal(r.stdout.trim(), 'claim #7: assigned me, status In Progress, claim comment')
})

test('claim does not duplicate Tier metadata in the comment or mutate labels', () => {
    const r = run(['claim', '7'], { body: 'Planning: none (low)' })
    assert.equal(r.status, 0, r.stderr)
    assert.deepEqual(r.posts.map(p => p.path), [`${R}/issues/7/assignees`, `${R}/issues/7/comments`])
    assert.equal(r.posts[1].body.body, '<!-- ticketflow:claim -->\nPlanning: none (low)')
})

test('claim without a project skips the status', () => {
    const r = run(['claim', '7'], { project: false })
    assert.equal(r.status, 0, r.stderr)
    assert.deepEqual(r.names, [])
    assert.equal(r.stdout.trim(), 'claim #7: assigned me, claim comment')
})

test('a repeated claim keeps the existing comment and posts no second one; another account\'s marker does not count', () => {
    const mine = { user: { login: 'me' }, body: '<!-- ticketflow:claim -->\nold' }
    const again = run(['claim', '7'], { comments: [mine] })
    assert.equal(again.status, 0, again.stderr)
    assert.match(again.stdout, /claim: already claimed, comment kept/)
    assert.deepEqual(again.posts.map((p) => p.path), [`${R}/issues/7/assignees`])
    // the real paginated shape: the marker is on the second page
    const paged = run(['claim', '7'], { extra: { [`${R}/issues/7/comments`]: { __pages: [[{ user: { login: 'x' }, body: 'hi' }], [mine]] } } })
    assert.match(paged.stdout, /already claimed/)
    const other = run(['claim', '7'], { comments: [{ user: { login: 'someone' }, body: '<!-- ticketflow:claim -->\nx' }, { user: { login: 'me' }, body: 'a plain comment' }] })
    assert.equal(other.posts.at(-1).path, `${R}/issues/7/comments`)
})

test('handoff sets In Review and posts the marked summary once', () => {
    const r = run(['handoff', '7', '--pr', '5'], { body: 'Merged #5.\nRun: tier normal' })
    assert.equal(r.status, 0, r.stderr)
    assert.deepEqual(r.posts.map((p) => p.path), [`${R}/issues/7/comments`])
    assert.equal(r.posts[0].body.body, '<!-- ticketflow:summary pr=5 -->\nMerged #5.\nRun: tier normal')
    assert.equal(r.stdout.trim(), 'handoff #7: status In Review, summary comment')
    const old = { user: { login: 'me' }, body: '<!-- ticketflow:summary pr=5 -->\nold' }
    const again = run(['handoff', '7', '--pr', '5'], { comments: [old] })
    assert.match(again.stdout, /handoff: already handed off, comment kept/)
    assert.deepEqual(again.posts, [])
    // a later change to the same ticket (another PR) gets its own summary; a claim marker is not a summary marker
    assert.equal(run(['handoff', '7', '--pr', '9'], { comments: [old] }).posts.length, 1)
    assert.equal(run(['handoff', '7', '--pr', '5'], { comments: [{ user: { login: 'me' }, body: '<!-- ticketflow:claim -->\nx' }] }).posts.length, 1)
})

test('a failed step exits 1 and prints what already happened; running it again is safe', () => {
    const noStatus = run(['claim', '7'], { extra: { 'graphql SetProjectStatus': { errors: [{ message: 'boom' }] } } })
    assert.equal(noStatus.status, 1)
    assert.match(noStatus.stderr, /project status "In Progress" failed.*boom/)
    assert.match(noStatus.stderr, /done before the failure: assigned me; run it again/)
    assert.ok(!noStatus.posts.some((p) => p.path.endsWith('/comments')), 'no comment after a failed status')
    const noComment = run(['handoff', '7', '--pr', '5'], { extra: { [`POST ${R}/issues/7/comments`]: { __status: 500, __stderr: 'down' } } })
    assert.equal(noComment.status, 1)
    assert.match(noComment.stderr, /done before the failure: status In Review;/)
    assert.equal(run(['claim', '7'], { extra: { user: { __status: 401, __stderr: 'bad credentials' } } }).status, 1)
})

test('usage, config and an empty body exit 2 before any write', () => {
    for (const args of [[], ['claim'], ['claim', 'x'], ['done', '7'], ['claim', '7', '8'], ['handoff', '7'], ['handoff', '7', '--pr', 'x'], ['claim', '7', '--pr', '5']]) {
        const r = run(args); assert.equal(r.status, 2, args.join(' ')); assert.deepEqual(r.posts, [])
    }
    const empty = run(['claim', '7'], { input: '  \n' })
    assert.equal(empty.status, 2); assert.match(empty.stderr, /body on stdin is empty/); assert.deepEqual(empty.posts, [])
})
