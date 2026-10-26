#!/usr/bin/env node
/**
 * Prints one issue in full: header, body, every comment (oldest first) and its sub-issues in order.
 * Reads through `gh api` only (REST); `gh issue view` is never used.
 *
 * Usage: issue.mjs <number> [--config f]      Exit: 0 = printed, 2 = usage, config or API error.
 */

import { cli, main } from '../lib/cli.mjs'
import { GhError, api, isNumber } from '../lib/gh.mjs'

const { positionals: [n], cfg } = cli(import.meta.url, 'issue', '<number> [--config f]', {}, (p) => p.length === 1 && isNumber(p[0]))
const R = `repos/${cfg.repo}`

main('issue', () => {
    let issue, comments, subs
    try {
        issue = api(`${R}/issues/${n}`)
        comments = api(`${R}/issues/${n}/comments`, { paginate: true })
        subs = api(`${R}/issues/${n}/sub_issues`, { paginate: true })
    } catch (e) {
        if (e instanceof GhError) throw new GhError(`cannot read issue ${n}: ${e.message}`, e)
        throw e
    }
    const names = (xs, key) => xs.map((x) => x[key]).join(', ') || '-'
    console.log(`#${n} [${issue.state}] ${issue.title}`)
    console.log(`labels: ${names(issue.labels, 'name')}`)
    console.log(`assignees: ${names(issue.assignees, 'login')}`)
    console.log(`milestone: ${issue.milestone?.title ?? '-'}`)
    console.log(`url: ${issue.html_url}`)
    console.log(`\n${issue.body ?? ''}`)
    console.log(`\n## Comments (${comments.length})`)
    for (const c of comments) console.log(`\n--- @${c.user?.login} ${c.created_at} id ${c.id}\n${c.body ?? ''}`)
    if (subs.length) {
        console.log('\n## Sub-issues')
        for (const s of subs) console.log(`#${s.number} [${s.state}] ${s.title}`)
    }
})
