#!/usr/bin/env node
/**
 * A read-only health check: the tools, the config, the installed runtime, the generated files and (full run) the GitHub side.
 *
 * Usage: doctor.mjs [--preflight | --local] [--config f]
 *   --preflight   the tools and the repo in the current directory (no config needed): git, gh and its scopes, node, timeout, a clean tree
 *   --local       everything that needs no GitHub call: config, runtime, stubs, templates, CI steps, guard, gitignore
 *   (neither)     the local checks plus labels, project and branch protection, each in its read-only mode
 *   The checked repo is the one this script lives in (`.ticketflow/scripts/` in a user repo, `core/scripts/` in the ticketflow repo).
 * Output: `ok|warn|fail|skip <check>: <detail>`, a failed child's output indented below it, then `doctor: <n> failed, <m> warnings`.
 * Exit: 0 = nothing failed (warnings allowed); 1 = a check failed; 2 = usage.
 */

import { spawnSync } from 'node:child_process'
import { accessSync, constants, existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { loadConfig } from '../lib/config.mjs'
import { readManifest, runtimeState } from '../lib/manifest.mjs'
import { FILES, verifyRuns } from '../lib/render.mjs'

let values
try {
    ({ values } = parseArgs({ options: { preflight: { type: 'boolean' }, local: { type: 'boolean' }, config: { type: 'string' } }, allowPositionals: false }))
    if (values.preflight && values.local) throw new Error('--preflight and --local cannot be combined')
} catch (e) {
    console.error(`doctor: ${e.message}\nusage: doctor [--preflight | --local] [--config f]`)
    process.exit(2)
}

const rt = dirname(dirname(fileURLToPath(import.meta.url)))
const GH_MIN = [2, 48, 0], NODE_MIN = [18, 9, 0], SCOPES = ['repo', 'project', 'workflow']
let failed = 0, warned = 0
/** Is version `v` ([major, minor, patch]) older than `min`? */
const older = (v, min) => { const at = min.findIndex((n, i) => v[i] !== n); return at >= 0 && (v[at] ?? 0) < min[at] }
const say = (status, check, detail) => {
    if (status === 'fail') failed++
    if (status === 'warn') warned++
    console.log(`${status} ${check}: ${detail}`)
}
const sh = (cmd, args, cwd) => spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 120_000 })
const lines = (r) => `${r.stdout ?? ''}\n${r.stderr ?? ''}`.split('\n').map((l) => l.trimEnd()).filter(Boolean)
const indent = (ls) => { for (const l of ls.slice(0, 20)) console.log(`    ${l}`); if (ls.length > 20) console.log(`    ... ${ls.length - 20} more line(s)`) }
const list = (xs) => xs.slice(0, 10).join(', ') + (xs.length > 10 ? `, ... ${xs.length - 10} more` : '')

const top = (cwd) => { const r = sh('git', ['rev-parse', '--show-toplevel'], cwd); return r.status === 0 ? r.stdout.trim() : null }
const root = top(values.preflight ? process.cwd() : dirname(rt))
const rtRel = root && !values.preflight ? relative(root, rt) : null
const repoMode = rtRel === 'core'
const slug = (cwd) => {
    const r = sh('git', ['remote', 'get-url', 'origin'], cwd)
    return r.status === 0 ? /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(r.stdout.trim())?.[1] ?? null : null
}

