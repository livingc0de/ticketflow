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

const status = (state, description, target_url = 'u') => ({ [`commits/${HEAD}/status`]: { statuses: [{ context: 'other', state: 'failure', description: 'x' }, { context: 'ci/gate', state, description, target_url }] } })
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
    }
}
// Fixture keys are relative to repos/o/r/; `pulls` is shorthand for 'pulls/7'.
function wait(fix = {}, args = ['7', '--timeout-min', '0'], over = {}) {
    const dir = tempDir('pr-wait-')
    const { pulls, ...rest } = fix
    const map = { ...baseFixtures(), ...rest, ...(pulls ? { 'pulls/7': pulls[7] } : {}) }
    const gh = fakeGh(dir, Object.fromEntries(Object.entries(map).map(([k, v]) => [`repos/o/r/${k}`, v])))
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
    assert.match(r.stdout, /^ci\/gate: none$/m)
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
    const r = wait({ ...runs(run(5, 'in_progress')), ...status('success', 'actions #1') })
    assert.equal(r.status, 0)
    assert.match(r.stdout, /^ci\/gate: success actions #1 u$/m)
    assert.equal(code(status('failure', 'actions #1')), 1)
    assert.equal(code(status('error', 'actions #1')), 1)
    assert.equal(code(status('failure', 'whatever')), 1)
})

test('a verdict beats a refused run; a red that got a runner is never replaceable; a local failure is', () => {
    assert.equal(code({ ...refused(), ...status('success', 'x') }), 0)
    assert.equal(code({ ...refused(), ...status('failure', 'actions #9') }), 1)
    assert.equal(code({ ...refused(), ...status('failure', 'x') }), 1)
    const local = wait({ ...refused(), ...status('failure', 'local host1 x86_64 node 24.0.0') })
    assert.equal(local.status, 3)
    assert.equal(code({ ...status('failure', 'local host1 x86_64 node 24.0.0'), ...runs(run(5, 'in_progress')), ...job(5, { runner_id: 1, steps: [{}], created_at: ago(1) }) }), 2)
    assert.equal(code({ ...status('pending', 'actions #3'), ...refused() }), 3)
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
    assert.equal(code({ ...refused(), ...status('failure', 'actions #8') }), 1)
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
    assert.equal(code(status('failure', 'actions #1'), ['7', '--once'], withBot), 1)
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
    const red = wait(status('failure', 'actions #1'), undefined, withBot)
    assert.equal(red.status, 1)
    assert.match(red.stdout, /^TIMEOUT after 0m$/m)
    assert.equal(code({ ...status('failure', 'actions #1'), 'pulls/7/reviews': [{ user: { login: 'review-bot[bot]' }, commit_id: HEAD }] }, undefined, withBot), 1)
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
    assert.equal(code(status('failure', 'actions #1'), [HEAD, '--timeout-min', '0']), 1)
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
    const r = wait({ [`commits/${HEAD}/status`]: { statuses: [{ context: 'my/gate', state: 'success', description: 'actions #1' }, { context: 'ci/gate', state: 'failure', description: 'x' }] } }, undefined, over)
    assert.equal(r.status, 0)
    assert.match(r.stdout, /^my\/gate: success actions #1$/m)
    const q = wait(runs(), undefined, over)
    assert.ok(q.calls.some((c) => c.includes('check-runs?check_name=Build%20job&app_id=15368')), q.calls.join('\n'))
})

test('the check-run path carries the Actions app id', () => {
    assert.ok(wait().calls.some((c) => c.endsWith('check-runs?check_name=Verify&app_id=15368')))
})

test('inline findings: only the reviewers, first non-blank line, 160 characters, only after the round start', () => {
    const c = (id, login, min, body, line = 3) => ({ id, user: { login }, created_at: ago(min), path: 'a.js', line, original_line: 9, body })
    const long = 'x'.repeat(200)
    const r = wait({ ...status('success', 'x'), 'pulls/7/comments': [
        c(1, 'review-bot[bot]', 5, `\n\n${long}\nsecond line`), c(2, 'someone', 5, 'not mine'), c(3, 'review-bot[bot]', 120, 'before the PR'), { ...c(4, 'review-bot[bot]', 4, 'orig'), line: null },
    ] }, ['7', '--once'], withBot)
    const out = r.stdout.split('\n')
    const at = out.findIndex((l) => l.startsWith('Inline findings since '))
    assert.ok(at > 0)
    assert.deepEqual(out.slice(at + 1, at + 3), [`  [1] a.js:3 ${'x'.repeat(160)}`, '  [4] a.js:9 orig'])
    assert.equal(out[at + 3], '')
    const failed = wait({ ...status('success', 'x'), 'pulls/7/comments': FAIL }, ['7', '--once'], withBot)
    assert.match(failed.stdout, /^\(listing failed: read the PR's review comments directly\)$/m)
})

test('the loop sleeps and polls again until the gate is final', () => {
    const dir = tempDir('pr-wait-sleep-')
    const gh = fakeGh(dir, Object.fromEntries(Object.entries({
        ...baseFixtures(), 'pulls/7': seq(pull({ mergeable: null, mergeable_state: 'unknown' }).pulls[7], pull().pulls[7]),
        ...status('success', 'x'),
    }).map(([k, v]) => [`repos/o/r/${k}`, v])))
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
