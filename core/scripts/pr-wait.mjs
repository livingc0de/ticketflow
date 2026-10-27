#!/usr/bin/env node
/**
 * One blocking wait for a pull request (or a default-branch commit): returns when the merge gate is final and the configured
 * reviewers are done, unavailable or silent, then prints one summary. Run it in the background instead of polling in turns.
 *
 * Usage: pr-wait.mjs <pr | 40-hex sha> [--once] [--ci-only] [--timeout-min N] [--config f]
 *   --once         one poll; the exit code comes from CI only (reviewer lines are still printed unless --ci-only)
 *   --ci-only      do not read or wait for reviewers. A sha (a default-branch commit) implies it and makes no PR calls.
 *   --timeout-min  how long to wait (default 45)
 *
 * The verdict is the commit status `gate.context`. Check runs of the Actions app are read only to tell a run that Actions refused
 * (billing: no runner, no steps, the billing annotation; or queued 20 minutes without a runner) from a real red one.
 * A failed read is a pending poll, never a verdict.
 *
 * A reviewer's last review on the head decides: CHANGES_REQUESTED prints `Review: changes requested (<names>)` (settled, exit 0: merge
 * refuses it); a dismissed or pending review counts for nothing. The summary is `pending`, else `changes requested`, else `standin
 * needed`, else `done`. In PR mode (not `--ci-only`) it also prints `Unresolved threads: <n | unknown>` and lists them for
 * `thread.mjs`; `unknown` is a failed read or more than 100 threads, and `merge` refuses it.
 *
 * Exit: 0 = CI green and every reviewer done, unavailable or silent; 1 = CI red, or the PR conflicts with / is behind the default
 * branch; 2 = timed out, still pending, a draft in local-first mode, or (sha) superseded; 3 = Actions refused the run, so
 * `local-verify` may take over ("Fallback: allowed" in the summary). Usage and config errors exit 2 before any call.
 */

import { spawnSync } from 'node:child_process'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { configPath, loadConfig } from '../lib/config.mjs'
import { gql } from '../lib/gh.mjs'

const ACTIONS_APP_ID = 15368
const BILLING = /recent account payments have failed|spending limit/i
const STUCK_MS = 20 * 60_000
const POLL_SEC = '60'

const usage = 'usage: pr-wait.mjs <pr | 40-hex sha> [--once] [--ci-only] [--timeout-min N] [--config f]'
let cfg, target, once, ciOnly, timeoutMin
try {
    const { values, positionals } = parseArgs({
        options: { once: { type: 'boolean' }, 'ci-only': { type: 'boolean' }, 'timeout-min': { type: 'string' }, config: { type: 'string' } },
        allowPositionals: true,
    })
    ;[target] = positionals
    if (positionals.length !== 1 || !/^(\d+|[0-9a-f]{40})$/.test(target)) throw new Error(usage)
    if (values['timeout-min'] !== undefined && !/^\d+$/.test(values['timeout-min'])) throw new Error(usage)
    timeoutMin = Number(values['timeout-min'] ?? 45)
    once = values.once === true
    ciOnly = values['ci-only'] === true || target.length === 40
    cfg = loadConfig(values.config ?? configPath(dirname(fileURLToPath(import.meta.url))))
} catch (e) {
    console.error(`pr-wait: ${e.message}`)
    process.exit(2)
}
const sha = target.length === 40
const R = `repos/${cfg.repo}`
const base = cfg.default_branch

/** The parsed JSON of a GET through `gh api` (pages flattened when paginated); throws on a failed read. */
function api(path, paginate = false) {
    const r = spawnSync('gh', ['api', path, ...(paginate ? ['--paginate', '--slurp'] : [])], { encoding: 'utf8', maxBuffer: 1 << 26 })
    if (r.status !== 0) throw new Error(`gh api ${path} failed`)
    const data = JSON.parse(r.stdout)
    return paginate ? data.flat() : data
}

/** Text from GitHub that is printed in the summary: control characters and line separators become one space, so it can never forge a summary line. */
const flat = (v) => String(v ?? '').replace(/[\p{Cc}\u2028\u2029]+/gu, ' ')
const ms = (iso) => Date.parse(iso)
const fresh = () => ({ head: '', draft: false, gate: null, verify: null, fallback: null, why: 'Actions has not refused the run', notes: [], reviewers: null, threads: null })

