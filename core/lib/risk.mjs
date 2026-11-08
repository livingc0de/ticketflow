/**
 * The minimum review lane of a pull request: may the agent merge it on its own self-check, or does it need a review?
 * A floor from facts (labels, paths, code size, untested code). It never grades a review and cannot lower a lane: the agent may always choose a review.
 * See core/docs/REVIEWERS.md.
 */

import { ALWAYS_REVIEW } from './config.mjs'
import { docsOnly } from './docs-only.mjs'
import { api } from './gh.mjs'

const TIERS = ['Low', 'Normal', 'High', 'Critical']
/** The highest `Tier:` label of the named tickets; none means Normal (the label is only needed to raise the floor). */
const tierOf = (labels) => {
    const ranks = labels.filter((l) => l.startsWith('Tier: ')).map((l) => TIERS.indexOf(l.slice(6))).filter((i) => i >= 0)
    return TIERS[ranks.length ? Math.max(...ranks) : 1]
}

const TEST = /(^|\/)(tests?|__tests__|spec)\/|[._-](test|spec)\.[^/]+$/
const names = (f) => [f.filename, f.previous_filename].filter((n) => typeof n === 'string')

/** A change with no readable line count (binary, mode-only, empty): its size is unknown, so it is never trusted. A pure rename is the exception. */
export const noLines = (f) => f.additions + f.deletions === 0 && f.status !== 'renamed'

/** The name of `f` (new or old path) that always needs a review, or undefined. Used by risk.mjs and merge.mjs alike. */
export const alwaysReviewHit = (f, cfg) => names(f).find((n) => [...ALWAYS_REVIEW, ...cfg.review.always_review].some((re) => re.test(n)))

/**
 * files: [{ filename, previous_filename?, additions, deletions, status? }], labels: [string] -> { lane: 'self-check' | 'review', reasons: [string], size: boolean,
 * reviewer: { cls: 'strong' | 'standard', why: [string] } } (size: every reason is about size; reviewer: the class a review of this diff should run at)
 */
export function minimumLane(files, labels, cfg) {
    const r = cfg.review
    const reasons = [], sizeReasons = [], strong = []
    if (!r.self_check) reasons.push('review.self_check is false')
    const tier = tierOf(labels)
    if (tier === 'Critical') { reasons.push('Tier: Critical needs a review of every head'); strong.push('Tier: Critical') }
    else if (tier === 'High') sizeReasons.push('Tier: High needs a first review')   // a ready review plus a small fix delta clears it, like size
    for (const l of labels) if (l === 'Security' || l.startsWith('Needs:')) { reasons.push(`label ${l}`); if (l === 'Security') strong.push(`label ${l}`) }
    if (!files.every((f) => typeof f?.filename === 'string' && f.filename.length > 0 && Number.isInteger(f.additions) && Number.isInteger(f.deletions))) reasons.push('the file list is unreadable'), strong.push('the file list is unreadable')
    else {
        for (const f of files) {
            const hit = alwaysReviewHit(f, cfg)
            if (hit) { reasons.push(`path ${hit} always needs a review`); strong.push(`path ${hit}`) }
        }
        // a renamed file is test or docs only when both its names are: code renamed into tests keeps counting
        const code = files.filter((f) => names(f).some((n) => !TEST.test(n) && !docsOnly([n], cfg)))
        const lines = code.reduce((n, f) => n + f.additions + f.deletions, 0)
        for (const f of code) if (noLines(f)) { reasons.push(`${f.filename} changed without a readable line count (binary?)`); strong.push(`${f.filename} has no readable size`) }
        // shortcut: 4 x the self-check limit is the "very large" line for a strong reviewer; give it its own review key if the Run lines show it misfires
        if (lines > 4 * r.self_check_max_lines) strong.push(`${lines} changed code lines (over ${4 * r.self_check_max_lines})`)
        if (code.length > r.self_check_max_files) sizeReasons.push(`${code.length} code files (limit ${r.self_check_max_files})`)
        if (lines > r.self_check_max_lines) sizeReasons.push(`${lines} changed code lines (limit ${r.self_check_max_lines})`)
        if (r.self_check_untested_lines !== null && lines > r.self_check_untested_lines && !files.some((f) => names(f).every((n) => TEST.test(n)))) sizeReasons.push(`${lines} changed code lines and no test file touched (limit ${r.self_check_untested_lines})`)
    }
    const all = [...reasons, ...sizeReasons]
    return { lane: all.length ? 'review' : 'self-check', reasons: all, size: reasons.length === 0 && sizeReasons.length > 0, reviewer: { cls: strong.length ? 'strong' : 'standard', why: strong } }
}

/** Every ticket number a PR names in its title and body ("Ticket #N"), first one first. */
export const ticketsOf = (pull) => [...new Set([...`${pull.title ?? ''}\n${pull.body ?? ''}`.matchAll(/\bTicket #(\d+)\b/g)].map((m) => m[1]))]

/**
 * Reads the files and the labels of every named ticket of a PR (throws GhError) and returns its minimum lane, plus the first ticket number.
 * No ticket, a named PR instead of a ticket, or a partial file list forces a review.
 */
export function laneOfPull(cfg, pull, pr) {
    const files = api(`repos/${cfg.repo}/pulls/${pr}/files`, { paginate: true })
    const tickets = ticketsOf(pull)
    const issues = tickets.map((n) => [n, api(`repos/${cfg.repo}/issues/${n}`)])
    const labels = issues.flatMap(([, i]) => i.labels.map((l) => l.name ?? l))
    const lane = minimumLane(files, labels, cfg)
    const extra = [...(tickets.length ? [] : ['no "Ticket #N" in the PR title or body']), ...issues.filter(([, i]) => i.pull_request).map(([n]) => `#${n} is a pull request, not a ticket`), ...(files.length === pull.changed_files ? [] : ['the file list is incomplete'])]
    const partial = files.length !== pull.changed_files   // an incomplete list hides the size and the paths: the class goes up
    const reviewer = { cls: partial || lane.reviewer.cls === 'strong' ? 'strong' : 'standard', why: [...lane.reviewer.why, ...(partial ? ['the file list is incomplete'] : [])] }
    return { lane: extra.length ? 'review' : lane.lane, reasons: [...extra, ...lane.reasons], size: extra.length === 0 && lane.size, ticket: tickets[0] ?? null, reviewer }
}
