#!/usr/bin/env node
/**
 * Maintainer tool, never shipped to installed repos: runs one eval scenario (benchmarks/scenarios/<id>) with a real agent CLI in a fresh
 * temp git repo and appends one JSON row (docs/evals/agent-scenarios.md). It starts a PAID agent session; nothing here runs in CI.
 *
 * Usage: agent-eval.mjs <scenario> --agent claude|codex --arm ticketflow|bare [--model m] [--source dir] [--out file.jsonl]
 *   <scenario> is a directory name or its prefix (L1). The ticketflow arm installs a TicketFlow checkout (--source, default this one; an
 *   older tag's worktree compares revisions) the way `init` does (runtime, gen-stubs, render); the bare arm installs nothing. The scenario's hidden check.mjs runs on the result; the row is printed and appended to --out.
 * Exit: 0 = the hidden check passed, 1 = it failed (the row is still recorded), 2 = usage, unknown scenario or missing CLI, before any run.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { main } from '../core/lib/cli.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCENARIOS = join(ROOT, 'benchmarks/scenarios')
const usage = 'usage: agent-eval <scenario> --agent claude|codex --arm ticketflow|bare [--model m] [--source dir] [--out file.jsonl]'
const TOOLS = 'Read,Edit,Write,Glob,Grep,Bash(node *),Bash(npm *),Bash(git status *),Bash(git diff *),Bash(git log *),Bash(git show *),Bash(git add *),Bash(git commit *)'
const AGENT_TIMEOUT_MS = 30 * 60 * 1000   // shortcut: one fixed 30-minute ceiling so a hung paid session cannot run forever (a timeout is recorded as agent_exit null), add a --timeout option when a scenario needs longer
const BUF = 1 << 28

const run = (cmd, args, o = {}) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: BUF, ...o })
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=eval', '-c', 'user.email=eval@example.invalid', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: BUF }).trim()
const node = (cwd, ...args) => execFileSync(process.execPath, args, { cwd, stdio: 'pipe', maxBuffer: BUF })
const orNull = (f) => { try { return f() } catch { return null } }
const parse = (s) => orNull(() => JSON.parse(s))
const depNames = (text) => new Set(['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].flatMap((k) => Object.keys(parse(text)?.[k] ?? {})))

/** The repo the agent works in: the scenario's repo/, plus (ticketflow arm) the install init does, all in one base commit. */
function workspace(sdir, agent, arm, work, src) {
    const dir = join(work, 'repo')
    cpSync(join(sdir, 'repo'), dir, { recursive: true })
    git(dir, 'init', '-q', '-b', 'main')
    if (arm === 'ticketflow') {
        mkdirSync(join(dir, '.ticketflow'))
        const none = { strong: null, standard: null, light: null }
        writeFileSync(join(dir, '.ticketflow/config.json'), JSON.stringify({ schema_version: 2, repo: 'eval/fixture', default_branch: 'main', verify: { mode: 'local-first', command: 'npm test' }, agents: [agent], models: { [agent]: none } }))
        node(dir, join(src, 'core/scripts/runtime.mjs'), src, '.')
        node(dir, '.ticketflow/scripts/gen-stubs.mjs', '.ticketflow', '.')
        node(dir, '.ticketflow/scripts/render.mjs', '.ticketflow/templates', '.')
    }
    git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'base')
    return { dir, base: git(dir, 'rev-parse', 'HEAD') }
}

/** What the CLI reported: the final answer, turns, cost, token usage and model, from its JSON; null where it does not say. */
function report(agent, out, answerFile, model) {
    if (agent === 'claude') {
        const res = [].concat(parse(out) ?? []).findLast((e) => e?.type === 'result')   // the result object, or the last of an event array
        return { answer: res?.result ?? '', turns: res?.num_turns ?? null, cost_usd: res?.total_cost_usd ?? null, tokens: res?.usage ?? null, model: Object.keys(res?.modelUsage ?? {}).join(',') || model }
    }
    const done = out.split('\n').map(parse).filter((e) => e?.type === 'turn.completed')
    const tokens = done.length ? done.reduce((u, e) => { for (const [k, n] of Object.entries(e.usage ?? {})) u[k] = (u[k] ?? 0) + n; return u }, {}) : null
    return { answer: orNull(() => readFileSync(answerFile, 'utf8')) ?? '', turns: null, cost_usd: null, tokens, model }
}

