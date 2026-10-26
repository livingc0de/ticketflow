import test from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { GuardError, claudeAsk, codexRules, hookDecision, loadGuard, segments, tokenize } from '../core/lib/guard.mjs'
import { config, tempDir, writeConfig } from './helpers.mjs'

const cfg = config()
const SCRIPTS = '.ticketflow/scripts'
const guard = loadGuard(cfg)
const examples = guard.forms.flatMap((f) => f.examples.map((e) => ({ ...e, form: f.id })))
const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } })
const decide = (command, opts = {}) => hookDecision(bash(command), cfg, { cwd: '/', ...opts })

test('every example gives its declared Codex hook result', () => {
    assert.ok(examples.length >= 25)
    for (const e of examples) assert.equal(decide(e.cmd).block, e.codex === 'block', `${e.form}: ${e.cmd}`)
})

test('every block names the allowed path', () => {
    for (const e of examples.filter((x) => x.codex === 'block')) assert.match(decide(e.cmd).reason, /merge\.mjs|local-verify\.mjs|protect\.mjs/, e.cmd)
})

test('Claude ask rules: every ask example matches one, every pass example matches none (wildcard approximation)', () => {
    const rules = claudeAsk(cfg).map((r) => r.slice('Bash('.length, -1))
    const re = rules.map((p) => new RegExp(`^${p.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\/]/g, '\\$&')).join('.*')}$`))
    for (const e of examples) assert.equal(re.some((r) => r.test(e.cmd)), e.claude === 'ask', `${e.form}: ${e.cmd}`)
    assert.ok(rules.includes('gh pr merge') && rules.includes('git push * main'))
})

const hasCodex = spawnSync('codex', ['--version']).status === 0
test('the Codex rules load and decide as the examples say', { skip: !hasCodex && 'codex is not on PATH' }, () => {
    const dir = tempDir('guard-')
    const file = join(dir, 't.rules')
    writeFileSync(file, codexRules(cfg))
    for (const e of examples) {
        const r = spawnSync('codex', ['execpolicy', 'check', '--rules', file, '--', ...tokenize(e.cmd)], { encoding: 'utf8' })
        assert.equal(r.status, 0, `${e.cmd}: ${r.stderr}`)   // a rule whose match / not_match examples disagree does not load
        const decision = JSON.parse(r.stdout).decision
        assert.equal(decision === 'prompt', e.codex === 'prompt', `${e.cmd}: ${r.stdout}`)
    }
})