/** Decides CI for the head and fills `S`. Returns green | red | pending | fallback | conflict | behind | draft | superseded. */
function pollCi(S) {
    let pull = null
    if (sha) S.head = target
    else {
        pull = api(`${R}/pulls/${target}`)
        S.head = pull.head.sha
        S.draft = pull.draft === true
        S.created = pull.created_at
        if (cfg.verify.mode === 'local-first' && S.draft) { S.notes.push(`Draft: CI skips drafts; gh pr ready ${target}`); return 'draft' }
        if (pull.mergeable === false) { S.notes.push(`PR #${target} conflicts with ${base}: merge ${base} into the branch`); return 'conflict' }
    }
    S.gate = api(`${R}/commits/${S.head}/status?per_page=100`).statuses.find((s) => s.context === cfg.gate.context) ?? null
    const g = S.gate
    S.why = 'the gate status is not final'

    if (g?.state === 'success') {
        S.why = 'the gate is green'
        if (pull?.mergeable_state === 'behind') { S.notes.push(`${base} moved: gh pr update-branch ${target} (new head, new CI)`); return 'behind' }
        if (pull && (pull.mergeable == null || pull.mergeable_state === 'unknown')) return 'pending'   // not computed yet: it could still be behind
        return 'green'
    }
    // A red that got a runner posted its own failure: a later refused re-run never makes it replaceable.
    if ((g?.state === 'failure' || g?.state === 'error') && !g.description?.startsWith('Local ')) { S.why = 'the gate failed'; return 'red' }

    S.why = 'Actions has not refused the run'
    const runs = api(`${R}/commits/${S.head}/check-runs?check_name=${encodeURIComponent(cfg.gate.check)}&app_id=${ACTIONS_APP_ID}`).check_runs
    const run = runs.reduce((a, b) => (!a || b.id > a.id ? b : a), null)
    if (!run) return 'pending'
    S.verify = `${run.id} ${run.status} ${run.conclusion ?? '-'}`
    const job = api(`${R}/actions/jobs/${run.id}`)
    const runner = job.runner_id || 0
    if (run.status !== 'completed') {
        if (!runner && Date.now() - ms(job.created_at) >= STUCK_MS) {
            S.fallback = `queued 20 min without a runner; cancel the stuck run only after the fallback has posted: gh run cancel ${job.run_id}`
            return 'fallback'
        }
        return 'pending'
    }
    if (run.conclusion === 'cancelled') {
        if (!sha) return 'pending'
        S.notes.push(`superseded: check the newest ${base} commit`)
        return 'superseded'
    }
    if (runner) { S.why = 'Verify ran on a runner'; return run.conclusion === 'failure' || run.conclusion === 'timed_out' ? 'red' : 'pending' }
    if (run.conclusion === 'failure' && !(job.steps?.length > 0)) {
        const note = api(`${R}/check-runs/${run.id}/annotations`).map((a) => a.message).find((m) => BILLING.test(m ?? ''))
        if (note) { S.fallback = `refused for billing: ${note}`; return 'fallback' }
    }
    return 'pending'
}

/** Fills S.reviewers: one { r, state, text } per configured reviewer, from the round that started at the latest re-review request. */
function pollReviewers(S) {
    const comments = api(`${R}/issues/${target}/comments`, true)
    const reviews = api(`${R}/pulls/${target}/reviews`, true)
    const reactions = cfg.reviewers.some((r) => r.no_findings_reaction) ? api(`${R}/issues/${target}/reactions`, true) : []
    const headDate = cfg.reviewers.some((r) => r.no_findings_reaction || r.stale_after_min) ? ms(api(`${R}/commits/${S.head}`).commit.committer.date) : NaN
    S.reviewers = cfg.reviewers.map((r) => {
        const asked = r.rereview_comment ? comments.filter((c) => c.body?.trim().startsWith(r.rereview_comment)).map((c) => ms(c.created_at)) : []
        const start = asked.length ? Math.max(...asked) : ms(S.created)
        const mine = (x) => x.user?.login === r.login
        const out = { r, start }
        // a reviewer often edits one summary comment in place: the time that counts is its last update
        const at = (c) => c.updated_at ?? c.created_at
        // the reviewer's last answer on the head decides; a dismissed or pending review is no answer
        const last = reviews.filter((x) => mine(x) && x.commit_id === S.head && x.state !== 'DISMISSED' && x.state !== 'PENDING').at(-1)
        if (last?.state === 'CHANGES_REQUESTED') return { ...out, state: 'changes', text: `changes requested (${S.head.slice(0, 7)})` }
        if (last) return { ...out, state: 'done', text: `done (${S.head.slice(0, 7)})` }
        if (r.no_findings_reaction && reactions.some((x) => mine(x) && x.content === r.no_findings_reaction && ms(x.created_at) > Math.max(start, headDate))) {
            return { ...out, state: 'done', text: `done (${r.no_findings_reaction} after head)` }
        }
        // the last match of done_pattern (bodies as currently edited, comments by last update) names the commit the reviewer finished
        const all = r.done_pattern ? new RegExp(r.done_pattern.source, `${r.done_pattern.flags}g`) : null
        const sha = all && comments.filter(mine).sort((a, b) => ms(at(a)) - ms(at(b))).flatMap((c) => [...(c.body ?? '').matchAll(all)]).at(-1)?.groups?.sha?.toLowerCase()
        if (sha?.length >= 7 && S.head.startsWith(sha)) return { ...out, state: 'done', text: `done (state ${sha.slice(0, 7)})` }
        const gone = r.unavailable_pattern && comments.find((c) => mine(c) && ms(at(c)) > start && r.unavailable_pattern.test(c.body ?? ''))
        if (gone) return { ...out, state: 'unavailable', text: `unavailable since ${at(gone)}` }
        const quiet = Date.now() - Math.max(start, headDate)
        if (r.stale_after_min && quiet >= r.stale_after_min * 60_000) return { ...out, state: 'silent', text: `silent ${Math.floor(quiet / 60_000)} min` }
        return { ...out, state: 'pending', text: 'pending' }
    })
}

