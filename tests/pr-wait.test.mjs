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
const RB = 'rb[bot]'

const status = (state, description, target_url = 'u') => ({ [`commits/${HEAD}/status`]: { statuses: [{ context: 'other', state: 'failure', description: 'x' }, { context: 'CI / Gate', state, description, target_url }] } })
const runs = (...rs) => ({ [`commits/${HEAD}/check-runs`]: { check_runs: rs } })
const run = (id, st, conclusion = null) => ({ id, status: st, conclusion })
const job = (id, extra) => ({ [`actions/jobs/${id}`]: extra })
const notes = (id, ...messages) => ({ [`check-runs/${id}/annotations`]: messages.map((message) => ({ message })) })
const pull = (extra) => ({ pulls: { 7: { head: { sha: HEAD }, draft: false, mergeable: true, mergeable_state: 'blocked', user: { login: 'author' }, ...extra } } })
const refused = (id = 5) => ({ ...runs(run(id, 'completed', 'failure')), ...job(id, { runner_id: 0, steps: [], created_at: ago(1), run_id: 9 }), ...notes(id, BILLING) })

function baseFixtures() {
    return {
        'pulls/7': pull().pulls[7],
        [`commits/${HEAD}/status`]: { statuses: [] },
        [`commits/${HEAD}/check-runs`]: { check_runs: [] },
        'issues/7/comments': [], 'pulls/7/reviews': [], 'pulls/7/comments': [], 'issues/7/reactions': [],
        [`commits/${HEAD}`]: { commit: { committer: { date: ago(40) } } },
        [`commits/${HEAD}/check-suites`]: { check_suites: [{ created_at: ago(30) }, { created_at: ago(29) }] },   // pushed 30 minutes ago
        user: { login: 'me' },
        ...threads([]),
    }
}
const thread = (id, login, body, over = {}) => ({ id, isResolved: false, path: 'a.js', line: 3, originalLine: 9, comments: { nodes: [{ author: { login }, body }] }, ...over })
/** The ReviewThreads fixture; `totalCount` defaults to the number of nodes. */
function threads(nodes, totalCount = nodes.length) {
    return { 'graphql ReviewThreads': { repository: { pullRequest: { reviewThreads: { totalCount, nodes } } } } }
}
// Fixture keys are relative to repos/o/r/ (except `user` and `graphql ...`); `pulls` is shorthand for 'pulls/7'.
function wait(fix = {}, args = ['7', '--timeout-min', '0'], over = {}) {
    const dir = tempDir('pr-wait-')
    const { pulls, ...rest } = fix
    const map = { ...baseFixtures(), ...rest, ...(pulls ? { 'pulls/7': pulls[7] } : {}) }
    const gh = fakeGh(dir, Object.fromEntries(Object.entries(map).map(([k, v]) => [k.startsWith('graphql ') || k === 'user' ? k : `repos/o/r/${k}`, v])))
    const r = spawnSync(process.execPath, [script, ...args, '--config', writeConfig(dir, over)], { encoding: 'utf8', env: gh.env })
    return { ...r, calls: gh.calls().map((c) => c.join(' ')), dir }
}
const code = (fix, args, over) => wait(fix, args, over).status
const notAllowed = (r) => assert.match(r.stdout, /^Fallback: not allowed/m)
const NOW = { user: { login: 'me' } }
/** A review, a comment and a reaction by an app; a reaction reports an app as type User. */
const app = (login = RB) => ({ login, type: 'Bot' })
const rev = (state, over = {}) => ({ id: 1, user: app(), commit_id: HEAD, state, submitted_at: ago(5), html_url: 'https://x/r1', body: 'review body', author_association: 'NONE', ...over })
const note = (min, body = 'status', over = {}) => ({ id: 9, user: app(), created_at: ago(min), updated_at: ago(min), html_url: 'https://x/c', body, author_association: 'NONE', ...over })
const react = (min, content = 'eyes', login = RB) => ({ user: { login, type: 'User' }, content, created_at: ago(min) })
const green = status('success', 'x')
const reviewLines = (r) => r.stdout.split('\n').filter((l) => l.startsWith('Review'))

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

