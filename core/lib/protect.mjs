/**
 * The standard protection of the default branch and the pure functions that compare a repo with it.
 * `scripts/protect.mjs` reads, applies and reads back; nothing here calls gh.
 *
 * The ruleset: no deletion, no force push, a pull request (0 approvals, squash only), the gate status required on an up-to-date
 * branch. One bypass actor: the repository admin role, so that an explicit request of the owner stays possible.
 */

// The role id of "Repository admin" and the bypass mode: GitHub accepted both on a private repo; see "Bypass modes" in core/docs/SECURITY.md.
export const ADMIN_ROLE_ID = 5
export const BYPASS_MODE = 'pull_request'
/** What `current_user_can_bypass` reads for the admin once the ruleset has BYPASS_MODE. */
export const CAN_BYPASS = { always: 'always', pull_request: 'pull_requests_only' }[BYPASS_MODE]

export const RULESET_NAME = 'default branch'
export const SETTINGS = Object.freeze({
    allow_squash_merge: true, allow_merge_commit: false, allow_rebase_merge: false, delete_branch_on_merge: true, allow_update_branch: true,
})

const PULL_REQUEST_DEFAULTS = {
    required_approving_review_count: 0, dismiss_stale_reviews_on_push: false, require_code_owner_review: false,
    require_last_push_approval: false, required_review_thread_resolution: false,
}

const globRe = (p) => new RegExp(`^${p.split('**').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '[^/]*')).join('.*')}$`)
const hits = (pattern, branch) => pattern === '~ALL' || pattern === '~DEFAULT_BRANCH' || globRe(pattern).test(`refs/heads/${branch}`)

/**
 * How a repo-level ruleset relates to the default branch: `null` (does not touch it), `exact` (its include list is only the default
 * branch, written as `~DEFAULT_BRANCH` or `refs/heads/<b>`, and nothing excludes it: safe to update in place) or `broad` (it also
 * applies to the default branch but to other refs too, or through a pattern or an exclude). A broad ruleset is never updated in
 * place: adding the standard rules to it would spread them to every branch it names.
 */
export function relation(ruleset, branch) {
    if (ruleset.target !== 'branch') return null
    const { include = [], exclude = [] } = ruleset.conditions?.ref_name ?? {}
    if (exclude.some((p) => hits(p, branch))) return null   // an exclude wins: this ruleset does not apply to the branch
    if (!include.some((p) => hits(p, branch))) return null
    return include.every((p) => p === '~DEFAULT_BRANCH' || p === `refs/heads/${branch}`) && exclude.length === 0 ? 'exact' : 'broad'
}

const actor = { actor_id: ADMIN_ROLE_ID, actor_type: 'RepositoryRole', bypass_mode: BYPASS_MODE }
const sameActor = (a) => a.actor_type === actor.actor_type && a.actor_id === actor.actor_id

/**
 * The ruleset body that brings `existing` (a full ruleset from the API, or null) to the standard without weakening it:
 * rules of other types are kept; approvals and other pull request parameters that are stricter are kept (only the merge
 * methods are forced); the required contexts are the union of the existing ones, `extraContexts` and the gate, minus `drop` (the
 * one context the caller asked to replace, never the gate); other bypass actors are kept. Returns { body, warnings }.
 */
