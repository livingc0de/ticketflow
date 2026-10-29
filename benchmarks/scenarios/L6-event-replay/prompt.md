A payment webhook may be delivered repeatedly. Make applyEvent idempotent by event id while keeping state immutable; add a regression test.
