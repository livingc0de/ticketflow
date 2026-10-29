#!/usr/bin/env node
/**
 * One blocking wait for a pull request (or a default-branch commit): returns when the merge gate is final and every external reviewer
 * that started has answered, asked for changes or run out of time, then prints one summary. Run it in the background instead of polling in turns.
 *
 * Usage: pr-wait.mjs <pr | 40-hex sha> [--once] [--ci-only] [--timeout-min N] [--more <login>]... [--config f]
 *   --once         one poll; the exit code comes from CI only (reviewer lines are still printed unless --ci-only)
 *   --ci-only      do not read or wait for reviewers. A sha (a default-branch commit) implies it and makes no PR calls.
 *   --timeout-min  how long to wait (default 45)
 *   --more         this reviewer said more is coming, or posted only a status note: only what it posts or edits after this run
 *                  started counts as its result
 *
 * The verdict is the commit status `gate.context`. Check runs of the Actions app are read only to tell a run that Actions refused
 * (billing: no runner, no steps, the billing annotation; or queued 20 minutes without a runner) from a real red one.
 * A failed read is a pending poll, never a verdict.
 *
 * External reviewers are observed, never configured or invoked. One counts when it is an app (a `[bot]` login, or type Bot) that
 * commented, reviewed or reacted on the PR (including standalone inline comments on the head; the agent judges whether it is a review), or an OWNER, MEMBER or
 * COLLABORATOR that reviewed it or left an inline comment on the head, other than the PR author and the account running this,
 * and it has a sign on this head: a review of it, a PR-level or inline comment, or a reaction made, or a comment edited, after the head was pushed (the first check suite of the head, else its committer
 * date). Its start is its first sign; it is waited for at most 15 minutes from that start, and only its own result ends its wait: a
 * review of the head (whatever its time: it can only exist after the push), else its latest comment with visible text, its first one
 * included, counted at its last edit, that names the head or no commit at all; its first comment on this head (a new one, or an old one
 * edited after the push), unchanged since, is `first comment` while the window runs (merge --reviewed-by waits for more; runs in one
 * checkout share what they saw through a file in the git dir). A reaction is a sign, never a result. A comment that names only other
 * commits starts the wait but never ends it. A later edit does not restart the window. A last review of the head that is
 * CHANGES_REQUESTED is `changes requested` (settled, exit 0: merge refuses it). Activity before the push, a review of another commit,
 * and anyone else's activity are ignored.
 * It prints one `Review <login>: <state>` line per such reviewer (`pending since ..`, `result <review STATE | comment | first comment> <url> <first line>`,
 * `changes requested (<sha7>) <url>`, `no result 15 min after its start ..`), then `Review:`: `pending (<logins>)`, else `changes requested (<logins>)`,
 * else `results (<logins>)`, else `none`, with ` (no result in time: <logins>)` after results or none. A failed read prints
 * `Review: pending (the review activity could not be read)`. A result says that a reviewer answered, not what it concluded: the
 * agent reads it. In PR mode (not `--ci-only`) it also prints `Unresolved threads: <n | unknown>` and lists them for
 * `thread.mjs`; `unknown` is a failed read or more than 100 threads, and `merge` refuses it.
 *
 * Exit: 0 = CI green and no started reviewer pending (results, changes requested, late or none); 1 = CI red (after the started
 * reviewers answered or ran out of time), or the PR conflicts with / is behind the default branch; 2 = timed out, still pending, a draft
 * in local-first mode, (sha) superseded, or, at once, the account running this cannot be read (`gh api user`, e.g. an app token;
 * `--ci-only` skips that read); 3 = Actions refused the run, so `local-verify` may take over ("Fallback: allowed" in the summary).
 * Usage and config errors exit 2 before any call.
 */

import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { configPath, loadConfig } from '../lib/config.mjs'
import { gql } from '../lib/gh.mjs'

const ACTIONS_APP_ID = 15368
const TRUSTED = new Set(['OWNER', 'MEMBER', 'COLLABORATOR'])
const BILLING = /recent account payments have failed|spending limit/i
const STUCK_MS = 20 * 60_000
const POLL_SEC = '60'

