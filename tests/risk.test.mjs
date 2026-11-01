import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fakeGh, tempDir, writeConfig, config } from './helpers.mjs'
import { alwaysReviewHit, minimumLane } from '../core/lib/risk.mjs'
import { loadConfig } from '../core/lib/config.mjs'

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
    for (const path of ['.github/workflows/ci.yml', '.ticketflow/config.json', '.env.local', 'app/.env', '.claude/settings.json', '.codex/rules/x.rules', 'AGENTS.md', 'docs/CLAUDE.md', '.github/copilot-instructions.md', '.github/agents/x.md', 'x/.claude-plugin/plugin.json', 'gemini-extension.json']) {
        const r = review([f(path), f('tests/a.test.mjs')])
        assert.equal(r.size, false)
        assert.match(r.reasons[0], /always needs a review/)
    }
    for (const path of ['package.json', 'web/package-lock.json', 'go.sum', 'db/migrations/1.sql', 'x/migration/2.ts', 'schema.sql']) review([f(path), f('tests/a.test.mjs')])
    selfCheck([f('package.json'), f('tests/a.test.mjs')], [], { review: { always_review: [] } })   // the owner may drop the defaults
    review([f('.github/workflows/ci.yml')], [], { review: { always_review: [] } })   // ... but never the floor
    review([f('src/auth/login.js'), f('tests/a.test.mjs')], [], { review: { always_review: ['^src/auth/'] } })
    review([f('core/lib/config.mjs'), f('tests/a.test.mjs')], [], { review: { always_review: ['^core/(lib|scripts)/'] } })   // a repo whose runtime lives in core/
    review([f('src/new.js', 1, 0, { previous_filename: '.github/workflows/old.yml' })])   // a rename from a floor path
})

test('labels, self_check off', () => {
    const files = [f('src/a.js'), f('tests/a.test.mjs')]
    review(files, ['Security']); review(files, ['Needs: Decision']); review(files, ['Needs: Design'])
    selfCheck(files, ['Type: Task', 'Area: Scripts'])
    const off = review(files, [], { review: { self_check: false } })
    assert.equal(off.size, false)
})

function cli(pulls, { files = [f('src/a.js'), f('tests/a.test.mjs')], body = 'Ticket #7', labels = [], config: over, filesFixture, extra = {} } = {}) {
    const dir = tempDir('risk-')
    const gh = fakeGh(dir, {
        'repos/o/r/pulls/5': pulls ?? { body, changed_files: files.length },
        'repos/o/r/pulls/5/files': filesFixture ?? files, 'repos/o/r/issues/7': { labels: labels.map((name) => ({ name })) }, ...extra,
    })
    return spawnSync(process.execPath, [new URL('../core/scripts/risk.mjs', import.meta.url).pathname, '5', '--config', writeConfig(dir, over)], { encoding: 'utf8', env: gh.env, cwd: dir })
}

test('risk.mjs prints the lane and a Reason line each; exit 2 on a read error or bad usage', () => {
    const ok = cli()
    assert.equal(ok.status, 0, ok.stderr); assert.equal(ok.stdout, 'Lane: self-check\n')
    const sec = cli(undefined, { labels: ['Security'], files: [f('package.json'), f('tests/a.test.mjs')] })
    assert.equal(sec.stdout, 'Lane: review\nReason: label Security\nReason: path package.json always needs a review\n')
    assert.match(cli(undefined, { body: 'no ticket here' }).stdout, /^Lane: review\nReason: no "Ticket #N" in the PR title or body/)
    assert.match(cli({ body: 'Ticket #7', changed_files: 5 }).stdout, /the file list is incomplete/)
    const two = cli(undefined, { body: 'Ticket #7 and Ticket #8', extra: { 'repos/o/r/issues/8': { labels: [{ name: 'Needs: Decision' }] } } })
    assert.equal(two.stdout, 'Lane: review\nReason: label Needs: Decision\n')
    assert.match(cli(undefined, { extra: { 'repos/o/r/issues/7': { labels: [], pull_request: {} } } }).stdout, /Reason: #7 is a pull request, not a ticket/)
    const bad = cli({ __status: 404, __stderr: 'nope' })
    assert.equal(bad.status, 2); assert.equal(bad.stdout, '')
    assert.equal(spawnSync(process.execPath, [new URL('../core/scripts/risk.mjs', import.meta.url).pathname, 'x'], { encoding: 'utf8' }).status, 2)
})

test('fail closed: unreadable entries, code renamed into tests, binary changes, several tickets', () => {
    for (const bad of [{ filename: 'src/a.js' }, { filename: 7, additions: 1, deletions: 0 }, { filename: 'src/a.js', additions: '1', deletions: 0 }]) {
        const r = review([bad, f('tests/a.test.mjs')])
        assert.deepEqual([r.reasons, r.size], [['the file list is unreadable'], false])
    }
    // production code renamed into a test path keeps counting; a real test or docs file does not
    const renamed = review([f('tests/parser.test.js', 500, 500, { previous_filename: 'src/parser.js', status: 'renamed' }), f('src/b.js', 2)])
    assert.equal(renamed.size, true)
    selfCheck([f('tests/b.test.js', 500, 500, { previous_filename: 'tests/a.test.js', status: 'renamed' }), f('src/b.js', 2)])
    const bin = review([f('assets/logo.png', 0, 0, { status: 'modified' }), f('tests/a.test.mjs')])
    assert.deepEqual([bin.size, bin.reasons.length], [false, 1])
    review([f('assets/new.png', 0, 0, { status: 'added' }), f('tests/a.test.mjs')])
    selfCheck([f('assets/logo.png', 0, 0, { status: 'renamed', previous_filename: 'assets/old.png' }), f('tests/a.test.mjs')])
    // code renamed into a test path is not a test that covers the change
    assert.match(review([f('src/b.js', 20), f('tests/p.test.js', 1, 0, { previous_filename: 'src/p.js', status: 'renamed' })]).reasons.join(), /no test file touched/)
    assert.equal(alwaysReviewHit(f('x.js', 1, 0, { previous_filename: 'package.json' }), config()), 'package.json')
    assert.equal(alwaysReviewHit(f('src/a.js'), config()), undefined)
})

test('deleted test lines do not count toward the size (writing and trimming tests is free: documented in REVIEWERS.md)', () => {
    selfCheck([f('src/a.js', 2), f('tests/a.test.mjs', 0, 900)])
})

test('this repo\'s own config puts its whole runtime (core/) behind a review, defaults included', () => {
    const own = loadConfig(new URL('../.ticketflow/config.json', import.meta.url).pathname)
    for (const path of ['core/lib/config.mjs', 'core/scripts/merge.mjs', 'core/skills/implement-ticket/SKILL.md', 'core/agents/pr-reviewer.md', 'core/templates/config.json', 'package.json']) {
        assert.equal(minimumLane([f(path), f('tests/a.test.mjs')], [], own).lane, 'review', path)
    }
    assert.equal(minimumLane([f('README.md', 3), f('tests/a.test.mjs')], [], own).lane, 'self-check')
})
