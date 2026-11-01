import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fakeGh, tempDir, writeConfig, config } from './helpers.mjs'
import { minimumLane } from '../core/lib/risk.mjs'

const f = (filename, additions = 1, deletions = 0, extra = {}) => ({ filename, additions, deletions, ...extra })
const lane = (files, labels = [], over = {}) => minimumLane(files, labels, config(over))
const review = (files, labels, over) => { const r = lane(files, labels, over); assert.equal(r.lane, 'review', JSON.stringify(r)); return r }
const selfCheck = (files, labels, over) => { const r = lane(files, labels, over); assert.equal(r.lane, 'self-check', JSON.stringify(r)); return r }

test('small code with a test, a big test next to small code and a docs-only PR are self-check eligible', () => {
    selfCheck([f('src/a.js', 20, 5), f('tests/a.test.mjs', 30)])
    selfCheck([f('src/a.js', 3), f('tests/a.test.mjs', 500, 200)])   // tests never count toward the size
    selfCheck([f('README.md', 900, 100)], [], { docs_only: { docs: ['\\.md$'] } })   // docs never count either
    selfCheck([f('src/a.js', 5), f('.github/ISSUE_TEMPLATE/x.yml')])   // only .github/workflows is the floor
})

test('size: too many code files, too many code lines, untested code', () => {
    review([1, 2, 3, 4, 5].map((i) => f(`src/${i}.js`)).concat(f('tests/x.test.mjs')))
    const lines = review([f('src/a.js', 70, 11), f('tests/a.test.mjs')])
    assert.equal(lines.size, true)
    const untested = review([f('src/a.js', 11)])
    assert.match(untested.reasons[0], /no test file touched/)
    selfCheck([f('src/a.js', 11)], [], { review: { self_check_untested_lines: null } })
    selfCheck([f('src/a.js', 10)])   // at the limit
    selfCheck([f('src/a.js', 80), f('tests/a.test.mjs')])
    review([f('src/a.js', 81), f('tests/a.test.mjs')])
})

test('paths: the built-in floor, the default always_review list, and the config replacing the list', () => {
    for (const path of ['.github/workflows/ci.yml', '.ticketflow/config.json', '.env.local', 'app/.env']) {
        const r = review([f(path), f('tests/a.test.mjs')])
        assert.equal(r.size, false)
        assert.match(r.reasons[0], /always needs a review/)
    }
    for (const path of ['package.json', 'web/package-lock.json', 'go.sum', 'db/migrations/1.sql', 'x/migration/2.ts', 'schema.sql']) review([f(path), f('tests/a.test.mjs')])
    selfCheck([f('package.json'), f('tests/a.test.mjs')], [], { review: { always_review: [] } })   // the owner may drop the defaults
    review([f('.github/workflows/ci.yml')], [], { review: { always_review: [] } })   // ... but never the floor
    review([f('src/auth/login.js'), f('tests/a.test.mjs')], [], { review: { always_review: ['^src/auth/'] } })
    review([f('src/new.js', 1, 0, { previous_filename: '.github/workflows/old.yml' })])   // a rename from a floor path
})

test('labels, self_check off', () => {
    const files = [f('src/a.js'), f('tests/a.test.mjs')]
    review(files, ['Security']); review(files, ['Needs: Decision']); review(files, ['Needs: Design'])
    selfCheck(files, ['Type: Task', 'Area: Scripts'])
    const off = review(files, [], { review: { self_check: false } })
    assert.equal(off.size, false)
})

function cli(pulls, { files = [f('src/a.js'), f('tests/a.test.mjs')], body = 'Ticket #7', labels = [], config: over, filesFixture } = {}) {
    const dir = tempDir('risk-')
    const gh = fakeGh(dir, {
        'repos/o/r/pulls/5': pulls ?? { body, changed_files: files.length },
        'repos/o/r/pulls/5/files': filesFixture ?? files, 'repos/o/r/issues/7': { labels: labels.map((name) => ({ name })) },
    })
    return spawnSync(process.execPath, [new URL('../core/scripts/risk.mjs', import.meta.url).pathname, '5', '--config', writeConfig(dir, over)], { encoding: 'utf8', env: gh.env, cwd: dir })
}

test('risk.mjs prints the lane and a Reason line each; exit 2 on a read error or bad usage', () => {
    const ok = cli()
    assert.equal(ok.status, 0, ok.stderr); assert.equal(ok.stdout, 'Lane: self-check\n')
    const sec = cli(undefined, { labels: ['Security'], files: [f('package.json'), f('tests/a.test.mjs')] })
    assert.equal(sec.stdout, 'Lane: review\nReason: label Security\nReason: path package.json always needs a review\n')
    assert.match(cli(undefined, { body: 'no ticket here' }).stdout, /^Lane: review\nReason: no "Ticket #N" in the PR body/)
    assert.match(cli({ body: 'Ticket #7', changed_files: 5 }).stdout, /the file list is incomplete/)
    const bad = cli({ __status: 404, __stderr: 'nope' })
    assert.equal(bad.status, 2); assert.equal(bad.stdout, '')
    assert.equal(spawnSync(process.execPath, [new URL('../core/scripts/risk.mjs', import.meta.url).pathname, 'x'], { encoding: 'utf8' }).status, 2)
})
