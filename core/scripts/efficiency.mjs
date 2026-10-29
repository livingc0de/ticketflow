#!/usr/bin/env node
/**
 * Read an existing Claude Code --output-format json or Codex exec --json session capture.
 * Print optional per-ticket efficiency metadata without starting an agent or estimating unavailable usage.
 * Usage: node efficiency.mjs <session.json|session.jsonl> [--agent claude|codex] [--json]
 * One capture is one session; descendant-agent coverage is never assumed.
 */
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

const fail = (message) => { console.error('efficiency: ' + message); process.exit(2) }
let file, agent, json
try {
    const p = parseArgs({ options: { agent: { type: 'string' }, json: { type: 'boolean' } }, allowPositionals: true })
    if (p.positionals.length !== 1 || (p.values.agent && !['claude', 'codex'].includes(p.values.agent))) throw Error('usage: efficiency.mjs <session.json|session.jsonl> [--agent claude|codex] [--json]')
    ;[file] = p.positionals
    agent = p.values.agent
    json = p.values.json === true
} catch (e) { fail(e.message) }

let source
try { source = readFileSync(file, 'utf8') } catch { fail('cannot read session file') }
let events
try {
    const whole = JSON.parse(source)
    events = Array.isArray(whole) ? whole : [whole]
} catch {
    try { events = source.split(/\r?\n/).filter((x) => x.trim()).map((x) => JSON.parse(x)) }
    catch { fail('expected JSON or JSONL session output') }
}
if (!events.length) fail('empty session output')
agent ??= events.some((x) => x?.type === 'turn.completed') ? 'codex' : events.some((x) => x?.type === 'result') ? 'claude' : null
if (!agent) fail('unknown session format; specify --agent')

const count = (x) => Number.isSafeInteger(x) && x >= 0 ? x : null
const money = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : null
const sum = (items, name) => items.every((x) => count(x?.[name]) !== null)
    ? items.reduce((n, x) => n + x[name], 0) : null
let result
if (agent === 'claude') {
    const done = events.filter((x) => x?.type === 'result').at(-1)
    if (!done) fail('Claude result event missing; usage unknown, no summary written')
    const u = done.usage ?? {}
    result = {
        agent, duration_ms: count(done.duration_ms), cost_usd: money(done.total_cost_usd),
        input_tokens: count(u.input_tokens), output_tokens: count(u.output_tokens),
        cached_input_tokens: count(u.cache_read_input_tokens), cache_write_tokens: count(u.cache_creation_input_tokens),
    }
} else {
    const done = events.filter((x) => x?.type === 'turn.completed')
    if (!done.length) fail('Codex turn.completed event missing; usage unknown, no summary written')
    const usages = done.map((e) => e.usage ?? {})
    // These are per-turn counts, not an additional model/account-wide total.
    result = { agent, duration_ms: null, cost_usd: null,
        input_tokens: sum(usages, 'input_tokens'), output_tokens: sum(usages, 'output_tokens'),
        cached_input_tokens: sum(usages, 'cached_input_tokens'), cache_write_tokens: null }
}
result.descendants = 'unknown' // A parent's CLI JSON does not prove that child usage is included.
result.review_wait_ms = null
if (json) console.log(JSON.stringify(result))
else {
    const fmt = (x) => x === null ? 'unknown' : String(x)
    console.log('Efficiency: agent ' + agent +
        ' · duration_ms ' + fmt(result.duration_ms) +
        ' · input ' + fmt(result.input_tokens) +
        ' · output ' + fmt(result.output_tokens) +
        ' · cached_read ' + fmt(result.cached_input_tokens) +
        ' · cached_write ' + fmt(result.cache_write_tokens) +
        ' · cost_usd ' + fmt(result.cost_usd) +
        ' · descendants unknown · review_wait_ms unknown')
}
