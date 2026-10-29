export function applyEvent(state, event) {
    return { balance: state.balance + event.delta, processed: [...state.processed, event.id] }
}
