import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync, execFileSync } from 'node:child_process'
import { appendFileSync, chmodSync, cpSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDir } from '../../tests/helpers.mjs'
import { evaluatorFingerprint } from '../lib/integrity.mjs'
import { approvalIsYes } from '../lib/profile-auth.mjs'

const ROOT = new URL('../', import.meta.url).pathname
const REPO = new URL('../../', import.meta.url).pathname
const CLI = join(ROOT, 'run.mjs')
const call = (args, env = {}) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, ...env } })
const git = (dir, ...args) => execFileSync('git', ['-c','user.name=t','-c','user.email=t@example.invalid', ...args], { cwd: dir, encoding: 'utf8' }).trim()
const source = (external = false, agent = 'claude', plugin = 'ponytail') => {
    const dir = tempDir('bench-source-')
    const marker = external ? (agent === 'codex' ? '.codex-plugin/plugin.json' : '.claude-plugin/plugin.json') : 'core/scripts/runtime.mjs'
    mkdirSync(join(dir, marker, '..'), { recursive: true })
    writeFileSync(join(dir, marker), external ? JSON.stringify({ name: plugin }) + '\n' : '// test source\n')
    git(dir, 'init', '-q', '-b', 'main'); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'pinned-' + dir.slice(-6))
    if (external) git(dir, 'remote', 'add', 'origin', `https://github.com/${plugin === 'superpowers' ? 'obra' : 'DietrichGebert'}/${plugin}.git`)
    return dir
}

test('dry-run shows every repeat and arm, requires no agent executable or output file', () => {
    const before = source(), after = source(), out = join(tempDir('bench-out-'), 'rows.jsonl')
    const r = call(['--agent','claude','--model','test-model','--arms','before,after,bare','--scenarios','L1,L2',
        '--repeats','2','--before-source',before,'--after-source',after,'--out',out])
    assert.equal(r.status, 0, r.stderr)
    const info = JSON.parse(r.stdout.split('\nPLAN ')[0])
    assert.equal(info.total, 12)
    assert.equal(info.remaining, 12)
    assert.match(r.stdout, /DRY RUN \(free\)/)
    assert.equal(existsSync(out), false)
    assert.equal(r.stdout.split('\n').filter((x)=>x.startsWith('PLAN ')).length, 12)
})

