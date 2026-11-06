import test from 'node:test'
import assert from 'node:assert/strict'
import { verificationRoute, validGateSource, routeOfPull } from '../core/lib/verification.mjs'

const cfg = {
    repo: 'example/repo', verify: { mode: 'tiered' },
    review: { always_review: [] },
}
const pull = { title: 'Ticket #14', body: '', changed_files: 1,
    head: { repo: { full_name: 'example/repo' } }, base: { repo: { full_name: 'example/repo' } } }
const files = [{ filename: 'src/widgets.js', additions: 20, deletions: 10 }]
const issue = (labels = []) => ({ labels: labels.map((name) => ({ name })) })
test('normal and low tier may verify locally', () => {
    assert.equal(verificationRoute(cfg, pull, files, [issue()]).route, 'local')
    assert.equal(verificationRoute(cfg, pull, files, [issue(['Tier: Low'])]).route, 'local')
})
test('explicit local mode always selects the local gate without reading ticket metadata', () => {
    const local = { ...cfg, verify: { mode: 'local' } }
    const reads = []
    const read = (...args) => { reads.push(args); throw new Error('must not read route metadata') }
    assert.equal(verificationRoute(local, pull, null, null).route, 'local')
    assert.equal(routeOfPull(local, { ...pull, title: 'No ticket' }, 9, read).route, 'local')
    assert.deepEqual(reads, [])
})
test('explicit local mode cannot authorize a fork head', () => {
    const local = { ...cfg, verify: { mode: 'local' } }
    assert.equal(verificationRoute(local, { ...pull, head: { repo: { full_name: 'someone/fork' } } }, null, null).route, 'ci')
})
test('high, critical, security and verification-control paths require CI', () => {
    for (const label of ['Tier: High', 'Tier: Critical', 'Security', 'Needs: Decision'])
        assert.equal(verificationRoute(cfg, pull, files, [issue([label])]).route, 'ci')
    assert.equal(verificationRoute(cfg, pull, [{ ...files[0], filename: '.github/workflows/ci.yml' }], [issue()]).route, 'ci')
    assert.equal(verificationRoute(cfg, pull, [{ ...files[0], filename: '.ticketflow/config.json' }], [issue()]).route, 'ci')
    assert.equal(verificationRoute(cfg, pull, [{ ...files[0], filename: 'migrations/001_init.sql' }], [issue()]).route, 'local')  // repo-specific concern: agent should raise the Tier
    assert.equal(verificationRoute({ ...cfg, review: { always_review: [new RegExp('^src/')] } }, pull, files, [issue()]).route, 'local')  // app-specific review rules do not silently change CI routing
})
test('missing ticket, incomplete files, fork heads or labels fall back to CI', () => {
    assert.equal(verificationRoute(cfg, { ...pull, head: { repo: { full_name: 'someone/fork' } } }, files, [issue()]).route, 'ci')
    assert.equal(verificationRoute(cfg, { ...pull, title: 'No ticket' }, files, []).route, 'ci')
    assert.equal(verificationRoute(cfg, { ...pull, changed_files: 2 }, files, [issue()]).route, 'ci')
    assert.equal(verificationRoute(cfg, pull, [{ ...files[0], filename: '' }], [issue()]).route, 'ci')
    assert.equal(verificationRoute(cfg, pull, [{ ...files[0], filename: 7 }], [issue()]).route, 'ci')
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
