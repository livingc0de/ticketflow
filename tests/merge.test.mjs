import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fakeGh, seq, tempDir, writeConfig } from './helpers.mjs'

const script = new URL('../core/scripts/merge.mjs', import.meta.url).pathname
const R = 'repos/o/r'
const HEAD = 'abcdef1234567890abcdef1234567890abcdef12'
const OLD = '1'.repeat(40)
const ago = (m) => new Date(Date.now() - m * 60_000).toISOString()
const pull = (over = {}) => ({ state: 'open', draft: false, base: { ref: 'main' }, head: { sha: HEAD }, merged: false, mergeable: true, mergeable_state: 'blocked', created_at: ago(60), ...over })
const status = (state, sha = HEAD) => ({ sha, statuses: [{ context: 'other', state: 'failure' }, ...(state ? [{ context: 'CI / Gate', state }] : [])] })
const BOT = { name: 'rb', login: 'review-bot[bot]', unavailable_pattern: 'usage limit' }
const MERGED = pull({ merged: true, merge_commit_sha: 'f'.repeat(40) })

/** Runs the real merge.mjs and the real pr-wait.mjs against the fake gh. `pulls` is served in turn: merge, pr-wait, merge's read-back. */
const FLAGS = { squashMergeAllowed: true, rebaseMergeAllowed: true, mergeCommitAllowed: true }
function run({ args = ['5'], pulls = seq(pull(), pull(), MERGED), gate = status('success'), behind = 0, reviews = [{ user: { login: BOT.login }, commit_id: HEAD }], comments = [], extra = {}, merge = {}, over = { reviewers: [BOT] }, config = true, flags = FLAGS, rules = [] } = {}) {
    const dir = tempDir('merge-')
    const gh = fakeGh(dir, {
        [`${R}/pulls/5`]: pulls, [`${R}/commits/${HEAD}/status`]: gate, [`${R}/compare/main...${HEAD}`]: { behind_by: behind },
        [`${R}/issues/5/comments`]: comments, [`${R}/pulls/5/reviews`]: reviews, [`${R}/pulls/5/comments`]: [], [`${R}/issues/5/reactions`]: [],
        'pr merge': merge, 'graphql MergeMethods': { repository: flags }, [`${R}/rules/branches/main?per_page=100`]: rules, ...extra,
    })
    const cfg = config ? ['--config', writeConfig(dir, over)] : ['--config', join(dir, 'missing.json')]
    const r = spawnSync(process.execPath, [script, ...args, ...cfg], { encoding: 'utf8', env: gh.env })
    const merges = gh.calls().filter((c) => c[0] === 'pr' && c[1] === 'merge')
    return { ...r, merges, calls: gh.calls() }
}
const refused = (r, re) => { assert.equal(r.status, 1, r.stderr + r.stdout); assert.deepEqual(r.merges, []); assert.match(r.stderr, re) }

test('merges with the exact argv and reports the method and the merge commit', () => {
    const r = run()
    assert.equal(r.status, 0, r.stderr)
    assert.deepEqual(r.merges, [['pr', 'merge', '5', '--repo', 'o/r', '--squash', '--delete-branch', '--match-head-commit', HEAD]])
    assert.equal(r.stdout.trim(), `Merged #5 (squash) as ${'f'.repeat(40)}`)
    assert.ok(!r.merges[0].some((a) => /--admin|--auto/.test(a)))
})

test('each unmet gate exits 1 and never calls pr merge', () => {
    refused(run({ gate: status(null) }), /CI \/ Gate is missing/)
    refused(run({ gate: status('pending') }), /CI \/ Gate is pending/)
    refused(run({ gate: status('failure') }), /CI \/ Gate is failure/)
    refused(run({ gate: status('success', OLD) }), /missing|exact head/)   // green on an older sha only
    refused(run({ behind: 2 }), /behind by 2\): gh pr update-branch 5 --repo o\/r/)
    refused(run({ pulls: pull({ draft: true }) }), /draft/)
    refused(run({ pulls: pull({ state: 'closed' }) }), /closed/)
    refused(run({ pulls: pull({ base: { ref: 'develop' } }) }), /based on develop/)
    refused(run({ pulls: seq(pull(), pull({ mergeable: false })) }), /pr-wait exited 1/)   // the real pr-wait sees a conflict
    refused(run({ reviews: [] }), /review is "pending"/)
    refused(run({ pulls: seq(pull(), pull({ head: { sha: OLD } })), extra: { [`${R}/commits/${OLD}/status`]: status('success', OLD) } }), /another head/)   // the head moved between the two reads
})

