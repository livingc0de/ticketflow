export async function acceptWebhook(payload, db) {
  if (payload.type !== 'payment.succeeded') return
  const invoice = await db.getInvoice(payload.invoiceId)
  if (!invoice) return
  const paid = payload.amountCents
  await db.recordEvent(payload.id)
  await db.credit(invoice.ownerId, paid) // BUG: credit again on replay
}
