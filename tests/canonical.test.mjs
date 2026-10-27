import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseCanonical } from '../core/lib/stubs.mjs'

const core = new URL('../core/', import.meta.url).pathname
const ls = (dir) => (existsSync(join(core, dir)) ? readdirSync(join(core, dir)) : [])
// the canonical prose: skills (every .md under skills/<n>/) and roles, each with its own `.ticketflow/custom/<name>.md` and line budget
const prose = [
    ...ls('skills').flatMap((n) => ls(`skills/${n}`).filter((f) => f.endsWith('.md')).map((f) => ({ path: `skills/${n}/${f}`, custom: f === 'SKILL.md' ? n : f.replace(/\.md$/, ''), max: { 'implement-ticket/SKILL.md': 130, 'implement-ticket/post-merge.md': 60, 'create-ticket/SKILL.md': 90 }[`${n}/${f}`] ?? 130 }))),
    ...ls('agents').map((f) => ({ path: `agents/${f}`, custom: f.replace(/\.md$/, ''), max: 80 })),
]
// the optional practices (practices/<n>/*.md at the repo root) follow the same two rules as the core prose
const practicesDir = new URL('../practices/', import.meta.url).pathname
const practiceFiles = existsSync(practicesDir) ? readdirSync(practicesDir).flatMap((n) => readdirSync(join(practicesDir, n)).map((f) => join(practicesDir, n, f))) : []
const maps = ls('agents-map').map((f) => ({ path: `agents-map/${f}`, max: 40 }))
const text = (p) => readFileSync(join(core, p), 'utf8')

test('there are canonical skills and roles to check', () => {
    for (const p of ['skills/implement-ticket/SKILL.md', 'skills/implement-ticket/post-merge.md', 'skills/create-ticket/SKILL.md', 'agents/ticket-planner.md', 'agents/pr-reviewer.md', 'agents/e2e-verifier.md', 'agents-map/claude.md', 'agents-map/codex.md', 'agents-map/generic.md']) assert.ok(prose.some((x) => x.path === p) || maps.some((x) => x.path === p), p)
})

test('skills and roles name actions, never one agent\'s tools', () => {
    const tools = /spawn_agent|subagent_type|TodoWrite|TaskCreate|run_in_background|AskUserQuestion|update_plan|Agent tool|Skill tool|Plan Mode/
    for (const { path } of prose) assert.doesNotMatch(text(path), tools, path)
    assert.ok(practiceFiles.length >= 10)
    for (const file of practiceFiles) assert.doesNotMatch(readFileSync(file, 'utf8'), tools, file)
})

test('no gh form that a script covers', () => {
    const covered = /gh issue view|gh project |sub_issues|gh pr merge|\/statuses\/|updateProjectV2|gh api [^\n]*issues\/(\d+|<[^>]*>|\$)|gh label/
    for (const { path } of prose) assert.doesNotMatch(text(path), covered, path)
    for (const file of practiceFiles) assert.doesNotMatch(readFileSync(file, 'utf8'), covered, file)
})

