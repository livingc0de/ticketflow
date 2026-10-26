import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { FAIL, fakeGh, rawConfig, seq, tempDir } from './helpers.mjs'

const CORE = new URL('../core/', import.meta.url).pathname
const REAL_GIT = execFileSync('which', ['git'], { encoding: 'utf8' }).trim()
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
const sha = (c) => c.repeat(40)
const [R, M, C] = [sha('1'), sha('2'), sha('4')]
const OTHER = sha('9')

/**
 * A real bare origin plus a clone that holds the committed ticketflow runtime (.ticketflow/{scripts,lib,config.json}), a stub
 * pr-wait that exits per PRWAIT_SEQ, a `git` wrapper that logs and can be made to fail, the helpers' fake gh, and fake
 * `fake-install` / `fake-verify` on PATH. refs/pull/7/head is pushed.
 */
function setup(o = {}) {
    const { branch = 'main', config = {}, prFiles = { 'src/a.js': 'x' }, behind = false, later = { 'later.txt': 'y' }, pushRuntime = true, prWait = '3', heads, headRepo = 'o/r', baseRepo = 'o/r', baseRef = branch, fixtures = () => ({}), install = 'fake-install', command = 'fake-verify' } = o
    const dir = tempDir('lv-')
    const origin = join(dir, 'origin.git'), repo = join(dir, 'repo'), home = join(dir, 'home'), state = join(dir, 'state')
    for (const d of [home, state, join(dir, 'bin')]) mkdirSync(d, { recursive: true })
    const g = (cwd, ...a) => execFileSync(REAL_GIT, a, { cwd, env: GIT_ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
    g(dir, 'init', '-q', '--bare', '-b', branch, origin)
    g(dir, 'clone', '-q', origin, repo)
    g(repo, 'checkout', '-q', '-b', branch)
    const put = (rel, text) => { mkdirSync(join(repo, rel, '..'), { recursive: true }); writeFileSync(join(repo, rel), text) }
    put('README.md', 'x\n')
    g(repo, 'add', '-A'); g(repo, 'commit', '-qm', 'c1'); g(repo, 'push', '-q', 'origin', branch)
    const writeRuntime = () => {
        mkdirSync(join(repo, '.ticketflow/scripts'), { recursive: true }); mkdirSync(join(repo, '.ticketflow/lib'), { recursive: true })
        copyFileSync(join(CORE, 'scripts/local-verify.mjs'), join(repo, '.ticketflow/scripts/local-verify.mjs'))
        for (const f of readdirSync(join(CORE, 'lib'))) copyFileSync(join(CORE, 'lib', f), join(repo, '.ticketflow/lib', f))
        put('.ticketflow/scripts/pr-wait.mjs', `import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
const s = process.env.STATE
appendFileSync(s + '/prwait.log', process.argv.slice(2).join(' ') + '\\n')
const f = s + '/prwait.n', n = existsSync(f) ? Number(readFileSync(f, 'utf8')) : 0
writeFileSync(f, String(n + 1))
const seq = process.env.PRWAIT_SEQ.split(',')
process.exit(Number(seq[Math.min(n, seq.length - 1)]))
`)
        put('.ticketflow/config.json', JSON.stringify(rawConfig({ default_branch: branch, verify: { install, command }, docs_only: { docs: ['^docs/', '\\.md$'] }, deploy_branch: 'deploy', ...config })))
        g(repo, 'add', '-A'); g(repo, 'commit', '-qm', 'runtime')
    }
    writeRuntime()
    if (pushRuntime) g(repo, 'push', '-q', 'origin', branch)
    g(repo, 'switch', '-q', '-c', 'pr')
    for (const [f, text] of Object.entries(prFiles)) put(f, text)
    g(repo, 'add', '-A'); g(repo, 'commit', '-qm', 'pr', '--allow-empty')
    const head = g(repo, 'rev-parse', 'HEAD')
    g(repo, 'push', '-q', 'origin', `${head}:refs/pull/7/head`)
    g(repo, 'switch', '-q', branch)
    const runtimeSha = g(repo, 'rev-parse', 'HEAD')
    if (behind) { for (const [f, text] of Object.entries(later)) put(f, text); g(repo, 'add', '-A'); g(repo, 'commit', '-qm', 'later'); g(repo, 'push', '-q', 'origin', branch) }
    const main = g(repo, 'rev-parse', 'HEAD')

    const pullOf = (s) => ({ head: { sha: s, repo: headRepo === null ? null : { full_name: headRepo } }, base: { ref: baseRef, repo: { full_name: baseRepo } } })
    const map = { 'repos/o/r/pulls/7': heads ? seq(...heads.map((x) => (typeof x === 'object' ? { ...pullOf(head), ...x, ...(x.head ? { head: { ...x.head, sha: head } } : {}) } : pullOf(x === 'head' ? head : x === 'main' ? main : x)))) : pullOf(head), ...fixtures({ head, main }) }
    const gh = fakeGh(dir, map)
    const script = (name, body) => { writeFileSync(join(dir, 'bin', name), `#!/usr/bin/env bash\n${body}\n`); chmodSync(join(dir, 'bin', name), 0o755) }
    script('git', `echo "$*" >> ${state}/git.log
if [ "$1" = -C ]; then sub=$3; else sub=$1; fi
key=$sub; [ "$sub" = diff ] && [[ " $* " == *" -z "* ]] && key=diff-z
[ -f ${state}/out-$key ] && cat ${state}/out-$key
if [ -f ${state}/fail-$key ]; then echo "forced failure" >&2; exit $(cat ${state}/fail-$key); fi
exec ${REAL_GIT} "$@"`)
    for (const name of ['fake-install', 'fake-verify']) {
        script(name, `echo "${name} pwd=$PWD CI=$CI SECRET=\${AGENT_SECRET:-unset}" >> ${state}/runlog
echo "output of ${name}"
exit $(cat ${state}/rc-${name} 2>/dev/null || echo 0)`)
    }
    const h = {
        dir, repo, home, state, head, main, runtimeSha, gh, origin,
        g: (...a) => g(repo, ...a),
        originRef: (ref) => { try { return g(origin, 'rev-parse', '-q', '--verify', ref) } catch { return null } },
        set: (file, text) => writeFileSync(join(state, file), String(text)),
        slow: (rc) => script('timeout', `exit ${rc}`),
        run: (target = '7', over = {}) => spawnSync(process.execPath, [join(repo, '.ticketflow/scripts/local-verify.mjs'), target], {
            encoding: 'utf8', env: { ...gh.env, HOME: home, STATE: state, PRWAIT_SEQ: prWait, AGENT_SECRET: 'must-not-reach-the-verify', ...over },
        }),
        file: (f) => (existsSync(join(state, f)) ? readFileSync(join(state, f), 'utf8').trim().split('\n') : []),
        statuses: () => gh.calls().filter((c) => c[0] === 'api' && /\/statuses\//.test(c[1])).map((c) => ({ path: c[1], ...Object.fromEntries(c.filter((a) => /^(state|context|description|target_url)=/.test(a)).map((a) => [a.split('=')[0], a.slice(a.indexOf('=') + 1)])) })),
        runlog: () => h.file('runlog'),
        gitLog: () => h.file('git.log'),
    }
    return h
}
const posted = (h) => h.statuses().length + h.gh.comments().length
const noPost = (h) => assert.equal(posted(h), 0)

test('guard refused: exit 3, nothing run or posted, pr-wait is asked for this target with --once', () => {
    const h = setup({ prWait: '2' })
    const r = h.run()
    assert.equal(r.status, 3, r.stderr)
    noPost(h)
    assert.deepEqual(h.runlog(), [])
    assert.equal(h.file('prwait.log')[0], '7 --once --ci-only')
})

test('a fork, a deleted fork and another base are refused (3); a renamed repo runs, the old name as head does not', () => {
    for (const o of [{ headRepo: 'someone/r' }, { headRepo: null }, { baseRef: 'develop' }, { baseRepo: 'n/r2' }]) {
        const h = setup(o)
        assert.equal(h.run().status, 3, JSON.stringify(o))
        noPost(h); assert.deepEqual(h.runlog(), [])
    }
    const renamed = setup({ headRepo: 'n/r2', baseRepo: 'n/r2' })   // head and base are the same repository under its new name
    assert.equal(renamed.run().status, 0)
    assert.equal(renamed.statuses().length, 1)
})

test('behind the default branch: update-branch, exit 1, nothing run; a git error is not "behind"', () => {
    const h = setup({ behind: true })
    assert.equal(h.run().status, 1)
    assert.ok(h.gh.calls().some((c) => c.join(' ') === 'pr update-branch 7 -R o/r'))
    noPost(h); assert.deepEqual(h.runlog(), [])
    const e = setup()
    e.set('fail-merge-base', 128)
    const r = e.run()
    assert.equal(r.status, 1)
    assert.ok(!e.gh.calls().some((c) => c[0] === 'pr')); noPost(e); assert.deepEqual(e.runlog(), [])
    const failedUpdate = setup({ behind: true, fixtures: () => ({ 'pr update-branch': FAIL }) })
    const fr = failedUpdate.run()
    assert.equal(fr.status, 1)
    assert.match(fr.stderr, /update-branch failed/)
})

test('the head moved while fetching: nothing posted', () => {
    const h = setup({ heads: ['main', 'main'] })   // the API says a commit that exists, refs/pull/7/head says another
    const r = h.run()
    assert.equal(r.status, 1)
    assert.match(r.stderr, /moved while fetching/)
    noPost(h); assert.deepEqual(h.runlog(), [])
})

test('success: one comment and one status with exact args, the worktree is created for the head and removed before and after', () => {
    const h = setup()
    const r = h.run()
    assert.equal(r.status, 0, r.stderr)
    const [s] = h.statuses()
    assert.equal(h.statuses().length, 1)
    assert.equal(s.path, `repos/o/r/statuses/${h.head}`)
    assert.equal(s.state, 'success'); assert.equal(s.context, 'CI / Gate')
    assert.match(s.description, /^Local run on \S+ \(\S+, Node \d+\./)
    assert.ok(s.description.length <= 140)
    assert.equal(s.target_url, 'https://github.com/o/r/pull/7#issuecomment-1')
    const commentCall = h.gh.calls().find((c) => c[0] === 'pr' && c[1] === 'comment')
    assert.deepEqual(commentCall, ['pr', 'comment', '7', '-R', 'o/r', '--body-file', '-'])
    assert.equal(h.gh.comments().length, 1)
    assert.match(h.gh.comments()[0], new RegExp(`^### CI / Gate: Passed\\n\\nCommit ${h.head.slice(0, 7)}, \\*\\*success\\*\\*\\. Local run on `))
    const log = h.gitLog()
    const add = log.findIndex((l) => /worktree add -q --detach \S+ /.test(l) && l.endsWith(h.head))
    assert.ok(add > 0)
    const removes = log.map((l, i) => (l.includes('worktree remove') ? i : -1)).filter((i) => i >= 0)
    assert.equal(removes.length, 2)
    assert.ok(removes[0] < add && removes[1] > add, 'a remove before the add (a leftover) and one after the run')
    // the verify ran in the head's worktree, which is gone now
    const wt = `${h.home}/.cache/ticketflow-verify/o__r/${h.head.slice(0, 12)}`
    assert.match(h.runlog()[0], new RegExp(`^fake-install pwd=${wt}`))
    assert.match(h.runlog()[1], new RegExp(`^fake-verify pwd=${wt}`))
    assert.ok(!existsSync(wt))
    assert.equal(h.originRef('refs/heads/deploy'), null, 'a PR run never moves the deploy branch')
    assert.ok(!h.gitLog().some((l) => / push /.test(l)))
})

test('clean environment: CI=true, the caller\'s variables stay out; an empty install runs only the command', () => {
    const h = setup()
    h.run()
    assert.ok(h.runlog().every((l) => / CI=true SECRET=unset$/.test(l)), h.runlog().join('\n'))
    const e = setup({ install: '' })
    e.run()
    assert.equal(e.runlog().length, 1)
    assert.match(e.runlog()[0], /^fake-verify /)
})

test('a failing command posts a failure status and a comment with the log tail, exit 1; the install failing skips the command', () => {
    const h = setup()
    h.set('rc-fake-verify', 1)
    const r = h.run()
    assert.equal(r.status, 1)
    assert.equal(h.statuses()[0].state, 'failure')
    assert.match(h.gh.comments()[0], /\*\*failure\*\*[\s\S]*output of fake-verify/)
    const i = setup()
    i.set('rc-fake-install', 1)
    assert.equal(i.run().status, 1)
    assert.equal(i.runlog().length, 1)
    assert.equal(i.statuses()[0].state, 'failure')
})

test('recheck: not allowed any more, or a moved head, posts nothing (after the run)', () => {
    const a = setup({ prWait: '3,2' })
    assert.equal(a.run().status, 1)
    noPost(a)
    assert.equal(a.runlog().length, 2, 'it verified before the recheck')
    const m = setup({ heads: ['head', OTHER] })
    assert.equal(m.run().status, 1)
    noPost(m)
    assert.equal(m.runlog().length, 2)
})

test('a timeout posts nothing and the worktree is removed', () => {
    const h = setup()
    h.slow(124)
    const r = h.run()
    assert.equal(r.status, 1)
    assert.match(r.stderr, /timed out after 45 min/)
    noPost(h)
    assert.ok(!existsSync(`${h.home}/.cache/ticketflow-verify/o__r/${h.head.slice(0, 12)}`))
})

test('a docs-only head posts "Local check on <host>, docs only" without running anything; the diff runs against origin/<default> and the head', () => {
    const h = setup({ prFiles: { 'docs/a.md': 'x', 'NOTES.md': 'y' } })
    const r = h.run()
    assert.equal(r.status, 0, r.stderr)
    assert.deepEqual(h.runlog(), [])
    assert.ok(!h.gitLog().some((l) => l.includes('worktree add')))
    assert.match(h.statuses()[0].description, /^Local check on \S+, docs only$/)
    assert.match(h.gh.comments()[0], /\*\*success\*\*\. Local check on /)
    assert.ok(h.gitLog().some((l) => l.endsWith(`diff -z --no-renames --name-only refs/remotes/origin/main ${h.head}`)), h.gitLog().join('\n'))
})

test('a code, mixed, empty or unreadable diff, or a floor path, runs the full verify', () => {
    const cases = [{ 'src/a.js': 'x' }, { 'docs/a.md': 'x', 'src/a.js': 'x' }, {}, { '.ticketflow/notes.md': 'x' }, { '.github/workflows/x.md': 'x' }]
    for (const prFiles of cases) {
        const h = setup({ prFiles })
        assert.equal(h.run().status, 0)
        assert.equal(h.runlog().length, 2, JSON.stringify(prFiles))
        assert.match(h.statuses()[0].description, /^Local run on /)
    }
    const u = setup({ prFiles: { 'docs/a.md': 'x' } })
    u.set('fail-diff-z', 128)
    u.run()
    assert.equal(u.runlog().length, 2)
})

test('a docs-only head still goes through the recheck', () => {
    const a = setup({ prFiles: { 'docs/a.md': 'x' }, prWait: '3,2' })
    assert.equal(a.run().status, 1); noPost(a)
    const m = setup({ prFiles: { 'docs/a.md': 'x' }, heads: ['head', OTHER] })
    assert.equal(m.run().status, 1); noPost(m)
})

const inheritFixtures = (branch = 'main', files = [{ filename: 'docs/a.md' }]) => ({ head }) => ({
    [`repos/o/r/git/ref/heads/${branch}`]: { object: { sha: M } },
    [`repos/o/r/commits/${head}`]: { parents: [{ sha: R }, { sha: M }] },
    [`repos/o/r/commits/${R}/status`]: { statuses: [{ context: 'CI / Gate', state: 'success', description: 'Local run on host1 (x86_64, Node 24.0.0)' }] },
    [`repos/o/r/compare/${R}...${head}`]: { status: 'ahead', behind_by: 0, files },
    [`repos/o/r/compare/${R}...${M}`]: { ahead_by: 1, commits: [{ sha: C }] },
    [`repos/o/r/commits/${C}`]: { files: [{ filename: 'docs/b.md' }] },
    [`repos/o/r/compare/${M}...${head}`]: { files: [{ filename: 'docs/a.md' }] },
})

test('inherited: its description, no command, no worktree; it wins over docs-only; gate.inherit false reads nothing', () => {
    const h = setup({ config: { gate: { inherit: true } }, fixtures: inheritFixtures(), prFiles: { 'docs/a.md': 'x' } })
    assert.equal(h.run().status, 0)
    assert.equal(h.statuses()[0].description, 'Inherited from 1111111: only docs merged from main')
    assert.deepEqual(h.runlog(), [])
    assert.ok(!h.gitLog().some((l) => l.includes('worktree add')))
    assert.match(h.gh.comments()[0], /\. Inherited from 1111111: only docs merged from main; inherited, no verify run\./)
    const off = setup({ fixtures: inheritFixtures(), prFiles: { 'docs/a.md': 'x' } })
    off.run()
    assert.ok(!off.gh.calls().some((c) => /git\/ref\/heads/.test(c[1] ?? '')))
    assert.match(off.statuses()[0].description, /^Local check on /)
})

test('an inherit throw or a "no" falls through to the full run', () => {
    const t = setup({ config: { gate: { inherit: true } } })   // no fixtures: every inherit read fails
    assert.equal(t.run().status, 0)
    assert.equal(t.runlog().length, 2)
    const no = setup({ config: { gate: { inherit: true } }, fixtures: ({ head }) => ({ ...inheritFixtures()({ head }), [`repos/o/r/compare/${R}...${head}`]: FAIL }) })
    no.run()
    assert.equal(no.runlog().length, 2)
})

test('descriptions are cut at 140 characters', () => {
    const branch = 'b'.repeat(110)
    const h = setup({ branch, config: { gate: { inherit: true } }, fixtures: inheritFixtures(branch), prFiles: { 'docs/a.md': 'x' } })
    assert.equal(h.run().status, 0)
    const d = h.statuses()[0].description
    assert.equal(d.length, 140)
    assert.match(d, /^Inherited from 1111111: only docs merged from b+/)
})

test('a non-digit or malformed target is refused (2) before any call', () => {
    const h = setup()
    for (const t of ['7;id', '$(id)', '--help', 'x', 'abc'.repeat(14), '']) {
        const r = h.run(t)
        assert.equal(r.status, 2, t)
    }
    assert.deepEqual(h.gh.calls(), []); assert.deepEqual(h.gitLog(), [])
})

test('the runtime must equal origin/<default>: a modified config or lib, or a config origin lacks, is refused (3)', () => {
    for (const file of ['.ticketflow/lib/config.mjs', '.ticketflow/config.json', '.ticketflow/scripts/pr-wait.mjs', '.ticketflow/scripts/local-verify.mjs']) {
        const h = setup()
        const path = join(h.repo, file)
        writeFileSync(path, readFileSync(path, 'utf8') + (file.endsWith('.json') ? '\n' : '\n// edited\n'))
        const r = h.run()
        assert.equal(r.status, 3, `${file}: ${r.stderr}`)
        assert.match(r.stderr, /runtime differs/)
        noPost(h); assert.deepEqual(h.runlog(), []); assert.equal(h.gh.calls().length, 0)
    }
    const unpushed = setup({ pushRuntime: false })
    const r = unpushed.run()
    assert.equal(r.status, 3, r.stderr)
    noPost(unpushed); assert.deepEqual(unpushed.runlog(), [])
})

test('a failing fetch of the default branch is exit 1 with nothing posted', () => {
    const h = setup()
    h.set('fail-fetch', 1)
    assert.equal(h.run().status, 1); noPost(h)
})

// sha mode
test('sha: the status only, no comment, the verify ran in the sha\'s worktree, and the deploy branch is created', () => {
    const h = setup({ behind: true })
    const r = h.run(h.main)
    assert.equal(r.status, 0, r.stderr)
    assert.equal(h.gh.comments().length, 0)
    assert.equal(h.statuses().length, 1)
    assert.equal(h.statuses()[0].path, `repos/o/r/statuses/${h.main}`)
    assert.equal(h.statuses()[0].state, 'success')
    assert.equal(h.statuses()[0].target_url, undefined)
    assert.match(h.runlog()[0], new RegExp(`pwd=\\S*/${h.main.slice(0, 12)}`))
    assert.equal(h.originRef('refs/heads/deploy'), h.main)
    assert.ok(!h.gh.calls().some((c) => /pulls/.test(c[1] ?? '')))
    assert.equal(h.file('prwait.log')[0], `${h.main} --once --ci-only`)
})

test('sha red: a failure status is posted (the policy), the deploy branch is untouched', () => {
    const h = setup()
    h.set('rc-fake-verify', 1)
    const r = h.run(h.main)
    assert.equal(r.status, 1)
    assert.equal(h.statuses()[0].state, 'failure')
    assert.equal(h.originRef('refs/heads/deploy'), null)
})

test('sha: a diverged deploy branch is left alone (exit 0); push args are never forced; another push error is exit 1; null deploy_branch pushes nothing', () => {
    const d = setup()
    const side = d.g('commit-tree', 'HEAD^{tree}', '-m', 'side')
    d.g('push', '-q', 'origin', `${side}:refs/heads/deploy`)
    const r = d.run(d.main)
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /deploy not moved/)
    assert.equal(d.originRef('refs/heads/deploy'), side)
    const pushes = d.gitLog().filter((l) => / push /.test(l))
    assert.equal(pushes.length, 1)
    assert.ok(!/--force|-f | \+|\+refs/.test(pushes[0]), pushes[0])
    assert.match(pushes[0], new RegExp(`push --porcelain origin ${d.main}:refs/heads/deploy$`))

    const e = setup()
    e.set('fail-push', 1)
    const er = e.run(e.main)
    assert.equal(er.status, 1)
    assert.match(er.stderr, new RegExp(`git push origin ${e.main}:refs/heads/deploy`))
    assert.equal(e.statuses()[0].state, 'success', 'the status stands')

    const n = setup({ config: { deploy_branch: null } })
    assert.equal(n.run(n.main).status, 0)
    assert.ok(!n.gitLog().some((l) => / push /.test(l)))
})

test('sha not on the default branch: nothing posted; a refused guard is 3; the recheck guards a sha too', () => {
    const h = setup()
    assert.equal(h.run(h.head).status, 1); noPost(h); assert.deepEqual(h.runlog(), [])
    const g = setup({ prWait: '0' })
    assert.equal(g.run(g.main).status, 3); noPost(g)
    const re = setup({ prWait: '3,2' })
    assert.equal(re.run(re.main).status, 1); noPost(re)
    assert.equal(re.originRef('refs/heads/deploy'), null)
})

test('the runtime check fails closed on untracked runtime files and on a git error; a tag named like the remote branch is not the base', () => {
    const u = setup({ pushRuntime: false })
    u.g('reset', '-q', '--mixed', 'origin/main')   // the runtime is now untracked, so `git diff` alone would not see it
    const r = u.run()
    assert.equal(r.status, 3, r.stderr)
    noPost(u); assert.deepEqual(u.runlog(), [])
    const e = setup()
    e.set('fail-diff', 128)
    assert.equal(e.run().status, 1)
    assert.equal(e.gh.calls().length, 0)
    const f = setup()
    f.set('fail-ls-files', 128)
    assert.equal(f.run().status, 1)
    assert.equal(f.gh.calls().length, 0)
    assert.match(u.run().stderr, /untracked files: .*\.ticketflow\//)
    const l = setup({ prFiles: { 'docs/a.md': 'x' } })
    l.g('tag', 'origin/main', l.head)   // would make `origin/main` the PR head itself: an empty, "not docs-only" diff
    assert.equal(l.run().status, 0)
    assert.match(l.statuses()[0].description, /^Local check on /)
    assert.ok(l.gitLog().some((x) => x.includes('refs/remotes/origin/main')))
})

test('a signal from the verify posts nothing', () => {
    const h = setup()
    writeFileSync(join(h.dir, 'bin', 'timeout'), '#!/usr/bin/env bash\nkill -TERM $$\n')
    chmodSync(join(h.dir, 'bin', 'timeout'), 0o755)
    const r = h.run()
    assert.equal(r.status, 1)
    assert.match(r.stderr, /killed by SIGTERM/)
    noPost(h)
})

test('sha mode never takes the docs-only shortcut, even when the commits after it are docs-only', () => {
    const h = setup({ behind: true, later: { 'docs/x.md': 'y' } })
    const r = h.run(h.runtimeSha)
    assert.equal(r.status, 0, r.stderr)
    assert.equal(h.runlog().length, 2)
    assert.match(h.statuses()[0].description, /^Local run on /)
})

test('a docs-only diff that fails after printing part of the list is a full run', () => {
    const h = setup({ prFiles: { 'docs/a.md': 'x' } })
    h.set('out-diff-z', 'docs/a.md\0')
    h.set('fail-diff-z', 128)
    h.run()
    assert.equal(h.runlog().length, 2)
})

test('a failed comment posts no status; a failed status after the comment is exit 1 and says so', () => {
    const c = setup({ fixtures: () => ({ 'pr comment': FAIL }) })
    assert.equal(c.run().status, 1)
    assert.equal(c.statuses().length, 0)
    const s = setup({ fixtures: () => ({ 'statuses write': FAIL }) })
    const r = s.run()
    assert.equal(r.status, 1)
    assert.match(r.stderr, /cannot post the status \(the comment was posted\)/)
    assert.equal(s.gh.comments().length, 1)
})

test('a recheck that finds another base, or cannot read the head, posts nothing', () => {
    const base = setup({ heads: ['head', { base: { ref: 'develop', repo: { full_name: 'o/r' } } }] })
    assert.equal(base.run().status, 1); noPost(base)
    const fork = setup({ heads: ['head', { head: { repo: { full_name: 'someone/r' } } }] })
    assert.equal(fork.run().status, 1); noPost(fork)
    const failed = setup({ heads: ['head', FAIL] })
    const r = failed.run()
    assert.equal(r.status, 1); noPost(failed)
    assert.match(r.stderr, /cannot re-read the head/)
})

test('a deploy push declined by the remote (a hook) is an error, not "not moved"', () => {
    const h = setup()
    const hook = join(h.origin, 'hooks', 'pre-receive')
    writeFileSync(hook, '#!/bin/sh\nwhile read old new ref; do [ "$ref" = refs/heads/deploy ] && { echo declined >&2; exit 1; }; done\nexit 0\n')
    chmodSync(hook, 0o755)
    const r = h.run(h.main)
    assert.equal(r.status, 1)
    assert.match(r.stderr, new RegExp(`git push origin ${h.main}:refs/heads/deploy`))
    assert.equal(h.statuses()[0].state, 'success', 'the status stands')
})
