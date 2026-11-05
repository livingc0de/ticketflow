import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fill, templateVars } from '../core/lib/render.mjs'
import { hookDecision } from '../core/lib/guard.mjs'
import { config } from './helpers.mjs'

const workflow = readFileSync(new URL('../core/templates/ci.yml', import.meta.url), 'utf8')
const render = (mode) => fill(workflow, templateVars(config({ verify: { mode, command: 'npm run verify' } }), { runtimeRel: '.ticketflow' }))
const decision = (mode, command) => hookDecision({ tool_name: 'Bash', tool_input: { command } },
    config({ verify: { mode, command: 'npm run verify' } }), { cwd: '/tmp' })

test('tiered workflow defers drafts and checks local gate without duplicating full tests', () => {
    const yml = render('tiered')
    assert.match(yml, /ready_for_review/)
    assert.match(yml, /!github\.event\.pull_request\.draft/)
    assert.match(yml, /verify-route\.mjs/)
    assert.match(yml, /Validate Local Gate/)
    assert.match(yml, /route=local/)
    assert.match(yml, /steps\.scope\.outputs\.route != 'local'/)
})
test('CI mode still runs normally and old local-first remains available', () => {
    assert.doesNotMatch(render('ci'), /verify-route\.mjs|Validate Local Gate/)
    assert.doesNotMatch(render('local-first'), /verify-route\.mjs|Validate Local Gate/)
    assert.match(render('local-first'), /ready_for_review/)
})
test('agent guard blocks exact full verify in CI or tiered, but not targeted tests', () => {
    for (const mode of ['ci', 'tiered']) {
        assert.equal(decision(mode, 'npm run verify').block, true)
        assert.equal(decision(mode, 'npm run test:domain').block, false)
    }
    assert.equal(decision('local-first', 'npm run verify').block, false)
})
