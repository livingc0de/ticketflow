import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDir } from '../../tests/helpers.mjs'

const TOOL = new URL('../report.mjs', import.meta.url).pathname
const row = (over = {}) => ({ scenario:'L1-trivial-copy', agent:'claude', agent_version:'9.9', requested_model:'test-model',
    model:'test-model', arm:'bare', variant:'bare', eval_sha:'a'.repeat(40), ticketflow_sha:null, plugin_sha:null,
    repeat:1, check:{pass:true}, wall_s:6, cost_usd:0.2, tokens:{input_tokens:100,output_tokens:20},
    diff:{added:3,removed:1}, deps_added:0, agent_exit:0, descendants:'unknown', ...over })
function run(rows, opts = []) {
    const dir = tempDir('bench-report-'), file = join(dir, 'runs.jsonl'), out = join(dir, 'summary.md'), csv = join(dir, 'sessions.csv')
    writeFileSync(file, rows.map((r)=>JSON.stringify(r)).join('\n') + '\n')
    const r = spawnSync(process.execPath, [TOOL,file,'--out',out,'--csv',csv,...opts], { encoding:'utf8' })
    return { ...r, markdown:r.status===0?readFileSync(out,'utf8'):null, csv:r.status===0?readFileSync(csv,'utf8'):null }
}
test('report retains failures in pass rate and cost per successful task', () => {
    const rows = [row(),row({repeat:2,check:{pass:false},cost_usd:0.4,wall_s:10,diff:{added:5,removed:1}})]
    const r = run(rows)
    assert.equal(r.status,0,r.stderr)
    assert.match(r.markdown,/1\/2/)
    assert.match(r.markdown,/0\.600/)
    assert.match(r.markdown,/Cost per success = all observed session costs/)
    assert.match(r.csv,/scenario,agent,agent_version/)
    assert.equal(r.csv.trim().split('\n').length,3)
})
test('unknown cost is not zero, and mixed evaluations are highlighted', () => {
    const r = run([row(),row({repeat:2,eval_sha:'b'.repeat(40),cost_usd:null})])
    assert.equal(r.status,0,r.stderr)
    assert.match(r.markdown,/unknown \| unknown/)
    assert.match(r.markdown,/Mixed or unknown evaluation revisions/)
    assert.match(r.markdown,/Missing cost data/)
})
test('missing, empty, invalid records and malformed JSON refuse to produce a report', () => {
    for (const rows of [[],[{x:1}]]) {
        const r = run(rows)
        assert.equal(r.status,2,r.stderr)
    }
    const dir=tempDir('bench-report-'),file=join(dir,'broken.jsonl')
    writeFileSync(file,'no json')
    const r=spawnSync(process.execPath,[TOOL,file],{encoding:'utf8'})
    assert.equal(r.status,2)
    assert.match(r.stderr,/cannot parse/)
})