export function desiredRuleset(existing, cfg, extraContexts = [], drop = null) {
    const warnings = []
    const rules = (existing?.rules ?? []).map((r) => structuredClone({ type: r.type, ...(r.parameters ? { parameters: r.parameters } : {}) }))
    const ensure = (type, fix) => {
        let rule = rules.find((r) => r.type === type)
        if (!rule) rules.push(rule = { type })
        fix?.(rule)
    }
    ensure('deletion')
    ensure('non_fast_forward')
    ensure('pull_request', (r) => { r.parameters = { ...PULL_REQUEST_DEFAULTS, ...r.parameters, allowed_merge_methods: ['squash'] } })
    ensure('required_status_checks', (r) => {
        const checks = (r.parameters?.required_status_checks ?? []).filter((c) => c.context !== drop)   // by name: an app-bound copy goes too
        for (const check of [{ context: cfg.gate.context }, ...extraContexts]) if (check.context !== drop && !checks.some((c) => c.context === check.context)) checks.push(check)
        r.parameters = { do_not_enforce_on_create: false, ...r.parameters, strict_required_status_checks_policy: true, required_status_checks: checks }
    })
    const standard = ['deletion', 'non_fast_forward', 'pull_request', 'required_status_checks']
    const others = rules.filter((r) => !standard.includes(r.type)).map((r) => r.type)
    if (others.length) warnings.push(`kept other rules of the ruleset: ${others.join(', ')}`)
    const bypass = (existing?.bypass_actors ?? []).map((a) => (sameActor(a) ? { ...a, bypass_mode: BYPASS_MODE } : a))
    if (!bypass.some(sameActor)) bypass.push(actor)
    const kept = bypass.filter((a) => !sameActor(a))
    if (kept.length) warnings.push(`kept ${kept.length} other bypass actor(s) of the ruleset`)
    return {
        warnings,
        body: {
            name: existing?.name ?? RULESET_NAME, target: 'branch', enforcement: 'active',
            conditions: existing?.conditions ?? { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
            rules, bypass_actors: bypass,
        },
    }
}

/** One flat { path: value } map of the parts of a repo + ruleset that the standard sets. */
function flat({ settings, ruleset }) {
    const out = {}
    for (const k of Object.keys(SETTINGS)) out[`settings.${k}`] = settings?.[k]
    if (!ruleset) return out
    out['ruleset.enforcement'] = ruleset.enforcement
    out['ruleset.conditions'] = JSON.stringify([ruleset.conditions?.ref_name?.include ?? [], ruleset.conditions?.ref_name?.exclude ?? []])   // GitHub returns the keys in another order
    for (const r of ruleset.rules) {
        out[`ruleset.rules.${r.type}`] = 'present'
        for (const [k, v] of Object.entries(r.parameters ?? {})) {
            out[`ruleset.rules.${r.type}.${k}`] = k === 'required_status_checks' ? JSON.stringify(v.map((c) => c.context).sort()) : JSON.stringify(v)
        }
    }
    for (const a of ruleset.bypass_actors ?? []) out[`ruleset.bypass.${a.actor_type}:${a.actor_id}`] = a.bypass_mode
    return out
}

/** One line per difference, `path: current -> desired`, for the parts `desired` sets. Empty when the repo is at the standard. */
export function diff(current, desired) {
    const a = flat(current), b = flat(desired)
    const lines = current.ruleset ? [] : [`ruleset: (none) -> create "${desired.ruleset.name}"`]
    for (const k of Object.keys(b)) {   // only what the standard sets: GitHub adds defaults of its own to a ruleset it stores
        if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) lines.push(`${k}: ${a[k] ?? '(none)'} -> ${b[k] ?? '(none)'}`)
    }
    return lines
}

/** Contexts a classic protection requires. */
export function classicContexts(classic) {
    const checks = (classic.required_status_checks?.checks ?? []).map((c) => (Number.isInteger(c.app_id) && c.app_id > 0 ? { context: c.context, integration_id: c.app_id } : { context: c.context }))   // an app-bound check stays bound to its app
    const plain = (classic.required_status_checks?.contexts ?? []).filter((c) => !checks.some((x) => x.context === c)).map((context) => ({ context }))
    return [...checks, ...plain]
}

/** What a ruleset cannot take over from a classic protection: each is a reason not to delete it. */
export function classicBlockers(classic) {
    const out = []
    if (classic.required_pull_request_reviews?.required_approving_review_count > 0) out.push('required approvals')
    if (classic.required_pull_request_reviews?.require_code_owner_reviews) out.push('code owner reviews')
    if (classic.required_signatures?.enabled) out.push('signed commits')
    if (classic.required_linear_history?.enabled) out.push('linear history')
    if (classic.required_conversation_resolution?.enabled) out.push('conversation resolution')
    if (classic.lock_branch?.enabled) out.push('locked branch')
    if (classic.restrictions) out.push('push restrictions')
    return out
}
