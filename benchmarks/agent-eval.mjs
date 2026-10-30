#!/usr/bin/env node
/**
 * Maintainer tool, never shipped to installed repos: runs one eval scenario (benchmarks/scenarios/<id>) with a real agent CLI in a fresh
 * temp git repo and appends one JSON row (benchmarks/SCENARIOS.md). It starts a PAID agent session; nothing here runs in CI.
 *
 * Usage: agent-eval.mjs <scenario> --agent claude|codex --arm ticketflow|bare|superpowers|ponytail [--model m] [--effort level] [--source dir] [--ticketflow-sha sha] [--superpowers-sha sha] [--ponytail-sha sha] [--rep n] [--label name] [--out file.jsonl] [--eval-fingerprint sha256] [--allow-danger-full-access]
 *   <scenario> is a directory name or its prefix (L1). The ticketflow arm installs a TicketFlow checkout (--source, default this one; an
 *   older tag's worktree compares revisions) the way `init` does (runtime, gen-stubs, render); the bare arm installs nothing. The scenario's hidden check.mjs runs on the result; the row is printed and appended to --out.
 * Exit: 0 = the hidden check passed, 1 = it failed (the row is still recorded), 2 = usage, unknown scenario or missing CLI, before any run.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync, chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { main } from '../core/lib/cli.mjs'
import { evaluatorFingerprint, resolveScenario, validatePluginSource, validateSourceCheckout } from './lib/integrity.mjs'
import { approveDangerFullAccess, selectProfileMode } from './lib/profile-auth.mjs'
import { runProcess } from './lib/process.mjs'
import { archiveSession, transcriptSessionId } from './lib/transcripts.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCENARIOS = join(ROOT, 'benchmarks/scenarios')
const usage = 'usage: agent-eval <scenario> --agent claude|codex --arm ticketflow|bare|superpowers|ponytail [--model m] [--effort level] [--source dir] [--ticketflow-sha sha] [--superpowers-sha sha] [--ponytail-sha sha] [--rep n] [--out file.jsonl] [--eval-fingerprint sha256] [--allow-danger-full-access]'
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max'])
const TOOLS = 'Read,Edit,Write,Glob,Grep,Bash(node *),Bash(npm *),Bash(git status *),Bash(git diff *),Bash(git log *),Bash(git show *),Bash(git add *),Bash(git commit *)'
const AGENT_TIMEOUT_MS = 30 * 60 * 1000   // shortcut: one fixed 30-minute ceiling so a hung paid session cannot run forever (a timeout is recorded as agent_exit null), add a --timeout option when a scenario needs longer
const BUF = 1 << 28
const TRANSCRIPT_ROOT = resolve(process.env.BENCHMARK_TRANSCRIPTS_DIR ?? join(ROOT, 'benchmarks/results/transcripts'))

const run = (cmd, args, o = {}) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: BUF, ...o })
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=eval', '-c', 'user.email=eval@example.invalid', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: BUF }).trim()
const node = (cwd, ...args) => execFileSync(process.execPath, args, { cwd, stdio: 'pipe', maxBuffer: BUF })
const orNull = (f) => { try { return f() } catch { return null } }
const parse = (s) => orNull(() => JSON.parse(s))
const depNames = (text) => new Set(['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].flatMap((k) => Object.keys(parse(text)?.[k] ?? {})))
const cleanEnv = (env) => Object.fromEntries(Object.entries(env).filter(([key]) => !/(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|TOKEN|SECRET|PASSWORD|PRIVATE_KEY|CREDENTIAL)/i.test(key)))

/** Native Codex plugin runs. Isolated profiles own everything; direct runs own only a unique marketplace/plugin pair. */
function codexProfile(work, arm, src, isolated = true) {
    const home = join(work, 'home')
    const codexHome = isolated ? join(home, '.codex') : resolve(process.env.CODEX_HOME ?? join(homedir(), '.codex'))
    if (isolated) mkdirSync(codexHome, { recursive: true, mode: 0o700 })
    const env = isolated ? { ...cleanEnv(process.env), HOME: home, CODEX_HOME: codexHome }
        : { ...cleanEnv(process.env), CODEX_HOME: codexHome }
    if (!['superpowers', 'ponytail'].includes(arm)) return { env, home, codexHome }

    // A unique namespace prevents touching a pre-existing installation of the same plugin.
    const market = isolated ? 'ticketflow-benchmark' : 'ticketflow-benchmark-' + basename(work).toLowerCase().replace(/[^a-z0-9-]/g, '')
    const root = join(work, 'marketplace'), plugin = join(root, 'plugins', arm)
    mkdirSync(join(root, '.agents', 'plugins'), { recursive: true })
    cpSync(src, plugin, { recursive: true, filter: (p) => !p.split(/[\\/]/).includes('.git') })
    writeFileSync(join(root, '.agents', 'plugins', 'marketplace.json'), JSON.stringify({
        name: market, plugins: [{ name: arm, source: { source: 'local', path: './plugins/' + arm },
            policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Developer Tools' }],
    }))
    const invoke = (args) => {
        const x = run('codex', args, { env, timeout: 60_000 })
        if (x.error || x.status !== 0) throw new Error('Codex native plugin command failed (' + args.slice(0, 3).join(' ') + '): ' +
            String(x.stderr || x.error?.message || 'exit ' + x.status).slice(0, 400))
        const data = parse(x.stdout)
        if (!data) throw new Error('Codex plugin CLI returned invalid JSON for ' + args.slice(0, 3).join(' '))
        return data
    }
    const installedPlugins = () => {
        const entries = invoke(['plugin', 'list', '--json']).installed
        if (!Array.isArray(entries)) throw new Error('Codex plugin list omitted installed entries')
        return entries
    }
    const marketplaces = () => {
        const entries = invoke(['plugin', 'marketplace', 'list', '--json']).marketplaces
        if (!Array.isArray(entries)) throw new Error('Codex marketplace list omitted marketplaces')
        return entries
    }
    const marketplaceBelongsToHarness = (entry) => {
        if (entry?.name !== market) return false
        const location = entry.root ?? entry.path
        return location === undefined || resolve(String(location)) === resolve(root)
    }
    let registeredByHarness = false
    const cleanup = () => {
        if (isolated || !registeredByHarness) return
        // Delete only a marketplace the benchmark actually registered, never the user's own.
        const owned = installedPlugins().filter((p) => p.marketplaceName === market)
        if (owned.length > 1 || owned.some((p) => p.name !== arm))
            throw new Error('Codex benchmark cleanup refused: unexpected entries in ' + market)
        if (owned.length === 1) invoke(['plugin', 'remove', arm + '@' + market, '--json'])
        if (marketplaces().some((m) => m.name === market))
            invoke(['plugin', 'marketplace', 'remove', market, '--json'])
    }
    if (!isolated) {
        if (marketplaces().some((m) => m.name === market) || installedPlugins().some((p) => p.marketplaceName === market))
            throw new Error('Codex benchmark marketplace namespace already exists; refusing to modify it')
    }
    try {
        const addedMarket = invoke(['plugin', 'marketplace', 'add', root, '--json'])
        if (addedMarket.marketplaceName !== market || (!isolated && addedMarket.alreadyAdded))
            throw new Error('Codex benchmark marketplace could not be uniquely registered')
        registeredByHarness = !isolated
        const added = invoke(['plugin', 'add', arm + '@' + market, '--json'])
        if (added.name !== arm || added.marketplaceName !== market)
            throw new Error('Codex native plugin installation could not be verified')
        const installed = installedPlugins(), ours = installed.filter((p) => p.marketplaceName === market)
        if ((isolated && installed.length !== 1) || ours.length !== 1 ||
            ours[0].name !== arm || ours[0].installed !== true || ours[0].enabled !== true)
            throw new Error('Codex native plugin was not correctly installed and enabled; refusing the benchmark')
        return { env, home, codexHome, installed: true, nativePluginEvidence: arm === 'ponytail' ? 'codex-plugin-list-enabled-hook-bypass-requested' : 'codex-plugin-list-enabled', cleanup }
    } catch (e) {
        if (!isolated) {
            // marketplace add can mutate the profile before returning an error or invalid JSON.
            // The namespace was absent above; claim it only if the post-failure listing identifies
            // this benchmark's marketplace, then apply the same scoped cleanup.
            try { registeredByHarness ||= marketplaces().some(marketplaceBelongsToHarness) } catch {}
            try { cleanup() } catch (err) {
                throw new Error(e.message + '; benchmark-only plugin cleanup failed: ' + err.message)
            }
        }
        throw e
    }
}

/** A fresh Claude profile per run. Keep only the selected authentication, not personal settings or plugins. */
function claudeProfile(work) {
    const home = join(work, 'home'), configDir = join(home, '.claude')
    mkdirSync(configDir, { recursive: true, mode: 0o700 })
    const env = Object.fromEntries(Object.entries(cleanEnv(process.env)).filter(([key]) => !/^(?:CLAUDE_|ANTHROPIC_)/i.test(key)))
    Object.assign(env, { HOME: home, CLAUDE_CONFIG_DIR: configDir, XDG_CONFIG_HOME: join(home, '.config') })
    if (process.platform === 'win32') Object.assign(env, {
        USERPROFILE: home, APPDATA: join(home, 'AppData', 'Roaming'), LOCALAPPDATA: join(home, 'AppData', 'Local'),
    })
    for (const key of ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'])
        if (process.env[key]) env[key] = process.env[key]
    return { env, home, configDir }
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
        return { answer: res?.result ?? '', turns: res?.num_turns ?? null, cost_usd: res?.total_cost_usd ?? null, tokens: res?.usage ?? null, model: Object.keys(res?.modelUsage ?? {}).join(',') || null }
    }
    const done = out.split('\n').map(parse).filter((e) => e?.type === 'turn.completed')
    const tokens = done.length ? done.reduce((u, e) => { for (const [k, n] of Object.entries(e.usage ?? {})) u[k] = (u[k] ?? 0) + n; return u }, {}) : null
    return { answer: orNull(() => readFileSync(answerFile, 'utf8')) ?? '', turns: null, cost_usd: null, tokens, model: null }   // Codex JSONL has not supplied a verified effective model
}

main('agent-eval', async () => {
    const { values: v, positionals } = parseArgs({ options: { agent: { type: 'string' }, arm: { type: 'string' }, model: { type: 'string' }, effort: { type: 'string' }, source: { type: 'string' }, 'ticketflow-sha': { type: 'string' }, 'superpowers-sha': { type: 'string' }, 'ponytail-sha': { type: 'string' }, rep: { type: 'string' }, label: { type: 'string' }, out: { type: 'string' }, 'profile-mode': { type: 'string' }, 'eval-fingerprint': { type: 'string' }, 'allow-danger-full-access': { type: 'boolean' } }, allowPositionals: true })
    if (positionals.length !== 1 || !['claude', 'codex'].includes(v.agent) || !['ticketflow', 'bare', 'superpowers', 'ponytail'].includes(v.arm) || (v.effort !== undefined && !EFFORTS.has(v.effort)) || (v.rep !== undefined && (!/^[1-9]\d*$/.test(v.rep) || !Number.isSafeInteger(+v.rep))) || (v.label !== undefined && !/^[a-z][a-z0-9-]{0,30}$/.test(v.label)) || (v['profile-mode'] !== undefined && v['profile-mode'] !== 'unisolated') || (v['eval-fingerprint'] !== undefined && !/^[0-9a-f]{64}$/i.test(v['eval-fingerprint']))) throw new Error(usage)
    const id = resolveScenario(SCENARIOS, positionals[0])
    const external = v.arm === 'superpowers' || v.arm === 'ponytail'
    if (external && !v.source) throw new Error(`--source requires a pinned checkout of ${v.arm}`)
    const src = resolve(v.source ?? ROOT)
    const sourceMeta = v.arm === 'bare' ? null : validateSourceCheckout(src, {
        name: v.arm, expectedSha: v[v.arm + '-sha'] ?? null,
        expectedRemote: v.arm === 'ticketflow' ? 'https://github.com/livingc0de/ticketflow' : null,
    })
    if (external) validatePluginSource(src, v.agent, v.arm)
    const outFile = v.out && resolve(v.out)   // the harness's own result file is not a change to a source checkout it sits in
    if (v.out) try { appendFileSync(v.out, '') } catch (e) { throw new Error(`--out ${v.out} cannot be written (${e.code})`) }   // before the paid run, not after it
    if (v.arm === 'ticketflow' && !existsSync(join(src, 'core/scripts/runtime.mjs'))) throw new Error(`${src} is not a ticketflow checkout`)
    const version = run(v.agent, ['--version'])
    if (version.error || version.status !== 0) throw new Error(`${v.agent} is not installed or not on PATH`)
    if (external && v.agent === 'claude' && !run('claude', ['--help']).stdout?.includes('--plugin-dir')) throw new Error('Claude CLI does not advertise --plugin-dir; cannot load competitor natively')
    if (v.agent === 'codex' && v.arm === 'ponytail') {
        const help = run('codex', ['exec', '--help'])
        if (help.status !== 0 || !(`${help.stdout ?? ''}\n${help.stderr ?? ''}`).includes('--dangerously-bypass-hook-trust'))
            throw new Error('Codex exec lacks --dangerously-bypass-hook-trust; cannot enable Ponytail lifecycle hooks noninteractively')
    }
    const profileMode = selectProfileMode(v.agent, [v.arm], { alreadyApproved: v['profile-mode'] === 'unisolated' })
    if (v['profile-mode'] === 'unisolated' && profileMode !== 'unisolated')
        throw new Error('Requested unisolated mode no longer matches the available authentication; restart the benchmark runner.')
    if (v.agent === 'codex') approveDangerFullAccess({ alreadyApproved: v['allow-danger-full-access'] })

    const sdir = join(SCENARIOS, id), work = mkdtempSync(join(tmpdir(), 'agent-eval-')), evalFingerprint = v['eval-fingerprint'] ?? evaluatorFingerprint(ROOT, outFile ? [outFile] : [])
    const { dir, base } = workspace(sdir, v.agent, v.arm, work, src)
    const claude = v.agent === 'claude'
    const isolated = profileMode === 'isolated'
    const profile = claude ? (isolated ? claudeProfile(work) : { env: { ...process.env } })
        : codexProfile(work, v.arm, src, isolated)
    const answerFile = join(work, 'answer.txt')
    const prompt = readFileSync(join(sdir, 'prompt.md'), 'utf8')
    const args = claude
        ? ['-p', prompt, '--output-format', 'json', '--no-session-persistence', '--setting-sources', 'project,local', '--allowedTools', TOOLS, ...(v.model ? ['--model', v.model] : []), ...(v.effort ? ['--effort', v.effort] : []), ...(external ? ['--plugin-dir', src] : [])]
        : ['exec', '--json', ...(v.arm === 'ponytail' ? ['--dangerously-bypass-hook-trust'] : []), ...(!external && isolated ? ['--ignore-user-config'] : []), '--sandbox', 'danger-full-access', '-C', dir, '-o', answerFile, ...(v.model ? ['-m', v.model] : []), ...(v.effort ? ['--config', `model_reasoning_effort=${v.effort}`] : []), '-']   // codex reads the prompt from stdin; danger-full-access is required on hosts where user namespaces are unavailable
    const t0 = Date.now()
    // Isolated profiles copy only authentication and erase it afterwards. Opted-in unisolated runs
    // deliberately retain the original profile so OS-keyring credentials remain usable.
    const originalAuth = join(resolve(process.env.CODEX_HOME ?? join(homedir(), '.codex')), 'auth.json')
    const originalClaudeAuth = join(resolve(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')), '.credentials.json')
    let r, cleanupFailure = null
    try {
        if (claude) {
            // Explicit API/OAuth environment auth takes precedence; do not copy unrelated saved credentials.
            if (isolated && !profile.env.ANTHROPIC_API_KEY && !profile.env.CLAUDE_CODE_OAUTH_TOKEN && existsSync(originalClaudeAuth)) {
                const dest = join(profile.configDir, '.credentials.json')
                copyFileSync(originalClaudeAuth, dest)
                chmodSync(dest, 0o600)
            }
        } else if (!claude && isolated && existsSync(originalAuth)) {
            const dest = join(profile.codexHome, 'auth.json')
            copyFileSync(originalAuth, dest)
            chmodSync(dest, 0o600)
        }
        r = await runProcess(v.agent, args, { cwd: dir, timeoutMs: AGENT_TIMEOUT_MS, env: profile.env,
            ...(claude ? {} : { input: prompt }) })
    } finally {
        // Never erase a paid result solely because plugin cleanup failed.
        try { profile.cleanup?.() } catch (e) { cleanupFailure = e }
        if (isolated) rmSync(profile.home, { recursive: true, force: true })
    }
    const wall_s = Math.round((Date.now() - t0) / 100) / 10
    const out = r.stdout ?? '', rawStderr = r.stderr ?? ''
    writeFileSync(join(work, 'agent.out'), out + '\nSTDERR:\n' + rawStderr)
    const got = report(v.agent, out, answerFile, v.model ?? null)
    writeFileSync(answerFile, got.answer)

    git(dir, 'add', '-A')   // the repo is a throwaway: staging counts new files and commits the agent made are diffed against the base too
    // npm install output is not the agent's change: the lockfile and node_modules are left out of the diff (new dependencies are counted from package.json)
    const stat = git(dir, 'diff', '--cached', '--numstat', base, '--', '.', ':(exclude)package-lock.json', ':(exclude,glob)**/node_modules/**').split('\n').filter(Boolean).map((l) => l.split('\t'))
    const before = depNames(orNull(() => git(dir, 'show', `${base}:package.json`)) ?? ''), after = depNames(orNull(() => readFileSync(join(dir, 'package.json'), 'utf8')) ?? '')
    const c = run(process.execPath, [join(sdir, 'check.mjs'), dir, answerFile], { timeout: 5 * 60 * 1000 })
    const checkerPass = c.status === 0
    const pass = r.status === 0 && checkerPass   // a failed/timed-out agent is never a successful task
    const tf = (f) => (v.arm === 'ticketflow' ? orNull(f) : null)   // the bare arm has no TicketFlow revision
    const evalSha = orNull(() => git(ROOT, 'rev-parse', 'HEAD'))
    const pluginBootstrap = external ? (() => {
        const evidence = profile.nativePluginEvidence ?? (claude ? 'claude-plugin-dir' : null)
        return { status: r.status === 0 && evidence ? (claude || v.arm === 'ponytail' ? 'loaded' : 'verified') : 'failed',
            evidence: evidence ?? 'native-plugin-loading-failed' }
    })() : null
    const resultRowId = transcriptSessionId('agent-eval', { scenario: id, agent: v.agent, arm: v.arm, repeat: v.rep ?? 0 })
    let transcriptArchive = null, archiveError = null
    try {
        transcriptArchive = archiveSession({ root: TRANSCRIPT_ROOT, sessionId: resultRowId, agentOut: join(work, 'agent.out'), answerFile,
            metadata: { agent: v.agent, model: got.model, requested_model: v.model ?? null, scenario: id, arm: v.arm,
                repeat: v.rep ? +v.rep : null, result_row_id: resultRowId, status: pass ? 'completed' : 'failed',
                checker_pass: checkerPass, agent_exit: r.status, eval_sha: evalSha, eval_fingerprint: evalFingerprint,
                ticketflow_sha: tf(() => git(src, 'rev-parse', 'HEAD')), plugin_sha: external ? git(src, 'rev-parse', 'HEAD') : null,
                plugin_bootstrap: pluginBootstrap, timestamp: new Date().toISOString() } })
    } catch (e) { archiveError = e.message }
    const row = {
        scenario: id, agent: v.agent, agent_version: version.stdout.trim(), model: got.model, requested_model: v.model ?? null, arm: v.arm, variant: v.label ?? v.arm, repeat: v.rep ? +v.rep : null,
        eval_sha: evalSha,   // the revision of this tool and its scenarios
        eval_fingerprint: evalFingerprint,
        evaluation_mode: 'non-adversarial', profile_isolation: profileMode, sandbox_mode: claude ? 'not-applicable' : 'danger-full-access', requested_effort: v.effort ?? null, profile_cleanup: cleanupFailure ? 'failed' : 'ok',
        ticketflow_sha: tf(() => git(src, 'rev-parse', 'HEAD')), ticketflow_dirty: tf(() => git(src, 'status', '--porcelain', '--untracked-files=all').split('\n').some((l) => l && resolve(src, l.slice(3)) !== outFile)),
        ticketflow_version: tf(() => readFileSync(join(src, 'VERSION'), 'utf8').trim()),
        plugin_sha: external ? git(src, 'rev-parse', 'HEAD') : null,
        plugin_native: external ? pluginBootstrap.status : null, plugin_bootstrap: pluginBootstrap,
        source_provenance: sourceMeta,
        result_row_id: resultRowId, transcript_archive: transcriptArchive, archive_error: archiveError,
        check: { pass: pass && !archiveError, why: archiveError ? `transcript archive failed: ${archiveError}` : r.status !== 0 && checkerPass
            ? `agent exited ${r.status ?? r.signal ?? 'unknown'} despite a passing checker`
            : `${c.stdout ?? ''}${c.stderr ?? ''}`.trim().split('\n')[0].slice(0, 300) || `check exited ${c.status}` },
        diff: { added: stat.reduce((n, s) => n + (+s[0] || 0), 0), removed: stat.reduce((n, s) => n + (+s[1] || 0), 0), files: stat.map((s) => s[2]) },
        deps_added: [...after].filter((d) => !before.has(d)).length,
        turns: got.turns, tokens: got.tokens, cost_usd: got.cost_usd, wall_s, agent_exit: r.status,
        descendants: 'unknown',   // shortcut: 'unknown' because no CLI is verified to count child agents in these totals, set `included` only after a live run shows it
        workdir: work, date: new Date().toISOString(),
    }
    console.log(JSON.stringify(row))
    if (v.out) appendFileSync(v.out, `${JSON.stringify(row)}\n`)
    if (cleanupFailure) throw new Error('Benchmark result recorded, but plugin cleanup failed: ' + cleanupFailure.message +
        '. Inspect benchmark-owned Codex plugins/marketplaces before another run; existing user plugins were not targeted.')
    return pass && !archiveError ? 0 : 1
})
