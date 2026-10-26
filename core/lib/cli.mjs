/** Shared script entry: arguments + config in one step, and one place that turns an expected failure into exit 2. */

import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { configPath, loadConfig } from './config.mjs'

/**
 * Parses `process.argv` and loads the config. `valid(positionals, values)` says whether the arguments are usable.
 * Any problem prints `name: message` and exits 2 before a single gh call.
 */
export function cli(meta, name, usage, options, valid) {
    try {
        const { values, positionals } = parseArgs({ options: { ...options, config: { type: 'string' } }, allowPositionals: true })
        if (!valid(positionals, values)) throw new Error(`usage: ${name} ${usage}`)
        const configFile = values.config ?? configPath(dirname(fileURLToPath(meta)))
        return { values, positionals, cfg: loadConfig(configFile), configFile }
    } catch (e) {
        console.error(`${name}: ${e.message}`)
        process.exit(2)
    }
}

/** Runs `fn`; its return value is the exit code (default 0). Any error is an API, config or response error: exit 2 (exit 1 is reserved for "drift / not met"). */
export function main(name, fn) {
    try {
        process.exitCode = fn() ?? 0
    } catch (e) {
        console.error(`${name}: ${e.message}`)
        process.exitCode = 2
    }
}
