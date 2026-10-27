#!/usr/bin/env node
/**
 * The only way an agent merges: checks every gate on the exact head, then merges with a method the repo allows (squash, else rebase,
 * else a merge commit: the repo's settings and every rule on the base must allow it). Never `--admin`, never `--auto`.
 *
 * Usage: merge.mjs <pr> [--review-basis <comment-id>] [--config f]
 *
 * Gates (any doubt, including an unreadable one, is "not met"): the PR is open, not a draft, and based on the default branch;
 * `gate.context` is `success` on exactly the head; the head contains the default branch; `pr-wait --once` exits 0 and prints exactly
 * one `Unresolved threads:` line, `0` (threads of any author; `unknown` refuses), and exactly one `Review:` line, `done` (never
 * `changes requested`). A pr-reviewer review is a submitted review of an OWNER, MEMBER or COLLABORATOR with a `**Verdict:**` line;
 * the last one on the head must have exactly one verdict line, `ready to merge`, and its author must have write access to the repo.
 * When no reviewer accepted the head (`standin needed ...`, which includes a reviewer that only commented, or `none configured ...`),
 * `--review-basis` is the id of a comment of such an account that starts `Review basis for <sha7>:` (the first 7 characters of the
 * head) and then has exactly one of: `owner approved` (the author must have admin access; printed when it merges), or a link
 * `/pull/<pr>#pullrequestreview-<id>` (author with write access) to the newest pr-reviewer review of this PR, which is COMMENTED or
 * APPROVED, starts `Reviewed head: <sha>` (a prefix of the commit it was posted on), has exactly one verdict line `ready to merge`,
 * and is on exactly the head (a push, an update-branch included, needs a new review). Access is the repository permission GitHub
 * reports for the login (admin | write; maintain counts as write, triage as read); a read-only account or an unreadable permission
 * refuses. Both are written with the agent's own credentials, so they prove which review the agent named, not that an independent
 * reviewer ran.
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

const { values, positionals: [pr], cfg } = cli(import.meta.url, 'merge', '<pr> [--review-basis <comment-id>] [--config f]', { 'review-basis': { type: 'string' } },
    (p, v) => p.length === 1 && isNumber(p[0]) && (v['review-basis'] === undefined || isNumber(v['review-basis'])))
const here = dirname(fileURLToPath(import.meta.url))
const R = `repos/${cfg.repo}`
const base = cfg.default_branch

const TRUSTED = new Set(['OWNER', 'MEMBER', 'COLLABORATOR'])   // the pre-filter for a review of record or a basis; on a public repo anyone can comment. COLLABORATOR includes read-only, so permission() decides next
const permissions = new Map()
/** The repository permission of a login: admin | write | read | none (maintain is folded into write, triage into read). No login, or a field GitHub did not send, is none; a failed read throws. */
function permission(login) {
    if (!login) return 'none'
    if (!permissions.has(login)) permissions.set(login, api(`${R}/collaborators/${encodeURIComponent(login)}/permission`).permission)
    return ['admin', 'write', 'read'].includes(permissions.get(login)) ? permissions.get(login) : 'none'
}
const canWrite = (login) => ['admin', 'write'].includes(permission(login))
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
    if (wait.status !== 0) return stop(`pr-wait exited ${wait.status}\n${summary}`)
    if (!summary.includes(`head ${head.slice(0, 7)} `)) return stop(`pr-wait looked at another head than ${head.slice(0, 7)}: run again\n${summary}`)
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
    if (review.startsWith('changes requested')) return stop(`${review}: fix and push, then re-request the review; or the owner dismisses the review\n${summary}`)

    // pr-reviewer reviews are the submitted reviews of a trusted account that carry a `**Verdict:**` line; their last one on the head must be exactly "ready to merge"
    const reviews = api(`${R}/pulls/${pr}/reviews`, { paginate: true })
    const verdicts = reviews.filter((x) => TRUSTED.has(x.author_association) && x.state !== 'PENDING' && x.state !== 'DISMISSED' && verdictsOf(x.body).length > 0)
    const onHead = verdicts.filter((x) => x.commit_id === head).at(-1)
    if (onHead && !isReady(onHead.body)) return stop(`the last pr-reviewer review of ${head.slice(0, 7)} has verdict "${verdictsOf(onHead.body).join(' / ')}", not exactly "ready to merge": fix, push and review again`)
    // a ready verdict of record is a decision: a read-only account must not lift an earlier "changes needed" with one
    if (onHead && !canWrite(onHead.user?.login)) return stop(`the ready verdict ${onHead.id} on ${head.slice(0, 7)} is by ${who(onHead.user?.login)}, who has ${permission(onHead.user?.login)} access: a verdict of record needs write access`)
    let approval = null
    if (review !== 'done') {
        if (!/^(standin needed|none configured)\b/.test(review)) return stop(`review is "${review}"\n${summary}`)
        const id = values['review-basis']
        if (id === undefined) return stop(`no reviewer finished (${review}): run pr-reviewer on ${head.slice(0, 7)}, then post \`Review basis for ${head.slice(0, 7)}: <its review URL>\` as a PR comment (or \`owner approved\` when the owner decided) and pass --review-basis <comment-id>`)
        const comment = api(`${R}/issues/comments/${id}`)
        if (!String(comment.issue_url).endsWith(`/${R}/issues/${pr}`)) return stop(`comment ${id} is not on #${pr}`)
        if (!TRUSTED.has(comment.author_association)) return stop(`comment ${id} is not from the owner, a member or a collaborator (author_association ${comment.author_association ?? 'unknown'})`)
        const lead = `Review basis for ${head.slice(0, 7)}:`
        const body = String(comment.body)
        if (!body.startsWith(lead)) return stop(`comment ${id} must start with "${lead}"`)
        const rest = body.slice(lead.length)
        if (/^\s*owner approved\b/.test(rest)) {
            if (permission(comment.user?.login) !== 'admin') return stop(`comment ${id} says "owner approved" but ${who(comment.user?.login)} has ${permission(comment.user?.login)} access: only an admin account can approve for the owner`)
            approval = { id, login: comment.user.login }
        } else {
            if (!canWrite(comment.user?.login)) return stop(`comment ${id} is by ${who(comment.user?.login)}, who has ${permission(comment.user?.login)} access: a basis needs write access`)
            const links = [...rest.matchAll(/\/pull\/(\d+)#pullrequestreview-(\d+)/g)]
            if (links.length !== 1) return stop(`comment ${id} must say "owner approved" or link exactly one pr-reviewer review of #${pr} (…/pull/${pr}#pullrequestreview-<id>)`)
            if (links[0][1] !== pr) return stop(`comment ${id} links a review of another PR (#${links[0][1]}), not #${pr}`)
            const linked = reviews.find((x) => String(x.id) === links[0][2])   // from this PR's own list: another PR's or repo's review is not in it
            if (!linked) return stop(`review ${links[0][2]} is not a review of #${pr}`)
            if (!TRUSTED.has(linked.author_association)) return stop(`review ${linked.id} is not from a trusted account (the owner, a member or a collaborator)`)
            if (linked.state !== 'COMMENTED' && linked.state !== 'APPROVED') return stop(`review ${linked.id} is ${linked.state}: only a submitted COMMENTED or APPROVED review counts`)
            const reviewed = READ_HEAD.exec(linked.body ?? '')?.[1]
            if (!reviewed || !isReady(linked.body)) return stop(`review ${linked.id} has no "Reviewed head:" first line and exactly one "**Verdict:** ready to merge"`)
            if (!String(linked.commit_id).startsWith(reviewed)) return stop(`review ${linked.id} says it reviewed ${reviewed} but was posted on commit ${String(linked.commit_id).slice(0, 7)}: review again`)
            if (verdicts.at(-1) !== linked) return stop(`a later pr-reviewer review (${verdicts.at(-1)?.id}) exists: the basis must link the newest one`)
            // the linked review is the newest verdict and on the head, so it is the verdict of record whose author was checked above
            if (linked.commit_id !== head) return stop(`review ${linked.id} is on ${String(linked.commit_id).slice(0, 7)}, not the head ${head.slice(0, 7)}: run pr-reviewer on the head (a delta review since its last review is enough), then post a new basis`)
        }
    }

    // The merge method is the repo's choice: the first that its settings and every pull_request rule on the base (org rulesets too) allow.
    const [owner, name] = cfg.repo.split('/')
    const flags = gql('query MergeMethods($o:String!,$n:String!){ repository(owner:$o,name:$n){ squashMergeAllowed rebaseMergeAllowed mergeCommitAllowed } }', { o: owner, n: name }).repository
    // ponytail: one page of 100 rules; a branch with more active rules than that is not expected
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
        if (approval) console.log(`Note: merged on an \`owner approved\` basis (comment ${approval.id} by ${approval.login}, admin): a comment shows which account posted it, not who typed it`)
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
