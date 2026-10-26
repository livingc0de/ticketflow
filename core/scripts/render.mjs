#!/usr/bin/env node
/**
 * Renders the ticketflow templates into the files of a repo: CI workflow, issue forms, PR template, AGENTS block, agent settings.
 *
 * Usage: render.mjs <templates-dir> <target-repo> [--check] [--keep <path>]... [--propose <dir>]
 *   <templates-dir> is `core/templates` in the ticketflow repo (then the runtime is `core/`), anywhere else for a user repo
 *   (the runtime is `.ticketflow/`). The config is <target-repo>/.ticketflow/config.json.
 *   --keep <path>     leave that file (repo-relative, one of the rendered files) alone: not written, not checked; printed as `kept`
 *   --propose <dir>   for each conflict write the suggested file to <dir>/<path>; <dir> must be outside the target
 * Exit: 0 = written, or in sync; 1 = a conflict (nothing is written) or, with --check, drift; 2 = usage, config or template error.
 */

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'
import { main } from '../lib/cli.mjs'
import { loadConfig } from '../lib/config.mjs'
import { FILES, renderFile, templateVars } from '../lib/render.mjs'

const usage = 'usage: render <templates-dir> <target-repo> [--check] [--keep <path>]... [--propose <dir>]'
const inside = (parent, child) => { const r = relative(parent, child); return r !== '' && r !== '..' && !r.startsWith('..' + sep) && !isAbsolute(r) }
/** The real path of `p`, or of its nearest existing ancestor plus the rest: a symlink cannot hide where a directory really is. */
const real = (p) => (existsSync(p) ? realpathSync(p) : join(real(dirname(p)), basename(p)))

main('render', () => {
    const { values, positionals } = parseArgs({ options: { check: { type: 'boolean' }, keep: { type: 'string', multiple: true }, propose: { type: 'string' } }, allowPositionals: true })
    if (positionals.length !== 2) throw new Error(usage)
    const templates = resolve(positionals[0]), target = resolve(positionals[1])
    const keep = new Set(values.keep ?? [])
    for (const k of keep) if (!FILES.some((f) => f.dest === k)) throw new Error(`--keep ${k}: not a rendered file`)
    const propose = values.propose === undefined ? null : resolve(values.propose)
    if (propose !== null && (real(propose) === real(target) || inside(real(target), real(propose)))) throw new Error('--propose must be a directory outside the target repo')
    const runtimeRel = templates === join(target, 'core', 'templates') ? 'core' : '.ticketflow'
    const cfg = loadConfig(join(target, '.ticketflow', 'config.json'))
    const vars = templateVars(cfg, { runtimeRel })
    let owned = {}
    try { owned = JSON.parse(readFileSync(join(target, '.ticketflow', 'manifest.json'), 'utf8')).claude_settings ?? {} } catch { /* no manifest yet */ }

    // compute everything first
    const results = FILES.filter((f) => !keep.has(f.dest)).map((f) => {
        const path = join(target, f.dest)
        const existing = existsSync(path) ? readFileSync(path, 'utf8') : null
        return { f, existing, ...renderFile(f, readFileSync(join(templates, f.src), 'utf8'), existing, { cfg, vars, runtimeRel, owned }) }
    })
    for (const k of keep) console.log(`kept: ${k}`)
    const conflicts = results.filter((r) => r.conflict)
    for (const r of conflicts) {
        console.log(`conflict: ${r.f.dest}: ${r.conflict}`)
        if (r.proposal?.note) console.log(`  note: ${r.proposal.note}`)
        if (propose) {
            mkdirSync(dirname(join(propose, r.f.dest)), { recursive: true })
            writeFileSync(join(propose, r.f.dest), r.proposal.text)
            console.log(`  proposed: ${join(propose, r.f.dest)}`)
        }
    }
    if (conflicts.length) return 1
    for (const r of results) for (const n of r.notes) console.log(`note: ${r.f.dest}: ${n}`)
    const changed = results.filter((r) => r.text !== r.existing)
    if (values.check) {
        for (const r of changed) console.log(`out of date: ${r.f.dest}`)
        return changed.length ? 1 : 0
    }
    for (const r of changed) {
        mkdirSync(dirname(join(target, r.f.dest)), { recursive: true })
        writeFileSync(join(target, r.f.dest), r.text)
        console.log(`wrote ${r.f.dest}`)
    }
})
