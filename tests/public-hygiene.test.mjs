import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// The source repos' names, built from char codes so that they do not appear in this file. ticketflow is public.
const NAMES = [[112, 114, 105, 109, 101, 119, 101, 114, 107], [109, 105, 99, 114, 111, 108, 101, 97, 114, 110, 105, 110, 103], [108, 105, 118, 105, 110, 103, 99, 48, 100, 101], [115, 115, 116, 101, 114, 106, 111]].map((codes) => String.fromCharCode(...codes))
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
        const text = readFileSync(path, 'utf8').toLowerCase()
        for (const name of NAMES) if (text.includes(name)) hits.push(`${path.slice(root.length)}: ${name.length} chars`)
    }
    assert.deepEqual(hits, [])
})
