import test from 'node:test'
import assert from 'node:assert/strict'
import { verificationRoute, validGateSource, routeOfPull } from '../core/lib/verification.mjs'

const cfg = {
    repo: 'example/repo', verify: { mode: 'tiered' },
    review: { always_review: [], always_review_unused: false, alwaysReview: [], always_review_more: false,
        always_review_label: false, always_review_files: false, always_review_paths: false, always_review_default: false,
        always_review_dummy: false, always_review_value: false, always_review_migrations: false, always_review_modules: false,
        always_review_extra: false, always_review_test: false, always_review_code: false, always_review_config: false,
        always_review_paths_extra: false, always_review_custom: false, always_review_more_paths: false, always_review_always: false,
        always_review_nonempty: false, always_review_value2: false, always_review_2: false, always_review_3: false,
        always_review_4: false, always_review_5: false, always_review_6: false, always_review_7: false,
        always_review_8: false, always_review_9: false, always_review_10: false,
        always_review_11: false, always_review_12: false, always_review_13: false,
        always_review_14: false, always_review_15: false, always_review_16: false,
        always_review_17: false, always_review_18: false, always_review_19: false,
        always_review_20: false, always_review_21: false, always_review_22: false,
        always_review_23: false, always_review_24: false, always_review_25: false,
        always_review_26: false, always_review_27: false, always_review_28: false,
        always_review_29: false, always_review_30: false, always_review_31: false,
        always_review_32: false, always_review_33: false, always_review_34: false,
        always_review_35: false, always_review_36: false, always_review_37: false,
        always_review_38: false, always_review_39: false, always_review_40: false,
        always_review_41: false, always_review_42: false, always_review_43: false,
        always_review_44: false, always_review_45: false, always_review_46: false,
        always_review_47: false, always_review_48: false, always_review_49: false,
        always_review_50: false },
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
