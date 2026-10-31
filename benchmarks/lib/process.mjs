import { spawn } from 'node:child_process'

/** Send a termination signal to a child process and its process group. */
export function signalProcess(child, signal, platform = process.platform) {
    if (!child?.pid) return false
    try {
        if (platform === 'win32') child.kill(signal)
        else process.kill(-child.pid, signal)
        return true
    } catch {
        try { child.kill(signal); return true } catch { return false }
    }
}

/** Check whether a non-Windows process group still has members. */
function processGroupAlive(child, platform = process.platform) {
    if (!child?.pid) return false
    if (platform === 'win32') return child.exitCode === null && child.signalCode === null
    try {
        process.kill(-child.pid, 0)
        return true
    } catch (error) {
        // EPERM means the group exists but the caller cannot probe it fully.
        return error?.code === 'EPERM'
    }
}

/**
 * Stop a process group politely, then force it down after a bounded grace period.
 * The returned function clears the escalation timer when the child closes.
 */
export function terminateProcess(child, { platform = process.platform, graceMs = 1000, onEscalate = () => {} } = {}) {
    signalProcess(child, 'SIGTERM', platform)
    const timer = setTimeout(() => {
        if (processGroupAlive(child, platform) && signalProcess(child, 'SIGKILL', platform)) onEscalate()
    }, graceMs)
    timer.unref?.()
    return () => clearTimeout(timer)
}

// Children of runProcess still running; a harness signal must not orphan a paid agent in its own process group.
const live = new Set()
let signalsInstalled = false
function forwardSignals() {
    if (signalsInstalled) return
    signalsInstalled = true
    for (const [name, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
        process.on(name, () => {
            for (const stop of [...live]) stop()
            const exit = () => process.exit(code)
            if (!live.size) exit()
            setTimeout(exit, 5000)
            setInterval(() => { if (!live.size) exit() }, 50)
        })
    }
}

/** Run a process with bounded process-group termination and captured output. */
export function runProcess(command, args, {
    cwd, env, input = null, timeoutMs = 0, graceMs = 1000, maxBuffer = 1 << 28,
    onStdout = () => {}, onStderr = () => {},
} = {}) {
    return new Promise((resolve, reject) => {
        let child
        try {
            child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' })
        } catch (error) {
            reject(error)
            return
        }
        let stdout = '', stderr = '', timedOut = false, outputLimit = false, stopping = false
        let childError = null, stdinError = null
        let timeout, clearEscalation = () => {}
        forwardSignals()
        const append = (which, value) => {
            const text = value.toString()
            if (which === 'stdout') stdout += text
            else stderr += text
            if ((stdout.length + stderr.length) > maxBuffer && !outputLimit) {
                outputLimit = true
                stop()
            }
            if (which === 'stdout') onStdout(text)
            else onStderr(text)
        }
        const stop = () => {
            if (stopping) return
            stopping = true
            clearEscalation = terminateProcess(child, { graceMs, onEscalate: onStderr.bind(null, '\nprocess group escalated to SIGKILL\n') })
        }
        const finish = (status, signal, error = null) => {
            live.delete(stop)
            clearTimeout(timeout)
            clearEscalation()
            resolve({ status, signal, error: error ?? stdinError, stdout, stderr, timedOut, outputLimit })
        }
        live.add(stop)
        child.stdout.on('data', (value) => append('stdout', value))
        child.stderr.on('data', (value) => append('stderr', value))
        child.stdin.on('error', (error) => { stdinError ??= error })
        child.once('error', (error) => { childError ??= error })
        child.once('close', (status, signal) => finish(status, signal, childError))
        try {
            if (input === null) child.stdin.end()
            else child.stdin.end(input)
        } catch (error) {
            stdinError ??= error
        }
        if (timeoutMs > 0) timeout = setTimeout(() => { timedOut = true; stop() }, timeoutMs)
    })
}
