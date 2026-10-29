import { roundMoney } from './money.js'

export function lineTotal(quantity, unitPrice) {
    return roundMoney(quantity * unitPrice)
}
