import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { FAIL, fakeGh, seq, tempDir, writeConfig } from './helpers.mjs'

const script = new URL('../core/scripts/pr-wait.mjs', import.meta.url).pathname
const HEAD = 'a'.repeat(40)
const BILLING = 'The job was not started because recent account payments have failed or your spending limit needs to be increased.'
const ago = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString()
const BOT = { name: 'rb', login: 'review-bot[bot]', rereview_comment: '/review', no_findings_reaction: '+1', unavailable_pattern: 'usage limit', stale_after_min: null }

const status = (state, description, target_url = 'u') => ({ [`commits/${HEAD}/status`]: { statuses: [{ context: 'other', state: 'failure', description: 'x' }, { context: 'CI / Gate', state, description, target_url }] } })
const runs = (...rs) => ({ [`commits/${HEAD}/check-runs`]: { check_runs: rs } })
const run = (id, st, conclusion = null) => ({ id, status: st, conclusion })
const job = (id, extra) => ({ [`actions/jobs/${id}`]: extra })
const notes = (id, ...messages) => ({ [`check-runs/${id}/annotations`]: messages.map((message) => ({ message })) })
const pull = (extra) => ({ pulls: { 7: { head: { sha: HEAD }, draft: false, mergeable: true, mergeable_state: 'blocked', created_at: ago(60), ...extra } } })
const refused = (id = 5) => ({ ...runs(run(id, 'completed', 'failure')), ...job(id, { runner_id: 0, steps: [], created_at: ago(1), run_id: 9 }), ...notes(id, BILLING) })

function baseFixtures() {
    return {
        'pulls/7': pull().pulls[7],
        [`commits/${HEAD}/status`]: { statuses: [] },
        [`commits/${HEAD}/check-runs`]: { check_runs: [] },
        'issues/7/comments': [], 'pulls/7/reviews': [], 'pulls/7/comments': [], 'issues/7/reactions': [],
        [`commits/${HEAD}`]: { commit: { committer: { date: ago(30) } } },
        ...threads([]),
    }
}
const thread = (id, login, body, over = {}) => ({ id, isResolved: false, path: 'a.js', line: 3, originalLine: 9, comments: { nodes: [{ author: { login }, body }] }, ...over })
/** The ReviewThreads fixture; `totalCount` defaults to the number of nodes. */
function threads(nodes, totalCount = nodes.length) {
    return { 'graphql ReviewThreads': { repository: { pullRequest: { reviewThreads: { totalCount, nodes } } } } }
}
// Fixture keys are relative to repos/o/r/; `pulls` is shorthand for 'pulls/7'.
function wait(fix = {}, args = ['7', '--timeout-min', '0'], over = {}) {
    const dir = tempDir('pr-wait-')
    const { pulls, ...rest } = fix
    const map = { ...baseFixtures(), ...rest, ...(pulls ? { 'pulls/7': pulls[7] } : {}) }
    const gh = fakeGh(dir, Object.fromEntries(Object.entries(map).map(([k, v]) => [k.startsWith('graphql ') ? k : `repos/o/r/${k}`, v])))
    const r = spawnSync(process.execPath, [script, ...args, '--config', writeConfig(dir, over)], { encoding: 'utf8', env: gh.env })
    return { ...r, calls: gh.calls().map((c) => c.join(' ')), dir }
}
const code = (fix, args, over) => wait(fix, args, over).status
const notAllowed = (r) => assert.match(r.stdout, /^Fallback: not allowed/m)
const withBot = { reviewers: [BOT] }

