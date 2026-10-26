// Shared test helpers. Not named *.test.mjs, so `node --test` does not run it.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after } from 'node:test'
import { validate } from '../core/lib/config.mjs'

const made = []
after(() => { for (const dir of made) rmSync(dir, { recursive: true, force: true }) })

/** A temp directory that is removed when the importing test file is done. */
export const tempDir = (prefix = 'tf-') => {
    const dir = mkdtempSync(join(tmpdir(), prefix))
    made.push(dir)
    return dir
}

export const BASE_CONFIG = { schema_version: 1, repo: 'o/r', default_branch: 'main', verify: { mode: 'ci', command: 'npm test' } }

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof RegExp)
/** Merges plain objects recursively; arrays and scalars replace; `undefined` deletes the key. */
export function merge(base, over = {}) {
    const out = { ...base }
    for (const [k, v] of Object.entries(over)) {
        if (v === undefined) delete out[k]
        else out[k] = isObject(v) && isObject(out[k]) ? merge(out[k], v) : v
    }
    return out
}

export const rawConfig = (over) => merge(BASE_CONFIG, over)
/** A validated config object for in-process tests. */
export const config = (over) => validate(rawConfig(over))
/** Writes <dir>/config.json and returns its path. */
export function writeConfig(dir, over) {
    const path = join(dir, 'config.json')
    writeFileSync(path, JSON.stringify(rawConfig(over)))
    return path
}

/** Marks a fixture that returns its values in turn (the last one repeats), for a head that moves. */
export const seq = (...values) => ({ __seq: values })
/** Marks a fixture whose read fails. */
export const FAIL = { __fail: true }

/**
 * A fake `gh` on PATH, serving fixture files only.
 *  - `gh api <path>`: `map[path]` (a path with a query string is tried whole, then without it); `--paginate --slurp` wraps it in `[...]`.
 *    A value may be `seq(...)` or `FAIL`; an unknown path fails like a 404. A write (`-f`, `-X`) to `.../statuses/...` is accepted.
 *  - `gh pr comment`: stdin is saved (see `comments()`); prints a comment URL.
 *  - `gh pr update-branch`: accepted, unless `map['pr update-branch']` is FAIL.
 * Every call is logged. Returns { env, calls(), comments() }.
 */
export function fakeGh(dir, map = {}) {
    const bin = join(dir, 'bin'), state = join(dir, 'gh-state')
    mkdirSync(bin, { recursive: true }); mkdirSync(state, { recursive: true })
    writeFileSync(join(state, 'map.json'), JSON.stringify(map))
    const script = `#!${process.execPath}
const { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } = require('node:fs')
const state = ${JSON.stringify(state)}
const args = process.argv.slice(2)
appendFileSync(state + '/calls.log', JSON.stringify(args) + '\\n')
const map = JSON.parse(readFileSync(state + '/map.json', 'utf8'))
const die = (m) => { console.error('gh: ' + m); process.exit(1) }
const serve = (key) => {
    let v = map[key]
    if (v === undefined) return undefined
    if (v?.__seq) {
        const f = state + '/seq-' + Buffer.from(key).toString('hex')
        const i = existsSync(f) ? Number(readFileSync(f, 'utf8')) : 0
        writeFileSync(f, String(i + 1))
        v = v.__seq[Math.min(i, v.__seq.length - 1)]
    }
    if (v?.__fail) die('HTTP 500 for ' + key)
    return v
}
if (args[0] === 'api') {
    const path = args.slice(1).find((a, i) => !a.startsWith('-') && !['-f', '-F', '-X', '--method', '--jq', '-q', '-H', '--input'].includes(args[i]))
    const given = args.findIndex((a) => a === '-X' || a === '--method')
    const write = (given >= 0 ? args[given + 1] !== 'GET' : args.includes('-f') || args.includes('-F') || args.includes('--input'))
    if (write) { if (/\\/statuses\\//.test(path)) { console.log('{}'); process.exit(0) } die('unexpected write to ' + path) }
    const v = serve(path) ?? serve(path.split('?')[0])
    if (v === undefined) die('HTTP 404 (no fixture) ' + path)
    console.log(JSON.stringify(args.includes('--slurp') ? [v] : v))
} else if (args[0] === 'pr' && args[1] === 'comment') {
    const n = readdirSync(state).filter((f) => f.startsWith('comment-')).length + 1
    writeFileSync(state + '/comment-' + n, readFileSync(0, 'utf8'))
    console.log('https://github.com/o/r/pull/' + args[2] + '#issuecomment-' + n)
} else if (args[0] === 'pr' && args[1] === 'update-branch') {
    serve('pr update-branch')
} else die('unexpected call: ' + args.join(' '))
`
    writeFileSync(join(bin, 'gh'), script)
    chmodSync(join(bin, 'gh'), 0o755)
    return {
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
        calls: () => (existsSync(join(state, 'calls.log')) ? readFileSync(join(state, 'calls.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []),
        comments: () => readdirSync(state).filter((f) => f.startsWith('comment-')).sort().map((f) => readFileSync(join(state, f), 'utf8')),
    }
}
