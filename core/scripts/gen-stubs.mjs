#!/usr/bin/env node
/**
 * Writes the agent stubs (and, in the ticketflow repo itself, the plugin manifests) for a repo from its canonical skills and roles.
 *
 * Usage: gen-stubs.mjs <canonical-dir> <target-repo> [--check]
 *   <canonical-dir> is inside the target: `core` in the ticketflow repo, `.ticketflow` in a user repo.
 * Exit: 0 = in sync (or written), 1 = a conflict (an unmarked file, or a symlink, at a stub path; nothing is written) or, with --check, drift,
 *       2 = usage, config or canonical error, before any write.
 */

import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'
import { loadConfig } from '../lib/config.mjs'
import { main } from '../lib/cli.mjs'
import { checkAdapter, parseCanonical, parseGuide, planWrites, renderStubs } from '../lib/stubs.mjs'

const usage = 'usage: gen-stubs <canonical-dir> <target-repo> [--check]'

main('gen-stubs', () => {
    const { values, positionals } = parseArgs({ options: { check: { type: 'boolean' } }, allowPositionals: true })
    if (positionals.length !== 2) throw new Error(usage)
    const target = resolve(positionals[1])
    const rel = relative(target, resolve(positionals[0])).split(sep).join('/')
    if (!rel || rel.startsWith('..') || rel.startsWith('/')) throw new Error(`${usage}: the canonical dir must be inside the target repo`)
    const canonical = join(target, rel)
    const cfg = loadConfig(join(target, '.ticketflow', 'config.json'))

    let version
    if (rel !== '.ticketflow') {
        for (const f of ['VERSION', 'skills/init/SKILL.md', 'skills/sync/SKILL.md']) if (!existsSync(join(target, f))) throw new Error(`${f} is missing: not the ticketflow repo`)
        version = readFileSync(join(target, 'VERSION'), 'utf8').trim()
    }
    // every adapter is scanned for stale stubs (an agent dropped from the config), only the configured ones are rendered
    const all = readdirSync(new URL('../adapters/', import.meta.url)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).map((name) => {
        try { return { name, ...JSON.parse(readFileSync(new URL(`../adapters/${name}.json`, import.meta.url), 'utf8')) } } catch (e) { throw new Error(`adapter ${name}: ${e.message}`) }
    })
    for (const a of all) checkAdapter(a)
    for (const n of cfg.agents) if (!all.some((a) => a.name === n)) throw new Error(`agent ${n} has no adapter in core/adapters`)
    const adapters = all.filter((a) => cfg.agents.includes(a.name))
    const ls = (dir) => (existsSync(join(canonical, dir)) ? readdirSync(join(canonical, dir)).sort() : [])
    const load = (file) => ({ ...parseCanonical(readFileSync(join(canonical, file), 'utf8'), `${rel}/${file}`), src: file })
    const skills = ls('skills').filter((n) => existsSync(join(canonical, 'skills', n, 'SKILL.md'))).map((n) => load(`skills/${n}/SKILL.md`))
    for (const n of cfg.practices) {   // an enabled practice without a SKILL.md (domain-guides, deploy-gating, analytics-events) has no stub
        if (!existsSync(join(canonical, 'practices', n))) throw new Error(`practice ${n} is enabled but ${rel}/practices/${n} is missing: run sync`)
        if (existsSync(join(canonical, 'practices', n, 'SKILL.md'))) skills.push(load(`practices/${n}/SKILL.md`))
    }
    const roles = ls('agents').filter((n) => n.endsWith('.md')).map((n) => load(`agents/${n}`))
    // a symlink is never read as ours and never removed; one at (or above) an expected path is a conflict, nothing is written through it
    const link = (path) => path.split('/').some((_, i, parts) => lstatSync(join(target, ...parts.slice(0, i + 1)), { throwIfNoEntry: false })?.isSymbolicLink())
    const guidesDir = join(target, 'docs', 'agents')
    const guides = !cfg.practices.includes('domain-guides') || !existsSync(guidesDir) ? [] : readdirSync(guidesDir).sort().filter((f) => f.endsWith('.md')).map((f) => {
        if (link(`docs/agents/${f}`) || !lstatSync(join(guidesDir, f)).isFile()) throw new Error(`docs/agents/${f} must be a regular file, and docs/agents a real directory`)
        return parseGuide(readFileSync(join(guidesDir, f), 'utf8'), `docs/agents/${f}`)
    })
    const expected = renderStubs({ skills, roles, adapters, cfg, runtimeRel: rel, version, guides, plugins: rel === '.ticketflow' ? [] : all.filter((a) => a.plugin) })   // the ticketflow repo ships every manifest

    // the files that could be ours: everything at an adapter's stub paths, plus the expected paths themselves
    const disk = new Map()
    const take = (path) => { if (existsSync(join(target, path)) && !link(path)) disk.set(path, readFileSync(join(target, path), 'utf8')) }
    for (const a of all) {
        for (const tpl of [a.skill.target, a.role?.target, a.rule].filter(Boolean)) {
            const [pre, post] = tpl.split('{name}')
            const dir = join(target, pre)
            if (!existsSync(dir)) continue
            for (const e of readdirSync(dir)) {
                if (post.startsWith('/')) take(pre + e + post)
                else if (e.endsWith(post)) take(pre + e)
            }
        }
    }
    for (const path of expected.keys()) take(path)
    const plan = planWrites(expected, disk)
    const linked = [...expected.keys()].filter(link)
    const write = plan.write.filter((p) => !linked.includes(p)), remove = plan.remove
    const conflicts = [...plan.conflicts.filter((p) => !linked.includes(p)), ...linked].sort()

    if (conflicts.length) {
        for (const p of conflicts) console.log(linked.includes(p) ? `conflict: ${p} is a symlink or sits under one; replace it with a real file or directory` : `conflict: ${p} exists and was not generated by gen-stubs; move or delete it`)
        return 1
    }
    if (values.check) {
        for (const p of write) console.log(`out of date: ${p}`)
        for (const p of remove) console.log(`stale: ${p}`)
        return write.length || remove.length ? 1 : 0
    }
    for (const p of write) {
        mkdirSync(dirname(join(target, p)), { recursive: true })
        writeFileSync(join(target, p), expected.get(p))
        console.log(`wrote ${p}`)
    }
    for (const p of remove) {
        rmSync(join(target, p))
        try { rmdirSync(dirname(join(target, p))) } catch { /* not empty, or a shared directory */ }   // ponytail: a skill's own directory goes with it
        console.log(`removed ${p}`)
    }
})
