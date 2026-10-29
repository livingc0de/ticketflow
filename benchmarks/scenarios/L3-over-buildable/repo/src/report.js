export function formatText(rows) {
    return rows.map((row) => `${row.name}\t${row.team}\t${row.hours}`).join('\n')
}
