import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const core = new URL('../core/', import.meta.url).pathname
const ls = (dir) => (existsSync(join(core, dir)) ? readdirSync(join(core, dir)) : [])
// the canonical prose: skills (every .md under skills/<n>/) and roles, each with its own `.ticketflow/custom/<name>.md` and line budget
const prose = [
    ...ls('skills').flatMap((n) => ls(`skills/${n}`).filter((f) => f.endsWith('.md')).map((f) => ({ path: `skills/${n}/${f}`, custom: f === 'SKILL.md' ? n : f.replace(/\.md$/, ''), max: { 'implement-ticket/SKILL.md': 130, 'implement-ticket/post-merge.md': 60, 'create-ticket/SKILL.md': 90 }[`${n}/${f}`] ?? 130 }))),
    ...ls('agents').map((f) => ({ path: `agents/${f}`, custom: f.replace(/\.md$/, ''), max: 80 })),
]
const maps = ls('agents-map').map((f) => ({ path: `agents-map/${f}`, max: 40 }))
const text = (p) => readFileSync(join(core, p), 'utf8')

test('there are canonical skills and roles to check', () => {
    for (const p of ['skills/implement-ticket/SKILL.md', 'skills/implement-ticket/post-merge.md', 'skills/create-ticket/SKILL.md', 'agents/ticket-planner.md', 'agents/pr-reviewer.md', 'agents/e2e-verifier.md', 'agents-map/claude.md', 'agents-map/codex.md', 'agents-map/generic.md']) assert.ok(prose.some((x) => x.path === p) || maps.some((x) => x.path === p), p)
})

test('skills and roles name actions, never one agent\'s tools', () => {
    const tools = /spawn_agent|subagent_type|TodoWrite|TaskCreate|run_in_background|AskUserQuestion|update_plan|Agent tool|Skill tool|Plan Mode/
    for (const { path } of prose) assert.doesNotMatch(text(path), tools, path)
})

test('no gh form that a script covers', () => {
    const covered = /gh issue view|gh project |sub_issues|gh pr merge|\/statuses\/|updateProjectV2|gh api [^\n]*issues\/(\d+|<[^>]*>|\$)|gh label/
    for (const { path } of prose) assert.doesNotMatch(text(path), covered, path)
})

test('every script, skill and role path a file names exists in core/', () => {
    for (const { path } of [...prose, ...maps]) {
        for (const [, kind, name] of text(path).matchAll(/\.ticketflow\/(scripts|skills|agents|agents-map)\/([\w<>/.-]+?)(?=[\s`'"),;:]|\.$|$)/g)) {
            if (name.includes('<')) continue
            assert.ok(existsSync(join(core, kind, name)), `${path}: .ticketflow/${kind}/${name}`)
        }
    }
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
