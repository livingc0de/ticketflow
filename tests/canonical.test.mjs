import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { AGENTS } from '../core/lib/config.mjs'
import { parseCanonical } from '../core/lib/stubs.mjs'

const core = new URL('../core/', import.meta.url).pathname
const ls = (dir) => (existsSync(join(core, dir)) ? readdirSync(join(core, dir)) : [])
// the canonical prose: skills (every .md under skills/<n>/) and roles, each with its own `.ticketflow/custom/<name>.md` and line budget
const prose = [
    ...ls('skills').flatMap((n) => ls(`skills/${n}`).filter((f) => f.endsWith('.md')).map((f) => ({ path: `skills/${n}/${f}`, custom: f === 'SKILL.md' ? n : f.replace(/\.md$/, ''), max: { 'implement-ticket/SKILL.md': 130, 'implement-ticket/post-merge.md': 60, 'create-ticket/SKILL.md': 90, 'orchestrate-tickets/SKILL.md': 70, 'engineering-method/SKILL.md': 100 }[`${n}/${f}`] ?? 130 }))),
    ...ls('agents').map((f) => ({ path: `agents/${f}`, custom: f.replace(/\.md$/, ''), max: 80 })),
]
// the optional practices (practices/<n>/*.md at the repo root) follow the same two rules as the core prose
const practicesDir = new URL('../practices/', import.meta.url).pathname
const practiceFiles = existsSync(practicesDir) ? readdirSync(practicesDir).flatMap((n) => readdirSync(join(practicesDir, n)).map((f) => join(practicesDir, n, f))) : []
const maps = ls('agents-map').map((f) => ({ path: `agents-map/${f}`, max: 40 }))
const text = (p) => readFileSync(join(core, p), 'utf8')

