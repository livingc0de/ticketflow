#!/usr/bin/env node
/** Maintainer-only summary of recorded agent sessions: no model calls, no external dependencies. */
import { readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

const usage = 'usage: node benchmarks/report.mjs <runs.jsonl> [--out summary.md] [--csv sessions.csv]'
const fmt = (n, digits = 1) => n === null || !Number.isFinite(n) ? 'unknown' : n.toFixed(digits)
const median = (xs) => {
    if (!xs.length || xs.some((n) => typeof n !== 'number' || !Number.isFinite(n))) return null
    const sorted = [...xs].sort((a, b) => a - b), i = Math.floor(sorted.length / 2)
    return sorted.length % 2 ? sorted[i] : (sorted[i - 1] + sorted[i]) / 2
}
const wilson = (successes, n) => {
    if (!n) return null
    const z = 1.96, p = successes / n, d = 1 + z*z/n
    const mid = (p + z*z/(2*n))/d, half = z*Math.sqrt((p*(1-p) + z*z/(4*n))/n)/d
    return [Math.max(0, mid-half), Math.min(1, mid+half)]
}
const cost = (rows) => rows.every((r) => typeof r.cost_usd === 'number' && Number.isFinite(r.cost_usd) && r.cost_usd >= 0)
    ? rows.reduce((s, r) => s + r.cost_usd, 0) : null
const medianKey = (rows, f) => median(rows.map(f))
const source = (r) => r.ticketflow_sha || r.plugin_sha || 'bare'
const model = (r) => r.requested_model ?? r.model ?? 'unknown'
const evaluation = (r) => r.eval_fingerprint ?? r.eval_sha ?? 'unknown'
const csv = (v) => '"' + String(v ?? '').replaceAll('"', '""') + '"'
const cell = (r) => `${r.scenario}|${r.repeat ?? 'missing'}`

try {
    const { values: v, positionals } = parseArgs({ options: { out: { type: 'string' }, csv: { type: 'string' } }, allowPositionals: true })
    if (positionals.length !== 1) throw Error(usage)
    let rows
    try { rows = readFileSync(positionals[0], 'utf8').split(/\r?\n/).filter(Boolean).map((s) => JSON.parse(s)) }
    catch (e) { throw Error('cannot parse recorded sessions: ' + e.message) }
    if (!rows.length) throw Error('no sessions: cannot claim improvement')
    if (rows.some((r) => typeof r.scenario !== 'string' || !r.arm || !r.check || typeof r.check.pass !== 'boolean')) throw Error('invalid session row')
    const evaluations = [...new Set(rows.map(evaluation))]
    const versions = [...new Set(rows.map((r) => r.agent + '/' + r.agent_version + '/' + model(r)))]
    const groups = new Map()
    for (const r of rows) {
        const key = [r.agent, r.agent_version ?? 'unknown', model(r), r.variant ?? r.arm, source(r), evaluation(r)].join('|')
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key).push(r)
    }
    const lines = ['# Agent benchmark results', '',
        'Recorded sessions: **' + rows.length + '** · Evaluation revisions: ' + evaluations.join(', '),
        'Agent/model configurations: ' + versions.join(', '), '',
        '> These are observed results, not simulated model outcomes. A green repository test suite does not prove agent performance.',
        '> Compare groups only when the agent, model, effort, permissions, scenario/repeat cells, evaluator revision and plugin bootstraps match.',
        '> The CLI currently does not independently verify plugin activation, effort or subagent token inclusion.',
        '> This harness is explicitly non-adversarial: agents can potentially discover evaluator files through the unrestricted node/npm allowlist.', '',
        '| Arm (revision) | Sessions | Passes (95% Wilson range; descriptive) | Median seconds | Median added LOC | Total USD | USD / success |',
        '| --- | ---: | ---: | ---: | ---: | ---: | ---: |']
    for (const [key, part] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
        const [agent, agentVersion, m, arm, commit] = key.split('|'), n = part.length, passed = part.filter((r) => r.check.pass).length
        const ci = wilson(passed, n), total = cost(part), unit = passed && total !== null ? total / passed : null
        const seconds = medianKey(part, (r) => r.wall_s), loc = medianKey(part, (r) => r.diff?.added)
        lines.push('| ' + arm + ' (' + commit.slice(0, 9) + ') · ' + agent + '/' + m +
            ' | ' + n + ' | ' + passed + '/' + n + ' (' + fmt(100*ci[0], 0) + '–' + fmt(100*ci[1], 0) + '%)' +
            ' | ' + fmt(seconds) + ' | ' + fmt(loc) + ' | ' + fmt(total, 3) + ' | ' + fmt(unit, 3) + ' |')
    }
    lines.push('', '## Per-scenario outcomes', '',
        '| Scenario | Arm | N | Passes | Median duration (s) | Median output tokens | Median net LOC | Dependencies added |',
        '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |')
    for (const [key, part] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
        const arm = key.split('|')[3], cases = new Map()
        for (const row of part) { if (!cases.has(row.scenario)) cases.set(row.scenario, []); cases.get(row.scenario).push(row) }
        for (const [s, rs] of [...cases].sort(([a],[b])=>a.localeCompare(b))) {
            const net = medianKey(rs, (r) => typeof r.diff?.added === 'number' && typeof r.diff?.removed === 'number' ? r.diff.added-r.diff.removed : null)
            lines.push('| ' + s + ' | ' + arm + ' | ' + rs.length + ' | ' + rs.filter((r) => r.check.pass).length +
                ' | ' + fmt(medianKey(rs, (r) => r.wall_s)) +
                ' | ' + fmt(medianKey(rs, (r) => r.tokens?.output_tokens), 0) + ' | ' + fmt(net) +
                ' | ' + fmt(medianKey(rs, (r) => r.deps_added), 0) + ' |')
        }
    }
    const issues = []
    if (evaluations.length !== 1 || evaluations.includes('unknown')) issues.push('Mixed or unknown evaluation revisions: do not pool as a controlled comparison.')
    if (versions.length !== 1) issues.push('Multiple agent versions/models: comparison is not controlled across them.')
    if (rows.some((r) => r.ticketflow_dirty === true)) issues.push('At least one TicketFlow checkout was dirty.')
    if (rows.some((r) => r.plugin_sha && r.plugin_native?.includes('not independently verified'))) issues.push('Plugin bootstrap was requested but not independently verified in the agent transcript.')
    if (rows.some((r) => r.evaluation_mode !== 'non-adversarial')) issues.push('Evaluation mode is missing or not explicitly non-adversarial.')
    if (rows.some((r) => r.cost_usd == null)) issues.push('Missing cost data: no total cost or cost per success is inferred for affected arms.')
    if (rows.some((r) => r.descendants !== 'included')) issues.push('Descendant-agent token/cost inclusion is unknown; numbers may exclude subagents.')
    const groupCells = [...groups].map(([key, part]) => ({ key, part, cells: new Set(part.map(cell)) }))
    for (const { key, part, cells } of groupCells) {
        const arm = key.split('|')[3]
        if (cells.size !== part.length) issues.push(`Duplicate scenario/repeat cells in ${arm}.`)
        const repeats = part.map((r) => r.repeat).filter((r) => Number.isInteger(r) && r > 0)
        if (repeats.length && new Set(repeats).size !== Math.max(...repeats)) issues.push(`Incomplete repeat sequence in ${arm}.`)
        const scenarios = [...new Set(part.map((r) => r.scenario))]
        if (repeats.length && cells.size !== scenarios.length * Math.max(...repeats)) issues.push(`Missing scenario/repeat cells in ${arm}.`)
    }
    if (groupCells.length > 1 && groupCells.some(({ cells }) => cells.size !== groupCells[0].cells.size || [...cells].some((v) => !groupCells[0].cells.has(v))))
        issues.push('Scenario/repeat cell sets differ between arms.')
    if (rows.some((r) => r.agent_exit !== 0)) issues.push('Some agent invocations did not exit successfully; failures are retained as data.')
    if (rows.some((r) => r.repeat == null)) issues.push('Some runs lack repetition identifiers; repeated-run balancing cannot be verified.')
    if (rows.some((r) => !Number.isInteger(r.repeat) || r.repeat < 1)) issues.push('Some runs have invalid repetition identifiers; repeated-run balancing cannot be verified.')
    if (rows.some((r) => !r.requested_model)) issues.push('Some runs did not pin the requested model.')
    lines.push('', '## Interpretation and limitations', '')
    if (!issues.length) lines.push('No additional metadata mismatches detected. Model effort, permission parity and real plugin activation still require an operator check.')
    else for (const i of issues) lines.push('- ' + i)
    lines.push('', 'Pass rates use Wilson 95% ranges only as descriptive summaries; repeated paired task cells are not independent trials, so no inferential superiority claim is supported.',
        'Cost per success = all observed session costs (including failed runs) / successful tasks; it is unknown when any session cost is unavailable.',
        'A benchmark is not a substitute for the separate GitHub merge-gate integration probes.', '')
    const markdown = lines.join('\n')
    if (v.out) writeFileSync(v.out, markdown)
    else console.log(markdown)
    if (v.csv) {
        const columns = ['scenario','agent','agent_version','requested_model','arm','variant','repeat','ticketflow_sha','plugin_sha',
            'eval_sha','eval_fingerprint','evaluation_mode','pass','wall_s','cost_usd','input_tokens','output_tokens','added','removed','deps_added','agent_exit']
        const entries = rows.map((r) => [r.scenario,r.agent,r.agent_version,model(r),r.arm,r.variant??r.arm,r.repeat, r.ticketflow_sha,r.plugin_sha,
            r.eval_sha,r.eval_fingerprint,r.evaluation_mode,r.check.pass,r.wall_s,r.cost_usd,r.tokens?.input_tokens,r.tokens?.output_tokens,r.diff?.added,r.diff?.removed,r.deps_added,r.agent_exit])
        writeFileSync(v.csv, columns.join(',') + '\n' + entries.map((r) => r.map(csv).join(',')).join('\n') + '\n')
    }
} catch (e) { console.error('benchmarks report: ' + e.message); process.exitCode = 2 }
