export function paginate(rows, start, size) { return { items: rows.slice(start, start + size), next: start + size } }
