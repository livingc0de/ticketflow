#!/usr/bin/env node
/**
 * The recurring ticket steps as one call each, safe to repeat.
 *
 * Usage: ticket.mjs claim <issue> [--config f]      body on stdin: assign @me, Status "In Progress" (when a project is set), then the claim comment
 *        ticket.mjs handoff <issue> --pr <pr> [--config f]   body on stdin: Status "In Review" (when a project is set), then the summary comment
 *
 * The comment starts with a hidden marker (`<!-- ticketflow:claim -->` / `<!-- ticketflow:summary pr=<pr> -->`) and is skipped when the current
 * account already posted it: a resumed run never posts a second claim or a second summary of the same PR, while a later change to the
 * ticket (another PR) gets its own summary. Assignment and Status are idempotent and always run.
 * Exit: 0 = done, 1 = a GitHub step failed (the steps already done are printed), 2 = usage, config or empty body.
 */

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cli, main } from '../lib/cli.mjs'
import { GhError, api, isNumber } from '../lib/gh.mjs'

const { values, positionals: [cmd, issue], cfg, configFile } = cli(import.meta.url, 'ticket', 'claim <issue> | handoff <issue> --pr <pr> [--config f]  (comment body on stdin)', { pr: { type: 'string' } },
    (p, v) => p.length === 2 && isNumber(p[1]) && (p[0] === 'claim' ? v.pr === undefined : p[0] === 'handoff' && isNumber(v.pr)))
const R = `repos/${cfg.repo}`
const marker = cmd === 'claim' ? '<!-- ticketflow:claim -->' : `<!-- ticketflow:summary pr=${values.pr} -->`
const body = readFileSync(0, 'utf8').trim()
if (body === '') { console.error('ticket: the comment body on stdin is empty'); process.exit(2) }
const done = []

function status(name) {
    if (!cfg.project) return
    const r = spawnSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'project.mjs'), 'status', issue, name, '--config', configFile], { encoding: 'utf8' })
    if (r.status !== 0) throw new GhError(`project status "${name}" failed: ${(r.stderr || r.stdout).trim()}`)
    done.push(`status ${name}`)
}

main('ticket', () => {
    try {
        const me = api('user').login
        if (cmd === 'claim') {
            api(`${R}/issues/${issue}/assignees`, { method: 'POST', body: { assignees: [me] } })
            done.push(`assigned ${me}`)
            status('In Progress')
        } else status('In Review')
        const mine = api(`${R}/issues/${issue}/comments`, { paginate: true }).some((c) => c.user?.login === me && String(c.body ?? '').startsWith(marker))
        if (mine) console.log(`${cmd}: already ${cmd === 'claim' ? 'claimed' : 'handed off'}, comment kept`)
        else {
            api(`${R}/issues/${issue}/comments`, { method: 'POST', body: { body: `${marker}\n${body}` } })
            done.push(`${cmd === 'claim' ? 'claim' : 'summary'} comment`)
        }
        console.log(`${cmd} #${issue}: ${done.join(', ') || 'nothing to do'}`)
    } catch (e) {
        if (!(e instanceof GhError)) throw e
        console.error(`ticket: ${e.message}\nticket: done before the failure: ${done.join(', ') || 'nothing'}; run it again, it is safe to repeat`)
        return 1
    }
})
