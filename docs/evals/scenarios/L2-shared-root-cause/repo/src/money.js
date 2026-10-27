// Rounds an amount to whole cents. Every price we show or charge goes through here.
export function roundMoney(amount) {
    return Math.round(amount * 100) / 100
}