test('parallel execution keeps separate rows and overlaps one Claude and one Codex session', () => {
    const dir = tempDir('bench-parallel-'), bin = join(dir, 'bin'), claudeAuth = join(dir, 'claude-auth'), codexHome = join(dir, 'codex-home')
    const claudeOut = join(dir, 'claude.jsonl'), codexOut = join(dir, 'codex.jsonl'), log = join(dir, 'timing.log')
    mkdirSync(bin); mkdirSync(claudeAuth); mkdirSync(codexHome)
    writeFileSync(join(claudeAuth, '.credentials.json'), '{"portable":true}\n')
    writeFileSync(join(codexHome, 'auth.json'), '{"auth_mode":"chatgpt","tokens":{"access_token":"test"}}\n')
    const fake = join(bin, 'fake-agent')
    writeFileSync(fake, `#!${process.execPath}
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const name = process.argv[1].split('/').pop(), args = process.argv.slice(2), log = process.env.PARALLEL_LOG
if (args.includes('--version')) { console.log(name === 'claude' ? 'fake-claude 1.0' : 'fake-codex 1.0'); process.exit(0) }
if (name === 'codex' && args[0] === 'login' && args[1] === 'status') { process.exit(existsSync(join(process.env.CODEX_HOME, 'auth.json')) ? 0 : 1) }
const start = Date.now(); appendFileSync(log, name + ':start:' + start + '\\n')
const until = Date.now() + 400; while (Date.now() < until) {}
if (name === 'codex') { const o = args.indexOf('-o'); writeFileSync(args[o + 1], 'src/files.js:7 path traversal') ; console.log(JSON.stringify({ type:'turn.completed', usage:{input_tokens:1, output_tokens:1} })) }
else console.log(JSON.stringify({ type:'result', result:'src/files.js:7 path traversal', num_turns:1, total_cost_usd:0, usage:{input_tokens:1, output_tokens:1}, modelUsage:{'fake-model':{}} }))
appendFileSync(log, name + ':end:' + Date.now() + '\\n')
`)
    chmodSync(fake, 0o755)
    for (const name of ['claude', 'codex']) cpSync(fake, join(bin, name))
    const args = ['--parallel','--claude-model','claude-test','--codex-model','codex-test','--effort','high','--claude-out',claudeOut,'--codex-out',codexOut,
        '--arms','bare','--scenarios','L4','--repeats','1','--max-sessions','2','--execute']
    const env = {
        PATH: `${bin}:${process.env.PATH}`, CLAUDE_CONFIG_DIR: claudeAuth, CODEX_HOME: codexHome,
        ANTHROPIC_API_KEY:'', CLAUDE_CODE_OAUTH_TOKEN:'', OPENAI_API_KEY:'', PARALLEL_LOG:log,
    }
    const denied = call(args, env)
    assert.equal(denied.status, 2, denied.stdout + denied.stderr)
    assert.match(denied.stderr, /requires an interactive approval or --allow-danger-full-access/)
    assert.doesNotMatch(denied.stdout, /SESSION /)
    assert.equal(existsSync(log), false)

    const r = call([...args.slice(0, -1), '--allow-danger-full-access', '--execute'], env)
    assert.equal(r.status, 0, r.stdout + r.stderr)
    const claude = JSON.parse(readFileSync(claudeOut, 'utf8')), codex = JSON.parse(readFileSync(codexOut, 'utf8'))
    assert.equal(claude.agent, 'claude'); assert.equal(claude.sandbox_mode, 'not-applicable'); assert.equal(claude.requested_effort, 'high'); assert.equal(claude.check.pass, true)
    assert.equal(codex.agent, 'codex'); assert.equal(codex.sandbox_mode, 'danger-full-access'); assert.equal(codex.requested_effort, 'high'); assert.equal(codex.check.pass, true)
    const events = readFileSync(log, 'utf8').trim().split('\n').map((line) => line.split(':')).reduce((m, [agent, phase, time]) => m.set(agent + phase, +time), new Map())
    assert.ok(events.get('claudestart') < events.get('codexend') && events.get('codexstart') < events.get('claudeend'), 'agent sessions overlapped')
    assert.match(r.stderr, /danger-full-access/)
})

test('parallel execution preflights both CLIs before any paid child starts', () => {
    const dir = tempDir('bench-preflight-'), bin = join(dir, 'bin'), claudeAuth = join(dir, 'claude-auth'), codexHome = join(dir, 'codex-home')
    const claudeOut = join(dir, 'claude.jsonl'), codexOut = join(dir, 'codex.jsonl'), log = join(dir, 'paid.log')
    mkdirSync(bin); mkdirSync(claudeAuth); mkdirSync(codexHome)
    writeFileSync(join(claudeAuth, '.credentials.json'), '{"portable":true}\n')
    writeFileSync(join(codexHome, 'auth.json'), '{"auth_mode":"chatgpt","tokens":{"access_token":"test"}}\n')
    const claude = join(bin, 'claude'), codex = join(bin, 'codex')
    writeFileSync(claude, '#!/bin/sh\nexit 1\n')
    chmodSync(claude, 0o755)
    writeFileSync(codex, `#!${process.execPath}
import { appendFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
const args = process.argv.slice(2)
if (args.includes('--version')) { console.log('fake-codex 1.0'); process.exit(0) }
if (args[0] === 'login' && args[1] === 'status') process.exit(existsSync(join(process.env.CODEX_HOME, 'auth.json')) ? 0 : 1)
appendFileSync(process.env.PAID_LOG, 'paid\\n')
`)
    chmodSync(codex, 0o755)
    const r = call(['--parallel','--claude-model','claude-test','--codex-model','codex-test','--claude-out',claudeOut,'--codex-out',codexOut,
        '--arms','bare','--scenarios','L4','--repeats','1','--max-sessions','2','--allow-danger-full-access','--execute'], {
        PATH: `${bin}:${process.env.PATH}`, CLAUDE_CONFIG_DIR: claudeAuth, CODEX_HOME: codexHome, PAID_LOG: log,
        ANTHROPIC_API_KEY:'', CLAUDE_CODE_OAUTH_TOKEN:'', OPENAI_API_KEY:'',
    })
    assert.equal(r.status, 2, r.stdout + r.stderr)
    assert.match(r.stderr, /cannot verify current claude CLI version/)
    assert.doesNotMatch(r.stdout, /SESSION /)
    assert.equal(existsSync(log), false)
})

