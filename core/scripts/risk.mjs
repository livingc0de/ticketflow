#!/usr/bin/env node
/**
 * The minimum review lane of a pull request: `Lane: self-check` (merge may accept the agent's own self-check) or `Lane: review`, with one
 * `Reason:` line per rule that forces a review. A floor from facts, never a grade: the tier and the reviewer's strength stay the agent's call.
 * Rules and limits: core/docs/REVIEWERS.md, thresholds: the `review` section of the config.
 *
 * Usage: risk.mjs <pr> [--config f]
 * Exit: 0 = printed, 2 = usage, config or read error (callers treat it as `review`).
 */

import { cli, main } from '../lib/cli.mjs'
import { api, isNumber } from '../lib/gh.mjs'
import { laneOfPull } from '../lib/risk.mjs'

const { positionals: [pr], cfg } = cli(import.meta.url, 'risk', '<pr> [--config f]', {}, (p) => p.length === 1 && isNumber(p[0]))

main('risk', () => {
    const { lane, reasons } = laneOfPull(cfg, api(`repos/${cfg.repo}/pulls/${pr}`), pr)
    console.log(`Lane: ${lane}`)
    for (const r of reasons) console.log(`Reason: ${r}`)
})
