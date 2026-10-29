import { readUpload } from './files.js'

// GET /uploads/<name>: the response for one request.
export function handleDownload(root, name) {
    const text = readUpload(root, name)
    if (text === null) return { status: 404, body: 'not found', type: 'text/plain' }
    return { status: 200, body: text, type: 'text/plain' }
}