test('paid execution is refused before invoking any agent if the cap is too low', () => {
    const r = call(['--agent','claude','--model','test','--arms','bare','--scenarios','L1,L2',
        '--repeats','2','--out',join(tempDir('bench-out-'), 'rows.jsonl'),'--max-sessions','1','--execute'])
    assert.equal(r.status, 2, r.stderr)
    assert.match(r.stderr, /paid sessions exceeds --max-sessions/)
    assert.doesNotMatch(r.stdout, /SESSION /)
})

test('resume skips only matching fully identified runs', () => {
    const dir = tempDir('bench-out-'), out = join(dir, 'rows.jsonl')
    writeFileSync(out, JSON.stringify({ scenario:'L1-trivial-copy', arm:'bare', variant:'bare', repeat:1, requested_model:'test',
        agent:'claude', ticketflow_sha:null, plugin_sha:null, eval_sha:git(REPO,'rev-parse','HEAD'), eval_fingerprint:evaluatorFingerprint(REPO), check:{pass:false} }) + '\n')
    const args = ['--agent','claude','--model','test','--arms','bare','--scenarios','L1','--repeats','2','--out',out,'--resume']
    const good = call(args)
    assert.equal(good.status, 0, good.stderr)
    const info = JSON.parse(good.stdout.split('\nPLAN ')[0])
    assert.equal(info.remaining, 1)
    assert.equal(info.already_recorded, 1)
    assert.match(good.stdout, /PLAN L1 bare rep=2/)
    assert.equal(readFileSync(out, 'utf8').split('\n').filter(Boolean).length, 1)
})

test('resume reruns a row recorded with a different evaluator fingerprint', () => {
    const dir = tempDir('bench-out-'), out = join(dir, 'rows.jsonl')
    writeFileSync(out, JSON.stringify({ scenario:'L1-trivial-copy', arm:'bare', variant:'bare', repeat:1, requested_model:'test',
        agent:'claude', ticketflow_sha:null, plugin_sha:null, eval_fingerprint:'0'.repeat(64), check:{pass:true} }) + '\n')
    const r = call(['--agent','claude','--model','test','--arms','bare','--scenarios','L1','--repeats','1','--out',out,'--resume'])
    assert.equal(r.status, 0, r.stderr)
    const info = JSON.parse(r.stdout.split('\nPLAN ')[0])
    assert.equal(info.already_recorded, 0)
    assert.equal(info.remaining, 1)
})

test('the selected result file is excluded from the evaluator fingerprint', () => {
    const dir = tempDir('bench-fingerprint-'), out = join(dir, 'benchmarks/custom.jsonl')
    cpSync(join(REPO, 'benchmarks'), join(dir, 'benchmarks'), { recursive: true })
    mkdirSync(join(dir, 'benchmarks'), { recursive: true })
    writeFileSync(out, 'one\n')
    const first = evaluatorFingerprint(dir, [out])
    appendFileSync(out, 'two\n')
    assert.equal(first, evaluatorFingerprint(dir, [out]))
    assert.notEqual(first, evaluatorFingerprint(dir))
})