test('there are canonical skills and roles to check', () => {
    for (const p of ['skills/implement-ticket/SKILL.md', 'skills/implement-ticket/post-merge.md', 'skills/create-ticket/SKILL.md', 'skills/orchestrate-tickets/SKILL.md', 'skills/engineering-method/SKILL.md', 'agents/ticket-planner.md', 'agents/pr-reviewer.md', 'agents/e2e-verifier.md', 'agents-map/claude.md', 'agents-map/codex.md', 'agents-map/generic.md', ...['cursor', 'gemini', 'opencode', 'antigravity', 'copilot'].map((n) => `agents-map/${n}.md`)]) assert.ok(prose.some((x) => x.path === p) || maps.some((x) => x.path === p), p)
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

const reliance = /superpowers|companion is installed|\b(when|if|where|once|unless)\b[^.\n]{0,40}\b(installed|available|present)\b/i

test('the reliance pattern catches the variants and not a plain use of the word', () => {
    for (const s of ['Use test-driven-development where installed.', 'Once installed, the TDD skill applies.', 'Use the debugging skill when available.', 'If the TDD plugin is present, use it.', 'Assumes the companion is installed.', 'still apply when installed']) assert.match(s, reliance, s)
    for (const s of ['Checks that it is verified, then installed in the worktree.', 'The verified build was installed by the user.']) assert.doesNotMatch(s, reliance, s)
})

test('the core prose and practices rely on no external skill or plugin being installed', () => {
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

// ---- the front door: START.md and the root skills (init, sync, upstream), which the plugins expose
const root = new URL('../', import.meta.url).pathname
const rootText = (p) => readFileSync(join(root, p), 'utf8')
const FRONT = { 'START.md': 40, 'skills/init/SKILL.md': 80, 'skills/init/interview.md': 80, 'skills/init/new-repo.md': 40, 'skills/init/existing-repo.md': 80, 'skills/init/github.md': 60, 'skills/init/checks.md': 50, 'skills/sync/SKILL.md': 70, 'skills/upstream/SKILL.md': 40, 'skills/upstream/upstream-review.mjs': 120, 'skills/upstream/upstream.json': 20 }

test('the front door files exist and stay within their line budgets', () => {
    for (const [path, max] of Object.entries(FRONT)) {
        const lines = rootText(path).replace(/\n$/, '').split('\n').length
        assert.ok(lines <= max, `${path}: ${lines} lines, at most ${max}`)
    }
    for (const n of ['init', 'sync', 'upstream']) assert.deepEqual(readdirSync(join(root, 'skills', n)).filter((f) => `skills/${n}/${f}` in FRONT).length, readdirSync(join(root, 'skills', n)).length, `skills/${n} holds only budgeted files`)
})

test('the init, sync and upstream skills parse as skills: name is the directory, a "Use when" description of at most 300 characters', () => {
    for (const n of ['init', 'sync', 'upstream']) assert.equal(parseCanonical(rootText(`skills/${n}/SKILL.md`), `skills/${n}/SKILL.md`).name, n)
})

test('the front door names actions, never one agent\'s tools, and no gh form that a script covers', () => {
    const tools = /spawn_agent|subagent_type|TodoWrite|TaskCreate|run_in_background|AskUserQuestion|update_plan|Agent tool|Skill tool|Plan Mode/
    const covered = /gh issue view|gh project |sub_issues|gh pr merge|\/statuses\/|updateProjectV2|gh api [^\n]*issues\/(\d+|<[^>]*>|\$)|gh label/
    for (const path of Object.keys(FRONT)) { assert.doesNotMatch(rootText(path), tools, path); assert.doesNotMatch(rootText(path), covered, path) }
})

test('initialization offers default-label cleanup through the shared approval flow, while sync stays non-pruning', () => {
    const github = rootText('skills/init/github.md')
    assert.match(github, /labels\.mjs sync .*--prune-defaults .*--dry-run/)
    assert.match(github, /On a yes, the same command without `--dry-run`/)
    assert.match(rootText('skills/init/new-repo.md'), /shared `github\.md` label dry run and yes gate include .*--prune-defaults/)
    assert.match(rootText('skills/init/existing-repo.md'), /shared `github\.md` label dry run and yes gate include .*--prune-defaults/)
    assert.match(rootText('skills/sync/SKILL.md'), /do not use its initialization-only `--prune-defaults` flag/)
})

test('every script and lib the front door names exists', () => {
    for (const path of Object.keys(FRONT)) {
        for (const [, kind, name] of rootText(path).matchAll(/(?:core|\.ticketflow)\/(scripts|lib)\/([\w-]+\.mjs)/g)) assert.ok(existsSync(join(core, kind, name)), `${path}: ${kind}/${name}`)
    }
})

test('every part file of init is referenced by its SKILL.md and exists; START.md names the front-door skills; init and sync hand over to the clone\'s own copy', () => {
    const skill = rootText('skills/init/SKILL.md')
    for (const f of readdirSync(join(root, 'skills/init')).filter((x) => x !== 'SKILL.md')) assert.ok(skill.includes(`\`${f}\``), `skills/init/SKILL.md does not reference ${f}`)
    for (const [, f] of skill.matchAll(/`([\w-]+\.md)`/g)) assert.ok(existsSync(join(root, 'skills/init', f)), f)
    for (const n of ['init', 'sync']) {
        assert.ok(rootText('START.md').includes(`skills/${n}/SKILL.md`), `START.md names skills/${n}/SKILL.md`)
        assert.match(rootText(`skills/${n}/SKILL.md`), new RegExp(`Read \`<TF>/skills/${n}/SKILL\\.md\` and continue there from section 1`), n)
    }
    assert.ok(rootText('START.md').includes('skills/upstream/SKILL.md'), 'START.md names skills/upstream/SKILL.md')
})

test('orchestrate-tickets: a coordinator with the Result contract, the budget formula and the Ready-backlog warning', () => {
    const skill = text('skills/orchestrate-tickets/SKILL.md')
    assert.match(skill, /Result #N: merged <PR> <sha7> \| needs-review <PR> <sha7> \| needs-decision #D \| blocked <reason> \| failed <reason>/)
    assert.match(skill, /You never edit files, run git, read diffs, code or logs, review, merge or set a status/)
    assert.match(skill, /floor\(\(B-1\)\/2\)/)
    assert.match(skill, /before the first dispatch, show the user a warning that you will work the Ready backlog/)
    assert.match(skill, /queue\.mjs/)
    assert.match(skill, /Never "Done"/)
    assert.match(skill, /the scope is exactly those ticket numbers: every loop and every resume runs the queue with them, never the ready backlog again/)
    assert.match(skill, /not dispatched again in this run/)
    assert.match(skill, /write nothing to GitHub/)
})

test('engineering-method: the method has one home (implement-ticket and create-ticket point to it), and the roles carry the new modes', () => {
    const skill = text('skills/engineering-method/SKILL.md')
    for (const re of [/see a test fail for the right reason/, /root cause/, /shortcut: <limit>, <when to revisit>/, /diff mode/, /audit mode/, /debt\.mjs/, /Not checked/, /No other plugin's planning, approval, branching, review or merge process runs on top/]) assert.match(skill, re)
    for (const re of [/\(b\) a small diff in one place/, /\(d\) verification is obvious and automated/]) { assert.match(skill, re); assert.doesNotMatch(text('skills/implement-ticket/SKILL.md'), re) }   // the plan-or-skip tests have one home
    assert.doesNotMatch(text('skills/implement-ticket/SKILL.md'), /see a test fail for the right reason|shortcut: <limit>|Never delegate a deterministic command/)
    for (const p of ['skills/implement-ticket/SKILL.md', 'skills/create-ticket/SKILL.md']) assert.match(text(p), /\.ticketflow\/skills\/engineering-method\/SKILL\.md|engineering-method skill/, p)
    const reviewer = text('agents/pr-reviewer.md')
    for (const re of [/\*\*Diff mode\*\*/, /\*\*Audit mode\*\*/, /Lean: -N lines possible/, /at most 20/, /never counts as the review `merge` needs/, /Verdict: no blockers \| blockers found/]) assert.match(reviewer, re)
    assert.match(text('agents/ticket-planner.md'), /`review: task`/)
})

test('engineering-method routes a change that ships to its ticket; ticketless stays for local work, investigation, review and audit', () => {
    const skill = text('skills/engineering-method/SKILL.md')
    assert.match(skill, /A request to ship a change \(fix a bug, build, refactor\) is ticket work: find or create its ticket \(`create-ticket` searches first\), then `implement-ticket`/)
    assert.match(skill, /Without a ticket \(the user says so, or nothing ships: an investigation, a diff review, an audit, a local experiment\)/)
    assert.doesNotMatch(skill.split('\n')[2], /with or without a ticket/)
    assert.match(text('skills/create-ticket/SKILL.md'), /A `low`-tier ticket has only Goal and Acceptance criteria/)
    assert.match(text('skills/implement-ticket/SKILL.md'), /--reviewed-by/)
})

test('the removed review mechanisms appear only in the upgrade history and the changelog', () => {
    const removed = /Review basis|review-basis|owner approved|standin needed|none configured|done_pattern|no_findings_reaction|rereview_comment|unavailable_pattern|stale_after_min/
    const root = new URL('../', import.meta.url).pathname
    const walk = (dir) => readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))
    const files = [...['core/skills', 'core/agents', 'core/agents-map', 'core/scripts', 'core/lib', 'core/templates', 'skills'].flatMap(walk), ...readdirSync(join(core, 'docs')).filter((f) => f !== 'UPGRADING.md').map((f) => `core/docs/${f}`), 'README.md']
    assert.ok(files.length > 40)
    for (const f of files) assert.doesNotMatch(readFileSync(join(root, f), 'utf8'), removed, f)
})

test('the ticketflow repo root has no plugin.json, hooks.json, rules/ or GEMINI.md: agents that scan the root would load them as their own', () => {
    for (const f of ['plugin.json', 'hooks.json', 'rules', 'GEMINI.md']) assert.ok(!existsSync(join(root, f)), f)
})

test('every agent has an action map; the maps for the other tools point claude and codex users to theirs; no map is one tool\'s name for another', () => {
    for (const n of AGENTS) assert.ok(maps.some((m) => m.path === `agents-map/${n}.md`), n)
    for (const n of ['claude', 'codex']) assert.match(text(`agents-map/${n}.md`), /Loaded by another tool \(Cursor, Copilot and OpenCode also read `\.claude\/`; Cursor reads `\.codex\/agents`\)\? Use `\.ticketflow\/agents-map\/<your tool>\.md`, or `generic\.md`\./)
    for (const n of AGENTS) assert.match(text(`agents-map/${n}.md`), new RegExp(`^# Action map: `), n)
})

test('the skills and roles stay agent-neutral: none names a front-door tool or its config file', () => {
    const tools = /\.cursor|\.gemini|\.opencode|\.antigravity|opencode\.json|GEMINI\.md|\.agent\.md|invoke_subagent|runSubagent|activate_skill|ask_user|write_todos/
    for (const { path } of prose) assert.doesNotMatch(text(path), tools, path)
})
