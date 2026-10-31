import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// The source repos' names, built from char codes so that they do not appear in this file. ticketflow is public.
const NAMES = [[112, 114, 105, 109, 101, 119, 101, 114, 107], [109, 105, 99, 114, 111, 108, 101, 97, 114, 110, 105, 110, 103], [108, 105, 118, 105, 110, 103, 99, 48, 100, 101], [115, 115, 116, 101, 114, 106, 111]].map((codes) => String.fromCharCode(...codes))
// The repo's own slug (owner/ticketflow) is the one allowed mention of the owner, but not in core/ or practices/, which are copied into user repos.
const OWN = `${NAMES[2]}/ticketflow`
// The config's schema requires project.owner, which for this repo is the owner's login: the one other allowed mention, in the config only.
const OWN_PROJECT = `"owner": "${NAMES[2]}"`
const root = new URL('..', import.meta.url).pathname
// Scan the public source set, not ignored local benchmark output. Tracked files
// remain included even if a later ignore rule accidentally mentions them.
function files(dir) {
    return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: dir })
        .toString('utf8').split('\0').filter(Boolean).filter((rel) => rel !== 'LICENSE')
        .map((rel) => join(dir, rel))
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
