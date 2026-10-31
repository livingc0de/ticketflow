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
 * The verdict is the commit status `gate.context`. Actions workflow runs and jobs are read only to tell a run that Actions refused
 * before any runner or step (or stayed queued 20 minutes without one) from a real red one. A failed read is a pending poll,
 * never a verdict. This uses the Actions API rather than the Checks API so a fine-grained personal token can read the gate.
 *
 * External reviewers are observed, never configured or invoked. One counts when it is an app (a `[bot]` login, or type Bot) that
 * commented, reviewed or reacted on the PR (including standalone inline comments on the head; the agent judges whether it is a review), or an OWNER, MEMBER or
 * COLLABORATOR that reviewed it or left an inline comment on the head, other than the PR author and the account running this,
 * and it has a sign on this head: a review of it, a PR-level or inline comment, or a reaction made, or a comment edited, after the head was pushed (the first Actions run of the head, else its committer
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
 * `--ci-only` skips that read); 3 = Actions refused the run, so `local-verify` may take over ("Fallback: allowed" in the summary),
 * never for a pull request that changes `.github/workflows/` (exit 1, or 2 while the run is only queued).
 * Usage and config errors exit 2 before any call.
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { configPath, loadConfig } from '../lib/config.mjs'
import { gql } from '../lib/gh.mjs'

const TRUSTED = new Set(['OWNER', 'MEMBER', 'COLLABORATOR'])
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
const fresh = () => ({ head: '', pull: null, draft: false, gate: null, verify: null, fallback: null, why: 'Actions has not refused the run', notes: [], reviewers: null, threads: null, author: null })
const workflowRunMatches = (run, head, pull) => run?.head_sha === head ||
    (pull?.head?.ref && run?.event === 'pull_request' && Array.isArray(run.pull_requests) &&
        run.pull_requests.some(x => Number(x.number) === Number(target) && x.head?.sha === head))
const workflowRuns = (head, pull = null) => {
    const read = (path) => {
        const data = api(path)
        if (!Array.isArray(data.workflow_runs)) throw new Error('Actions workflow run response was malformed')
        return data.workflow_runs
    }
    const direct = read(`${R}/actions/runs?head_sha=${encodeURIComponent(head)}&per_page=100`)
    if (!pull?.head?.ref) return direct
    // pull_request workflows execute on GitHub's temporary merge commit, not necessarily the PR head, and an unrelated run on the head
    // must not hide them. The branch listing carries the associated PR and its real head SHA, so use it only with an exact match.
    const seen = new Set(direct.map(run => run?.id))
    const merged = (runs) => [...direct, ...runs.filter(run => workflowRunMatches(run, head, pull) && !seen.has(run.id))]
    const byBranch = read(`${R}/actions/runs?event=pull_request&branch=${encodeURIComponent(pull.head.ref)}&per_page=100`)
    if (byBranch.some(run => workflowRunMatches(run, head, pull))) return merged(byBranch)
    // Some GitHub responses do not honor the branch filter for pull_request runs; the
    // association filter keeps this bounded to the exact PR/head before inspecting jobs.
    return merged(read(`${R}/actions/runs?event=pull_request&per_page=100`))
}
// The rendered TicketFlow workflow; a startup failure of it has no job record, so the run itself is the evidence.
const isTicketFlowWorkflow = (run) => /^\.github\/workflows\/ci\.yml(?:@|$)/.test(run?.path ?? '')
// GitHub sets started_at even on a job it refused (= created_at, runner_id 0, no runner_name, no steps): only a runner or a step proves it ran.
const ranOnRunner = (job) => Boolean(job?.runner_id > 0 || job?.runner_name || job?.steps?.length)
const refusedBeforeRun = new Set(['failure', 'startup_failure', 'timed_out'])
// pull_request runs the workflow from the PR's own merge commit: a PR that breaks it fails at startup exactly like a refusal.
const WORKFLOW_FILE = /^\.github\/workflows\//
const NEEDS_ACTIONS = 'this pull request changes .github/workflows/: it needs a real Actions run'
function changesWorkflow(pull) {
    const files = api(`${R}/pulls/${target}/files?per_page=100`, true)
    // the list API caps at 3000 files: a bigger or moving PR mismatches the count and fails closed
    if (!Number.isSafeInteger(pull.changed_files) || files.length !== pull.changed_files || files.some((f) => typeof f?.filename !== 'string'))
        throw new Error('the pull request file list is incomplete')
    return files.some((f) => [f.filename, f.previous_filename].some((n) => typeof n === 'string' && WORKFLOW_FILE.test(n)))
}

