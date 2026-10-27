import test from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { FORMATS, GuardError, askPatterns, claudeAsk, codexRules, hookDecision, loadGuard, segments, tokenize } from '../core/lib/guard.mjs'
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

// ---- the guard for Cursor, Gemini CLI, Copilot and Antigravity (#31): one decision engine, one input/output adapter per tool

const SHAPES = {
    cursor: (command) => ({ command, cwd: '/', sandbox: false }),
    gemini: (command) => ({ hook_event_name: 'BeforeTool', tool_name: 'run_shell_command', tool_input: { command }, cwd: '/' }),
    copilot: (command) => ({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd: '/' }),
    antigravity: (command) => ({ toolCall: { name: 'run_command', args: { CommandLine: command, Cwd: '/' } }, stepIdx: 1 }),
}
const NON_SHELL = {
    cursor: null,   // beforeShellExecution only ever carries a shell command
    gemini: { tool_name: 'read_file', tool_input: { absolute_path: '/x' }, cwd: '/' },
    copilot: { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { path: '/x' }, cwd: '/' },
    antigravity: { toolCall: { name: 'view_file', args: { AbsolutePath: '/x' } } },
}
const j = (x) => JSON.stringify(x) + '\n'
const R = (command) => decide(command).reason ?? hookDecision(bash(command), cfg, { cwd: '/' }).reason
/** The exact output a format gives for a decision `d` with reason `reason`. */
const EXPECT = {
    cursor: { block: (r) => ({ stdout: j({ permission: 'deny', user_message: r, agent_message: r }), stderr: '', code: 0 }), ask: (r) => ({ stdout: j({ permission: 'ask', user_message: r, agent_message: r }), stderr: '', code: 0 }), pass: { stdout: j({ permission: 'allow' }), stderr: '', code: 0 } },
    gemini: { block: (r) => ({ stdout: '', stderr: `guard: blocked: ${r}\n`, code: 2 }), ask: (r) => ({ stdout: '', stderr: `guard: blocked: ${r} Gemini CLI cannot ask for this: ask the owner to run it\n`, code: 2 }), pass: { stdout: '{}\n', stderr: '', code: 0 } },
    copilot: { block: (r) => ({ stdout: '', stderr: `guard: blocked: ${r}\n`, code: 2 }), ask: (r) => ({ stdout: j({ permissionDecision: 'ask', permissionDecisionReason: r }), stderr: '', code: 0 }), pass: { stdout: '', stderr: '', code: 0 } },
    antigravity: { block: (r) => ({ stdout: j({ decision: 'deny', reason: r }), stderr: '', code: 0 }), ask: (r) => ({ stdout: j({ decision: 'force_ask', reason: r }), stderr: '', code: 0 }), pass: { stdout: j({ decision: 'allow' }), stderr: '', code: 0 } },
}

test('hookDecision: a prompt form is an ask (Codex ignores it and passes); a block anywhere beats an ask; plain commands pass', () => {
    assert.deepEqual(decide('git push origin main'), { block: false, ask: true, reason: 'Nothing is pushed to main directly. Push a branch, open a pull request and merge it with .ticketflow/scripts/merge.mjs <pr>.', form: 'push-default' })
    assert.equal(decide('gh pr merge 5').ask, true)
    assert.equal(decide('gh pr merge 5 && git push -u origin main').block, true)   // the ask is recorded, the later block wins
    assert.equal(decide('git push -u origin main && gh pr merge 5').block, true)
    assert.deepEqual(decide('git status'), { block: false })
    assert.equal(decide('git push -u origin main').ask, undefined)
})

for (const format of Object.keys(SHAPES)) {
    test(`${format}: every guard.json example gives the declared decision and the exact output`, () => {
        const f = FORMATS[format]
        for (const e of examples) {
            const d = hookDecision(f.input(SHAPES[format](e.cmd)), cfg, { cwd: '/' })
            const want = e.codex === 'block' ? 'block' : e.codex === 'prompt' ? 'ask' : 'pass'
            assert.equal(d.block ? 'block' : d.ask ? 'ask' : 'pass', want, `${e.form}: ${e.cmd}`)
            assert.deepEqual(f.output(d), want === 'pass' ? EXPECT[format].pass : EXPECT[format][want](d.reason), `${e.form}: ${e.cmd}`)
        }
    })

    test(`${format}: a non-shell tool passes; malformed input and a shell call without a command are denied`, () => {
        const f = FORMATS[format]
        if (NON_SHELL[format]) assert.deepEqual(f.output(hookDecision(f.input(NON_SHELL[format]), cfg, { cwd: '/' })), EXPECT[format].pass)
        const noCommand = { cursor: {}, gemini: { tool_name: 'run_shell_command', tool_input: {} }, copilot: { tool_name: 'Bash', tool_input: {} }, antigravity: { toolCall: { name: 'run_command', args: {} } } }[format]
        const d = hookDecision(f.input(noCommand), cfg, { cwd: '/' })
        assert.equal(d.block, true)
        assert.deepEqual(f.output(d), EXPECT[format].block(d.reason))
    })
}

