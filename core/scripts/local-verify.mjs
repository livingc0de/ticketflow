#!/usr/bin/env node
/**
 * The local fallback for the merge gate: run the configured verify command on the exact, up-to-date head of a pull request (or on a
 * default-branch commit) in a clean worktree, then post the result as the commit status `gate.context` (and, for a PR, one comment).
 * Run by hand, never by a timer, and only when `pr-wait` printed `Fallback: allowed` (Actions refused the job).
 *
 * Usage: local-verify.mjs <pr | 40-hex sha>
 * Exit: 0 = success posted; 1 = failure posted, or nothing posted (timeout, head moved, behind, a doubt); 2 = usage or config error;
 *       3 = refused (the fallback is not allowed, a fork, another base, or this runtime differs from origin/<default_branch>).
 *
 * Fail-closed: nothing is posted unless `pr-wait <target> --once --ci-only` exits 3 both before and right after the run, on the same head.
 * A failure is posted too (the status stays the last verdict, so a merge gate sees red at once); a `failure local ...` status
 * stays re-runnable while Actions still refuses the job. A red that got a runner on Actions is never replaced.
 * The verify runs the code under test as you, with your HOME: only run branches you would run anyway, and run the default branch's copy of this script.
 * Needs `timeout` (coreutils; on macOS: brew install coreutils) and `gh` >= 2.48.
 */