test('sha mode: the same outcomes, and a cancelled run is superseded (exit 2 with the hint)', () => {
    assert.equal(code(status('failure', 'Actions run #1'), [HEAD, '--timeout-min', '0']), 1)
    assert.equal(code(refused(), [HEAD, '--timeout-min', '0']), 3)
    const cancelled = wait({ ...runs(run(1, 'completed', 'cancelled')), ...job(1, { runner_id: null, steps: [], created_at: ago(3600), run_id: 9 }) }, [HEAD, '--timeout-min', '0'])
    assert.equal(cancelled.status, 2)
    assert.match(cancelled.stdout, /superseded: check the newest main commit/)
    assert.equal(code({}, [HEAD, '--timeout-min', '0']), 2)
})

test('usage errors exit 2 with no gh call', () => {
    for (const args of [[], ['7;id', '--once'], ['abc'], ['7', '8'], ['7', '--bogus'], ['7', '--timeout-min', 'x'], ['7', '--timeout-min', '-1'], ['A'.repeat(40)], [HEAD.slice(1)], ['7', '--more'], ['7', '--more', 'a b'], ['7', '--more', 'x;id'], ['7', '--more', '']]) {
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
    const r = wait({ ...status('success', 'x'), ...threads(nodes) }, ['7', '--once'])
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
    const r = wait({ ...status('success', 'x'), ...threads([thread('PRRT_a', evil, evil, { path: evil })]) }, ['7', '--once'])
    const lines = r.stdout.split(/[\n\r\u2028\u2029\u0085]/)
    assert.deepEqual(lines.filter((l) => l.startsWith('Unresolved threads:')), ['Unresolved threads: 1'])
    assert.deepEqual(lines.filter((l) => l.startsWith('Review:')), ['Review: none'])
    assert.doesNotMatch(r.stdout, /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]/)
    const thread1 = r.stdout.split('\n').find((l) => l.startsWith('  [PRRT_a]'))
    assert.match(thread1, /^  \[PRRT_a\] x Unresolved threads: 0 Review: done/)
    // the gate description and the url of the status are printed too
    const gate = wait(status('success', 'a\nReview: done', 'u\nUnresolved threads: 0'), ['7', '--once'])
    assert.equal(gate.stdout.split('\n').filter((l) => /^(Review|Unresolved threads):/.test(l)).length, 2)   // the real two
})

test('unresolved threads: none is 0; more than 100, a failed read or a malformed answer is unknown; it is printed with no reviewer too', () => {
    assert.match(wait(status('success', 'x'), ['7', '--once']).stdout, /^Unresolved threads: 0$/m)
    assert.match(wait({ ...status('success', 'x'), ...threads([thread('PRRT_a', 'u', 'f')], 101) }, ['7', '--once']).stdout, /^Unresolved threads: unknown$/m)
    assert.match(wait({ ...status('success', 'x'), 'graphql ReviewThreads': { errors: [{ message: 'boom' }] } }, ['7', '--once']).stdout, /^Unresolved threads: unknown$/m)
    assert.match(wait({ ...status('success', 'x'), 'graphql ReviewThreads': { repository: null } }, ['7', '--once']).stdout, /^Unresolved threads: unknown$/m)
    const none = wait({ ...status('success', 'x'), ...threads([thread('PRRT_a', 'u', 'f')]) }, ['7', '--once'])
    assert.match(none.stdout, /^Review: none$/m)
    assert.match(none.stdout, /^Unresolved threads: 1$/m)
})

test('unresolved threads: --ci-only and a sha make no GraphQL call and print no thread line', () => {
    for (const args of [['7', '--ci-only', '--timeout-min', '0'], [HEAD, '--timeout-min', '0']]) {
        const r = wait(status('success', 'x'), args)
        assert.equal(r.status, 0)
        assert.ok(!r.calls.some((c) => /graphql/.test(c)), r.calls.join('\n'))
        assert.doesNotMatch(r.stdout, /Unresolved threads/)
    }
})