test('a job refused for billing (no runner, no steps, the billing annotation) allows the fallback, exit 3', () => {
    const r = wait(refused())
    assert.equal(r.status, 3)
    assert.match(r.stdout, /^Fallback: allowed \(refused for billing: .*spending limit/m)
    assert.match(r.stdout, /^Verify: 5 completed failure$/m)
    assert.match(r.stdout, /^CI \/ Gate: none$/m)
    assert.match(r.stdout, /^PR #7 head aaaaaaa draft=false$/m)
})

test('a red job that got a runner or ran steps never allows the fallback', () => {
    const redRunner = wait({ ...runs(run(5, 'completed', 'failure')), ...job(5, { runner_id: 9, steps: [] }), ...notes(5, BILLING) })
    assert.equal(redRunner.status, 1); notAllowed(redRunner)
    const withSteps = wait({ ...runs(run(5, 'completed', 'failure')), ...job(5, { runner_id: 0, steps: [{ name: 'x' }] }), ...notes(5, BILLING) })
    assert.equal(withSteps.status, 2); notAllowed(withSteps)
    const timedOut = wait({ ...runs(run(5, 'completed', 'timed_out')), ...job(5, { runner_id: 7, steps: [{}] }) })
    assert.equal(timedOut.status, 1)
})

test('a refusal with another annotation, a green run and no Verify never allow the fallback', () => {
    const other = wait({ ...runs(run(5, 'completed', 'failure')), ...job(5, { runner_id: 0, steps: [] }), ...notes(5, 'The workflow is not valid.') })
    assert.equal(other.status, 2); notAllowed(other)
    const green = wait({ ...runs(run(5, 'completed', 'success')), ...job(5, { runner_id: 3, steps: [{}] }) })
    assert.equal(green.status, 2); notAllowed(green)
    const none = wait()
    assert.equal(none.status, 2)
    assert.match(none.stdout, /^Verify: none\nFallback: not allowed/m)
})

test('a job queued 21 minutes allows the fallback with the run to cancel, 19 minutes does not, a missing created_at does not and nothing errors', () => {
    const queued = (created_at) => wait({ ...runs(run(6, 'queued')), ...job(6, { runner_id: null, steps: [], created_at, run_id: 9 }) })
    const old = queued(ago(21))
    assert.equal(old.status, 3)
    assert.match(old.stdout, /^Fallback: allowed \(queued 20 min without a runner; cancel the stuck run only after the fallback has posted: gh run cancel 9\)$/m)
    assert.equal(queued(ago(19)).status, 2)
    const none = queued(null)
    assert.equal(none.status, 2); notAllowed(none)
    assert.equal(none.stderr, '')
    const running = wait({ ...runs(run(6, 'in_progress')), ...job(6, { runner_id: 4, steps: [{}], created_at: ago(300), run_id: 9 }) })
    assert.equal(running.status, 2)   // however old, a run that has a runner is just running
})

test('a final gate status ends the wait and is printed; success, failure and error give 0, 1, 1', () => {
    const r = wait({ ...runs(run(5, 'in_progress')), ...status('success', 'Actions run #1') })
    assert.equal(r.status, 0)
    assert.match(r.stdout, /^CI \/ Gate: success Actions run #1 u$/m)
    assert.equal(code(status('failure', 'Actions run #1')), 1)
    assert.equal(code(status('error', 'Actions run #1')), 1)
    assert.equal(code(status('failure', 'whatever')), 1)
})

test('a verdict beats a refused run; a red that got a runner is never replaceable; a local failure is', () => {
    assert.equal(code({ ...refused(), ...status('success', 'x') }), 0)
    assert.equal(code({ ...refused(), ...status('failure', 'Actions run #9') }), 1)
    assert.equal(code({ ...refused(), ...status('failure', 'x') }), 1)
    const local = wait({ ...refused(), ...status('failure', 'Local run on host1 (x86_64, Node 24.0.0)') })
    assert.equal(local.status, 3)
    assert.equal(code({ ...status('failure', 'Local run on host1 (x86_64, Node 24.0.0)'), ...runs(run(5, 'in_progress')), ...job(5, { runner_id: 1, steps: [{}], created_at: ago(1) }) }), 2)
    assert.equal(code({ ...status('pending', 'Actions run #3'), ...refused() }), 3)
})

test('runner_id null counts as no runner; the newest run wins over an older refusal', () => {
    assert.equal(code({ ...runs(run(5, 'completed', 'failure')), ...job(5, { runner_id: null, steps: [] }), ...notes(5, BILLING) }), 3)
    const older = refused(1)
    assert.equal(code({ ...older, ...runs(run(1, 'completed', 'failure'), run(2, 'completed', 'failure')), ...job(2, { runner_id: 5, steps: [{}, {}] }) }), 1)
    assert.equal(code({ ...older, ...runs(run(2, 'completed', 'failure'), run(1, 'completed', 'failure')), ...job(2, { runner_id: 5, steps: [{}] }) }), 1)   // not the last in the list: the highest id
})

test('cancelled, running, nothing yet and a skipped run are pending in PR mode, never 3', () => {
    for (const rs of [[run(1, 'completed', 'cancelled')], [], [run(1, 'completed', 'skipped')]]) {
        const r = wait({ ...runs(...rs), ...job(1, { runner_id: null, steps: [], created_at: ago(3600), run_id: 9 }) })
        assert.equal(r.status, 2, JSON.stringify(rs))
        assert.doesNotMatch(r.stdout, /superseded/)
    }
    assert.equal(code({ ...runs(run(1, 'in_progress')), ...job(1, { runner_id: 5, steps: [{}], created_at: ago(3600) }) }), 2)
})

test('an API error is pending; a status-read error with a refused run is 2, never 3, and --once says not allowed; a posted failure beats a newer refused run', () => {
    assert.equal(code({ pulls: undefined, 'pulls/7': FAIL }), 2)
    const noStatus = { ...refused(), [`commits/${HEAD}/status`]: FAIL }
    assert.equal(code(noStatus), 2)
    const once = wait(noStatus, ['7', '--once'])
    assert.equal(once.status, 2); notAllowed(once)
    assert.equal(code({ ...refused(), ...status('failure', 'Actions run #8') }), 1)
    assert.equal(code({ ...runs(run(1, 'completed', 'failure')), 'actions/jobs/1': FAIL }), 2)
    assert.equal(code({ ...runs(run(1, 'completed', 'failure')), ...job(1, { runner_id: 0, steps: [] }), 'check-runs/1/annotations': FAIL }), 2)
})

test('PR checks: a draft in local-first is exit 2 with the hint; a draft in ci mode is not short-circuited; conflict; behind; unknown; clean', () => {
    const draft = wait({ ...pull({ draft: true }) }, undefined, { verify: { mode: 'local-first' } })
    assert.equal(draft.status, 2)
    assert.match(draft.stdout, /^Draft: CI skips drafts; gh pr ready 7$/m)
    assert.match(draft.stdout, /draft=true/)
    assert.equal(code({ ...pull({ draft: true }), ...status('success', 'x') }), 0)   // ci mode
    const conflict = wait({ ...pull({ mergeable: false, mergeable_state: 'dirty' }) })
    assert.equal(conflict.status, 1)
    assert.match(conflict.stdout, /conflicts with main: merge main into the branch/)
    const behind = wait({ ...status('success', 'x'), ...pull({ mergeable_state: 'behind' }) })
    assert.equal(behind.status, 1)
    assert.match(behind.stdout, /gh pr update-branch 7/)
    assert.equal(code({ ...status('success', 'x'), ...pull({ mergeable: null, mergeable_state: 'unknown' }) }), 2)
    assert.equal(code({ ...status('success', 'x'), ...pull({ mergeable: true, mergeable_state: 'unknown' }) }), 2)
    assert.equal(code({ ...status('success', 'x'), ...pull({ mergeable: true, mergeable_state: 'clean' }) }), 0)
})

test('--once: the exit code comes from CI only; green says not allowed, refused 3, running 2; reviewers are still printed unless --ci-only', () => {
    const green = wait(status('success', 'x'), ['7', '--once'], withBot)
    assert.equal(green.status, 0); notAllowed(green)
    assert.match(green.stdout, /^Review rb: pending$/m)
    assert.doesNotMatch(green.stdout, /TIMEOUT/)
    const ciOnly = wait(status('success', 'x'), ['7', '--once', '--ci-only'], withBot)
    assert.equal(ciOnly.status, 0)
    assert.doesNotMatch(ciOnly.stdout, /Review/)
    assert.equal(code(refused(), ['7', '--once']), 3)
    assert.equal(code({ ...runs(run(1, 'in_progress')), ...job(1, { runner_id: 5, steps: [{}], created_at: ago(1) }) }, ['7', '--once']), 2)
    assert.equal(code(status('failure', 'Actions run #1'), ['7', '--once'], withBot), 1)
})

test('reviewers: a review of the head, or the configured reaction after the head, is done; none configured prints so', () => {
    const none = wait(status('success', 'x'))
    assert.equal(none.status, 0)
    assert.match(none.stdout, /^Review: none configured \(pr-reviewer reviews\)$/m)
    assert.equal(code(status('success', 'x'), undefined, withBot), 2)   // nothing yet
    const reviewed = wait({ ...status('success', 'x'), 'pulls/7/reviews': [{ user: { login: 'review-bot[bot]' }, commit_id: HEAD, state: 'COMMENTED' }] }, undefined, withBot)
    assert.equal(reviewed.status, 0)
    assert.doesNotMatch(reviewed.stdout, /TIMEOUT/)
    assert.match(reviewed.stdout, /^Review rb: done \(aaaaaaa\)$/m)
    assert.match(reviewed.stdout, /^Review: done$/m)
    const thumbs = wait({ ...status('success', 'x'), 'issues/7/reactions': [{ user: { login: 'review-bot[bot]' }, content: '+1', created_at: ago(5) }] }, undefined, withBot)
    assert.equal(thumbs.status, 0)
    assert.match(thumbs.stdout, /^Review rb: done \(\+1 after head\)$/m)
})

test('reviewers: wrong commit, wrong login, old or foreign reactions stay pending', () => {
    const rev = (login, commit_id) => ({ 'pulls/7/reviews': [{ user: { login }, commit_id, state: 'COMMENTED' }] })
    const react = (login, content, min) => ({ 'issues/7/reactions': [{ user: { login }, content, created_at: ago(min) }] })
    for (const extra of [rev('review-bot[bot]', 'b'.repeat(40)), rev('someone', HEAD), react('review-bot[bot]', '+1', 45), react('someone', '+1', 5), react('review-bot[bot]', 'heart', 5)]) {
        const r = wait({ ...status('success', 'x'), ...extra }, undefined, withBot)
        assert.equal(r.status, 2, JSON.stringify(extra))
        assert.match(r.stdout, /^Review: pending$/m)
        assert.match(r.stdout, /^TIMEOUT after 0m$/m)
    }
})

test('reviewers: unavailable after the round start means a stand-in is needed (exit 0); before the latest re-review comment it is pending', () => {
    const limit = (min) => ({ user: { login: 'review-bot[bot]' }, created_at: ago(min), body: 'You have reached your Usage Limit' })
    const r = wait({ ...status('success', 'x'), 'issues/7/comments': [limit(10)] }, undefined, withBot)
    assert.equal(r.status, 0)
    assert.match(r.stdout, /^Review rb: unavailable since \d{4}-/m)
    assert.match(r.stdout, /^Review: standin needed \(rb\)$/m)
    const reRequested = { user: { login: 'owner' }, created_at: ago(5), body: '/review please\n' }
    const stale = wait({ ...status('success', 'x'), 'issues/7/comments': [limit(10), reRequested] }, undefined, withBot)
    assert.equal(stale.status, 2)
    assert.match(stale.stdout, /^Review rb: pending$/m)
    const other = wait({ ...status('success', 'x'), 'issues/7/comments': [{ ...limit(10), user: { login: 'someone' } }] }, undefined, withBot)
    assert.equal(other.status, 2)
    // the latest request counts, not the first: an older request before the limit comment must not hide a newer one after it
    const older = { user: { login: 'owner' }, created_at: ago(20), body: '/review' }
    const latest = wait({ ...status('success', 'x'), 'issues/7/comments': [older, limit(10), reRequested] }, undefined, withBot)
    assert.equal(latest.status, 2)
    // a summary comment created before the round and edited after it is a failure of this round
    const edited = { ...limit(90), updated_at: ago(10) }
    const viaEdit = wait({ ...status('success', 'x'), 'issues/7/comments': [edited] }, undefined, withBot)
    assert.equal(viaEdit.status, 0)
    assert.match(viaEdit.stdout, /^Review rb: unavailable since \d{4}-/m)
    const untouched = wait({ ...status('success', 'x'), 'issues/7/comments': [limit(90)] }, undefined, withBot)
    assert.equal(untouched.status, 2)
})

test('reviewers: silent after stale_after_min since the later of the round start and the head', () => {
    const over = { reviewers: [{ ...BOT, stale_after_min: 20 }] }
    const silent = wait(status('success', 'x'), undefined, over)   // head 30 min old, PR 60 min old
    assert.equal(silent.status, 0)
    assert.match(silent.stdout, /^Review rb: silent 30 min$/m)
    assert.match(silent.stdout, /^Review: standin needed \(rb\)$/m)
    const fresh = wait({ ...status('success', 'x'), [`commits/${HEAD}`]: { commit: { committer: { date: ago(5) } } } }, undefined, over)
    assert.equal(fresh.status, 2)
    const asked = wait({ ...status('success', 'x'), 'issues/7/comments': [{ user: { login: 'o' }, created_at: ago(3), body: '/review' }] }, undefined, over)
    assert.equal(asked.status, 2)
})

test('two reviewers, one pending: exit 2; red with a pending reviewer waits for the timeout, then exits 1', () => {
    const two = { reviewers: [BOT, { ...BOT, name: 'other', login: 'other-bot[bot]' }] }
    const reviewed = { 'pulls/7/reviews': [{ user: { login: 'review-bot[bot]' }, commit_id: HEAD }] }
    const r = wait({ ...status('success', 'x'), ...reviewed }, undefined, two)
    assert.equal(r.status, 2)
    assert.match(r.stdout, /^Review rb: done/m)
    assert.match(r.stdout, /^Review other: pending$/m)
    const red = wait(status('failure', 'Actions run #1'), undefined, withBot)
    assert.equal(red.status, 1)
    assert.match(red.stdout, /^TIMEOUT after 0m$/m)
    assert.equal(code({ ...status('failure', 'Actions run #1'), 'pulls/7/reviews': [{ user: { login: 'review-bot[bot]' }, commit_id: HEAD }] }, undefined, withBot), 1)
})

test('a failed reviewer read keeps a green PR pending, never done', () => {
    for (const key of ['pulls/7/reviews', 'issues/7/comments', 'issues/7/reactions', `commits/${HEAD}`]) {
        const r = wait({ ...status('success', 'x'), [key]: FAIL }, undefined, withBot)
        assert.equal(r.status, 2, key)
        assert.match(r.stdout, /^Review: pending$/m)
    }
})

test('--ci-only makes no reviewer reads; a sha makes no PR, review or reaction calls', () => {
    const r = wait(status('success', 'x'), ['7', '--ci-only', '--timeout-min', '0'], withBot)
    assert.equal(r.status, 0)
    assert.ok(!r.calls.some((c) => /issues\/7|reviews|reactions|pulls\/7\/comments|commits\/a+$/.test(c)), r.calls.join('\n'))
    const s = wait(status('success', 'x'), [HEAD, '--timeout-min', '0'], withBot)
    assert.equal(s.status, 0)
    assert.match(s.stdout, /^main commit aaaaaaa$/m)
    assert.ok(!s.calls.some((c) => /pulls|reactions|reviews|issues/.test(c)), s.calls.join('\n'))
})

test('sha mode: the same outcomes, and a cancelled run is superseded (exit 2 with the hint)', () => {
    assert.equal(code(status('failure', 'Actions run #1'), [HEAD, '--timeout-min', '0']), 1)
    assert.equal(code(refused(), [HEAD, '--timeout-min', '0']), 3)
    const cancelled = wait({ ...runs(run(1, 'completed', 'cancelled')), ...job(1, { runner_id: null, steps: [], created_at: ago(3600), run_id: 9 }) }, [HEAD, '--timeout-min', '0'])
    assert.equal(cancelled.status, 2)
    assert.match(cancelled.stdout, /superseded: check the newest main commit/)
    assert.equal(code({}, [HEAD, '--timeout-min', '0']), 2)
})

test('usage errors exit 2 with no gh call', () => {
    for (const args of [[], ['7;id', '--once'], ['abc'], ['7', '8'], ['7', '--bogus'], ['7', '--timeout-min', 'x'], ['7', '--timeout-min', '-1'], ['A'.repeat(40)], [HEAD.slice(1)]]) {
        const r = wait({}, args)
        assert.equal(r.status, 2, args.join(' '))
        assert.deepEqual(r.calls, [])
    }
    const bad = wait({}, ['7', '--once'], { bogus: 1 })
    assert.equal(bad.status, 2)
    assert.deepEqual(bad.calls, [])
})

test('a custom gate.context and gate.check reach the API paths and the output', () => {
    const over = { gate: { context: 'my/gate', check: 'Build job' } }
    const r = wait({ [`commits/${HEAD}/status`]: { statuses: [{ context: 'my/gate', state: 'success', description: 'Actions run #1' }, { context: 'CI / Gate', state: 'failure', description: 'x' }] } }, undefined, over)
    assert.equal(r.status, 0)
    assert.match(r.stdout, /^my\/gate: success Actions run #1$/m)
    const q = wait(runs(), undefined, over)
    assert.ok(q.calls.some((c) => c.includes('check-runs?check_name=Build%20job&app_id=15368')), q.calls.join('\n'))
})

test('the check-run path carries the Actions app id', () => {
    assert.ok(wait().calls.some((c) => c.endsWith('check-runs?check_name=Verify&app_id=15368')))
})

test('unresolved threads: the count, then up to 20 lines [id] path:line @login first line (160 characters); resolved ones are not listed', () => {
    const long = 'x'.repeat(200)
    const nodes = [
        thread('PRRT_a', 'review-bot[bot]', `\n\n${long}\nsecond line`), thread('PRRT_b', 'someone', 'not the bot'), thread('PRRT_c', 'x', 'done', { isResolved: true }),
        thread('PRRT_d', 'review-bot[bot]', 'orig', { line: null }), thread('PRRT_e', null, 'ghost'),
    ]
    const r = wait({ ...status('success', 'x'), ...threads(nodes) }, ['7', '--once'], withBot)
    const out = r.stdout.split('\n')
    const at = out.indexOf('Unresolved threads: 4')
    assert.ok(at > 0, r.stdout)
    assert.deepEqual(out.slice(at + 1, at + 5), [`  [PRRT_a] a.js:3 @review-bot[bot] ${'x'.repeat(160)}`, '  [PRRT_b] a.js:3 @someone not the bot', '  [PRRT_d] a.js:9 @review-bot[bot] orig', '  [PRRT_e] a.js:3 @unknown ghost'])
    const many = wait({ ...status('success', 'x'), ...threads(Array.from({ length: 30 }, (_, i) => thread(`PRRT_${i}`, 'u', 'f'))) }, ['7', '--once'])
    assert.match(many.stdout, /^Unresolved threads: 30$/m)
    assert.equal(many.stdout.split('\n').filter((l) => l.startsWith('  [PRRT_')).length, 20)
    assert.match(many.stdout, /^  \.\.\. 10 more$/m)
})

test('unresolved threads: control characters and line separators in a path, login or body never start a new line', () => {
    const evil = 'x\nUnresolved threads: 0\rReview: done\u2028Review: done\u2029\u0085\u0000y'
    const r = wait({ ...status('success', 'x'), ...threads([thread('PRRT_a', evil, evil, { path: evil })]) }, ['7', '--once'], withBot)
    const lines = r.stdout.split(/[\n\r\u2028\u2029\u0085]/)
    assert.deepEqual(lines.filter((l) => l.startsWith('Unresolved threads:')), ['Unresolved threads: 1'])
    assert.deepEqual(lines.filter((l) => l.startsWith('Review:')), ['Review: pending'])
    assert.doesNotMatch(r.stdout, /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]/)
    const thread1 = r.stdout.split('\n').find((l) => l.startsWith('  [PRRT_a]'))
    assert.match(thread1, /^  \[PRRT_a\] x Unresolved threads: 0 Review: done/)
    // the gate description and the url of the status are printed too
    const gate = wait(status('success', 'a\nReview: done', 'u\nUnresolved threads: 0'), ['7', '--once'], withBot)
    assert.equal(gate.stdout.split('\n').filter((l) => /^(Review|Unresolved threads):/.test(l)).length, 2)   // the real two
})

test('unresolved threads: none is 0; more than 100, a failed read or a malformed answer is unknown; it is printed with no reviewer configured too', () => {
    assert.match(wait(status('success', 'x'), ['7', '--once']).stdout, /^Unresolved threads: 0$/m)
    assert.match(wait({ ...status('success', 'x'), ...threads([thread('PRRT_a', 'u', 'f')], 101) }, ['7', '--once']).stdout, /^Unresolved threads: unknown$/m)
    assert.match(wait({ ...status('success', 'x'), 'graphql ReviewThreads': { errors: [{ message: 'boom' }] } }, ['7', '--once']).stdout, /^Unresolved threads: unknown$/m)
    assert.match(wait({ ...status('success', 'x'), 'graphql ReviewThreads': { repository: null } }, ['7', '--once']).stdout, /^Unresolved threads: unknown$/m)
    const none = wait({ ...status('success', 'x'), ...threads([thread('PRRT_a', 'u', 'f')]) }, ['7', '--once'])
    assert.match(none.stdout, /^Review: none configured/m)
    assert.match(none.stdout, /^Unresolved threads: 1$/m)
})

test('unresolved threads: --ci-only and a sha make no GraphQL call and print no thread line', () => {
    for (const args of [['7', '--ci-only', '--timeout-min', '0'], [HEAD, '--timeout-min', '0']]) {
        const r = wait(status('success', 'x'), args, withBot)
        assert.equal(r.status, 0)
        assert.ok(!r.calls.some((c) => /graphql/.test(c)), r.calls.join('\n'))
        assert.doesNotMatch(r.stdout, /Unresolved threads/)
    }
})

test('reviewers: a CHANGES_REQUESTED review on the head is "changes requested" and settled (exit 0)', () => {
    const review = (state, login = 'review-bot[bot]') => ({ user: { login }, commit_id: HEAD, state })
    const r = wait({ ...status('success', 'x'), 'pulls/7/reviews': [review('CHANGES_REQUESTED')] }, undefined, withBot)
    assert.equal(r.status, 0)
    assert.match(r.stdout, /^Review rb: changes requested \(aaaaaaa\)$/m)
    assert.match(r.stdout, /^Review: changes requested \(rb\)$/m)
    assert.doesNotMatch(r.stdout, /TIMEOUT/)
    // the last review wins
    const fixed = wait({ ...status('success', 'x'), 'pulls/7/reviews': [review('CHANGES_REQUESTED'), review('APPROVED')] }, undefined, withBot)
    assert.match(fixed.stdout, /^Review: done$/m)
    const worse = wait({ ...status('success', 'x'), 'pulls/7/reviews': [review('APPROVED'), review('CHANGES_REQUESTED')] }, undefined, withBot)
    assert.match(worse.stdout, /^Review: changes requested \(rb\)$/m)
    // a dismissed or pending review is not an answer; the one before a dismissed one counts
    for (const state of ['DISMISSED', 'PENDING']) {
        const p = wait({ ...status('success', 'x'), 'pulls/7/reviews': [review(state)] }, undefined, withBot)
        assert.equal(p.status, 2, state)
        assert.match(p.stdout, /^Review: pending$/m)
    }
    const dismissed = wait({ ...status('success', 'x'), 'pulls/7/reviews': [review('APPROVED'), review('DISMISSED')] }, undefined, withBot)
    assert.match(dismissed.stdout, /^Review: done$/m)
    // another reviewer's review, or one of an older commit, does not decide
    const other = wait({ ...status('success', 'x'), 'pulls/7/reviews': [review('CHANGES_REQUESTED', 'someone')] }, undefined, withBot)
    assert.match(other.stdout, /^Review: pending$/m)
})

test('reviewers: summary precedence is pending, then changes requested, then standin needed, then done', () => {
    const two = { reviewers: [BOT, { ...BOT, name: 'other', login: 'other-bot[bot]' }] }
    const cr = { user: { login: 'review-bot[bot]' }, commit_id: HEAD, state: 'CHANGES_REQUESTED' }
    const gone = { user: { login: 'other-bot[bot]' }, created_at: ago(1), body: 'usage limit reached' }
    const pending = wait({ ...status('success', 'x'), 'pulls/7/reviews': [cr] }, undefined, two)
    assert.equal(pending.status, 2)
    assert.match(pending.stdout, /^Review: pending$/m)
    const both = wait({ ...status('success', 'x'), 'pulls/7/reviews': [cr], 'issues/7/comments': [gone] }, undefined, two)
    assert.equal(both.status, 0)
    assert.match(both.stdout, /^Review: changes requested \(rb\)$/m)
})

test('reviewers: the reaction must be newer than the latest re-review request and the head commit', () => {
    const react = (min) => ({ 'issues/7/reactions': [{ user: { login: 'review-bot[bot]' }, content: '+1', created_at: ago(min) }] })
    const asked = (min) => ({ 'issues/7/comments': [{ user: { login: 'owner' }, created_at: ago(min), body: '/review' }] })
    const before = wait({ ...status('success', 'x'), ...react(10), ...asked(5) }, undefined, withBot)   // reacted, then asked again
    assert.equal(before.status, 2); assert.match(before.stdout, /^Review: pending$/m)
    const after = wait({ ...status('success', 'x'), ...react(2), ...asked(5) }, undefined, withBot)
    assert.equal(after.status, 0); assert.match(after.stdout, /^Review rb: done \(\+1 after head\)$/m)
})

test('reviewers: a done_pattern that matches only completed keeps a failed state pending', () => {
    const pattern = 'review-state:v1 (?=[^\\n]*"commit_sha":"(?<sha>[0-9a-f]{7,40})")(?=[^\\n]*"status":"completed")'
    const over = { reviewers: [{ name: 'rb', login: 'review-bot[bot]', done_pattern: pattern }] }
    const note = (status) => [{ user: { login: 'review-bot[bot]' }, created_at: ago(5), updated_at: ago(5), body: `<!-- review-state:v1 {"code_review":{"status":"${status}","commit_sha":"${HEAD}"}} -->` }]
    assert.equal(wait({ ...status('success', 'x'), 'issues/7/comments': note('failed') }, undefined, over).status, 2)
    assert.equal(wait({ ...status('success', 'x'), 'issues/7/comments': note('completed') }, undefined, over).status, 0)
})

test('the loop sleeps and polls again until the gate is final', () => {
    const dir = tempDir('pr-wait-sleep-')
    const gh = fakeGh(dir, Object.fromEntries(Object.entries({
        ...baseFixtures(), 'pulls/7': seq(pull({ mergeable: null, mergeable_state: 'unknown' }).pulls[7], pull().pulls[7]),
        ...status('success', 'x'),
    }).map(([k, v]) => [k.startsWith('graphql ') ? k : `repos/o/r/${k}`, v])))
    writeFileSync(join(dir, 'bin', 'sleep'), '#!/bin/sh\necho "$@" >> ' + join(dir, 'slept') + '\n')
    chmodSync(join(dir, 'bin', 'sleep'), 0o755)
    // first poll: unknown mergeability (pending); second: clean
    const r = spawnSync(process.execPath, [script, '7', '--timeout-min', '5', '--config', writeConfig(dir, {})], { encoding: 'utf8', env: gh.env })
    assert.equal(r.status, 0, r.stderr)
    assert.equal(gh.calls().filter((c) => c[1].endsWith('/pulls/7')).length, 2)
})

test('--once prints the reviewer lines for every outcome, a conflict included', () => {
    const r = wait({ ...pull({ mergeable: false, mergeable_state: 'dirty' }) }, ['7', '--once'], withBot)
    assert.equal(r.status, 1)
    assert.match(r.stdout, /^Review rb: pending$/m)
})

test('reviewers: a state comment (done_pattern) naming the head is done; the last match wins; other logins and unfinished states are ignored', () => {
    const pattern = 'review-state:v1 (?=[^\\n]*"commit_sha":"(?<sha>[0-9a-f]{7,40})")(?=[^\\n]*"status":"completed")'
    const over = { reviewers: [{ name: 'rb', login: 'review-bot[bot]', done_pattern: pattern }] }
    const state = (sha, status = 'completed', extra = {}) => `<!-- review-state:v1 {"security_review":{"status":null},"code_review":{"status":"${status}","commit_sha":"${sha}"},"x":1} -->`
    const note = (body, min, user = 'review-bot[bot]', updated = min) => ({ user: { login: user }, created_at: ago(min), updated_at: ago(updated), body })
    const run = (comments) => wait({ ...status('success', 'x'), 'issues/7/comments': comments }, undefined, over)
    const done = run([note(state(HEAD), 5)])
    assert.equal(done.status, 0)
    assert.match(done.stdout, /^Review rb: done \(state aaaaaaa\)$/m)
    assert.equal(run([note(state(HEAD.slice(0, 7)), 5)]).status, 0)   // a short sha is a prefix of the head
    assert.equal(run([note(state(HEAD.slice(0, 6)), 5)]).status, 2)    // shorter than 7 does not match the pattern
    for (const comments of [[note(state('b'.repeat(40)), 5)], [note(state(HEAD, 'running'), 5)], [note(state(HEAD), 5, 'someone')], [note('no state here', 5)], []]) {
        const r = run(comments)
        assert.equal(r.status, 2, JSON.stringify(comments))
        assert.match(r.stdout, /^Review rb: pending$/m)
    }
    // the last match wins: a comment edited to a newer sha beats an older matching one, and an older sha edited last loses
    assert.equal(run([note(state('b'.repeat(40)), 30, undefined, 2), note(state(HEAD), 10)]).status, 2)
    assert.equal(run([note(state(HEAD), 30, undefined, 2), note(state('b'.repeat(40)), 10)]).status, 0)
    assert.equal(run([note(`${state(HEAD)}\n${state('b'.repeat(40))}`, 5)]).status, 2)
    assert.equal(run([note(`${state('b'.repeat(40))}\n${state(HEAD)}`, 5)]).status, 0)
})
