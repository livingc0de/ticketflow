import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const docs = ['README.md', ...readdirSync(join(root, 'core/docs')).filter((f) => f.endsWith('.md')).map((f) => `core/docs/${f}`)]

test('every relative link in README.md and core/docs/*.md resolves', () => {
    const broken = []
    for (const doc of docs) {
        for (const [, target] of readFileSync(join(root, doc), 'utf8').matchAll(/\]\(([^)\s]+)\)/g)) {
            if (/^[a-z]+:|^#/.test(target)) continue
            const path = join(root, dirname(doc), target.split('#')[0])
            // core/docs is copied into user repos: its links must stay inside it
            if (!existsSync(path) || (doc.startsWith('core/docs/') && relative(join(root, 'core/docs'), path).startsWith('..'))) broken.push(`${doc}: ${target}`)
        }
    }
    assert.deepEqual(broken, [])
})
