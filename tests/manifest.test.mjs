import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ManifestError, hashBytes, manifestChanges, readManifest, runtimeFiles, runtimeState, writeManifest } from '../core/lib/manifest.mjs'
import { tempDir } from './helpers.mjs'

const H = 'a'.repeat(64)
const at = (dir, text) => { mkdirSync(join(dir, '.ticketflow'), { recursive: true }); writeFileSync(join(dir, '.ticketflow/manifest.json'), text) }

test('readManifest: null when absent; unknown keys, wrong types and paths outside .ticketflow/ are ManifestErrors', () => {
    const dir = tempDir()
    assert.equal(readManifest(dir), null)
    const bad = [
        '{nope', '[]', '{"manifest_version":2}', '{"manifest_version":1,"x":1}', '{"manifest_version":1,"version":"1.0"}',
        `{"manifest_version":1,"files":{"src/a.js":"${H}"}}`, `{"manifest_version":1,"files":{".ticketflow/../a":"${H}"}}`, '{"manifest_version":1,"files":{".ticketflow/a":"zz"}}',
        '{"manifest_version":1,"held":["/abs"]}', `{"manifest_version":1,"files":{".ticketflow/config.json":"${H}"}}`, `{"manifest_version":1,"files":{".ticketflow/custom/x.md":"${H}"}}`, `{"manifest_version":1,"files":{".ticketflow/manifest.json":"${H}"}}`, '{"manifest_version":1,"held":[3]}', '{"manifest_version":1,"claude_settings":{"allow":"x"}}', '{"manifest_version":1,"claude_settings":{"deny":[]}}',
        '{"manifest_version":1,"source":{"url":"u","tag":null,"commit":"abc"}}', '{"manifest_version":1,"source":{"url":"u","tag":null,"commit":"' + 'a'.repeat(40) + '","extra":1}}',
    ]
    for (const text of bad) { at(dir, text); assert.throws(() => readManifest(dir), ManifestError, text) }
    at(dir, JSON.stringify({ manifest_version: 1, version: '1.2.3', files: { '.ticketflow/a': H }, held: ['.github/x.yml'], claude_settings: { allow: ['a'], ask: [] }, source: { url: 'u', tag: null, commit: 'b'.repeat(40) } }))
    assert.equal(readManifest(dir).version, '1.2.3')
})

test('writeManifest replaces only the given keys, sorts everything, and writes the same bytes twice', () => {
    const dir = tempDir()
    assert.equal(writeManifest(dir, { files: { '.ticketflow/b': H, '.ticketflow/a': H }, held: ['z', 'a', 'a'] }), true)
    const first = readFileSync(join(dir, '.ticketflow/manifest.json'), 'utf8')
    assert.ok(first.endsWith('}\n') && first.indexOf('.ticketflow/a') < first.indexOf('.ticketflow/b'))
    assert.deepEqual(readManifest(dir).held, ['a', 'z'])
    assert.equal(writeManifest(dir, { held: ['a', 'z'] }), false)
    assert.equal(manifestChanges(dir, { held: [] }), true)
    writeManifest(dir, { claude_settings: { allow: ['x'], ask: [] } })
    assert.deepEqual(readManifest(dir).held, ['a', 'z']); assert.deepEqual(Object.keys(readManifest(dir).files), ['.ticketflow/a', '.ticketflow/b'])
    writeManifest(dir, { held: undefined })
    assert.equal(readManifest(dir).held, undefined)
    assert.throws(() => writeManifest(dir, { files: { 'outside': H } }), ManifestError)
})

test('hashBytes ignores CRLF; runtimeFiles skips config, manifest and custom and refuses a symlink; runtimeState sorts the findings', () => {
    assert.equal(hashBytes(Buffer.from('a\r\nb\n')), hashBytes(Buffer.from('a\nb\n')))
    assert.notEqual(hashBytes(Buffer.from('a\rb')), hashBytes(Buffer.from('a\nb')))
    const dir = tempDir()
    for (const p of ['scripts/a.mjs', 'lib/b.mjs', 'custom/c.md', 'config.json']) { mkdirSync(join(dir, '.ticketflow', p, '..'), { recursive: true }); writeFileSync(join(dir, '.ticketflow', p), `${p}\n`) }
    writeManifest(dir, { files: { '.ticketflow/lib/b.mjs': hashBytes(Buffer.from('lib/b.mjs\n')), '.ticketflow/scripts/a.mjs': H, '.ticketflow/gone.txt': H } })
    assert.deepEqual(runtimeFiles(dir), ['.ticketflow/lib/b.mjs', '.ticketflow/scripts/a.mjs'])
    const s = runtimeState(dir, readManifest(dir))
    assert.deepEqual([s.ok, s.edited, s.missing, s.untracked], [false, ['.ticketflow/scripts/a.mjs'], ['.ticketflow/gone.txt'], []])
    symlinkSync('/etc/hostname', join(dir, '.ticketflow/lib/link'))
    assert.throws(() => runtimeFiles(dir), /symlink/)
})

test('a symlinked manifest is refused for reading and for writing', () => {
    const dir = tempDir()
    mkdirSync(join(dir, '.ticketflow'))
    symlinkSync(join(dir, 'elsewhere.json'), join(dir, '.ticketflow/manifest.json'))   // dangling
    assert.throws(() => readManifest(dir), /symlink/)
    assert.throws(() => writeManifest(dir, { held: [] }), /symlink/)
    assert.ok(!existsSync(join(dir, 'elsewhere.json')))
})
