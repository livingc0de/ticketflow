#!/usr/bin/env node
/**
 * The operating mode of TicketFlow: `advanced` (default), `quick` or `off`.
 *
 * Usage: mode.mjs [get] [--config f]       prints the mode
 *        mode.mjs set <mode> [--config f]  validates and writes `mode`, then renders the files that follow from it
 *
 * `set` changes the working tree only: commit the config and the rendered files on a branch and merge the pull request. The scripts and local-verify
 * read the default branch's config, and the CI scope step the base side of the pull request, so the mode takes effect there when it merges. Exit: 0 = done, 1 = the render found a conflict (the config is written),
 * 2 = usage, config or write error (the config file is untouched).
 */

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cli, main } from '../lib/cli.mjs'
import { validate, writeConfigFile } from '../lib/config.mjs'

const MODES = ['advanced', 'quick', 'off']
const { positionals, cfg, configFile } = cli(import.meta.url, 'mode', '[get] | set <advanced|quick|off> [--config f]', {},
    (p) => p.length === 0 || (p.length === 1 && p[0] === 'get') || (p.length === 2 && p[0] === 'set' && MODES.includes(p[1])))

main('mode', () => {
    if (positionals[0] !== 'set') return void console.log(cfg.mode)
    const top = dirname(dirname(configFile))
    if (basename(dirname(configFile)) !== '.ticketflow' || basename(configFile) !== 'config.json') throw new Error(`set needs <repo>/.ticketflow/config.json, got ${configFile}`)   // render reads that file
    const raw = JSON.parse(readFileSync(configFile, 'utf8'))
    const next = { ...raw, mode: positionals[1] }
    validate(next)
    writeConfigFile(configFile, next)
    console.log(`mode: ${positionals[1]} written to ${configFile}`)
    const here = dirname(fileURLToPath(import.meta.url))
    const r = spawnSync('node', [join(here, 'render.mjs'), join(here, '..', 'templates'), top], { stdio: 'inherit' })   // the templates sit next to the scripts, in a user repo and in ticketflow itself
    console.log('next: commit the config and the rendered files on a branch and merge the pull request; CI and local-verify use the default branch until then.')
    if (positionals[1] === 'off') console.log('Fully off (GitHub side): on the user\'s request run `protect.mjs --apply --release-gate` after the merge. Back on: `protect.mjs` (plan), then `--apply`.')
    return r.status === 0 ? 0 : 1
})
