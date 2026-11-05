/**
 * Where the one full verification runs in tiered mode.
 * Only a complete, trusted-by-policy PR (ticket, labels and file list) qualifies for local verification.
 * Unknown information and sensitive paths require Actions. The route is re-read before local status posting
 * and again at merge, so changing labels without changing the head cannot weaken a green gate.
 */
import { api } from './gh.mjs'
import { alwaysReviewHit, ticketsOf } from './risk.mjs'

export const localGate = (description = '') =>
    /^Local run on |^Local check on |^Inherited from /.test(description)
export const ciGate = (description = '') =>
    /^Actions run #\d+\b|^Local fallback (?:run|check) on /.test(description)

/** The gate description must match the selected route. A normal local run cannot authorize a High/Critical merge. */
export function validGateSource(route, description) {
    return route === 'local' ? localGate(description) : ciGate(description)
}

/** Pure decision, useful for tests and other providers. Tier: High/Critical or a sensitive path forces CI. */
export function verificationRoute(cfg, pull, files, issues) {
    if (cfg.verify.mode !== 'tiered') return { route: 'ci', reason: 'configured CI mode' }
    // The normal local runner cannot safely execute fork heads; they must use Actions.
    if (!pull?.head?.repo?.full_name || pull.head.repo.full_name !== pull.base?.repo?.full_name)
        return { route: 'ci', reason: 'fork or unavailable head repository' }
    const tickets = ticketsOf(pull)
    if (!tickets.length || issues.length !== tickets.length || issues.some((x) => !x || x.pull_request || !Array.isArray(x.labels)))
        return { route: 'ci', reason: 'ticket or labels unavailable' }
    if (!Number.isSafeInteger(pull.changed_files) || pull.changed_files < 1 ||
        !Array.isArray(files) || files.length !== pull.changed_files ||
        files.some((f) => typeof f?.filename !== 'string' || !Number.isInteger(f.additions) || !Number.isInteger(f.deletions)))
        return { route: 'ci', reason: 'incomplete or invalid changed files' }
    const labels = issues.flatMap((x) => x.labels.map((l) => typeof l === 'string' ? l : l?.name))
    if (labels.some((l) => typeof l !== 'string' || l === 'Security' || l.startsWith('Needs:') || (l.startsWith('Tier: ') && l !== 'Tier: Low' && l !== 'Tier: Normal')))
        return { route: 'ci', reason: 'high risk or unresolved decision' }
    if (files.some((f) => alwaysReviewHit(f, cfg)))
        return { route: 'ci', reason: 'sensitive paths require independent verification' }
    return { route: 'local', reason: 'Low/Normal ticket with no CI-only paths' }
}

/** Read the exact PR, file list and named tickets; an unreadable input is never assumed safe for local. */
export function routeOfPull(cfg, pull, pr, read = api) {
    if (cfg.verify.mode !== 'tiered') return { route: 'ci', reason: 'configured CI mode' }
    const tickets = ticketsOf(pull)
    if (!tickets.length) return { route: 'ci', reason: 'no named ticket' }
    const files = read(`repos/${cfg.repo}/pulls/${pr}/files`, { paginate: true })
    const issues = tickets.map((n) => read(`repos/${cfg.repo}/issues/${n}`))
    return verificationRoute(cfg, pull, files, issues)
}