test('before and after must be different revisions', () => {
    const before=source()
    const r=call(['--agent','claude','--model','test','--arms','before,after','--before-source',before,'--after-source',before])
    assert.equal(r.status,2)
    assert.match(r.stderr,/different pinned revisions/)
})

test('Codex can preview the complete five-arm matrix with native pinned plugin sources', () => {
    const before = source(), after = source(), superpowers = source(true, 'codex', 'superpowers'), ponytail = source(true, 'codex', 'ponytail')
    const r = call(['--agent','codex','--model','gpt-test','--arms','before,after,bare,superpowers,ponytail',
        '--before-source',before,'--after-source',after,'--superpowers-source',superpowers,'--ponytail-source',ponytail,
        '--scenarios','L1,L2','--repeats','1'])
    assert.equal(r.status, 0, r.stderr)
    const info = JSON.parse(r.stdout.split('\nPLAN ')[0])
    assert.equal(info.total, 10)
    assert.equal(r.stdout.split('\n').filter((x) => x.startsWith('PLAN ')).length, 10)
})

test('invalid paths and missing native Codex manifests are rejected without paid work', () => {
    for (const args of [
        ['--agent','claude','--model','m','--arms','before'],
        ['--agent','claude','--model','m','--arms','bare','--scenarios','L99'],
        ['--agent','claude','--model','m','--arms','bare,bare'],
        ['--agent','codex','--model','m','--arms','superpowers','--superpowers-source',source(true,'codex','ponytail')],
    ]) {
        const r = call(args)
        assert.equal(r.status, 2, args.join(' ') + '\n' + r.stderr)
        assert.doesNotMatch(r.stdout, /SESSION /)
        if (args.includes('--superpowers-source')) assert.match(r.stderr, /manifest name must be superpowers/)
    }
})

test('preview resume does not require an agent CLI', () => {
 const out=join(tempDir('bench-out-'),'rows.jsonl')
 writeFileSync(out,JSON.stringify({scenario:'L1-trivial-copy',arm:'bare',variant:'bare',repeat:1,requested_model:'test',agent:'claude',agent_version:'old',eval_fingerprint:evaluatorFingerprint(REPO)})+'\n')
 const r=call(['--agent','claude','--model','test','--arms','bare','--scenarios','L1','--repeats','1','--out',out,'--resume'])
 assert.equal(r.status,0,r.stderr)
 assert.match(r.stdout,/"already_recorded": 1/)
})

test('paid resume verifies the recorded CLI version before starting sessions', () => {
    const cliDir = tempDir('bench-cli-'), cli = join(cliDir, 'claude')
    writeFileSync(cli, '#!/bin/sh\nprintf "%s\\n" "$FAKE_CLI_VERSION"\nexit "${FAKE_CLI_EXIT:-0}"\n')
    chmodSync(cli, 0o755)
    const base = ['--agent','claude','--model','test','--arms','bare','--scenarios','L1','--repeats','1','--resume','--execute']
    const row = (agentVersion) => ({ scenario:'L1-trivial-copy', arm:'bare', variant:'bare', repeat:1, requested_model:'test', agent:'claude',
        agent_version:agentVersion, ticketflow_sha:null, plugin_sha:null, eval_fingerprint:evaluatorFingerprint(REPO) })
    const run = (agentVersion, extra = {}) => {
        const out = join(tempDir('bench-out-'), 'rows.jsonl')
        writeFileSync(out, JSON.stringify(row(agentVersion)) + '\n')
        return call([...base, '--out', out], { PATH:`${cliDir}:${process.env.PATH}`, FAKE_CLI_VERSION:'test-cli 1.0', ...extra })
    }

    const matching = run('test-cli 1.0')
    assert.equal(matching.status, 0, matching.stderr)
    assert.match(matching.stdout, /EXECUTE \(paid\)/)
    assert.doesNotMatch(matching.stdout, /SESSION /)

    for (const version of ['old-cli 0.9', undefined]) {
        const changed = run(version)
        assert.equal(changed.status, 2, changed.stderr)
        assert.match(changed.stderr, /CLI version differs from recorded sessions or is missing/)
        assert.doesNotMatch(changed.stdout, /SESSION /)
    }

    const unavailable = run('test-cli 1.0', { FAKE_CLI_EXIT:'1' })
    assert.equal(unavailable.status, 2, unavailable.stderr)
    assert.match(unavailable.stderr, /cannot verify current claude CLI version/)
    assert.doesNotMatch(unavailable.stdout, /SESSION /)
})

