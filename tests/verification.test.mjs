import test from 'node:test'
import assert from 'node:assert/strict'
import { verificationRoute, validGateSource, routeOfPull } from '../core/lib/verification.mjs'

const cfg = {
    repo: 'example/repo', verify: { mode: 'tiered' },
    review: { always_review: [] },
}
const pull = { title: 'Ticket #14', body: '', changed_files: 1 }
const files = [{ filename: 'src/widgets.js', additions: 20, deletions: 10 }]
const issue = (labels = []) => ({ labels: labels.map((name) => ({ name })) })
test('normal and low tier may verify locally', () => {
    assert.equal(verificationRoute(cfg, pull, files, [issue()]).route, 'local')
    assert.equal(verificationRoute(cfg, pull, files, [issue(['Tier: Low'])]).route, 'local')
})
test('high, critical, security and sensitive paths require CI', () => {
    for (const label of ['Tier: High', 'Tier: Critical', 'Security', 'Needs: Decision'])
        assert.equal(verificationRoute(cfg, pull, files, [issue([label])]).route, 'ci')
    assert.equal(verificationRoute(cfg, pull, [{ ...files[0], filename: '.github/workflows/ci.yml' }], [issue()]).route, 'ci')
    assert.equal(verificationRoute(cfg, pull, [{ ...files[0], filename: '.ticketflow/config.json' }], [issue()]).route, 'ci')
    assert.equal(verificationRoute({ ...cfg, review: { always_review: [/^src\\//] } }, pull, files, [issue()]).route, 'ci')
})
test('missing ticket, incomplete files or labels fall back to CI', () => {
    assert.equal(verificationRoute(cfg, { ...pull, title: 'No ticket' }, files, []).route, 'ci')
    assert.equal(verificationRoute(cfg, { ...pull, changed_files: 2 }, files, [issue()]).route, 'ci')
    assert.equal(verificationRoute(cfg, pull, files, [{ ...issue(), labels: null }]).route, 'ci')
})
test('status source follows route, including explicit CI fallback', () => {
    assert.equal(validGateSource('local', 'Local run on myhost (x64, Node 24)'), true)
    assert.equal(validGateSource('local', 'Actions run #100'), false)
    assert.equal(validGateSource('ci', 'Actions run #100'), true)
    assert.equal(validGateSource('ci', 'Local run on myhost'), false)
    assert.equal(validGateSource('ci', 'Local fallback run on myhost'), true)
    assert.equal(validGateSource('ci', 'Inherited from 123abcd: docs only'), false)
})
test('route reads all tickets and file list, failing closed on missing data', () => {
    const reads = []
    const read = (path, opts) => {
        reads.push([path, opts])
        if (path.endsWith('/files')) return files
        if (path.endsWith('/14')) return issue()
        throw new Error('unreadable')
    }
    assert.equal(routeOfPull(cfg, pull, 9, read).route, 'local')
    assert.equal(reads[0][0], 'repos/example/repo/pulls/9/files')
    assert.deepEqual(reads[0][1], { paginate: true })
    assert.throws(() => routeOfPull(cfg, { ...pull, title: 'Ticket #21' }, 9, read))
})
