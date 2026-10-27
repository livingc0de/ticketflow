#!/usr/bin/env node
/**
 * Lists the deliberate shortcuts of a checkout: every tracked-file comment that starts with the marker word and a colon (the older
 * marker word counts too), with its limit and the trigger to revisit it. Read-only. Prose, a bullet, bold text, a marker after a
 * word-glued `;` or `--` and a marker inside a string literal on its line are not markers.
 *
 * Usage: debt.mjs [path...]       (default: the current directory; each path must exist)
 * Output: one row per marker, `<file>:<line> <limit>; revisit: <trigger>`, or `<file>:<line> <limit> [no-trigger]` when the text has
 *         no ", " to split limit from trigger; then `<N> shortcuts, <M> without a trigger`, or `No shortcuts.`
 * Exit: 0 = listed (also when none), 2 = usage, a path that does not exist, or not a git checkout (git grep failed).
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { main } from '../lib/cli.mjs'

// the openers: `;` and `--` only after whitespace (not glued to a word), ` *` only as an indented block-comment line, so prose and bullets are not markers
// shortcut: the common comment openers only, add one here when a language needs it
const MARKER = /(?:#|\/\/|\/\*|<!--|(?<!\S)(?:;|--)|(?<=^\s+)\*)\s*(?:shortcut|ponytail):\s*(.*)$/
// shortcut: a quote count decides "inside a string" (a quote in prose before a real marker hides it), parse strings per language if that bites
const inString = (before) => ['"', "'", '`'].some((q) => (before.split(q).length - 1) % 2 === 1)

main('debt', () => {
    const { positionals } = parseArgs({ allowPositionals: true })
    for (const p of positionals) if (!existsSync(p)) throw new Error(`${p}: no such file or directory`)
    const r = spawnSync('git', ['grep', '--no-color', '-z', '-n', '-I', '-E', '(shortcut|ponytail):', '--', ...(positionals.length ? positionals : ['.'])], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    if (r.error) throw r.error
    if (r.status !== 0 && r.status !== 1) throw new Error(`git grep failed (not a git checkout, or a bad path): ${r.stderr.trim()}`)
    const rows = []
    // -z prints `<path>\0<line>\0<text>\n` with the path verbatim: read it field by field, never split on ":"
    for (let i = 0; i < r.stdout.length;) {
        const a = r.stdout.indexOf('\0', i), b = r.stdout.indexOf('\0', a + 1), end = r.stdout.indexOf('\n', b + 1)
        const [file, line, text] = [r.stdout.slice(i, a), r.stdout.slice(a + 1, b), r.stdout.slice(b + 1, end < 0 ? undefined : end)]
        i = end < 0 ? r.stdout.length : end + 1
        const m = MARKER.exec(text)
        if (!m || inString(text.slice(0, m.index))) continue
        const note = m[1].replace(/\s*(\*\/|-->)\s*$/, '').trim()
        const cut = note.indexOf(', ')
        rows.push(cut < 0 ? { row: `${file}:${line} ${note} [no-trigger]`, bare: true } : { row: `${file}:${line} ${note.slice(0, cut)}; revisit: ${note.slice(cut + 2)}`, bare: false })
    }
    if (rows.length === 0) {
        console.log('No shortcuts.')
        return 0
    }
    for (const { row } of rows) console.log(row)
    console.log(`${rows.length} shortcuts, ${rows.filter((x) => x.bare).length} without a trigger`)
})
