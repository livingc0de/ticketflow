#!/usr/bin/env node
/**
 * The only way an agent merges: checks every gate on the exact head, then merges with a method the repo allows (squash, else rebase,
 * else a merge commit: the repo's settings and every rule on the base must allow it). Never `--admin`, never `--auto`.
 *
 * Usage: merge.mjs <pr> [--reviewed-by <login> [--review-result-url <url>] | --self-checked] [--config f]
 *
 * Gates (any doubt, including an unreadable one, is "not met"): the PR is open, not a draft, and based on the default branch;
 * `gate.context` is `success` on exactly the head; the head contains the default branch; `pr-wait --once` exits 0 and prints exactly
 * one `Unresolved threads:` line, `0` (threads of any author; `unknown` refuses), and exactly one `Review:` line that is `none` or
 * `results (..)`: never `pending` (an external reviewer started on the head and has not answered, at most 15 minutes from its start)
 * and never `changes requested`.
 * Reviews are GitHub review objects attached to the exact head, not parsed natural-language verdicts.
 * A native CHANGES_REQUESTED state blocks. Agents inspect review content and resolve findings before using the merge command.
 * `--reviewed-by` identifies a named external result; `--self-checked` allows a self-check only under the risk policy.
 * A review of a previous head can support a small fix delta, provided it was submitted and not a changes request.
 * Merge reads no repository permission: GitHub's own rules (a ruleset, branch protection, required reviews) are what enforce who may merge.
 * The merge passes `--match-head-commit`, so a push after the checks fails the merge; the base is read again right before it, so a base
 * that moved after the slow reads is refused.
 *
 * Exit: 0 = merged, 1 = a gate is not met or the merge did not happen (the next action is printed), 2 = usage or config error.
 */

import { spawnSync } from 'node:child_process'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cli } from '../lib/cli.mjs'
import { configPath } from '../lib/config.mjs'
import { GhError, api, gql, isNumber } from '../lib/gh.mjs'
import { alwaysReviewHit, laneOfPull, noLines } from '../lib/risk.mjs'
import { routeOfPull, validGateSource } from '../lib/verification.mjs'

const { values, positionals: [pr], cfg } = cli(import.meta.url, 'merge', '<pr> [--reviewed-by <login> [--review-result-url <url>] | --self-checked] [--config f]', { 'reviewed-by': { type: 'string' }, 'review-result-url': { type: 'string' }, 'self-checked': { type: 'boolean' } },
    (p, v) => p.length === 1 && isNumber(p[0]) && (v['reviewed-by'] === undefined || /^[\w.[\]-]+$/.test(v['reviewed-by'])) &&
        (v['review-result-url'] === undefined || (v['reviewed-by'] !== undefined && /^https:\/\/[^\s]+$/.test(v['review-result-url']))) &&
        !(v['self-checked'] && (v['reviewed-by'] !== undefined || v['review-result-url'] !== undefined)))
const here = dirname(fileURLToPath(import.meta.url))
const R = `repos/${cfg.repo}`
const base = cfg.default_branch

const TRUSTED = new Set(['OWNER', 'MEMBER', 'COLLABORATOR'])   // the pre-filter for a review of record: on a public repo anyone can comment
const who = (login) => login || 'an unknown account'
const SELF_HEAD = /^Self-check head: ([0-9a-f]{7,40})\b/ // old self-check marker, recognized only to exclude these from prior independent reviews
const completedReview = (r) => r && (r.state === 'APPROVED' || (r.state === 'COMMENTED' && Boolean(String(r.body ?? '').trim())))

const stop = (message) => { console.error(`merge: not merged: ${message}`); return 1 }

const NEXT = (sha7) => `run pr-reviewer on the head (a delta review since ${sha7} is enough)`
const readyReview = (r) => Boolean(completedReview(r) && typeof r.commit_id === 'string')

/**
 * The review of record for --self-checked. Returns a refusal string or { lane }. `own` is the merging account's latest submitted review on the head.
 */
