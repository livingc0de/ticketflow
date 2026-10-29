import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const PLUGINS = {
    superpowers: { owner: 'obra', manifest: '.claude-plugin/plugin.json' },
    ponytail: { owner: 'DietrichGebert', manifest: '.claude-plugin/plugin.json' },
}

const canonicalRemote = (url) => url.trim()
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

/** Fingerprint benchmark inputs by content, including dirty files, not only the repository HEAD. */
export function evaluatorFingerprint(root, excluded = []) {
    const base = resolve(root), skip = new Set(excluded.map((p) => resolve(p))), hash = createHash('sha256')
    for (const rel of files(join(base, 'benchmarks'))) {
        if (skip.has(resolve(base, 'benchmarks', rel))) continue
        hash.update(rel.replaceAll('\\', '/') + '\0')
        hash.update(readFileSync(join(base, 'benchmarks', rel)))
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
