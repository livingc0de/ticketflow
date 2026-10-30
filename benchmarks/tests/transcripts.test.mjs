import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { archiveSession } from '../lib/transcripts.mjs'

test('transcript archives are collision-safe, private and allowlisted', () => {
    const root = mkdtempSync(join(tmpdir(), 'transcripts-'))
    const agentOut = join(root, 'agent.out'), answer = join(root, 'answer.txt'), archiveRoot = join(root, 'transcripts')
    writeFileSync(agentOut, 'raw output\n')
    writeFileSync(answer, 'answer\n')
    const metadata = { agent: 'claude', requested_model: 'model', secret: 'must not be copied' }
    const first = archiveSession({ root: archiveRoot, sessionId: 'fixed-session', agentOut, answerFile: answer, metadata })
    const second = archiveSession({ root: archiveRoot, sessionId: 'fixed-session', agentOut, answerFile: answer, metadata })
    assert.equal(first.id, 'fixed-session')
    assert.equal(second.id, 'fixed-session-1')
    for (const archive of [first, second]) {
        const dir = join(root, archive.directory)
        assert.deepEqual(archive.files, ['agent.out', 'answer.txt', 'metadata.json'])
        assert.deepEqual(readFileSync(join(dir, 'metadata.json'), 'utf8').includes('secret'), false)
        assert.equal(statSync(join(dir, 'agent.out')).mode & 0o777, 0o600)
        assert.equal(statSync(join(dir, 'answer.txt')).mode & 0o777, 0o600)
        assert.equal(statSync(join(dir, 'metadata.json')).mode & 0o777, 0o600)
    }
    assert.throws(() => archiveSession({ root: archiveRoot, sessionId: '../escape', agentOut, answerFile: answer, metadata }), /invalid transcript session id/)
})