test('an unreadable status, compare or pull request counts as not met', () => {
    refused(run({ gate: { __status: 500, __stderr: 'boom' } }), /cannot read/)
    refused(run({ pulls: { __status: 404, __stderr: 'nope' } }), /cannot read/)
    const dir = tempDir('merge-')
    const gh = fakeGh(dir, { [`${R}/pulls/5`]: pull(), [`${R}/commits/${HEAD}/status`]: status('success') })   // no compare fixture
    const r = spawnSync(process.execPath, [script, '5', '--config', writeConfig(dir)], { encoding: 'utf8', env: gh.env })
    assert.equal(r.status, 1)
})

const comment = (over = {}) => ({ [`${R}/issues/comments/55`]: { issue_url: 'https://api.github.com/repos/o/r/issues/5', body: `pr-reviewer verdict on ${HEAD.slice(0, 7)}: no blockers`, ...over } })
const basis = ['5', '--review-basis', '55']

test('with no reviewer, a review basis naming the head on this PR is required', () => {
    const NONE = { over: { reviewers: [] }, reviews: [] }
    refused(run(NONE), /no reviewer finished.*--review-basis/)
    refused(run({ ...NONE, args: basis, extra: comment({ issue_url: 'https://api.github.com/repos/o/r/issues/6' }) }), /not on #5/)
    refused(run({ ...NONE, args: basis, extra: comment({ issue_url: 'https://api.github.com/repos/o/r/issues/55' }) }), /not on #5/)
    refused(run({ ...NONE, args: basis, extra: comment({ issue_url: 'https://api.github.com/repos/x/o/r/issues/5' }) }), /not on #5/)
    refused(run({ ...NONE, args: basis, extra: comment({ body: 'looks fine' }) }), /does not name the head/)
    refused(run({ ...NONE, args: basis, extra: comment({ body: `verdict on ${HEAD.slice(0, 4)}` }) }), /does not name the head/)
    refused(run({ ...NONE, args: basis, extra: comment({ body: `verdict on ${OLD.slice(0, 7)}` }) }), /does not name the head/)
    const ok = run({ ...NONE, args: basis, extra: comment() })
    assert.equal(ok.status, 0, ok.stderr); assert.equal(ok.merges.length, 1)
})

test('a stand-in for an unavailable reviewer also needs the basis; a finished review does not', () => {
    const gone = { reviews: [], comments: [{ user: { login: BOT.login }, created_at: ago(1), body: 'usage limit reached' }] }
    refused(run(gone), /standin needed \(rb\)/)
    assert.equal(run({ ...gone, args: basis, extra: comment() }).status, 0)
    const done = {}
    assert.equal(run(done).status, 0)
    assert.equal(run({ ...done, args: basis }).status, 0)   // a basis that is not needed is not read
})

test('gh failing after the merge happened is a success; gh failing without a merge is exit 1', () => {
    const failed = { __stderr: 'failed to delete branch' }
    const merged = run({ merge: failed })
    assert.equal(merged.status, 0, merged.stderr); assert.match(merged.stdout, /^Merged #5 \(squash\) as /)
    const notMerged = run({ merge: { __stderr: 'head branch was modified' }, pulls: seq(pull(), pull(), pull()) })
    assert.equal(notMerged.status, 1); assert.match(notMerged.stderr, /head branch was modified/)
})

test('a missing config exits 2 with no gh call; bad arguments exit 2', () => {
    const r = run({ config: false })
    assert.equal(r.status, 2); assert.deepEqual(r.calls, [])
    for (const args of [['5;x'], ['0'], [], ['5', '--review-basis', 'x'], ['5', '6']]) {
        const bad = run({ args })
        assert.equal(bad.status, 2, args.join(' ')); assert.deepEqual(bad.calls, [])
    }
})

test('the merge method follows the repo: squash, else rebase, else a merge commit, as its settings and the base rules allow', () => {
    const method = (o) => run(o).merges[0]?.[5]
    assert.equal(method({ flags: { ...FLAGS, squashMergeAllowed: false } }), '--rebase')
    assert.equal(method({ flags: { squashMergeAllowed: false, rebaseMergeAllowed: false, mergeCommitAllowed: true } }), '--merge')
    assert.equal(method({ rules: [{ type: 'pull_request', parameters: { allowed_merge_methods: ['merge'] } }, { type: 'deletion' }] }), '--merge')
    assert.equal(method({ rules: [{ type: 'pull_request', parameters: {} }] }), '--squash')   // no list: every method
    refused(run({ flags: { ...FLAGS, mergeCommitAllowed: false }, rules: [{ type: 'pull_request', parameters: { allowed_merge_methods: ['merge'] } }] }), /no merge method is allowed/)
    refused(run({ extra: { 'graphql MergeMethods': { __status: 502, __stderr: 'boom' } } }), /cannot read/)
    refused(run({ extra: { [`${R}/rules/branches/main?per_page=100`]: { __status: 502, __stderr: 'boom' } } }), /cannot read/)
})
