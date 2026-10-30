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

/**
 * Stop a process group politely, then force it down after a bounded grace period.
 * The returned function clears the escalation timer when the child closes.
 */
export function terminateProcess(child, { platform = process.platform, graceMs = 1000, onEscalate = () => {} } = {}) {
    signalProcess(child, 'SIGTERM', platform)
    const timer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
            signalProcess(child, 'SIGKILL', platform)
            onEscalate()
        }
    }, graceMs)
    timer.unref?.()
    return () => clearTimeout(timer)
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
        let timeout, clearEscalation = () => {}
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
            clearTimeout(timeout)
            clearEscalation()
            resolve({ status, signal, error, stdout, stderr, timedOut, outputLimit })
        }
        child.stdout.on('data', (value) => append('stdout', value))
        child.stderr.on('data', (value) => append('stderr', value))
        child.once('error', (error) => finish(null, null, error))
        child.once('close', (status, signal) => finish(status, signal))
        if (input === null) child.stdin.end()
        else child.stdin.end(input)
        if (timeoutMs > 0) timeout = setTimeout(() => { timedOut = true; stop() }, timeoutMs)
    })
}
