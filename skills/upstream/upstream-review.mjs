#!/usr/bin/env node
/**
 * Maintainer tool, never shipped to installed repos: reports what the upstream projects TicketFlow learns from changed since the last
 * recorded review (skills/upstream/upstream.json), so a maintainer can review it (skills/upstream/SKILL.md).
 * Reads through `gh api` only. Nothing is written without --record, and --record writes only after every read succeeded.
 *
 * Usage: upstream-review.mjs [--record] [--baseline f]      Exit: 0 = unchanged (or recorded), 1 = changes to review, 2 = error.
 */

import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { main } from '../../core/lib/cli.mjs'
import { api } from '../../core/lib/gh.mjs'

const DEFAULT = join(dirname(fileURLToPath(import.meta.url)), 'upstream.json')
const SAFE = /^[A-Za-z0-9._-]+$/   // part of a request path: no slash, space or query character gets through
const bad = (m) => { throw new Error(`invalid baseline: ${m}`) }

/** Throws before any call unless every field is well-formed. Returns the parsed baseline. */
function validate(text) {
    let b
    try { b = JSON.parse(text) } catch { bad('not JSON') }
    if (!/^\d{4}-\d\d-\d\d$/.test(b?.reviewed_on)) bad('reviewed_on must be YYYY-MM-DD')
    if (!Array.isArray(b.upstreams) || b.upstreams.length === 0) bad('upstreams must be a non-empty array')
    for (const u of b.upstreams) {
        const [owner, name, ...rest] = String(u?.repo).split('/')
        if (rest.length || ![owner, name].every((p) => p && SAFE.test(p) && p !== '.' && p !== '..')) bad(`repo ${u?.repo}`)
        if (typeof u.branch !== 'string' || !/^[A-Za-z0-9._/-]+$/.test(u.branch) || u.branch.includes('..')) bad(`branch of ${u.repo}`)
        if (!/^[0-9a-f]{40}$/.test(u.sha)) bad(`sha of ${u.repo}`)
        for (const k of ['tag', 'license']) if (typeof u[k] !== 'string' || !/^[A-Za-z0-9._+/-]+$/.test(u[k])) bad(`${k} of ${u.repo}`)
    }
    return b
}

const group = (f) => {
    const [top, name] = f.split('/')
    return top === 'skills' && name ? `skills/${name}` : top === 'benchmarks' && f.startsWith('benchmarks/results/') ? 'benchmarks/results' : ['agents', 'docs'].includes(top) && name ? top : 'other'
}

/** Everything read for one upstream; throws on any failed read. */
function read(u) {
    const R = `repos/${u.repo}`
    const license = api(R).license?.spdx_id ?? 'NONE'
    const head = api(`${R}/commits/${u.branch}`).sha
    // shortcut: newest 20 releases, paginate if a project ships more than 20 between reviews
    const all = api(`${R}/releases?per_page=20`).filter((r) => !r.draft)
    const cut = all.findIndex((r) => r.tag_name === u.tag)
    // Do not advance the baseline if the recorded tag fell outside the finite API window.
    if (cut < 0 && all.length >= 20) throw new Error(`${u.repo}: baseline tag ${u.tag} is outside the latest 20 releases; review/paginate the missing history before recording`)
    const releases = cut < 0 ? all : all.slice(0, cut)
    // shortcut: compare lists at most 300 files (the report says so), clone if a review needs the rest
    const cmp = head === u.sha ? { ahead_by: 0, files: [] } : api(`${R}/compare/${u.sha}...${head}`)
    const counts = {}
    for (const f of cmp.files ?? []) counts[group(f.filename)] = (counts[group(f.filename)] ?? 0) + 1
    return { u, head, license, releases, ahead: cmp.ahead_by, counts, files: (cmp.files ?? []).map((f) => f.filename) }
}

function report(x) {
    const { u } = x, lines = []
    const changed = x.head !== u.sha || x.license !== u.license || x.releases.length > 0
    if (!changed) return { changed, text: `${u.repo}: unchanged since ${u.sha.slice(0, 7)} (${u.tag})` }
    lines.push(`${u.repo}: ${x.ahead} commits ahead of ${u.sha.slice(0, 7)} (${u.tag}), head ${x.head.slice(0, 7)}`)
    if (x.license !== u.license) lines.push(`  license changed: ${u.license} -> ${x.license}`)
    if (x.files.some((f) => /^LICENSE/i.test(f))) lines.push('  LICENSE file changed')
    for (const r of x.releases) lines.push(`  release ${r.tag_name} (${r.published_at?.slice(0, 10) ?? '-'}) ${r.html_url}`)
    for (const [g, n] of Object.entries(x.counts).sort()) lines.push(`  ${g}: ${n}`)
    if (x.files.length >= 300) lines.push('  (compare lists at most 300 files: read the rest in a clone)')
    return { changed, text: lines.join('\n') }
}

let opts, baseline, file
try {
    opts = parseArgs({ options: { record: { type: 'boolean' }, baseline: { type: 'string' } }, allowPositionals: false }).values
    file = opts.baseline ?? DEFAULT
    baseline = validate(readFileSync(file, 'utf8'))
} catch (e) {
    console.error(`upstream-review: ${e.message}`)
    process.exit(2)
}

main('upstream-review', () => {
    const results = baseline.upstreams.map(read)   // every read first: a failure throws (exit 2) before anything is written
    const reports = results.map(report)
    console.log(reports.map((r) => r.text).join('\n'))
    if (opts.record) {
        const next = {
            reviewed_on: new Date().toISOString().slice(0, 10),
            upstreams: results.map((x) => ({ ...x.u, sha: x.head, tag: x.releases[0]?.tag_name ?? x.u.tag, license: x.license })),
        }
        validate(JSON.stringify(next))   // fail closed: never record what the next run would refuse
        const tmp = `${file}.${process.pid}.tmp`
        writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`)
        renameSync(tmp, file)
        console.log(`recorded in ${file}`)
        return 0
    }
    return reports.some((r) => r.changed) ? 1 : 0
})
