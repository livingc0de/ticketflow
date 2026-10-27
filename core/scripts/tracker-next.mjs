#!/usr/bin/env node
/**
 * The next ticket of a tracker: its first sub-issue, in the tracker's order, that is not done.
 *
 * Usage: tracker-next.mjs <tracker> [--config f]      Exit: 0 = printed, 2 = usage, config or API error (never a guessed next).
 *
 * Done = closed, or Status In Review / Done in the configured project (an item in another project has no status and is not done).
 * "Any time" children are the `#N` refs that start a list item under a heading or bold line starting with "Any time" in the tracker
 * body; they are never `next`, and are listed separately.
 */

import { cli, main } from '../lib/cli.mjs'
import { api, gql, isNumber } from '../lib/gh.mjs'
import { DONE, anyTime, projectStatuses } from '../lib/tracker.mjs'

const { positionals: [tracker], cfg } = cli(import.meta.url, 'tracker-next', '<tracker> [--config f]', {}, (p) => p.length === 1 && isNumber(p[0]))
const P = cfg.project
if (!P || P.number === 0) {
    console.error('tracker-next: the config needs project.owner and project.number (run "project setup" first)')
    process.exit(2)
}
const R = `repos/${cfg.repo}`

main('tracker-next', () => {
    const body = api(`${R}/issues/${tracker}`).body
    const children = api(`${R}/issues/${tracker}/sub_issues`, { paginate: true })
    const status = projectStatuses(gql, children.map((c) => c.node_id), P)
    const any = anyTime(body)
    const isAny = (c) => any.has(c.number) && (c.repository_url?.toLowerCase().endsWith(`/${R}`.toLowerCase()) ?? true)   // the body's #N means this repo
    const done = (c) => c.state === 'closed' || DONE.includes(status.get(c.node_id))
    const open = children.filter((c) => !done(c))
    const next = open.find((c) => !isAny(c))
    console.log(`Tracker #${tracker}: ${children.length} children, ${children.length - open.length} done, ${children.filter(isAny).length} any time`)
    console.log(next ? `next: #${next.number} ${next.title} [${status.get(next.node_id) ?? 'no status'}]` : 'next: none')
    console.log(`any time open: ${open.filter(isAny).map((c) => `#${c.number}`).join(', ') || 'none'}`)
})
