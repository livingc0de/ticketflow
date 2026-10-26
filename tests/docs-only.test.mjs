import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { docsOnly } from '../core/lib/docs-only.mjs'
import { config, tempDir, writeConfig } from './helpers.mjs'

const script = new URL('../core/lib/docs-only.mjs', import.meta.url).pathname

// A config shaped like a repo that keeps docs under docs/ and editor settings, and whose tests read some docs files.
const SHAPE_A = { docs_only: {
    docs: ['^(docs/|\\.claude/|\\.vscode/|\\.github/ISSUE_TEMPLATE/|\\.github/PULL_REQUEST_TEMPLATE\\.md$|[^/]+\\.md$)'],
    code: ['^(docs/(schema/|scripts/|SETTINGS\\.md$)|\\.claude/skills/x/run\\.sh$)'],
} }
// A config of the other shape: every markdown file is docs, except one that a test reads.
const SHAPE_B = { docs_only: { docs: ['\\.md$'], code: ['^docs/ANALYTICS\\.md$'] } }
const a = config(SHAPE_A), b = config(SHAPE_B)

test('docs paths are docs-only', () => {
    assert.equal(docsOnly(['docs/agents/ci.md', 'README.md', 'AGENTS.md', '.claude/skills/x/SKILL.md', '.vscode/settings.json',
        '.github/ISSUE_TEMPLATE/bug.yml', '.github/PULL_REQUEST_TEMPLATE.md', 'docs/plans/x.md'], a), true)
})

test('code, test-read docs and unknown paths are not docs-only, alone or mixed with docs', () => {
    for (const code of ['docs/schema/1.sql', 'docs/schema/migrations/x.sql', 'docs/scripts/x.sh', 'docs/SETTINGS.md', '.claude/skills/x/run.sh',
        'apps/web/README.md', 'scripts/ci/x.md', '.github/workflows/ci.yml', 'package-lock.json', '.npmrc', '.env.example', 'x.ts\nREADME.md']) {
        assert.equal(docsOnly([code], a), false, code)
        assert.equal(docsOnly(['docs/a.md', code], a), false, `docs/a.md + ${code}`)
    }
})

test('an empty list is code', () => {
    assert.equal(docsOnly([], a), false)
    assert.equal(docsOnly([], b), false)
})

test('a config of the other shape: any .md is docs, its code list wins', () => {
    assert.equal(docsOnly(['README.md', 'apps/web/README.md', 'docs/a.md'], b), true)
    assert.equal(docsOnly(['docs/ANALYTICS.md'], b), false)
    assert.equal(docsOnly(['README.md', 'docs/ANALYTICS.md'], b), false)
    assert.equal(docsOnly(['src/a.ts'], b), false)
    assert.equal(docsOnly(['docs/SETTINGS.md'], b), true)   // not code here: the lists are the config's, not built in
})

test('the floor stays code even when the config calls everything docs', () => {
    const all = config({ docs_only: { docs: ['^\\.', '.'] } })
    for (const floor of ['.ticketflow/config.json', '.ticketflow/skills/x.md', '.github/workflows/ci.yml']) assert.equal(docsOnly([floor], all), false, floor)
    assert.equal(docsOnly(['.github/ISSUE_TEMPLATE/x.yml', 'a.md'], all), true)   // only the floor paths are forced to code
    assert.equal(docsOnly(['a.md', '.github/workflows/ci.yml'], all), false)
})

test('a control character in a name is code', () => {
    const all = config({ docs_only: { docs: ['.'] } })
    for (const name of ['a\nb.md', 'a\u0000b', 'a\u007fb', 'a\tb']) assert.equal(docsOnly([name], all), false)
})

test('the CLI reads NUL-separated paths from stdin and takes --config', () => {
    const dir = tempDir()
    const conf = writeConfig(dir, SHAPE_A)
    const run = (input, args = ['--config', conf]) => spawnSync(process.execPath, [script, ...args], { input, encoding: 'utf8' })
    assert.equal(run('docs/a.md\0README.md\0').stdout, 'docs=true\n')
    assert.equal(run('docs/a.md\0apps/web/src/a.ts\0').stdout, 'docs=false\n')
    assert.equal(run('').stdout, 'docs=false\n')
})

test('the CLI with a missing or invalid config, or a bad flag, exits non-zero with empty stdout', () => {
    const dir = tempDir()
    const invalid = writeConfig(dir, { bogus: 1 })
    for (const args of [['--config', `${dir}/missing.json`], ['--config', invalid], ['--bogus'], ['extra']]) {
        const r = spawnSync(process.execPath, [script, ...args], { input: 'docs/a.md\0', encoding: 'utf8' })
        assert.notEqual(r.status, 0, args.join(' '))
        assert.equal(r.stdout, '')
        assert.match(r.stderr, /docs-only:/)
    }
})