const usage = 'usage: pr-wait.mjs <pr | 40-hex sha> [--once] [--ci-only] [--timeout-min N] [--more <login>]... [--config f]'
let cfg, target, once, ciOnly, timeoutMin, more
try {
    const { values, positionals } = parseArgs({
        options: { once: { type: 'boolean' }, 'ci-only': { type: 'boolean' }, 'timeout-min': { type: 'string' }, more: { type: 'string', multiple: true }, config: { type: 'string' } },
        allowPositionals: true,
    })
    ;[target] = positionals
    if (positionals.length !== 1 || !/^(\d+|[0-9a-f]{40})$/.test(target)) throw new Error(usage)
    if (values['timeout-min'] !== undefined && !/^\d+$/.test(values['timeout-min'])) throw new Error(usage)
    timeoutMin = Number(values['timeout-min'] ?? 45)
    if ((values.more ?? []).some((l) => !/^[\w.[\]-]+$/.test(l))) throw new Error(usage)
    more = new Set(values.more ?? [])
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
const fresh = () => ({ head: '', draft: false, gate: null, verify: null, fallback: null, why: 'Actions has not refused the run', notes: [], reviewers: null, threads: null, author: null })

/** Decides CI for the head and fills `S`. Returns green | red | pending | fallback | conflict | behind | draft | superseded. */
function pollCi(S) {
    let pull = null
    if (sha) S.head = target
    else {
        pull = api(`${R}/pulls/${target}`)
        S.head = pull.head.sha
        S.draft = pull.draft === true
        S.author = pull.user?.login
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

/** The first line of text with visible content; the text is HTML-comment free and cut to 160 characters. */
const strip = (b) => String(b ?? '').replace(/<!--[\s\S]*?-->/g, '')
const visible = (b) => /\S/.test(strip(b))
const firstLine = (b) => strip(b).split(/[\n\r\u2028\u2029\u0085]/).find((l) => /\S/.test(l))?.slice(0, 160) ?? ''
// a reaction reports an app as type User, so the login decides
const isApp = (u) => u?.type === 'Bot' || /\[bot\]$/.test(u?.login ?? '')

const WINDOW_MS = 15 * 60_000
const launched = Date.now()
let reviewerPendingSince = null
let reviewerWaitMs = 0
// The first sign and first answer seen per head and reviewer, shared by every run in this checkout (merge's own --once check too),
// because the API keeps only a comment's last edit. A file in the git dir, never committed; missing or unreadable is an empty cache.
const CACHE_DAYS = 2
const cacheFile = (() => { const r = ciOnly ? null : spawnSync('git', ['rev-parse', '--absolute-git-dir'], { encoding: 'utf8' }); return r?.status === 0 ? join(r.stdout.trim(), 'ticketflow-pr-wait.json') : null })()
const firstSeen = new Map((() => { try { return Object.entries(JSON.parse(readFileSync(cacheFile, 'utf8'))).filter(([, t]) => Number.isFinite(t)) } catch { return [] } })())
function saveSeen() {
    if (!cacheFile) return
    const keep = [...firstSeen].filter(([, t]) => Number.isFinite(t) && t > Date.now() - CACHE_DAYS * 86_400_000)
    try { writeFileSync(cacheFile, JSON.stringify(Object.fromEntries(keep))) } catch { /* an unwritable cache only costs the memory */ }
}
const pushed = new Map()
let me

/** When this head was pushed: the first check suite created for it (a later run does not move it), else the committer date. */
function pushedAt(head) {
    if (!pushed.has(head)) {
        const t = Math.min(...(api(`${R}/commits/${head}/check-suites?per_page=100`).check_suites ?? []).map((x) => ms(x.created_at)).filter((x) => x > 0))
        if (t === Infinity) return ms(api(`${R}/commits/${head}`).commit.committer.date)   // shortcut: no suite (no CI yet) falls back to the committer date, which can predate the push; read the push event if a repo runs PRs without checks
        pushed.set(head, t)
    }
    return pushed.get(head)
}

/**
 * Fills S.reviewers with one { login, state, text } per reviewer on this head: an app with PR-level activity,
 * or a trusted human with a submitted review or inline comment, and a sign since the push.
 */
function pollReviewers(S) {
    const since = pushedAt(S.head)
    const comments = api(`${R}/issues/${target}/comments`, true)
    const reactions = api(`${R}/issues/${target}/reactions`, true)
    const reviews = api(`${R}/pulls/${target}/reviews`, true).filter((x) => x.state !== 'PENDING' && x.state !== 'DISMISSED')
    const inline = api(`${R}/pulls/${target}/comments`, true)
    const outside = (l) => l && l !== me && l !== S.author
    // A comment counts when it was posted after the push, else when it was edited after it.
    const at = (c) => (ms(c.created_at) > since ? ms(c.created_at) : ms(c.updated_at))
    const edited = (c) => Math.max(ms(c.created_at), ms(c.updated_at ?? c.created_at))
    // Inline findings belong to a commit. An edit to an older commit's finding is not evidence for this head.
    const onHeadInline = inline.filter((c) => c.commit_id === S.head && at(c) > since)
    // Every app active on the PR is listed (deploy and coverage bots too); trusted humans count only if they reviewed or left an inline finding.
    const known = new Set([...reviews.filter((x) => isApp(x.user) || TRUSTED.has(x.author_association)),
        ...reactions.filter((x) => isApp(x.user)), ...comments.filter((c) => isApp(c.user)),
        ...onHeadInline.filter((c) => isApp(c.user) || TRUSTED.has(c.author_association))].map((x) => x.user?.login).filter(outside))
    // shortcut: a comment that names commits (7-40 hex, hidden markup too) but not this head is about another commit: a sign, never the
    // result; a hex word ("defaced") makes a result wait out its window, the safe side; revisit if a reviewer names commits unrelated to its review
    const aboutOther = (c) => { const named = String(c.body ?? '').match(/\b[0-9a-f]{7,40}\b/g) ?? []; return named.length > 0 && !named.some((x) => S.head.startsWith(x)) }
    S.reviewers = [...known].sort().map((login) => {
        const mine = (x) => x.user?.login === login
        const onHead = reviews.filter((x) => mine(x) && x.commit_id === S.head)
        const own = [...comments.filter(mine), ...onHeadInline.filter(mine)]
        const signs = [...onHead.map((x) => ms(x.submitted_at)), ...[...own.map(at), ...reactions.filter(mine).map((x) => ms(x.created_at))].filter((t) => t > since)]   // a review of the head counts whatever its time
        if (!signs.length) return null
        const key = `${cfg.repo}#${target} ${S.head} ${since} ${login}`   // per repo and PR: the cache is shared by every run in the checkout
        const start = Math.min(firstSeen.get(key) ?? Infinity, ...signs)
        firstSeen.set(key, start)
        const last = onHead.at(-1)
        if (last?.state === 'CHANGES_REQUESTED') return { login, state: 'changes', text: `changes requested (${S.head.slice(0, 7)}) ${last.html_url}` }
        const after = more.has(login) ? launched : since
        // a review of the head is the result; else its latest comment with visible text, at its last edit (the start above keeps the first
        // sign). Its first comment, unedited, is shown at once (it can hold the findings) but marked `first comment` while the window runs:
        // it may be the status note of a review still running, so the agent reads it (--more for a status note) and merge --reviewed-by waits
        const latest = (xs) => xs.sort((a, b) => a[0] - b[0]).at(-1)
        // shortcut: "first" is the reviewer's first comment activity on this head (a new comment, or its old summary edited), kept while
        // unchanged since; a run without the shared cache knows only the last edit, so a reused summary stays unconfirmed up to 15 minutes
        // after it, and a status note edited while the review runs reads as an answer; revisit if a review app edits its note mid-run
        const firstKey = `${key} comment`
        const firstAnswer = Math.min(firstSeen.get(firstKey) ?? Infinity, ...own.filter((c) => visible(c.body) && !aboutOther(c)).map(at).filter((t) => t > since))
        firstSeen.set(firstKey, firstAnswer)
        const kind = (c) => (edited(c) <= firstAnswer && Date.now() < start + WINDOW_MS ? 'first comment' : 'comment')
        const said = latest(onHead.filter((x) => !more.has(login) || ms(x.submitted_at) > launched).map((x) => [ms(x.submitted_at), `review ${x.state} ${x.html_url} ${firstLine(x.body)}`]))
            ?? latest(own.filter((c) => edited(c) > after && visible(c.body) && !aboutOther(c)).map((c) => [edited(c),
                `${kind(c) === 'comment' && c.commit_id === S.head ? 'inline comment' : kind(c)} ${c.html_url} ${c.commit_id === S.head ? `${c.path}:${c.line ?? c.original_line} ` : ''}${firstLine(c.body)}`]))
        if (said) return { login, state: 'result', text: `result ${said[1]}` }
        const iso = (t) => new Date(t).toISOString()
        if (Date.now() >= start + WINDOW_MS) return { login, state: 'late', text: `no result 15 min after its start ${iso(start)}` }
        return { login, state: 'pending', text: `pending since ${iso(start)} (at most until ${iso(start + WINDOW_MS)})` }
    }).filter(Boolean)
    saveSeen()
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
            return flat(`  [${x.id}] ${x.path}:${x.line ?? x.originalLine} @${c?.author?.login ?? 'unknown'} ${firstLine(c?.body)}`)
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
    if (S.reviewers === 'unknown') console.log('Review: pending (the review activity could not be read)')
    else if (S.reviewers) {
        for (const x of S.reviewers) console.log(flat(`Review ${x.login}: ${x.text}`))
        const named = (state) => S.reviewers.filter((x) => x.state === state).map((x) => x.login).join(', ')
        const late = named('late') ? ` (no result in time: ${named('late')})` : ''
        console.log(flat(`Review: ${named('pending') ? `pending (${named('pending')})` : named('changes') ? `changes requested (${named('changes')})` : named('result') ? `results (${named('result')})${late}` : `none${late}`}`))
    }
    if (S.threads === 'unknown') console.log('Unresolved threads: unknown')
    else if (S.threads) {
        console.log(`Unresolved threads: ${S.threads.length}`)
        for (const l of S.threads.slice(0, 20)) console.log(l)
        if (S.threads.length > 20) console.log(`  ... ${S.threads.length - 20} more`)
    }
    for (const n of S.notes) console.log(n)
    console.log(`Observed reviewer wait_ms: ${ciOnly ? 'unknown' : reviewerWaitMs + (reviewerPendingSince === null ? 0 : Date.now() - reviewerPendingSince)}`)
    if (timedOut) console.log(`TIMEOUT after ${timeoutMin}m`)
}

const CODE = { green: 0, red: 1, conflict: 1, behind: 1, pending: 2, draft: 2, superseded: 2, fallback: 3 }
if (!ciOnly) {
    try { me = api('user').login } catch { me = null }
    // an app token cannot read its own user: fail now instead of waiting the whole timeout on an unreadable review state
    if (!me) { console.error('pr-wait: cannot read the account running this (gh api user); run it with a user token, or --ci-only'); process.exit(2) }
}
const deadline = Date.now() + timeoutMin * 60_000
for (;;) {
    const S = fresh()
    let kind = 'pending'
    try { kind = pollCi(S) } catch { S.why = 'a read failed' }
    if (!ciOnly && (once || ['green', 'red', 'pending'].includes(kind)) && S.head) {
        try { pollReviewers(S) } catch { S.reviewers = 'unknown' }
        pollThreads(S)
    }
    const waiting = Array.isArray(S.reviewers) && S.reviewers.some((x) => x.state === 'pending')
    // Track only time this invocation actually observed a pending reviewer, not CI time or time before it started.
    if (waiting && reviewerPendingSince === null) reviewerPendingSince = Date.now()
    if (!waiting && reviewerPendingSince !== null) { reviewerWaitMs += Date.now() - reviewerPendingSince; reviewerPendingSince = null }
    const reviewed = S.reviewers !== 'unknown' && !waiting
    const settled = kind === 'green' || kind === 'red' ? once || reviewed : kind !== 'pending'   // red waits for the reviewers: all fixes go into one push
    const timedOut = !settled && !once && Date.now() >= deadline
    if (settled || once || timedOut) {
        print(S, timedOut)
        process.exit(kind === 'green' && !once && !reviewed ? 2 : CODE[kind])
    }
    spawnSync('sleep', [POLL_SEC])
}
