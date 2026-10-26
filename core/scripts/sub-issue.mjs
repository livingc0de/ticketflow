#!/usr/bin/env node
/**
 * Makes an issue a sub-issue of a tracker, optionally right after another sub-issue.
 *
 * Usage: sub-issue.mjs add <tracker> <issue> [--after <issue>] [--config f]
 * Never replaces an existing parent. Exit: 0 = done, 1 = the issue has another parent or `--after` is not a sub-issue,
 * 2 = usage, config or API error.
 */

import { cli, main } from '../lib/cli.mjs'
import { GhError, api, isNumber } from '../lib/gh.mjs'

const { values, positionals: [, tracker, issue], cfg } = cli(import.meta.url, 'sub-issue', 'add <tracker> <issue> [--after <issue>] [--config f]', { after: { type: 'string' } }, (p, v) =>
    p[0] === 'add' && p.length === 3 && isNumber(p[1]) && isNumber(p[2]) && p[2] !== p[1] && (v.after === undefined || (isNumber(v.after) && v.after !== p[2] && v.after !== p[1])))
const R = `repos/${cfg.repo}`

main('sub-issue', () => {
    const children = api(`${R}/issues/${tracker}/sub_issues`, { paginate: true })
    const here = (c) => c.repository_url?.toLowerCase().endsWith(`/${R}`.toLowerCase()) ?? true   // a sub-issue can live in another repo: its number alone is not an identity
    const child = api(`${R}/issues/${issue}`)
    const anchor = values.after === undefined ? null : children.find((c) => here(c) && String(c.number) === values.after)
    if (values.after !== undefined && !anchor) {
        console.error(`sub-issue: #${values.after} is not a sub-issue of #${tracker}: nothing changed`)
        return 1
    }
    if (!children.some((c) => c.id === child.id)) {
        try {
            api(`${R}/issues/${tracker}/sub_issues`, { method: 'POST', body: { sub_issue_id: child.id } })
        } catch (e) {
            if (e.http !== 422) throw e
            console.error(`sub-issue: #${issue} cannot be added to #${tracker}: ${e.stderr.split('\n')[0]} (it may already have another parent)`)
            return 1
        }
        console.log(`#${issue} added to #${tracker}`)
    } else console.log(`#${issue} is already a sub-issue of #${tracker}`)
    if (anchor) {
        api(`${R}/issues/${tracker}/sub_issues/priority`, { method: 'PATCH', body: { sub_issue_id: child.id, after_id: anchor.id } })
        console.log(`#${issue} placed after #${values.after}`)
    }
})