main('agent-eval', () => {
    const { values: v, positionals } = parseArgs({ options: { agent: { type: 'string' }, arm: { type: 'string' }, model: { type: 'string' }, source: { type: 'string' }, out: { type: 'string' } }, allowPositionals: true })
    if (positionals.length !== 1 || !['claude', 'codex'].includes(v.agent) || !['ticketflow', 'bare'].includes(v.arm)) throw new Error(usage)
    const id = readdirSync(SCENARIOS).find((d) => d === positionals[0] || d.startsWith(`${positionals[0]}-`))   // only a listed name, never a path
    if (!id) throw new Error(`unknown scenario ${positionals[0]}`)
    const src = resolve(v.source ?? ROOT)
    const outFile = v.out && resolve(v.out)   // the harness's own result file is not a change to a source checkout it sits in
    if (v.out) try { appendFileSync(v.out, '') } catch (e) { throw new Error(`--out ${v.out} cannot be written (${e.code})`) }   // before the paid run, not after it
    if (v.arm === 'ticketflow' && !existsSync(join(src, 'core/scripts/runtime.mjs'))) throw new Error(`${src} is not a ticketflow checkout`)
    const version = run(v.agent, ['--version'])
    if (version.error || version.status !== 0) throw new Error(`${v.agent} is not installed or not on PATH`)

    const sdir = join(SCENARIOS, id), work = mkdtempSync(join(tmpdir(), 'agent-eval-'))
    const { dir, base } = workspace(sdir, v.agent, v.arm, work, src)
    const answerFile = join(work, 'answer.txt')
    const prompt = readFileSync(join(sdir, 'prompt.md'), 'utf8'), claude = v.agent === 'claude'
    const args = claude
        ? ['-p', prompt, '--output-format', 'json', '--no-session-persistence', '--setting-sources', 'project,local', '--allowedTools', TOOLS, ...(v.model ? ['--model', v.model] : [])]
        : ['exec', '--json', '--ignore-user-config', '--sandbox', 'workspace-write', '-C', dir, '-o', answerFile, ...(v.model ? ['-m', v.model] : []), '-']   // codex reads the prompt from stdin
    const t0 = Date.now()
    const r = run(v.agent, args, { cwd: dir, timeout: AGENT_TIMEOUT_MS, ...(claude ? { stdio: ['ignore', 'pipe', 'pipe'] } : { input: prompt }) })
    const wall_s = Math.round((Date.now() - t0) / 100) / 10
    const out = r.stdout ?? ''
    writeFileSync(join(work, 'agent.out'), out)
    const got = report(v.agent, out, answerFile, v.model ?? null)
    writeFileSync(answerFile, got.answer)

    git(dir, 'add', '-A')   // the repo is a throwaway: staging counts new files and commits the agent made are diffed against the base too
    // npm install output is not the agent's change: the lockfile and node_modules are left out of the diff (new dependencies are counted from package.json)
    const stat = git(dir, 'diff', '--cached', '--numstat', base, '--', '.', ':(exclude)package-lock.json', ':(exclude,glob)**/node_modules/**').split('\n').filter(Boolean).map((l) => l.split('\t'))
    const before = depNames(orNull(() => git(dir, 'show', `${base}:package.json`)) ?? ''), after = depNames(orNull(() => readFileSync(join(dir, 'package.json'), 'utf8')) ?? '')
    const c = run(process.execPath, [join(sdir, 'check.mjs'), dir, answerFile], { timeout: 5 * 60 * 1000 })
    const pass = c.status === 0
    const tf = (f) => (v.arm === 'ticketflow' ? orNull(f) : null)   // the bare arm has no TicketFlow revision
    const row = {
        scenario: id, agent: v.agent, agent_version: version.stdout.trim(), model: got.model, arm: v.arm,
        eval_sha: orNull(() => git(ROOT, 'rev-parse', 'HEAD')),   // the revision of this tool and its scenarios
        ticketflow_sha: tf(() => git(src, 'rev-parse', 'HEAD')), ticketflow_dirty: tf(() => git(src, 'status', '--porcelain', '--untracked-files=all').split('\n').some((l) => l && resolve(src, l.slice(3)) !== outFile)),
        ticketflow_version: tf(() => readFileSync(join(src, 'VERSION'), 'utf8').trim()),
        check: { pass, why: `${c.stdout ?? ''}${c.stderr ?? ''}`.trim().split('\n')[0].slice(0, 300) || `check exited ${c.status}` },
        diff: { added: stat.reduce((n, s) => n + (+s[0] || 0), 0), removed: stat.reduce((n, s) => n + (+s[1] || 0), 0), files: stat.map((s) => s[2]) },
        deps_added: [...after].filter((d) => !before.has(d)).length,
        turns: got.turns, tokens: got.tokens, cost_usd: got.cost_usd, wall_s, agent_exit: r.status,
        descendants: 'unknown',   // shortcut: 'unknown' because no CLI is verified to count child agents in these totals, set `included` only after a live run shows it
        workdir: work, date: new Date().toISOString(),
    }
    console.log(JSON.stringify(row))
    if (v.out) appendFileSync(v.out, `${JSON.stringify(row)}\n`)
    return pass ? 0 : 1
})
