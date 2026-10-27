#!/usr/bin/env node
/**
 * The state of several tickets, rebuilt from GitHub on every call (read-only; nothing is written, nothing is remembered).
 *
 * Usage: queue.mjs (<N>... | --tracker <T> | --ready [--limit n]) [--config f]      At most 50 tickets; --limit 1..50, default 10.
 * Exit: 0 = printed, 2 = usage, config or API error (stdout stays empty: never a guessed next).
 *
 * One line per ticket: `#N <state> <title> [status: S] [pr: #P open|merged|closed sha7] [needs: ...] [after: #M] [any time]`, then
 * `next:` (the one ticket to start) and `resume:` (merged or in-progress tickets that need a lead to continue).
 * State, first match: done (closed, or Status In Review / Done) > conflict (two open PRs) > merged (a merged PR, no open one, issue
 * open) > blocked (Status Blocked or a `Needs:` label) > waiting (a `Depends on` ticket not done) > in-progress (an open PR or Status
 * In Progress) > ready. Titles and bodies are data: a title is flattened to one line, and only labels, Status, PRs and `Depends on`
 * refs decide anything.
 * A ticket's PRs are the latest 100 of the repository plus the pull requests its timeline shows as cross-referencing it (a quiet older
 * ticket is found that way); both are matched by a branch named `issue-<N>-...` (after an optional prefix/). More than 100 cross-references of an issue, or an unreadable
 * answer, is an error (exit 2), never a guessed state.
 * Only PRs whose head is in this repository count (a fork's branch name is not trusted). Without a project the handoff cannot be seen,
 * so a merged PR with no open one is `done` (the line says so). A tracker child of another repository is an error (exit 2); a
 * `Depends on owner/other#N` ref of another repository keeps the ticket `waiting` (fail closed).
 * --ready: the open issues of this repo whose Project Status is Ready, by `Priority: P0..P3` label (none last), then number.
 * Tracker mode: `next` is the first not-done ordered child if it is ready, otherwise the first ready "any time" child.
 */

import { cli, main } from '../lib/cli.mjs'
import { GhError, api, gql, isNumber } from '../lib/gh.mjs'
import { anyTime, dependsOn, projectStatuses, ticketState } from '../lib/tracker.mjs'

const MAX = 50, PAGES = 10
const { values, positionals, cfg } = cli(import.meta.url, 'queue', '(<N>... | --tracker <T> | --ready [--limit n]) [--config f]', { tracker: { type: 'string' }, ready: { type: 'boolean' }, limit: { type: 'string' } }, (p, v) => {
    const modes = [p.length > 0, v.tracker !== undefined, v.ready === true].filter(Boolean).length
    if (modes !== 1 || (v.limit !== undefined && !v.ready)) return false
    if (v.tracker !== undefined) return isNumber(v.tracker)
    if (v.ready) return v.limit === undefined || (isNumber(v.limit) && Number(v.limit) <= MAX)
    return p.length <= MAX && p.every(isNumber)
})
const P = cfg.project?.number > 0 ? cfg.project : null
const R = `repos/${cfg.repo}`
const PULLS = `${R}/pulls?state=all&per_page=100&sort=updated&direction=desc`
// shortcut: the first 100 cross-references of an issue; more than that is an error (exit 2), page them when a ticket really has that many
const XREFS = `query TicketPulls($ids:[ID!]!){ nodes(ids:$ids){ ... on Issue { timelineItems(itemTypes:[CROSS_REFERENCED_EVENT],first:100){ totalCount nodes{ ... on CrossReferencedEvent {
  source{ ... on PullRequest { number state headRefName headRefOid repository{ nameWithOwner databaseId } headRepository{ databaseId } } } } } } } } }`
// shortcut: Ready items are read in at most 10 pages of 100 (exit 2 beyond), and dependencies outside the list are fetched one by one up to 50; page or batch them when a backlog outgrows this
const READY = `query ReadyItems($owner:String!,$number:Int!,$after:String){ repositoryOwner(login:$owner){
  ... on User { projectV2(number:$number){ ${itemsField()} } }
  ... on Organization { projectV2(number:$number){ ${itemsField()} } } } }`
