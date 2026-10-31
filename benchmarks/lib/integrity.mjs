import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const PLUGINS = {
    superpowers: { owner: 'obra', manifest: '.claude-plugin/plugin.json' },
    ponytail: { owner: 'DietrichGebert', manifest: '.claude-plugin/plugin.json' },
}

export const canonicalRemote = (url) => url.trim()
    .replace(/^git@github\.com:/i, 'https://github.com/')
    .replace(/^ssh:\/\/git@github\.com\//i, 'https://github.com/')
    .replace(/^https?:\/\/github\.com\//i, 'https://github.com/')
    .replace(/\.git\/?$/i, '')
    .replace(/\/$/, '')
    .toLowerCase()

const files = (dir, prefix = '') => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name), rel = join(prefix, entry.name)
    if (entry.isDirectory()) return rel === 'results' ? [] : files(path, rel)
    return entry.isFile() ? [rel] : []
}).sort()

const git = (dir, ...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

const revision = (value) => typeof value === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(value)

const detached = (dir) => {
    try { return !git(dir, 'symbolic-ref', '--quiet', '--short', 'HEAD') } catch { return true }
}

/** Validate a clean, reproducible source before any paid or remote benchmark work. */
export function validateSourceCheckout(dir, { name, expectedSha = null, expectedRemote = null } = {}) {
    if (!dir || !name) throw new Error('source name and directory are required')
    let sha, status
    try {
        sha = git(dir, 'rev-parse', 'HEAD')
        status = git(dir, 'status', '--porcelain', '--untracked-files=all')
    } catch (e) { throw new Error(`${name} source is not a Git checkout (${e.message})`) }
    if (status) throw new Error(`${name} source must be clean; uncommitted files are present`)
    const isDetached = detached(dir)
    if (expectedSha !== null && !revision(expectedSha)) throw new Error(`--${name}-sha must be a full 40- or 64-character revision`)
    if (expectedSha !== null && sha !== expectedSha) throw new Error(`${name} source revision ${sha} does not match expected ${expectedSha}`)
    if (expectedSha === null && !isDetached) throw new Error(`${name} source must be detached or pinned with --${name}-sha`)
    let origin = null
    if (expectedRemote) {
        try { origin = canonicalRemote(git(dir, 'remote', 'get-url', 'origin')) }
        catch { throw new Error(`${name} source must have an origin remote`) }
        if (origin !== canonicalRemote(expectedRemote)) throw new Error(`${name} source origin must be ${canonicalRemote(expectedRemote)}`)
    }
    return { name, sha, detached: isDetached, expected_sha: expectedSha, origin }
}

/** Fingerprint benchmark inputs by content, including dirty files, not only the repository HEAD. */
export function evaluatorFingerprint(root, excluded = []) {
    const base = resolve(root), skip = new Set(excluded.map((p) => resolve(p))), hash = createHash('sha256')
    const inputs = [
        ...files(join(base, 'benchmarks')).map((rel) => ['benchmarks/' + rel, join(base, 'benchmarks', rel)]),
        ['core/lib/cli.mjs', join(base, 'core/lib/cli.mjs')],
        ['core/lib/config.mjs', join(base, 'core/lib/config.mjs')],
    ]
    for (const [rel, path] of inputs) {
        if (skip.has(resolve(path))) continue
        hash.update(rel.replaceAll('\\', '/') + '\0')
        hash.update(readFileSync(path))
    }
    return hash.digest('hex')
}

/** Resolve a scenario prefix only when it names exactly one fixture directory. */
export function resolveScenario(scenariosDir, input) {
    const matches = readdirSync(scenariosDir).filter((name) => name === input || name.startsWith(input + '-'))
    if (!matches.length) throw new Error(`unknown scenario ${input}`)
    if (matches.length !== 1) throw new Error(`ambiguous scenario ${input}: ${matches.join(', ')}`)
    return matches[0]
}

/** Require the expected native plugin identity and upstream provenance before a paid run. */
export function validatePluginSource(dir, agent, arm) {
    const expected = PLUGINS[arm]
    if (!expected) throw new Error(`unknown external plugin arm ${arm}`)
    const manifest = agent === 'codex' ? '.codex-plugin/plugin.json' : expected.manifest
    let data
    try { data = JSON.parse(readFileSync(join(dir, manifest), 'utf8')) }
    catch (e) { throw new Error(`${dir} has no valid native ${agent} plugin manifest (${e.message})`) }
    if (data?.name !== arm) throw new Error(`${dir} native ${agent} plugin manifest name must be ${arm}`)
    let origin
    try { origin = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: dir, encoding: 'utf8' }) }
    catch { throw new Error(`${dir} must have an origin for ${arm}`) }
    const want = `https://github.com/${expected.owner}/${arm}`.toLowerCase()
    if (canonicalRemote(origin) !== want) throw new Error(`${dir} origin must be ${want}`)
    return { manifest, origin: canonicalRemote(origin) }
}
