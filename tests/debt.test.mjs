import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tempDir } from './helpers.mjs'

const script = new URL('../core/scripts/debt.mjs', import.meta.url).pathname
// the markers are built, not written, so this file holds none for debt.mjs to find in the repo
const SC = 'short' + 'cut:', PT = 'pony' + 'tail:'

/** A temp git repo with the given tracked files (and `untracked` ones that are not added). */
function repo(files, untracked = {}) {
    const dir = tempDir('debt-')
    spawnSync('git', ['init', '-q', dir])
    for (const [name, text] of Object.entries({ ...files, ...untracked })) {
        mkdirSync(dirname(join(dir, name)), { recursive: true })
        writeFileSync(join(dir, name), text)
    }
    for (const name of Object.keys(files)) spawnSync('git', ['add', name], { cwd: dir })
    return dir
}
const debt = (cwd, ...args) => spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' })

test('lists a marker per comment style with its limit and trigger, and counts them', () => {
    const dir = repo({
        'a.js': `const x = 1\n// ${SC} one page of 100, page it when a list outgrows that\n`,
        'b.py': `# ${SC} global lock, per-account locks if throughput matters\n`,
        'c.sql': `select 1; -- ${SC} full scan, add an index at 1M rows\n`,
        'd.css': `/* ${SC} fixed width, make it fluid, when a table needs it */\n`,
        'e.html': `<!-- ${SC} inline style, move to the sheet when a second page needs it -->\n`,
    })
    const r = debt(dir)
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.stdout, [
        'a.js:2 one page of 100; revisit: page it when a list outgrows that',
        'b.py:1 global lock; revisit: per-account locks if throughput matters',
        'c.sql:1 full scan; revisit: add an index at 1M rows',
        'd.css:1 fixed width; revisit: make it fluid, when a table needs it',
        'e.html:1 inline style; revisit: move to the sheet when a second page needs it',
        '5 shortcuts, 0 without a trigger',
        '',
    ].join('\n'))
})

test('a marker without ", <trigger>" is flagged, and the older marker word counts too; JSDoc continuation lines count', () => {
    const dir = repo({ 'a.js': `// ${PT} no paging past 100 rulesets\n/**\n * ${SC} first match only, all matches when a caller needs them\n */\n` })
    const r = debt(dir)
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.stdout, 'a.js:1 no paging past 100 rulesets [no-trigger]\na.js:3 first match only; revisit: all matches when a caller needs them\n2 shortcuts, 1 without a trigger\n')
})

test('prose without a comment prefix, an untracked file and a binary file are ignored; no marker says so', () => {
    const dir = repo({ 'notes.md': `Write \`${SC} <limit>, <trigger>\` in a comment, or say ${SC} in prose.\n`, 'img.bin': `\0 // ${SC} x, y\n` }, { 'new.js': `// ${SC} a, b\n` })
    const r = debt(dir)
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.stdout, 'No shortcuts.\n')
})

test('a marker word in prose, a bullet, bold text or a string literal is not a marker; an indented block-comment line and an ini comment are', () => {
    const dir = repo({
        'notes.md': `A decision; ${SC} x, y\n* ${SC} a bullet, y\n**${SC}** bold, y\n`,
        'a.js': `const s = '// ${SC} a, b'\nconst t = "# ${SC} c, d"\nconst u = \`// ${SC} e, f\`\nrun("x") // ${SC} real one, but add a trigger\n`,
        'b.ini': `; ${SC} fixed list, make it a glob if it grows\n`,
        'c.js': `/**\n  * ${SC} indented line, revisit\n */\n`,
    })
    const r = debt(dir)
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.stdout, 'a.js:4 real one; revisit: but add a trigger\nb.ini:1 fixed list; revisit: make it a glob if it grows\nc.js:2 indented line; revisit: revisit\n3 shortcuts, 0 without a trigger\n')
})

test('a non-ASCII path and a path with ":12:" in it are printed verbatim and split right', () => {
    const dir = repo({ 'ä.js': `// ${SC} a, b\n`, 'x:12:y.py': `# ${SC} c, d\n` })
    const r = debt(dir)
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.stdout, 'x:12:y.py:1 c; revisit: d\nä.js:1 a; revisit: b\n2 shortcuts, 0 without a trigger\n')
})

test('paths limit the scan', () => {
    const dir = repo({ 'src/a.js': `// ${SC} a, b\n`, 'lib/b.js': `// ${SC} c, d\n` })
    assert.equal(debt(dir, 'src').stdout, 'src/a.js:1 a; revisit: b\n1 shortcuts, 0 without a trigger\n')
})

test('outside a git checkout, with a path that is outside or does not exist, or an unknown option: exit 2 and nothing on stdout', () => {
    const plain = tempDir('debt-plain-')
    writeFileSync(join(plain, 'a.js'), `// ${SC} a, b\n`)
    for (const [cwd, args] of [[plain, []], [repo({ 'a.js': 'x\n' }), ['../outside']], [repo({ 'a.js': 'x\n' }), ['srcc']], [repo({ 'a.js': 'x\n' }), ['--bogus']]]) {
        const r = debt(cwd, ...args)
        assert.equal(r.status, 2, `${args}: ${r.stdout}${r.stderr}`)
        assert.equal(r.stdout, '')
        assert.match(r.stderr, /^debt: /)
    }
})