/** Fills S.threads with the unresolved review threads of any author, or 'unknown' when they cannot be told (a failed read, or more than 100). */
function pollThreads(S) {
    const [owner, name] = cfg.repo.split('/')
    try {
        // shortcut: the first 100 threads only, more than that reads as unknown (merge refuses); paginate when a PR really has that many
        const t = gql('query ReviewThreads($o:String!,$n:String!,$p:Int!){ repository(owner:$o,name:$n){ pullRequest(number:$p){ reviewThreads(first:100){ totalCount nodes{ id isResolved path line originalLine comments(first:1){ nodes{ author{ login } body } } } } } } }',
            { o: owner, n: name, p: Number(target) }).repository.pullRequest.reviewThreads
        if (!(t.totalCount <= 100) || !Array.isArray(t.nodes)) throw new Error('too many threads')
        S.threads = t.nodes.filter((x) => !x.isResolved).map((x) => {
            const c = x.comments.nodes[0]
            return flat(`  [${x.id}] ${x.path}:${x.line ?? x.originalLine} @${c?.author?.login ?? 'unknown'} ${(c?.body ?? '').split(/[\n\r\u2028\u2029\u0085]/).find((l) => /\S/.test(l))?.slice(0, 160) ?? ''}`)
        })
    } catch {
        S.threads = 'unknown'
    }
}

function print(S, timedOut) {
    const g = S.gate
    console.log(sha ? `${base} commit ${S.head.slice(0, 7)}` : `PR #${target} head ${S.head.slice(0, 7)} draft=${S.draft}`)
    console.log(`${cfg.gate.context}: ${g ? flat([g.state, g.description, g.target_url].filter(Boolean).join(' ')) : 'none'}`)
    console.log(`Verify: ${S.verify ?? 'none'}`)
    console.log(S.fallback ? `Fallback: allowed (${S.fallback})` : `Fallback: not allowed (${S.why})`)
    if (S.reviewers) {
        for (const x of S.reviewers) console.log(flat(`Review ${x.r.name}: ${x.text}`))
        const named = (...states) => S.reviewers.filter((x) => states.includes(x.state)).map((x) => x.r.name).join(', ')
        console.log(`Review: ${S.reviewers.some((x) => x.state === 'pending') ? 'pending' : named('changes') ? `changes requested (${named('changes')})` : named('unavailable', 'silent') ? `standin needed (${named('unavailable', 'silent')})` : 'done'}`)
    } else if (!sha && !ciOnly && cfg.reviewers.length === 0) console.log('Review: none configured (pr-reviewer reviews)')
    if (S.threads === 'unknown') console.log('Unresolved threads: unknown')
    else if (S.threads) {
        console.log(`Unresolved threads: ${S.threads.length}`)
        for (const l of S.threads.slice(0, 20)) console.log(l)
        if (S.threads.length > 20) console.log(`  ... ${S.threads.length - 20} more`)
    }
    for (const n of S.notes) console.log(n)
    if (timedOut) console.log(`TIMEOUT after ${timeoutMin}m`)
}

const CODE = { green: 0, red: 1, conflict: 1, behind: 1, pending: 2, draft: 2, superseded: 2, fallback: 3 }
const deadline = Date.now() + timeoutMin * 60_000
for (;;) {
    const S = fresh()
    let kind = 'pending'
    try { kind = pollCi(S) } catch { S.why = 'a read failed' }
    if (!ciOnly && (once || ['green', 'red', 'pending'].includes(kind)) && S.head) {
        if (cfg.reviewers.length) {
            try { pollReviewers(S) } catch { S.reviewers = cfg.reviewers.map((r) => ({ r, state: 'pending', text: 'pending' })) }
        }
        pollThreads(S)
    }
    const reviewed = !S.reviewers || S.reviewers.every((x) => x.state !== 'pending')
    const settled = kind === 'green' || kind === 'red' ? once || reviewed : kind !== 'pending'   // red waits for the reviewers: all fixes go into one push
    const timedOut = !settled && !once && Date.now() >= deadline
    if (settled || once || timedOut) {
        print(S, timedOut)
        process.exit(kind === 'green' && !once && !reviewed ? 2 : CODE[kind])
    }
    spawnSync('sleep', [POLL_SEC])
}
