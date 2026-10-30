#!/usr/bin/env node
/** Maintainer-only summary of recorded agent sessions: no model calls, no external dependencies. */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const HERE = dirname(fileURLToPath(import.meta.url))
const usage = 'usage: node benchmarks/report.mjs <runs.jsonl> [--out summary.md] [--csv sessions.csv] [--publish --label slug --date YYYY-MM-DD --results-dir DIR]'
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
const model = (r) => r.model ?? 'unknown'   // observed, not a fallback to the requested model
const requestedModel = (r) => r.requested_model ?? 'unknown'
const source = (r) => r.ticketflow_sha || r.plugin_sha || 'bare'
const evaluation = (r) => r.eval_fingerprint ?? r.eval_sha ?? 'unknown'
const csv = (v) => '"' + String(v ?? '').replaceAll('"', '""') + '"'
const isRevision = (v) => typeof v === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(v)
const validEffort = (v) => v === null || ['low', 'medium', 'high', 'xhigh', 'max'].includes(v)
const validSandbox = (v) => ['not-applicable', 'danger-full-access'].includes(v)
const revision = (v) => v === 'bare' ? 'bare' : isRevision(v) ? v.toLowerCase() : 'unknown'
const pluginStatus = (r) => r.plugin_bootstrap?.status ?? (r.plugin_sha ? 'unknown' : null)
const usablePluginStatus = (r) => ['loaded', 'verified'].includes(pluginStatus(r))
const archiveRef = (r) => typeof r.transcript_archive === 'string' ? r.transcript_archive : r.transcript_archive?.directory
const validArchive = (r) => typeof archiveRef(r) === 'string' && archiveRef(r).length > 0 &&
    (typeof r.transcript_archive === 'string' ||
        (Array.isArray(r.transcript_archive?.files) &&
            ['agent.out', 'answer.txt', 'metadata.json'].every((name) => r.transcript_archive.files.includes(name))))
