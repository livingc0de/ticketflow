import { roundMoney } from './money.js'

// The refund is a percentage of what the customer paid.
export function refundAmount(paid, percent) {
    return roundMoney((paid * percent) / 100)
}
