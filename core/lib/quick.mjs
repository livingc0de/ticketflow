/**
 * The quick flow's test selection and its post-merge full-run decision. Pure functions, plus a small CLI for CI.
 *
 * `selectTests` picks, from the changed paths, the tracked test files that cover them (a test file by name or directory, a code file by the
 * test files that share its stem). Anything it cannot determine is `ok: false`, which means the full verify command runs: nothing is ever
 * silently skipped. `fullRunReasons` says whether a merged quick pull request still needs the full suite on the default branch.
 *
 * CLI (CI scope step): `quick.mjs <PR> [--config f] < changed-names-NUL-separated`  prints the selected tests, space-separated, or nothing;
 *      any error exits 2 with nothing on stdout (a full run).
 *      `quick.mjs --run [--config f]`  runs `verify.quick_command` (the tests are in $TICKETFLOW_TESTS) and passes its exit code through.
 */

import { spawnSync } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { configPath, DEFAULT_ALWAYS_REVIEW, loadConfig } from './config.mjs'
import { docsOnly } from './docs-only.mjs'
import { api } from './gh.mjs'
import { alwaysReviewHit, flowOf, names, TEST, tierOf, ticketsOf } from './risk.mjs'

// a test file proper: test_*, *.test.*, *_spec.*, ...; a path in a tests directory that is not one (a helper, a fixture) is shared support
const TEST_FILE = /(^|\/)(test_[^/]+|[^/]*[._-](test|spec)\.[^/]+)$/
const SAFE = /^[\w.@][\w./@+-]*$/   // no space, quote or glob character: the list is expanded unquoted in a shell command
const MAX_TESTS = 200   // shortcut: a command line limit; a change that selects more runs the full suite
const stem = (p) => p.split('/').at(-1).replace(/\..*$/, '').replace(/^test_/, '').replace(/[._-](test|spec)$/, '')
/** Config files at the repository root and `*.config.*`, `.*rc`: a change there can affect every test. shortcut: a heuristic, add your own paths to review.always_review */
const SHARED_CONFIG = [/^[^/]+$/, /(^|\/)[^/]*\.config\.[^/]+$/, /(^|\/)\.[\w-]*rc(\.\w+)?$/]

/** changed: repo paths of the pull request, tracked: every tracked path -> { ok, tests, unmatched, why } */
export function selectTests(changed, tracked, cfg) {
    const files = new Set(tracked)
    const tests = new Set(), unmatched = []
    let why = null
    for (const p of changed) {
        if (docsOnly([p], cfg)) continue
        if (TEST.test(p)) {
            if (!TEST_FILE.test(p)) why ??= `a test helper or fixture changed (${p})`
            else if (files.has(p)) tests.add(p)
        } else {
            const hit = [...files].filter((t) => TEST_FILE.test(t) && stem(t) === stem(p))
            if (hit.length) hit.forEach((t) => tests.add(t)); else unmatched.push(p)
        }
    }
    const list = [...tests].sort()
    why ??= !files.size ? 'no tracked files' : !list.length ? 'no test selected' : list.length > MAX_TESTS ? `more than ${MAX_TESTS} tests selected` : list.some((t) => !SAFE.test(t)) ? 'a selected path is not shell-safe' : null
    return { ok: why === null, tests: list, unmatched, why }
}

/** The selected tests when this pull request runs the quick gate, else null. `read` is the gh api reader. */
export function quickTests(cfg, pull, pr, changed, tracked, read = api) {
    if (cfg.verify.quick_command === null || cfg.mode === 'off') return null
    const tickets = ticketsOf(pull)
    if (!tickets.length) return null
    const labels = tickets.flatMap((n) => read(`repos/${cfg.repo}/issues/${n}`).labels.map((l) => l.name ?? l))
    if (flowOf(cfg, labels) !== 'quick') return null
    const sel = selectTests(changed, tracked, cfg)
    return sel.ok ? sel : null
}

/**
 * Why a merged quick pull request still needs the full suite on the default branch (empty: it does not). `files` are the pull request's files
 * ({ filename, previous_filename?, additions, deletions }), `selection` is selectTests of its paths.
 */
export function fullRunReasons(files, labels, cfg, selection) {
    const out = []
    if (!files.every((f) => typeof f?.filename === 'string' && Number.isInteger(f.additions) && Number.isInteger(f.deletions))) return ['the file list could not be read']
    const tier = tierOf(labels)
    if (tier === 'High' || tier === 'Critical') out.push(`Tier: ${tier}`)
    const floors = [...DEFAULT_ALWAYS_REVIEW, /^\.github\//, /^\.ticketflow\//, ...cfg.gate.ci_files]
    for (const f of files) {
        const hit = alwaysReviewHit(f, cfg)
        if (hit) out.push(`path ${hit} always needs a review`)
        else {
            const n = names(f).find((x) => floors.some((re) => re.test(x)) || (!docsOnly([x], cfg) && SHARED_CONFIG.some((re) => re.test(x))))
            if (n) out.push(`shared or verification file ${n}`)
        }
    }
    const lines = files.filter((f) => names(f).some((n) => !TEST.test(n) && !docsOnly([n], cfg))).reduce((n, f) => n + f.additions + f.deletions, 0)
    if (lines > cfg.review.self_check_max_lines) out.push(`${lines} changed code lines (limit ${cfg.review.self_check_max_lines})`)
    if (!selection.ok) out.push(`test selection undeterminable (${selection.why})`)
    if (selection.unmatched.length) out.push(`code without a matching test: ${selection.unmatched.slice(0, 5).join(', ')}`)
    return [...new Set(out)]
}

const isMain = () => { try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href } catch { return false } }
if (isMain()) {
    try {
        const { values, positionals } = parseArgs({ options: { config: { type: 'string' }, run: { type: 'boolean' } }, allowPositionals: true })
        const cfg = loadConfig(values.config ?? configPath(dirname(fileURLToPath(import.meta.url))))
        if (values.run) {
            if (positionals.length || cfg.verify.quick_command === null) throw new Error('usage: quick.mjs --run (needs verify.quick_command)')
            const r = spawnSync('bash', ['-c', cfg.verify.quick_command], { stdio: 'inherit' })
            process.exit(r.status ?? 1)
        }
        if (positionals.length !== 1 || !/^\d+$/.test(positionals[0])) throw new Error('usage: quick.mjs <PR> [--config f] < changed names | quick.mjs --run')
        const changed = readFileSync(0, 'utf8').split('\0').filter(Boolean)
        const tracked = spawnSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 1 << 26 })
        if (tracked.status !== 0) throw new Error('git ls-files failed')
        const sel = quickTests(cfg, api(`repos/${cfg.repo}/pulls/${positionals[0]}`), positionals[0], changed, tracked.stdout.split('\0').filter(Boolean))
        if (sel) console.log(sel.tests.join(' '))
    } catch (e) {
        console.error(`quick: ${e.message}`)
        process.exit(2)
    }
}