const safeText = (v, limit = 160) => {
    let text = String(v ?? 'unknown').trim()
        .replace(/[\u0000-\u001f\u007f]+/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/[|`<>[\]]/g, '')
        .replace(/(?:[A-Za-z]:[\\/]|\/(?:home|Users|private|tmp|var|mnt|workspace|workspaces|runner)[\\/])[^\s,;)]*/g, '[path]')
        .replace(/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{12,}\b/g, '[redacted]')
    return text.slice(0, limit) || 'unknown'
}
const cell = (r) => JSON.stringify([r.scenario, r.repeat ?? 'missing'])

function descriptor(r) {
    return {
        agent: r.agent ?? 'unknown', agentVersion: r.agent_version ?? 'unknown', requestedModel: requestedModel(r),
        effectiveModel: model(r), arm: r.variant ?? r.arm, source: source(r), evaluation: evaluation(r),
        profileIsolation: r.profile_isolation ?? 'unknown', sandboxMode: r.sandbox_mode ?? 'unknown', requestedEffort: r.requested_effort ?? 'default',
    }
}

function groupsFor(rows) {
    const groups = new Map()
    for (const r of rows) {
        const d = descriptor(r), key = JSON.stringify([d.agent, d.agentVersion, d.requestedModel, d.effectiveModel, d.requestedEffort, d.arm, d.source, d.evaluation, d.profileIsolation, d.sandboxMode])
        if (!groups.has(key)) groups.set(key, { descriptor: d, rows: [] })
        groups.get(key).rows.push(r)
    }
    return [...groups.values()]
}

function reportIssues(rows, groups, evaluations, configurations) {
    const issues = []
    if (evaluations.length !== 1 || evaluations.includes('unknown')) issues.push('Mixed or unknown evaluation revisions: do not pool as a controlled comparison.')
    if (configurations.length !== 1) issues.push('Multiple agent versions/models: comparison is not controlled across them.')
    if (rows.some((r) => !r.model)) issues.push('Effective model was not reported for some sessions; model parity requires operator verification.')
    if (rows.some((r) => r.ticketflow_dirty === true)) issues.push('At least one TicketFlow checkout was dirty.')
    if (rows.some((r) => r.profile_isolation === 'unisolated')) issues.push('Unisolated agent profiles may load personal plugins, configuration and session state; comparisons need separate verification.')
    if (rows.some((r) => r.profile_cleanup === 'failed')) issues.push('At least one benchmark left its plugin cleanup incomplete; inspect the original Codex profile.')
    if (new Set(rows.map((r) => r.profile_isolation ?? 'unknown')).size > 1) issues.push('Mixed profile isolation modes: do not pool as a controlled comparison.')
    if (rows.some((r) => !r.sandbox_mode)) issues.push('Sandbox mode is missing for some sessions; do not claim a controlled permissions comparison.')
    if (new Set(rows.map((r) => r.sandbox_mode ?? 'unknown')).size > 1) issues.push('Mixed sandbox modes: do not pool as a controlled comparison.')
    if (rows.some((r) => r.plugin_sha && !usablePluginStatus(r))) issues.push('Plugin loading is unknown or failed for at least one external arm; inspect the native setup evidence.')
    if (rows.some((r) => !r.result_row_id || !validArchive(r))) issues.push('Transcript archive metadata is missing for at least one session.')
    if (rows.some((r) => r.evaluation_mode !== 'non-adversarial')) issues.push('Evaluation mode is missing or not explicitly non-adversarial.')
    if (rows.some((r) => r.cost_usd == null)) issues.push('Missing cost data: no total cost or cost per success is inferred for affected arms.')
    if (rows.some((r) => r.descendants !== 'included')) issues.push('Descendant-agent token/cost inclusion is unknown; numbers may exclude subagents.')
    for (const { descriptor: d, rows: part } of groups) {
        const cells = new Set(part.map(cell))
        if (cells.size !== part.length) issues.push(`Duplicate scenario/repeat cells in ${safeText(d.arm)}.`)
        const repeats = part.map((r) => r.repeat).filter((r) => Number.isInteger(r) && r > 0)
        if (repeats.length && new Set(repeats).size !== Math.max(...repeats)) issues.push(`Incomplete repeat sequence in ${safeText(d.arm)}.`)
        const scenarios = [...new Set(part.map((r) => r.scenario))]
        if (repeats.length && cells.size !== scenarios.length * Math.max(...repeats)) issues.push(`Missing scenario/repeat cells in ${safeText(d.arm)}.`)
    }
    const groupCells = groups.map(({ rows: part }) => new Set(part.map(cell)))
    if (groupCells.length > 1 && groupCells.some((cells) => cells.size !== groupCells[0].size || [...cells].some((v) => !groupCells[0].has(v))))
        issues.push('Scenario/repeat cell sets differ between arms.')
    if (rows.some((r) => r.agent_exit !== 0)) issues.push('Some agent invocations did not exit successfully; failures are retained as data.')
    if (rows.some((r) => r.repeat == null)) issues.push('Some runs lack repetition identifiers; repeated-run balancing cannot be verified.')
    if (rows.some((r) => !Number.isInteger(r.repeat) || r.repeat < 1)) issues.push('Some runs have invalid repetition identifiers; repeated-run balancing cannot be verified.')
    if (rows.some((r) => !r.requested_model)) issues.push('Some runs did not pin the requested model.')
    return issues
}

function publicationErrors(rows, evaluations, issues) {
    const errors = []
    if (evaluations.length !== 1 || evaluations[0] === 'unknown' || !isRevision(evaluations[0])) errors.push('publication requires one known evaluator revision')
    if (rows.some((r) => !r.requested_model || typeof r.requested_model !== 'string')) errors.push('publication requires a pinned requested model for every row')
    if (rows.some((r) => !Object.hasOwn(r, 'requested_effort') || !validEffort(r.requested_effort))) errors.push('publication requires requested_effort to be present and one of null, low, medium, high, xhigh or max for every row')
    if (rows.some((r) => !Object.hasOwn(r, 'sandbox_mode') || !validSandbox(r.sandbox_mode))) errors.push('publication requires sandbox_mode to be present and one of not-applicable or danger-full-access for every row')
    if (rows.some((r) => !r.agent || !r.agent_version)) errors.push('publication requires agent and CLI version metadata for every row')
    if (rows.some((r) => r.ticketflow_dirty === true)) errors.push('publication refuses dirty TicketFlow source rows')
    if (rows.some((r) => r.evaluation_mode !== 'non-adversarial')) errors.push('publication requires evaluation_mode=non-adversarial for every row')
    if (rows.some((r) => r.repeat == null || !Number.isInteger(r.repeat) || r.repeat < 1)) errors.push('publication requires positive repetition identifiers')
    if (rows.some((r) => (r.ticketflow_sha || r.plugin_sha) && !isRevision(r.ticketflow_sha || r.plugin_sha))) errors.push('publication requires full hexadecimal source revisions')
    if (rows.some((r) => !r.result_row_id || !validArchive(r))) errors.push('publication requires transcript archive metadata for every session')
    if (rows.some((r) => r.plugin_sha && !usablePluginStatus(r))) errors.push('publication refuses external sessions without loaded or verified plugin loading evidence')
    const structural = issues.filter((i) => /Duplicate scenario\/repeat|Incomplete repeat|Missing scenario\/repeat|Scenario\/repeat cell sets differ/.test(i))
    errors.push(...structural)
    if (issues.includes('Multiple agent versions/models: comparison is not controlled across them.')) errors.push('publication requires one consistent CLI version and requested/effective model configuration')
    if (issues.includes('Mixed profile isolation modes: do not pool as a controlled comparison.')) errors.push('publication refuses mixed profile isolation modes')
    if (issues.includes('Sandbox mode is missing for some sessions; do not claim a controlled permissions comparison.')) errors.push('publication requires sandbox mode metadata for every row')
    if (issues.includes('Mixed sandbox modes: do not pool as a controlled comparison.')) errors.push('publication refuses mixed sandbox modes')
    if (issues.includes('At least one benchmark left its plugin cleanup incomplete; inspect the original Codex profile.')) errors.push('publication refuses incomplete plugin cleanup')
    return [...new Set(errors)]
}

function render(rows, groups, evaluations, { published = false, date = null } = {}) {
    const configurations = [...new Set(rows.map((r) => safeText(`${r.agent ?? 'unknown'}/${r.agent_version ?? 'unknown'}/${requestedModel(r)}/${model(r)}/${r.requested_effort ?? 'default'}`)))]
    const lines = [published ? `# Agent benchmark report — ${date}` : '# Agent benchmark results', '',
        `Recorded sessions: **${rows.length}** · Evaluation revisions: ${evaluations.map(revision).join(', ')}`,
        'Agent/model configurations: ' + configurations.join(', '),
        'Profile isolation: ' + [...new Set(rows.map((r) => safeText(r.profile_isolation ?? 'unknown')))].join(', '),
        'Sandbox mode: ' + [...new Set(rows.map((r) => safeText(r.sandbox_mode ?? 'unknown')))].join(', '), '',
        'Requested effort: ' + [...new Set(rows.map((r) => safeText(r.requested_effort ?? 'default')))].join(', '), '',
        '> These are observed results, not simulated model outcomes. A green repository test suite does not prove agent performance.',
        '> Compare groups only when the agent, model, effort, permissions, scenario/repeat cells, evaluator revision and plugin bootstraps match.',
        '> Claude plugin rows record the validated native --plugin-dir loading path as loaded; Codex rows use native enabled-plugin evidence as verified. This proves plugin availability to the session, not model use of a particular skill or hook.',
        '> This harness is explicitly non-adversarial: agents can potentially discover evaluator files through the unrestricted node/npm allowlist.', '']

    if (published) {
        lines.push('## Revisions and models', '',
            '| Arm | Source revision | Evaluator revision | Agent | CLI version | Requested model | Effective model | Effort | Profile isolation | Sandbox mode | Sessions |',
            '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | ---: |')
        for (const { descriptor: d, rows: part } of groups.sort((a, b) => JSON.stringify(a.descriptor).localeCompare(JSON.stringify(b.descriptor)))) {
            lines.push(`| ${safeText(d.arm)} | ${d.source === 'bare' ? 'bare' : revision(d.source)} | ${revision(d.evaluation)} | ${safeText(d.agent)} | ${safeText(d.agentVersion)} | ${safeText(d.requestedModel)} | ${safeText(d.effectiveModel)} | ${safeText(d.requestedEffort)} | ${safeText(d.profileIsolation)} | ${safeText(d.sandboxMode)} | ${part.length} |`)
        }
        lines.push('', '## Methodology', '',
            '- Each session uses a fresh temporary Git repository and the scenario’s hidden checker; the repository test suite is part of the applicable checks.',
            '- A task passes only when its deterministic hidden check passes. Failed agent invocations remain in the denominator and their known costs remain in totals.',
            '- Reported metrics are pass rate, descriptive Wilson 95% range, median elapsed seconds, median net lines changed, tokens when supplied, total USD, and USD per successful task.',
            '- Repeated scenario/repeat cells are paired observations, not independent trials. Keep evaluator, source revisions, models, sandbox modes and plugin bootstraps fixed for comparisons.',
            '- No paid sessions are run by tests or CI. Raw JSONL rows, transcripts, answers and local paths are not included in this report.', '')
    }

    lines.push('| Arm (revision) | Sessions | Passes (95% Wilson range; descriptive) | Median seconds | Median added LOC | Total USD | USD / success |',
        '| --- | ---: | ---: | ---: | ---: | ---: | ---: |')
    for (const { descriptor: d, rows: part } of groups.sort((a, b) => JSON.stringify(a.descriptor).localeCompare(JSON.stringify(b.descriptor)))) {
        const n = part.length, passed = part.filter((r) => r.check.pass).length, ci = wilson(passed, n), total = cost(part), unit = passed && total !== null ? total / passed : null
        lines.push(`| ${safeText(d.arm)} (${revision(d.source)}) · ${safeText(d.agent)}/${safeText(d.effectiveModel)} | ${n} | ${passed}/${n} (${fmt(100*ci[0], 0)}–${fmt(100*ci[1], 0)}%) | ${fmt(medianKey(part, (r) => r.wall_s))} | ${fmt(medianKey(part, (r) => r.diff?.added))} | ${fmt(total, 3)} | ${fmt(unit, 3)} |`)
    }
    lines.push('', '## Per-scenario outcomes', '',
        '| Scenario | Arm | N | Passes | Median duration (s) | Median output tokens | Median net LOC | Dependencies added |',
        '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |')
    for (const { descriptor: d, rows: part } of groups.sort((a, b) => JSON.stringify(a.descriptor).localeCompare(JSON.stringify(b.descriptor)))) {
        const cases = new Map()
        for (const row of part) { if (!cases.has(row.scenario)) cases.set(row.scenario, []); cases.get(row.scenario).push(row) }
        for (const [s, rs] of [...cases].sort(([a], [b]) => a.localeCompare(b))) {
            const net = medianKey(rs, (r) => typeof r.diff?.added === 'number' && typeof r.diff?.removed === 'number' ? r.diff.added-r.diff.removed : null)
            lines.push(`| ${safeText(s)} | ${safeText(d.arm)} | ${rs.length} | ${rs.filter((r) => r.check.pass).length} | ${fmt(medianKey(rs, (r) => r.wall_s))} | ${fmt(medianKey(rs, (r) => r.tokens?.output_tokens), 0)} | ${fmt(net)} | ${fmt(medianKey(rs, (r) => r.deps_added), 0)} |`)
        }
    }
    return lines
}

function renderLimitations(lines, issues, published) {
    lines.push('', '## Interpretation and limitations', '')
    if (!issues.length) lines.push('No additional metadata mismatches detected. Model effort, permission parity and model use of plugin skills/hooks still require an operator check.')
    else for (const i of issues) lines.push('- ' + i)
    lines.push('', 'Pass rates use Wilson 95% ranges only as descriptive summaries; repeated paired task cells are not independent trials, so no inferential superiority claim is supported.',
        'Cost per success = all observed session costs (including failed runs) / successful tasks; it is unknown when any session cost is unavailable.',
        'Plugin loading evidence proves the pinned plugin was made available to the agent session; it does not prove that the model invoked a particular skill or hook. Descendant-agent attribution, manual intervention and effective effort may be unknown.',
        'This benchmark is non-adversarial and is not a security sandbox; agents may discover evaluator files through the unrestricted node/npm allowlist. Codex rows use danger-full-access and therefore require a disposable machine.',
        'A benchmark is not a substitute for the separate GitHub merge-gate integration probes.', '')
    if (published) lines.push('## Reproduction', '',
        'Run the deterministic reporter on a locally retained JSONL session file, after checking source revisions, model pins, plugin loading and sensitive paths:', '',
        '    node benchmarks/report.mjs <recorded-runs.jsonl> --publish --label <slug>', '',
        'Only the resulting dated Markdown report should be considered for repository publication; raw session files stay local and ignored.', '')
}

try {
    const { values: v, positionals } = parseArgs({ options: {
        out: { type: 'string' }, csv: { type: 'string' }, publish: { type: 'boolean' }, label: { type: 'string' }, date: { type: 'string' }, 'results-dir': { type: 'string' },
    }, allowPositionals: true })
    if (positionals.length !== 1) throw Error(usage)
    if (v.publish && (v.out || v.csv)) throw Error('--publish writes Markdown only; do not combine it with --out or --csv')
    if (v['results-dir'] && !v.publish) throw Error('--results-dir requires --publish')
    const label = v.label ?? 'agentic', date = v.date ?? new Date().toISOString().slice(0, 10)
    if (v.publish && (!/^[a-z][a-z0-9-]{0,30}$/.test(label) || !/^\d{4}-\d{2}-\d{2}$/.test(date))) throw Error('publication label/date must be a lowercase slug and YYYY-MM-DD')
    let rows
    try { rows = readFileSync(positionals[0], 'utf8').split(/\r?\n/).filter(Boolean).map((s) => JSON.parse(s)) }
    catch (e) { throw Error('cannot parse recorded sessions: ' + e.message) }
    if (!rows.length) throw Error('no sessions: cannot claim improvement')
    if (rows.some((r) => typeof r.scenario !== 'string' || !r.arm || !r.check || typeof r.check.pass !== 'boolean')) throw Error('invalid session row')
    const evaluations = [...new Set(rows.map(evaluation))], groups = groupsFor(rows)
    const configurations = [...new Set(rows.map((r) => `${r.agent ?? 'unknown'}/${r.agent_version ?? 'unknown'}/${requestedModel(r)}/${model(r)}/${r.requested_effort ?? 'default'}`))]
    const issues = reportIssues(rows, groups, evaluations, configurations)
    if (v.publish) {
        const errors = publicationErrors(rows, evaluations, issues)
        if (errors.length) throw Error('publication refused: ' + errors.join('; '))
    }
    const lines = render(rows, groups, evaluations, { published: v.publish, date: v.publish ? date : null })
    renderLimitations(lines, issues, v.publish)
    const markdown = lines.join('\n')
    if (v.publish) {
        const dir = resolve(v['results-dir'] ?? join(HERE, 'results')), target = join(dir, `${date}-${label}.md`)
        mkdirSync(dir, { recursive: true })
        writeFileSync(target, markdown + '\n')
        console.log(target)
    } else if (v.out) writeFileSync(v.out, markdown)
    else console.log(markdown)
    if (v.csv) {
        const columns = ['scenario','agent','agent_version','requested_model','effective_model','arm','variant','repeat','ticketflow_sha','plugin_sha','plugin_bootstrap_status','transcript_archive',
            'eval_sha','eval_fingerprint','evaluation_mode','requested_effort','profile_isolation','sandbox_mode','profile_cleanup','pass','wall_s','cost_usd','input_tokens','output_tokens','added','removed','deps_added','agent_exit']
        const entries = rows.map((r) => [r.scenario,r.agent,r.agent_version,requestedModel(r),model(r),r.arm,r.variant??r.arm,r.repeat, r.ticketflow_sha,r.plugin_sha,pluginStatus(r),archiveRef(r),
            r.eval_sha,r.eval_fingerprint,r.evaluation_mode,r.requested_effort??'default',r.profile_isolation??'unknown',r.sandbox_mode??'unknown',r.profile_cleanup??'unknown',r.check.pass,r.wall_s,r.cost_usd,r.tokens?.input_tokens,r.tokens?.output_tokens,r.diff?.added,r.diff?.removed,r.deps_added,r.agent_exit])
        writeFileSync(v.csv, columns.join(',') + '\n' + entries.map((r) => r.map(csv).join(',')).join('\n') + '\n')
    }
} catch (e) { console.error('benchmarks report: ' + e.message); process.exitCode = 2 }
