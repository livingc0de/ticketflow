/** What `tracker-next` and `queue` share: a tracker's "any time" children, Project statuses, `Depends on` refs and the ticket state. */

import { GhError } from './gh.mjs'

/** The Status values that count as done (the handoff is In Review; the owner moves it to Done). */
export const DONE = ['In Review', 'Done']

const QUERY = `query TrackerStatus($ids:[ID!]!){ nodes(ids:$ids){ ... on Issue { id projectItems(first:50){ nodes{
  project{ number owner{ ... on User { login } ... on Organization { login } } }
  fieldValueByName(name:"Status"){ ... on ProjectV2ItemFieldSingleSelectValue { name } } } } } } }`

/** The issue numbers that start a list item under an "Any time" heading or bold line. */
export function anyTime(body) {
    const out = new Set()
    let inside = false
    for (const line of (body ?? '').split('\n')) {
        if (/^\s*(#{1,6}\s+|\*\*)/.test(line)) inside = /^\s*(#{1,6}\s+)?\**\s*any time/i.test(line)
        const item = inside && /^\s*[-*]\s+(.*)$/.exec(line)
        if (!item) continue
        for (let rest = item[1], m; (m = /^#(\d+)\s*(?:,|&|and)?\s*/.exec(rest)); rest = rest.slice(m[0].length)) out.add(Number(m[1]))
    }
    return out
}

/** Map of issue node id -> Status name (or null) in `project` ({ owner, number }); an item in another project has no status. */
export function projectStatuses(gql, ids, project) {
    const status = new Map()
    for (let i = 0; i < ids.length; i += 100) {
        const found = gql(QUERY, { ids: ids.slice(i, i + 100) }).nodes
        if (!Array.isArray(found)) throw new GhError('GraphQL returned no nodes')
        for (const n of found.filter(Boolean)) {
            const item = n.projectItems?.nodes.find((x) => x.project.number === project.number && x.project.owner?.login?.toLowerCase() === project.owner.toLowerCase())
            status.set(n.id, item?.fieldValueByName?.name ?? null)
        }
    }
    return status
}

/**
 * The dependencies of a ticket: the refs in the sentence that starts with "Depends on" (up to a `.` or `;`), or, when that sentence has
 * none ("Depends on:"), in the list items right after it. A number is an issue of `repo`; `owner/repo#N` of another repository is kept
 * as a string (queue treats it as not done: fail closed). "Part of #T" and "Blocks #M" are not dependencies.
 */
export function dependsOn(body, repo) {
    const out = new Set(), lines = (body ?? '').split('\n')
    const refs = (text) => {
        const found = []
        for (const [, where, n] of text.matchAll(/(?<![\w/-])(?:([\w.-]+\/[\w.-]+))?#(\d+)/g)) found.push(!where || where.toLowerCase() === repo.toLowerCase() ? Number(n) : `${where}#${n}`)
        return found
    }
    lines.forEach((line, i) => {
        const at = line.search(/depends on/i)
        if (at < 0) return
        const rest = line.slice(at + 10), end = rest.search(/\.(\s|$)|;/)
        const found = refs(end < 0 ? rest : rest.slice(0, end))
        if (!found.length) {
            for (let j = i + 1; j < lines.length && found.length < 50; j++) {
                if (/^\s*$/.test(lines[j])) continue
                if (!/^\s*[-*]\s/.test(lines[j])) break
                found.push(...refs(lines[j]))
            }
        }
        found.forEach((r) => out.add(r))
    })
    return [...out]
}

/**
 * The state of one ticket, from facts only (never from free text): done | conflict | merged | blocked | waiting | in-progress | ready.
 * `prs` are { state: 'open' | 'merged' | 'closed' }; `pending` the dependencies that are not done; `labels` are names; `project` is whether a Project is configured.
 */
export function ticketState({ closed, status, labels = [], prs = [], pending = [], project = true }) {
    const open = prs.filter((p) => p.state === 'open').length
    // without a project the handoff leaves no trace: a merged PR with no open one is as done as it can be seen
    if (closed || DONE.includes(status) || (!project && open === 0 && prs.some((p) => p.state === 'merged'))) return 'done'
    if (open > 1) return 'conflict'
    if (open === 0 && prs.some((p) => p.state === 'merged')) return 'merged'
    if (status === 'Blocked' || labels.some((l) => l.startsWith('Needs:'))) return 'blocked'
    if (pending.length) return 'waiting'
    if (open === 1 || status === 'In Progress') return 'in-progress'
    return 'ready'
}
