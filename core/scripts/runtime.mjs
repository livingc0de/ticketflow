#!/usr/bin/env node
/**
 * Copies the ticketflow runtime (core/ and the enabled practices/) from a clone into a repo's `.ticketflow/` and records it in the manifest.
 *
 * Usage: runtime.mjs <source-clone> <target-repo> [--keep <path>]... [--dry-run]
 *   Run from the clone. <target-repo> is a git toplevel with `.ticketflow/config.json`; the source and the config's `practices` decide the files.
 *   --keep <path>   leave that repo-relative file alone and record it as held (a runtime file is not written or removed; a rendered file
 *                   is only recorded, so `doctor` can pass it to `render --keep`)
 *   --dry-run       print the plan, write nothing; exit 1 when anything is pending
 * Output: one line per path: `write|remove|keep|conflict <path>`.
 * Exit: 0 = done (or, with --dry-run, in sync); 1 = a conflict (nothing is written) or, with --dry-run, something pending;
 *       2 = usage, source, target, config or manifest error, before any write.
 * A file the old manifest lists whose hash changed (a hand edit), or an untracked file in `.ticketflow/`, is a conflict unless it is kept
 * or byte-identical to the file to be written. `config.json` and `custom/` are never touched. The manifest hashes the copied files only.
 */

import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, rmdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { main } from '../lib/cli.mjs'
import { loadConfig } from '../lib/config.mjs'
import { hashBytes, hashFile, manifestChanges, readManifest, relPath, runtimeFiles, writeManifest } from '../lib/manifest.mjs'

const usage = 'usage: runtime <source-clone> <target-repo> [--keep <path>]... [--dry-run]'
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const fail = (m) => { throw new Error(m) }

/** Every regular file under `dir` as `{ rel, abs, mode }`; a symlink or any other kind of entry is an error. */
function walk(dir, rel = '') {
    const out = []
    for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
        const r = rel ? `${rel}/${e.name}` : e.name
        if (e.isSymbolicLink()) fail(`${dir}/${r} is a symlink`)
        if (e.isDirectory()) out.push(...walk(dir, r))
        else if (e.isFile()) out.push({ rel: r, abs: join(dir, r), mode: lstatSync(join(dir, r)).mode })
        else fail(`${dir}/${r} is not a regular file`)
    }
    return out
}

