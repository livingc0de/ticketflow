import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fill, templateVars } from '../core/lib/render.mjs'
import { hookDecision } from '../core/lib/guard.mjs'
import { config } from './helpers.mjs'

const workflow = readFileSync(new URL('../core/templates/ci.yml', import.meta.url), 'utf8')
const render = (mode) => fill(workflow, { ...templateVars(config({ verify: { mode, command: 'npm run verify' } }), { runtimeRel: '.ticketflow' }), runs_on_job: '    runs-on: ubuntu-latest', runs_on_deploy: '    runs-on: ubuntu-latest' })
const decision = (mode, command) => hookDecision({ tool_name: 'Bash', tool_input: { command } },
    config({ verify: { mode, command: 'npm run verify' } }), { cwd: '/tmp' })

test('tiered workflow defers drafts and checks local gate without duplicating full tests', () => {
    const yml = render('tiered')
    assert.match(yml, /ready_for_review/)
    assert.match(yml, /!github\.event\.pull_request\.draft/)
    assert.match(yml, /verify-route\.mjs/)
    assert.match(yml, /Validate Local Gate/)
    assert.match(yml, /issues: read/)
    assert.match(yml, /route=local/)
    assert.match(yml, /steps\.scope\.outputs\.route != 'local'/)
})
test('CI mode still runs normally and local mode skips the configured verification', () => {
    assert.doesNotMatch(render('ci'), /verify-route\.mjs|Validate Local Gate/)
    const local = render('local')
    assert.doesNotMatch(local, /verify-route\.mjs|Validate Local Gate/)
    assert.match(local, /ready_for_review/)
    assert.match(local, /route=local/)
    assert.match(local, /steps\.scope\.outputs\.skip != 'true'/)
    assert.match(local, /if: steps\.scope\.outputs\.skip != 'true'/)
})
test('verification guidance remains adapter-agnostic and does not police application commands', () => {
    for (const mode of ['ci', 'tiered']) {
        assert.equal(decision(mode, 'npm run verify').block, false)
        assert.equal(decision(mode, 'npm run test:domain').block, false)
    }
    assert.equal(decision('local', 'npm run verify').block, false)
})
