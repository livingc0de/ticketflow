import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fakeGh, seq, tempDir, writeConfig } from './helpers.mjs'

const core = new URL('../core/', import.meta.url).pathname
const script = `${core}scripts/merge.mjs`
const R = 'repos/o/r'
const HEAD = 'abcdef1234567890abcdef1234567890abcdef12'
const OLD = '1'.repeat(40)
const ago = (m) => new Date(Date.now() - m * 60_000).toISOString()
const pull = (over = {}) => ({ state: 'open', draft: false, base: { ref: 'main' }, head: { sha: HEAD }, merged: false, mergeable: true, mergeable_state: 'blocked', user: { login: 'author' }, ...over })
const status = (state, sha = HEAD) => ({ sha, statuses: [{ context: 'other', state: 'failure' }, ...(state ? [{ context: 'CI / Gate', state }] : [])] })
const MERGED = pull({ merged: true, merge_commit_sha: 'f'.repeat(40) })
const SHA7 = HEAD.slice(0, 7)
const ANCESTOR = '2'.repeat(40)
/** The head was pushed 30 minutes ago (its first check suite). */
const suites = (sha = HEAD, min = 30) => ({ [`${R}/commits/${sha}/check-suites`]: { check_suites: [{ created_at: ago(min) }] } })

const READY = `Reviewed head: ${SHA7}\n**Verdict:** ready to merge\n**Blockers:** none`
const NEEDED = `Reviewed head: ${SHA7}\n**Verdict:** changes needed\n**Blockers:** \`a.js:1\`: bug -> fix`
/** The pr-reviewer review of this account (`me`, the account the fake gh runs as): the review of record by default. */
const review = (over = {}) => ({ id: 77, user: { login: 'me' }, author_association: 'OWNER', commit_id: HEAD, state: 'COMMENTED', body: READY, submitted_at: ago(5), html_url: 'https://x/r77', ...over })
const other = (login, over = {}) => review({ id: 90, user: { login }, author_association: 'COLLABORATOR', ...over })
const STRANGER = { user: { login: 'stranger' }, author_association: 'NONE' }
/** An external review app: an APPROVED review of the head, or any other state. */
const APP = { login: 'rb[bot]', type: 'Bot' }
const ext = (over = {}) => ({ id: 11, user: APP, author_association: 'NONE', commit_id: HEAD, state: 'COMMENTED', submitted_at: ago(5), html_url: 'https://x/r11', body: 'Found nothing', ...over })
const eyes = (min = 2, login = 'rb[bot]') => ({ user: { login, type: 'User' }, content: 'eyes', created_at: ago(min) })
const thread = (id, login = 'anyone', over = {}) => ({ id, isResolved: false, path: 'a.js', line: 3, originalLine: 3, comments: { nodes: [{ author: { login }, body: 'P1: SQL injection' }] }, ...over })
const by = (login) => ['5', '--reviewed-by', login]

/** Runs the real merge.mjs and the real pr-wait.mjs against the fake gh. `pulls` is served in turn: merge, pr-wait, merge's read-back. */
const FLAGS = { squashMergeAllowed: true, rebaseMergeAllowed: true, mergeCommitAllowed: true }
function run({ script: use = script, args = ['5'], pulls = seq(pull(), pull(), MERGED), gate = status('success'), behind = 0, reviews = [review()], comments = [], reactions = [], user = { login: 'me' }, extra = {}, merge = {}, config = true, flags = FLAGS, rules = [], threads = [] } = {}) {
    const dir = tempDir('merge-')
    const gh = fakeGh(dir, {
        [`${R}/pulls/5`]: pulls, [`${R}/commits/${HEAD}/status`]: gate, [`${R}/compare/main...${HEAD}`]: { behind_by: behind },
        [`${R}/issues/5/comments`]: comments, [`${R}/pulls/5/reviews`]: reviews, [`${R}/pulls/5/comments`]: [], [`${R}/issues/5/reactions`]: reactions,
        user, ...suites(),
        'pr merge': merge, 'graphql MergeMethods': { repository: flags }, [`${R}/rules/branches/main?per_page=100`]: rules,
        'graphql ReviewThreads': threads.errors ? threads : { repository: { pullRequest: { reviewThreads: { totalCount: threads.length, nodes: threads } } } }, ...extra,
    })
    const cfg = config ? ['--config', writeConfig(dir)] : ['--config', join(dir, 'missing.json')]
    const r = spawnSync(process.execPath, [use, ...args, ...cfg], { encoding: 'utf8', env: gh.env, cwd: dir })
    const merges = gh.calls().filter((c) => c[0] === 'pr' && c[1] === 'merge')
    return { ...r, merges, calls: gh.calls() }
}
/** A copy of merge.mjs whose pr-wait.mjs prints `out` and exits 0, to feed merge a summary the real pr-wait cannot produce. */
function stubbedWait(out) {
    const dir = tempDir('merge-stub-')
    mkdirSync(`${dir}/scripts`)
    cpSync(`${core}lib`, `${dir}/lib`, { recursive: true })
    cpSync(script, `${dir}/scripts/merge.mjs`)
    writeFileSync(`${dir}/scripts/pr-wait.mjs`, `process.stdout.write(${JSON.stringify(out)})\n`)
    return `${dir}/scripts/merge.mjs`
}
const refused = (r, re) => { assert.equal(r.status, 1, r.stderr + r.stdout); assert.deepEqual(r.merges, []); assert.match(r.stderr, re) }