// ---- preflight
if (sh('git', ['--version']).status === 0) say('ok', 'git', 'found'); else say('fail', 'git', 'not on PATH: install git')
let ghUsable = false
if (!values.local) {
    const v = sh('gh', ['--version'])
    const m = v.status === 0 ? /gh version (\d+)\.(\d+)\.(\d+)/.exec(v.stdout) : null
    if (v.status !== 0 || v.error) say('fail', 'gh', 'not on PATH: install the GitHub CLI (https://cli.github.com)')
    else {
        if (older(m ? m.slice(1).map(Number) : [0, 0, 0], GH_MIN) || !m) say('fail', 'gh', `${m ? m.slice(1).join('.') : 'unknown version'} is older than ${GH_MIN.join('.')}: upgrade the GitHub CLI`)
        else say('ok', 'gh', m.slice(1).join('.'))
        const me = sh('gh', ['api', '-i', 'user'])
        if (me.status !== 0) say('fail', 'gh-auth', 'not logged in: run gh auth login')
        else {
            ghUsable = true
            const header = /^x-oauth-scopes:[ \t]*(.*)$/im.exec(me.stdout.split(/\r?\n\r?\n/)[0])
            if (!header) say('warn', 'gh-auth', 'scopes unverifiable; Projects may need a classic token')
            else {
                const have = header[1].split(',').map((s) => s.trim())
                const missing = SCOPES.filter((s) => !have.includes(s))
                if (missing.length) say('fail', 'gh-auth', `missing scope ${missing.join(', ')}: run gh auth refresh -h github.com -s ${missing.join(',')}`)
                else say('ok', 'gh-auth', `scopes ${SCOPES.join(', ')}`)
            }
        }
    }
}
// 18.9: parseArgs (18.3) and os.machine (18.9), the newest APIs the scripts use
if (!older(process.versions.node.split('.').map(Number), NODE_MIN)) say('ok', 'node', process.versions.node); else say('fail', 'node', `${process.versions.node} is older than ${NODE_MIN.join('.')}: upgrade node`)
if (sh('timeout', ['--version']).status === 0) say('ok', 'timeout', 'found'); else say('warn', 'timeout', 'not on PATH; only the local-verify fallback needs it (macOS: brew install coreutils and use its gnubin)')
const origin = root ? slug(root) : null
if (!root) say('fail', 'repo', 'not inside a git repository: run git init, or see new-repo.md of the ticketflow init skill')
else if (!origin) say('fail', 'repo', 'origin is not a github.com owner/repo remote: add one (see new-repo.md of the ticketflow init skill)')
else say('ok', 'repo', `${origin} at ${root}`)
if (values.preflight && root) {
    const st = sh('git', ['status', '--porcelain'], root)
    if (st.status !== 0) say('fail', 'tree', 'git status failed: check that this is a healthy git repository')
    else if (st.stdout.trim() !== '') say('fail', 'tree', 'the working tree is not clean: commit or stash first')
    else say('ok', 'tree', 'clean')
}

