import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { signalState, WorkflowInterrupted } from './interrupt.mjs'

test('a signal requests the active stop once and is resumably observable', () => {
    const emitter = new EventEmitter(), seen = [], stopped = []
    const state = signalState({ emitter, onSignal: (signal) => seen.push(signal) }).install()
    const stop = () => stopped.push('stop')
    state.setStop(stop)
    emitter.emit('SIGINT')
    emitter.emit('SIGTERM')
    assert.deepEqual(seen, ['SIGINT'])
    assert.deepEqual(stopped, ['stop'])
    assert.throws(() => state.throwIfRequested(), (error) => error instanceof WorkflowInterrupted && error.signal === 'SIGINT')
    state.clearStop(stop)
    state.dispose()
    emitter.emit('SIGINT')
    assert.deepEqual(stopped, ['stop'])
})

test('a signal received before the child stop is registered stops it on registration', () => {
    const emitter = new EventEmitter(), stopped = []
    const state = signalState({ emitter }).install()
    emitter.emit('SIGTERM')
    state.setStop(() => stopped.push('stop'))
    assert.deepEqual(stopped, ['stop'])
    state.dispose()
})