test('merges with the exact argv and reports the method and the merge commit', () => {
    const r = run()
    assert.equal(r.status, 0, r.stderr)
    assert.deepEqual(r.merges, [['pr', 'merge', '5', '--repo', 'o/r', '--squash', '--delete-branch', '--match-head-commit', HEAD]])
    assert.equal(r.stdout.trim(), `Merged #5 (squash) as ${'f'.repeat(40)}`)
    assert.ok(!r.merges[0].some((a) => /--admin|--auto/.test(a)))
})
test('a ready verdict cannot override explicitly failed specification or code-quality dimensions', () => {
    const base = `Reviewed head: ${SHA7}\n**Verdict:** ready to merge`
    const good = `${base}\n**Spec compliance:** met\n**Code quality:** acceptable`
    assert.equal(run({ reviews: [review({ body: good })] }).status, 0)
    refused(run({ reviews: [review({ body: `${base}\n**Spec compliance:** unmet\n**Code quality:** acceptable` })] }), /not exactly "ready to merge"/)
    refused(run({ reviews: [review({ body: `${base}\n**Spec compliance:** met\n**Code quality:** changes needed` })] }), /not exactly "ready to merge"/)
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
    refused(run({ reviews: [] }), /no review of abcdef1/)
    refused(run({ pulls: seq(pull(), pull({ head: { sha: OLD } })), extra: { [`${R}/commits/${OLD}/status`]: status('success', OLD), ...suites(OLD) } }), /another head/)   // the head moved between the two reads
})
test('an unreadable status, compare or pull request counts as not met', () => {
    refused(run({ gate: { __status: 500, __stderr: 'boom' } }), /cannot read/)
    refused(run({ pulls: { __status: 404, __stderr: 'nope' } }), /cannot read/)
    const dir = tempDir('merge-')
    const gh = fakeGh(dir, { [`${R}/pulls/5`]: pull(), [`${R}/commits/${HEAD}/status`]: status('success') })   // no compare fixture
    const r = spawnSync(process.execPath, [script, '5', '--config', writeConfig(dir)], { encoding: 'utf8', env: gh.env, cwd: dir })
    assert.equal(r.status, 1)
})
test('unresolved threads: none merges; unknown (failed read or more than 100) refuses; a resolved one does not count', () => {
    assert.equal(run({ threads: [{ ...thread('PRRT_r'), isResolved: true }] }).status, 0)
    refused(run({ threads: { errors: [{ message: 'boom' }] } }), /unresolved review threads: unknown/)
    const over100 = { 'graphql ReviewThreads': { repository: { pullRequest: { reviewThreads: { totalCount: 101, nodes: [] } } } } }
    refused(run({ extra: over100 }), /unresolved review threads: unknown/)
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
    for (const args of [['5;x'], ['0'], [], ['5', '--review-basis', 'x'], ['5', '6'], ['5', '--reviewed-by'], ['5', '--reviewed-by', 'a b'], ['5', '--reviewed-by', 'x;id']]) {
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
test('the base is read again right before the merge: a base that moved in between is refused and nothing is merged', () => {
    const compare = (...v) => ({ [`${R}/compare/main...${HEAD}`]: seq(...v.map((behind_by) => ({ behind_by }))) })
    const r = run({ extra: compare(0, 3) })
    refused(r, /behind by 3\): gh pr update-branch 5 --repo o\/r/)
    assert.equal(r.calls.filter((c) => c.some((a) => String(a).includes(`compare/main...${HEAD}`))).length, 2)
    assert.equal(run({ extra: compare(0, 0) }).status, 0)
    refused(run({ extra: compare(2, 0) }), /behind by 2/)   // the early check still fails fast
    refused(run({ extra: { [`${R}/compare/main...${HEAD}`]: seq({ behind_by: 0 }, { __status: 500, __stderr: 'boom' }) } }), /cannot read/)
})

test('M1: the merging account\'s own ready verdict on the head is the review; none, an older head or another "Reviewed head" is not', () => {
    refused(run({ reviews: [] }), /no review of abcdef1: run pr-reviewer on the head.*--reviewed-by/)
    refused(run({ reviews: [review({ commit_id: OLD, body: READY.replace(SHA7, OLD.slice(0, 7)) })] }), /no review of abcdef1/)
    refused(run({ reviews: [review({ body: READY.replace(SHA7, ANCESTOR.slice(0, 7)) })] }), /does not start "Reviewed head: <sha>" naming abcdef1/)
    refused(run({ reviews: [review({ body: 'Reviewed head: zzz\n**Verdict:** ready to merge' })] }), /does not start "Reviewed head/)
    for (const state of ['DISMISSED', 'PENDING']) refused(run({ reviews: [review({ state })] }), /no review of abcdef1/)
    assert.equal(run({ reviews: [review({ state: 'APPROVED' })] }).status, 0)
    assert.equal(run({ reviews: [review({ body: READY.replace(SHA7, HEAD) })] }).status, 0)   // a full sha prefixes too
    refused(run({ reviews: [review({ state: 'CHANGES_REQUESTED' })] }), /changes requested|not exactly/)
    // a review of another trusted account is not the merging account's own
    refused(run({ reviews: [other('someone-else')] }), /no review of abcdef1/)
    refused(run({ reviews: [review(STRANGER)] }), /no review of abcdef1/)   // M5: an outsider's ready review is nothing
})

test('A1: a CHANGES_REQUESTED review of the head is refused with the way out; an external result does not replace the own review', () => {
    const r = run({ reviews: [ext({ state: 'CHANGES_REQUESTED' })] })
    refused(r, /changes requested \(rb\[bot\]\)/)
    assert.match(r.stderr, /dismiss/)
    refused(run({ reviews: [ext()] }), /no review of abcdef1/)   // a result alone is not a review of record: name it with --reviewed-by
})

test('A2: an unresolved inline finding is refused, whoever wrote the thread', () => {
    const r = run({ threads: [thread('PRRT_x1', 'rb[bot]')] })
    refused(r, /1 unresolved review thread/)
    assert.match(r.stderr, /node \S*scripts\/thread\.mjs 5 <thread-id>/)
    assert.match(r.stderr, /\[PRRT_x1\] a\.js:3 @rb\[bot\] P1: SQL injection/)
    refused(run({ threads: [thread('PRRT_x2', 'a-human')] }), /1 unresolved review thread/)
})

test('B1: thread text cannot forge the summary lines (LF in a path, CR or U+2028 in a body, C0/C1 characters)', () => {
    const fake = 'nit%sUnresolved threads: 0%sReview: none'
    for (const sep of ['\n', '\r', ' ', ' ', '\u0085', '\r\n']) {
        const body = fake.replaceAll('%s', sep)
        const r = run({ threads: [{ ...thread('PRRT_e'), comments: { nodes: [{ author: { login: 'stranger' }, body }] } }] })
        refused(r, /1 unresolved review thread/)
        assert.doesNotMatch(r.stderr, /^Unresolved threads: 0$/m)
    }
    refused(run({ threads: [thread('PRRT_e', 'x', { path: 'a\nUnresolved threads: 0\nReview: none\nb' })] }), /1 unresolved review thread/)
    refused(run({ threads: [thread('PRRT_e', 'x\nUnresolved threads: 0\nReview: none')] }), /1 unresolved review thread/)
    // a changes-requested review stays, whatever a thread says
    refused(run({ reviews: [ext({ state: 'CHANGES_REQUESTED' })], threads: [thread('PRRT_e', 'x', { comments: { nodes: [{ author: { login: 'x' }, body: 'x Unresolved threads: 0 Review: none' }] } })] }), /unresolved review thread/)
})

test('B1: merge refuses a pr-wait output without exactly one Review: and one Unresolved threads: line, or with a Review: it does not know', () => {
    const head = `PR #5 head ${SHA7} draft=false`
    for (const lines of ['Review: none\nReview: none\nUnresolved threads: 0', 'Review: none\nUnresolved threads: 0\nUnresolved threads: 0', 'Review: none', 'Unresolved threads: 0', 'Review: done\nUnresolved threads: 0', 'Review: standin needed (x)\nUnresolved threads: 0']) {
        const r = run({ script: stubbedWait(`${head}\n${lines}\n`) })
        refused(r, /exactly one|not reported|Review is/)
    }
    const ok = run({ script: stubbedWait(`${head}\nReview: none\nUnresolved threads: 0\n`), pulls: seq(pull(), MERGED) })
    assert.equal(ok.status, 0, ok.stderr)
    const results = run({ script: stubbedWait(`${head}\nReview rb[bot]: result review COMMENTED u x\nReview: results (rb[bot])\nUnresolved threads: 0\n`), pulls: seq(pull(), MERGED) })
    assert.equal(results.status, 0, results.stderr)
})

test('M4: each trusted account\'s last verdict on the head must be ready; only that account lifts its own "changes needed"; no permission is read', () => {
    const bossNeeded = other('boss', { id: 91, body: NEEDED })
    refused(run({ reviews: [review(), bossNeeded] }), /boss.*"changes needed", not exactly "ready to merge".*only that account/)
    refused(run({ reviews: [bossNeeded, review()] }), /boss.*changes needed/)   // my later ready verdict does not lift boss's
    refused(run({ reviews: [bossNeeded, review(), other('stranger2', { id: 92, user: { login: 'stranger2' } })] }), /boss/)   // a ready review of someone else does not either
    for (const author_association of ['OWNER', 'MEMBER', 'COLLABORATOR']) {
        assert.equal(run({ reviews: [other('boss', { id: 91, body: NEEDED, author_association }), review(), other('boss', { id: 93, body: READY, author_association })] }).status, 0, author_association)   // boss lifts it
        refused(run({ reviews: [review(), other('boss', { id: 91, body: NEEDED, author_association })] }), /changes needed/)
    }
    refused(run({ reviews: [review(), other('boss', { id: 91, body: READY, state: 'COMMENTED' }), other('boss', { id: 94, body: NEEDED })] }), /changes needed/)   // the newest of the account wins
    // an outsider's "changes needed" is not a verdict of record: it cannot stop the merge, and neither can an older head's
    assert.equal(run({ reviews: [review(), review({ id: 95, body: NEEDED, ...STRANGER })] }).status, 0)
    assert.equal(run({ reviews: [review(), other('boss', { id: 96, body: NEEDED, commit_id: OLD })] }).status, 0)
    assert.equal(run({ reviews: [review(), other('boss', { id: 97, body: NEEDED, state: 'DISMISSED' }), other('boss', { id: 98, body: NEEDED, state: 'PENDING' })] }).status, 0)
    assert.equal(run({ reviews: [review(), other('boss', { id: 99, body: 'looks fine, no verdict line' })] }).status, 0)
    const r = run({ reviews: [review(), other('boss', { id: 91, body: READY })] })
    assert.equal(r.status, 0, r.stderr)
    assert.ok(!r.calls.some((c) => c.some((a) => String(a).includes('collaborators/'))), 'merge reads no repository permission')
})

test('B3: the verdict is exactly one "**Verdict:** ready to merge" line; the unfilled template, two verdicts or anything else is refused', () => {
    const body = (verdict) => `Reviewed head: ${SHA7}\n${verdict}`
    for (const verdict of ['**Verdict:** ready to merge | changes needed', '**Verdict:** ready to merge once X is fixed', '**Verdict:** ', '**Verdict:** changes needed\n**Verdict:** ready to merge', '**Verdict:** ready to merge\n**Verdict:** ready to merge', 'Verdict: ready to merge']) {
        const r = run({ reviews: [review({ body: body(verdict) })] })
        if (verdict.startsWith('**') || verdict.startsWith('Verdict')) refused(r, /not exactly "ready to merge"|no review of/)
    }
    assert.equal(run({ reviews: [review({ body: body('**Verdict:**   ready to merge  \n**Blockers:** none') })] }).status, 0)
    refused(run({ reviews: [review({ body: body('**Verdict:** ready to merge') }), other('boss', { id: 91, body: body('**Verdict:** ready to merge | changes needed') })] }), /boss/)
})

test('a changes-needed verdict is seen in any common spelling of the label; only the exact bold line is ready', () => {
    for (const line of ['**Verdict**: changes needed', 'Verdict: changes needed', '   **Verdict:** changes needed', '\t**VERDICT:** changes needed', '__Verdict:__ changes needed', '**Verdict:**changes needed', '## Verdict: changes needed', '- **Verdict:** changes needed', '* Verdict: changes needed', '*Verdict:* changes needed']) {
        refused(run({ reviews: [review(), other('boss', { body: `Reviewed head: ${SHA7}\n${line}` })] }), /changes needed/)
    }
    // a looser spelling of "ready" is a recognised verdict but never an accepted one
    for (const line of ['Verdict: ready to merge', '**Verdict**: ready to merge', '  **Verdict:** ready to merge']) {
        refused(run({ reviews: [review({ body: `Reviewed head: ${SHA7}\n${line}` })] }), /not exactly "ready to merge"/)
    }
    refused(run({ reviews: [review({ body: `Reviewed head: ${SHA7}\n**Verdict:** ready to merge\nVerdict: changes needed` })] }), /not exactly "ready to merge"/)
})

test('should-fix: a changes-needed review is seen whatever its formatting (blank first line, backticks or bold around the sha)', () => {
    for (const body of [`\nReviewed head: ${SHA7}\n**Verdict:** changes needed`, `Reviewed head: \`${SHA7}\`\n**Verdict:** changes needed`, `**Reviewed head:** ${SHA7}\n**Verdict:** changes needed`, '**Verdict:** changes needed']) {
        refused(run({ reviews: [review({ body })] }), /changes needed/)
    }
})

test('M2: --reviewed-by names the reviewer whose result on this head was acted on; no activity, another head, an unlisted account or this account is refused', () => {
    const named = run({ args: by('rb[bot]'), reviews: [ext()] })
    assert.equal(named.status, 0, named.stderr)
    assert.equal(named.merges.length, 1)
    assert.match(named.stdout, /^Note: merged on the result of rb\[bot\] on abcdef1; merge checked where and when it was posted, the agent read what it says$/m)
    assert.doesNotMatch(run().stdout, /Note:/)   // the own review needs no note
    refused(run({ args: by('rb[bot]'), reviews: [ext({ commit_id: OLD })] }), /rb\[bot\] has no result on abcdef1 \(no activity on this head\)/)   // a review of another head
    refused(run({ args: by('rb[bot]'), reviews: [] }), /rb\[bot\] has no result on abcdef1/)
    refused(run({ args: by('nobody[bot]'), reviews: [ext()] }), /nobody\[bot\] has no result/)
    refused(run({ args: by('me'), reviews: [ext()] }), /me has no result/)   // this account's own activity is never a reviewer's
    refused(run({ args: by('author'), reviews: [ext({ user: { login: 'author', type: 'User' }, author_association: 'OWNER' })] }), /author has no result/)   // nor the PR author's
    // a review of the exact head can only exist after its push, so it counts even when the first check suite came later
    assert.equal(run({ args: by('rb[bot]'), reviews: [ext({ submitted_at: ago(40) })] }).status, 0)
    // a reviewer that only reacted has started but has no result: merge waits for it
    refused(run({ args: by('rb[bot]'), reactions: [eyes()], reviews: [] }), /started on abcdef1 and has not answered/)
    // threads, the verdict of an account and the base still gate a merge on a named result
    refused(run({ args: by('rb[bot]'), reviews: [ext()], threads: [thread('PRRT_o')] }), /unresolved review thread/)
    refused(run({ args: by('rb[bot]'), reviews: [ext(), other('boss', { body: NEEDED })] }), /boss/)
    // both an own review and a named result: fine
    assert.equal(run({ args: by('rb[bot]'), reviews: [ext(), review()] }).status, 0)
})

test('M3: a reviewer that started and has not answered blocks the merge until its result or 15 minutes from its start', () => {
    const pending = run({ reactions: [eyes()] })
    refused(pending, /Review: pending \(rb\[bot\]\)|pending \(rb\[bot\]\)/)
    assert.match(pending.stderr, /has not answered.*wait \(pr-wait\), at most 15 minutes from its start/)
    refused(run({ args: by('rb[bot]'), reactions: [eyes()], reviews: [review()] }), /has not answered/)
    // it answered: the own review decides again
    assert.equal(run({ reactions: [eyes()], reviews: [ext(), review()] }).status, 0)
    // 16 minutes after its start with no answer: late, the wait is over
    const late = run({ reactions: [eyes(16)], extra: suites(HEAD, 40) })
    assert.equal(late.status, 0, late.stderr)
    // an unreadable review activity is pending too
    refused(run({ extra: { [`${R}/issues/5/comments`]: { __status: 500, __stderr: 'boom' } } }), /pending \(the review activity could not be read\): run again/)
})

test('M3b: a bot\'s unedited first comment is no basis for --reviewed-by while its 15 minutes run; on the own review the agent has judged it', () => {
    const first = (min, over = {}) => ({ id: 31, user: APP, author_association: 'NONE', created_at: ago(min), updated_at: ago(min), html_url: 'https://x/c31', body: '<!-- rb-review-summary -->\n## Review\n| Code | Running |', ...over })
    // the own pr-reviewer review: a bot's comment does not block (the agent read it: not a review, or a status note it waited out)
    assert.equal(run({ comments: [first(4)] }).status, 0)
    refused(run({ args: by('rb[bot]'), comments: [first(4)], reviews: [] }), /rb\[bot\]'s only answer on abcdef1 is its first comment.*at most 15 minutes from its start/)
    // its edit, or a review, is its answer; 15 minutes with nothing more and the first comment stands as its whole answer
    assert.equal(run({ args: by('rb[bot]'), comments: [first(4, { updated_at: ago(1) })], reviews: [] }).status, 0)
    assert.equal(run({ args: by('rb[bot]'), comments: [first(4)], reviews: [ext()] }).status, 0)
    assert.equal(run({ comments: [first(16)] }).status, 0)
    assert.equal(run({ args: by('rb[bot]'), comments: [first(16)], reviews: [] }).status, 0)
})

test('M6: the owner\'s GitHub approval can be named; GitHub\'s refusal of the merge is reported', () => {
    const approval = ext({ id: 12, user: { login: 'boss', type: 'User' }, author_association: 'OWNER', state: 'APPROVED', body: '' })
    const r = run({ args: by('boss'), reviews: [approval] })
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /merged on the result of boss/)
    const blocked = run({ args: by('boss'), reviews: [approval], merge: { __stderr: 'At least 1 approving review is required' }, pulls: seq(pull(), pull(), pull()) })
    assert.equal(blocked.status, 1)
    assert.match(blocked.stderr, /gh pr merge failed: .*approving review/)
    assert.ok(!r.merges[0].some((a) => /--admin|--auto/.test(a)))
})

test('a failing `gh api user` is an unreadable gate, not a merge', () => {
    const head = `PR #5 head ${SHA7} draft=false\nReview: none\nUnresolved threads: 0\n`
    refused(run({ script: stubbedWait(head), user: { __status: 401, __stderr: 'bad credentials' } }), /cannot read/)
    refused(run({ user: { __status: 401, __stderr: 'bad credentials' } }), /pr-wait exited 2[\s\S]*cannot read the account running this/)   // pr-wait cannot tell who it runs as: it stops
})

test('the removed review basis: --review-basis, "Review basis" comments and permission reads are gone', () => {
    const r = run({ args: ['5', '--review-basis', '55'] })
    assert.equal(r.status, 2); assert.deepEqual(r.calls, [])
    const ok = run()
    assert.ok(!ok.calls.some((c) => c.some((a) => /collaborators|issues\/comments/.test(String(a)))), 'no permission or basis read')
})
