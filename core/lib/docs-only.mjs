/**
 * Is a pull request's whole diff docs-only? See core/docs/CONFIG.md (`docs_only`).
 *
 * Every path must match a configured docs pattern and no code pattern (the configured ones plus the built-in floor). Anything
 * unlisted, an empty list, or a control character in a name is code, so a doubt runs everything.
 *
 * Usage: git diff -z --no-renames --name-only <base> <head> | node docs-only.mjs [--config f]   (prints docs=true|false)
 * A config error exits non-zero with nothing on stdout, which callers read as "run everything".
 */

import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { configPath, loadConfig, NEVER_DOCS } from './config.mjs'

const CONTROL = /[\u0000-\u001f\u007f]/

export const docsOnly = (paths, cfg) => {
    const code = [...NEVER_DOCS, ...cfg.docs_only.code]
    return paths.length > 0 && paths.every((p) => cfg.docs_only.docs.some((r) => r.test(p)) && !code.some((r) => r.test(p)) && !CONTROL.test(p))
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    try {
        const { values } = parseArgs({ options: { config: { type: 'string' } }, strict: true })
        const cfg = loadConfig(values.config ?? configPath(dirname(fileURLToPath(import.meta.url))))
        console.log(`docs=${docsOnly(readFileSync(0, 'utf8').split('\0').filter(Boolean), cfg)}`)
    } catch (e) {
        console.error(`docs-only: ${e.message}`)
        process.exit(2)
    }
}
