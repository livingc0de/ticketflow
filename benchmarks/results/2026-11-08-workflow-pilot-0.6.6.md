# Workflow benchmark comparison: pilot of TicketFlow 0.6.6 (the baseline)

W1, W5 and W6, all four arms, one run per cell, Claude Sonnet 5.5 at high effort through the API; TicketFlow at `7da2fda`, Superpowers at `2ce8aa1`, Ponytail at `96608e0`. One run per cell: read the ratios as indications, not as stable differences. The release gate of 0.7.0 reruns the TicketFlow arm into a separate file against this baseline.

> Axes are reported side by side with their cost. There is no blended score and no credit for artifact counts.
> Unknown costs, usage and interventions are never imputed. Retried cells use only their latest attempt.

Scored cells: **12** | Invalid cells excluded: **0** | Recorded attempts including retries: **12**
No judge file given: only deterministic facts are shown.

## A. Delivery

Requirement status per cell, equal weight per cell. landed = on the default branch; pending = exists only on an open PR, an ahead branch or the agent checkout; missing = not delivered.

Per arm

| Arm | Cells | Req landed | Req pending | Req missing | All req landed | Regressed (landed) | Regressed (pending) | Landing direct/pr/mixed/none | Median USD |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| bare | 3 | 0% | 93% | 7% | 0% | 0 | 0 | 0/0/0/3 | 0.06 |
| ponytail | 3 | 0% | 93% | 7% | 0% | 0 | 0 | 0/0/0/3 | 0.06 |
| superpowers | 3 | 0% | 60% | 40% | 0% | 0 | 0 | 0/0/0/3 | ≥0.08 |
| ticketflow | 3 | 67% | 33% | 0% | 67% | 0 | 0 | 0/2/0/1 | ≥0.27 |

Per scenario / arm

| Scenario / arm | Cells | Req landed | Req pending | Req missing | All req landed | Regressed (landed) | Regressed (pending) | Landing direct/pr/mixed/none | Median USD |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| W1 / bare | 1 | 0% | 100% | 0% | 0% | 0 | 0 | 0/0/0/1 | 0.04 |
| W1 / ponytail | 1 | 0% | 100% | 0% | 0% | 0 | 0 | 0/0/0/1 | 0.05 |
| W1 / superpowers | 1 | 0% | 100% | 0% | 0% | 0 | 0 | 0/0/0/1 | 0.08 |
| W1 / ticketflow | 1 | 0% | 100% | 0% | 0% | 0 | 0 | 0/0/0/1 | 0.08 |
| W5 / bare | 1 | 0% | 80% | 20% | 0% | 0 | 0 | 0/0/0/1 | 0.06 |
| W5 / ponytail | 1 | 0% | 80% | 20% | 0% | 0 | 0 | 0/0/0/1 | 0.06 |
| W5 / superpowers | 1 | 0% | 80% | 20% | 0% | 0 | 0 | 0/0/0/1 | ≥0.17 |
| W5 / ticketflow | 1 | 100% | 0% | 0% | 100% | 0 | 0 | 0/1/0/0 | ≥0.27 |
| W6 / bare | 1 | 0% | 100% | 0% | 0% | 0 | 0 | 0/0/0/1 | 0.09 |
| W6 / ponytail | 1 | 0% | 100% | 0% | 0% | 0 | 0 | 0/0/0/1 | 0.10 |
| W6 / superpowers | 1 | 0% | 0% | 100% | 0% | 0 | 0 | 0/0/0/1 | 0.06 |
| W6 / ticketflow | 1 | 100% | 0% | 0% | 100% | 0 | 0 | 0/1/0/0 | 1.23 |

## B. Autonomy

Human interventions are continuation replies. Sub-agent use is recorded, not rewarded.

Per arm

| Arm | Cells | Interventions (mean) | Continuations | Sessions exit != 0 | Interrupt fired/not-reached | Median minutes | Sub-agents (mean) | Permission denials (mean) | Median USD |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| bare | 3 | 0.0 | 0 | 0 | 0/1 | 0.5 | 0.0 | 0.0 | 0.06 |
| ponytail | 3 | 0.0 | 0 | 0 | 0/1 | 0.4 | 0.0 | 0.0 | 0.06 |
| superpowers | 3 | 0.3 | 1 | 1 | 1/0 | 0.4 | 0.0 | 0.0 | ≥0.08 |
| ticketflow | 3 | 0.0 | 0 | 1 | 1/0 | 3.6 | 0.7 | 0.0 | ≥0.27 |