test('copilot: a payload that carries a command is checked whatever the tool is called (VS Code and the CLI name it differently)', () => {
    const f = FORMATS.copilot
    for (const raw of [
        { toolName: 'bash', toolArgs: JSON.stringify({ command: 'git push -u origin main' }), cwd: '/' },
        { tool_name: 'run_in_terminal', tool_input: { command: 'git push -u origin main' }, cwd: '/' },
        { tool_name: 'Bash', tool_input: JSON.stringify({ command: 'git push -u origin main' }), cwd: '/' },
    ]) assert.equal(hookDecision(f.input(raw), cfg, { cwd: '/' }).block, true, JSON.stringify(raw))
    assert.equal(hookDecision(f.input({ tool_name: 'Bash', tool_input: 'not json' }), cfg, { cwd: '/' }).block, true)   // a shell tool whose command cannot be read
})

test('gemini: the prompt forms are denied with "ask the owner to run it"', () => {
    for (const cmd of ['gh pr merge 5', 'git push origin main', 'node .ticketflow/scripts/protect.mjs --apply']) {
        const o = FORMATS.gemini.output(hookDecision(FORMATS.gemini.input(SHAPES.gemini(cmd)), cfg, { cwd: '/' }))
        assert.equal(o.code, 2, cmd); assert.match(o.stderr, /ask the owner to run it\n$/, cmd)
    }
})

test('codex format: the exact output the hook always gave', () => {
    assert.deepEqual(FORMATS.codex.output(decide('git push -u origin main')), { stdout: '', stderr: `guard: blocked: ${R('git push -u origin main')}\n`, code: 2 })
    assert.deepEqual(FORMATS.codex.output(decide('git status')), { stdout: '', stderr: '', code: 0 })
    assert.deepEqual(FORMATS.codex.output(decide('git push origin main')), { stdout: '', stderr: '', code: 0 })   // a prompt form passes: the Codex rule asks
    assert.deepEqual(FORMATS.codex.input({ tool_name: 'Bash', tool_input: { command: 'ls' } }), { tool_name: 'Bash', tool_input: { command: 'ls' } })
})

test('OpenCode ask patterns: every Claude ask example matches one, every pass example none; claudeAsk is the same list', () => {
    const patterns = askPatterns(cfg)
    assert.deepEqual(claudeAsk(cfg), patterns.map((p) => `Bash(${p})`))
    const re = patterns.map((p) => new RegExp(`^${p.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\/]/g, '\\$&')).join('.*')}$`))
    for (const e of examples) assert.equal(re.some((r) => r.test(e.cmd)), e.claude === 'ask', `${e.form}: ${e.cmd}`)
})

