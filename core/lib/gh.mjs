/**
 * The one wrapper for `gh api` (REST and GraphQL). Scripts never call `gh issue view` or the classic projects API.
 * A non-zero exit, or a GraphQL `errors` array, throws GhError.
 */

import { spawnSync } from 'node:child_process'

export class GhError extends Error {
    name = 'GhError'
    constructor(message, { code = 1, http = null, stderr = '' } = {}) {
        super(message)
        Object.assign(this, { code, http, stderr })
    }
}

function run(args, input) {
    const r = spawnSync('gh', args, { encoding: 'utf8', input, maxBuffer: 1 << 26 })
    if (r.error || r.status !== 0) {
        const stderr = (r.stderr ?? r.error?.message ?? '').trim()
        throw new GhError(`gh ${args.slice(0, 3).join(' ')} failed: ${stderr.split('\n')[0]}`, { code: r.status ?? 1, http: Number(/\(HTTP (\d{3})\)/.exec(stderr)?.[1]) || null, stderr })
    }
    return r.stdout
}

/** The parsed JSON of one REST call. `paginate` returns the pages flattened into one array. `body` is sent as JSON on stdin. */
export function api(path, { method = 'GET', body, paginate = false } = {}) {
    const out = run(['api', '-X', method, path, ...(body === undefined ? [] : ['--input', '-']), ...(paginate ? ['--paginate', '--slurp'] : [])], body === undefined ? undefined : JSON.stringify(body))
    const data = out.trim() === '' ? null : JSON.parse(out)
    return paginate ? data.flat() : data
}

/** The `data` of one GraphQL call. Every operation is named, so the fake gh and the logs can tell them apart. */
export function gql(query, variables = {}) {
    const out = JSON.parse(run(['api', 'graphql', '--input', '-'], JSON.stringify({ query, variables })))
    if (out.errors?.length) throw new GhError(`GraphQL: ${out.errors.map((e) => e.message).join('; ')}`, { stderr: JSON.stringify(out.errors) })
    return out.data
}

/** True for an issue-number style argument; keeps `7;id` out of any request path. */
export const isNumber = (s) => /^[1-9]\d*$/.test(s ?? '')
