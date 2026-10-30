/** Shared offline auth preflight and explicit interactive fallback for maintainer benchmarks. */
import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const cleanEnv = (env) => Object.fromEntries(Object.entries(env).filter(([key]) => !/(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|TOKEN|SECRET|PASSWORD|PRIVATE_KEY|CREDENTIAL)/i.test(key)))
const loggedIn = (command, args, options) => spawnSync(command, args, { encoding: 'utf8', timeout: 15_000, ...options }).status === 0

function claudeAuthMode() {
    if (process.env.ANTHROPIC_API_KEY?.trim() || process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim()) return 'isolated'
    const source = join(resolve(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')), '.credentials.json')
    try { if (readFileSync(source, 'utf8').trim()) return 'isolated' } catch { /* no portable login */ }
    if (loggedIn('claude', ['auth', 'status'])) return 'unisolated'
    throw new Error('Claude benchmark authentication preflight failed: no login available. ' +
        'Sign in with Claude Code or provide ANTHROPIC_API_KEY / CLAUDE_CODE_OAUTH_TOKEN. No paid session started.')
}

function codexAuthMode() {
    const originalHome = resolve(process.env.CODEX_HOME ?? join(homedir(), '.codex'))
    const from = join(originalHome, 'auth.json')
    const tmp = mkdtempSync(join(tmpdir(), 'codex-auth-check-'))
    const home = join(tmp, 'home'), codexHome = join(home, '.codex')
    let portable = false
    try {
        mkdirSync(codexHome, { recursive: true, mode: 0o700 })
        if (existsSync(from)) {
            const dest = join(codexHome, 'auth.json')
            copyFileSync(from, dest)
            chmodSync(dest, 0o600)
            portable = loggedIn('codex', ['login', 'status'], { env: { ...cleanEnv(process.env), HOME: home, CODEX_HOME: codexHome } })
        }
    } finally {
        rmSync(tmp, { recursive: true, force: true })
    }
    if (portable) return 'isolated'
    // A keyring-only login belongs to the original CODEX_HOME and cannot be copied.
    if (loggedIn('codex', ['login', 'status'], { env: { ...cleanEnv(process.env), CODEX_HOME: originalHome } })) return 'unisolated'
    throw new Error('Codex benchmark authentication preflight failed: no usable login. ' +
        'Sign in with codex login. API-key environment variables are intentionally not forwarded. No paid session started.')
}

export const approvalIsYes = (answer) => /^y(?:es)?$/i.test(answer.trim())

/** One explicit approval; fail closed when no terminal is attached or the user declines. */
function confirmUnisolated(agent, count, arms) {
    if (!process.stdin.isTTY) throw new Error(agent + ' uses a non-portable login. ' +
        'An interactive terminal is required to approve running without profile isolation. No paid session started.')
    process.stderr.write('\n' + agent + ': your login works in your original profile, but not an isolated benchmark profile.\n' +
        'Your existing settings, plugins and hooks may affect benchmark outcomes. The agent can modify its real profile.\n' +
        (agent === 'codex' && arms.some((arm) => arm === 'superpowers' || arm === 'ponytail')
            ? 'Codex will install a separate benchmark plugin and marketplace, then remove only those additions; existing plugins are preserved. An interruption or cleanup failure may leave benchmark additions behind.\n'
            : '') +
        'The temporary task Git repository remains separate; this is not an OS security sandbox.\n' +
        'Proceed without profile isolation for ' + count + ' paid benchmark session(s)? [y/N] ')
    const input = []
    const byte = Buffer.alloc(1)
    while (input.length < 16) {
        const n = readSync(process.stdin.fd, byte, 0, 1, null)
        if (!n || byte[0] === 10 || byte[0] === 13) break
        input.push(String.fromCharCode(byte[0]))
    }
    process.stderr.write('\n')
    if (!approvalIsYes(input.join(''))) throw new Error('Unisolated benchmark run declined. No paid session started.')
}

/** Called once by the matrix runner; its children receive the approved mode. */
export function selectProfileMode(agent, arms, { alreadyApproved = false, count = 1 } = {}) {
    const mode = agent === 'claude' ? claudeAuthMode() : codexAuthMode()
    if (mode === 'isolated') return mode
    if (!alreadyApproved) confirmUnisolated(agent, count, arms)
    return mode
}