test('the rules text has one prompt rule per pattern, with alternatives kept', () => {
    const text = codexRules(cfg)
    assert.equal((text.match(/^prefix_rule\(/gm) ?? []).length, guard.forms.flatMap((f) => f.codex_prompt).length)
    assert.match(text, /pattern = \["git","push",\["origin"\],\["main","HEAD:main","\+main","main:main"\]\]/)
    assert.doesNotMatch(text, /\{default_branch\}|\{scripts_dir\}/)
})

test('protocol: a non-Bash tool passes; a missing command blocks; argv arrays and compound commands are parsed', () => {
    assert.equal(hookDecision({ tool_name: 'apply_patch', tool_input: { command: 'git push -u origin main' } }, cfg).block, false)
    assert.equal(hookDecision({ tool_name: 'Bash', tool_input: {} }, cfg).block, true)
    assert.equal(hookDecision({ tool_name: 'Bash' }, cfg).block, true)
    assert.equal(hookDecision(null, cfg).block, false)
    assert.equal(decide(['bash', '-lc', 'git push -u origin main']).block, true)
    assert.equal(decide(['git', 'push', '-u', 'origin', 'main']).block, true)
    assert.equal(decide(['git', 'status']).block, false)
    assert.equal(decide('git status && git push -u origin main').block, true)
    assert.equal(decide('echo hi; gh api -X PUT repos/o/r/pulls/5/merge').block, true)
    assert.equal(decide('FOO=1 git push -u origin main').block, true)
    assert.equal(decide('git log | head\ngit push --force origin main').block, true)
    assert.equal(decide('git commit -m "git push origin main"').block, false)
    assert.equal(decide('git commit -m "x; git push -u origin main"').block, false)   // a quoted separator does not split
    assert.equal(decide("echo 'a && b' && git push -u origin main").block, true)
    assert.deepEqual(segments('a && b || c; d | e\nf "g;h"'), ['a', 'b', 'c', 'd', 'e', 'f "g;h"'])
})

test('a prompt-rule match passes the hook (Codex will ask); the same branch in another position blocks', () => {
    assert.equal(decide('git push origin main').block, false)
    assert.equal(decide('git push origin main --force-with-lease').block, false)
    assert.equal(decide('git push --force origin main').block, true)
    assert.equal(decide('git push origin feat:main').block, true)
    assert.equal(decide('git push origin +HEAD:refs/heads/main').block, true)
    assert.equal(decide('git push origin develop').block, false)
    assert.equal(decide('git push origin origin/main-copy').block, false)
})

function repo(branch) {
    const dir = tempDir('guard-repo-')
    spawnSync('git', ['init', '-q', '-b', branch, dir])
    return dir
}
test('a bare push (or a HEAD push) is blocked on the default branch and passes on a feature branch', () => {
    const onMain = repo('main'), onFeat = repo('feat')
    for (const cmd of ['git push', 'git push origin', 'git push -u origin', 'git push origin HEAD']) {
        assert.equal(decide(cmd, { cwd: onMain }).block, true, cmd)
        assert.equal(decide(cmd, { cwd: onFeat }).block, false, cmd)
    }
    assert.equal(decide('git push origin feat', { cwd: onMain }).block, false)
    assert.equal(decide('git push', { cwd: tempDir('not-a-repo-') }).block, false)
})

test('guard.json is validated: a duplicate id, a bad regex, an example-less form, an unknown check', () => {
    const base = JSON.parse(readFileSync(new URL('../core/guard.json', import.meta.url), 'utf8'))
    const load = (mutate) => {
        const g = structuredClone(base); mutate(g)
        const file = join(tempDir('guard-json-'), 'guard.json'); writeFileSync(file, JSON.stringify(g))
        return () => loadGuard(cfg, { file })
    }
    assert.throws(load((g) => { g.forms[1].id = g.forms[0].id }), GuardError)
    assert.throws(load((g) => { g.forms[0].hook_block = ['(['] }), /bad regex/)
    assert.throws(load((g) => { g.forms[0].examples = [] }), /no examples/)
    assert.throws(load((g) => { g.forms[0].hook_check = ['nope'] }), /unknown check/)
    assert.throws(load((g) => { g.forms[0].reason = '' }), /no reason/)
    assert.throws(() => loadGuard(cfg, { file: join(tempDir('guard-json-'), 'missing.json') }), GuardError)
})

// --- the script ---

const script = new URL('../core/scripts/guard.mjs', import.meta.url).pathname
const hook = (command, args = [], input = bash(command)) =>
    spawnSync(process.execPath, [script, ...args], { input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8', cwd: tempDir('guard-cwd-') })
const withConfig = () => ['--config', writeConfig(tempDir('guard-cfg-'))]

test('exit 2 blocks with the reason on stderr; exit 0 allows', () => {
    const blocked = hook('git push -u origin main', withConfig())
    assert.equal(blocked.status, 2); assert.match(blocked.stderr, /Nothing is pushed to main directly/)
    assert.equal(hook('git status', withConfig()).status, 0)
    assert.equal(hook('git push origin feat', withConfig()).status, 0)
})

test('malformed input and a Bash call without a command exit 2', () => {
    assert.equal(hook('', withConfig(), 'not json').status, 2)
    assert.equal(hook('', withConfig(), '').status, 2)
    assert.equal(hook('', withConfig(), { tool_name: 'Bash', tool_input: {} }).status, 2)
    assert.equal(hook('', withConfig(), { tool_name: 'Read', tool_input: {} }).status, 0)
})

test('a missing config falls back to main and master: still strict, and ordinary commands pass', () => {
    const noConfig = ['--config', join(tempDir('guard-cfg-'), 'missing.json')]
    for (const branch of ['main', 'master']) {
        const r = hook(`git push -u origin ${branch}`, noConfig)
        assert.equal(r.status, 2, branch); assert.match(r.stderr, /warning/)
    }
    assert.equal(hook('ls -la', noConfig).status, 0)
    assert.equal(hook('git push -u origin feat', noConfig).status, 0)
})

test('--self-test exits 0 on the shipped data and 1 on a flipped example', () => {
    assert.equal(hook('', ['--self-test', ...withConfig()]).status, 0)
    const root = tempDir('guard-copy-')
    spawnSync('git', ['init', '-q', root])
    cpSync(new URL('../core', import.meta.url).pathname, join(root, 'core'), { recursive: true })
    const file = join(root, 'core', 'guard.json')
    const g = JSON.parse(readFileSync(file, 'utf8'))
    g.forms[0].examples.find((e) => e.cmd.includes('merge 5 --admin')).codex = 'block'
    writeFileSync(file, JSON.stringify(g))
    const r = spawnSync(process.execPath, [join(root, 'core/scripts/guard.mjs'), '--self-test', ...withConfig()], { encoding: 'utf8' })
    assert.equal(r.status, 1); assert.match(r.stderr, /raw-merge: "gh pr merge 5 --admin" is pass, the example says block/)
})

test('an unloadable guard.json blocks', () => {
    const root = tempDir('guard-copy-')
    spawnSync('git', ['init', '-q', root])
    cpSync(new URL('../core', import.meta.url).pathname, join(root, 'core'), { recursive: true })
    writeFileSync(join(root, 'core', 'guard.json'), '{')
    const r = spawnSync(process.execPath, [join(root, 'core/scripts/guard.mjs'), ...withConfig()], { input: JSON.stringify(bash('ls')), encoding: 'utf8' })
    assert.equal(r.status, 2); assert.match(r.stderr, /guard.json/)
})

test('false positives the review found: text that mentions a path, a GraphQL read, a heredoc body, a quoted argv element', () => {
    for (const cmd of [
        'gh api repos/o/r/issues/5/comments -f body="see rulesets and branches/main/protection"',
        "gh api graphql -f query='query{repository(owner:\"o\",name:\"r\"){rulesets(first:5){nodes{name}}}}'",
        "gh pr comment 5 --body-file - <<'EOF'\ngit push -u origin main\nEOF",
        "git commit -F - <<EOF\nwip\ngit push --force origin main\nEOF",
        'gh api repos/o/r/pulls/5/merge',
    ]) assert.equal(decide(cmd).block, false, cmd)
    assert.equal(decide(['git', 'commit', '-m', 'wip; git push -u origin main']).block, false)
    assert.equal(decide("git commit -m x <<'EOF'\nbody\nEOF\ngit push -u origin main").block, true)   // a command after the heredoc is still checked
    assert.equal(decide('echo "<<EOF"\ngit push -u origin main').block, true)   // a quoted << opens no heredoc
    assert.equal(decide("gh api graphql -f query='mutation { updateRepositoryRuleset(input:{}) { clientMutationId } }'").block, true)
})

test('a default branch with regex characters is matched literally', () => {
    const dotted = config({ default_branch: 'v1.0' })
    assert.equal(hookDecision(bash('git push -u origin v1x0'), dotted, { cwd: '/' }).block, false)
    assert.equal(hookDecision(bash('git push -u origin v1.0'), dotted, { cwd: '/' }).block, true)
})

test('a malformed guard.json form (a missing list) is a GuardError, not a crash', () => {
    const file = join(tempDir('guard-json-'), 'guard.json')
    const g = JSON.parse(readFileSync(new URL('../core/guard.json', import.meta.url), 'utf8'))
    delete g.forms[0].claude_ask
    writeFileSync(file, JSON.stringify(g))
    assert.throws(() => loadGuard(cfg, { file }), GuardError)
})

test('hook input that is not a JSON object, and a broken guard.json, exit 2 (a hook blocks only on 2)', () => {
    for (const input of ['null', '[1]', '7', '"x"']) assert.equal(hook('', withConfig(), input).status, 2, input)
})

test('review round 2: here-strings, comments, quoted branch names, options before graphql', () => {
    assert.equal(decide('cat <<<x\ngit push -u origin main').block, true)
    assert.equal(decide('echo hi # <<EOF\ngit push -u origin main').block, true)
    assert.equal(decide('git push -u origin "main"').block, true)
    assert.equal(decide("git push -u origin ma''in").block, true)
    assert.equal(decide('gh api -H "Accept: x" graphql -f query=\'mutation { mergePullRequest(input:{}) { clientMutationId } }\'').block, true)
    assert.equal(decide('gh api --hostname github.com graphql -f query=\'query { repository { rulesets { totalCount } } }\'').block, false)
    assert.equal(decide('gh api repos/o/r/issues/5/comments -f body="mergePullRequest and enablePullRequestAutoMerge"').block, false)
})
