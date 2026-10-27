import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { FAIL, fakeGh, tempDir } from './helpers.mjs'

const script = new URL('../tools/upstream-review.mjs', import.meta.url).pathname
const root = new URL('..', import.meta.url).pathname
const SHA_A = '2ce8aa15d05bd57213e6f746f953aafb7ded7a8b', SHA_B = '09c434ab73ca43761c5d8b0c5d341926c2fba710'
const HEAD_A = 'a'.repeat(40), HEAD_B = 'b'.repeat(40)
const baseline = {
    reviewed_on: '2026-10-27',
    upstreams: [
        { repo: 'up/alpha', branch: 'main', sha: SHA_A, tag: 'v7.0.1', license: 'MIT' },
        { repo: 'up/beta', branch: 'main', sha: SHA_B, tag: 'v5.3.2', license: 'MIT' },
    ],
}
const repoMap = (r, sha, head, { license = 'MIT', releases = [], files = [] } = {}) => ({
    [`repos/${r}`]: { license: { spdx_id: license } },
    [`repos/${r}/commits/main`]: { sha: head },
    [`repos/${r}/releases?per_page=20`]: releases,
    ...(head === sha ? {} : { [`repos/${r}/compare/${sha}...${head}`]: { ahead_by: files.length, files: files.map((filename) => ({ filename })) } }),
})
const unchanged = { ...repoMap('up/alpha', SHA_A, SHA_A), ...repoMap('up/beta', SHA_B, SHA_B) }
const rel = (tag, extra = {}) => ({ tag_name: tag, html_url: `https://example.test/${tag}`, published_at: '2026-11-01T00:00:00Z', draft: false, ...extra })

function run(map, { args = [], base = baseline } = {}) {
    const dir = tempDir('upstream-')
    const file = join(dir, 'upstream.json')
    const text = typeof base === 'string' ? base : JSON.stringify(base)
    writeFileSync(file, text)
    const gh = fakeGh(dir, map)
    const r = spawnSync(process.execPath, [script, '--baseline', file, ...args], { encoding: 'utf8', env: gh.env })
    return { ...r, gh, dir, file, text, after: readFileSync(file, 'utf8'), left: readdirSync(dir).filter((f) => f.startsWith('upstream')) }
}

test('unchanged upstreams exit 0 and write nothing', () => {
    const r = run(unchanged)
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /up\/alpha: unchanged/)
    assert.equal(r.after, r.text)
    assert.deepEqual(r.left, ['upstream.json'])
    assert.ok(r.gh.calls().every((c) => c[0] === 'api' && !c.some((a) => /issue|-X\s*(POST|PUT|PATCH|DELETE)/.test(a))))
})

test('changes exit 1 with the release list and the file groups; a LICENSE change is flagged', () => {
    const files = ['skills/debugging/SKILL.md', 'skills/debugging/notes.md', 'skills/tdd/SKILL.md', 'agents/reviewer.md', 'docs/a.md', 'benchmarks/results/run1.json', 'README.md', 'LICENSE']
    const r = run({
        ...repoMap('up/alpha', SHA_A, HEAD_A, { files, releases: [rel('v7.1.0'), rel('v7.0.2', { draft: true }), rel('v7.0.1'), rel('v7.0.0')] }),
        ...repoMap('up/beta', SHA_B, SHA_B),
    })
    assert.equal(r.status, 1, r.stderr)
    assert.match(r.stdout, /up\/alpha: 8 commits? ahead|up\/alpha: 8 /)
    assert.match(r.stdout, /v7\.1\.0/)
    assert.doesNotMatch(r.stdout, /v7\.0\.2|v7\.0\.0/, 'drafts and releases at or before the baseline tag are not listed')
    for (const g of ['skills/debugging: 2', 'skills/tdd: 1', 'agents: 1', 'docs: 1', 'benchmarks/results: 1', 'other: 2']) assert.ok(r.stdout.includes(g), g)
    assert.match(r.stdout, /LICENSE file changed/)
    assert.match(r.stdout, /up\/beta: unchanged/)
    assert.equal(r.after, r.text, 'no --record, no write')
})

test('a changed license identifier is flagged even without new commits', () => {
    const r = run({ ...repoMap('up/alpha', SHA_A, SHA_A, { license: 'Apache-2.0' }), ...repoMap('up/beta', SHA_B, SHA_B) })
    assert.equal(r.status, 1)
    assert.match(r.stdout, /license changed: MIT -> Apache-2\.0/)
})