test('unisolated confirmation recognizes explicit yes only', () => {
    for (const value of ['y', 'Y', 'yes', 'YES', ' Yes ']) assert.equal(approvalIsYes(value), true)
    for (const value of ['', 'n', 'no', 'perhaps', 'yes please', 'y\nno']) assert.equal(approvalIsYes(value), false)
})

test('batch fallback asks once in a TTY, then runs every approved session automatically', { skip: process.platform === 'win32' }, () => {
    if (spawnSync('script', ['--version'], { encoding:'utf8' }).status !== 0) return
    const dir = tempDir('benchmark-tty-'), auth = join(dir, 'empty-claude')
    const bin = join(dir, 'bin'), out = join(dir, 'rows.jsonl')
    mkdirSync(auth); mkdirSync(bin)
    const fake = join(bin, 'claude')
    writeFileSync(fake, `#!${process.execPath}
const args = process.argv.slice(2)
if (args.includes('--version')) { console.log('fake-claude 1.0'); process.exit(0) }
if (args[0] === 'auth' && args[1] === 'status') { process.exit(process.env.CLAUDE_CONFIG_DIR === process.env.FAKE_KEYRING_HOME ? 0 : 1) }
console.log(JSON.stringify({ type:'result', subtype:'success', is_error:false, num_turns:1, result:'done', usage:{input_tokens:1, output_tokens:1}, modelUsage:{'fake-model':{}}, total_cost_usd:0 }))
`)
    chmodSync(fake, 0o755)
    const command = [process.execPath, CLI, '--agent', 'claude', '--model', 'fake-model', '--arms', 'bare', '--scenarios', 'L1,L2',
        '--repeats', '1', '--out', out, '--max-sessions', '2', '--execute'].map((x)=> JSON.stringify(x)).join(' ')
    const env = { ...process.env, PATH:bin+':'+process.env.PATH, CLAUDE_CONFIG_DIR:auth, FAKE_KEYRING_HOME:auth, ANTHROPIC_API_KEY:'', CLAUDE_CODE_OAUTH_TOKEN:'' }
    const r = spawnSync('script', ['-qec',command,'/dev/null'], { input:'yes\n', env, encoding:'utf8', timeout:40_000 })
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.equal((r.stdout.match(/Proceed without profile isolation/g) ?? []).length, 1, 'one prompt for the whole matrix')
    assert.match(r.stdout, /SESSION 1\/2/)
    assert.match(r.stdout, /SESSION 2\/2/)
    const rows = readFileSync(out,'utf8').trim().split('\n').map(JSON.parse)
    assert.equal(rows.length, 2)
    assert.ok(rows.every((x)=>x.profile_isolation==='unisolated'))

    const declinedOut = join(dir, 'declined.jsonl')
    const declined = command.replace(out, declinedOut)
    const no = spawnSync('script', ['-qec', declined, '/dev/null'], { input:'n\n', env, encoding:'utf8', timeout:40_000 })
    assert.notEqual(no.status, 0, no.stdout + no.stderr)
    assert.match(no.stdout, /Unisolated benchmark run declined/)
    assert.doesNotMatch(no.stdout, /SESSION 1\/2/)
    assert.ok(!existsSync(declinedOut), 'declining never creates a benchmark row')
})
