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
function run({ args = ['5'], pulls = seq(pull(), pull(), MERGED), gate = status('success'), behind = 0, reviews = [{ user: { login: BOT.login }, commit_id: HEAD }], comments = [], extra = {}, merge = {}, over = { reviewers: [BOT] }, config = true, flags = FLAGS, rules = [], threads = [] } = {}) {
    const dir = tempDir('merge-')
    const gh = fakeGh(dir, {
        [`${R}/pulls/5`]: pulls, [`${R}/commits/${HEAD}/status`]: gate, [`${R}/compare/main...${HEAD}`]: { behind_by: behind },
        [`${R}/issues/5/comments`]: comments, [`${R}/pulls/5/reviews`]: reviews, [`${R}/pulls/5/comments`]: [], [`${R}/issues/5/reactions`]: [],
        'pr merge': merge, 'graphql MergeMethods': { repository: flags }, [`${R}/rules/branches/main?per_page=100`]: rules,
        'graphql ReviewThreads': threads.errors ? threads : { repository: { pullRequest: { reviewThreads: { totalCount: threads.length, nodes: threads } } } }, ...extra,
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

const SHA7 = HEAD.slice(0, 7)
const ANCESTOR = '2'.repeat(40)
const READY = `Reviewed head: ${SHA7}\n**Verdict:** ready to merge\n**Blockers:** none`
const review = (over = {}) => ({ id: 77, user: { login: 'me' }, commit_id: HEAD, state: 'COMMENTED', body: READY, ...over })
const thread = (id, login = 'anyone') => ({ id, isResolved: false, path: 'a.js', line: 3, originalLine: 3, comments: { nodes: [{ author: { login }, body: 'P1: SQL injection' }] } })
const comment = (body, over = {}) => ({ [`${R}/issues/comments/55`]: { issue_url: 'https://api.github.com/repos/o/r/issues/5', body, ...over } })
const link = (pr = 5, id = 77) => `https://github.com/o/r/pull/${pr}#pullrequestreview-${id}`
const prefix = `Review basis for ${SHA7}:`
const linked = (rev = review(), extra = {}) => ({ [`${R}/pulls/5/reviews/77`]: rev, [`${R}/compare/${rev.commit_id}...${HEAD}`]: { status: rev.commit_id === HEAD ? 'identical' : 'ahead' }, ...extra })
const basis = ['5', '--review-basis', '55']
const NONE = { over: { reviewers: [] }, reviews: [] }
const withBasis = (body, extra = {}, more = {}) => run({ ...NONE, ...more, args: basis, extra: { ...comment(body), ...extra } })

// A1-A7 of the plan: each one used to reach `gh pr merge`.
test('A1: a CHANGES_REQUESTED review of the head is refused', () => {
    const r = run({ reviews: [{ user: { login: BOT.login }, commit_id: HEAD, state: 'CHANGES_REQUESTED' }] })
    refused(r, /changes requested \(rb\)/)
    assert.match(r.stderr, /dismiss/)
})

test('A2: a COMMENTED review with an unresolved inline finding is refused, whoever wrote the thread', () => {
    const r = run({ reviews: [{ user: { login: BOT.login }, commit_id: HEAD, state: 'COMMENTED' }], threads: [thread('PRRT_x1', BOT.login)] })
    refused(r, /1 unresolved review thread/)
    assert.match(r.stderr, /thread\.mjs 5 <thread-id>/)
    assert.match(r.stderr, /\[PRRT_x1\] a\.js:3 @review-bot\[bot\] P1: SQL injection/)
    refused(run({ threads: [thread('PRRT_x2', 'a-human')] }), /1 unresolved review thread/)   // D1: any author
})

test('A3: a DISMISSED review is not a finished review', () => {
    refused(run({ reviews: [{ user: { login: BOT.login }, commit_id: HEAD, state: 'DISMISSED' }] }), /review is "pending"/)
})

test('A4: a failed review state is not done with the completed-only done_pattern', () => {
    const done_pattern = 'review-state:v1 (?=[^\\n]*"commit_sha":"(?<sha>[0-9a-f]{7,40})")(?=[^\\n]*"status":"completed")'
    const state = (status) => [{ user: { login: BOT.login }, created_at: ago(5), updated_at: ago(5), body: `<!-- review-state:v1 {"code_review":{"status":"${status}","commit_sha":"${HEAD}"}} -->` }]
    const over = { reviewers: [{ name: 'rb', login: BOT.login, done_pattern }] }
    refused(run({ over, reviews: [], comments: state('failed') }), /review is "pending"/)
    assert.equal(run({ over, reviews: [], comments: state('completed') }).status, 0)
})

test('A5: a basis comment that only says "changes needed" is refused', () => {
    refused(withBasis(`${prefix} pr-reviewer verdict changes needed`), /link a pr-reviewer review|owner approved/)
})

test('A6: the local-verify gate comment is not a review basis', () => {
    refused(withBasis(`### CI / Gate: Passed\n\nCommit ${SHA7}, **success**. Local run on h, verify command on the exact head.`), /must start with "Review basis for abcdef1:"/)
})

test('A7: a reviewer out of quota and any comment naming the head is refused', () => {
    const gone = { reviews: [], comments: [{ user: { login: BOT.login }, created_at: ago(1), body: 'usage limit reached' }] }
    refused(run({ ...gone, args: basis, extra: comment(`ci passed on ${SHA7}`) }), /must start with "Review basis for abcdef1:"/)
})

test('unresolved threads: none merges; unknown (failed read or more than 100) refuses; a resolved one does not count', () => {
    assert.equal(run({ threads: [{ ...thread('PRRT_r'), isResolved: true }] }).status, 0)
    refused(run({ threads: { errors: [{ message: 'boom' }] } }), /unresolved review threads: unknown/)
    const over100 = { 'graphql ReviewThreads': { repository: { pullRequest: { reviewThreads: { totalCount: 101, nodes: [] } } } } }
    refused(run({ extra: over100 }), /unresolved review threads: unknown/)
})

test('a pr-reviewer "changes needed" review of the head blocks even when the external reviewer is done; the last one wins; an older head does not count', () => {
    const rev = (body, commit_id = HEAD) => review({ body, commit_id })
    const NEEDED = `Reviewed head: ${SHA7}\n**Verdict:** changes needed\n**Blockers:** \`a.js:1\`: bug -> fix`
    refused(run({ reviews: [{ user: { login: BOT.login }, commit_id: HEAD }, rev(NEEDED)] }), /changes needed/)
    assert.equal(run({ reviews: [{ user: { login: BOT.login }, commit_id: HEAD }, rev(NEEDED), rev(READY)] }).status, 0)
    refused(run({ reviews: [{ user: { login: BOT.login }, commit_id: HEAD }, rev(READY), rev(NEEDED)] }), /changes needed/)
    assert.equal(run({ reviews: [{ user: { login: BOT.login }, commit_id: HEAD }, rev(NEEDED, OLD)] }).status, 0)
    assert.equal(run({ reviews: [{ user: { login: BOT.login }, commit_id: HEAD }, rev('**Verdict:** changes needed (no first line)')] }).status, 0)   // not a pr-reviewer review
})

test('with no reviewer, the basis must be a comment "Review basis for <sha7>:" that links a ready-to-merge review of this PR', () => {
    refused(run(NONE), /no reviewer finished.*--review-basis/)
    for (const issue_url of ['https://api.github.com/repos/o/r/issues/6', 'https://api.github.com/repos/o/r/issues/55', 'https://api.github.com/repos/x/o/r/issues/5']) {
        refused(run({ ...NONE, args: basis, extra: { ...comment(`${prefix} ${link()}`, { issue_url }), ...linked() } }), /not on #5/)
    }
    refused(withBasis(`${prefix} no link`), /link a pr-reviewer review|owner approved/)
    refused(withBasis(`${link()} ${prefix}`, linked()), /must start with/)
    refused(withBasis(`Review basis for ${OLD.slice(0, 7)}: ${link()}`, linked()), /must start with/)
    refused(withBasis(`${prefix} ${link()} and ${link(5, 78)}`, linked()), /exactly one/)
    refused(withBasis(`${prefix} ${link(6)}`, linked()), /another PR|#5/)   // a review link of another PR
    const ok = withBasis(`${prefix} ${link()}`, linked())
    assert.equal(ok.status, 0, ok.stderr); assert.equal(ok.merges.length, 1)
    assert.doesNotMatch(ok.stdout, /owner's approval/)
})

test('the linked review: a missing one (404), another verdict, no Reviewed head line, or a diverged commit refuses; an ancestor commit is fine', () => {
    const link5 = `${prefix} ${link()}`
    refused(withBasis(link5, {}), /cannot read/)   // no review fixture: 404
    refused(withBasis(link5, linked(review({ body: `Reviewed head: ${SHA7}\n**Verdict:** changes needed` }))), /ready to merge/)
    refused(withBasis(link5, linked(review({ body: '**Verdict:** ready to merge' }))), /ready to merge/)
    refused(withBasis(link5, linked(review({ body: `Reviewed head: ${SHA7}\nno verdict` }))), /ready to merge/)
    const diverged = review({ commit_id: ANCESTOR })
    for (const status of ['diverged', 'behind']) refused(withBasis(link5, { ...linked(diverged), [`${R}/compare/${ANCESTOR}...${HEAD}`]: { status } }), /does not contain/)
    const ancestor = withBasis(link5, linked(diverged))
    assert.equal(ancestor.status, 0, ancestor.stderr)
})

test('"owner approved" is accepted as the basis, and merge says so', () => {
    const r = withBasis(`${prefix} owner approved the setup PR`)
    assert.equal(r.status, 0, r.stderr); assert.equal(r.merges.length, 1)
    assert.match(r.stdout, /^Note: merged on the owner's approval \(comment 55\)/m)
    refused(withBasis(`${prefix} not owner approved`), /link a pr-reviewer review|owner approved/)
    refused(withBasis(`${prefix} owner approved`, {}, { threads: [thread('PRRT_o')] }), /unresolved review thread/)   // still gated by threads
    refused(withBasis(`${prefix} owner approved`, {}, { reviews: [review({ body: `Reviewed head: ${SHA7}\n**Verdict:** changes needed` })] }), /changes needed/)
})

test('a stand-in for an unavailable reviewer also needs the basis; a finished review does not', () => {
    const gone = { reviews: [], comments: [{ user: { login: BOT.login }, created_at: ago(1), body: 'usage limit reached' }] }
    refused(run(gone), /standin needed \(rb\)/)
    assert.equal(run({ ...gone, args: basis, extra: { ...comment(`${prefix} ${link()}`), ...linked() } }).status, 0)
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
