import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDir } from '../../tests/helpers.mjs'

const TOOL = new URL('../report.mjs', import.meta.url).pathname
const row = (over = {}) => ({ scenario:'L1-trivial-copy', agent:'claude', agent_version:'9.9', requested_model:'test-model',
    model:'test-model', arm:'bare', variant:'bare', eval_sha:'a'.repeat(40), ticketflow_sha:null, plugin_sha:null,
    eval_fingerprint:'a'.repeat(64), evaluation_mode:'non-adversarial', profile_isolation:'isolated', sandbox_mode:'not-applicable',
    requested_effort:null,
    repeat:1, check:{pass:true}, wall_s:6, cost_usd:0.2, tokens:{input_tokens:100,output_tokens:20},
    diff:{added:3,removed:1}, deps_added:0, agent_exit:0, descendants:'unknown', ...over })
function run(rows, opts = []) {
    const dir = tempDir('bench-report-'), file = join(dir, 'runs.jsonl'), out = join(dir, 'summary.md'), csv = join(dir, 'sessions.csv')
    writeFileSync(file, rows.map((r)=>JSON.stringify(r)).join('\n') + '\n')
    const r = spawnSync(process.execPath, [TOOL,file,'--out',out,'--csv',csv,...opts], { encoding:'utf8' })
    return { ...r, markdown:r.status===0?readFileSync(out,'utf8'):null, csv:r.status===0?readFileSync(csv,'utf8'):null }
}
function publish(rows, opts = []) {
    const dir = tempDir('bench-publish-'), file = join(dir, 'runs.jsonl'), results = join(dir, 'results'), out = join(results, '2026-10-29-pilot.md')
    writeFileSync(file, rows.map((r)=>JSON.stringify(r)).join('\n') + '\n')
    const r = spawnSync(process.execPath, [TOOL,file,'--publish','--results-dir',results,'--date','2026-10-29','--label','pilot',...opts], { encoding:'utf8' })
    return { ...r, dir, out, markdown: existsSync(out) ? readFileSync(out,'utf8') : null }
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
    const r = run([row(),row({repeat:2,eval_sha:'b'.repeat(40),eval_fingerprint:'b'.repeat(64),cost_usd:null})])
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

test('report rejects unbalanced and duplicate scenario/repeat cells', () => {
    let r = run([row(), row()])
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.markdown, /Duplicate scenario\/repeat cells in bare/)

    r = run([row({ repeat:1 }), row({ repeat:3 })])
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.markdown, /Incomplete repeat sequence in bare/)
    assert.match(r.markdown, /Missing scenario\/repeat cells in bare/)

    r = run([row({ repeat:1 }), row({ repeat:2 }), row({ arm:'ticketflow', variant:'ticketflow', ticketflow_sha:'b'.repeat(40), repeat:1 })])
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.markdown, /Scenario\/repeat cell sets differ between arms/)
})

test('publication writes a dated sanitized report with provenance and methodology', () => {
    const dir = tempDir('bench-sensitive-')
    const r = publish([
        row({ agent_version:'/tmp/private/cli 9.9', model:'model\n|with`markup', requested_model:'model\n|with`markup', workdir:join(dir,'workdir'), answer:'secret answer', diff:{added:3,removed:1,files:['/tmp/private/answer.txt']} }),
        row({ repeat:2, agent_version:'/tmp/private/cli 9.9', model:'model\n|with`markup', requested_model:'model\n|with`markup', check:{pass:false}, cost_usd:0.4, workdir:join(dir,'workdir-2'), answer:'another secret' }),
    ])
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /2026-10-29-pilot\.md/)
    assert.match(r.markdown, /# Agent benchmark report — 2026-10-29/)
    assert.match(r.markdown, /## Revisions and models/)
    assert.match(r.markdown, /## Methodology/)
    assert.match(r.markdown, /## Per-scenario outcomes/)
    assert.match(r.markdown, /1\/2/)
    assert.match(r.markdown, /0\.600/)
    assert.match(r.markdown, /## Interpretation and limitations/)
    assert.doesNotMatch(r.markdown, /secret answer|another secret|answer\.txt|\/tmp\/private|workdir/)
    assert.doesNotMatch(r.markdown, /\|with`markup/)
})

test('publication refuses unsafe metadata and incomplete matrices without writing a report', () => {
    let r = publish([row({ repeat:1 }), row({ repeat:3 })])
    assert.equal(r.status, 2)
    assert.match(r.stderr, /publication refused/)
    assert.equal(r.markdown, null)

    r = publish([row()], ['--label','Unsafe_Label'])
    assert.equal(r.status, 2)
    assert.match(r.stderr, /lowercase slug/)
    assert.equal(r.markdown, null)
})

test('publication refuses missing or invalid effort and sandbox provenance', () => {
    const missingEffort = row(); delete missingEffort.requested_effort
    let r = publish([missingEffort])
    assert.equal(r.status, 2)
    assert.match(r.stderr, /requested_effort to be present/)

    r = publish([row({ requested_effort:'turbo' })])
    assert.equal(r.status, 2)
    assert.match(r.stderr, /requested_effort to be present/)

    r = publish([row({ sandbox_mode:'workspace-write' })])
    assert.equal(r.status, 2)
    assert.match(r.stderr, /sandbox_mode to be present/)
})

test('model provenance is kept distinct in report and CSV', () => {
 const r=run([row({requested_model:'requested',model:'observed'})])
 assert.equal(r.status,0,r.stderr)
 assert.match(r.markdown,/requested\/observed/)
 assert.match(r.csv,/requested_model,effective_model/)
 assert.match(r.csv,/"requested","observed"/)
})
test('publication refuses mixed effective models or CLI versions', () => {
 for(const changed of [{model:'other'},{agent_version:'other'}]) {
   const r=publish([row(),row({repeat:2,...changed})])
   assert.equal(r.status,2)
   assert.match(r.stderr,/consistent CLI version/)
 }
})

test('unisolated runs are labeled and never silently pooled with isolated results', () => {
    const single = run([row({ profile_isolation:'unisolated' })])
    assert.equal(single.status, 0, single.stderr)
    assert.match(single.markdown, /Profile isolation: unisolated/)
    assert.match(single.markdown, /Unisolated agent profiles may load personal plugins/)
    assert.match(single.csv, /profile_isolation/)
    assert.match(single.csv, /"unisolated"/)

    const mixed = [row({ profile_isolation:'isolated' }), row({ repeat:2, profile_isolation:'unisolated' })]
    const preview = run(mixed)
    assert.equal(preview.status, 0, preview.stderr)
    assert.match(preview.markdown, /Mixed profile isolation modes/)
    const rejected = publish(mixed)
    assert.equal(rejected.status, 2)
    assert.match(rejected.stderr, /publication refuses mixed profile isolation modes/)
})

test('incomplete benchmark-only plugin cleanup is flagged and blocks publication', () => {
    const single = row({ profile_isolation:'unisolated', profile_cleanup:'failed' })
    const preview = run([single])
    assert.equal(preview.status, 0, preview.stderr)
    assert.match(preview.markdown, /plugin cleanup incomplete/)
    const rejected = publish([single])
    assert.equal(rejected.status, 2)
    assert.match(rejected.stderr, /publication refuses incomplete plugin cleanup/)
})
