/**
 * The agent guard. `core/guard.json` is the single list of bypass forms; this file renders it into the Claude ask rules, the
 * Codex prefix rules and the hook decision (also used, through FORMATS, by the Cursor, Gemini CLI, Copilot and Antigravity hooks), so they never drift. See core/docs/SECURITY.md for what it does not cover.
 *
 * Placeholders in guard.json: `{default_branch}` (regex-escaped inside `hook_block`), `{scripts_dir}` (where the ticketflow scripts are
 * in the checkout: `.ticketflow/scripts`, or `core/scripts` in ticketflow itself) and `{write}` (a regex for "this gh api call writes").
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

export class GuardError extends Error {
    name = 'GuardError'
}

const GUARD_FILE = new URL('../guard.json', import.meta.url)
const WRITE = String.raw`\s-[fF]|\s--(?:field|raw-field|input)\b|\s(?:-X|--method)[ =]?\s*(?:POST|PUT|PATCH|DELETE)`
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
const fail = (m) => { throw new GuardError(m) }

/** Reads, renders and validates guard.json for `cfg.default_branch`. */
export function loadGuard(cfg, { scriptsDir = '.ticketflow/scripts', file = GUARD_FILE } = {}) {
    let raw
    try { raw = JSON.parse(readFileSync(file, 'utf8')) } catch (e) { return fail(`cannot read guard.json: ${e.message}`) }
    if (raw?.version !== 1 || !Array.isArray(raw.forms)) fail('guard.json: version must be 1 and forms a list')
    const b = cfg.default_branch
    const text = (s) => s.replaceAll('{default_branch}', b).replaceAll('{scripts_dir}', scriptsDir)
    const regexText = (s) => s.replaceAll('{write}', WRITE).replaceAll('{default_branch}', escapeRe(b)).replaceAll('{scripts_dir}', escapeRe(scriptsDir))
    const seen = new Set()
    const forms = raw.forms.map((f) => {
        for (const k of ['claude_ask', 'codex_prompt', 'hook_block', 'hook_check']) if (!Array.isArray(f?.[k])) fail(`guard.json: form ${f?.id} needs a list ${k}`)
        if (typeof f.id !== 'string' || seen.has(f.id)) fail(`guard.json: duplicate or missing form id ${f.id}`)
        seen.add(f.id)
        if (typeof f.reason !== 'string' || !f.reason) fail(`guard.json: form ${f.id} has no reason`)
        if (!Array.isArray(f.examples) || f.examples.length === 0) fail(`guard.json: form ${f.id} has no examples`)
        for (const e of f.examples) {
            if (typeof e.cmd !== 'string' || !['ask', 'pass'].includes(e.claude) || !['prompt', 'block', 'pass'].includes(e.codex)) fail(`guard.json: form ${f.id} has a bad example ${JSON.stringify(e)}`)
        }
        return {
            id: f.id, reason: text(f.reason), claude_ask: f.claude_ask.map(text),
            codex_prompt: f.codex_prompt.map((p) => p.map((t) => (Array.isArray(t) ? t.map(text) : text(t)))),
            hook_block: f.hook_block.map((s) => { try { return new RegExp(regexText(s), 'i') } catch (e) { return fail(`guard.json: form ${f.id} has a bad regex: ${e.message}`) } }),
            hook_check: f.hook_check,
            examples: f.examples.map((e) => ({ ...e, cmd: text(e.cmd) })),
        }
    })
    for (const f of forms) for (const name of f.hook_check) if (!CHECKS[name]) fail(`guard.json: form ${f.id} has an unknown check ${name}`)
    return { forms }
}

/** The shell patterns that make the bypass forms ask (Claude Code wraps them in `Bash(...)`; OpenCode uses them as they are). */
export const askPatterns = (cfg, opts) => loadGuard(cfg, opts).forms.flatMap((f) => f.claude_ask)

/** The Claude Code permission rules that make the bypass forms ask. */
export const claudeAsk = (cfg, opts) => askPatterns(cfg, opts).map((p) => `Bash(${p})`)

