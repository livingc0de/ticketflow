#!/usr/bin/env node
/**
 * Answers one review thread of a pull request and resolves it. The reply (what fixed it, or why it is rejected) is read from stdin.
 *
 * Usage: thread.mjs <pr> <thread-id> [--config f]     (thread ids are listed by pr-wait and merge: `[PRRT_...]`)
 * Refuses a thread of another pull request or repository before any write. A resolved thread is left alone (exit 0). Posting is
 * skipped when the thread's last comment is ours with the same text, so a rerun after a failed resolve adds no second reply.
 *
 * Exit: 0 = the thread is resolved, 1 = the thread is not on this pull request (or does not exist or is not visible), 2 = usage, config, API or response error.
 */

import { readFileSync } from 'node:fs'
import { cli, main } from '../lib/cli.mjs'
import { GhError, gql, isNumber } from '../lib/gh.mjs'

const { positionals: [pr, id], cfg } = cli(import.meta.url, 'thread', '<pr> <thread-id> [--config f]  (reply on stdin)', {}, (p) => p.length === 2 && isNumber(p[0]) && /^PRRT_[\w-]+$/.test(p[1]))
const reply = readFileSync(0, 'utf8').trim()
if (reply === '') {
    console.error('thread: the reply on stdin is empty: say what fixed the finding, or why it is rejected')
    process.exit(2)
}

main('thread', () => {
    let t = null
    try {
        t = gql('query ThreadOf($id:ID!){ node(id:$id){ ... on PullRequestReviewThread { isResolved pullRequest{ number repository{ nameWithOwner } } comments(last:1){ nodes{ body viewerDidAuthor } } } } }', { id }).node
    } catch (e) {
        if (!(e instanceof GhError && /Could not resolve to a node/.test(e.stderr))) throw e   // GitHub answers an unknown id with NOT_FOUND and node null
    }
    if (!t?.pullRequest || t.pullRequest.number !== Number(pr) || t.pullRequest.repository.nameWithOwner.toLowerCase() !== cfg.repo.toLowerCase()) {
        console.error(`thread: ${id} is not a review thread of ${cfg.repo}#${pr}: nothing changed`)
        return 1
    }
    if (t.isResolved) {
        console.log(`${id} is already resolved`)
        return 0
    }
    const last = t.comments.nodes[0]
    if (!(last?.viewerDidAuthor && last.body.trim() === reply)) {
        gql('mutation ReplyThread($id:ID!,$body:String!){ addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$id,body:$body}){ comment{ id } } }', { id, body: reply })
    }
    gql('mutation ResolveThread($id:ID!){ resolveReviewThread(input:{threadId:$id}){ thread{ isResolved } } }', { id })
    console.log(`${id} answered and resolved`)
})
