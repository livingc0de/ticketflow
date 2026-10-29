import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const script = new URL('../core/scripts/efficiency.mjs', import.meta.url).pathname
function run(data, opts = []) {
    const dir = mkdtempSync(join(tmpdir(), 'tf-efficiency-'))
    try {
        const file = join(dir, 'capture.json')
        writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data))
        return spawnSync(process.execPath, [script, file, ...opts], { encoding: 'utf8' })
    } finally { rmSync(dir, { recursive: true, force: true }) }
}

test('Claude result reports observed usage, preserving cache categories and unknown descendants', () => {
    const r = run({ type: 'result', duration_ms: 1200, total_cost_usd: 0.07,
        usage: { input_tokens: 100, output_tokens: 40, cache_read_input_tokens: 70, cache_creation_input_tokens: 20 } }, ['--json'])
    assert.equal(r.status, 0, r.stderr)
    assert.deepEqual(JSON.parse(r.stdout), { agent: 'claude', duration_ms: 1200, cost_usd: 0.07,
        input_tokens: 100, output_tokens: 40, cached_input_tokens: 70, cache_write_tokens: 20,
        descendants: 'unknown', review_wait_ms: null })
})
test('Codex sums per-turn usage without inventing cost, duration or descendant totals', () => {
    const r = run([
        { type: 'turn.completed', usage: { input_tokens: 12, output_tokens: 5, cached_input_tokens: 3 } },
        { type: 'turn.completed', usage: { input_tokens: 15, output_tokens: 7, cached_input_tokens: 4 } },
    ].map((x) => JSON.stringify(x)).join('\n'), ['--json'])
    assert.equal(r.status, 0, r.stderr)
    const got = JSON.parse(r.stdout)
    assert.equal(got.input_tokens, 27)
    assert.equal(got.output_tokens, 12)
    assert.equal(got.cached_input_tokens, 7)
    assert.equal(got.cost_usd, null)
    assert.equal(got.duration_ms, null)
    assert.equal(got.descendants, 'unknown')
})
test('no session data is fabricated, unknowns are displayed explicitly', () => {
    const r = run({ type: 'result', usage: {} })
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /input unknown.*output unknown.*cost_usd unknown/)
    assert.match(r.stdout, /descendants unknown/)
})
test('malformed and incomplete captures refuse rather than report false usage', () => {
    for (const capture of ['{not json', { type: 'user' }, { type: 'turn.completed' }]) {
        const r = run(capture)
        if (typeof capture !== 'string' && capture.type === 'turn.completed') assert.equal(r.status, 0)
        else assert.equal(r.status, 2)
    }
    assert.equal(run({ type: 'result' }, ['--agent', 'codex']).status, 2)
})