Per scenario / arm

| Scenario / arm | Cells | Interventions (mean) | Continuations | Sessions exit != 0 | Interrupt fired/not-reached | Median minutes | Sub-agents (mean) | Permission denials (mean) | Median USD |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| W1 / bare | 1 | 0.0 | 0 | 0 | 0/0 | 0.3 | 0.0 | 0.0 | 0.04 |
| W1 / ponytail | 1 | 0.0 | 0 | 0 | 0/0 | 0.3 | 0.0 | 0.0 | 0.05 |
| W1 / superpowers | 1 | 0.0 | 0 | 0 | 0/0 | 0.4 | 0.0 | 0.0 | 0.08 |
| W1 / ticketflow | 1 | 0.0 | 0 | 0 | 0/0 | 0.4 | 0.0 | 0.0 | 0.08 |
| W5 / bare | 1 | 0.0 | 0 | 0 | 0/1 | 0.5 | 0.0 | 0.0 | 0.06 |
| W5 / ponytail | 1 | 0.0 | 0 | 0 | 0/1 | 0.4 | 0.0 | 0.0 | 0.06 |
| W5 / superpowers | 1 | 1.0 | 1 | 1 | 1/0 | 1.0 | 0.0 | 0.0 | ≥0.17 |
| W5 / ticketflow | 1 | 0.0 | 0 | 1 | 1/0 | 3.6 | 0.0 | 0.0 | ≥0.27 |
| W6 / bare | 1 | 0.0 | 0 | 0 | 0/0 | 0.6 | 0.0 | 0.0 | 0.09 |
| W6 / ponytail | 1 | 0.0 | 0 | 0 | 0/0 | 0.7 | 0.0 | 0.0 | 0.10 |
| W6 / superpowers | 1 | 0.0 | 0 | 0 | 0/0 | 0.4 | 0.0 | 0.0 | 0.06 |
| W6 / ticketflow | 1 | 0.0 | 0 | 0 | 0/0 | 9.5 | 2.0 | 0.0 | 1.23 |

## C. Code

Tests the arm wrote that fail on the original behaviour are a sign they test the change.

Per arm

| Arm | Cells | Deps added | Files outside scope (mean) | Lines added (median) | Lines removed (median) | Own tests fail on base | Median USD |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| bare | 3 | 0 | 0.0 | 55 | 2 | 100% | 0.06 |
| ponytail | 3 | 0 | 0.0 | 45 | 2 | 100% | 0.06 |
| superpowers | 3 | 0 | 0.0 | 25 | 2 | 100% (2/3 known) | ≥0.08 |
| ticketflow | 3 | 0 | 0.0 | 111 | 2 | 100% | ≥0.27 |

Per scenario / arm

| Scenario / arm | Cells | Deps added | Files outside scope (mean) | Lines added (median) | Lines removed (median) | Own tests fail on base | Median USD |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| W1 / bare | 1 | 0 | 0.0 | 22 | 2 | 100% | 0.04 |
| W1 / ponytail | 1 | 0 | 0.0 | 16 | 2 | 100% | 0.05 |
| W1 / superpowers | 1 | 0 | 0.0 | 25 | 2 | 100% | 0.08 |
| W1 / ticketflow | 1 | 0 | 0.0 | 20 | 2 | 100% | 0.08 |
| W5 / bare | 1 | 0 | 0.0 | 55 | 4 | 100% | 0.06 |
| W5 / ponytail | 1 | 0 | 0.0 | 45 | 5 | 100% | 0.06 |
| W5 / superpowers | 1 | 0 | 0.0 | 105 | 6 | 100% | ≥0.17 |
| W5 / ticketflow | 1 | 0 | 0.0 | 111 | 4 | 100% | ≥0.27 |
| W6 / bare | 1 | 0 | 0.0 | 156 | 1 | 100% | 0.09 |
| W6 / ponytail | 1 | 0 | 0.0 | 127 | 1 | 100% | 0.10 |
| W6 / superpowers | 1 | 0 | 0.0 | 0 | 0 | unknown | 0.06 |
| W6 / ticketflow | 1 | 0 | 0.0 | 316 | 2 | 100% | 1.23 |

## D. History and reasoning

Durable record counts are observed facts (any form). Probe: a fresh tool-less reader of the dossier only, scored against the checks.

Per arm

