#!/usr/bin/env node
/**
 * Maintainer-only comparison matrix. Dry-run by default; --execute intentionally starts PAID agent sessions.
 * No npm dependencies and no GitHub credentials required. See benchmarks/README.md before execution.
 */
import { spawnSync, execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { evaluatorFingerprint, resolveScenario, validatePluginSource, validateSourceCheckout } from './lib/integrity.mjs'
import { approveDangerFullAccess, selectProfileMode } from './lib/profile-auth.mjs'
import { runProcess } from './lib/process.mjs'

const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = resolve(HERE, '..')
const SESSION_TIMEOUT_MS = 35 * 60_000
const usage = 'usage: node benchmarks/run-local.mjs --agent claude|codex --model NAME [--effort low|medium|high|xhigh|max] [--arms before,after,bare,superpowers,ponytail] [--scenarios L1,L2] [--repeats 3] [--before-source DIR] [--after-source DIR] [--superpowers-source DIR] [--ponytail-source DIR] [--out results.jsonl] [--max-sessions N] [--resume] [--execute] [--allow-danger-full-access]\n   or: node benchmarks/run-local.mjs --parallel --claude-model NAME --codex-model NAME --claude-out FILE --codex-out FILE [common options]'
const validArms = new Set(['before', 'after', 'bare', 'superpowers', 'ponytail'])
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max'])
const fail = (m) => { console.error('benchmarks: ' + m); process.exitCode = 2 }
const sha = (p) => { try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: p, encoding: 'utf8' }).trim() } catch { return null } }
const cliVersion = (agent) => {
    const version = spawnSync(agent, ['--version'], { encoding: 'utf8', timeout: 10_000 })
    if (version.error || version.status !== 0 || !version.stdout?.trim()) throw Error('cannot verify current ' + agent + ' CLI version')
    return version.stdout.trim()
}
const requireClaudePluginDir = () => {
    const help = spawnSync('claude', ['--help'], { encoding: 'utf8', timeout: 10_000 })
    const text = `${help.stdout ?? ''}\n${help.stderr ?? ''}`
    if (help.error || help.status !== 0 || !text.includes('--plugin-dir')) throw Error('Claude CLI does not advertise --plugin-dir; cannot load external plugins natively')
}
const requireCodexPonytailHooks = () => {
    const help = spawnSync('codex', ['exec', '--help'], { encoding: 'utf8', timeout: 10_000 })
    const text = `${help.stdout ?? ''}\n${help.stderr ?? ''}`
    if (help.error || help.status !== 0 || !text.includes('--dangerously-bypass-hook-trust'))
        throw Error('Codex exec lacks --dangerously-bypass-hook-trust; cannot enable Ponytail lifecycle hooks noninteractively')
}
const readRows = (out) => readFileSync(out, 'utf8').split(/\r?\n/).filter(Boolean).map((x) => JSON.parse(x))
const identity = (i, agent, model, effort, evalFingerprint) => [i.scenario, i.arm, i.rep, agent, model, effort ?? 'default', i.source_sha ?? 'bare', evalFingerprint].join('|')

function spawnSession(args, label) {
    return runProcess(process.execPath, args, { timeoutMs: SESSION_TIMEOUT_MS,
        onStdout: (data) => process.stdout.write(`[${label}] ${data}`),
        onStderr: (data) => process.stderr.write(`[${label}] ${data}`) })
}

async function runOneParallel(agent, list, argsFor) {
    for (const [i, x] of list.entries()) {
        console.log(`SESSION ${agent} ${i + 1}/${list.length} ${x.scenario} ${x.arm} rep=${x.rep}`)
        const result = await spawnSession(argsFor(agent, x), agent)
        if (![0, 1].includes(result.status)) throw Error('session did not record a result; stopped at ' + agent + '/' + x.scenario + '/' + x.arm + '/rep' + x.rep)
    }
}

