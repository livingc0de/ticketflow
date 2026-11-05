/**
 * The ticketflow config: load, validate, migrate. See core/docs/CONFIG.md.
 *
 * Fails closed: a missing file, bad JSON, an unknown key, a wrong type, a bad regex or a schema version that is not this core's
 * is a ConfigError. Callers turn it into exit 2 (or an empty stdout for the CI helpers, which then run everything).
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export class ConfigError extends Error {
    name = 'ConfigError'
}

export const SCHEMA_VERSION = 2
/** `{ n: (config at n) => config at n + 1 }`. Only `sync` migrates; `loadConfig` never does. */
export const MIGRATIONS = {
    1: ({ reviewers, ...rest }) => rest,   // 1 -> 2: external reviewers are observed from GitHub, no longer configured
}

/**
 * The self-check limits of this release. New configs store them; `sync` rewrites them while `review.custom_limits` is false, so a release can
 * change them. `LEGACY_REVIEW_LIMITS` are the values 0.6.3 and earlier wrote into every config.
 */
export const REVIEW_LIMITS = Object.freeze({ self_check_max_files: 5, self_check_max_lines: 120, self_check_untested_lines: 20, fix_check_max_lines: 30 })
const LEGACY_REVIEW_LIMITS = { self_check_max_files: 4, self_check_max_lines: 80, self_check_untested_lines: 10, fix_check_max_lines: 30 }

/**
 * Brings `review` to this release's limits unless the owner customized them. `custom_limits: true` keeps every value. A config without the flag
 * (written before it existed) is customized when a stored limit is neither the current nor the legacy default. Returns `raw` itself when nothing changes.
 */
export function refreshReview(raw) {
    const review = raw.review ?? {}
    if (!isObject(review)) return raw
    const custom = review.custom_limits ?? Object.entries(review).some(([k, v]) => k in REVIEW_LIMITS && v !== REVIEW_LIMITS[k] && v !== LEGACY_REVIEW_LIMITS[k])
    const next = { ...review, ...(custom ? {} : REVIEW_LIMITS), custom_limits: custom }
    return Object.keys(next).length === Object.keys(review).length && Object.keys(next).every((k) => next[k] === review[k]) ? raw : { ...raw, review: next }
}

