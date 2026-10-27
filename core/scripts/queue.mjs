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
 * --ready: the open issues of this repo whose Project Status is Ready, by `Priority: P0..P3` label (none last), then number.
 * Tracker mode: `next` is the first not-done ordered child if it is ready, otherwise the first ready "any time" child.
 */

import { cli, main } from '../lib/cli.mjs'
import { GhError, api, gql, isNumber } from '../lib/gh.mjs'
import { DONE, anyTime, dependsOn, projectStatuses, ticketState } from '../lib/tracker.mjs'

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
// shortcut: the 100 latest-updated PRs are searched for a ticket's branch; a quiet ticket under 100 newer PRs reads as having none, raise it when a repo has that many
const PULLS = `${R}/pulls?state=all&per_page=100&sort=updated&direction=desc`
// shortcut: Ready items are read in at most 10 pages of 100 (exit 2 beyond), and dependencies outside the list are fetched one by one up to 50; page or batch them when a backlog outgrows this
const READY = `query ReadyItems($owner:String!,$number:Int!,$after:String){ repositoryOwner(login:$owner){
  ... on User { projectV2(number:$number){ ${itemsField()} } }
  ... on Organization { projectV2(number:$number){ ${itemsField()} } } } }`
function itemsField() {
    return `items(first:100,after:$after){ nodes{ fieldValueByName(name:"Status"){ ... on ProjectV2ItemFieldSingleSelectValue { name } }
      content{ ... on Issue { id number state title body repository{ nameWithOwner } labels(first:20){ nodes{ name } } } } } pageInfo{ hasNextPage endCursor } }`
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
                found.push({ number: c.number, state: 'open', title: c.title, body: c.body, node_id: c.id, labels: c.labels.nodes })
            }
        }
        if (!items.pageInfo.hasNextPage) break
        after = items.pageInfo.endCursor
    }
    return found.sort((a, b) => rank(a) - rank(b) || a.number - b.number).slice(0, limit)
}

const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)
const issueOf = (n) => {
    const i = api(`${R}/issues/${n}`)
    if (i.pull_request) throw new Error(`#${n} is a pull request, not a ticket`)
    return i
}

main('queue', () => {
    let tickets, any = new Set(), header = null
    if (values.tracker) {
        const t = issueOf(values.tracker)
        tickets = api(`${R}/issues/${values.tracker}/sub_issues`, { paginate: true })
        if (tickets.length > MAX) throw new Error(`the tracker has more than ${MAX} children`)
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
    const deps = new Map(tickets.map((t) => [t.number, [...dependsOn(t.body)].filter((m) => m !== t.number)]))
    const outside = [...new Set([...deps.values()].flat())].filter((m) => !listed.has(m))
    if (outside.length > MAX) throw new Error(`the tickets depend on more than ${MAX} other issues`)
    const all = new Map([...tickets, ...outside.map(issueOf)].map((t) => [t.number, t]))

    const pulls = api(PULLS)
    const status = P ? projectStatuses(gql, [...all.values()].map((t) => t.node_id), P) : new Map()
    const statusOf = (t) => status.get(t.node_id) ?? null
    const isDone = (t) => t.state === 'closed' || DONE.includes(statusOf(t))
    const prsOf = (n) => pulls.filter((p) => new RegExp(`(^|/)issue-${n}-`).test(p.head?.ref ?? '')).map((p) => ({ number: p.number, sha: String(p.head.sha).slice(0, 7), state: p.state === 'open' ? 'open' : p.merged_at ? 'merged' : 'closed' }))

    const rows = tickets.map((t) => {
        const labels = t.labels.map((l) => l.name), prs = prsOf(t.number)
        const pending = deps.get(t.number).filter((m) => !isDone(all.get(m)))
        const state = ticketState({ closed: t.state === 'closed', status: statusOf(t), labels, prs, pending })
        const needs = labels.filter((l) => l.startsWith('Needs:'))
        const text = [`#${t.number} ${state} ${oneLine(t.title)}`, statusOf(t) && `[status: ${statusOf(t)}]`, ...prs.slice(0, 3).map((p) => `[pr: #${p.number} ${p.state} ${p.sha}]`), needs.length && `[needs: ${needs.join(', ')}]`, pending.length && `[after: ${pending.map((m) => `#${m}`).join(', ')}]`, isAny(t) && '[any time]']
        return { t, state, text: text.filter(Boolean).join(' ') }
    })

    const ready = (r) => r.state === 'ready'
    const ordered = rows.find((r) => r.state !== 'done' && !isAny(r.t))
    // a list and the backlog skip what is not ready; a tracker waits on its first ordered child (an "any time" child is independent of the order)
    const next = values.tracker ? ((ordered && ready(ordered) ? ordered : rows.find((r) => isAny(r.t) && ready(r))) ?? null) : rows.find(ready) ?? null
    const resume = rows.filter((r) => r.state === 'merged' || r.state === 'in-progress')
    console.log([...(header ? [header] : []), ...rows.map((r) => r.text), `next: ${next ? `#${next.t.number}` : 'none'}`, `resume: ${resume.map((r) => `#${r.t.number}`).join(', ') || 'none'}`].join('\n'))
})
