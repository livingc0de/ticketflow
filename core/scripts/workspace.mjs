#!/usr/bin/env node
/**
 * Opens a ticket's working tree in one call: fetch origin, make sure the worktrees directory is git-ignored (an entry in the primary
 * checkout's `.git/info/exclude` when it is not), `git worktree add --no-track <worktrees_dir>/<branch> -b <branch> origin/<default_branch>`,
 * then `verify.install` inside it. Works from the primary checkout or from any of its worktrees; the new worktree always goes under the primary one.
 * It refuses a branch or directory that already exists (that is a resumed ticket: read resume.md), and never touches an existing one.
 *
 * Usage: workspace.mjs <type>/issue-<N>-<slug> [--config f]
 * Exit: 0 = ready (the last line names the path), 1 = refused, a git step or the install failed (a created worktree is kept and named), 2 = usage or config.
 */

import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { cli, main } from '../lib/cli.mjs'

const { positionals: [branch], cfg } = cli(import.meta.url, 'workspace', '<type>/issue-<N>-<slug> [--config f]', {},
    (p) => p.length === 1 && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(p[0]) && !p[0].includes('..') && !p[0].endsWith('/') && !p[0].endsWith('.lock'))

const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' })
const fail = (message) => { console.error(`workspace: ${message}`); return 1 }

main('workspace', () => {
    const common = git(process.cwd(), 'rev-parse', '--path-format=absolute', '--git-common-dir')
    const gitDir = common.stdout.trim()
    if (common.status !== 0 || basename(gitDir) !== '.git') throw new Error('run it inside a git checkout (not a bare repository)')
    const primary = dirname(gitDir)
    const path = join(resolve(primary, cfg.worktrees_dir), branch)
    if (existsSync(path)) return fail(`${path} already exists: this ticket is already started, resume it (resume.md) instead`)
    if (git(primary, 'rev-parse', '--verify', '-q', `refs/heads/${branch}`).status === 0) return fail(`the branch ${branch} already exists: this ticket is already started, resume it (resume.md) instead`)
    const fetched = git(primary, 'fetch', 'origin')
    if (fetched.status !== 0) return fail(`git fetch origin failed: ${fetched.stderr.trim()}`)
    if (git(primary, 'check-ignore', '-q', path).status !== 0) {
        const exclude = resolve(primary, git(primary, 'rev-parse', '--git-path', 'info/exclude').stdout.trim())
        const dir = resolve(primary, cfg.worktrees_dir)
        const rel = dir.startsWith(`${primary}/`) ? `${dir.slice(primary.length + 1)}/` : null   // only a directory inside the checkout can be ignored
        if (rel && !(existsSync(exclude) && readFileSync(exclude, 'utf8').split('\n').includes(rel))) appendFileSync(exclude, `${rel}\n`)
    }
    const added = git(primary, 'worktree', 'add', '--no-track', path, '-b', branch, `origin/${cfg.default_branch}`)
    if (added.status !== 0) return fail(`git worktree add failed: ${(added.stderr || added.stdout).trim()}`)
    if (cfg.verify.install) {
        const r = spawnSync(cfg.verify.install, { cwd: path, shell: true, encoding: 'utf8' })
        if (r.status !== 0) return fail(`install failed (${cfg.verify.install}) in ${path}, which is kept: ${(r.stderr || r.stdout).trim().split('\n').slice(-5).join(' | ')}`)
    }
    console.log(`workspace: ${path} (branch ${branch} from origin/${cfg.default_branch}${cfg.verify.install ? ', install done' : ''})`)
})
