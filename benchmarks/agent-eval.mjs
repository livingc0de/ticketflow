#!/usr/bin/env node
/**
 * Maintainer tool, never shipped to installed repos: runs one eval scenario (benchmarks/scenarios/<id>) with a real agent CLI in a fresh
 * temp git repo and appends one JSON row (benchmarks/SCENARIOS.md). It starts a PAID agent session; nothing here runs in CI.
 *
 * Usage: agent-eval.mjs <scenario> --agent claude|codex --arm ticketflow|bare|superpowers|ponytail [--model m] [--source dir] [--rep n] [--label name] [--out file.jsonl]
 *   <scenario> is a directory name or its prefix (L1). The ticketflow arm installs a TicketFlow checkout (--source, default this one; an
 *   older tag's worktree compares revisions) the way `init` does (runtime, gen-stubs, render); the bare arm installs nothing. The scenario's hidden check.mjs runs on the result; the row is printed and appended to --out.
 * Exit: 0 = the hidden check passed, 1 = it failed (the row is still recorded), 2 = usage, unknown scenario or missing CLI, before any run.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync, chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { main } from '../core/lib/cli.mjs'
import { evaluatorFingerprint, resolveScenario, validatePluginSource } from './lib/integrity.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCENARIOS = join(ROOT, 'benchmarks/scenarios')
const usage = 'usage: agent-eval <scenario> --agent claude|codex --arm ticketflow|bare|superpowers|ponytail [--model m] [--source dir] [--rep n] [--out file.jsonl]'
const TOOLS = 'Read,Edit,Write,Glob,Grep,Bash(node *),Bash(npm *),Bash(git status *),Bash(git diff *),Bash(git log *),Bash(git show *),Bash(git add *),Bash(git commit *)'
const AGENT_TIMEOUT_MS = 30 * 60 * 1000   // shortcut: one fixed 30-minute ceiling so a hung paid session cannot run forever (a timeout is recorded as agent_exit null), add a --timeout option when a scenario needs longer
const BUF = 1 << 28

const run = (cmd, args, o = {}) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: BUF, ...o })
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=eval', '-c', 'user.email=eval@example.invalid', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: BUF }).trim()
const node = (cwd, ...args) => execFileSync(process.execPath, args, { cwd, stdio: 'pipe', maxBuffer: BUF })
const orNull = (f) => { try { return f() } catch { return null } }
const parse = (s) => orNull(() => JSON.parse(s))
const depNames = (text) => new Set(['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].flatMap((k) => Object.keys(parse(text)?.[k] ?? {})))
const cleanEnv = (env) => Object.fromEntries(Object.entries(env).filter(([key]) => !/(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|TOKEN|SECRET|PASSWORD|PRIVATE_KEY|CREDENTIAL)/i.test(key)))

/** A fresh Codex profile per run. Local native plugin packages are installed by Codex itself, not simulated as copied instructions. */
function codexProfile(work, arm, src) {
    const home = join(work, 'home'), codexHome = join(home, '.codex')
    mkdirSync(codexHome, { recursive: true, mode: 0o700 })
    const env = { ...cleanEnv(process.env), HOME: home, CODEX_HOME: codexHome }
    if (!['superpowers', 'ponytail'].includes(arm)) return { env, codexHome, installed: false }

    const market = 'ticketflow-benchmark', root = join(work, 'marketplace'), plugin = join(root, 'plugins', arm)
    mkdirSync(join(root, '.agents', 'plugins'), { recursive: true })
    cpSync(src, plugin, { recursive: true, filter: (p) => !p.split(/[\\/]/).includes('.git') })
    writeFileSync(join(root, '.agents', 'plugins', 'marketplace.json'), JSON.stringify({
        name: market, plugins: [{ name: arm, source: { source: 'local', path: './plugins/' + arm },
            policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Developer Tools' }],
    }))
    const invoke = (args) => {
        const x = run('codex', args, { env, timeout: 60_000 })
        if (x.error || x.status !== 0) throw new Error('Codex native plugin setup failed (' + args.slice(0, 3).join(' ') + '): ' +
            String(x.stderr || x.error?.message || 'exit ' + x.status).slice(0, 400))
        const data = parse(x.stdout)
        if (!data) throw new Error('Codex plugin CLI returned invalid JSON for ' + args.slice(0, 3).join(' '))
        return data
    }
    const marketResult = invoke(['plugin', 'marketplace', 'add', root, '--json'])
    if (marketResult.marketplaceName !== market) throw new Error('Codex marketplace registration could not be verified')
    const added = invoke(['plugin', 'add', arm + '@' + market, '--json'])
    if (added.name !== arm || added.marketplaceName !== market) throw new Error('Codex native plugin installation could not be verified')
    const list = invoke(['plugin', 'list', '--json'])
    const installed = list.installed ?? []
    if (!Array.isArray(installed) || installed.length !== 1 ||
        !installed.some((p) => p.name === arm && p.marketplaceName === market && p.installed === true && p.enabled === true))
        throw new Error('Codex native plugin was not exclusively installed and enabled; refusing the benchmark')
    return { env, codexHome, installed: true }
}

/** The repo the agent works in: the scenario's repo/, plus (ticketflow arm) the install init does, all in one base commit. */
function workspace(sdir, agent, arm, work, src) {
    const dir = join(work, 'repo')
    cpSync(join(sdir, 'repo'), dir, { recursive: true })
    git(dir, 'init', '-q', '-b', 'main')
    if (arm === 'ticketflow') {
        mkdirSync(join(dir, '.ticketflow'))
        const none = { strong: null, standard: null, light: null }
        writeFileSync(join(dir, '.ticketflow/config.json'), JSON.stringify({ schema_version: 2, repo: 'eval/fixture', default_branch: 'main', verify: { mode: 'local-first', command: 'npm test' }, agents: [agent], models: { [agent]: none } }))
        node(dir, join(src, 'core/scripts/runtime.mjs'), src, '.')
        node(dir, '.ticketflow/scripts/gen-stubs.mjs', '.ticketflow', '.')
        node(dir, '.ticketflow/scripts/render.mjs', '.ticketflow/templates', '.')
    }
    git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'base')
    return { dir, base: git(dir, 'rev-parse', 'HEAD') }
}

/** What the CLI reported: the final answer, turns, cost, token usage and model, from its JSON; null where it does not say. */
function report(agent, out, answerFile, model) {
    if (agent === 'claude') {
        const res = [].concat(parse(out) ?? []).findLast((e) => e?.type === 'result')   // the result object, or the last of an event array
        return { answer: res?.result ?? '', turns: res?.num_turns ?? null, cost_usd: res?.total_cost_usd ?? null, tokens: res?.usage ?? null, model: Object.keys(res?.modelUsage ?? {}).join(',') || model }
    }
    const done = out.split('\n').map(parse).filter((e) => e?.type === 'turn.completed')
    const tokens = done.length ? done.reduce((u, e) => { for (const [k, n] of Object.entries(e.usage ?? {})) u[k] = (u[k] ?? 0) + n; return u }, {}) : null
    return { answer: orNull(() => readFileSync(answerFile, 'utf8')) ?? '', turns: null, cost_usd: null, tokens, model }
}

main('agent-eval', () => {
    const { values: v, positionals } = parseArgs({ options: { agent: { type: 'string' }, arm: { type: 'string' }, model: { type: 'string' }, source: { type: 'string' }, rep: { type: 'string' }, label: { type: 'string' }, out: { type: 'string' } }, allowPositionals: true })
    if (positionals.length !== 1 || !['claude', 'codex'].includes(v.agent) || !['ticketflow', 'bare', 'superpowers', 'ponytail'].includes(v.arm) || (v.rep !== undefined && (!/^[1-9]\d*$/.test(v.rep) || !Number.isSafeInteger(+v.rep))) || (v.label !== undefined && !/^[a-z][a-z0-9-]{0,30}$/.test(v.label))) throw new Error(usage)
    const id = resolveScenario(SCENARIOS, positionals[0])
    const external = v.arm === 'superpowers' || v.arm === 'ponytail'
    if (external && !v.source) throw new Error(`--source requires a pinned checkout of ${v.arm}`)
    const src = resolve(v.source ?? ROOT)
    if (external && (!orNull(() => git(src, 'rev-parse', 'HEAD')) || git(src, 'status', '--porcelain'))) throw new Error(`${src} must be a clean pinned plugin checkout`)
    if (external) validatePluginSource(src, v.agent, v.arm)
    const outFile = v.out && resolve(v.out)   // the harness's own result file is not a change to a source checkout it sits in
    if (v.out) try { appendFileSync(v.out, '') } catch (e) { throw new Error(`--out ${v.out} cannot be written (${e.code})`) }   // before the paid run, not after it
    if (v.arm === 'ticketflow' && !existsSync(join(src, 'core/scripts/runtime.mjs'))) throw new Error(`${src} is not a ticketflow checkout`)
    const version = run(v.agent, ['--version'])
    if (version.error || version.status !== 0) throw new Error(`${v.agent} is not installed or not on PATH`)
    if (external && v.agent === 'claude' && !run('claude', ['--help']).stdout?.includes('--plugin-dir')) throw new Error('Claude CLI does not advertise --plugin-dir; cannot load competitor natively')

    const sdir = join(SCENARIOS, id), work = mkdtempSync(join(tmpdir(), 'agent-eval-')), evalFingerprint = evaluatorFingerprint(ROOT, outFile ? [outFile] : [])
    const { dir, base } = workspace(sdir, v.agent, v.arm, work, src)
    const profile = v.agent === 'codex' ? codexProfile(work, v.arm, src) : null
    const answerFile = join(work, 'answer.txt')
    const prompt = readFileSync(join(sdir, 'prompt.md'), 'utf8'), claude = v.agent === 'claude'
    const args = claude
        ? ['-p', prompt, '--output-format', 'json', '--no-session-persistence', '--setting-sources', 'project,local', '--allowedTools', TOOLS, ...(v.model ? ['--model', v.model] : []), ...(external ? ['--plugin-dir', src] : [])]
        : ['exec', '--json', ...(!external ? ['--ignore-user-config'] : []), '--sandbox', 'workspace-write', '-C', dir, '-o', answerFile, ...(v.model ? ['-m', v.model] : []), '-']   // codex reads the prompt from stdin
    const t0 = Date.now()
    // Authentication is the only state carried into the empty Codex profile, then erased immediately after the session.
    // Never put auth inside the task repository or leave it in the retained benchmark artifacts.
    const privateAuth = profile && join(profile.codexHome, 'auth.json')
    const originalAuth = join(resolve(process.env.CODEX_HOME ?? join(homedir(), '.codex')), 'auth.json')
    let r
    try {
        if (profile && existsSync(originalAuth)) {
            copyFileSync(originalAuth, privateAuth)
            chmodSync(privateAuth, 0o600)
        }
        r = run(v.agent, args, { cwd: dir, timeout: AGENT_TIMEOUT_MS,
            ...(profile ? { env: profile.env } : {}),
            ...(claude ? { stdio: ['ignore', 'pipe', 'pipe'] } : { input: prompt }) })
    } finally {
        // Codex may create more than auth.json (for example credentials, token caches or logs); the whole
        // temporary profile is disposable and must not remain in the retained workdir.
        if (profile) rmSync(profile.codexHome, { recursive: true, force: true })
    }
    const wall_s = Math.round((Date.now() - t0) / 100) / 10
    const out = r.stdout ?? ''
    writeFileSync(join(work, 'agent.out'), out)
    const got = report(v.agent, out, answerFile, v.model ?? null)
    writeFileSync(answerFile, got.answer)

    git(dir, 'add', '-A')   // the repo is a throwaway: staging counts new files and commits the agent made are diffed against the base too
    // npm install output is not the agent's change: the lockfile and node_modules are left out of the diff (new dependencies are counted from package.json)
    const stat = git(dir, 'diff', '--cached', '--numstat', base, '--', '.', ':(exclude)package-lock.json', ':(exclude,glob)**/node_modules/**').split('\n').filter(Boolean).map((l) => l.split('\t'))
    const before = depNames(orNull(() => git(dir, 'show', `${base}:package.json`)) ?? ''), after = depNames(orNull(() => readFileSync(join(dir, 'package.json'), 'utf8')) ?? '')
    const c = run(process.execPath, [join(sdir, 'check.mjs'), dir, answerFile], { timeout: 5 * 60 * 1000 })
    const pass = c.status === 0
    const tf = (f) => (v.arm === 'ticketflow' ? orNull(f) : null)   // the bare arm has no TicketFlow revision
    const row = {
        scenario: id, agent: v.agent, agent_version: version.stdout.trim(), model: got.model, requested_model: v.model ?? null, arm: v.arm, variant: v.label ?? v.arm, repeat: v.rep ? +v.rep : null,
        eval_sha: orNull(() => git(ROOT, 'rev-parse', 'HEAD')),   // the revision of this tool and its scenarios
        eval_fingerprint: evalFingerprint,
        evaluation_mode: 'non-adversarial',
        ticketflow_sha: tf(() => git(src, 'rev-parse', 'HEAD')), ticketflow_dirty: tf(() => git(src, 'status', '--porcelain', '--untracked-files=all').split('\n').some((l) => l && resolve(src, l.slice(3)) !== outFile)),
        ticketflow_version: tf(() => readFileSync(join(src, 'VERSION'), 'utf8').trim()),
        plugin_sha: external ? git(src, 'rev-parse', 'HEAD') : null,
        plugin_native: external ? (claude ? 'claude --plugin-dir (bootstrap not independently verified)' : 'codex local marketplace: installed and enabled (bootstrap not independently verified)') : null,
        check: { pass, why: `${c.stdout ?? ''}${c.stderr ?? ''}`.trim().split('\n')[0].slice(0, 300) || `check exited ${c.status}` },
        diff: { added: stat.reduce((n, s) => n + (+s[0] || 0), 0), removed: stat.reduce((n, s) => n + (+s[1] || 0), 0), files: stat.map((s) => s[2]) },
        deps_added: [...after].filter((d) => !before.has(d)).length,
        turns: got.turns, tokens: got.tokens, cost_usd: got.cost_usd, wall_s, agent_exit: r.status,
        descendants: 'unknown',   // shortcut: 'unknown' because no CLI is verified to count child agents in these totals, set `included` only after a live run shows it
        workdir: work, date: new Date().toISOString(),
    }
    console.log(JSON.stringify(row))
    if (v.out) appendFileSync(v.out, `${JSON.stringify(row)}\n`)
    return pass ? 0 : 1
})
