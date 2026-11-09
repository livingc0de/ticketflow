/** Seconds to sleep before the next poll: the poll interval, but never past the deadline (a wait that must fit a tool's own timeout may not overshoot it). */
export const nextSleepSec = (deadlineMs, nowMs, pollSec = 60) => Math.max(1, Math.min(pollSec, Math.ceil((deadlineMs - nowMs) / 1000)))
