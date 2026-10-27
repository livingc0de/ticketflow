/**
 * Renders the templates into a repo's own files. Pure: strings in, strings out.
 *
 * One rule runs through it: compute everything first, write only what ticketflow owns or what carries its marker, and treat anything
 * else as a conflict. A managed block is delimited by `# ticketflow:begin <part>` / `# ticketflow:end <part>` (or the same inside
 * `<!-- -->`), each on its own line. Text outside the blocks is the repo's and survives every merge byte for byte.
 *
 * Placeholders are `{{name}}` (never `${{ ... }}`, which is GitHub's). Names ending in `_json` hold a JSON string, which is a valid
 * YAML string too; the other values are validated by the config (branch names, paths) or built here.
 */

import { askPatterns, claudeAsk, codexRules } from './guard.mjs'

export class RenderError extends Error {
    name = 'RenderError'
}
const fail = (m) => { throw new RenderError(m) }

/**
 * Where each template goes. `kind`: blocks (managed blocks merged into the file), settings, hooks, keys and opencode (JSON merged into
 * the repo's own file, see the merge functions), owned (the whole file is ticketflow's), once (written when missing, never touched again). `propose`: where a managed block is
 * suggested when the existing file has no markers. `agent`: rendered only while that agent is in the config (the entries without it
 * are rendered for every install, as they always were).
 */
export const FILES = [
    { src: 'ci.yml', dest: '.github/workflows/ci.yml', kind: 'blocks' },
    { src: 'ISSUE_TEMPLATE/config.yml', dest: '.github/ISSUE_TEMPLATE/config.yml', kind: 'once' },   // a starting point: then the repo's
    ...['bug', 'feature', 'task', 'decision'].map((n) => ({ src: `ISSUE_TEMPLATE/${n}.yml`, dest: `.github/ISSUE_TEMPLATE/${n}.yml`, kind: 'blocks' })),
    { src: 'PULL_REQUEST_TEMPLATE.md', dest: '.github/PULL_REQUEST_TEMPLATE.md', kind: 'blocks' },
    { src: 'AGENTS-block.md', dest: 'AGENTS.md', kind: 'blocks', propose: 'h1' },
    { src: 'CLAUDE.md', dest: '.claude/CLAUDE.md', kind: 'blocks', propose: 'top' },
    { src: 'GEMINI.md', dest: 'GEMINI.md', kind: 'blocks', propose: 'top', agent: 'gemini' },
    { src: 'claude-settings.json', dest: '.claude/settings.json', kind: 'settings' },
    { src: 'codex-hooks.json', dest: '.codex/hooks.json', kind: 'hooks' },
    { src: 'cursor-hooks.json', dest: '.cursor/hooks.json', kind: 'hooks', agent: 'cursor' },
    { src: 'gemini-settings.json', dest: '.gemini/settings.json', kind: 'hooks', agent: 'gemini' },
    { src: 'copilot-hooks.json', dest: '.github/hooks/ticketflow-guard.json', kind: 'hooks', agent: 'copilot' },
    { src: 'antigravity-hooks.json', dest: '.agents/hooks.json', kind: 'keys', agent: 'antigravity' },
    { src: 'opencode.json', dest: 'opencode.json', kind: 'opencode', agent: 'opencode', alt: 'opencode.jsonc' },
    { src: 'codex.rules', dest: '.codex/rules/ticketflow.rules', kind: 'owned' },
    { src: 'custom-README.md', dest: '.ticketflow/custom/README.md', kind: 'once' },
]

/** The files this config renders: every FILES entry without an `agent`, and those of the configured agents. */
export const filesFor = (cfg) => FILES.filter((f) => !f.agent || cfg.agents.includes(f.agent))

