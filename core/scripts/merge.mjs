#!/usr/bin/env node
/**
 * The only way an agent merges: checks every gate on the exact head, then merges with a method the repo allows (squash, else rebase,
 * else a merge commit: the repo's settings and every rule on the base must allow it). Never `--admin`, never `--auto`.
 *
 * Usage: merge.mjs <pr> [--review-basis <comment-id>] [--config f]
 *
 * Gates (any doubt, including an unreadable one, is "not met"): the PR is open, not a draft, and based on the default branch;
 * `gate.context` is `success` on exactly the head; the head contains the default branch; `pr-wait --once` exits 0 and its
 * `Review:` line is `done`. When no reviewer answered (`standin needed ...`) or none is configured (`none configured ...`), the
 * independent review is attested with `--review-basis`: the id of a comment on this PR that names the first 7 characters of the head.
 * The attestation is bound to the head but cannot prove that a reviewer ran.
 * The merge passes `--match-head-commit`, so a push after the checks fails the merge. Known ceiling: a base that moves between the
 * behind check and the merge is not caught.
 *
 * Exit: 0 = merged, 1 = a gate is not met or the merge did not happen (the next action is printed), 2 = usage or config error.
 */

import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cli } from '../lib/cli.mjs'
import { configPath } from '../lib/config.mjs'
import { GhError, api, gql, isNumber } from '../lib/gh.mjs'

const { values, positionals: [pr], cfg } = cli(import.meta.url, 'merge', '<pr> [--review-basis <comment-id>] [--config f]', { 'review-basis': { type: 'string' } },
    (p, v) => p.length === 1 && isNumber(p[0]) && (v['review-basis'] === undefined || isNumber(v['review-basis'])))
const here = dirname(fileURLToPath(import.meta.url))
const R = `repos/${cfg.repo}`
const base = cfg.default_branch

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

    const compare = api(`${R}/compare/${base}...${head}`)
    if (compare.behind_by !== 0) return stop(`${base} moved (behind by ${compare.behind_by}): gh pr update-branch ${pr} --repo ${cfg.repo}, then wait for the new head`)

    const configFile = values.config ?? configPath(here)
    const wait = spawnSync(process.execPath, [join(here, 'pr-wait.mjs'), pr, '--once', '--config', configFile], { encoding: 'utf8' })
    const summary = (wait.stdout ?? '').trim()
    if (wait.status !== 0) return stop(`pr-wait exited ${wait.status}\n${summary}`)
    if (!summary.includes(`head ${head.slice(0, 7)} `)) return stop(`pr-wait looked at another head than ${head.slice(0, 7)}: run again\n${summary}`)
    const review = [...summary.matchAll(/^Review: (.*)$/gm)].at(-1)?.[1] ?? ''
    if (review !== 'done') {
        if (!/^(standin needed|none configured)\b/.test(review)) return stop(`review is "${review || 'unknown'}"\n${summary}`)
        const id = values['review-basis']
        if (id === undefined) return stop(`no reviewer finished (${review}): run pr-reviewer on ${head.slice(0, 7)}, post its verdict as a PR comment naming the sha, and pass --review-basis <comment-id>`)
        const comment = api(`${R}/issues/comments/${id}`)
        if (!String(comment.issue_url).endsWith(`/${R}/issues/${pr}`)) return stop(`comment ${id} is not on #${pr}`)
        if (!String(comment.body).includes(head.slice(0, 7))) return stop(`comment ${id} does not name the head ${head.slice(0, 7)}`)
    }

    // The merge method is the repo's choice: the first that its settings and every pull_request rule on the base (org rulesets too) allow.
    const [owner, name] = cfg.repo.split('/')
    const flags = gql('query MergeMethods($o:String!,$n:String!){ repository(owner:$o,name:$n){ squashMergeAllowed rebaseMergeAllowed mergeCommitAllowed } }', { o: owner, n: name }).repository
    // ponytail: one page of 100 rules; a branch with more active rules than that is not expected
    const rules = api(`${R}/rules/branches/${encodeURIComponent(base)}?per_page=100`).filter((r) => r.type === 'pull_request')
    const allowed = { squash: flags?.squashMergeAllowed, rebase: flags?.rebaseMergeAllowed, merge: flags?.mergeCommitAllowed }
    const method = ['squash', 'rebase', 'merge'].find((m) => allowed[m] === true && rules.every((r) => !r.parameters?.allowed_merge_methods || r.parameters.allowed_merge_methods.includes(m)))
    if (!method) return stop(`no merge method is allowed by both the repository settings and the rules of ${base}`)

    const run = spawnSync('gh', ['pr', 'merge', pr, '--repo', cfg.repo, `--${method}`, '--delete-branch', '--match-head-commit', head], { encoding: 'utf8' })
    let after   // gh can exit non-zero after the merge (for example when deleting the branch)
    try { after = api(`${R}/pulls/${pr}`) } catch { return stop(`cannot tell whether #${pr} merged: check it before anything else`) }
    if (after.merged === true) {
        console.log(`Merged #${pr} (${method}) as ${after.merge_commit_sha}`)
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
