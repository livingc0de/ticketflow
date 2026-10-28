import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handleDownload } from '../src/handler.js'

test('serves an uploaded file, also from a sub-folder, and 404s a missing one', () => {
    const root = mkdtempSync(join(tmpdir(), 'uploads-'))
    mkdirSync(join(root, '2026'))
    writeFileSync(join(root, 'a.txt'), 'A')
    writeFileSync(join(root, '2026', 'b.txt'), 'B')
    assert.equal(handleDownload(root, 'a.txt').body, 'A')
    assert.equal(handleDownload(root, '2026/b.txt').body, 'B')
    assert.equal(handleDownload(root, 'missing.txt').status, 404)
})