/** Decides CI for the head and fills `S`. Returns green | red | pending | fallback | conflict | behind | draft | superseded. */
function pollCi(S) {
    let pull = null
    if (sha) S.head = target
    else {
        pull = api(`${R}/pulls/${target}`)
        S.head = pull.head.sha
        S.pull = pull
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
    // A red job that got a runner or ran a step posted its own failure: a later refused re-run never makes it replaceable.
    if ((g?.state === 'failure' || g?.state === 'error') && !g.description?.startsWith('Local ')) { S.why = 'the gate failed'; return 'red' }

    S.why = 'Actions has not refused the run'
    const candidates = []
    for (const run of workflowRuns(S.head, pull)) {
        if (!workflowRunMatches(run, S.head, pull) || !Number.isSafeInteger(run.id) || run.id < 1) throw new Error('Actions workflow run response was malformed')
        const data = api(`${R}/actions/runs/${run.id}/jobs?filter=all&per_page=100`)
        if (!Array.isArray(data.jobs) || !Number.isSafeInteger(data.total_count) || data.total_count < 0 || data.total_count > data.jobs.length)
            throw new Error(`Actions job response for run ${run.id} was malformed or incomplete`)
        const jobs = data.jobs.filter((job) => typeof job?.head_sha === 'string' &&
            (job.head_sha === S.head || job.head_sha === run.head_sha) && job.name === cfg.gate.check)
        for (const job of jobs) candidates.push({ run, job })
        // The generated workflow can fail during startup before GitHub creates any job: that run-level evidence is a candidate.
        if (!data.jobs.length && isTicketFlowWorkflow(run)) candidates.push({ run, job: null })
    }
    // the newest run decides; job ids only break ties inside a run
    const candidate = candidates.sort((a, b) => (b.run.id - a.run.id) || ((b.job?.id ?? 0) - (a.job?.id ?? 0)))[0]
    if (!candidate) return 'pending'
    const { run, job } = candidate
    const status = job?.status ?? run.status
    const conclusion = job?.conclusion ?? run.conclusion
    const createdAt = job?.created_at ?? run.created_at
    const ran = ranOnRunner(job)
    S.verify = `${job?.id ?? run.id} ${status} ${conclusion ?? '-'}`
    if (status !== 'completed') {
        if (!ran && Number.isFinite(ms(createdAt)) && Date.now() - ms(createdAt) >= STUCK_MS) {
            if (pull && changesWorkflow(pull)) { S.why = NEEDS_ACTIONS; return 'pending' }
            S.fallback = `queued 20 min without a runner or step; cancel the stuck run only after the fallback has posted: gh run cancel ${run.id}`
            return 'fallback'
        }
        return 'pending'
    }
    if (conclusion === 'cancelled') {
        if (!sha) return 'pending'
        S.notes.push(`superseded: check the newest ${base} commit`)
        return 'superseded'
    }
    if (ran) { S.why = 'Verify got a runner or ran a step'; return conclusion === 'failure' || conclusion === 'timed_out' ? 'red' : 'pending' }
    if (refusedBeforeRun.has(conclusion)) {
        if (pull && changesWorkflow(pull)) { S.why = NEEDS_ACTIONS; return 'red' }
        S.fallback = 'Actions ended before a runner or step; run local verification before replacing the gate'
        return 'fallback'
    }
    if (conclusion === 'action_required') S.why = 'the run waits for approval in Actions'
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
let reviewerWaitUnknown = false
// The first sign and first answer seen per head and reviewer, shared by every run in this checkout (merge's own --once check too),
// because the API keeps only a comment's last edit. A file in the git dir, never committed; saveSeen serializes and atomically merges
// concurrent updates; missing or unreadable is an empty cache.
const CACHE_DAYS = 2
const CACHE_LOCK_WAIT_MS = 5_000
// shortcut: 30s, cache writes complete in milliseconds; recover only abandoned locks.
const CACHE_LOCK_STALE_MS = 30_000
const cacheFile = (() => { const r = ciOnly ? null : spawnSync('git', ['rev-parse', '--absolute-git-dir'], { encoding: 'utf8' }); return r?.status === 0 ? join(r.stdout.trim(), 'ticketflow-pr-wait.json') : null })()
const cacheLock = cacheFile ? `${cacheFile}.lock` : null
const readSeen = () => {
    try { return Object.entries(JSON.parse(readFileSync(cacheFile, 'utf8'))).filter(([, t]) => Number.isFinite(t)) } catch { return [] }
}
const firstSeen = new Map(readSeen())
const pause = (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) }
function takeCacheLock() {
    if (!cacheLock) return false
    const started = Date.now()
    while (Date.now() - started < CACHE_LOCK_WAIT_MS) {
        try { mkdirSync(cacheLock); return true } catch (e) {
            if (e.code !== 'EEXIST') return false
            try {
                if (Date.now() - statSync(cacheLock).mtimeMs > CACHE_LOCK_STALE_MS) rmdirSync(cacheLock)
            } catch { /* another writer owns it, or it is not a removable stale lock */ }
            pause(10)
        }
    }
    return false
}
function saveSeen() {
    if (!takeCacheLock()) return
    const temp = `${cacheFile}.${process.pid}.${Date.now()}.tmp`
    try {
        const merged = new Map(readSeen())
        for (const [key, time] of firstSeen) {
            if (Number.isFinite(time) && (!Number.isFinite(merged.get(key)) || time < merged.get(key))) merged.set(key, time)
        }
        const keep = [...merged].filter(([, t]) => t > Date.now() - CACHE_DAYS * 86_400_000)
        writeFileSync(temp, JSON.stringify(Object.fromEntries(keep)), { flag: 'wx' })
        renameSync(temp, cacheFile)
    } catch { /* an unwritable cache only costs the memory */
        try { unlinkSync(temp) } catch { /* the atomic rename already removed it */ }
    } finally {
        try { rmdirSync(cacheLock) } catch { /* the lock was already removed or was never ours */ }
    }
}
const pushed = new Map()
let me

/** When this head was pushed: the first Actions run created for it (a later run does not move it), else the committer date. */
function pushedAt(head, pull = null) {
    if (!pushed.has(head)) {
        const runs = workflowRuns(head, pull)
        const t = Math.min(...runs.map((x) => ms(x.created_at)).filter((x) => x > 0))
        if (t === Infinity) return ms(api(`${R}/commits/${head}`).commit.committer.date)   // shortcut: no Actions run (no CI yet) falls back to the committer date, which can predate the push; read the push event if a repo runs without Actions
        pushed.set(head, t)
    }
    return pushed.get(head)
}

/**
 * Fills S.reviewers with one { login, state, text } per reviewer on this head: an app with PR-level activity,
 * or a trusted human with a submitted review or inline comment, and a sign since the push.
 */
function pollReviewers(S) {
    const since = pushedAt(S.head, S.pull)
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
    // GitHub already anchors inline comments to a commit. Only PR-level comments need a text-based stale-head check.
    // shortcut: an unanchored comment naming only other commits is a sign, never the result.
    const aboutOther = (c) => { if (c.commit_id === S.head) return false; const named = String(c.body ?? '').match(/\b[0-9a-f]{7,40}\b/g) ?? []; return named.length > 0 && !named.some((x) => S.head.startsWith(x)) }
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
        // An unedited inline finding on the head is still potentially the reviewer's first status message.
        // Require explicit agent judgment for it even if other comments or cache activity preceded it.
        const kind = (c) => (Date.now() < start + WINDOW_MS &&
            (edited(c) <= firstAnswer || (c.commit_id === S.head && edited(c) === ms(c.created_at))) ? 'first comment' : 'comment')
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
    console.log(`Observed reviewer wait_ms: ${(ciOnly || reviewerWaitUnknown) ? 'unknown' : reviewerWaitMs + (reviewerPendingSince === null ? 0 : Date.now() - reviewerPendingSince)}`)
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
    if (!ciOnly && !Array.isArray(S.reviewers)) reviewerWaitUnknown = true
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