function itemsField() {
    return `items(first:100,after:$after){ nodes{ fieldValueByName(name:"Status"){ ... on ProjectV2ItemFieldSingleSelectValue { name } }
      content{ ... on Issue { id number state title body repository{ nameWithOwner } labels(first:20){ nodes{ name } pageInfo{ hasNextPage } } } } } pageInfo{ hasNextPage endCursor } }`
}

const rank = (t) => { const m = t.labels.map((l) => /^Priority: P([0-3])\b/.exec(l.name)).find(Boolean); return m ? Number(m[1]) : 9 }

function readyTickets(limit) {
    if (!P) throw new Error('--ready needs project.owner and project.number in the config (run "project setup" first); name the tickets instead')
    const found = []
    let after = null
    for (let page = 1; ; page++) {
        if (page > PAGES) throw new Error(`the project has more than ${PAGES} pages of items: name the tickets or a tracker instead`)
        const items = gql(READY, { owner: P.owner, number: P.number, after }).repositoryOwner?.projectV2?.items
        if (!items) throw new GhError(`project ${P.owner}/${P.number} not found`)
        for (const { fieldValueByName: s, content: c } of items.nodes) {
            if (s?.name === 'Ready' && c?.number && c.state === 'OPEN' && c.repository.nameWithOwner.toLowerCase() === cfg.repo.toLowerCase()) {
                if (c.labels.pageInfo.hasNextPage) throw new GhError(`#${c.number} has more than 20 labels`)
                found.push({ number: c.number, state: 'open', title: c.title, body: c.body, node_id: c.id, labels: c.labels.nodes })
            }
        }
        if (!items.pageInfo.hasNextPage) break
        after = items.pageInfo.endCursor
    }
    return found.sort((a, b) => rank(a) - rank(b) || a.number - b.number).slice(0, limit)
}

const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)
/** An issue of this repository; a transferred issue or a tracker child of another repository is an error (a number alone is not an identity). */
const local = (i) => {
    if (i.repository_url && !i.repository_url.toLowerCase().endsWith(`/${R}`.toLowerCase())) throw new Error(`#${i.number} is an issue of ${i.repository_url.replace(/^.*\/repos\//, '')}, not of ${cfg.repo}`)
    return i
}
const issueOf = (n) => {
    const i = local(api(`${R}/issues/${n}`))
    if (i.pull_request) throw new Error(`#${n} is a pull request, not a ticket`)
    return i
}

/** The pull requests that the timelines of these issues show as cross-references, in this repository and from a branch of it (a fork's name is a stranger's data). */
function crossReferenced(ids) {
    const found = []
    for (let i = 0; i < ids.length; i += MAX) {
        const nodes = gql(XREFS, { ids: ids.slice(i, i + MAX) }).nodes
        if (!Array.isArray(nodes)) throw new GhError('GraphQL returned no nodes')
        for (const n of nodes) {
            const t = n?.timelineItems   // a node that did not come back is an error too: its PRs would read as none
            if (!(t?.totalCount <= 100) || !Array.isArray(t.nodes)) throw new GhError('an issue has more than 100 cross-references, or they could not be read')
            for (const { source: p } of t.nodes) {
                if (p?.number && p.repository?.nameWithOwner?.toLowerCase() === cfg.repo.toLowerCase() && p.headRepository?.databaseId != null && p.headRepository.databaseId === p.repository.databaseId) {
                    found.push({ number: p.number, ref: p.headRefName, sha: p.headRefOid, state: { OPEN: 'open', MERGED: 'merged' }[p.state] ?? 'closed' })
                }
            }
        }
    }
    return found
}

