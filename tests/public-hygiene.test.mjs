import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// The source repos' names, built from char codes so that they do not appear in this file. ticketflow is public.
const NAMES = [[112, 114, 105, 109, 101, 119, 101, 114, 107], [109, 105, 99, 114, 111, 108, 101, 97, 114, 110, 105, 110, 103], [108, 105, 118, 105, 110, 103, 99, 48, 100, 101], [115, 115, 116, 101, 114, 106, 111]].map((codes) => String.fromCharCode(...codes))
// The repo's own slug (owner/ticketflow) is the one allowed mention of the owner, and only in the config and the generated manifests (core/ is copied into user repos).
const OWN_FILES = new Set(['.ticketflow/config.json', '.claude-plugin/plugin.json', '.claude-plugin/marketplace.json', '.codex-plugin/plugin.json', '.agents/plugins/marketplace.json'])
const OWN = `${String.fromCharCode(108, 105, 118, 105, 110, 103, 99, 48, 100, 101)}/ticketflow`
const root = new URL('..', import.meta.url).pathname
const SKIP = new Set(['.git', 'node_modules', 'LICENSE'])   // LICENSE names the copyright holder, the owner's choice

function files(dir) {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name)
        return SKIP.has(name) ? [] : statSync(path).isDirectory() ? files(path) : [path]
    })
}

test('no source repo or owner name appears anywhere in the repository', () => {
    const hits = []
    for (const path of files(root)) {
        const text = readFileSync(path, 'utf8').toLowerCase().replaceAll(OWN_FILES.has(path.slice(root.length)) ? OWN : '\0', '')
        for (const name of NAMES) if (text.includes(name)) hits.push(`${path.slice(root.length)}: ${name.length} chars`)
    }
    assert.deepEqual(hits, [])
})
