/**
 * The minimum review lane of a pull request: may the agent merge it on its own self-check, or does it need a review?
 * A floor from facts (labels, paths, code size, untested code). It never grades a review and cannot lower a lane: the agent may always choose a review.
 * See core/docs/REVIEWERS.md.
 */

import { ALWAYS_REVIEW } from './config.mjs'
import { docsOnly } from './docs-only.mjs'
import { api } from './gh.mjs'

const TEST = /(^|\/)(tests?|__tests__|spec)\/|[._-](test|spec)\.[^/]+$/

/** files: [{ filename, previous_filename?, additions, deletions }], labels: [string] -> { lane: 'self-check' | 'review', reasons: [string], size: boolean } (size: every reason is about size) */
export function minimumLane(files, labels, cfg) {
    const r = cfg.review
    const reasons = [], sizeReasons = []
    if (!r.self_check) reasons.push('review.self_check is false')
    for (const l of labels) if (l === 'Security' || l.startsWith('Needs:')) reasons.push(`label ${l}`)
    const rules = [...ALWAYS_REVIEW, ...r.always_review]
    for (const f of files) {
        const hit = [f.filename, f.previous_filename].find((n) => typeof n === 'string' && rules.some((re) => re.test(n)))
        if (hit) reasons.push(`path ${hit} always needs a review`)
    }
    const code = files.filter((f) => !TEST.test(f.filename) && !docsOnly([f.filename], cfg))
    const lines = code.reduce((n, f) => n + f.additions + f.deletions, 0)
    if (code.length > r.self_check_max_files) sizeReasons.push(`${code.length} code files (limit ${r.self_check_max_files})`)
    if (lines > r.self_check_max_lines) sizeReasons.push(`${lines} changed code lines (limit ${r.self_check_max_lines})`)
    if (r.self_check_untested_lines !== null && lines > r.self_check_untested_lines && !files.some((f) => TEST.test(f.filename))) sizeReasons.push(`${lines} changed code lines and no test file touched (limit ${r.self_check_untested_lines})`)
    const all = [...reasons, ...sizeReasons]
    return { lane: all.length ? 'review' : 'self-check', reasons: all, size: reasons.length === 0 && sizeReasons.length > 0 }
}

/** The ticket number of a PR body ("Ticket #N"), or null. */
export const ticketOf = (body) => /\bTicket #(\d+)\b/.exec(String(body ?? ''))?.[1] ?? null

/** Reads the files and the ticket labels of a PR (throws GhError) and returns its minimum lane, plus the ticket number. No ticket or a partial file list forces a review. */
export function laneOfPull(cfg, pull, pr) {
    const files = api(`repos/${cfg.repo}/pulls/${pr}/files`, { paginate: true })
    const ticket = ticketOf(pull.body)
    const labels = ticket ? api(`repos/${cfg.repo}/issues/${ticket}`).labels.map((l) => l.name ?? l) : []
    const lane = minimumLane(files, labels, cfg)
    const extra = [...(ticket ? [] : ['no "Ticket #N" in the PR body']), ...(files.length === pull.changed_files ? [] : ['the file list is incomplete'])]
    return { lane: extra.length ? 'review' : lane.lane, reasons: [...extra, ...lane.reasons], size: extra.length === 0 && lane.size, ticket }
}