| Arm | Cells | Issues (mean) | Issue comments (mean) | PR bodies (mean) | Docs changed (mean) | Commit bodies (mean) | Median USD |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| bare | 3 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.06 |
| ponytail | 3 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.06 |
| superpowers | 3 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | ≥0.08 |
| ticketflow | 3 | 0.3 | 1.7 | 0.7 | 0.3 | 2.3 | ≥0.27 |

Per scenario / arm

| Scenario / arm | Cells | Issues (mean) | Issue comments (mean) | PR bodies (mean) | Docs changed (mean) | Commit bodies (mean) | Median USD |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| W1 / bare | 1 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.04 |
| W1 / ponytail | 1 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.05 |
| W1 / superpowers | 1 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.08 |
| W1 / ticketflow | 1 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.08 |
| W5 / bare | 1 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.06 |
| W5 / ponytail | 1 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.06 |
| W5 / superpowers | 1 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | ≥0.17 |
| W5 / ticketflow | 1 | 0.0 | 2.0 | 1.0 | 0.0 | 2.0 | ≥0.27 |
| W6 / bare | 1 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.09 |
| W6 / ponytail | 1 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.10 |
| W6 / superpowers | 1 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.06 |
| W6 / ticketflow | 1 | 1.0 | 3.0 | 1.0 | 1.0 | 5.0 | 1.23 |

## E. Review and fix

missed-no-review / missed-with-review: a planted defect that stayed in scope and landed. out-of-scope: the work never touched its file.

Per arm

| Arm | Cells | Defects fixed | Missed, no review | Missed, with review | Defect out of scope | Review observed | Review before landing | Unsafe landing | Median USD |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| bare | 3 | 2 | 0 | 0 | 0 | 0% | 0% | 0 | 0.06 |
| ponytail | 3 | 2 | 0 | 0 | 0 | 0% | 0% | 0 | 0.06 |
| superpowers | 3 | 1 | 0 | 0 | 1 | 0% | 0% | 0 | ≥0.08 |
| ticketflow | 3 | 2 | 0 | 0 | 0 | 67% | 67% | 0 | ≥0.27 |

Per scenario / arm

| Scenario / arm | Cells | Defects fixed | Missed, no review | Missed, with review | Defect out of scope | Review observed | Review before landing | Unsafe landing | Median USD |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| W1 / bare | 1 | 0 | 0 | 0 | 0 | 0% | 0% | 0 | 0.04 |
| W1 / ponytail | 1 | 0 | 0 | 0 | 0 | 0% | 0% | 0 | 0.05 |
| W1 / superpowers | 1 | 0 | 0 | 0 | 0 | 0% | 0% | 0 | 0.08 |
| W1 / ticketflow | 1 | 0 | 0 | 0 | 0 | 0% | 0% | 0 | 0.08 |
| W5 / bare | 1 | 1 | 0 | 0 | 0 | 0% | 0% | 0 | 0.06 |
| W5 / ponytail | 1 | 1 | 0 | 0 | 0 | 0% | 0% | 0 | 0.06 |
| W5 / superpowers | 1 | 1 | 0 | 0 | 0 | 0% | 0% | 0 | ≥0.17 |
| W5 / ticketflow | 1 | 1 | 0 | 0 | 0 | 100% | 100% | 0 | ≥0.27 |
| W6 / bare | 1 | 1 | 0 | 0 | 0 | 0% | 0% | 0 | 0.09 |
| W6 / ponytail | 1 | 1 | 0 | 0 | 0 | 0% | 0% | 0 | 0.10 |
| W6 / superpowers | 1 | 0 | 0 | 0 | 1 | 0% | 0% | 0 | 0.06 |
| W6 / ticketflow | 1 | 1 | 0 | 0 | 0 | 100% | 100% | 0 | 1.23 |

## P. Process

Observed facts judged by consequence. Unknown timing or verification is shown as unknown.

Per arm

| Arm | Cells | Landing timing known | Force pushes | Commits verified remote | Commits verified locally | Local verification before push | Open PRs left (mean) | Ahead branches (mean) | Local only | Median USD |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| bare | 3 | 100% | 0 | unknown | unknown | unknown | 0.0 | 0.0 | 3 | 0.06 |
| ponytail | 3 | 100% | 0 | unknown | unknown | unknown | 0.0 | 0.0 | 3 | 0.06 |
| superpowers | 3 | 100% | 0 | unknown | unknown | unknown | 0.0 | 0.0 | 2 | ≥0.08 |
| ticketflow | 3 | 100% | 0 | 100% (2/3 known) | 100% (2/3 known) | 100% (2/3 known) | 0.0 | 0.0 | 1 | ≥0.27 |

Per scenario / arm

