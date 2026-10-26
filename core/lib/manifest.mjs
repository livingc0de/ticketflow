/**
 * `.ticketflow/manifest.json`: what was installed, from where, and which settings entries ticketflow owns.
 *
 * Two writers own disjoint keys and each re-reads the file before writing: `runtime.mjs` writes `version`, `source`, `files` and
 * `held`; `render.mjs` writes `claude_settings`. The output is deterministic (sorted keys and paths, no timestamps), so a re-run
 * of the same install changes no byte. In the ticketflow repo itself (runtime in `core/`) the file holds `manifest_version` and
 * `claude_settings` only. `files` hashes the copied runtime files only; stubs and rendered files are checked by `gen-stubs --check`
 * and `render --check`.
 */

import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const MANIFEST_PATH = '.ticketflow/manifest.json'
export class ManifestError extends Error {
    name = 'ManifestError'
}
const fail = (m) => { throw new ManifestError(m) }
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const only = (o, keys, at) => { for (const k of Object.keys(o)) if (!keys.includes(k)) fail(`${at}: unknown key ${k}`) }
const strings = (v, at) => (Array.isArray(v) && v.every((x) => typeof x === 'string') ? v : fail(`${at} must be a list of strings`))
/** A repo-relative path: no absolute path, no `..`, no empty or `.` segment, no control character. */
export const relPath = (p, at) => (typeof p === 'string' && !p.startsWith('/') && !/[\u0000-\u001f\u007f\\]/.test(p) && p.split('/').every((s) => s !== '' && s !== '.' && s !== '..') ? p : fail(`${at}: bad path ${JSON.stringify(p)}`))
const runtimePath = (p, at) => (relPath(p, at).startsWith('.ticketflow/') && !/^\.ticketflow\/((config|manifest)\.json$|custom(\/|$))/.test(p) ? p : fail(`${at}: ${p} is outside the runtime (.ticketflow/ except config.json, manifest.json and custom/)`))

/** The sha256 of the bytes after CRLF to LF, so a checkout with other line endings is not an edit. */
export const hashBytes = (buf) => createHash('sha256').update(Buffer.from(buf.toString('latin1').replaceAll('\r\n', '\n'), 'latin1')).digest('hex')
export const hashFile = (path) => hashBytes(readFileSync(path))

/** Checks a parsed manifest (an unknown key, a wrong type or a bad path is a ManifestError) and returns it. */
function check(m) {
    if (!isObject(m)) fail('the manifest is not an object')
    only(m, ['manifest_version', 'version', 'source', 'files', 'held', 'claude_settings'], 'manifest')
    if (m.manifest_version !== 1) fail('manifest_version must be 1')
    if (m.version !== undefined && !/^\d+\.\d+\.\d+$/.test(m.version)) fail('version must be X.Y.Z')
    if (m.source !== undefined) {
        if (!isObject(m.source)) fail('source must be an object')
        only(m.source, ['url', 'tag', 'commit'], 'source')
        if (typeof m.source.url !== 'string' || m.source.url === '') fail('source.url must be a string')
        if (m.source.tag !== null && typeof m.source.tag !== 'string') fail('source.tag must be a string or null')
        if (!/^[0-9a-f]{40}$/.test(m.source.commit)) fail('source.commit must be 40 hex characters')
    }
    if (m.files !== undefined) {
        if (!isObject(m.files)) fail('files must be an object')
        for (const [p, h] of Object.entries(m.files)) {
            runtimePath(p, 'files')
            if (!/^[0-9a-f]{64}$/.test(h)) fail(`files: the hash of ${p} must be 64 hex characters`)
        }
    }
    if (m.held !== undefined) for (const p of strings(m.held, 'held')) relPath(p, 'held')
    if (m.claude_settings !== undefined) {
        if (!isObject(m.claude_settings)) fail('claude_settings must be an object')
        only(m.claude_settings, ['allow', 'ask'], 'claude_settings')
        for (const [k, v] of Object.entries(m.claude_settings)) strings(v, `claude_settings.${k}`)
    }
    return m
}

/** The manifest of the repo at `root`, or null when there is none. */
export function readManifest(root) {
    const path = join(root, MANIFEST_PATH)
    const st = lstatSync(path, { throwIfNoEntry: false })
    if (!st) return null
    if (st.isSymbolicLink()) fail(`${MANIFEST_PATH} is a symlink`)
    let m
    try { m = JSON.parse(readFileSync(path, 'utf8')) } catch (e) { fail(`${MANIFEST_PATH} is not readable JSON: ${e.message}`) }
    return check(m)
}

const sorted = (v) => (Array.isArray(v) ? v.map(sorted) : isObject(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v)

function build(root, patch) {
    const next = { manifest_version: 1, ...readManifest(root), ...patch }
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k]
    if (next.held) next.held = [...new Set(next.held)].sort()
    const text = JSON.stringify(sorted(check(next)), null, 2) + '\n'
    const path = join(root, MANIFEST_PATH)
    return { path, text, changed: !existsSync(path) || readFileSync(path, 'utf8') !== text }
}

/** True when `writeManifest(root, patch)` would change the file. */
export const manifestChanges = (root, patch) => build(root, patch).changed

/** Replaces the keys of `patch` (a key set to `undefined` is removed) and keeps the others. Returns true when the file changed. */
export function writeManifest(root, patch) {
    const { path, text, changed } = build(root, patch)   // build reads the manifest first, which refuses a symlink
    if (changed) {
        mkdirSync(join(root, '.ticketflow'), { recursive: true })
        writeFileSync(path, text)
    }
    return changed
}

/** Every runtime file under `.ticketflow/` (repo-relative, sorted), except config.json, manifest.json and custom/**. A symlink is an error. */
export function runtimeFiles(root) {
    const out = []
    const walk = (rel) => {
        for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
            const p = `${rel}/${e.name}`
            if (rel === '.ticketflow' && ['config.json', 'manifest.json', 'custom'].includes(e.name)) continue
            if (e.isSymbolicLink()) fail(`${p} is a symlink`)
            if (e.isDirectory()) walk(p)
            else if (e.isFile()) out.push(p)
            else fail(`${p} is not a regular file`)
        }
    }
    if (lstatSync(join(root, '.ticketflow'), { throwIfNoEntry: false })) {
        if (lstatSync(join(root, '.ticketflow')).isSymbolicLink()) fail('.ticketflow is a symlink')
        walk('.ticketflow')
    }
    return out.sort()
}

/** The runtime against the manifest `m`: `{ ok, edited, missing, untracked, held }`. A held path is the owner's choice and is not checked. */
export function runtimeState(root, m) {
    const held = new Set(m.held ?? [])
    const files = m.files ?? {}
    const on = runtimeFiles(root).filter((p) => !held.has(p))
    const have = new Set(on)
    const edited = [], missing = []
    for (const [p, h] of Object.entries(files)) {
        if (held.has(p)) continue
        if (!have.has(p)) missing.push(p)
        else if (hashFile(join(root, p)) !== h) edited.push(p)
    }
    const untracked = on.filter((p) => !Object.hasOwn(files, p))
    return { ok: !edited.length && !missing.length && !untracked.length, edited: edited.sort(), missing: missing.sort(), untracked, held: [...held].sort() }
}
