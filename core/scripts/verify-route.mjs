#!/usr/bin/env node
/**
 * Prints "local" or "ci" for a PR. Unknown or incomplete GitHub data requires CI.
 * Usage: verify-route.mjs <PR> [--config f]
 * Never changes a PR, label, status or branch.
 */
import { cli, main } from '../lib/cli.mjs'
import { api, isNumber } from '../lib/gh.mjs'
import { routeOfPull } from '../lib/verification.mjs'

const { positionals: [pr], cfg } = cli(import.meta.url, 'verify-route', '<pr> [--config f]', {},
    (p) => p.length === 1 && isNumber(p[0]))
main('verify-route', () => {
    const route = routeOfPull(cfg, api(`repos/${cfg.repo}/pulls/${pr}`), pr)
    console.log(route.route)
    console.error(`Verification: ${route.route} (${route.reason})`)
})