main('queue', () => {
    let tickets, any = new Set(), header = null
    if (values.tracker) {
        const t = issueOf(values.tracker)
        tickets = api(`${R}/issues/${values.tracker}/sub_issues`, { paginate: true })
        if (tickets.length > MAX) throw new Error(`the tracker has more than ${MAX} children`)
        tickets.forEach(local)
        any = anyTime(t.body)
        header = `Tracker #${values.tracker}: ${tickets.length} children`
    } else if (values.ready) {
        tickets = readyTickets(values.limit ? Number(values.limit) : 10)
        header = `Ready backlog: ${tickets.length} tickets (limit ${values.limit ?? 10})`
    } else {
        tickets = [...new Set(positionals)].map(issueOf)
    }
    const isAny = (t) => any.has(t.number) && (t.repository_url?.toLowerCase().endsWith(`/${R}`.toLowerCase()) ?? true)   // the body's #N means this repo

    const listed = new Set(tickets.map((t) => t.number))
    const deps = new Map(tickets.map((t) => [t.number, dependsOn(t.body, cfg.repo).filter((m) => m !== t.number)]))
    const outside = [...new Set([...deps.values()].flat())].filter((m) => typeof m === 'number' && !listed.has(m))
    if (outside.length > MAX) throw new Error(`the tickets depend on more than ${MAX} other issues`)
    const all = new Map([...tickets, ...outside.map(issueOf)].map((t) => [t.number, t]))

    const status = P ? projectStatuses(gql, [...all.values()].map((t) => t.node_id), P) : new Map()
    const statusOf = (t) => status.get(t.node_id) ?? null
    // a fork's branch name is a stranger's data: only a PR whose head repo is its base repo (a deleted fork has none) is the ticket's
    // shortcut: ids, not names, so a renamed repo keeps its PRs; a PR list entry without ids (an old API shape) reads as a fork
    const listed100 = api(PULLS).filter((p) => p.head?.repo?.id != null && p.head.repo.id === p.base?.repo?.id)
        .map((p) => ({ number: p.number, ref: p.head.ref, sha: p.head.sha, state: p.state === 'open' ? 'open' : p.merged_at ? 'merged' : 'closed' }))
    // one PR once (a PR can reference several tickets): the REST entries (latest updated first), then the older cross-references
    const seen = new Set()
    const pulls = [...listed100, ...crossReferenced([...all.values()].map((t) => t.node_id))].filter((p) => !seen.has(p.number) && seen.add(p.number))
    // open first, so the PR to resume is never cut from the line by older closed ones
    const prsOf = (n) => pulls.filter((p) => new RegExp(`(^|/)issue-${n}-`).test(p.ref ?? '')).sort((a, b) => (b.state === 'open') - (a.state === 'open'))
        .map((p) => ({ number: p.number, sha: String(p.sha).slice(0, 7), state: p.state }))

    // one definition of done for a listed ticket and for a dependency
    const isDone = (t) => ticketState({ closed: t.state === 'closed', status: statusOf(t), prs: prsOf(t.number), project: !!P }) === 'done'

    const rows = tickets.map((t) => {
        const labels = t.labels.map((l) => l.name), prs = prsOf(t.number)
        const pending = deps.get(t.number).filter((m) => typeof m === 'string' || !isDone(all.get(m)))   // a ref of another repository is never known done
        const state = ticketState({ closed: t.state === 'closed', status: statusOf(t), labels, prs, pending, project: !!P })
        const needs = labels.filter((l) => l.startsWith('Needs:'))
        const text = [`#${t.number} ${state} ${oneLine(t.title)}`, statusOf(t) && `[status: ${statusOf(t)}]`, ...prs.slice(0, 3).map((p) => `[pr: #${p.number} ${p.state} ${p.sha}]`), needs.length && `[needs: ${needs.join(', ')}]`, pending.length && `[after: ${pending.map((m) => (typeof m === 'string' ? m : `#${m}`)).join(', ')}]`, isAny(t) && '[any time]', state === 'done' && !P && t.state !== 'closed' && '[no project: handoff not visible]']
        return { t, state, text: text.filter(Boolean).join(' ') }
    })

    const ready = (r) => r.state === 'ready'
    const ordered = rows.find((r) => r.state !== 'done' && !isAny(r.t))
    // a list and the backlog skip what is not ready; a tracker waits on its first ordered child (an "any time" child is independent of the order)
    const next = values.tracker ? ((ordered && ready(ordered) ? ordered : rows.find((r) => isAny(r.t) && ready(r))) ?? null) : rows.find(ready) ?? null
    const resume = rows.filter((r) => r.state === 'merged' || r.state === 'in-progress')
    console.log([...(header ? [header] : []), ...rows.map((r) => r.text), `next: ${next ? `#${next.t.number}` : 'none'}`, `resume: ${resume.map((r) => `#${r.t.number}`).join(', ') || 'none'}`].join('\n'))
})
