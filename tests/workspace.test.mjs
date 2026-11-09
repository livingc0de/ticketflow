import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDir, writeConfig } from './helpers.mjs'

const script = new URL('../core/scripts/workspace.mjs', import.meta.url).pathname
const git = (cwd, ...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...a], { cwd, encoding: 'utf8' })

/** A bare origin with one commit on main and a clone of it (the primary checkout), plus a config file. */
function repo(over = {}) {
    const root = tempDir('ws-')
    const origin = join(root, 'origin.git'), primary = join(root, 'primary')
    git(root, 'init', '-q', '--bare', '-b', 'main', origin)
    git(root, 'clone', '-q', origin, primary)
    writeFileSync(join(primary, 'a.txt'), '1\n')
    git(primary, 'add', '-A'); git(primary, 'commit', '-qm', 'one'); git(primary, 'push', '-q', 'origin', 'HEAD:main')
    return { root, origin, primary, config: writeConfig(root, over) }
}
const run = (r, args, cwd = r.primary) => spawnSync(process.execPath, [script, ...args, '--config', r.config], { cwd, encoding: 'utf8' })

test('opens the worktree on a new branch from the fetched origin/main, keeps it out of git status and runs the install there', () => {
    const r = repo({ verify: { install: 'echo done > installed.txt' } })
    // origin moves after the clone: the branch must start at the new tip, so the script fetches
    const other = join(r.root, 'other')
    git(r.root, 'clone', '-q', r.origin, other)
    writeFileSync(join(other, 'b.txt'), '2\n'); git(other, 'add', '-A'); git(other, 'commit', '-qm', 'two'); git(other, 'push', '-q', 'origin', 'HEAD:main')
    const out = run(r, ['feat/issue-7-x'])
    assert.equal(out.status, 0, out.stdout + out.stderr)
    const path = join(r.primary, '.worktrees', 'feat/issue-7-x')
    assert.match(out.stdout, new RegExp(`^workspace: ${path.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')} \\(branch feat/issue-7-x from origin/main`, 'm'))
    assert.ok(existsSync(join(path, 'b.txt')), 'started at the fetched tip')
    assert.equal(readFileSync(join(path, 'installed.txt'), 'utf8'), 'done\n')
    assert.equal(git(r.primary, 'status', '--porcelain').stdout, '', 'the worktrees dir is ignored')
    assert.equal(git(path, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}').status !== 0, true, 'no upstream (--no-track)')
})

test('a second run for the same branch changes nothing and says to resume', () => {
    const r = repo()
    assert.equal(run(r, ['feat/issue-7-x']).status, 0)
    const again = run(r, ['feat/issue-7-x'])
    assert.equal(again.status, 1)
    assert.match(again.stderr, /already exists.*resume/)
    // a branch left behind without its worktree counts too
    git(r.primary, 'branch', 'fix/issue-8-y')
    assert.equal(run(r, ['fix/issue-8-y']).status, 1)
})

test('run from inside another worktree it still creates the new one under the primary checkout', () => {
    const r = repo()
    assert.equal(run(r, ['feat/issue-7-x']).status, 0)
    const out = run(r, ['feat/issue-9-z'], join(r.primary, '.worktrees', 'feat/issue-7-x'))
    assert.equal(out.status, 0, out.stdout + out.stderr)
    assert.ok(existsSync(join(r.primary, '.worktrees', 'feat/issue-9-z')))
})

test('a failing install keeps the worktree and names it; an unusable branch name exits 2 before any change', () => {
    const r = repo({ verify: { install: 'exit 3' } })
    const bad = run(r, ['feat/issue-7-x'])
    assert.equal(bad.status, 1)
    assert.match(bad.stderr, /install failed.*\.worktrees/)
    assert.ok(existsSync(join(r.primary, '.worktrees', 'feat/issue-7-x')))
    for (const name of ['../x', '-b', 'a b', '']) assert.equal(run(r, [name]).status, 2, name)
})

test('a nested worktrees_dir is ignored as itself, not as its first path component', () => {
    const r = repo({ worktrees_dir: 'tmp/wt' })
    const out = run(r, ['feat/issue-8-y'])
    assert.equal(out.status, 0, out.stdout + out.stderr)
    assert.equal(git(r.primary, 'check-ignore', '-q', 'tmp/wt/feat/issue-8-y/a.txt').status, 0, 'the worktrees dir is ignored')
    assert.equal(git(r.primary, 'check-ignore', '-q', 'tmp/other.txt').status, 1, 'the rest of tmp/ is not')
})

test('a failed fetch stops before any worktree is added', () => {
    const r = repo()
    git(r.primary, 'remote', 'set-url', 'origin', join(r.root, 'missing.git'))
    const out = run(r, ['feat/issue-9-z'])
    assert.equal(out.status, 1, out.stdout + out.stderr)
    assert.match(out.stderr + out.stdout, /git fetch origin failed/)
    assert.equal(existsSync(join(r.primary, '.worktrees', 'feat/issue-9-z')), false)
})