async function main() {
    let v
    try {
        ;({ values: v } = parseArgs({ options: {
            agent: { type: 'string' }, model: { type: 'string' }, effort: { type: 'string' }, arms: { type: 'string' }, scenarios: { type: 'string' },
            repeats: { type: 'string' }, 'before-source': { type: 'string' }, 'after-source': { type: 'string' },
            'superpowers-source': { type: 'string' }, 'ponytail-source': { type: 'string' },
            out: { type: 'string' }, 'max-sessions': { type: 'string' }, resume: { type: 'boolean' }, execute: { type: 'boolean' },
            parallel: { type: 'boolean' }, 'allow-danger-full-access': { type: 'boolean' }, 'claude-model': { type: 'string' }, 'codex-model': { type: 'string' },
            'claude-out': { type: 'string' }, 'codex-out': { type: 'string' },
        }, allowPositionals: false }))
        const parallel = v.parallel === true
        if (parallel) {
            if (v.agent || v.model || v.out || !v['claude-model']?.trim() || !v['codex-model']?.trim() || !v['claude-out'] || !v['codex-out']) throw Error(usage)
        } else if (!['claude', 'codex'].includes(v.agent) || !v.model?.trim()) throw Error(usage)
        if (v.effort !== undefined && !EFFORTS.has(v.effort)) throw Error(usage)
        const agents = parallel ? ['claude', 'codex'] : [v.agent]
        const models = Object.fromEntries(agents.map((agent) => [agent, parallel ? v[agent + '-model'] : v.model]))
        const output = Object.fromEntries(agents.map((agent) => [agent, parallel ? resolve(v[agent + '-out']) : (v.out ? resolve(v.out) : null)]))
        if (parallel && output.claude === output.codex) throw Error('--claude-out and --codex-out must be different files')
        const count = (x, d) => x === undefined ? d : /^\d+$/.test(x) && +x > 0 && Number.isSafeInteger(+x) ? +x : NaN
        const repeats = count(v.repeats, 3), maximum = count(v['max-sessions'], 24)
        const allScenarios = readdirSync(join(HERE, 'scenarios')).filter((x) => /^L\d+-/.test(x)).map((x) => x.split('-')[0]).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
        const arms = (v.arms ?? 'before,after').split(','), scenarios = (v.scenarios ?? allScenarios.join(',')).split(',')
        if (!Number.isInteger(repeats) || !Number.isInteger(maximum) || !arms.length ||
            new Set(arms).size !== arms.length || arms.some((x) => !validArms.has(x)) ||
            new Set(scenarios).size !== scenarios.length || scenarios.some((x) => !/^L\d+$/.test(x))) throw Error(usage)
        const available = new Map(), sourceMeta = new Map()
        for (const name of ['before', 'after', 'superpowers', 'ponytail']) {
            const path = v[name + '-source']
            if (path) {
                const dir = resolve(path)
                if (!existsSync(dir) || !sha(dir)) throw Error(name + ': source must be a git checkout')
                available.set(name, dir)
            }
        }
        if (arms.includes('before') && !available.has('before')) throw Error('--before-source requires a clean pinned older TicketFlow checkout')
        if (arms.includes('after') && !available.has('after')) available.set('after', ROOT)
        for (const name of ['superpowers', 'ponytail']) if (arms.includes(name) && !available.has(name)) throw Error(name + ' requires --' + name + '-source')
        if (arms.includes('before') && arms.includes('after') && sha(available.get('before')) === sha(available.get('after'))) throw Error('before and after must be different pinned revisions')
        for (const [name, dir] of available) {
            const arm = name === 'before' || name === 'after' ? 'ticketflow' : name
            sourceMeta.set(name, validateSourceCheckout(dir, { name: arm, expectedSha: sha(dir),
                expectedRemote: arm === 'ticketflow' ? 'https://github.com/livingc0de/ticketflow' : null }))
            for (const agent of agents) {
                const marker = name === 'superpowers' || name === 'ponytail' ? (agent === 'codex' ? '.codex-plugin/plugin.json' : '.claude-plugin/plugin.json') : 'core/scripts/runtime.mjs'
                if (!existsSync(join(dir, marker))) throw Error(name + ' missing ' + marker + ' for ' + agent)
                if (['superpowers', 'ponytail'].includes(name)) validatePluginSource(dir, agent, name)
            }
        }
        for (const id of scenarios) resolveScenario(join(HERE, 'scenarios'), id)

        const outputPaths = agents.map((agent) => output[agent]).filter(Boolean)
        const evalFingerprint = evaluatorFingerprint(ROOT, outputPaths)
        const items = []
        for (let rep = 1; rep <= repeats; rep++) for (const [i, scenario] of scenarios.entries()) {
            const rotated = [...arms.slice((rep + i - 1) % arms.length), ...arms.slice(0, (rep + i - 1) % arms.length)]
            for (const arm of rotated) {
                const path = available.get(arm)
                items.push({ scenario, arm, rep, source: path ?? null, source_sha: path ? sourceMeta.get(arm)?.sha ?? null : null })
            }
        }

        const recorded = new Map(), pending = new Map()
        for (const agent of agents) {
            const out = output[agent]
            let rows = []
            if (v.resume) {
                if (!out || !existsSync(out)) throw Error(parallel ? `--resume requires an existing --${agent}-out JSONL file` : '--resume requires an existing --out JSONL file')
                rows = readRows(out)
            }
            const complete = new Set(rows.filter((r) => r.requested_model === models[agent] && r.agent === agent && (r.requested_effort ?? null) === (v.effort ?? null) && Number.isInteger(r.repeat))
                .map((r) => [r.scenario.split('-')[0], r.variant ?? r.arm, r.repeat, r.agent, r.requested_model, r.requested_effort ?? 'default',
                    r.ticketflow_sha ?? r.plugin_sha ?? 'bare', r.eval_fingerprint ?? 'legacy-evaluator'].join('|')))
            recorded.set(agent, rows)
            pending.set(agent, items.filter((x) => !complete.has(identity(x, agent, models[agent], v.effort, evalFingerprint))))
        }
        const remaining = agents.reduce((n, agent) => n + pending.get(agent).length, 0)
        const info = { mode: v.execute ? 'EXECUTE (paid)' : 'DRY RUN (free)', parallel, total: items.length * agents.length,
            already_recorded: items.length * agents.length - remaining, remaining, agents, models, effort: v.effort ?? null, outputs: output,
            arms, scenarios, repeats, sources: Object.fromEntries([...available].map(([k, d]) => [k, { path: d, sha: sourceMeta.get(k)?.sha ?? null }])) }
        if (!parallel) Object.assign(info, { agent: agents[0], model: models[agents[0]] })
        console.log(JSON.stringify(info, null, 2))

        if (!v.execute) {
            for (const agent of agents) for (const x of pending.get(agent)) console.log(`PLAN ${parallel ? agent + ' ' : ''}${x.scenario} ${x.arm} rep=${x.rep}`)
            return
        }
        if (agents.some((agent) => !output[agent])) throw Error(parallel ? '--execute requires --claude-out and --codex-out to retain every run, including failures' : '--execute requires --out to retain every run, including failures')
        if (remaining > maximum) throw Error(remaining + ' paid sessions exceeds --max-sessions ' + maximum + ': raise it explicitly')

        const cliVersions = new Map()
        if (v.resume) for (const agent of agents) cliVersions.set(agent, cliVersion(agent))
        if (v.execute && v.resume) {
            for (const agent of agents) {
                const version = cliVersions.get(agent)
                const prior = recorded.get(agent).filter((r) => r.agent === agent && r.requested_model === models[agent] && (r.requested_effort ?? null) === (v.effort ?? null))
                if (prior.some((r) => !r.agent_version || r.agent_version !== version)) throw Error('--resume CLI version differs from recorded sessions or is missing: use a fresh output file')
            }
        }
        if (!remaining) return
        for (const agent of agents) if (!cliVersions.has(agent)) cliVersions.set(agent, cliVersion(agent))

        if (agents.includes('claude') && pending.get('claude').length && arms.some((arm) => arm === 'superpowers' || arm === 'ponytail')) requireClaudePluginDir()
        if (agents.includes('codex') && pending.get('codex').length && arms.includes('ponytail')) requireCodexPonytailHooks()
        if (agents.includes('codex') && pending.get('codex').length) approveDangerFullAccess({ alreadyApproved: v['allow-danger-full-access'], count: pending.get('codex').length })
        const profileModes = new Map()
        for (const agent of agents) {
            if (!pending.get(agent).length) continue
            const mode = selectProfileMode(agent, arms, { count: pending.get(agent).length })
            profileModes.set(agent, mode)
            if (v.resume && recorded.get(agent).some((r) => r.agent === agent && r.requested_model === models[agent] && (r.requested_effort ?? null) === (v.effort ?? null) &&
                r.eval_fingerprint === evalFingerprint && r.profile_isolation !== mode))
                throw Error('--resume cannot mix isolated and unisolated sessions (or legacy rows without this metadata); use a separate output file')
        }

        const argsFor = (agent, x) => {
            const arm = x.arm === 'before' || x.arm === 'after' ? 'ticketflow' : x.arm
            const sourceSha = x.source ? [`--${arm}-sha`, x.source_sha] : []
            return [join(HERE, 'agent-eval.mjs'), x.scenario, '--agent', agent, '--arm', arm,
                '--model', models[agent], ...(v.effort ? ['--effort', v.effort] : []), '--rep', String(x.rep), '--label', x.arm, '--out', output[agent],
                '--eval-fingerprint', evalFingerprint, ...(x.source ? ['--source', x.source, ...sourceSha] : []),
                ...(profileModes.get(agent) === 'unisolated' ? ['--profile-mode', 'unisolated'] : []),
                ...(agent === 'codex' ? ['--allow-danger-full-access'] : [])]
        }
        const runOne = async (agent) => {
            const list = pending.get(agent)
            for (const [i, x] of list.entries()) {
                console.log(`SESSION ${i + 1}/${list.length} ${x.scenario} ${x.arm} rep=${x.rep}`)
                const result = await runProcess(process.execPath, argsFor(agent, x), { timeoutMs: SESSION_TIMEOUT_MS,
                    onStdout: (data) => process.stdout.write(data), onStderr: (data) => process.stderr.write(data) })
                if (![0, 1].includes(result.status)) throw Error('session did not record a result; stopped at ' + agent + '/' + x.scenario + '/' + x.arm + '/rep' + x.rep)
            }
        }
        if (!parallel) {
            await runOne(agents[0])
            return
        }
        const results = await Promise.all(agents.map(async (agent) => {
            try { await runOneParallel(agent, pending.get(agent), argsFor) } catch (error) { return { agent, error } }
            return { agent, error: null }
        }))
        const failed = results.find((x) => x.error)
        if (failed) throw failed.error
    } catch (e) { fail(e.message) }
}

await main()