test('the loop sleeps and polls again until the gate is final', () => {
    const dir = tempDir('pr-wait-sleep-')
    const gh = fakeGh(dir, Object.fromEntries(Object.entries({
        ...baseFixtures(), 'pulls/7': seq(pull({ mergeable: null, mergeable_state: 'unknown' }).pulls[7], pull().pulls[7]),
        ...status('success', 'x'),
    }).map(([k, v]) => [k.startsWith('graphql ') || k === 'user' ? k : `repos/o/r/${k}`, v])))
    writeFileSync(join(dir, 'bin', 'sleep'), '#!/bin/sh\necho "$@" >> ' + join(dir, 'slept') + '\n')
    chmodSync(join(dir, 'bin', 'sleep'), 0o755)
    // first poll: unknown mergeability (pending); second: clean
    const r = spawnSync(process.execPath, [script, '7', '--timeout-min', '5', '--config', writeConfig(dir, {})], { encoding: 'utf8', env: gh.env })
    assert.equal(r.status, 0, r.stderr)
    assert.equal(gh.calls().filter((c) => c[1].endsWith('/pulls/7')).length, 2)
})

test('no external reviewer: Review: none and exit 0 once CI is green, with no wait', () => {
    const r = wait(green, ['7', '--timeout-min', '5'])
    assert.equal(r.status, 0, r.stderr)
    assert.deepEqual(reviewLines(r), ['Review: none'])
    assert.equal(r.calls.filter((c) => c.endsWith('/pulls/7')).length, 1)
})