function selfCheck(pull, head, own, reviews, me) {
    const sha7 = head.slice(0, 7)
    if (!cfg.review.self_check) return 'self-check is off in this repo (review.self_check): run pr-reviewer on the head'
    if (!completedReview(own)) return `no submitted self-check of ${sha7}: review this head with a non-empty comment, then use --self-checked; or ${NEXT('the last reviewed head')}`
    // this account's latest pr-reviewer review: after a "changes needed" a self-check is not enough, and a ready one is the base of a fix delta
    const prior = reviews.filter((x) => x.user?.login === me && TRUSTED.has(x.author_association) &&
        x.commit_id !== head && x.state !== 'PENDING' && x.state !== 'DISMISSED' && !SELF_HEAD.test(x.body ?? '')).at(-1)
    if (prior && !readyReview(prior)) return `the last earlier review was not a completed non-blocking review: ${NEXT(prior.commit_id?.slice(0, 7) ?? 'the last reviewed head')}`
    const found = laneOfPull(cfg, pull, pr)
    if (found.ticket === null) return `no "Ticket #N" in the PR title or body: a self-check is for ticket work only (add it, or ${NEXT('the last reviewed head')})`
    if (found.lane === 'self-check') return { lane: 'small diff' }
    const why = found.reasons.join('; ')
    if (!found.size) return `this PR needs a review, not a self-check (${why}): ${NEXT('the last reviewed head')}`
    // mode B: the reasons are only size ones; a small fix delta after a ready pr-reviewer review is still a self-check
    if (!prior || prior.commit_id === head) return `this PR is too big for a self-check (${why}) and has no ready pr-reviewer review of an earlier head to build on: ${NEXT('the last reviewed head')}`
    const since = prior.commit_id.slice(0, 7)
    const delta = api(`${R}/compare/${prior.commit_id}...${head}`)
    if (delta.behind_by !== 0 || !Array.isArray(delta.files) || delta.files.length >= 300) return `the head is not a plain descendant of the reviewed commit ${since} (or the delta is too long to read): ${NEXT(since)}`
    if (!delta.files.every((f) => typeof f?.filename === 'string' && Number.isInteger(f.additions) && Number.isInteger(f.deletions) && !noLines(f))) return `the fix delta since ${since} could not be read: ${NEXT(since)}`
    const risky = delta.files.find((f) => alwaysReviewHit(f, cfg))
    if (risky) return `the fix delta since ${since} touches ${alwaysReviewHit(risky, cfg)}, which always needs a review: ${NEXT(since)}`
    const lines = delta.files.reduce((n, f) => n + f.additions + f.deletions, 0)
    if (lines > cfg.review.fix_check_max_lines) return `the fix delta since ${since} is ${lines} lines (limit ${cfg.review.fix_check_max_lines}): ${NEXT(since)}`
    return { lane: `fix delta since ${since}` }
}