main('runtime', () => {
    const { values, positionals } = parseArgs({ options: { keep: { type: 'string', multiple: true }, 'dry-run': { type: 'boolean' } }, allowPositionals: true })
    if (positionals.length !== 2) fail(usage)
    const src = resolve(positionals[0]), target = resolve(positionals[1])
    const kept = [...new Set(values.keep ?? [])].sort()
    for (const k of kept) try { relPath(k, '--keep') } catch { fail(`--keep ${k}: must be a repo-relative path without ..`) }

    // 1. validate, before any write
    const version = existsSync(join(src, 'VERSION')) ? readFileSync(join(src, 'VERSION'), 'utf8').trim() : fail(`${src}/VERSION is missing: not a ticketflow clone`)
    if (!/^\d+\.\d+\.\d+$/.test(version)) fail('VERSION must be X.Y.Z')
    for (const p of ['core', 'skills/init/SKILL.md']) if (!existsSync(join(src, p))) fail(`${src}/${p} is missing: not a ticketflow clone`)
    for (const p of ['VERSION', 'core', 'skills/init/SKILL.md']) if (lstatSync(join(src, p)).isSymbolicLink()) fail(`${p} in the source is a symlink`)
    const core = walk(join(src, 'core'))
    for (const n of ['config.json', 'manifest.json', 'custom']) if (existsSync(join(src, 'core', n))) fail(`core/${n} must not exist in the source: it belongs to the repo, not the runtime`)
    if (existsSync(join(src, 'practices'))) walk(join(src, 'practices'))   // a symlink anywhere in the source is refused, enabled or not
    let top
    try { top = realpathSync(git(target, 'rev-parse', '--show-toplevel')) } catch { fail(`${target} is not inside a git repository`) }
    if (top !== realpathSync(target)) fail(`${target} is not the root of its git repository (${top})`)
    if (existsSync(join(target, 'core')) && existsSync(join(target, 'skills', 'init'))) fail('the target is a ticketflow checkout: the source repo\'s runtime is core/, there is nothing to copy')
    const cfg = loadConfig(join(target, '.ticketflow', 'config.json'))
    for (const n of cfg.practices) if (!existsSync(join(src, 'practices', n))) fail(`practice ${n} is in the config but not in the source`)
    const old = readManifest(target)
    const existing = runtimeFiles(target)

    let url
    try { url = git(src, 'remote', 'get-url', 'origin') } catch { fail('the source has no origin remote') }
    try { const u = new URL(url); u.password = ''; if (/^https?:$/.test(u.protocol)) u.username = ''; url = u.href } catch { /* an scp-style url has no credentials to strip */ }
    const commit = git(src, 'rev-parse', 'HEAD')
    const tags = git(src, 'tag', '--points-at', 'HEAD').split('\n').filter(Boolean)
    if (tags.length && !tags.includes(`v${version}`)) fail(`the source is at tag ${tags.join(', ')}, VERSION is ${version}: expected v${version}`)
    const tag = tags.length ? `v${version}` : null

    // 2. plan
    const desired = new Map()
    const add = (path, f) => desired.set(path, { ...f, hash: hashBytes(readFileSync(f.abs)) })
    for (const f of core) add(`.ticketflow/${f.rel}`, f)
    for (const n of cfg.practices) for (const f of walk(join(src, 'practices', n))) add(`.ticketflow/practices/${n}/${f.rel}`, f)
    const oldFiles = old?.files ?? {}
    const have = new Set(existing)
    const lines = [], conflicts = [], writes = [], removes = [], files = {}
    for (const path of [...new Set([...desired.keys(), ...Object.keys(oldFiles), ...existing, ...kept])].sort()) {
        if (kept.includes(path)) {
            lines.push(`keep ${path}`)
            if (Object.hasOwn(oldFiles, path)) files[path] = oldFiles[path]
            continue
        }
        const want = desired.get(path)
        const disk = have.has(path) ? hashFile(join(target, path)) : null
        const unedited = disk !== null && Object.hasOwn(oldFiles, path) && disk === oldFiles[path]
        if (want) {
            files[path] = want.hash
            const occupied = lstatSync(join(target, path), { throwIfNoEntry: false })
            if (occupied && !occupied.isFile()) fail(`${path} exists and is not a regular file`)
            // a changed executable bit alone is a rewrite too: the Codex hook runs guard.mjs directly
            if (disk === want.hash && !((occupied.mode ^ want.mode) & 0o100)) continue
            if (disk === want.hash || disk === null || unedited) { writes.push(path); lines.push(`write ${path}`) } else { conflicts.push(path); lines.push(`conflict ${path}`) }
        } else if (disk !== null) {
            if (unedited) { removes.push(path); lines.push(`remove ${path}`) } else { conflicts.push(path); lines.push(`conflict ${path}`) }
        }
    }
    const patch = { version, source: { url, tag, commit }, files, held: kept }
    const pending = writes.length || removes.length || manifestChanges(target, patch)
    for (const l of lines) console.log(l)
    if (tag === null) console.error(`runtime: warning: the source is not at a release tag (v${version}); the manifest records tag null`)
    if (conflicts.length) {
        console.error('runtime: conflicts found, nothing was written. A hand-edited or untracked runtime file is never overwritten or deleted; move the edit to .ticketflow/custom/, or pass --keep <path>')
        return 1
    }
    if (values['dry-run']) return pending ? 1 : 0

    // 3. write
    for (const path of writes) {
        const f = desired.get(path)
        mkdirSync(dirname(join(target, path)), { recursive: true })
        writeFileSync(join(target, path), readFileSync(f.abs))
        chmodSync(join(target, path), f.mode & 0o755)
    }
    for (const path of removes) {
        rmSync(join(target, path))
        for (let d = dirname(path); d !== '.ticketflow' && readdirSync(join(target, d)).length === 0; d = dirname(d)) rmdirSync(join(target, d))
    }
    writeManifest(target, patch)
    console.log(`runtime: ${version} (${tag ?? 'untagged'} ${commit.slice(0, 7)}): ${writes.length} written, ${removes.length} removed, ${kept.length} kept`)
})
