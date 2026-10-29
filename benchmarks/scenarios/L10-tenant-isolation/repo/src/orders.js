export function lookupOrder(orders, tenantId, id) { return orders.find((o) => o.id === id) ?? null }
