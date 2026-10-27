#!/usr/bin/env node
/**
 * The PreToolUse hook (and its self-test). Reads the hook input as JSON on stdin.
 *
 * Usage: guard.mjs                    the Codex hook: exit 0 = allow, exit 2 = block (the reason is on stderr)
 *        guard.mjs --format <tool>    the same decision in the hook protocol of cursor, gemini, copilot or antigravity (see FORMATS in lib/guard.mjs)
 *        guard.mjs --self-test        checks every example of guard.json against the hook; exit 1 on a mismatch
 *        all take [--config f]
 *
 * Fails closed in every format: malformed input, a shell call without a command, an unknown format or an unloadable guard.json
 * answer with the format's deny and exit 2. An unloadable config
 * falls back to the default branch names main and master, with a warning: it stays strict and never blocks every shell call.
 * This is a speed bump for forms with no legitimate agent use, not a security boundary: see core/docs/SECURITY.md.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { configPath, loadConfig } from '../lib/config.mjs'
import { FORMATS, hookDecision, loadGuard } from '../lib/guard.mjs'

const here = dirname(fileURLToPath(import.meta.url))
let values
try { ({ values } = parseArgs({ options: { 'self-test': { type: 'boolean' }, config: { type: 'string' }, format: { type: 'string' } } })) } catch (e) { console.error(`guard: ${e.message}`); process.exit(2) }

const format = values.format ?? 'codex'
if (!Object.hasOwn(FORMATS, format)) { console.error(`guard: unknown format ${format} (one of ${Object.keys(FORMATS).join(', ')})`); process.exit(2) }

let configs, scriptsDir = '.ticketflow/scripts'
try {
    configs = [loadConfig(values.config ?? configPath(here))]
} catch (e) {
    if (values['self-test']) { console.error(`guard: ${e.message}`); process.exit(2) }
    console.error(`guard: warning: ${e.message}; guarding main and master`)
    configs = ['main', 'master'].map((default_branch) => ({ default_branch }))
}
try {   // `core/scripts` in ticketflow itself, `.ticketflow/scripts` in a user repo
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: here, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    scriptsDir = relative(top, here)
} catch { /* keep the default */ }

const decide = (input, cwd) => { const ds = configs.map((cfg) => hookDecision(input, cfg, { cwd, scriptsDir })); return ds.find((d) => d.block) ?? ds.find((d) => d.ask) ?? { block: false } }
const emit = ({ stdout, stderr, code }) => { process.stdout.write(stdout); process.stderr.write(stderr); process.exitCode = code }
const deny = (reason) => emit({ ...FORMATS[format].output({ block: true, reason }), code: 2 })   // an error always exits 2: the one code every tool treats as a block

try {
    if (values['self-test']) {
        let bad = 0
        for (const f of loadGuard(configs[0], { scriptsDir }).forms) {
            for (const e of f.examples) {
                const got = decide({ tool_name: 'Bash', tool_input: { command: e.cmd } }, '/').block ? 'block' : 'pass'
                if (got !== (e.codex === 'block' ? 'block' : 'pass')) { bad++; console.error(`guard: ${f.id}: "${e.cmd}" is ${got}, the example says ${e.codex}`) }
            }
        }
        if (bad) process.exit(1)
        console.log('guard: every example gives its declared result')
    } else {
        let input
        try { input = JSON.parse(readFileSync(0, 'utf8')) } catch { /* handled below */ }
        if (input === null || typeof input !== 'object' || Array.isArray(input)) deny('the hook input is not a JSON object')
        else {
            const call = FORMATS[format].input(input)
            emit(FORMATS[format].output(decide(call, call.cwd ?? process.cwd())))
        }
    }
} catch (e) {
    deny(e.message)   // any failure blocks: a hook only blocks on exit 2
}