/** Words of a command, with quotes removed. */
export function tokenize(s) {
    return [...s.matchAll(/(?:[^\s"']+|"(?:[^"\\]|\\.)*"|'[^']*')+/g)].map((m) => m[0].replace(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g, (_, d, q) => d ?? q))
}
const matchesPrefix = (tokens, pattern) => pattern.length <= tokens.length && pattern.every((p, i) => (Array.isArray(p) ? p.includes(tokens[i]) : p === tokens[i]))

/** The text of a Codex `.rules` file: one prompt rule per pattern. */
export function codexRules(cfg, opts) {
    const rules = []
    for (const f of loadGuard(cfg, opts).forms) {
        for (const pattern of f.codex_prompt) {
            const match = f.examples.filter((e) => e.codex === 'prompt' && matchesPrefix(tokenize(e.cmd), pattern)).map((e) => e.cmd)
            const notMatch = f.examples.filter((e) => !matchesPrefix(tokenize(e.cmd), pattern)).map((e) => e.cmd)
            rules.push(['prefix_rule(', `    pattern = ${JSON.stringify(pattern)},`, '    decision = "prompt",', `    justification = ${JSON.stringify(f.reason)},`,
                ...(match.length ? [`    match = ${JSON.stringify(match)},`] : []), ...(notMatch.length ? [`    not_match = ${JSON.stringify(notMatch)},`] : []), ')'].join('\n'))
        }
    }
    return `# Generated from core/guard.json: do not edit.\n${rules.join('\n\n')}\n`
}

/** Removes the bodies of heredocs (`<<EOF` ... `EOF`): they are text, not commands. */
export function stripHeredocs(command) {
    const out = []
    let end = null
    for (const line of command.split('\n')) {
        if (end !== null) { if (line.trim() === end) end = null; continue }
        out.push(line)
        const m = /(?<!<)<<-?(?!<)\s*(['"]?)([A-Za-z_]\w*)\1/.exec(line)   // not a here-string (<<<)
        const before = m ? line.slice(0, m.index) : ''
        const plain = (before.match(/'/g) ?? []).length % 2 === 0 && (before.match(/"/g) ?? []).length % 2 === 0 && !/(^|\s)#/.test(before)   // not in quotes or a comment
        if (m && plain) end = m[2]
    }
    return out.join('\n')
}

const VALUE_FLAGS = new Set(['-f', '-F', '--field', '--raw-field', '-H', '--header', '-q', '--jq', '--input', '-t', '--template'])
/**
 * What the REST patterns look at for a `gh api` call: the call without the values of its fields, headers and body files, so that
 * a comment that merely mentions "rulesets" is not a ruleset write. A GraphQL call keeps its text (the mutation name is in it).
 */
function apiSubject(tokens, segment) {
    const view = []
    let endpoint = null
    for (let i = 2; i < tokens.length; i++) {
        const t = tokens[i]
        if (['-X', '--method', '--hostname'].includes(t)) { view.push(t, tokens[++i] ?? ''); continue }
        if (VALUE_FLAGS.has(t)) { view.push(t); i++; continue }
        if (/^-[fF]./.test(t)) { view.push(t.slice(0, 2)); continue }
        if (/^--(field|raw-field|input|header|jq|template)=/.test(t)) { view.push(t.split('=')[0]); continue }
        if (!t.startsWith('-') && endpoint === null) endpoint = t
        view.push(t)
    }
    return endpoint === 'graphql' ? `gh api graphql ${segment}` : `gh api ${view.join(' ')}`   // graphql first, whatever options came before it
}

/** Splits on && || ; | and newlines outside quotes. */
export function segments(command) {
    const out = []
    let cur = '', quote = null
    for (let i = 0; i < command.length; i++) {
        const c = command[i]
        if (quote) { cur += c; if (c === '\\' && quote === '"') cur += command[++i] ?? ''; else if (c === quote) quote = null }
        else if (c === '"' || c === "'") { quote = c; cur += c }
        else if (c === '\\') cur += c + (command[++i] ?? '')
        else if (';|&\n'.includes(c)) { out.push(cur); cur = ''; if ((c === '&' || c === '|') && command[i + 1] === c) i++ }
        else cur += c
    }
    return [...out, cur].map((s) => s.trim()).filter(Boolean)
}

const CHECKS = {
    /** `git push` with no refspec (or HEAD) while the checkout is on the default branch. */
    'bare-push-on-default'(tokens, { cwd, cfg }) {
        if (tokens[0] !== 'git' || tokens[1] !== 'push') return false
        const positional = tokens.slice(2).filter((t) => !t.startsWith('-'))
        if (!(positional.length <= 1 || (positional.length === 2 && positional[1] === 'HEAD'))) return false
        // shortcut: reads the hook's cwd only (a `git -C <dir> push` is not followed), parse -C when a host runs git from another directory
        try { return execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() === cfg.default_branch } catch { return false }
    },
}

/**
 * What a PreToolUse hook does with a tool call: `{ block: true, reason, form }`, `{ block: false, ask: true, reason, form }` or
 * `{ block: false }`. A hook_block or hook_check hit blocks, anywhere in the command. A command that a Codex prompt rule matches is
 * an `ask`: Codex ignores it (its rule asks), the tools with an ask of their own use it. `input` is the parsed hook input (see FORMATS);
 * `command` may be a string or argv.
 */
export function hookDecision(input, cfg, { cwd = process.cwd(), scriptsDir } = {}) {
    if (input?.tool_name !== 'Bash') return { block: false }
    let command = input.tool_input?.command
    if (Array.isArray(command)) command = command.length === 3 && /(^|\/)(sh|bash|zsh)$/.test(command[0]) && /^-l?c$/.test(command[1]) ? command[2] : command.map((t) => (/^[\w@%+=:,./-]+$/.test(t) ? t : `'${String(t).replaceAll("'", "'\\''")}'`)).join(' ')
    if (typeof command !== 'string' || command.trim() === '') return { block: true, reason: 'a Bash tool call without a command cannot be checked' }
    const guard = loadGuard(cfg, { scriptsDir })
    let ask = null
    for (const raw of segments(stripHeredocs(command))) {
        const segment = raw.replace(/^(?:[A-Za-z_]\w*=\S*\s+)+/, '')
        const tokens = tokenize(segment)
        const subject = tokens[0] === 'gh' && tokens[1] === 'api' ? apiSubject(tokens, segment) : tokens.join(' ')   // quotes removed: `"main"` is main
        for (const f of guard.forms) {
            if (f.codex_prompt.some((p) => matchesPrefix(tokens, p))) { ask ??= { reason: f.reason, form: f.id }; continue }
            if (f.hook_block.some((re) => re.test(subject)) || f.hook_check.some((name) => CHECKS[name](tokens, { cwd, cfg }))) return { block: true, reason: f.reason, form: f.id }
        }
    }
    return ask ? { block: false, ask: true, ...ask } : { block: false }
}

const out = (stdout = '', stderr = '', code = 0) => ({ stdout, stderr, code })
const line = (x) => JSON.stringify(x) + '\n'
const asJson = (v) => { if (typeof v !== 'string') return v; try { return JSON.parse(v) } catch { return undefined } }
const shell = (command, cwd) => ({ tool_name: 'Bash', tool_input: { command }, cwd })

/**
 * One adapter per tool with a hook: `input(raw)` turns the tool's hook payload into the `{ tool_name: 'Bash', tool_input: { command }, cwd }`
 * that hookDecision reads (a shell call without a readable command stays a Bash call, so it blocks; any other tool passes), and
 * `output(d)` turns a decision into `{ stdout, stderr, code }`. Every deny that comes from an error exits 2 (script/guard.mjs).
 */
export const FORMATS = {
    codex: {
        input: (raw) => raw,
        output: (d) => (d.block ? out('', `guard: blocked: ${d.reason}\n`, 2) : out()),
    },
    cursor: {   // beforeShellExecution: always a shell command; permission allow / ask / deny
        input: (raw) => shell(raw?.command, raw?.cwd),
        output: (d) => out(line(d.block ? { permission: 'deny', user_message: d.reason, agent_message: d.reason } : d.ask ? { permission: 'ask', user_message: d.reason, agent_message: d.reason } : { permission: 'allow' })),
    },
    gemini: {   // BeforeTool: exit 2 blocks, stderr is the reason; Gemini has no project-level ask, so a prompt form is denied
        input: (raw) => (typeof raw?.tool_name !== 'string' || raw.tool_name === 'run_shell_command' ? shell(raw?.tool_input?.command, raw?.cwd) : { tool_name: raw.tool_name }),   // the matcher sends shell calls only: no tool name is a changed protocol, so it is checked
        output: (d) => (d.block ? out('', `guard: blocked: ${d.reason}\n`, 2) : d.ask ? out('', `guard: blocked: ${d.reason} Gemini CLI cannot ask for this: ask the owner to run it\n`, 2) : out('{}\n')),
    },
    // shortcut: tool-name guesses for a payload without a command string, drop them when the harness docs fix the names
    copilot: {   // PreToolUse: any payload that carries a command string is a shell call, whatever the harness calls the tool
        input(raw) {
            const args = asJson(raw?.tool_input ?? raw?.toolArgs)
            const name = raw?.tool_name ?? raw?.toolName
            const named = typeof name !== 'string' || /bash|shell|terminal|powershell|execute/i.test(name)   // no tool name at all: checked as a shell call
            return typeof args?.command === 'string' || named ? shell(args?.command, raw?.cwd) : { tool_name: name }
        },
        output: (d) => (d.block ? out('', `guard: blocked: ${d.reason}\n`, 2) : d.ask ? out(line({ permissionDecision: 'ask', permissionDecisionReason: d.reason })) : out()),
    },
    antigravity: {   // PreToolUse on run_command; decision allow / force_ask / deny
        input: (raw) => (typeof raw?.toolCall?.name !== 'string' || raw.toolCall.name === 'run_command' ? shell(raw?.toolCall?.args?.CommandLine, raw?.toolCall?.args?.Cwd) : { tool_name: raw.toolCall.name }),   // no tool name: checked, like gemini
        output: (d) => out(line(d.block ? { decision: 'deny', reason: d.reason } : d.ask ? { decision: 'force_ask', reason: d.reason } : { decision: 'allow' })),
    },
}