/** Built-in floors: the config can add to them, never remove them. */
export const NEVER_DOCS = Object.freeze([/^\.ticketflow\//, /^\.github\/workflows\//])
/** Built-in floor of the self-check lane (`risk.mjs`): paths that change the gate, what an agent may run, or secrets always need a review. */
export const ALWAYS_REVIEW = Object.freeze([/^\.github\/workflows\//, /^\.ticketflow\//, /(^|\/)\.env/, /^\.(claude|codex|cursor|gemini|opencode|agents)\//, /(^|\/)(AGENTS|CLAUDE|GEMINI)\.md$/, /^\.github\/(agents|instructions|hooks|prompts)\//, /^\.github\/copilot-instructions\.md$/, /(^|\/)\.[\w-]*-plugin\//, /(^|\/)gemini-extension\.json$/])
/** Defaults of the effective `review.always_review`: sensible for most repos. A configured list adds to them; `review.default_always_review: false` drops them. */
const DEFAULT_ALWAYS_REVIEW = [
    /(^|\/)(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|requirements[^/]*\.txt|pyproject\.toml|go\.(mod|sum)|Cargo\.(toml|lock)|Gemfile(\.lock)?|composer\.(json|lock))$/,   // dependencies
    /(^|\/)migrations?\//, /\.sql$/,   // schema and data
]
export const CI_FILE_FLOOR = Object.freeze([/^\.github\//, /^\.ticketflow\//, /^core\//])

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
    // a conservative subset of git ref names; no leading dash, so it can never be read as an option
    const ok = typeof v === 'string' && /^[\w][\w./-]*$/.test(v) && !/\.\.|\/\/|\/$|\.$|\.lock(\/|$)|\/\.|(^|\/)HEAD$/.test(v)
    return ok ? v : fail(`${p} must be a branch name`)
}
// a conservative relative path; no `..`, no leading slash, no control characters
const dirPath = (v, p) => (typeof v === 'string' && /^[\w.-]+(\/[\w.-]+)*$/.test(v) && !v.split('/').some((s) => /^\.+$/.test(s)) ? v : fail(`${p} must be a relative directory path without ..`))
const area = (v, p) => (typeof v === 'string' && v.length >= 1 && v.length <= 44 && v.trim() === v && !/[\u0000-\u001f\u007f\u0085\u2028\u2029,{}]/.test(v) && v.toLowerCase() !== 'none' ? v : fail(`${p} must be 1-44 characters without commas, braces or control characters`))
// GitHub labels are limited to 50 characters; "Environment: " consumes 13 of them.
const environment = (v, p) => (typeof v === 'string' && v.length >= 1 && v.length <= 37 && v.trim() === v && !/[\u0000-\u001f\u007f\u0085\u2028\u2029,{}]/.test(v) ? v : fail(`${p} must be 1-37 characters without commas, braces or control characters`))
const glob = (v, p) => (typeof v === 'string' && v !== '' && !/[\u0000-\u001f\u007f\u0085\u2028\u2029]|\$\{\{/.test(v) ? v : fail(`${p} must be a non-empty path glob`))
// a name that is written into a workflow file, a comment and a shell variable: a conservative charset, so no line break or `${{ }}` can get in
const gateName = (v, p) => (typeof v === 'string' && /^[\w .\/:()#+@&-]+$/.test(v) && v.trim() === v ? v : fail(`${p} must be letters, digits, spaces and . / : ( ) # + @ & - only`))
// a shell command is written into a `run: |` block: no lone CR, no unicode line break, no control character, and no `${{` (put those steps in the CI file's own section)
const shellText = (v, p) => {
    const s = text(v, p)
    return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u0085\u2028\u2029]|\r(?!\n)|\$\{\{/.test(s) ? fail(`${p} must not contain control characters, a lone CR, a unicode line break or \${{`) : s
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

const VIEWS = ['All Work', 'Initiatives', 'Open Decisions', 'P0/P1 Open']
const unique = (parse) => (v, p) => { const out = parse(v, p); return new Set(out).size === out.length ? out : fail(`${p} has a duplicate`) }

/** The agents with a front door: `core/adapters/<n>.json` and `core/agents-map/<n>.md` each. */
export const AGENTS = Object.freeze(['claude', 'codex', 'cursor', 'gemini', 'opencode', 'antigravity', 'copilot'])
/** The optional practices shipped in `practices/`: a config enables them by name. */
export const PRACTICES = Object.freeze(['live-verify', 'runtime-settings', 'i18n', 'database', 'provider-adapters', 'api-endpoints', 'ui-screens', 'domain-guides', 'deploy-gating', 'analytics-events'])
// Provider-backed agents such as Copilot may identify models by display name, so spaces are valid.
const model = orNull((v, p) => (typeof v === 'string' && /^[\w][\w .:/[\]-]*$/.test(v) && v.trim() === v ? v : fail(`${p} must be a model id`)))
const modelClasses = section({ strong: [model, REQUIRED], standard: [model, REQUIRED], light: [model, REQUIRED] })
/** `{ default?: ..., <agent>?: ... }`, each with all three classes; `null` (inherit) is the only way to leave a model out. */
const models = (v, p) => {
    if (!isObject(v)) fail(`${p} must be an object`)
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === 'default' || AGENTS.includes(k) ? modelClasses(x, `${p}.${k}`) : fail(`unknown key ${p}.${k}`)]))
}

const parse = section({
    schema_version: [int(0), REQUIRED],
    repo: [repo, REQUIRED],
    default_branch: [ref, REQUIRED],
    verify: [section({
        mode: [(v, p) => { const mode = oneOf('ci', 'tiered', 'local', 'local-first')(v, p); return mode === 'local-first' ? 'local' : mode }, REQUIRED],
        install: [shellText, ''],
        command: [(v, p) => (str(v, p).trim() === '' ? fail(`${p} must not be blank`) : shellText(v, p)), REQUIRED],
        timeout_min: [int(1, 360), 45],
    }), REQUIRED],
    gate: [section({
        context: [gateName, 'CI / Gate'],
        check: [gateName, 'Verify'],
        inherit: [bool, false],
        ci_files: [list(regex()), []],
    }), {}],
    docs_only: [section({ docs: [list(regex()), []], code: [list(regex()), []] }), {}],
    deploy_branch: [orNull(ref), null],
    project: [orNull(section({
        owner: [str, REQUIRED],
        number: [int(0), REQUIRED],
        title: [orNull(str), null],
        views: [unique(list(oneOf(...VIEWS))), []],
    })), null],
    agents: [unique(list(oneOf(...AGENTS))), []],
    models: [models, {}],
    plans_dir: [dirPath, 'docs/plans'],
    worktrees_dir: [dirPath, '.worktrees'],
    live_verify_skill: [orNull((v, p) => (typeof v === 'string' && /^[a-z0-9-]+$/.test(v) ? v : fail(`${p} must be a skill name`))), null],
    deferred_checks_issue: [orNull(int(1)), null],
    areas: [unique(list(area)), []],
    environments: [unique(list(environment)), []],
    practices: [unique(list(oneOf(...PRACTICES))), []],
    review: [section({
        self_check: [bool, true],
        self_check_max_files: [int(1, 50), REVIEW_LIMITS.self_check_max_files],
        self_check_max_lines: [int(1, 2000), REVIEW_LIMITS.self_check_max_lines],
        self_check_untested_lines: [orNull(int(1, 2000)), REVIEW_LIMITS.self_check_untested_lines],
        fix_check_max_lines: [int(1, 2000), REVIEW_LIMITS.fix_check_max_lines],
        custom_limits: [bool, false],
        default_always_review: [bool, true],
        always_review: [list(regex()), []],   // added to the defaults in `validate`
    }), {}],
    ci: [section({ push_paths: [orNull(list(glob)), null] }), {}],
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
    // the effective list is computed once, here: every consumer reads `cfg.review.always_review` and gets the defaults plus the configured paths
    cfg.review.always_review = [...(cfg.review.default_always_review ? DEFAULT_ALWAYS_REVIEW : []), ...cfg.review.always_review]
    if (cfg.deploy_branch === cfg.default_branch) fail('deploy_branch must differ from default_branch')
    if (cfg.project?.number === 0 && cfg.project.title === null) fail('project.title is required while project.number is 0')
    if (cfg.deploy_branch !== null && cfg.ci.push_paths?.length) fail('ci.push_paths must be null or [] while deploy_branch is set: the deploy signal needs every push')
    for (const a of cfg.agents) if (!cfg.models[a] && !cfg.models.default) fail(`models.${a} or models.default is required while ${a} is in agents`)
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

/**
 * CLI, run from the cloned ticketflow by init and sync.
 *   config.mjs validate <file>             prints "config valid"; exit 2 with the error otherwise
 *   config.mjs migrate <file> [--write]    also refreshes the review limits unless review.custom_limits is true; prints "already at schema_version N", or the migrated JSON; --write replaces the file, only after
 *                                          the result validates. Exit 2 on any error, the file untouched.
 */
function isMain() {   // realpath: a symlinked path (macOS /var) must still run; a stdin or eval script has no path
    try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href } catch { return false }
}
if (isMain()) {
    try {
        const [cmd, file, flag, ...more] = process.argv.slice(2)
        if (!['validate', 'migrate'].includes(cmd) || !file || more.length || (flag !== undefined && !(cmd === 'migrate' && flag === '--write'))) throw new Error('usage: config validate <file> | migrate <file> [--write]')
        if (cmd === 'validate') {
            loadConfig(file)
            console.log('config valid')
        } else {
            let raw
            try { raw = JSON.parse(readFileSync(file, 'utf8')) } catch (e) { fail(`cannot read config ${file}: ${e.code ?? e.message}`) }
            const next = refreshReview(migrate(raw))
            validate(next)
            if (next === raw) console.log(`already at schema_version ${SCHEMA_VERSION}`)
            else if (flag) {
                const tmp = `${file}.tmp`
                writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n')
                renameSync(tmp, file)
                console.log(`migrated ${file} to schema_version ${SCHEMA_VERSION}`)
            } else console.log(JSON.stringify(next, null, 2))
        }
    } catch (e) {
        console.error(`config: ${e.message}`)
        process.exit(2)
    }
}