/** Fills `{{name}}`. A line that is only a placeholder is replaced by the value (several lines), or dropped when the value is empty. */
export function fill(tpl, vars) {
    const value = (name) => (Object.hasOwn(vars, name) && typeof vars[name] === 'string' ? vars[name] : fail(`unknown placeholder {{${name}}}`))
    const out = tpl.split('\n').flatMap((line) => {
        const whole = /^[ \t]*\{\{([a-z][\w.]*)\}\}[ \t]*$/.exec(line)
        if (whole) { const v = value(whole[1]).replace(/\n$/, ''); return v === '' ? [] : [v] }
        return [line.replace(/(?<!\$)\{\{([a-z][\w.]*)\}\}/g, (_, name) => value(name))]
    }).join('\n')
    if (/(?<!\$)\{\{[a-z][\w.]*\}\}/.test(out)) fail('a placeholder is left after filling (a value contains one)')
    return out
}

const q = JSON.stringify
const MARKER_LINE = /^[ \t]*(?:#|<!--) ticketflow:(begin|end) ([a-z][a-z0-9-]*)(?: -->)?[ \t]*\r?$/

/** A shell command as the lines of a `run: |` block at `indent` spaces. */
function runBlock(cmd, indent) {
    if (/ticketflow:(begin|end)/.test(cmd)) fail('a command contains a ticketflow marker')
    const pad = ' '.repeat(indent)
    return `${pad}run: |\n${cmd.trim().split('\n').map((l) => (l.trim() === '' ? '' : pad + '  ' + l)).join('\n')}`
}

const dropdown = (id, label, options) => `  - type: dropdown\n    id: ${id}\n    attributes:\n      label: ${label}\n      options:\n${options.map((o) => `        - ${q(o)}`).join('\n')}\n    validations:\n      required: true`

/** The non-empty lines of a practice snippet file; each must start with `prefix` and carry no marker, so a snippet cannot break the managed block. */
function snippet(text, prefix, at) {
    const out = text.replaceAll('\r\n', '\n').split('\n').filter((l) => l.trim() !== '')
    for (const l of out) if (!l.startsWith(prefix) || l.length === prefix.length || /ticketflow:(begin|end)/.test(l)) fail(`${at}: every line must start with "${prefix}" and have text`)
    return out
}

/** The values of every placeholder, from a validated config. `runtimeRel` is `.ticketflow`, or `core` in the ticketflow repo. `practices`: `[{ name, rules, checks }]` (the file texts, `checks` null when absent) of the enabled practices. */
export function templateVars(cfg, { runtimeRel, practices = [] }) {
    const rules = practices.flatMap((p) => snippet(p.rules, '- ', `practice ${p.name} agents-rules.md`))
    const checks = practices.flatMap((p) => (p.checks === null ? [] : snippet(p.checks, '- [ ] ', `practice ${p.name} pr-checklist.md`)))
    const local = cfg.verify.mode === 'local-first'
    const unfiltered = cfg.ci.push_paths !== null && cfg.ci.push_paths.length === 0 || cfg.deploy_branch !== null
    const push = cfg.ci.push_paths === null && cfg.deploy_branch === null ? ''
        : `  push:\n    branches: [${q(cfg.default_branch)}]${unfiltered ? '' : `\n    paths: [${cfg.ci.push_paths.map(q).join(', ')}]`}`
    const step = (name, cmd) => `      - name: ${q(name)}\n        if: steps.scope.outputs.skip != 'true'\n${runBlock(cmd, 8)}`
    const steps = [cfg.verify.install.trim() === '' ? null : step('Install Dependencies', cfg.verify.install), step('Verify', cfg.verify.command)].filter(Boolean).join('\n\n')
    const execution = `  - type: textarea
    id: execution
    attributes:
      label: Execution
      description: "A recommendation the implementer re-checks against the code: the tier (low, normal, high, critical), the model and effort, and the planning choice (planner: the planner runs at claim, the default; planned earlier: <path to the committed technical plan>; or skipped, easy and straightforward because (a)-(d)), each with a one-line reason."
      placeholder: |
        - **Tier:** normal - ...
        - **Model and effort:** standard class, high - ...
        - **Planning:** planner (runs at claim) - ...`
    return {
        runtime: runtimeRel,
        default_branch: cfg.default_branch,
        plans_dir: cfg.plans_dir,
        default_branch_json: q(cfg.default_branch),
        deploy_branch_json: q(cfg.deploy_branch ?? ''),
        gate_context_json: q(cfg.gate.context),
        gate_check_json: q(cfg.gate.check),
        timeout_min: String(cfg.verify.timeout_min),
        pr_types: local ? '    types: [opened, synchronize, reopened, ready_for_review]' : '',
        push_trigger: push,
        job_if: local ? `    if: \${{ !github.event.pull_request.draft && (github.event_name != 'workflow_dispatch' || github.ref == 'refs/heads/${cfg.default_branch}') }}` : '',
        scope_inherit: cfg.gate.inherit
            ? `          elif d=$(node ${runtimeRel}/lib/inherit.mjs "$PR" "$HEAD_SHA") && [[ $d =~ ^description=Inherited\\ from\\ [0-9a-f]{7}:\\  ]]; then\n            printf 'skip=true\\n%s\\n' "$d" >> "$GITHUB_OUTPUT"`
            : '',
        verify_steps: steps,
        area_field: cfg.areas.length ? dropdown('area', 'Area', cfg.areas) : '',
        priority_field: dropdown('priority', 'Priority', ['P0 Critical', 'P1 High', 'P2 Medium', 'P3 Low']),
        effort_field: dropdown('effort', 'Effort', ['XS', 'S', 'M', 'L', 'XL']),
        execution_field: execution,
        practice_agents: rules.length ? `\nEnabled practices (procedures in \`${runtimeRel}/practices/\`):\n\n${rules.join('\n')}` : '',
        practice_pr: checks.length ? `\n### Practice checks\n\n${checks.join('\n')}` : '',
        codex_rules: codexRules(cfg, { scriptsDir: `${runtimeRel}/scripts` }).replace(/\n$/, ''),
    }
}

/**
 * How many times a workflow runs the verify command: its non-blank lines, in order, as consecutive lines of the file (inline
 * `run: <cmd>`, quoted or not, or inside a `run: |` / `run: >` block). Blank and comment lines are skipped on both sides; an empty command counts 0.
 */
export function verifyRuns(text, command) {
    const cmd = command.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    if (!cmd.length) return 0
    const unquote = (l) => (/^(["']).*\1$/.test(l) ? l.slice(1, -1) : l)
    const lines = text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => unquote(l.replace(/^(-\s*)?run:\s*/, '')))
    let n = 0
    for (let i = 0; i + cmd.length <= lines.length; i++) if (cmd.every((c, k) => lines[i + k] === c)) n++
    return n
}

/** Parts a config leaves out of the rendered file. */
export const omittedParts = (cfg) => (cfg.deploy_branch === null ? ['deploy'] : [])

/** `[{ text } | { part, body }]`. A block's body includes its marker lines. Nested, unbalanced or duplicate markers throw. */
export function parseBlocks(text) {
    const segs = []
    const seen = new Set()
    let open = null, plain = ''
    for (const line of text.split(/(?<=\n)/)) {
        const m = MARKER_LINE.exec(line.replace(/\n$/, ''))
        if (!m) { if (open) open.body += line; else plain += line; continue }
        const [, which, part] = m
        if (which === 'begin') {
            if (open) fail(`marker ${part} begins inside ${open.part}`)
            if (seen.has(part)) fail(`duplicate marker ${part}`)
            seen.add(part)
            if (plain) segs.push({ text: plain })
            plain = ''
            open = { part, body: line }
        } else {
            if (!open || open.part !== part) fail(`marker end ${part} without its begin`)
            open.body += line
            segs.push(open)
            open = null
        }
    }
    if (open) fail(`marker ${open.part} is never closed`)
    if (plain) segs.push({ text: plain })
    return segs
}

/** The blocks of a rendered file without the parts it leaves out. */
export function dropParts(text, omit) {
    return parseBlocks(text).filter((s) => !omit.includes(s.part)).map((s) => s.text ?? s.body).join('')
}

/**
 * `{ text }`, or `{ conflict }` when the file cannot be merged without a decision. A part in the file that the template does not know is
 * removed only when it is one of `omit` (a part this config leaves out); any other is the repo's own marker pair: a conflict, never a deletion.
 */
export function mergeManaged(existing, rendered, omit = []) {
    if (existing === null) return { text: rendered }
    const blocks = new Map(parseBlocks(rendered).filter((s) => s.part).map((s) => [s.part, s.body]))
    const segs = parseBlocks(existing)
    if (!segs.some((s) => s.part)) return { conflict: 'the file exists and has no ticketflow markers' }
    const placed = new Set()
    const unknown = []
    const text = segs.map((s) => {
        if (!s.part) return s.text
        if (!blocks.has(s.part)) { if (!omit.includes(s.part)) unknown.push(s.part); return '' }
        placed.add(s.part)
        return blocks.get(s.part)
    }).join('')
    if (unknown.length) return { conflict: `the file has marker(s) ticketflow does not know: ${unknown.join(', ')}` }
    const missing = [...blocks.keys()].filter((p) => !placed.has(p))
    return missing.length ? { conflict: `the file lacks the part ${missing.join(', ')}` } : { text }
}

/** Where a managed block goes in a Markdown file that has none: after the first H1 (`h1`) or at the top (`top`). */
export function proposeInsert(existing, block, where) {
    const note = where === 'top' && /^@(?:\.\.\/)?AGENTS\.md[ \t]*$/m.test(existing)
        ? `the file already imports AGENTS.md: remove that line, the block imports it${/^@AGENTS\.md[ \t]*$/m.test(existing) ? ' (as written it points at .claude/AGENTS.md, which is most likely missing: the import is probably broken)' : ''}`
        : undefined
    const lines = existing.split(/(?<=\n)/)
    const h1 = where === 'h1' ? lines.findIndex((l) => /^# /.test(l)) : -1
    const at = h1 + 1
    const head = lines.slice(0, at).join(''), tail = lines.slice(at).join('')
    const text = at === 0 ? `${block}\n${existing}` : `${head}${head.endsWith('\n') ? '' : '\n'}\n${block}${tail.startsWith('\n') || tail === '' ? '' : '\n'}${tail}`
    return { text, note }
}

const parseJson = (text) => { try { return JSON.parse(text) } catch { return undefined } }
const json = (x) => JSON.stringify(x, null, 2) + '\n'
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/**
 * Claude settings: `allow` and `ask` are unions, existing entries first. An entry in `owned` (what ticketflow added last time)
 * that is no longer rendered is removed; everything else, `deny` included, is left alone (deny rules are reported).
 * `{ text, notes }` or `{ conflict }`. The text is the existing text when nothing changes.
 */
export function mergeClaudeSettings(existing, { allow, ask }, owned = {}) {
    const obj = existing === null ? {} : parseJson(existing)
    if (obj === undefined) return { conflict: 'the settings file is not valid JSON' }
    if (!isObject(obj) || (obj.permissions !== undefined && !isObject(obj.permissions))) return { conflict: 'the settings file is not an object with a permissions object' }
    const permissions = obj.permissions ?? {}
    const merged = {}
    for (const [key, want] of [['allow', allow], ['ask', ask]]) {
        const have = permissions[key] ?? []
        if (!Array.isArray(have)) return { conflict: `permissions.${key} is not a list` }
        const stale = new Set((owned[key] ?? []).filter((e) => !want.includes(e)))
        const list = [...have.filter((e) => !stale.has(e)), ...want.filter((e) => !have.includes(e))]
        if (list.length || permissions[key] !== undefined) merged[key] = list
    }
    const next = { ...obj, permissions: { ...permissions, ...merged } }
    const notes = Array.isArray(permissions.deny) && permissions.deny.length ? [`permissions.deny has ${permissions.deny.length} rule(s) of your own, kept: ${permissions.deny.join(', ')}`] : []
    const same = existing !== null && JSON.stringify(next) === JSON.stringify(obj)
    return { text: same ? existing : json(next), notes }
}

/**
 * A hooks file (Codex, Cursor, Gemini CLI, Copilot): ticketflow's guard entry is added or replaced, once. `template` is the rendered
 * template: its `hooks` has one event, whose first entry is ours (its command runs scripts/guard.mjs); other top-level keys of the
 * template (a `version`) are added only when the file lacks them. Ours is matched by command, as a flat entry or inside a group's `hooks`.
 */
export function mergeHooks(existing, template, runtimeRel) {
    const event = Object.keys(template.hooks)[0], entry = template.hooks[event][0]
    const obj = existing === null ? {} : parseJson(existing)
    if (obj === undefined) return { conflict: 'the hooks file is not valid JSON' }
    const list = obj?.hooks?.[event] ?? []
    if (!isObject(obj) || (obj.hooks !== undefined && !isObject(obj.hooks)) || !Array.isArray(list)) return { conflict: `the hooks file is not shaped like { hooks: { ${event}: [...] } }` }
    const ours = (h) => typeof h?.command === 'string' && [`.ticketflow/scripts/guard.mjs`, `${runtimeRel}/scripts/guard.mjs`].some((p) => h.command.includes(p))
    let at = -1
    const rest = []
    for (const item of list) {
        const hooks = Array.isArray(item?.hooks) ? item.hooks : null
        if (ours(item) || hooks?.some(ours)) {
            if (at < 0) at = rest.length
            const kept = hooks?.filter((h) => !ours(h)) ?? []
            if (kept.length) rest.push({ ...item, hooks: kept })
        } else rest.push(item)
    }
    rest.splice(at < 0 ? rest.length : at, 0, entry)
    const extra = Object.fromEntries(Object.entries(template).filter(([k]) => k !== 'hooks' && !Object.hasOwn(obj, k)))
    const next = { ...extra, ...obj, hooks: { ...obj.hooks, [event]: rest } }
    return { text: existing !== null && JSON.stringify(next) === JSON.stringify(obj) ? existing : json(next), notes: [] }
}

/** Codex hooks: the one PreToolUse entry. */
export const mergeCodexHooks = (existing, entry, runtimeRel) => mergeHooks(existing, { hooks: { PreToolUse: [entry] } }, runtimeRel)

/** A JSON file of named entries (Antigravity `hooks.json`): the template's top-level keys replace the same keys, every other key is kept. */
export function mergeKeys(existing, template) {
    const obj = existing === null ? {} : parseJson(existing)
    if (!isObject(obj)) return { conflict: obj === undefined ? 'the file is not valid JSON' : 'the file is not a JSON object' }
    const next = { ...obj, ...template }
    return { text: existing !== null && JSON.stringify(next) === JSON.stringify(obj) ? existing : json(next), notes: [] }
}

/** An OpenCode glob as a RegExp: `*` any text, `?` one character; a trailing ` *` also matches the command without arguments. */
function globRe(g) {
    const body = (x) => x.replace(/[.+^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*').replaceAll('?', '.')
    return new RegExp(g.endsWith(' *') ? `^${body(g.slice(0, -2))}(?: .*)?$` : `^${body(g)}$`)
}

/** What decides `text` among ordered `[glob, effect]` rules (the last match wins, as in OpenCode): `[glob, effect]` or null. */
const decider = (rules, text) => rules.findLast(([glob]) => globRe(glob).test(text)) ?? null

/** Whether some string matches both OpenCode globs (`*` any run, `?` one character; a trailing ` *` is optional). Exact, by walking both globs together. */
function overlaps(a, b) {
    const variants = (g) => (g.endsWith(' *') ? [g, g.slice(0, -2)] : [g])
    const walk = (x, y) => {
        const seen = new Set()
        const go = (i, j) => {
            const key = `${i},${j}`
            if (seen.has(key)) return false
            seen.add(key)
            if (i === x.length && j === y.length) return true
            if (x[i] === '*' && go(i + 1, j)) return true
            if (y[j] === '*' && go(i, j + 1)) return true
            if (i === x.length || j === y.length) return false
            const [p, q] = [x[i], y[j]]
            if (p !== '*' && p !== '?' && q !== '*' && q !== '?' && p !== q) return false   // two different literals
            return go(p === '*' ? i : i + 1, q === '*' ? j : j + 1)
        }
        return go(0, 0)
    }
    return variants(a).some((x) => variants(b).some((y) => walk(x, y)))
}

/**
 * OpenCode asks before the bypass forms (it has no hook command): `patterns` become ask rules, in `permissions` when the file already
 * uses the V2 array, else in the V1 `permission.bash` map (V2 reads it too). OpenCode applies the last matching rule, so an ask added
 * after a deny would turn that deny into a prompt (and `opencode --auto` approves prompts): a pattern is skipped, with one note for the
 * render, when ANY deny of the owner's could match a command the pattern also matches (`overlaps`). Otherwise an ask that already
 * decides the pattern is left alone, and anything else gets the ask rule last (a V1 key moves to the end), so a later broader allow cannot win.
 * ponytail: a pattern the guard drops later stays an ask rule; remove it by hand.
 * shortcut: any overlapping deny skips the whole pattern (a `git push --force *` deny also skips `git push * main`): an ask is lost, never a deny; revisit if owners with such denies ask for the ask rules to be placed before them. V1 patterns match parsed commands, V2 each part of a compound command.
 */
export function mergeOpencodeAsk(existing, patterns, base) {
    const obj = existing === null ? { ...base } : parseJson(existing)
    if (!isObject(obj)) return { conflict: obj === undefined ? 'the file is not valid JSON' : 'the file is not a JSON object' }
    const notes = []
    const skipped = [], blockers = new Set()
    const overlapping = (p, denies) => { const hit = denies.filter((g) => overlaps(g, p)); hit.forEach((g) => blockers.add(g)); if (hit.length) skipped.push(p); return hit.length > 0 }
    let next
    if (obj.permissions !== undefined) {
        if (!Array.isArray(obj.permissions)) return { conflict: 'permissions is not a list' }
        const shellRules = obj.permissions.filter((r) => typeof r?.action === 'string' && typeof r.resource === 'string' && globRe(r.action).test('shell')).map((r) => [r.resource, r.effect])
        const denies = shellRules.filter(([, e]) => e === 'deny').map(([g]) => g)
        const add = []
        for (const p of patterns) {
            if (overlapping(p, denies)) continue
            if (decider([...shellRules, ...add.map((r) => [r.resource, 'ask'])], p)?.[1] !== 'ask') add.push({ action: 'shell', resource: p, effect: 'ask' })
        }
        next = add.length ? { ...obj, permissions: [...obj.permissions, ...add] } : obj
    } else {
        const perm = typeof obj.permission === 'string' ? { '*': obj.permission } : obj.permission ?? {}
        const bash = typeof perm.bash === 'string' ? { '*': perm.bash } : perm.bash ?? {}
        if (!isObject(perm) || !isObject(bash)) return { conflict: 'permission (or permission.bash) is not an object' }
        const general = typeof perm['*'] === 'string' ? [['*', perm['*']]] : []   // the action-wide rule is the fallback under the bash rules
        const denies = [...general, ...Object.entries(bash)].filter(([, e]) => e === 'deny').map(([g]) => g)
        const merged = { ...bash }
        for (const p of patterns) {
            if (overlapping(p, denies)) continue
            if (decider([...general, ...Object.entries(merged)], p)?.[1] === 'ask') continue
            if (merged[p] !== undefined && merged[p] !== 'ask') notes.push(`permission.bash[${JSON.stringify(p)}] was ${JSON.stringify(merged[p])}, now "ask" (moved last)`)
            delete merged[p]
            merged[p] = 'ask'
        }
        next = JSON.stringify(merged) === JSON.stringify(bash) ? obj : { ...obj, permission: { ...perm, bash: merged } }
    }
    if (skipped.length) notes.unshift(`kept your deny rule${blockers.size > 1 ? 's' : ''} ${[...blockers].map((g) => JSON.stringify(g)).join(', ')}: no ask rule was added for the pattern${skipped.length > 1 ? 's' : ''} ${skipped.map((p) => JSON.stringify(p)).join(', ')} (a deny of yours could match a command they also match)`)
    return { text: existing !== null && JSON.stringify(next) === JSON.stringify(obj) ? existing : json(next), notes }
}

/**
 * The job-level `runs-on` entry of a managed block in the existing workflow, verbatim: the key line at the job's indent (4 spaces)
 * and the lines under it, more-indented or a compact `- item` list at the key's indent. The runner is the repo's choice and is kept on
 * every render. `null` when there is no file or no such block yet (render then uses the job's runner, or `ubuntu-latest`).
 * ponytail: a blank line inside a multi-line value ends it; write the value without blank lines.
 */
export function runsOn(existing, part) {
    const body = existing === null ? null : parseBlocks(existing.replaceAll('\r\n', '\n')).find((s) => s.part === part)?.body
    return /^ {4}runs-on:.*(?:\n {4}(?: +\S|- ).*)*/m.exec(body ?? '')?.[0] ?? null
}

/**
 * One template to one file. `existing` is the file's text or null. `ctx`: { cfg, vars, runtimeRel, owned }.
 * Returns { text, notes, owns? } or { conflict, proposal } (`proposal` is the text ticketflow would suggest instead).
 */
export function renderFile(file, tpl, existing, { cfg, vars, runtimeRel, owned = {}, alt = null }) {
    const job = file.src === 'ci.yml' ? runsOn(existing, 'job') ?? '    runs-on: ubuntu-latest' : null
    const all = file.src === 'ci.yml' ? { ...vars, runs_on_job: job, runs_on_deploy: runsOn(existing, 'deploy') ?? job } : vars   // a new deploy job runs where the job runs
    const rendered = dropParts(fill(tpl, all), omittedParts(cfg))
    switch (file.kind) {
        case 'blocks': {
            const r = mergeManaged(existing, rendered, omittedParts(cfg))
            if (!r.conflict) return { ...r, notes: [] }
            const blocks = parseBlocks(rendered).filter((s) => s.part).map((s) => s.body).join('')
            return { conflict: r.conflict, proposal: file.propose && !parseBlocks(existing).some((s) => s.part) ? proposeInsert(existing, blocks, file.propose) : { text: rendered } }
        }
        case 'settings': {
            const want = { allow: JSON.parse(rendered).permissions.allow, ask: claudeAsk(cfg, { scriptsDir: `${runtimeRel}/scripts` }) }
            const merge = (text) => mergeClaudeSettings(text, want, owned)
            const r = merge(existing)
            return r.conflict ? { ...r, proposal: merge(null) } : { ...r, owns: want }   // `owns`: what the manifest records as ticketflow's
        }
        case 'hooks': case 'keys': case 'opencode': {
            const template = JSON.parse(rendered)
            const merge = (text) => file.kind === 'hooks' ? mergeHooks(text, template, runtimeRel) : file.kind === 'keys' ? mergeKeys(text, template)
                : mergeOpencodeAsk(text, askPatterns(cfg, { scriptsDir: `${runtimeRel}/scripts` }), template)
            const r = merge(existing)
            if (alt !== null) return { conflict: `${file.alt} exists and has comments or trailing commas ticketflow cannot merge: add the proposed ask rules to it by hand and hold ${file.dest} (render --keep ${file.dest})`, proposal: r.conflict ? { ...merge(null), note: "only ticketflow's entries: merge them into your file by hand; your other settings are not in it" } : r }   // OpenCode reads both files
            return r.conflict ? { ...r, proposal: { ...merge(null), note: "only ticketflow's entries: merge them into your file by hand; your other settings are not in it" } } : r
        }
        case 'owned':
            return existing !== null && !existing.startsWith('# Generated by ticketflow render') ? { conflict: 'the file exists and was not generated by ticketflow render', proposal: { text: rendered } } : { text: rendered, notes: [] }
        case 'once': return { text: existing ?? rendered, notes: [] }
        default: return fail(`unknown file kind ${file.kind}`)
    }
}
