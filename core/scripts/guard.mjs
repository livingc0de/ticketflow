#!/usr/bin/env node
/**
 * The Codex PreToolUse hook (and its self-test). Reads the hook input as JSON on stdin.
 *
 * Usage: guard.mjs                 exit 0 = allow, exit 2 = block (the reason is on stderr)
 *        guard.mjs --self-test     checks every example of guard.json against the hook; exit 1 on a mismatch
 *        both take [--config f]
 *
 * Fails closed: malformed input, a Bash call without a command or an unloadable guard.json block (exit 2). An unloadable config
 * falls back to the default branch names main and master, with a warning: it stays strict and never blocks every shell call.
 * This is a speed bump for forms with no legitimate agent use, not a security boundary: see core/docs/SECURITY.md.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { configPath, loadConfig } from '../lib/config.mjs'
import { hookDecision, loadGuard } from '../lib/guard.mjs'

const here = dirname(fileURLToPath(import.meta.url))
let values
try { ({ values } = parseArgs({ options: { 'self-test': { type: 'boolean' }, config: { type: 'string' } } })) } catch (e) { console.error(`guard: ${e.message}`); process.exit(2) }

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

const decide = (input, cwd) => configs.map((cfg) => hookDecision(input, cfg, { cwd, scriptsDir })).find((d) => d.block) ?? { block: false }

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
        if (input === null || typeof input !== 'object' || Array.isArray(input)) { console.error('guard: blocked: the hook input is not a JSON object'); process.exit(2) }
        const d = decide(input, input?.cwd ?? process.cwd())
        if (d.block) { console.error(`guard: blocked: ${d.reason}`); process.exit(2) }
    }
} catch (e) {
    console.error(`guard: blocked: ${e.message}`)   // any failure blocks: a hook only blocks on exit 2
    process.exit(2)
}
