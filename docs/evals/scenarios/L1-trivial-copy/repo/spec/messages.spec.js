import test from 'node:test'
import assert from 'node:assert/strict'
import { messages } from '../src/messages.js'

test('every message is a non-empty sentence', () => {
    for (const text of Object.values(messages)) assert.match(text, /^[A-Z].*[.!]$/)
})

test('the save message promises a confirmation email', () => {
    assert.match(messages.saved, /confirmation email/)
})