| Scenario / arm | Cells | Landing timing known | Force pushes | Commits verified remote | Commits verified locally | Local verification before push | Open PRs left (mean) | Ahead branches (mean) | Local only | Median USD |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| W1 / bare | 1 | 100% | 0 | unknown | unknown | unknown | 0.0 | 0.0 | 1 | 0.04 |
| W1 / ponytail | 1 | 100% | 0 | unknown | unknown | unknown | 0.0 | 0.0 | 1 | 0.05 |
| W1 / superpowers | 1 | 100% | 0 | unknown | unknown | unknown | 0.0 | 0.0 | 1 | 0.08 |
| W1 / ticketflow | 1 | 100% | 0 | unknown | unknown | unknown | 0.0 | 0.0 | 1 | 0.08 |
| W5 / bare | 1 | 100% | 0 | unknown | unknown | unknown | 0.0 | 0.0 | 1 | 0.06 |
| W5 / ponytail | 1 | 100% | 0 | unknown | unknown | unknown | 0.0 | 0.0 | 1 | 0.06 |
| W5 / superpowers | 1 | 100% | 0 | unknown | unknown | unknown | 0.0 | 0.0 | 1 | ≥0.17 |
| W5 / ticketflow | 1 | 100% | 0 | 100% | 100% | 100% | 0.0 | 0.0 | 0 | ≥0.27 |
| W6 / bare | 1 | 100% | 0 | unknown | unknown | unknown | 0.0 | 0.0 | 1 | 0.09 |
| W6 / ponytail | 1 | 100% | 0 | unknown | unknown | unknown | 0.0 | 0.0 | 1 | 0.10 |
| W6 / superpowers | 1 | 100% | 0 | unknown | unknown | unknown | 0.0 | 0.0 | 0 | 0.06 |
| W6 / ticketflow | 1 | 100% | 0 | 100% | 100% | 100% | 0.0 | 0.0 | 0 | 1.23 |

## F. Cost

Unknown cost is never estimated; a median over cells with any unknown cost is unknown. A figure marked ≥ includes an interrupted session whose own token usage, priced at list rates, is only a lower bound.

Per arm

| Arm | Cells | Median USD | Total USD | Median minutes | Median turns | USD per landed req |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| bare | 3 | 0.06 | 0.19 | 0.5 | 5 | unknown |
| ponytail | 3 | 0.06 | 0.21 | 0.4 | 6 | unknown |
| superpowers | 3 | ≥0.08 | ≥0.31 | 0.4 | unknown | unknown |
| ticketflow | 3 | ≥0.27 | ≥1.58 | 3.6 | unknown | ≥0.10 |

Per scenario / arm

| Scenario / arm | Cells | Median USD | Total USD | Median minutes | Median turns | USD per landed req |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| W1 / bare | 1 | 0.04 | 0.04 | 0.3 | 6 | unknown |
| W1 / ponytail | 1 | 0.05 | 0.05 | 0.3 | 10 | unknown |
| W1 / superpowers | 1 | 0.08 | 0.08 | 0.4 | 13 | unknown |
| W1 / ticketflow | 1 | 0.08 | 0.08 | 0.4 | 12 | unknown |
| W5 / bare | 1 | 0.06 | 0.06 | 0.5 | 4 | unknown |
| W5 / ponytail | 1 | 0.06 | 0.06 | 0.4 | 5 | unknown |
| W5 / superpowers | 1 | ≥0.17 | ≥0.17 | 1.0 | unknown | unknown |
| W5 / ticketflow | 1 | ≥0.27 | ≥0.27 | 3.6 | unknown | ≥0.05 |
| W6 / bare | 1 | 0.09 | 0.09 | 0.6 | 5 | unknown |
| W6 / ponytail | 1 | 0.10 | 0.10 | 0.7 | 6 | unknown |
| W6 / superpowers | 1 | 0.06 | 0.06 | 0.4 | 5 | unknown |
| W6 / ticketflow | 1 | 1.23 | 1.23 | 9.5 | 7 | 0.11 |

## Invalid measurements

| Scenario | Arm | Repeat | Reason |
| --- | --- | ---: | --- |
| None | | | |

Invalid-attempt spend (including superseded attempts): $0.00. These costs are disclosed but not attributed to framework performance.
**Cost note:** Cells with an interrupted session show a lower bound (marked ≥): that session reports no cost, so its transcript token usage is priced at list rates, which runs 15-30% below the reported cost on completed sessions.
**Sub-agent warning:** Full descendant usage cannot be independently verified.