function merge() {
    const pull = api(`${R}/pulls/${pr}`)
    if (pull.state !== 'open') return stop(`#${pr} is ${pull.state}`)
    if (pull.draft) return stop(`#${pr} is a draft: gh pr ready ${pr} --repo ${cfg.repo}`)
    if (pull.base.ref !== base) return stop(`#${pr} is based on ${pull.base.ref}, not ${base}`)
    const head = pull.head.sha

    const status = api(`${R}/commits/${head}/status?per_page=100`)
    const gate = status.sha === head ? status.statuses.find((s) => s.context === cfg.gate.context) : undefined
    if (gate?.state !== 'success') return stop(`${cfg.gate.context} is ${gate?.state ?? 'missing'} on ${head.slice(0, 7)} (it must be success on the exact head)`)
    if (['local', 'tiered'].includes(cfg.verify.mode)) {
        const { route } = routeOfPull(cfg, pull, pr)
        if (!validGateSource(route, gate.description)) return stop(`the ${route} verification route is not covered by the gate status on ${head.slice(0, 7)}; verify again for this tier`)
    }

    const behind = () => api(`${R}/compare/${base}...${head}`).behind_by
    const stale = (n) => stop(`${base} moved (behind by ${n}): gh pr update-branch ${pr} --repo ${cfg.repo}, then wait for the new head`)
    const early = behind()   // a fast fail before the slow reads; read again right before the merge
    if (early !== 0) return stale(early)

    const configFile = values.config ?? configPath(here)
    const wait = spawnSync(process.execPath, [join(here, 'pr-wait.mjs'), pr, '--once', '--config', configFile], { encoding: 'utf8' })
    const summary = (wait.stdout ?? '').trim()
    if (wait.status !== 0) return stop(`pr-wait exited ${wait.status}\n${summary}${wait.stderr?.trim() ? `\n${wait.stderr.trim()}` : ''}`)
    if (!summary.split('\n')[0].startsWith(`PR #${pr} head ${head.slice(0, 7)} `)) return stop(`pr-wait looked at another head than ${head.slice(0, 7)}: run again\n${summary}`)
    // The summary carries text from GitHub (pr-wait flattens it to one line each); only an exact single line counts.
    const lines = summary.split('\n')
    const only = (key) => { const m = lines.filter((l) => l.startsWith(key)); return m.length === 1 ? m[0].slice(key.length) : null }
    const threads = only('Unresolved threads: ')
    if (threads !== '0') {
        if (/^\d+$/.test(threads)) return stop(`${threads} unresolved review thread(s): fix each, or reject it with the reason, then reply and resolve it with \`node ${relative(process.cwd(), join(here, 'thread.mjs'))} ${pr} <thread-id>\` (reply on stdin), push once if code changed\n${summary}`)
        return stop(`unresolved review threads: ${threads ?? 'not reported exactly once'}: read the threads on the PR; the count could not be told\n${summary}`)
    }
    const review = only('Review: ')
    if (review === null) return stop(`pr-wait did not print exactly one "Review:" line\n${summary}`)
    const sha7 = head.slice(0, 7)
    if (review.includes('could not be read')) return stop(`${review}: run again\n${summary}`)
    if (review.startsWith('pending')) return stop(`${review}: a reviewer started on ${sha7} and has not answered: wait (pr-wait), at most 15 minutes from its start\n${summary}`)
    if (review.startsWith('changes requested')) return stop(`${review}: fix and push (the new head is reviewed again); or the owner dismisses the review\n${summary}`)
    if (!/^(none|results)\b/.test(review)) return stop(`Review is "${review}"\n${summary}`)

    // GitHub's review state, actor, and exact commit identify evidence; human-authored words never act as a merge protocol.
    const me = api('user').login
    const last = new Map()
    const reviews = api(`${R}/pulls/${pr}/reviews`, { paginate: true })
    for (const x of reviews) {
        if (x.commit_id === head && x.user?.login && TRUSTED.has(x.author_association) && x.state !== 'PENDING' && x.state !== 'DISMISSED') last.set(x.user.login, x)
    }
    for (const [login, x] of last) {
        if (x.state === 'CHANGES_REQUESTED') return stop(`${who(login)} requested changes on ${sha7}: address the findings; that reviewer can re-review or the owner can dismiss the request`)
    }
    const named = values['reviewed-by']
    let lane = null   // the self-check lane that was used, for the final note
    if (values['self-checked']) {
        const refusal = selfCheck(pull, head, last.get(me), reviews, me)
        if (typeof refusal === 'string') return stop(refusal)
        lane = refusal.lane
    } else if (named !== undefined) {
        const line = only(`Review ${named}: `)
        if (!line?.startsWith('result ')) return stop(`${named} has no result on ${sha7} (${line ?? 'no activity on this head'}): name a reviewer that pr-wait lists with a result, or run pr-reviewer on the head\n${summary}`)
        // A first comment can be a complete review or a progress note. The agent must cite the exact result it inspected to use it early;
        // the script verifies the link came from the current head, never infers completion from keywords or a bot's identity.
        const url = values['review-result-url']
        const observedUrl = /^result (?:first comment|comment|inline comment|review [A-Z_]+) (https:\/\/\S+)/.exec(line)?.[1]
        if (url && url !== observedUrl) return stop(`${named}'s review-result-url is not the observed result on ${sha7}: re-read the current result\n${summary}`)
        if (line.startsWith('result first comment ') && !url) return stop(`${named}'s first comment on ${sha7} could still be a status note: read its full content and, only if it is a complete review, use --review-result-url '<exact result link>'; otherwise wait with pr-wait --more '${named}' (at most 15 minutes from its start)\n${summary}`)
    } else {
        const own = last.get(me)
        if (!completedReview(own)) return stop(`no submitted review of ${sha7} with content: review this head (any wording is fine), or pass --reviewed-by '<login>' for the external result you acted on`)
    }

    // The merge method is the repo's choice: the first that its settings and every pull_request rule on the base (org rulesets too) allow.
    const [owner, name] = cfg.repo.split('/')
    const flags = gql('query MergeMethods($o:String!,$n:String!){ repository(owner:$o,name:$n){ squashMergeAllowed rebaseMergeAllowed mergeCommitAllowed } }', { o: owner, n: name }).repository
    // shortcut: one page of 100 rules, page it if a branch ever has more active rules
    const rules = api(`${R}/rules/branches/${encodeURIComponent(base)}?per_page=100`).filter((r) => r.type === 'pull_request')
    const allowed = { squash: flags?.squashMergeAllowed, rebase: flags?.rebaseMergeAllowed, merge: flags?.mergeCommitAllowed }
    const method = ['squash', 'rebase', 'merge'].find((m) => allowed[m] === true && rules.every((r) => !r.parameters?.allowed_merge_methods || r.parameters.allowed_merge_methods.includes(m)))
    if (!method) return stop(`no merge method is allowed by both the repository settings and the rules of ${base}`)

    const late = behind()
    if (late !== 0) return stale(late)
    const run = spawnSync('gh', ['pr', 'merge', pr, '--repo', cfg.repo, `--${method}`, '--delete-branch', '--match-head-commit', head], { encoding: 'utf8' })
    let after   // gh can exit non-zero after the merge (for example when deleting the branch)
    try { after = api(`${R}/pulls/${pr}`) } catch { return stop(`cannot tell whether #${pr} merged: check it before anything else`) }
    if (after.merged === true) {
        console.log(`Merged #${pr} (${method}) as ${after.merge_commit_sha}`)
        if (lane !== null) console.log(`Merged on a self-check (${lane})`)
        if (named !== undefined) console.log(`Note: merged on the result of ${named} on ${sha7}; merge checked where and when it was posted, the agent read what it says${values['review-result-url'] ? ` (explicit result: ${values['review-result-url']})` : ''}`)
        return 0
    }
    return stop(`gh pr merge failed: ${(run.stderr || run.stdout || 'no output').trim()}`)
}

try {
    process.exitCode = merge()
} catch (e) {
    if (!(e instanceof GhError)) throw e
    process.exitCode = stop(`cannot read: ${e.message}`)   // an unreadable gate is a gate not met
}
