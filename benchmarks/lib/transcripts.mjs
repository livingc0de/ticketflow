import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join, relative, resolve } from 'node:path'

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,150}$/
const ALLOWED = [
    'agent', 'model', 'requested_model', 'scenario', 'arm', 'repeat', 'result_row_id', 'invocation_id',
    'status', 'checker_pass', 'agent_exit', 'signal', 'interrupted', 'reason', 'eval_sha', 'eval_fingerprint',
    'source_sha', 'ticketflow_sha', 'plugin_sha', 'plugin_bootstrap', 'timestamp',
]

const metadataOnly = (metadata) => Object.fromEntries(ALLOWED
    .filter((key) => Object.hasOwn(metadata ?? {}, key))
    .map((key) => [key, metadata[key]]))

/**
 * Archive only the two textual session outputs and allowlisted metadata.
 * Profiles, auth files, environment variables and temporary workspaces never enter the archive.
 */
export function archiveSession({ root, sessionId, agentOut, answerFile, metadata }) {
    const base = resolve(root)
    if (!SAFE_ID.test(sessionId)) throw new Error('invalid transcript session id')
    for (const file of [agentOut, answerFile]) {
        if (!existsSync(file)) throw new Error('transcript source files are missing')
        const stat = lstatSync(file)
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('transcript source files must be regular files')
    }
    mkdirSync(base, { recursive: true, mode: 0o700 })
    chmodSync(base, 0o700)
    let id = sessionId
    let n = 1
    while (existsSync(join(base, id))) id = `${sessionId}-${n++}`
    const dir = join(base, id)
    mkdirSync(dir, { mode: 0o700 })
    copyFileSync(agentOut, join(dir, 'agent.out'))
    copyFileSync(answerFile, join(dir, 'answer.txt'))
    chmodSync(join(dir, 'agent.out'), 0o600)
    chmodSync(join(dir, 'answer.txt'), 0o600)
    writeFileSync(join(dir, 'metadata.json'), JSON.stringify(metadataOnly(metadata), null, 2) + '\n', { mode: 0o600 })
    return {
        id,
        directory: relative(resolve(base, '..'), dir).replaceAll('\\', '/'),
        files: ['agent.out', 'answer.txt', 'metadata.json'],
    }
}

export function transcriptSessionId(prefix, values = {}) {
    const parts = [prefix, values.scenario, values.agent, values.arm, values.repeat]
        .filter((value) => value !== undefined && value !== null && value !== '')
        .map((value) => String(value).replace(/[^A-Za-z0-9._-]/g, '-'))
    return `${parts.join('-')}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`.slice(0, 151)
}
