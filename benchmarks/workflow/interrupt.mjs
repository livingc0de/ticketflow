/** Coordinate external termination with the benchmark's active agent and cleanup state. */
export class WorkflowInterrupted extends Error {
    constructor(signal) {
        super(`workflow interrupted by ${signal}`)
        this.name = 'WorkflowInterrupted'
        this.code = 'WORKFLOW_INTERRUPTED'
        this.signal = signal
    }
}

export function signalState({ emitter = process, onSignal = () => {} } = {}) {
    let requested = null
    let stop = null
    const handlers = new Map(['SIGINT', 'SIGTERM'].map((signal) => [signal, () => {
        if (requested) return
        requested = signal
        onSignal(requested)
        stop?.()
    }]))

    return {
        install() {
            for (const [signal, handler] of handlers) emitter.on(signal, handler)
            return this
        },
        dispose() {
            for (const [signal, handler] of handlers) emitter.removeListener(signal, handler)
        },
        get signal() { return requested },
        setStop(fn) {
            stop = fn
            if (requested) fn()
        },
        clearStop(fn) {
            if (stop === fn) stop = null
        },
        throwIfRequested() {
            if (requested) throw new WorkflowInterrupted(requested)
        },
    }
}
