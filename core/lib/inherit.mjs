/**
 * Can a head inherit the green gate status of its previous head?
 *
 * A pull request that is merely updated with the default branch (`gh pr update-branch`: one merge, parents [previous head, default
 * branch]) keeps its result when everything merged in is docs-only, instead of a new full run. Reads only: GETs through `gh api`, as
 * plain data, before any cache, install or checkout of the pull request's code. Any doubt (a failed read, an unknown file class, a
 * cap, a head or default branch that moved while reading) is a normal run.
 *
 * Usage: node inherit.mjs <pr> <head sha> [--config f]
 * Prints `description=<status description>` and exits 0 to inherit; otherwise prints nothing on stdout (the reason goes to
 * stderr) and exits 0 (a normal run), 1 (a failed read) or 2 (usage or config error).
 */

import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { CI_FILE_FLOOR, configPath, loadConfig } from './config.mjs'
import { docsOnly } from './docs-only.mjs'

const CAP = 300       // the compare and commit APIs list at most 300 files and cut silently: a list that long is code
const MAX_MAIN = 20   // more incoming default-branch commits is a normal run
// a real run: Actions or a local verify; never a docs-only or inherited one. An unrecognized description is never inherited from (a normal run).
const FULL_RUN = /^(Actions run #\d+|Local run on \S.*)$/

export const description = (cfg, sha) => `Inherited from ${sha.slice(0, 7)}: only docs merged from ${cfg.default_branch}`

const names = (files) => files.flatMap((f) => (f.previous_filename ? [f.filename, f.previous_filename] : [f.filename]))

/** `api(path)` returns the parsed JSON of a GET. Returns `{root}` (the full-run commit inherited from) or `{no}` (why not). */
export function inherit(api, cfg, pr, head) {
    const base = cfg.default_branch
    const get = (path) => api(`repos/${cfg.repo}/${path}`)
    const prHead = () => { const p = get(`pulls/${pr}`); return p.base.ref === base ? p.head.sha : '' }
    const baseHead = () => get(`git/ref/heads/${base}`).object.sha
    const gate = (sha) => get(`commits/${sha}/status?per_page=100`).statuses.find((s) => s.context === cfg.gate.context)
    const docs = (files) => files.length < CAP && docsOnly(names(files), cfg)
    const ciFiles = [...CI_FILE_FLOOR, ...cfg.gate.ci_files]

    if (prHead() !== head) return { no: `not the head of a pull request into ${base}` }
    const main = baseHead()
    const parents = get(`commits/${head}`).parents.map((p) => p.sha)
    if (parents.length !== 2 || parents[1] !== main) return { no: `not one merge of the current ${base} into the previous head` }

    let root = parents[0], g = gate(root)
    const m = g?.state === 'success' && /^Inherited from ([0-9a-f]{7}): /.exec(g.description)
    if (m && g.description === description(cfg, m[1])) { root = get(`commits/${m[1]}`).sha; g = gate(root) }   // a short sha resolves; an ambiguous one is a 422 and throws
    if (g?.state !== 'success' || !FULL_RUN.test(g.description)) return { no: 'no full-run gate success to inherit' }

    const since = get(`compare/${root}...${head}`)
    if (since.status !== 'ahead' || since.behind_by !== 0 || !docs(since.files)) return { no: 'a change since the green head is not docs-only' }
    const incoming = get(`compare/${root}...${main}`)
    if (incoming.ahead_by > MAX_MAIN || incoming.commits.length !== incoming.ahead_by) return { no: `too many ${base} commits to judge` }
    for (const c of incoming.commits) if (!docs(get(`commits/${c.sha}`).files)) return { no: `${base} commit ${c.sha.slice(0, 7)} is not docs-only` }
    const own = get(`compare/${main}...${head}`).files
    if (own.length >= CAP || names(own).some((n) => ciFiles.some((r) => r.test(n)))) return { no: 'the pull request changes CI files' }
    if (prHead() !== head || baseHead() !== main) return { no: `the head or ${base} moved while reading` }
    return { root }
}

const isMain = () => { try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href } catch { return false } }   // realpath: a symlinked path must still run
if (isMain()) {
    let cfg, pr, head
    try {
        const { values, positionals } = parseArgs({ options: { config: { type: 'string' } }, allowPositionals: true, strict: true })
        ;[pr, head] = positionals
        if (positionals.length !== 2 || !/^\d+$/.test(pr) || !/^[0-9a-f]{40}$/.test(head)) throw new Error('usage: inherit.mjs <pr> <head sha> [--config f]')
        cfg = loadConfig(values.config ?? configPath(dirname(fileURLToPath(import.meta.url))))
    } catch (e) {
        console.error(`inherit: ${e.message}`)
        process.exit(2)
    }
    const api = (path) => JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8' }))
    const result = inherit(api, cfg, pr, head)
    if (result.root) console.log(`description=${description(cfg, result.root)}`)
    else console.error(`inherit: normal run: ${result.no}`)
}