import { spawnSync } from 'node:child_process'
import { closeSync, mkdirSync, openSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { homedir, hostname, machine } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { configPath, loadConfig } from '../lib/config.mjs'
import { docsOnly } from '../lib/docs-only.mjs'
import { description as inheritedDescription, inherit } from '../lib/inherit.mjs'

class Exit extends Error {
    constructor(code, message) { super(message); this.code = code }
}
const stop = (code, message) => { throw new Exit(code, message) }

const here = dirname(fileURLToPath(import.meta.url))
let cfg, target, root
try {
    const { positionals } = parseArgs({ options: {}, allowPositionals: true })
    ;[target] = positionals
    if (positionals.length !== 1 || !/^(\d+|[0-9a-f]{40})$/.test(target)) throw new Error('usage: local-verify.mjs <pr | 40-hex sha>')
    const path = configPath(here)   // always the checked-out config: it is verified below to equal origin's
    cfg = loadConfig(path)
    root = dirname(dirname(path))
} catch (e) {
    console.error(`local-verify: ${e.message}`)
    process.exit(2)
}
const isPr = /^\d+$/.test(target)
const base = cfg.default_branch
const origin = `refs/remotes/origin/${base}`   // fully qualified: a tag called origin/<branch> must not shadow it
const host = hostname().split('.')[0]

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 26, ...opts })
const git = (...args) => run('git', ['-C', root, ...args], { env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
const ghApi = (path) => {
    const r = run('gh', ['api', path])
    if (r.status !== 0) throw new Error(`gh api ${path} failed`)
    return JSON.parse(r.stdout)
}
const allowed = () => run(process.execPath, [join(here, 'pr-wait.mjs'), target, '--once', '--ci-only']).status === 3

/** Verifies in a clean worktree of `sha`; returns { state, log }. A timeout or a signal posts nothing. */
function fullRun(sha) {
    const wt = join(homedir(), '.cache', 'ticketflow-verify', cfg.repo.replace('/', '__'), sha.slice(0, 12))
    const log = `${wt}.log`
    mkdirSync(dirname(wt), { recursive: true })
    git('worktree', 'remove', '--force', wt); rmSync(wt, { recursive: true, force: true }); git('worktree', 'prune')   // a run killed earlier left one
    if (git('worktree', 'add', '-q', '--detach', wt, sha).status !== 0) stop(1, 'cannot create the worktree; nothing posted')
    const fd = openSync(log, 'w')
    try {
        const { install, command, timeout_min: min } = cfg.verify
        // A clean environment with CI=true: the caller's other variables stay out of the install scripts and tests of the code under test.
        const r = run('timeout', ['-k', '30', String(min * 60), 'bash', '-c', install ? `(${install}) && (${command})` : command], {
            cwd: wt, env: { HOME: homedir(), PATH: process.env.PATH, CI: 'true' }, stdio: ['ignore', fd, fd],
        })
        if (r.error) stop(1, `cannot run timeout (coreutils): ${r.error.message}; nothing posted`)
        if (r.status === 124) stop(1, `timed out after ${min} min; nothing posted (log: ${log})`)
        if (r.signal) stop(1, `killed by ${r.signal}; nothing posted (log: ${log})`)
        return { state: r.status === 0 ? 'success' : 'failure', log }
    } finally {
        closeSync(fd)
        git('worktree', 'remove', '--force', wt)
    }
}

function main() {
    // 1-3. Refuse to run a runtime that differs from the default branch's: a pull request must not widen or neuter its own fallback.
    if (git('fetch', '-q', 'origin', `+refs/heads/${base}:${origin}`).status !== 0) stop(1, `cannot fetch origin ${base}; nothing posted`)
    const real = realpathSync(here)
    const runtime = [relative(root, real), relative(root, join(real, '..', 'lib')), '.ticketflow/config.json']
    const diff = git('diff', '--quiet', origin, '--', ...runtime)
    const extra = git('ls-files', '--others', '--', ...runtime)   // `diff` ignores untracked files (ignored ones too, listed without --exclude-standard)
    if (extra.status === 0 && extra.stdout.trim()) diff.status = 1
    else if (extra.status !== 0) diff.status = extra.status
    if (diff.status === 1) stop(3, `this runtime differs from origin/${base}: run it from a checkout whose ticketflow runtime equals origin/${base}, e.g. the default branch's worktree${extra.stdout.trim() ? `; untracked files: ${extra.stdout.trim().split('\n').join(', ')}` : ''}`)
    if (diff.status !== 0) stop(1, 'cannot compare the runtime with origin; nothing posted')

    // 4. Guard.
    if (!allowed()) stop(3, `pr-wait ${target} --once --ci-only does not allow the fallback; nothing posted`)

    // 5. The target is runnable and up to date.
    let sha = target
    const readHead = () => {
        const p = ghApi(`repos/${cfg.repo}/pulls/${target}`)
        return { sha: p.head.sha, same: p.head.repo?.full_name === p.base.repo.full_name, base: p.base.ref }
    }
    if (isPr) {
        let pr
        try { pr = readHead() } catch (e) { stop(1, `${e.message}; nothing posted`) }
        if (!pr.same) stop(3, 'a fork head (or a deleted fork) never runs locally')
        if (pr.base !== base) stop(3, `the base is not ${base}; nothing posted`)
        sha = pr.sha
        if (git('fetch', '-q', 'origin', `refs/pull/${target}/head`).status !== 0) stop(1, 'cannot fetch the pull request head; nothing posted')
        if (git('rev-parse', 'FETCH_HEAD').stdout.trim() !== sha) stop(1, 'the head moved while fetching: run again')
        const behind = git('merge-base', '--is-ancestor', origin, sha).status
        if (behind === 1) {   // 1 = not an ancestor; any other code is an error, not "behind"
            const up = run('gh', ['pr', 'update-branch', target, '-R', cfg.repo])
            stop(1, up.status === 0 ? `the head was behind ${base}; updated the branch, wait for the new head and run again` : `the head is behind ${base} and gh pr update-branch failed; nothing posted`)
        }
        if (behind !== 0) stop(1, `cannot compare the head with ${base} (git exit ${behind}); nothing posted`)
    } else if (git('merge-base', '--is-ancestor', sha, origin).status !== 0) stop(1, `${sha} is not on origin/${base}; nothing posted`)

    // 6. Decide the result: inherit, docs-only, or a full run (always, for a sha).
    let desc, how, state = 'success', log = ''
    if (isPr && cfg.gate.inherit) {
        try {
            const r = inherit(ghApi, cfg, target, sha)
            if (r.root) { desc = inheritedDescription(cfg, r.root); how = `${desc}; inherited, no verify run` }
        } catch { /* any doubt is a full run */ }
    }
    if (!desc && isPr) {
        const d = git('diff', '-z', '--no-renames', '--name-only', origin, sha)
        if (d.status === 0 && docsOnly(d.stdout.split('\0').filter(Boolean), cfg)) { desc = `docs-only (local ${host})`; how = `${desc}; no verify run` }
    }
    if (!desc) {
        desc = `local ${host} ${machine()} node ${process.versions.node}`
        how = `${desc}, verify command on the exact head, Actions refused the job`
        ;({ state, log } = fullRun(sha))
    }

    // 7. Recheck right before posting: the head is unchanged and the guard still says so.
    const where = log && ` (log: ${log})`
    if (!allowed()) stop(1, `Actions started or the fallback is no longer allowed; nothing posted${where}`)
    if (isPr) {   // after the guard, so the guard cannot have judged a newer head than the one confirmed here
        let now
        try { now = readHead() } catch { stop(1, `cannot re-read the head; nothing posted${where}`) }
        if (now.sha !== sha || !now.same || now.base !== base) stop(1, `the head or its base changed; nothing posted${where}`)
    }

    // 8. Publish: the PR comment (PR mode), then the status that links it.
    let url = ''
    if (isPr) {
        const tail = log ? readFileSync(log, 'utf8').trimEnd().split('\n').slice(-25).join('\n') : ''
        const body = `${cfg.gate.context} for ${sha.slice(0, 7)}: **${state}** (${how})\n${state === 'success' ? '' : `\n\`\`\`\n${tail}\n\`\`\`\n`}`
        const c = run('gh', ['pr', 'comment', target, '-R', cfg.repo, '--body-file', '-'], { input: body })
        if (c.status !== 0) stop(1, `cannot post the comment; nothing posted${where}`)
        url = c.stdout.trim()
    }
    const post = run('gh', ['api', `repos/${cfg.repo}/statuses/${sha}`, '-f', `state=${state}`, '-f', `context=${cfg.gate.context}`, '-f', `description=${desc.slice(0, 140)}`, ...(url ? ['-f', `target_url=${url}`] : [])])
    if (post.status !== 0) stop(1, `cannot post the status${isPr ? ' (the comment was posted)' : ''}${where}`)
    console.log(`${cfg.gate.context}=${state} posted on ${sha.slice(0, 7)}${log && ` (log: ${log})`}`)
    if (state !== 'success') return 1

    // 9. A passing default-branch commit moves the deploy branch: a plain push, never forced.
    const deploy = cfg.deploy_branch
    if (!isPr && deploy) {
        git('fetch', '-q', 'origin', `+refs/heads/${deploy}:refs/remotes/origin/${deploy}`)   // so a stale local view of the branch is not mistaken for "already past"
        const p = git('push', '--porcelain', 'origin', `${sha}:refs/heads/${deploy}`)
        if (p.status === 0) console.log(`${deploy} -> ${sha.slice(0, 7)}`)
        // only a plain "[rejected]" (non-fast-forward) is "not moved"; "[remote rejected]" (a hook or protection declined) is an error
        else if (/\t\[rejected\] \((non-fast-forward|fetch first)\)/.test(p.stdout)) console.log(`${deploy} not moved: already past or diverged from ${sha.slice(0, 7)}`)
        else stop(1, `${cfg.gate.context} is posted but ${deploy} was not moved: git push origin ${sha}:refs/heads/${deploy}\n${p.stdout}${p.stderr}`)
    }
    return 0
}

try {
    process.exitCode = main()
} catch (e) {
    if (!(e instanceof Exit)) throw e
    console.error(`local-verify: ${e.message}`)
    process.exitCode = e.code
}