const run = (format, input, args = []) => spawnSync(process.execPath, [script, '--format', format, ...args], { input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8', cwd: tempDir('guard-cwd-') })

test('guard.mjs --format: cursor asks for a merge, denies a forbidden push, allows the rest; the exact stdout and exit code', () => {
    const cfgArgs = withConfig()
    let r = run('cursor', { command: 'gh pr merge 5', cwd: '/' }, cfgArgs)
    assert.equal(r.status, 0, r.stderr); assert.equal(JSON.parse(r.stdout).permission, 'ask'); assert.match(JSON.parse(r.stdout).agent_message, /merge\.mjs/)
    r = run('cursor', { command: 'git push -u origin main', cwd: '/' }, cfgArgs)
    assert.equal(r.status, 0); assert.equal(JSON.parse(r.stdout).permission, 'deny')
    r = run('cursor', { command: 'git status', cwd: '/' }, cfgArgs)
    assert.equal(r.stdout, '{"permission":"allow"}\n'); assert.equal(r.status, 0)
    r = run('gemini', SHAPES.gemini('git push -u origin main'), cfgArgs)
    assert.equal(r.status, 2); assert.equal(r.stdout, ''); assert.match(r.stderr, /Nothing is pushed to main directly/)
    r = run('gemini', SHAPES.gemini('ls'), cfgArgs)
    assert.equal(r.status, 0); assert.equal(r.stdout, '{}\n')
    r = run('copilot', SHAPES.copilot('gh pr merge 5'), cfgArgs)
    assert.equal(r.status, 0); assert.equal(JSON.parse(r.stdout).permissionDecision, 'ask')
    r = run('antigravity', SHAPES.antigravity('gh pr merge 5'), cfgArgs)
    assert.equal(r.status, 0); assert.equal(JSON.parse(r.stdout).decision, 'force_ask')
    r = run('antigravity', SHAPES.antigravity('ls'), cfgArgs)
    assert.equal(r.stdout, '{"decision":"allow"}\n')
})

test('guard.mjs --format: an unknown format exits 2; the default is the Codex hook, byte for byte', () => {
    const cfgArgs = withConfig()
    const r = run('windsurf', SHAPES.cursor('ls'), cfgArgs)
    assert.equal(r.status, 2); assert.match(r.stderr, /unknown format windsurf/)
    const d = hook('git push -u origin main', cfgArgs), explicit = run('codex', bash('git push -u origin main'), cfgArgs)
    assert.equal(d.status, 2); assert.equal(d.stdout, ''); assert.equal(d.stderr, explicit.stderr); assert.match(d.stderr, /^guard: blocked: Nothing is pushed to main directly\. .*merge\.mjs <pr>\.\n$/)
})

test('guard.mjs --format fails closed in every format: malformed input, a non-object, a missing command and an unloadable guard.json all exit 2 with the format\'s deny', () => {
    const cfgArgs = withConfig()
    for (const format of Object.keys(SHAPES)) {
        for (const input of ['not json', '', 'null', '[1]']) {
            const r = run(format, input, cfgArgs)
            assert.equal(r.status, format === 'antigravity' ? 0 : 2, `${format} ${JSON.stringify(input)}`)
            assert.match(format === 'cursor' || format === 'antigravity' ? r.stdout : r.stderr, /not a JSON object/, format)
            if (format === 'cursor') assert.equal(JSON.parse(r.stdout).permission, 'deny')
            if (format === 'antigravity') assert.equal(JSON.parse(r.stdout).decision, 'deny')
        }
    }
    const root = tempDir('guard-copy-')
    spawnSync('git', ['init', '-q', root])
    cpSync(new URL('../core', import.meta.url).pathname, join(root, 'core'), { recursive: true })
    writeFileSync(join(root, 'core', 'guard.json'), '{')
    for (const format of Object.keys(SHAPES)) {
        const r = spawnSync(process.execPath, [join(root, 'core/scripts/guard.mjs'), '--format', format, ...cfgArgs], { input: JSON.stringify(SHAPES[format]('ls')), encoding: 'utf8' })
        assert.equal(r.status, format === 'antigravity' ? 0 : 2, format); assert.match(r.stdout + r.stderr, /guard\.json/, format)
        if (format === 'antigravity') assert.equal(JSON.parse(r.stdout).decision, 'deny')
        if (format === 'cursor') assert.equal(JSON.parse(r.stdout).permission, 'deny')
    }
})

test('a payload without a tool name is a shell call in every format (their matchers only send shell calls): checked, and denied without a command', () => {
    for (const format of Object.keys(SHAPES)) {
        const f = FORMATS[format]
        for (const raw of [{}, { tool_call: { name: 'run_command', args: { CommandLine: 'ls' } } }, { tool_input: {} }]) {
            const d = hookDecision(f.input(raw), cfg, { cwd: '/' })
            assert.equal(d.block, true, `${format} ${JSON.stringify(raw)}`)
            assert.deepEqual(f.output(d), EXPECT[format].block(d.reason), format)
        }
    }
    // a name that is present and is not a shell tool still passes
    assert.equal(hookDecision(FORMATS.gemini.input({ tool_name: 'read_file' }), cfg).block, false)
    assert.equal(hookDecision(FORMATS.antigravity.input({ toolCall: { name: 'view_file' } }), cfg).block, false)
    assert.equal(hookDecision(FORMATS.copilot.input({ tool_name: 'Read' }), cfg).block, false)
})

test('antigravity: an error answers with the documented deny JSON and exit 0 (its exit-2 behaviour is undocumented); the other formats exit 2', () => {
    const cfgArgs = withConfig()
    const r = run('antigravity', 'not json', cfgArgs)
    assert.equal(r.status, 0); assert.equal(JSON.parse(r.stdout).decision, 'deny')
    for (const format of ['cursor', 'gemini', 'copilot', 'codex']) assert.equal(run(format, 'not json', cfgArgs).status, 2, format)
})
