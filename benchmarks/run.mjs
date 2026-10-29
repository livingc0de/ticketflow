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

const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = resolve(HERE, '..')
const usage = 'usage: node benchmarks/run.mjs --agent claude|codex --model NAME [--arms before,after,bare,superpowers,ponytail] [--scenarios L1,L2] [--repeats 3] [--before-source DIR] [--after-source DIR] [--superpowers-source DIR] [--ponytail-source DIR] [--out results.jsonl] [--max-sessions N] [--resume] [--execute]'
const validArms = new Set(['before', 'after', 'bare', 'superpowers', 'ponytail'])
const fail = (m) => { console.error('benchmarks: ' + m); process.exitCode = 2 }
const sha = (p) => { try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: p, encoding: 'utf8' }).trim() } catch { return null } }
let v
try {
    ;({ values: v } = parseArgs({ options: {
        agent: { type: 'string' }, model: { type: 'string' }, arms: { type: 'string' }, scenarios: { type: 'string' },
        repeats: { type: 'string' }, 'before-source': { type: 'string' }, 'after-source': { type: 'string' },
        'superpowers-source': { type: 'string' }, 'ponytail-source': { type: 'string' },
        out: { type: 'string' }, 'max-sessions': { type: 'string' }, resume: { type: 'boolean' }, execute: { type: 'boolean' }
    }, allowPositionals: false }))
    if (!['claude', 'codex'].includes(v.agent) || !v.model?.trim()) throw Error(usage)
    const count = (x, d) => x === undefined ? d : /^\d+$/.test(x) && +x > 0 && Number.isSafeInteger(+x) ? +x : NaN
    const repeats = count(v.repeats, 3), maximum = count(v['max-sessions'], 24)
    const allScenarios = readdirSync(join(HERE, 'scenarios')).filter((x) => /^L\d+-/.test(x)).map((x) => x.split('-')[0]).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
    const arms = (v.arms ?? 'before,after').split(','), scenarios = (v.scenarios ?? allScenarios.join(',')).split(',')
    if (!Number.isInteger(repeats) || !Number.isInteger(maximum) || !arms.length ||
        new Set(arms).size !== arms.length || arms.some((x) => !validArms.has(x)) ||
        new Set(scenarios).size !== scenarios.length || scenarios.some((x) => !/^L\d+$/.test(x))) throw Error(usage)
    const available = new Map()
    for (const name of ['before','after','superpowers','ponytail']) {
        const path = v[name + '-source']
        if (path) {
            const dir = resolve(path)
            if (!existsSync(dir) || !sha(dir)) throw Error(name + ': source must be a git checkout')
            available.set(name, dir)
        }
    }
    if (arms.includes('before') && !available.has('before')) throw Error('--before-source requires a clean pinned older TicketFlow checkout')
    if (arms.includes('after') && !available.has('after')) available.set('after', ROOT)
    for (const name of ['superpowers','ponytail']) if (arms.includes(name) && !available.has(name)) throw Error(name + ' requires --' + name + '-source')
    if (v.agent === 'codex' && arms.some((x) => ['superpowers','ponytail'].includes(x)))
        throw Error('external native plugin comparisons are currently supported only for Claude; Codex would not load plugins under --ignore-user-config')
    for (const [name, dir] of available) {
        if (execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' }).trim()) throw Error(name + ' source is dirty')
        const marker = name === 'superpowers' || name === 'ponytail' ? '.claude-plugin/plugin.json' : 'core/scripts/runtime.mjs'
        if (!existsSync(join(dir, marker))) throw Error(name + ' missing ' + marker)
    }
    const known = new Map()
    for (const id of scenarios) {
        const dirs = readdirSync(join(HERE, 'scenarios')).filter((x) => x === id || x.startsWith(id + '-'))
        if (dirs.length !== 1) throw Error('unknown or ambiguous scenario ' + id)
        known.set(id, dirs[0])
    }
    const items = []
    for (let rep = 1; rep <= repeats; rep++) for (const [i, scenario] of scenarios.entries()) {
        const rotated = [...arms.slice((rep + i - 1) % arms.length), ...arms.slice(0, (rep + i - 1) % arms.length)]
        for (const arm of rotated) {
            const path = available.get(arm)
            items.push({ scenario, arm, rep, source: path ?? null, source_sha: path ? sha(path) : null })
        }
    }
    const out = v.out ? resolve(v.out) : null
    let completed = new Set()
    const identity = (i) => [i.scenario, i.arm, i.rep, v.agent, v.model, i.source_sha ?? 'bare'].join('|')
    if (v.resume) {
        if (!out || !existsSync(out)) throw Error('--resume requires an existing --out JSONL file')
        const rows = readFileSync(out, 'utf8').split(/\r?\n/).filter(Boolean).map((x) => JSON.parse(x))
        completed = new Set(rows.filter((r) => r.requested_model === v.model && r.agent === v.agent && Number.isInteger(r.repeat))
            .map((r) => [r.scenario.split('-')[0], r.variant ?? r.arm, r.repeat, r.agent, r.requested_model,
                r.ticketflow_sha ?? r.plugin_sha ?? 'bare'].join('|')))
    }
    const pending = items.filter((x) => !completed.has(identity(x)))
    console.log(JSON.stringify({ mode: v.execute ? 'EXECUTE (paid)' : 'DRY RUN (free)', total: items.length,
        already_recorded: items.length - pending.length, remaining: pending.length, model: v.model, agent: v.agent,
        arms, scenarios, repeats, sources: Object.fromEntries([...available].map(([k, d]) => [k, { path: d, sha: sha(d) }])) }, null, 2))
    if (!v.execute) {
        for (const x of pending) console.log('PLAN ' + x.scenario + ' ' + x.arm + ' rep=' + x.rep)
    } else {
        if (!out) throw Error('--execute requires --out to retain every run, including failures')
        if (pending.length > maximum) throw Error(pending.length + ' paid sessions exceeds --max-sessions ' + maximum + ': raise it explicitly')
        for (const [i, x] of pending.entries()) {
            const arm = x.arm === 'before' || x.arm === 'after' ? 'ticketflow' : x.arm
            const args = [join(HERE, 'agent-eval.mjs'), x.scenario, '--agent', v.agent, '--arm', arm,
                '--model', v.model, '--rep', String(x.rep), '--label', x.arm, '--out', out,
                ...(x.source ? ['--source', x.source] : [])]
            console.log('SESSION ' + (i + 1) + '/' + pending.length + ' ' + x.scenario + ' ' + x.arm + ' rep=' + x.rep)
            const run = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 35 * 60_000 })
            if (run.stdout) process.stdout.write(run.stdout)
            if (run.stderr) process.stderr.write(run.stderr)
            if (![0, 1].includes(run.status)) throw Error('session did not record a result; stopped at ' + x.scenario + '/' + x.arm + '/rep' + x.rep)
        }
    }
} catch (e) { fail(e.message) }
