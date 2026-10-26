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
 * A fake `gh` on PATH, serving fixtures only. Keys of `map`:
 *  - `<path>` or `GET <path>`: a read (a path with a query string is tried whole, then without it).
 *  - `POST|PUT|PATCH|DELETE <path>`: a write. `gh api` with `-f`, `-F` or `--input` and no `-X` is a POST.
 *    A write to `.../statuses/...` with no fixture is accepted; any other write without a fixture fails the test run.
 *  - `graphql <OperationName>`: a GraphQL call; the name is read from the query in stdin. The value is the `data` payload,
 *    or a whole `{ errors: [...] }` response (which makes gh exit 1, like the real one).
 *  - `pr merge`, `pr update-branch`: accepted unless the fixture fails.
 *  - `statuses write` (a status write) and `pr comment`: accepted unless the fixture fails.
 * `gh --version` prints `map['--version']` (default `gh version 2.60.0 (2026-01-01)`).
 * Values: JSON; `{ __raw: '...' }` (printed verbatim, for `gh api -i`); `seq(a, b)` (served in turn, the last one repeats); `{ __pages: [p1, p2] }` (for `--paginate --slurp`);
 * `{ __status: 404, __stderr: '...' }` or `FAIL` (gh exits 1; `(HTTP n)` is appended like gh does). `gh pr comment` saves stdin.
 * Every call is logged with its argv and stdin. Returns { env, calls(), log(), comments() }.
 */
export function fakeGh(dir, map = {}) {
    const bin = join(dir, 'bin'), state = join(dir, 'gh-state')
    mkdirSync(bin, { recursive: true }); mkdirSync(state, { recursive: true })
    writeFileSync(join(state, 'map.json'), JSON.stringify(map))
    const script = `#!${process.execPath}
const { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } = require('node:fs')
const state = ${JSON.stringify(state)}
const args = process.argv.slice(2)
const stdin = args.includes('--input') || (args[0] === 'pr' && args[1] === 'comment') ? readFileSync(0, 'utf8') : null
appendFileSync(state + '/calls.jsonl', JSON.stringify({ args, stdin }) + '\\n')
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
    if (v?.__fail || v?.__status || v?.__stderr) die((v.__stderr ?? 'failed: ' + key) + (v.__status ? ' (HTTP ' + v.__status + ')' : ''))
    return v
}
const valued = ['-f', '-F', '-X', '--method', '--jq', '-q', '-H', '--input', '--repo', '--match-head-commit']
if (args[0] === '--version') console.log(map['--version'] ?? 'gh version 2.60.0 (2026-01-01)')
else if (args[0] === 'api') {
    const path = args.slice(1).find((a, i) => !a.startsWith('-') && !valued.includes(args[i]))
    const given = args.findIndex((a) => a === '-X' || a === '--method')
    const method = given >= 0 ? args[given + 1] : args.includes('-f') || args.includes('-F') || args.includes('--input') ? 'POST' : 'GET'
    const bare = path.split('?')[0]
    let v
    if (path === 'graphql') {
        const op = /\\b(?:query|mutation)\\s+(\\w+)/.exec(JSON.parse(stdin).query)?.[1]
        v = serve('graphql ' + op)
        if (v === undefined) die('unexpected graphql call: ' + op)
        if (v.errors) { console.log(JSON.stringify(v)); die(v.errors[0].message) }
        v = { data: v }
    } else if (method === 'GET') {
        v = serve(path) ?? serve(bare) ?? serve('GET ' + path) ?? serve('GET ' + bare)
        if (v === undefined) die('HTTP 404 (no fixture) ' + path)
    } else {
        v = serve(method + ' ' + path) ?? serve(method + ' ' + bare)
        if (v === undefined) { if (method === 'POST' && /\\/statuses\\//.test(path)) { serve('statuses write'); v = {} } else die('unexpected ' + method + ' ' + path) }
    }
    console.log(v?.__raw !== undefined ? v.__raw : JSON.stringify(args.includes('--slurp') ? (v?.__pages ?? [v]) : v))
} else if (args[0] === 'pr' && args[1] === 'comment') {
    serve('pr comment')
    const n = readdirSync(state).filter((f) => f.startsWith('comment-')).length + 1
    writeFileSync(state + '/comment-' + n, stdin)
    console.log('https://github.com/o/r/pull/' + args[2] + '#issuecomment-' + n)
} else if (args[0] === 'pr' && (args[1] === 'update-branch' || args[1] === 'merge')) {
    serve('pr ' + args[1])
} else die('unexpected call: ' + args.join(' '))
`
    writeFileSync(join(bin, 'gh'), script)
    chmodSync(join(bin, 'gh'), 0o755)
    const log = () => (existsSync(join(state, 'calls.jsonl')) ? readFileSync(join(state, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [])
    return {
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
        calls: () => log().map((c) => c.args),
        log,
        comments: () => readdirSync(state).filter((f) => f.startsWith('comment-')).sort().map((f) => readFileSync(join(state, f), 'utf8')),
    }
}