test('every script, skill and role path a file names exists in core/', () => {
    for (const { path } of [...prose, ...maps]) {
        for (const [, kind, name] of text(path).matchAll(/\.ticketflow\/(scripts|skills|agents|agents-map)\/([\w<>/.-]+?)(?=[\s`'"),;:]|\.$|$)/g)) {
            if (name.includes('<')) continue
            assert.ok(existsSync(join(core, kind, name)), `${path}: .ticketflow/${kind}/${name}`)
        }
    }
    for (const file of practiceFiles) {
        for (const [, kind, name] of readFileSync(file, 'utf8').matchAll(/\.ticketflow\/(scripts|skills|agents|agents-map)\/([\w<>/.-]+?)(?=[\s`'"),;:]|\.$|$)/g)) {
            if (!name.includes('<')) assert.ok(existsSync(join(core, kind, name)), `${file}: .ticketflow/${kind}/${name}`)
        }
    }
})

test('the core prose and practices rely on no external skill or plugin being installed', () => {
    const reliance = /(when|if)[^.\n]{0,40}\binstalled\b|superpowers/i
    for (const { path } of prose) assert.doesNotMatch(text(path), reliance, path)
    for (const file of practiceFiles) assert.doesNotMatch(readFileSync(file, 'utf8'), reliance, file)
})

test('every skill, role and map stays within the 20,000-byte budget', () => {
    for (const { path } of [...prose, ...maps]) assert.ok(Buffer.byteLength(text(path)) <= 20000, `${path}: ${Buffer.byteLength(text(path))} bytes`)
    for (const file of practiceFiles) assert.ok(Buffer.byteLength(readFileSync(file, 'utf8')) <= 20000, file)
})

test('each file names its own custom extension file', () => {
    for (const { path, custom } of prose) assert.ok(text(path).includes(`.ticketflow/custom/${custom}.md`), `${path} -> custom/${custom}.md`)
})

test('line budgets', () => {
    for (const { path, max } of [...prose, ...maps]) {
        const lines = text(path).replace(/\n$/, '').split('\n').length
        assert.ok(lines <= max, `${path}: ${lines} lines, at most ${max}`)
    }
})

// ---- the front door: START.md and the root skills (init, sync), which the plugins expose
const root = new URL('../', import.meta.url).pathname
const rootText = (p) => readFileSync(join(root, p), 'utf8')
const FRONT = { 'START.md': 40, 'skills/init/SKILL.md': 80, 'skills/init/interview.md': 80, 'skills/init/new-repo.md': 40, 'skills/init/existing-repo.md': 80, 'skills/init/github.md': 60, 'skills/init/checks.md': 50, 'skills/sync/SKILL.md': 70 }

test('the front door files exist and stay within their line budgets', () => {
    for (const [path, max] of Object.entries(FRONT)) {
        const lines = rootText(path).replace(/\n$/, '').split('\n').length
        assert.ok(lines <= max, `${path}: ${lines} lines, at most ${max}`)
    }
    for (const n of ['init', 'sync']) assert.deepEqual(readdirSync(join(root, 'skills', n)).filter((f) => `skills/${n}/${f}` in FRONT).length, readdirSync(join(root, 'skills', n)).length, `skills/${n} holds only budgeted files`)
})

test('the init and sync skills parse as skills: name is the directory, a "Use when" description of at most 300 characters', () => {
    for (const n of ['init', 'sync']) assert.equal(parseCanonical(rootText(`skills/${n}/SKILL.md`), `skills/${n}/SKILL.md`).name, n)
})

test('the front door names actions, never one agent\'s tools, and no gh form that a script covers', () => {
    const tools = /spawn_agent|subagent_type|TodoWrite|TaskCreate|run_in_background|AskUserQuestion|update_plan|Agent tool|Skill tool|Plan Mode/
    const covered = /gh issue view|gh project |sub_issues|gh pr merge|\/statuses\/|updateProjectV2|gh api [^\n]*issues\/(\d+|<[^>]*>|\$)|gh label/
    for (const path of Object.keys(FRONT)) { assert.doesNotMatch(rootText(path), tools, path); assert.doesNotMatch(rootText(path), covered, path) }
})

test('every script and lib the front door names exists', () => {
    for (const path of Object.keys(FRONT)) {
        for (const [, kind, name] of rootText(path).matchAll(/(?:core|\.ticketflow)\/(scripts|lib)\/([\w-]+\.mjs)/g)) assert.ok(existsSync(join(core, kind, name)), `${path}: ${kind}/${name}`)
    }
})

test('every part file of init is referenced by its SKILL.md and exists; START.md names both skills; both skills hand over to the clone\'s own copy', () => {
    const skill = rootText('skills/init/SKILL.md')
    for (const f of readdirSync(join(root, 'skills/init')).filter((x) => x !== 'SKILL.md')) assert.ok(skill.includes(`\`${f}\``), `skills/init/SKILL.md does not reference ${f}`)
    for (const [, f] of skill.matchAll(/`([\w-]+\.md)`/g)) assert.ok(existsSync(join(root, 'skills/init', f)), f)
    for (const n of ['init', 'sync']) {
        assert.ok(rootText('START.md').includes(`skills/${n}/SKILL.md`), `START.md names skills/${n}/SKILL.md`)
        assert.match(rootText(`skills/${n}/SKILL.md`), new RegExp(`Read \`<TF>/skills/${n}/SKILL\\.md\` and continue there from section 1`), n)
    }
})
