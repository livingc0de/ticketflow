import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fakeGh, tempDir, writeConfig } from './helpers.mjs'

const script = new URL('../core/scripts/thread.mjs', import.meta.url).pathname
const ID = 'PRRT_kwDOAbc-123'
const node = (over = {}) => ({ node: { isResolved: false, pullRequest: { number: 5, repository: { nameWithOwner: 'o/r' } }, comments: { nodes: [{ body: 'P1: bug', viewerDidAuthor: false }] }, ...over } })
const OK_REPLY = { addPullRequestReviewThreadReply: { comment: { id: 'c1' } } }
const OK_RESOLVE = { resolveReviewThread: { thread: { isResolved: true } } }

function thread({ args = ['5', ID], stdin = 'Fixed in abc1234', fixtures = {} } = {}) {
    const dir = tempDir('thread-')
    const gh = fakeGh(dir, { 'graphql ThreadOf': node(), 'graphql ReplyThread': OK_REPLY, 'graphql ResolveThread': OK_RESOLVE, ...fixtures })
    const r = spawnSync(process.execPath, [script, ...args, '--config', writeConfig(dir)], { encoding: 'utf8', env: gh.env, input: stdin })
    const ops = gh.log().map((c) => /\b(?:query|mutation)\s+(\w+)/.exec(JSON.parse(c.stdin ?? '{}').query ?? '')?.[1])
    return { ...r, ops, vars: gh.log().map((c) => JSON.parse(c.stdin ?? '{}').variables) }
}

test('replies with stdin and resolves the thread', () => {
    const r = thread()
    assert.equal(r.status, 0, r.stderr)
    assert.deepEqual(r.ops, ['ThreadOf', 'ReplyThread', 'ResolveThread'])
    assert.deepEqual(r.vars[1], { id: ID, body: 'Fixed in abc1234' })
    assert.deepEqual(r.vars[2], { id: ID })
    assert.match(r.stdout, /answered and resolved/)
})

test('a thread of another pull request, another repository or no thread at all exits 1 with no write', () => {
    for (const fixtures of [
        { 'graphql ThreadOf': node({ pullRequest: { number: 6, repository: { nameWithOwner: 'o/r' } } }) },
        { 'graphql ThreadOf': node({ pullRequest: { number: 5, repository: { nameWithOwner: 'x/r' } } }) },
        { 'graphql ThreadOf': { node: null } },
        { 'graphql ThreadOf': { errors: [{ type: 'NOT_FOUND', message: "Could not resolve to a node with the global id of 'PRRT_kwDOAbc-123'" }] } },
        { 'graphql ThreadOf': { node: {} } },
    ]) {
        const r = thread({ fixtures })
        assert.equal(r.status, 1, r.stderr)
        assert.deepEqual(r.ops, ['ThreadOf'])
        assert.match(r.stderr, /not a review thread of o\/r#5/)
    }
})

test('an already resolved thread exits 0 with no write', () => {
    const r = thread({ fixtures: { 'graphql ThreadOf': node({ isResolved: true }) } })
    assert.equal(r.status, 0); assert.deepEqual(r.ops, ['ThreadOf'])
    assert.match(r.stdout, /already resolved/)
})

test('a rerun after a failed resolve does not reply twice; another last comment still gets the reply', () => {
    const ours = node({ comments: { nodes: [{ body: 'Fixed in abc1234\n', viewerDidAuthor: true }] } })
    assert.deepEqual(thread({ fixtures: { 'graphql ThreadOf': ours } }).ops, ['ThreadOf', 'ResolveThread'])
    const otherText = node({ comments: { nodes: [{ body: 'Something else', viewerDidAuthor: true }] } })
    assert.deepEqual(thread({ fixtures: { 'graphql ThreadOf': otherText } }).ops, ['ThreadOf', 'ReplyThread', 'ResolveThread'])
    const theirs = node({ comments: { nodes: [{ body: 'Fixed in abc1234', viewerDidAuthor: false }] } })
    assert.deepEqual(thread({ fixtures: { 'graphql ThreadOf': theirs } }).ops, ['ThreadOf', 'ReplyThread', 'ResolveThread'])
})

test('a blank reply, a bad id or a bad pull request number exits 2 with no gh call', () => {
    for (const o of [{ stdin: '  \n' }, { stdin: '' }, { args: ['5', 'PRRT_x;y'] }, { args: ['5', 'abc'] }, { args: ['x', ID] }, { args: ['5'] }, { args: ['5', ID, 'extra'] }]) {
        const r = thread(o)
        assert.equal(r.status, 2, JSON.stringify(o)); assert.deepEqual(r.ops, [])
    }
})

test('a failed reply or resolve exits 2; a failed resolve after the reply leaves the reply in place', () => {
    const lookup = thread({ fixtures: { 'graphql ThreadOf': { errors: [{ message: 'Resource not accessible' }] } } })   // any other read error stays exit 2
    assert.equal(lookup.status, 2); assert.deepEqual(lookup.ops, ['ThreadOf'])
    const bad = { errors: [{ message: 'Resource not accessible' }] }
    const reply = thread({ fixtures: { 'graphql ReplyThread': bad } })
    assert.equal(reply.status, 2); assert.deepEqual(reply.ops, ['ThreadOf', 'ReplyThread'])
    const resolve = thread({ fixtures: { 'graphql ResolveThread': bad } })
    assert.equal(resolve.status, 2); assert.deepEqual(resolve.ops, ['ThreadOf', 'ReplyThread', 'ResolveThread'])
    assert.match(resolve.stderr, /Resource not accessible/)
})
