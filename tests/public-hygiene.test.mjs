import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// The source repos' names, built from char codes so that they do not appear in this file. ticketflow is public.
const NAMES = [[112, 114, 105, 109, 101, 119, 101, 114, 107], [109, 105, 99, 114, 111, 108, 101, 97, 114, 110, 105, 110, 103], [108, 105, 118, 105, 110, 103, 99, 48, 100, 101], [115, 115, 116, 101, 114, 106, 111]].map((codes) => String.fromCharCode(...codes))
// The repo's own slug (owner/ticketflow) is the one allowed mention of the owner, but not in core/ or practices/, which are copied into user repos.
const OWN = `${String.fromCharCode(108, 105, 118, 105, 110, 103, 99, 48, 100, 101)}/ticketflow`
// The config's schema requires project.owner, which for this repo is the owner's login: the one other allowed mention, in the config only.
const OWN_PROJECT = `"owner": "${String.fromCharCode(108, 105, 118, 105, 110, 103, 99, 48, 100, 101)}"`
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
        const rel = path.slice(root.length)
        let text = readFileSync(path, 'utf8').toLowerCase().replaceAll(/^(core|practices)\//.test(rel) ? '\0' : OWN, '')
        if (rel === '.ticketflow/config.json') text = text.replaceAll(OWN_PROJECT, '')
        for (const name of NAMES) if (text.includes(name)) hits.push(`${rel}: ${name.length} chars`)
    }
    assert.deepEqual(hits, [])
})