if (!values.preflight) {
    const tools = (script, args, cfgArg = false) => sh(process.execPath, [join(rt, 'scripts', script), ...args, ...(cfgArg && values.config ? ['--config', resolve(values.config)] : [])], root)
    /** Runs a child script and reports it by `map(status, result)` = [status, detail]; a child that fails shows its output. */
    const child = (check, script, args, map, cfgArg) => {
        const r = tools(script, args, cfgArg)
        const [status, detail] = r.error ? ['fail', `${script} could not run: ${r.error.message}`] : map(r.status, r)
        say(status, check, detail)
        if (status === 'fail' || status === 'warn') indent(lines(r))
    }
    const plain = (okDetail, failDetail) => (code) => (code === 0 ? ['ok', okDetail] : code === 1 ? ['fail', failDetail] : ['fail', `exit ${code}: fix the error shown below, then run doctor again`])

    // ---- config
    let cfg = null
    if (!root) say('skip', 'config', 'no repository')
    else {
        try {
            cfg = loadConfig(values.config ? resolve(values.config) : join(root, '.ticketflow', 'config.json'))
            if (origin && cfg.repo.toLowerCase() !== origin.toLowerCase()) { say('fail', 'config', `repo is ${cfg.repo}, origin is ${origin}: fix .ticketflow/config.json`); cfg = null } else say('ok', 'config', `valid, repo ${cfg.repo}`)
        } catch (e) {
            say('fail', 'config', `${e.message}: fix .ticketflow/config.json`)
        }
    }
    const need = (check, fn) => (cfg ? fn() : say('skip', check, 'no valid config'))

    // ---- runtime
    need('runtime', () => {
        if (repoMode) return say('skip', 'runtime', 'ticketflow repo: the runtime is core/')
        try {
            const m = readManifest(root)
            if (!m?.files) return say('fail', 'runtime', 'no .ticketflow/manifest.json with files: run init')
            const s = runtimeState(root, m)
            const bad = [['edited', s.edited], ['missing', s.missing], ['untracked', s.untracked]].filter(([, xs]) => xs.length)
            if (bad.length) say('fail', 'runtime', `${bad.map(([k, xs]) => `${k}: ${list(xs)}`).join('; ')}; move the edit to .ticketflow/custom/, restore the file, or run sync`)
            else if (s.held.length) say('warn', 'runtime', `ok, held (kept on purpose): ${list(s.held)}`)
            else say('ok', 'runtime', `${Object.keys(m.files).length} files match the manifest (${m.version})`)
        } catch (e) {
            say('fail', 'runtime', `${e.message}: restore .ticketflow/ from git or run sync`)
        }
    })

    // ---- generated files
    need('practices', () => {
        if (!cfg.practices.length) return say('skip', 'practices', 'none enabled')
        const dirs = cfg.practices.filter((n) => !existsSync(join(root, rtRel, 'practices', n)))
        if (dirs.length) say('fail', 'practices', `${dirs.join(', ')} enabled in the config but not in ${rtRel}/practices/: run sync`)
        else if (cfg.practices.includes('live-verify') && cfg.live_verify_skill === null) say('warn', 'practices', 'live-verify is enabled but live_verify_skill is null: the e2e-verifier role gets no stub (set it to "live-verify")')
        else say('ok', 'practices', cfg.practices.join(', '))
    })
    need('stubs', () => child('stubs', 'gen-stubs.mjs', [rtRel, '.', '--check'], plain('in sync', 'out of date or in conflict: run gen-stubs')))
    need('templates', () => {
        let held = []
        try { held = (readManifest(root)?.held ?? []).filter((p) => FILES.some((f) => f.dest === p)) } catch { /* the runtime check reports an unreadable manifest */ }
        child('templates', 'render.mjs', [join(rtRel, 'templates'), '.', '--check', ...held.flatMap((p) => ['--keep', p])], (code, r) => {
            if (code === 0) return ['ok', held.length ? `in sync (${held.length} held)` : 'in sync']
            // ponytail: the ticketflow repo is rendered by hand until it is dogfooded, so its unmanaged files are a warning there, not a failure
            if (repoMode && code === 1 && lines(r).every((l) => /^(conflict:|\s)/.test(l))) return ['warn', 'files without ticketflow markers: not managed yet (render --propose)']
            return plain('', 'out of date or in conflict: run render')(code)
        })
    })
    need('ci-steps', () => {
        const f = join(root, '.github', 'workflows', 'ci.yml')
        if (!existsSync(f)) return say('skip', 'ci-steps', 'no .github/workflows/ci.yml')
        let text
        try { text = readFileSync(f, 'utf8') } catch (e) { return say('warn', 'ci-steps', `cannot read .github/workflows/ci.yml: ${e.code ?? e.message}`) }
        const n = verifyRuns(text, cfg.verify.command)
        if (n > 1) say('warn', 'ci-steps', `verify.command appears ${n} times in ci.yml: keep one (your own steps replace the template's Install Dependencies and Verify)`)
        else say('ok', 'ci-steps', n ? 'verify.command appears once' : 'verify.command does not appear in ci.yml as written (a repo step runs it another way)')
    })
    need('guard', () => {
        try { accessSync(join(rt, 'scripts', 'guard.mjs'), constants.X_OK) } catch { return say('fail', 'guard', 'scripts/guard.mjs is missing or not executable (the Codex hook runs it directly): restore it or chmod +x it') }
        child('guard', 'guard.mjs', ['--self-test'], plain('every example gives its declared result', 'a guard example does not match'), true)
    })
    need('gitignore', () => {
        const r = sh('git', ['check-ignore', '-q', `${cfg.worktrees_dir}/x`], root)
        if (r.status === 0) say('ok', 'gitignore', `${cfg.worktrees_dir}/ is ignored`)
        else say('warn', 'gitignore', `${cfg.worktrees_dir}/ is not ignored: add it to .gitignore`)
    })

    // ---- GitHub (read-only modes)
    if (!values.local) {
        const gh = (check, fn) => (!cfg ? say('skip', check, 'no valid config') : !ghUsable ? say('skip', check, 'gh is not usable') : fn())
        gh('labels', () => child('labels', 'labels.mjs', ['sync', join(rtRel, 'templates', 'labels.json'), '--dry-run'], plain('in sync', 'labels pending: run labels sync'), true))
        gh('project', () => {
            if (cfg.project === null) return say('skip', 'project', 'the config has no project')
            child('project', 'project.mjs', ['setup', '--dry-run'], plain('in sync', 'project setup pending: run project setup'), true)
        })
        gh('protection', () => child('protection', 'protect.mjs', [], (code, r) => {
            if (code === 0) return ['ok', 'the default branch is protected as standard']
            if (code === 1) return ['fail', 'protection differs: run protect (plan), then --apply']
            return /upgrade to github pro/i.test(r.stderr ?? '') ? ['warn', 'rulesets unavailable on this plan; merge.mjs and the guard remain'] : plain('', 'protection differs')(code)
        }, true))
    }
}

console.log(`doctor: ${failed} failed, ${warned} warnings`)
process.exitCode = failed ? 1 : 0
