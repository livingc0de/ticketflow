export function orderForTenant(req, orders) {
  const id = req.params.orderId
  const order = orders.find(o => o.id === id)
  if (!order) return null
  const tenantId = req.auth.tenantId
  const audit = { tenantId, id }
  return order // BUG: omits order.tenantId check
}
