#!/usr/bin/env node
/**
 * The minimum review lane of a pull request: `Lane: self-check` (merge may accept the agent's own self-check) or `Lane: review`, with one
 * `Reason:` line per rule that forces a review, then `pr-reviewer class: strong (<why>)` or `pr-reviewer class: standard`: the class a review of this diff should run at
 * (strong for a Critical tier, a Security label, an always-review path, an unknown size or a very large diff). A floor from facts, never a grade; the agent may always choose strong.
 * Rules and limits: core/docs/REVIEWERS.md, thresholds: the `review` section of the config.
 *
 * Usage: risk.mjs <pr> [--config f]
 * Exit: 0 = printed, 2 = usage, config or read error (callers treat it as `review`).
 */

import { cli, main } from '../lib/cli.mjs'
import { api, isNumber } from '../lib/gh.mjs'
import { laneLines, laneOfPull } from '../lib/risk.mjs'

const { positionals: [pr], cfg } = cli(import.meta.url, 'risk', '<pr> [--config f]', {}, (p) => p.length === 1 && isNumber(p[0]))

main('risk', () => {
    for (const l of laneLines(laneOfPull(cfg, api(`repos/${cfg.repo}/pulls/${pr}`), pr))) console.log(l)
})