test('an app\'s reaction after the push starts it: pending, with its window, and the wait goes on (exit 2)', () => {
    const r = wait({ ...green, 'issues/7/reactions': [react(2)] })
    assert.equal(r.status, 2)
    assert.match(r.stdout, /^Review rb\[bot\]: pending since \d{4}-.* \(at most until \d{4}-/m)
    assert.match(r.stdout, /^Review: pending \(rb\[bot\]\)$/m)
    assert.match(r.stdout, /^TIMEOUT after 0m$/m)
    assert.equal(wait({ ...green, 'issues/7/reactions': [react(2)] }, ['7', '--once']).status, 0)   // --once: CI decides the code
})

test('a reviewer\'s first comment is its status note, never a result; a later comment of it is', () => {
    const base = { ...green, 'issues/7/reactions': [react(8)] }
    const one = wait({ ...base, 'issues/7/comments': [note(8, 'Reviewing...')] })
    assert.match(one.stdout, /^Review: pending \(rb\[bot\]\)$/m)
    const two = wait({ ...base, 'issues/7/comments': [note(8, 'Reviewing...'), note(3, 'Found nothing\n\nall good', { id: 10, html_url: 'https://x/c2' })] })
    assert.equal(two.status, 0, two.stdout)
    assert.match(two.stdout, /^Review rb\[bot\]: result comment https:\/\/x\/c2 Found nothing$/m)
    assert.match(two.stdout, /^Review: results \(rb\[bot\]\)$/m)
    // an empty comment (only an HTML marker) is no result
    const marker = wait({ ...base, 'issues/7/comments': [note(8), note(3, '<!-- state -->')] })
    assert.match(marker.stdout, /^Review: pending/m)
})

test('a review of the head that arrived while CI ran is the result: CI pending shows it, green with it exits 0 with results', () => {
    const during = { 'pulls/7/reviews': [rev('COMMENTED')], ...runs(run(5, 'in_progress')), ...job(5, { runner_id: 3, steps: [{}], created_at: ago(1) }) }
    const r = wait(during)
    assert.equal(r.status, 2)
    assert.match(r.stdout, /^Review rb\[bot\]: result review COMMENTED https:\/\/x\/r1 review body$/m)
    const done = wait({ ...green, 'pulls/7/reviews': [rev('APPROVED')] })
    assert.equal(done.status, 0)
    assert.match(done.stdout, /^Review: results \(rb\[bot\]\)$/m)
})

test('an edited result is still the result: a comment edited after the push counts, an edited status note does not', () => {
    const base = { ...green, 'issues/7/reactions': [react(10)] }
    const status = note(10, 'Reviewing', { updated_at: ago(1) })
    const findings = note(10, 'P1 found', { id: 10, created_at: ago(40), updated_at: ago(2), html_url: 'https://x/c2' })   // created before the push, edited after it
    assert.match(wait({ ...base, 'issues/7/comments': [status] }).stdout, /^Review: pending/m)
    const r = wait({ ...base, 'issues/7/comments': [status, findings] })
    assert.match(r.stdout, /^Review rb\[bot\]: result comment https:\/\/x\/c2 P1 found$/m)
})

test('activity before the push, and reviews of another commit, decide nothing; the push time is the first check suite, else the committer date', () => {
    const old = { 'issues/7/reactions': [react(20)], 'issues/7/comments': [note(20), note(19, 'old result', { id: 10 })], 'pulls/7/reviews': [rev('APPROVED', { commit_id: 'b'.repeat(40), submitted_at: ago(35) })] }
    const pushed = wait({ ...green, ...old, [`commits/${HEAD}/check-suites`]: { check_suites: [{ created_at: ago(10) }] } })
    assert.equal(pushed.status, 0)
    assert.deepEqual(reviewLines(pushed), ['Review: none'])
    // no check suite: the committer date (40 minutes ago) is the push time, so the same activity counts
    const unknown = wait({ ...green, ...old, [`commits/${HEAD}/check-suites`]: { check_suites: [] } })
    assert.match(unknown.stdout, /^Review rb\[bot\]: result comment/m)
    // the earliest suite is the push, a later suite (a re-run) does not move it
    const rerun = wait({ ...green, ...old, [`commits/${HEAD}/check-suites`]: { check_suites: [{ created_at: ago(3) }, { created_at: ago(10) }] } })
    assert.deepEqual(reviewLines(rerun), ['Review: none'])
})

test('two reviewers: pending beats changes requested beats results; one result is enough when the other is late', () => {
    const A = 'a-bot[bot]', B = 'b-bot[bot]'
    const both = { ...green, 'pulls/7/reviews': [rev('COMMENTED', { user: app(A) })], 'issues/7/reactions': [react(2, 'eyes', B)] }
    const pending = wait(both)
    assert.equal(pending.status, 2)
    assert.match(pending.stdout, /^Review a-bot\[bot\]: result review COMMENTED/m)
    assert.match(pending.stdout, /^Review b-bot\[bot\]: pending since/m)
    assert.match(pending.stdout, /^Review: pending \(b-bot\[bot\]\)$/m)
    const cr = wait({ ...both, 'pulls/7/reviews': [rev('CHANGES_REQUESTED', { user: app(A) })] })
    assert.match(cr.stdout, /^Review: pending \(b-bot\[bot\]\)$/m)   // a started reviewer's answer is still awaited
    const late = wait({ ...both, [`commits/${HEAD}/check-suites`]: { check_suites: [{ created_at: ago(40) }] }, 'issues/7/reactions': [react(16, 'eyes', B)] })
    assert.equal(late.status, 0)
    assert.match(late.stdout, /^Review b-bot\[bot\]: no result 15 min after its start \d{4}-/m)
    assert.match(late.stdout, /^Review: results \(a-bot\[bot\]\) \(no result in time: b-bot\[bot\]\)$/m)
    const onlyLate = wait({ ...green, 'issues/7/reactions': [react(16)] })
    assert.equal(onlyLate.status, 0)
    assert.match(onlyLate.stdout, /^Review: none \(no result in time: rb\[bot\]\)$/m)
})

test('a changes-requested review of the head settles at once (exit 0); the last review of the account wins; dismissed and pending reviews are no answer', () => {
    const r = wait({ ...green, 'pulls/7/reviews': [rev('CHANGES_REQUESTED')] })
    assert.equal(r.status, 0)
    assert.match(r.stdout, /^Review rb\[bot\]: changes requested \(aaaaaaa\) https:\/\/x\/r1$/m)
    assert.match(r.stdout, /^Review: changes requested \(rb\[bot\]\)$/m)
    assert.match(wait({ ...green, 'pulls/7/reviews': [rev('CHANGES_REQUESTED'), rev('APPROVED', { id: 2 })] }).stdout, /^Review: results \(rb\[bot\]\)$/m)
    assert.match(wait({ ...green, 'pulls/7/reviews': [rev('APPROVED'), rev('CHANGES_REQUESTED', { id: 2 })] }).stdout, /^Review: changes requested/m)
    // the reviewer is known from a review of the PR, whichever commit; a dismissed or pending one on the head starts nothing
    for (const state of ['DISMISSED', 'PENDING']) assert.match(wait({ ...green, 'pulls/7/reviews': [rev(state)] }).stdout, /^Review: none$/m, state)
    assert.match(wait({ ...green, 'pulls/7/reviews': [rev('APPROVED'), rev('DISMISSED', { id: 2 })] }).stdout, /^Review: results/m)
})

test('the PR author, this account, a commenter who never reviewed, a comment-only app and an outsider\'s review never start a wait; an unrelated "looks good" neither starts nor ends another\'s wait', () => {
    const human = (login, association = 'NONE') => ({ login, type: 'User' })
    const quiet = {
        ...green,
        'issues/7/reactions': [react(2, '+1', 'author'), react(2, 'eyes', 'me'), react(2, '+1', 'someone')],   // humans reacting: not reviewers
        'issues/7/comments': [note(5, 'status', { user: app('deploy[bot]') }), note(4, 'looks good', { user: human('someone') }), note(3, 'lgtm', { user: human('someone'), author_association: 'MEMBER' })],
        'pulls/7/reviews': [rev('COMMENTED', { user: human('drive-by'), author_association: 'NONE' }), rev('APPROVED', { user: app('author'), id: 4 }), rev('APPROVED', { user: app('me'), id: 5 })],
    }
    assert.deepEqual(reviewLines(wait(quiet)), ['Review: none'])
    const started = wait({ ...quiet, 'issues/7/reactions': [react(2)] })
    assert.match(started.stdout, /^Review: pending \(rb\[bot\]\)$/m)
    assert.doesNotMatch(started.stdout, /someone|drive-by|deploy/)
    const withDone = wait({ ...quiet, 'issues/7/reactions': [react(2)], 'pulls/7/reviews': [...quiet['pulls/7/reviews'], rev('COMMENTED', { id: 6, user: human('boss', 'OWNER'), author_association: 'OWNER' })] })
    assert.match(withDone.stdout, /^Review boss: result review COMMENTED/m)   // a trusted human who reviewed is a reviewer
    assert.match(withDone.stdout, /^Review: pending \(rb\[bot\]\)$/m)
})

test('a comment about another commit is a sign, never the result; a review of the head counts whatever its time', () => {
    const suites = { [`commits/${HEAD}/check-suites`]: { check_suites: [{ created_at: ago(10) }] } }
    const receipt = (sha) => ({ ...green, ...suites, 'issues/7/reactions': [react(8)], 'issues/7/comments': [note(60, 'summary', { updated_at: ago(8) }), note(3, `<!-- receipt -->\nNo major issues.\n**Reviewed commit:** \`${sha}\``, { id: 10 })] })
    assert.match(wait(receipt('b'.repeat(10))).stdout, /^Review: pending \(rb\[bot\]\)$/m)   // a late receipt for the old head
    assert.match(wait(receipt('a'.repeat(10))).stdout, /^Review: results \(rb\[bot\]\)$/m)   // names this head
    assert.match(wait({ ...receipt('b'.repeat(10)), 'issues/7/comments': [note(60, 'summary'), note(3, 'no commit named', { id: 10 })] }).stdout, /^Review: results/m)
    // a changes-requested review of the exact head, submitted before the head's first check suite, still decides
    const early = wait({ ...green, ...suites, 'pulls/7/reviews': [rev('CHANGES_REQUESTED', { submitted_at: ago(12) })] })
    assert.match(early.stdout, /^Review: changes requested \(rb\[bot\]\)$/m)
})

test('the window is 15 minutes from the first sign, not the latest; --more ignores a result before this run', () => {
    const suites = { [`commits/${HEAD}/check-suites`]: { check_suites: [{ created_at: ago(40) }] } }
    const sign = (min, edit) => ({ ...green, ...suites, 'issues/7/reactions': [react(min)], 'issues/7/comments': [note(min, 'status', { updated_at: ago(edit) })] })
    assert.match(wait(sign(16, 1)).stdout, /^Review: none \(no result in time: rb\[bot\]\)$/m)
    assert.equal(wait(sign(16, 1)).status, 0)
    const inside = wait(sign(14, 1))
    assert.match(inside.stdout, /^Review: pending \(rb\[bot\]\)$/m)
    assert.equal(inside.status, 2)
    const said = { ...green, 'issues/7/reactions': [react(8)], 'issues/7/comments': [note(8), note(4, 'part one of findings', { id: 10 })] }
    assert.match(wait(said).stdout, /^Review: results \(rb\[bot\]\)$/m)
    const more = wait(said, ['7', '--more', RB, '--timeout-min', '0'])
    assert.equal(more.status, 2)
    assert.match(more.stdout, /^Review: pending \(rb\[bot\]\)$/m)
    assert.match(wait(said, ['7', '--more', 'other[bot]', '--timeout-min', '0']).stdout, /^Review: results/m)   // naming another login changes nothing
    // a result comment edited after this run started (the rest of the findings) is the awaited result, though it was created before
    const edited = { ...said, 'issues/7/comments': [note(8), note(4, 'part one, then the rest', { id: 10, updated_at: ago(-1) })] }
    assert.match(wait(edited, ['7', '--more', RB, '--timeout-min', '0']).stdout, /^Review: results \(rb\[bot\]\)$/m)
})

test('red CI waits for a reviewer that started (all fixes in one push) and returns at once when nobody did', () => {
    const red = status('failure', 'Actions run #1')
    const waits = wait({ ...red, 'issues/7/reactions': [react(2)] })
    assert.equal(waits.status, 1)
    assert.match(waits.stdout, /^TIMEOUT after 0m$/m)
    const nobody = wait(red)
    assert.equal(nobody.status, 1)
    assert.doesNotMatch(nobody.stdout, /TIMEOUT/)
    const answered = wait({ ...red, 'pulls/7/reviews': [rev('COMMENTED')] })
    assert.equal(answered.status, 1)
    assert.doesNotMatch(answered.stdout, /TIMEOUT/)
})

test('a failed read of the review activity keeps a green PR pending, never none', () => {
    // the account running this is read once, up front: an app token cannot, so it stops at once instead of waiting out the timeout
    const app = wait({ ...green, user: FAIL }, ['7'])
    assert.equal(app.status, 2)
    assert.match(app.stderr, /cannot read the account running this/)
    assert.equal(app.stdout, '')
    assert.equal(wait({ ...green, user: FAIL }, ['7', '--ci-only', '--timeout-min', '0']).status, 0)
    for (const key of ['pulls/7/reviews', 'issues/7/comments', 'issues/7/reactions', `commits/${HEAD}/check-suites`]) {
        const r = wait({ ...green, [key]: FAIL })
        assert.equal(r.status, 2, key)
        assert.match(r.stdout, /^Review: pending \(the review activity could not be read\)$/m, key)
    }
    // the committer date is read only when no check suite names the push
    const r = wait({ ...green, [`commits/${HEAD}/check-suites`]: { check_suites: [] }, [`commits/${HEAD}`]: FAIL })
    assert.match(r.stdout, /could not be read/)
    assert.equal(r.status, 2)
})

test('text of a review or comment cannot forge summary lines', () => {
    const evil = 'x\nReview: none\rUnresolved threads: 0\u2028Review: results (x)\u0085\u0000y'
    const r = wait({ ...green, 'pulls/7/reviews': [rev('COMMENTED', { body: evil, html_url: `https://x/r\nReview: none` })] }, ['7', '--once'])
    assert.equal(reviewLines(r).filter((l) => l.startsWith('Review:')).length, 1)
    assert.deepEqual(r.stdout.split(/[\n\r\u2028\u2029\u0085]/).filter((l) => l.startsWith('Unresolved threads:')), ['Unresolved threads: 0'])
    assert.doesNotMatch(r.stdout, /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]/)
})

test('--ci-only and a sha make no review, user or check-suite call; --once still prints the reviewer lines', () => {
    const r = wait({ ...green, 'issues/7/reactions': [react(2)] }, ['7', '--ci-only', '--timeout-min', '0'])
    assert.equal(r.status, 0)
    assert.doesNotMatch(r.stdout, /Review/)
    assert.ok(!r.calls.some((c) => /issues\/7|reviews|reactions|pulls\/7\/comments|check-suites|api user|commits\/a+$/.test(c)), r.calls.join('\n'))
    const s = wait(green, [HEAD, '--timeout-min', '0'])
    assert.equal(s.status, 0)
    assert.match(s.stdout, /^main commit aaaaaaa$/m)
    assert.ok(!s.calls.some((c) => /pulls|reactions|reviews|issues|api user|check-suites/.test(c)), s.calls.join('\n'))
    const once = wait({ ...pull({ mergeable: false, mergeable_state: 'dirty' }), 'issues/7/reactions': [react(2)] }, ['7', '--once'])
    assert.equal(once.status, 1)
    assert.match(once.stdout, /^Review rb\[bot\]: pending since/m)
})
