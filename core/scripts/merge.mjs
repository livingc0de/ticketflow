#!/usr/bin/env node
/**
 * The only way an agent merges: checks every gate on the exact head, then merges with a method the repo allows (squash, else rebase,
 * else a merge commit: the repo's settings and every rule on the base must allow it). Never `--admin`, never `--auto`.
 *
 * Usage: merge.mjs <pr> [--reviewed-by <login>] [--config f]
 *
 * Gates (any doubt, including an unreadable one, is "not met"): the PR is open, not a draft, and based on the default branch;
 * `gate.context` is `success` on exactly the head; the head contains the default branch; `pr-wait --once` exits 0 and prints exactly
 * one `Unresolved threads:` line, `0` (threads of any author; `unknown` refuses), and exactly one `Review:` line that is `none` or
 * `results (..)`: never `pending` (an external reviewer started on the head and has not answered, at most 15 minutes from its start)
 * and never `changes requested`.
 * A pr-reviewer review is a submitted review of an OWNER, MEMBER or COLLABORATOR with a `**Verdict:**` line on exactly the head. The
 * last such review of every account must be exactly `ready to merge` (only that account lifts its own "changes needed"). Then the review
 * of the head is either this account's own pr-reviewer review (it starts `Reviewed head: <sha>` naming the head), or, with
 * `--reviewed-by <login>`, that reviewer's `result` on the head in the pr-wait summary, never its unedited `first comment` while its 15
 * minutes run (it may be a status note): the agent read what it says and acted on it, merge only proves where and when it was posted. Merge reads no repository permission: GitHub's own rules (a ruleset, branch
 * protection, required reviews) are what enforce who may merge.
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

const { values, positionals: [pr], cfg } = cli(import.meta.url, 'merge', '<pr> [--reviewed-by <login>] [--config f]', { 'reviewed-by': { type: 'string' } },
    (p, v) => p.length === 1 && isNumber(p[0]) && (v['reviewed-by'] === undefined || /^[\w.[\]-]+$/.test(v['reviewed-by'])))
const here = dirname(fileURLToPath(import.meta.url))
const R = `repos/${cfg.repo}`
const base = cfg.default_branch

const TRUSTED = new Set(['OWNER', 'MEMBER', 'COLLABORATOR'])   // the pre-filter for a review of record: on a public repo anyone can comment
const who = (login) => login || 'an unknown account'
const READ_HEAD = /^Reviewed head: ([0-9a-f]{7,40})\b/
// Any spelling of the label counts as a verdict (so a "changes needed" is never missed); only the exact bold line below is ready.
const verdictsOf = (body) => [...String(body ?? '').matchAll(/^[ \t]*(?:#{1,6}[ \t]+|[-*+][ \t]+)?(?:\*{1,2}|_{1,2})?[ \t]*verdict[ \t]*(?:\*{1,2}|_{1,2})?[ \t]*:[ \t]*(?:\*{1,2}|_{1,2})?[ \t]*(.*?)[ \t]*$/gim)].map((m) => m[1])
const isReady = (body) => verdictsOf(body).length === 1 && [...String(body).matchAll(/^\*\*Verdict:\*\*[ \t]*ready to merge[ \t]*$/gm)].length === 1

const stop = (message) => { console.error(`merge: not merged: ${message}`); return 1 }

function merge() {
    const pull = api(`${R}/pulls/${pr}`)
    if (pull.state !== 'open') return stop(`#${pr} is ${pull.state}`)
    if (pull.draft) return stop(`#${pr} is a draft: gh pr ready ${pr} --repo ${cfg.repo}`)
    if (pull.base.ref !== base) return stop(`#${pr} is based on ${pull.base.ref}, not ${base}`)
    const head = pull.head.sha

    const status = api(`${R}/commits/${head}/status?per_page=100`)
    const gate = status.sha === head ? status.statuses.find((s) => s.context === cfg.gate.context) : undefined
    if (gate?.state !== 'success') return stop(`${cfg.gate.context} is ${gate?.state ?? 'missing'} on ${head.slice(0, 7)} (it must be success on the exact head)`)

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

    // pr-reviewer reviews are the submitted reviews of a trusted account that carry a `**Verdict:**` line; the last one of each account on the head must be exactly "ready to merge"
    const me = api('user').login
    const last = new Map()
    for (const x of api(`${R}/pulls/${pr}/reviews`, { paginate: true })) {
        if (x.commit_id === head && TRUSTED.has(x.author_association) && x.state !== 'PENDING' && x.state !== 'DISMISSED' && verdictsOf(x.body).length > 0) last.set(x.user?.login, x)
    }
    for (const [login, x] of last) {
        if (!((x.state === 'COMMENTED' || x.state === 'APPROVED') && isReady(x.body))) return stop(`the last verdict of ${who(login)} on ${sha7} is "${verdictsOf(x.body).join(' / ')}", not exactly "ready to merge": fix, push and review again (only that account can lift it)`)
    }
    const named = values['reviewed-by']
    if (named !== undefined) {
        const line = only(`Review ${named}: `)
        if (!line?.startsWith('result ')) return stop(`${named} has no result on ${sha7} (${line ?? 'no activity on this head'}): name a reviewer that pr-wait lists with a result, or run pr-reviewer on the head\n${summary}`)
        // its unedited first comment on the head may be the status note of a review still running: pr-wait marks it while its 15 minutes run
        if (line.startsWith('result first comment ')) return stop(`${named}'s only answer on ${sha7} is its first comment, unedited, which may be the status note of a review still running: wait for its next answer (pr-wait --more '${named}'), at most 15 minutes from its start\n${summary}`)
    } else {
        const own = last.get(me)
        if (!own) return stop(`no review of ${sha7}: run pr-reviewer on the head (a delta review since its last review is enough), or pass --reviewed-by '<login>' for the external reviewer whose result on this head you acted on`)
        const reviewed = READ_HEAD.exec(own.body ?? '')?.[1]
        if (!reviewed || !head.startsWith(reviewed)) return stop(`review ${own.id} does not start "Reviewed head: <sha>" naming ${sha7}: review again`)
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
        if (named !== undefined) console.log(`Note: merged on the result of ${named} on ${sha7}; merge checked where and when it was posted, the agent read what it says`)
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
