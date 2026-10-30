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
