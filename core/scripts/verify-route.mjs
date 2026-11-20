#!/usr/bin/env node
/**
 * Prints "local" or "ci" for a PR. Unknown or incomplete GitHub data requires CI.
 * Usage: verify-route.mjs <PR> [--ready] [--config f]
 * Never changes a label, status or branch. With `--ready`, a draft pull request whose route is `ci` is marked ready in the same call (Actions runs the full
 * verification once it is ready); a `local` route is left as it is (local-verify marks it ready after the gate). Exit 1 prints the command when it could not.
 */
import { spawnSync } from 'node:child_process'
import { cli, main } from '../lib/cli.mjs'
import { api, isNumber } from '../lib/gh.mjs'
import { routeOfPull } from '../lib/verification.mjs'

const { values, positionals: [pr], cfg } = cli(import.meta.url, 'verify-route', '<pr> [--ready] [--config f]', { ready: { type: 'boolean' } },
    (p) => p.length === 1 && isNumber(p[0]))
main('verify-route', () => {
    const pull = api(`repos/${cfg.repo}/pulls/${pr}`)
    const route = routeOfPull(cfg, pull, pr)
    console.log(route.route)
    console.error(`Verification: ${route.route} (${route.reason})`)
    if (!values.ready || route.route !== 'ci' || pull.draft !== true) return 0
    const r = spawnSync('gh', ['pr', 'ready', pr, '-R', cfg.repo], { encoding: 'utf8' })
    if (r.status === 0) { console.error(`marked #${pr} ready`); return 0 }
    console.error(`not marked ready: gh pr ready ${pr} -R ${cfg.repo}`)
    return 1
})
