#!/usr/bin/env node
/**
 * Lists the deliberate shortcuts of a checkout: every tracked-file comment that starts with the marker word and a colon (the older
 * marker word counts too), with its limit and the trigger to revisit it. Read-only; prose without a comment opener is not a marker.
 *
 * Usage: debt.mjs [path...]       (default: the whole checkout, from the current directory)
 * Output: one row per marker, `<file>:<line> <limit>; revisit: <trigger>`, or `<file>:<line> <limit> [no-trigger]` when the text has
 *         no ", " to split limit from trigger; then `<N> shortcuts, <M> without a trigger`, or `No shortcuts.`
 * Exit: 0 = listed (also when none), 2 = usage, or not a git checkout (git grep failed).
 */

import { spawnSync } from 'node:child_process'
import { parseArgs } from 'node:util'
import { main } from '../lib/cli.mjs'

const OPENER = '(#|//|/\\*|\\*|--|;|<!--)'   // shortcut: the common comment openers only, add one here when a language needs it
const MARKER = '[[:space:]]*(shortcut|ponytail):'
const NOTE = /(?:#|\/\/|\/\*|\*|--|;|<!--)\s*(?:shortcut|ponytail):\s*(.*)$/   // the same match in JS: the text after the first marker

main('debt', () => {
    const { positionals } = parseArgs({ allowPositionals: true })
    const r = spawnSync('git', ['grep', '-n', '-I', '-E', OPENER + MARKER, '--', ...(positionals.length ? positionals : ['.'])], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    if (r.error) throw r.error
    if (r.status === 1) {
        console.log('No shortcuts.')
        return 0
    }
    if (r.status !== 0) throw new Error(`git grep failed (not a git checkout, or a bad path): ${r.stderr.trim()}`)
    const rows = r.stdout.split('\n').filter(Boolean).map((line) => {
        const [, at, text] = /^(.+?:\d+):(.*)$/.exec(line)
        const note = NOTE.exec(text)[1].replace(/\s*(\*\/|-->)\s*$/, '').trim()
        const cut = note.indexOf(', ')
        return cut < 0 ? { row: `${at} ${note} [no-trigger]`, bare: true } : { row: `${at} ${note.slice(0, cut)}; revisit: ${note.slice(cut + 2)}`, bare: false }
    })
    for (const { row } of rows) console.log(row)
    console.log(`${rows.length} shortcuts, ${rows.filter((x) => x.bare).length} without a trigger`)
})
