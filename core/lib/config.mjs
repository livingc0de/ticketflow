/**
 * The ticketflow config: load, validate, migrate. See core/docs/CONFIG.md.
 *
 * Fails closed: a missing file, bad JSON, an unknown key, a wrong type, a bad regex or a schema version that is not this core's
 * is a ConfigError. Callers turn it into exit 2 (or an empty stdout for the CI helpers, which then run everything).
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export class ConfigError extends Error {
    name = 'ConfigError'
}

export const SCHEMA_VERSION = 1
/** `{ n: (config at n) => config at n + 1 }`. Only `sync` migrates; `loadConfig` never does. */
export const MIGRATIONS = {}

/** Built-in floors: the config can add to them, never remove them. */
export const NEVER_DOCS = Object.freeze([/^\.ticketflow\//, /^\.github\/workflows\//])
export const CI_FILE_FLOOR = Object.freeze([/^\.github\//, /^\.ticketflow\//, /^core\//])

const REACTIONS = ['+1', '-1', 'laugh', 'confused', 'heart', 'hooray', 'rocket', 'eyes']
const REQUIRED = Symbol('required')

const fail = (message) => { throw new ConfigError(message) }
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

const str = (v, p) => (typeof v === 'string' && v !== '' ? v : fail(`${p} must be a non-empty string`))
const text = (v, p) => (typeof v === 'string' ? v : fail(`${p} must be a string`))
const bool = (v, p) => (typeof v === 'boolean' ? v : fail(`${p} must be true or false`))
const int = (min, max = Infinity) => (v, p) => (Number.isInteger(v) && v >= min && v <= max ? v : fail(`${p} must be an integer from ${min}${max < Infinity ? ` to ${max}` : ''}`))
const oneOf = (...values) => (v, p) => (values.includes(v) ? v : fail(`${p} must be one of ${values.join(', ')}`))
const orNull = (parse) => (v, p) => (v === null ? null : parse(v, p))
const list = (parse) => (v, p) => (Array.isArray(v) ? v.map((x, i) => parse(x, `${p}[${i}]`)) : fail(`${p} must be a list`))
const regex = (flags = '') => (v, p) => {
    const source = str(v, p)
    try { return new RegExp(source, flags) } catch (e) { return fail(`${p} is not a valid regex: ${e.message}`) }
}
const ref = (v, p) => {
    // ponytail: a conservative subset of git ref names; no leading dash, so it can never be read as an option
    const ok = typeof v === 'string' && /^[\w][\w./-]*$/.test(v) && !/\.\.|\/\/|\/$|\.$|\.lock(\/|$)|\/\.|(^|\/)HEAD$/.test(v)
    return ok ? v : fail(`${p} must be a branch name`)
}
const repo = (v, p) => (typeof v === 'string' && /^[\w.-]+\/[\w.-]+$/.test(v) && !v.split('/').some((s) => /^\.+$/.test(s)) ? v : fail(`${p} must be owner/name`))

/** Parses an object against `shape` = { key: [parse, default | REQUIRED] }; an unknown key is an error. */
const section = (shape) => (v, p) => {
    if (!isObject(v)) fail(`${p || 'config'} must be an object`)
    for (const k of Object.keys(v)) if (!Object.hasOwn(shape, k)) fail(`unknown key ${p ? `${p}.` : ''}${k}`)
    const out = {}
    for (const [k, [parse, dflt]] of Object.entries(shape)) {
        const at = p ? `${p}.${k}` : k
        if (v[k] === undefined) {
            if (dflt === REQUIRED) fail(`missing ${at}`)
            out[k] = isObject(dflt) ? parse(dflt, at) : structuredClone(dflt)   // a missing section is parsed as {} to get its defaults
        } else out[k] = parse(v[k], at)
    }
    return out
}

const reviewer = section({
    name: [str, REQUIRED],
    login: [(v, p) => (typeof v === 'string' && /^[\w.[\]-]+$/.test(v) ? v : fail(`${p} must be a GitHub login`)), REQUIRED],
    rereview_comment: [orNull(str), null],
    no_findings_reaction: [orNull(oneOf(...REACTIONS)), null],
    unavailable_pattern: [orNull(regex('i')), null],
    stale_after_min: [orNull(int(1)), null],
})

const parse = section({
    schema_version: [int(0), REQUIRED],
    repo: [repo, REQUIRED],
    default_branch: [ref, REQUIRED],
    verify: [section({
        mode: [oneOf('ci', 'local-first'), REQUIRED],
        install: [text, ''],
        command: [str, REQUIRED],
        timeout_min: [int(1, 360), 45],
    }), REQUIRED],
    gate: [section({
        context: [str, 'ci/gate'],
        check: [str, 'Verify'],
        inherit: [bool, false],
        ci_files: [list(regex()), []],
    }), {}],
    docs_only: [section({ docs: [list(regex()), []], code: [list(regex()), []] }), {}],
    reviewers: [list(reviewer), []],
    deploy_branch: [orNull(ref), null],
})

const deepFreeze = (v) => {
    if (v !== null && typeof v === 'object' && !(v instanceof RegExp)) { for (const x of Object.values(v)) deepFreeze(x); Object.freeze(v) }
    return v
}

/** Validates a parsed config and returns it with defaults applied, regexes compiled, deeply frozen. */
export function validate(raw) {
    if (isObject(raw) && Number.isInteger(raw.schema_version)) {
        if (raw.schema_version < SCHEMA_VERSION) fail(`config schema_version ${raw.schema_version} is older than this core's ${SCHEMA_VERSION}: run sync`)
        if (raw.schema_version > SCHEMA_VERSION) fail(`config schema_version ${raw.schema_version} is newer than this core's ${SCHEMA_VERSION}: core older than config: sync`)
    }
    const cfg = parse(raw, '')
    if (cfg.deploy_branch === cfg.default_branch) fail('deploy_branch must differ from default_branch')
    if (cfg.gate.context === cfg.gate.check) fail('gate.context must differ from gate.check')
    return deepFreeze(cfg)
}

/** Applies MIGRATIONS[n] for n = current .. target - 1, in order. Throws on a gap or a config newer than the target. */
export function migrate(raw, migrations = MIGRATIONS, target = SCHEMA_VERSION) {
    let v = isObject(raw) ? raw.schema_version : undefined
    if (!Number.isInteger(v)) fail('schema_version must be an integer')
    if (v > target) fail(`config schema_version ${v} is newer than ${target}`)
    let out = raw
    for (; v < target; v++) {
        if (typeof migrations[v] !== 'function') fail(`no migration from schema_version ${v}`)
        const next = migrations[v](out)
        if (!isObject(next)) fail(`migration from schema_version ${v} did not return a config`)
        out = { ...next, schema_version: v + 1 }
    }
    return out
}

/** `.ticketflow/config.json` in the git toplevel of `fromDir` (the directory of the calling script). */
export function configPath(fromDir) {
    try {
        return join(execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: fromDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(), '.ticketflow', 'config.json')
    } catch {
        return fail(`${fromDir} is not inside a git checkout: pass --config <file>`)
    }
}

export function loadConfig(path) {
    let text
    try { text = readFileSync(path, 'utf8') } catch (e) { return fail(`cannot read config ${path}: ${e.code ?? e.message}`) }
    let raw
    try { raw = JSON.parse(text) } catch (e) { return fail(`config ${path} is not valid JSON: ${e.message}`) }
    return validate(raw)
}