test('a failed read exits 2 and writes nothing, even with --record', () => {
    const map = { ...repoMap('up/alpha', SHA_A, HEAD_A, { files: ['docs/a.md'] }), ...repoMap('up/beta', SHA_B, HEAD_B, { files: ['docs/b.md'] }) }
    map[`repos/up/beta/compare/${SHA_B}...${HEAD_B}`] = FAIL
    const r = run(map, { args: ['--record'] })
    assert.equal(r.status, 2)
    assert.match(r.stderr, /upstream-review: /)
    assert.equal(r.after, r.text)
    assert.deepEqual(r.left, ['upstream.json'])
})

test('--record writes the heads, the newest release tag and today atomically, after every read succeeded', () => {
    const r = run({
        ...repoMap('up/alpha', SHA_A, HEAD_A, { files: ['docs/a.md'], releases: [rel('v7.1.0'), rel('v7.0.1')], license: 'MIT' }),
        ...repoMap('up/beta', SHA_B, HEAD_B, { files: ['docs/b.md'], releases: [rel('v5.3.2')] }),
    }, { args: ['--record'] })
    assert.equal(r.status, 0, r.stderr)
    const got = JSON.parse(r.after)
    assert.match(got.reviewed_on, /^\d{4}-\d\d-\d\d$/)
    assert.equal(got.reviewed_on, new Date().toISOString().slice(0, 10))
    assert.deepEqual(got.upstreams.map((u) => [u.repo, u.sha, u.tag, u.license]), [['up/alpha', HEAD_A, 'v7.1.0', 'MIT'], ['up/beta', HEAD_B, 'v5.3.2', 'MIT']])
    assert.deepEqual(r.left, ['upstream.json'], 'no temp file is left behind')
    assert.ok(r.after.endsWith('\n'))
})

test('an invalid baseline exits 2 before any call', () => {
    const bad = [
        'not json',
        { ...baseline, reviewed_on: 'yesterday' },
        { ...baseline, upstreams: [] },
        { ...baseline, upstreams: [{ ...baseline.upstreams[0], repo: 'up/alpha;rm' }] },
        { ...baseline, upstreams: [{ ...baseline.upstreams[0], repo: '../etc' }] },
        { ...baseline, upstreams: [{ ...baseline.upstreams[0], sha: 'abc123' }] },
        { ...baseline, upstreams: [{ ...baseline.upstreams[0], branch: 'a b' }] },
        { ...baseline, upstreams: [{ ...baseline.upstreams[0], license: '' }] },
        { ...baseline, upstreams: [{ ...baseline.upstreams[0], tag: undefined }] },
    ]
    for (const base of bad) {
        const r = run(unchanged, { base, args: ['--record'] })
        assert.equal(r.status, 2, JSON.stringify(base))
        assert.deepEqual(r.gh.calls(), [], JSON.stringify(base))
        assert.equal(r.after, r.text)
    }
})

test('a missing baseline file and unknown options exit 2 before any call', () => {
    const dir = tempDir('upstream-')
    const gh = fakeGh(dir, unchanged)
    for (const args of [['--baseline', join(dir, 'nope.json')], ['--bogus']]) {
        const r = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: gh.env })
        assert.equal(r.status, 2, args.join(' '))
    }
    assert.deepEqual(gh.calls(), [])
})

test('the committed baseline is this audit, and the procedure is short and starts with "Use when"', () => {
    const b = JSON.parse(readFileSync(join(root, 'docs/maintainers/upstream.json'), 'utf8'))
    assert.deepEqual(b, {
        reviewed_on: '2026-10-27',
        upstreams: [
            { repo: 'obra/superpowers', branch: 'main', sha: SHA_A, tag: 'v7.0.1', license: 'MIT' },
            { repo: 'dietrichgebert/ponytail', branch: 'main', sha: SHA_B, tag: 'v5.3.2', license: 'MIT' },
        ],
    })
    const lines = readFileSync(join(root, 'docs/maintainers/upstream-review.md'), 'utf8').trimEnd().split('\n')
    assert.ok(lines.length <= 40, `${lines.length} lines`)
    assert.match(lines[0], /^Use when/)
})
