import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PRACTICES } from '../core/lib/config.mjs'
import { parseCanonical } from '../core/lib/stubs.mjs'

const NO_SKILL = new Set(['domain-guides', 'deploy-gating', 'analytics-events'])
const NO_PR = new Set(['deploy-gating'])
const DOUBLE_RULES = new Set(['database'])   // the one practice with two AGENTS lines
const WHITELIST = new Set(['README.md', 'SKILL.md', 'agents-rules.md', 'pr-checklist.md'])
const dir = new URL('../practices/', import.meta.url).pathname
const read = (n, f) => readFileSync(join(dir, n, f), 'utf8')
const lines = (t) => t.replace(/\n$/, '').split('\n')

test('the practice folders are exactly the known practices', () => {
    assert.deepEqual(readdirSync(dir).sort(), [...PRACTICES].sort())
})

test('each folder holds only whitelisted files, and the ones its practice needs', () => {
    for (const n of PRACTICES) {
        const files = readdirSync(join(dir, n))
        for (const f of files) assert.ok(WHITELIST.has(f), `${n}/${f}`)
        assert.ok(files.includes('README.md'), `${n}/README.md`)
        assert.ok(files.includes('agents-rules.md'), `${n}/agents-rules.md`)
        assert.equal(files.includes('SKILL.md'), !NO_SKILL.has(n), `${n}/SKILL.md`)
        assert.equal(files.includes('pr-checklist.md'), !NO_PR.has(n), `${n}/pr-checklist.md`)
    }
})

test('README frontmatter is strict key: value with name, summary, question and detect', () => {
    for (const n of PRACTICES) {
        const m = /^---\n([\s\S]*?)\n---\n/.exec(read(n, 'README.md'))
        assert.ok(m, `${n}: frontmatter`)
        const fm = {}
        for (const line of m[1].split('\n')) {
            const kv = /^([a-z]+): (\S.*)$/.exec(line)
            assert.ok(kv, `${n}: bad frontmatter line ${JSON.stringify(line)}`)
            assert.ok(!Object.hasOwn(fm, kv[1]), `${n}: duplicate ${kv[1]}`)
            fm[kv[1]] = kv[2]
        }
        assert.deepEqual(Object.keys(fm).sort(), ['detect', 'name', 'question', 'summary'], n)
        assert.equal(fm.name, n)
        assert.ok(fm.summary.length <= 200, `${n}: summary is ${fm.summary.length} characters`)
        assert.ok(fm.question.endsWith('?'), `${n}: question`)
    }
})

test('README has Origin, SKILL has Done when, and line budgets hold', () => {
    for (const n of PRACTICES) {
        const readme = read(n, 'README.md')
        assert.match(readme, /\n## What enabling it adds\n/, `${n}: What enabling it adds`)
        assert.match(readme, /\n## Extend it\n/, `${n}: Extend it`)
        assert.match(readme, /\n## Origin\n\nDistilled from two production monorepos\.\n$/, `${n}: Origin`)
        assert.ok(lines(readme).length <= (n === 'analytics-events' ? 40 : 60), `${n}/README.md: ${lines(readme).length} lines`)
        if (NO_SKILL.has(n)) continue
        const skill = read(n, 'SKILL.md')
        assert.ok(lines(skill).length <= 80, `${n}/SKILL.md: ${lines(skill).length} lines`)
        assert.match(skill, /\n## Done when\n/, `${n}: Done when`)
        assert.match(skill, /\n## Stack notes\n/, `${n}: Stack notes`)
        assert.match(skill, new RegExp(`^---\\n[\\s\\S]*?\\n---\\n\\n# [^\\n]+\\n\\nRead \`\\.ticketflow/custom/${n}\\.md\` first`), `${n}: opening line`)
    }
})

test('each README and SKILL names its custom extension file', () => {
    for (const n of PRACTICES) for (const f of ['README.md', 'SKILL.md']) {
        if (existsSync(join(dir, n, f))) assert.ok(read(n, f).includes(`.ticketflow/custom/${n}.md`), `${n}/${f}`)
    }
})

test('each SKILL parses as a canonical skill (name is the folder, "Use when" description of at most 300 characters)', () => {
    for (const n of PRACTICES.filter((x) => !NO_SKILL.has(x))) {
        const skill = parseCanonical(read(n, 'SKILL.md'), `practices/${n}/SKILL.md`)
        assert.equal(skill.name, n)
    }
})

test('snippet files have the right line formats', () => {
    for (const n of PRACTICES) {
        const rules = lines(read(n, 'agents-rules.md'))
        assert.equal(rules.length, DOUBLE_RULES.has(n) ? 2 : 1, `${n}: agents-rules lines`)
        for (const l of rules) assert.match(l, /^- \S/, `${n}: ${l}`)
        if (NO_PR.has(n)) continue
        const pr = lines(read(n, 'pr-checklist.md'))
        assert.equal(pr.length, 1, `${n}: pr-checklist lines`)
        for (const l of pr) assert.match(l, /^- \[ \] \S/, `${n}: ${l}`)
    }
})

test('snippets that point at a practice file point at one that exists', () => {
    for (const n of PRACTICES) for (const [, p] of read(n, 'agents-rules.md').matchAll(/`\.ticketflow\/practices\/([\w/.-]+)`/g)) {
        assert.ok(existsSync(join(dir, p)), `${n}: ${p}`)
    }
})

test('no issue references', () => {
    for (const n of PRACTICES) for (const f of readdirSync(join(dir, n))) assert.doesNotMatch(read(n, f), /#\d+/, `${n}/${f}`)
})
