# TicketFlow: Unified Engineering Quality, Efficiency, and Autonomous Orchestration

## Agent assignment: independently evaluate, plan, then implement

**Target repository:** https://github.com/livingc0de/ticketflow  
**Comparison repositories:** https://github.com/obra/superpowers and https://github.com/dietrichgebert/ponytail  
**Prepared:** 27 October 2026  
**Status:** Agent handoff and implementation assignment. Findings are hypotheses requiring an independent current-code audit, **not** an approved design. The agent is expected to plan **and then implement**, subject to the existing TicketFlow safeguards and only genuinely necessary owner decisions.

---

### Execution instructions (read first)

- **You have authorization to analyze, write a plan, and implement the agreed-in-principle improvement scope now.** Work within repository permissions and follow TicketFlow's own process; this is not a request to return only a draft.
- **First inspect the current code and challenge this report; then record a prioritized plan before making significant implementation changes.** For any very small bug fix required to make the process safe, use TicketFlow's standard change controls.
- **Use independent judgment.** Reject duplicative, obsolete or counterproductive suggestions. The expected goal is an improved product, not a checklist of features copied from other repos.
- **Do not silently change user-wide agent settings or external protected GitHub settings, enable privileged bypasses, or create credentials.** Ask permission for real owner-only actions; other work can proceed.
- **Keep an auditable result:** corrected comparison, architecture rationale, implementation plan, linked PRs, tests/evaluation evidence, before/after metrics where feasible, and limitations.
- **Avoid unnecessary pauses** for routine implementation details or preference questions. Follow the canonical ticket/CI/review/merge controls, without skipping meaningful owner decisions.

---

## 1. Assignment and desired outcome

Improve **TicketFlow** in three complementary ways:

1. Absorb selected **Superpowers** principles for sound software engineering (requirements discovery, planning, test-first changes, debugging, independent reviews).
2. Absorb selected **Ponytail** principles for efficiency (the smallest *complete* solution, reuse, proportionate tests, concise communication, credible review/audit, and measurable cost/time savings).
3. Introduce an **optional multi-ticket orchestrator** that coordinates fresh, bounded-context ticket agents, with optional nested specialist agents (up to **two delegation levels below the orchestrator**), safely carrying out a sequence of GitHub tickets without a continually expanding main conversation.

The product should remain **self-contained**: no runtime dependence on Superpowers, Ponytail, their plugins, global configuration, or arbitrary third-party services. Preserve the current single-ticket experience while adding a coherent optional higher-level mode.

**Do not just implement this document as written.** Before deciding what to change:

1. **Independently inspect and compare all three repositories again**, using their **current** code, skills, tests, documentation, releases, and relevant behavior. Verify current Claude Code and Codex multi-agent capabilities against primary documentation and, where feasible, actual running behavior. Do not rely solely on their READMEs or on the analysis below.
2. **Challenge this initial assessment.** Look for incorrect, outdated, exaggerated, duplicated, or omitted observations, including the supplied Codex/Claude nesting claims and benchmark results. Identify features that already exist, including ones not obvious from the README. Find additional valuable techniques or risks that this brief missed.
3. **Produce your own evidence-based findings and recommendations** and evaluate which ideas should actually be adopted, changed, postponed, or rejected. Favor outcomes over theoretical process completeness.
4. **Prepare a prioritized implementation plan** tailored to TicketFlow's current architecture, with coherent work units, dependencies, risks, expected benefits, tests, migration/compatibility considerations, and an approximate cost/complexity trade-off.
5. **After recording a coherent plan, implement it** through TicketFlow's established development and review process; this assignment explicitly authorizes planning **and implementation**, not merely reporting a proposal. Work in sensible, independently verifiable slices. Do not wait for a blanket approval between routine stages. Seek the owner only for truly material product, security, credential/permission, compatibility, or irreversible decisions; never silently grant yourself authority to weaken branch protection, access controls, or review gates. If tooling access prevents implementation, state precisely what was blocked and finish every feasible part.

The objective is **better engineering results with as little unnecessary token use, latency, agent handoff, and human intervention as possible**. Avoid making the framework ceremonious, verbose, or difficult to adopt merely to reach feature parity with Superpowers.

### Non-negotiable product principles

- **Self-contained:** no runtime dependency on Superpowers or Ponytail, their installations, plugins, activation hooks, or remote assets.
- **TicketFlow owns the lifecycle:** retain the canonical ticket → plan (when warranted) → implement → verify → review → merge → handoff lifecycle and owner-controlled `Done` state. The new optional **multi-ticket coordinator sits above**, never reimplements or bypasses, that lifecycle.
- **Risk- and complexity-adaptive:** small, obvious work stays small; higher-risk or genuinely complex work receives deeper engineering checks. Treat **risk severity, cognitive complexity, and agent orchestration cost as separate dimensions**.
- **Evidence over claims:** never report tests, reviews, security checks, or live verification as completed without demonstrable results.
- **Real enforcement where feasible:** do not mistake an LLM instruction for a GitHub-enforced security boundary.
- **Minimal duplication:** prefer evolving existing skills and roles over competing engineering instructions. Add one optional coordinator where it has a distinct responsibility; keep its instructions short.
- **Stable integrations:** preserve existing repositories' CI, GitHub Projects, labels, merge preferences, templates, agent configurations, and upgrade paths whenever possible.
- **Portable and maintainable:** retain Claude Code and Codex support, a usable generic-agent fallback, and platform neutrality where practical. Detect unsupported nested delegation; degrade honestly instead of pretending agents spawned.
- **Tested, versioned changes:** tests, documentation, and migration/upgrade behavior are part of a feature, not cleanup left for later. Orchestration must tolerate interruptions, repeated commands, and partially completed work.

---

## 2. Starting assessment: complementary strengths

The central hypothesis is that **Superpowers provides more detailed engineering methods**, **Ponytail provides unusually explicit efficiency discipline**, and **TicketFlow provides the GitHub delivery and governance control plane**. Treat this as a hypothesis to verify, not a conclusion to adopt uncritically.

| Area | Initial observation | Implication to investigate |
|---|---|---|
| Requirements discovery and design | Superpowers has dedicated brainstorming and design workflows, with clearer exploration of approaches and unanswered decisions. | Selectively improve TicketFlow's handling of genuinely ambiguous or architectural work, without forcing interviews for clear tickets. |
| Technical planning | Superpowers plans can contain finer-grained interfaces, files, tests, task boundaries, and review focus. TicketFlow already has a compact `ticket-planner` covering invariants, callers, fail-closed behavior, rollout, and verification. | Improve plan quality where necessary; **do not assume longer plans are better**. |
| TDD and testing | Superpowers has explicit red/green/refactor and regression-test reasoning; TicketFlow emphasizes verification and CI but has a less detailed native coding methodology. | Add appropriately scoped test-first guidance, not an inflexible ritual. |
| Debugging | Superpowers prescribes root-cause investigation, hypotheses, reproductions, and escalation after repeated failed fixes. | Strengthen the bug/failed-fix route while retaining fast paths for obvious issues. |
| Subagents | Superpowers supports fresh implementer/reviewer contexts per task plus final review. TicketFlow favors a single implementation context and selective delegation, while supporting parallel independent tickets. | Make delegation adaptive; assess cost, context quality, concurrency, and independence. |
| Verification | Both demand evidence. TicketFlow additionally uses configured CI gates, exact-head status checks, worktrees, and a controlled local fallback. | Preserve and strengthen TicketFlow's enforced verification rather than replacing it with prose. |
| Pull requests and lifecycle | TicketFlow manages structured issues, initiatives, dependencies, Project statuses, reviews, merges, deferred checks, and handoff. | Keep this as TicketFlow's distinctive core. |
| GitHub enforcement | TicketFlow provides actual scripts, rulesets, hooks, and merge logic; Superpowers is primarily skills/process guidance. | Harden enforcement, especially where review completion does not mean review acceptance. |
| Token usage | TicketFlow minimizes always-loaded instructions and uses on-demand files. Superpowers offers task-oriented context isolation and multiple execution strategies. | Combine *small baseline context* with *adaptive depth*; measure rather than assume savings. |
| Minimal complete implementation | Ponytail prioritizes avoiding work, reusing existing code/native facilities, and adding only necessary abstractions; TicketFlow already refers to the *ponytail ladder*. | Make these criteria native across planning, implementation and review instead of relying on the optional companion. |
| Context-resilient multi-ticket execution | TicketFlow already completes one ticket end to end and can handle some parallelism. | Add a separate optional coordinator that dispatches fresh ticket leads and reports compact outcomes, with durable recovery and bounded concurrency. |
| Ecosystem | Superpowers and Ponytail each offer agent-specific adapters. TicketFlow is a younger project with a canonical install/sync model. | Prioritize behavioral validation, platform compatibility, documentation, and upgrade safety; do not treat popularity as proof of superiority. |

Potentially useful Superpowers sources include:

- [Brainstorming](https://github.com/obra/superpowers/blob/main/skills/brainstorming/SKILL.md)
- [Writing plans](https://github.com/obra/superpowers/blob/main/skills/writing-plans/SKILL.md)
- [Subagent-driven development](https://github.com/obra/superpowers/blob/main/skills/subagent-driven-development/SKILL.md)
- [Executing plans](https://github.com/obra/superpowers/blob/main/skills/executing-plans/SKILL.md)
- [Test-driven development](https://github.com/obra/superpowers/blob/main/skills/test-driven-development/SKILL.md)
- [Systematic debugging](https://github.com/obra/superpowers/blob/main/skills/systematic-debugging/SKILL.md)
- [Verification before completion](https://github.com/obra/superpowers/blob/main/skills/verification-before-completion/SKILL.md)
- [Requesting and receiving code review](https://github.com/obra/superpowers/tree/main/skills)
- [Finishing a development branch](https://github.com/obra/superpowers/blob/main/skills/finishing-a-development-branch/SKILL.md)
- [Diagnosing Superpowers](https://github.com/obra/superpowers/blob/main/skills/diagnosing-superpowers/SKILL.md)

Start with those, but inspect the **current skill inventory** and related tests, not just this list.

---

## 3. Preliminary TicketFlow findings requiring independent verification

These observations came from an earlier reading of source files on 27 October 2026. **Confirm them again against the current default branch before making any change.** A claim in a README or skill is not proof that a script enforces it.

### A. Review completion versus review acceptance (highest priority)

In the earlier version of `core/scripts/pr-wait.mjs`, an external reviewer could be considered **`done`** based on a review event matching the head commit, a configured no-findings reaction, or a matching completion pattern. This primarily establishes **a reviewer responded**, not necessarily that the findings were acceptable, that a `CHANGES_REQUESTED` verdict was resolved, or that all actionable threads were addressed.

`core/scripts/merge.mjs` appeared to rely on that state and a green CI gate, while the agent's `implement-ticket` instructions told it to fix reviewer findings. **The behavior written in the prompt and what the script can prove are different things.**

Investigate:

- Whether a reviewer with a blocking or negative verdict could nevertheless satisfy the machine review gate.
- Whether a review's commit SHA, freshness, final outcome, inline findings, unresolved threads, and subsequent pushes are handled correctly.
- Whether edited summary comments, bot-specific completion patterns, or "failed" states can accidentally be interpreted as acceptance.
- How to distinguish **completed review**, **reviewed with unresolved findings**, **approved/accepted**, **unavailable**, and **not verifiable**, including reviewer bots that do not publish GitHub's formal review verdict.
- What can be enforced generically versus what requires a configured adapter or human acknowledgment.

**Desired property:** a PR cannot be automatically merged solely because a reviewer finished responding. A meaningful unresolved blocker must hold the merge unless a clearly authorized and auditable exception applies. Avoid forcing GitHub approval semantics on bots that cannot provide them; design a supported and honest evidence contract.

Source starting points: [`pr-wait.mjs`](https://github.com/livingc0de/ticketflow/blob/main/core/scripts/pr-wait.mjs), [`merge.mjs`](https://github.com/livingc0de/ticketflow/blob/main/core/scripts/merge.mjs), [`REVIEWERS.md`](https://github.com/livingc0de/ticketflow/blob/main/core/docs/REVIEWERS.md).

### B. Fallback-review attestation is not independent proof

The earlier `merge.mjs` accepted a `--review-basis` PR comment referencing the current head SHA when no external reviewer completed. TicketFlow's security documentation itself notes that an agent-authored attestation **cannot prove that a separate reviewer actually ran**.

Review its intended trust model and alternatives. Ideally, validate independently observable reviewer output, authorship, head binding, and verdict where supported. If the environment cannot provide an independent reviewer, communicate that limitation accurately and choose an appropriate policy (including human approval for high-risk cases). Do not introduce a complicated pseudo-security protocol that remains trivially forgeable by the same credentials.

### C. GitHub permissions, status provenance, and local fallback security

TicketFlow already has important safeguards: branch rulesets, exact-head gate status, guarded merge commands, refusal to use admin overrides autonomously, and a local verifier that avoids some unsafe fallbacks. Preserve these strengths.

But the security documentation acknowledges limitations: command guards are not an authorization boundary; an agent with the owner's admin token may bypass GitHub protections; handwritten commit statuses can potentially forge a gate; and local verification executes code rather than sandboxing it. The earlier merge path also noted a short possible race when the base changes between freshness check and merge.

Evaluate **proportionate** improvements:

- Least-privilege credentials and separation between untrusted coding work and privileged merge/status operations when practical.
- Stronger provenance checks for required statuses and reviewer evidence, where GitHub permits them.
- Safely treating issue bodies, PR comments, and external content as **untrusted data**, not overriding workflow instructions.
- Honest local-verification security boundaries; no blanket implication that a clean worktree equals a sandbox.
- Protected, auditable exceptions for human-authorized bypasses.
- Any needed handling of freshness/race conditions without excessive polling or unnecessary CI reruns.

Important: **do not relax or break existing working gates** in the process of hardening them. In particular, distinguish legitimate owner overrides from unauthorized agent bypasses, and test repository ruleset/merge-method compatibility.

Sources: [`SECURITY.md`](https://github.com/livingc0de/ticketflow/blob/main/core/docs/SECURITY.md), [`CI-GATE.md`](https://github.com/livingc0de/ticketflow/blob/main/core/docs/CI-GATE.md), [`local-verify.mjs`](https://github.com/livingc0de/ticketflow/blob/main/core/scripts/local-verify.mjs), [`core/guard.json`](https://github.com/livingc0de/ticketflow/blob/main/core/guard.json).

### D. Model and effort routing may be unnecessarily expensive

At the time of the initial review, TicketFlow favored high effort for implementation and strong/high-effort planner and reviewer roles, with higher floors for critical changes. Risk tiers primarily determine review intensity and minimum effort. The philosophy is reasonable, but **risk and reasoning difficulty are not identical**.

A high-impact configuration change may be straightforward yet require strong verification; a noncritical algorithm may demand deep reasoning. Investigate whether current choices overspend on straightforward work.

Consider an adaptive policy that distinguishes:

- **Risk/impact:** how severe is a wrong change and what independent evidence is needed?
- **Complexity/ambiguity:** how hard is the reasoning and implementation?
- **Task role:** discovery, architecture, coding, test writing, search, review, and mechanical operations need different capabilities.

Prefer a small, explainable policy (e.g., light/standard/strong classes with escalation), compatible with the existing configuration and current Claude/Codex capabilities. Avoid embedding fragile model names or assuming xhigh always improves outcomes. Measure tokens, cost, turnaround time, failed attempts, review rounds, and quality.

### E. Planning should be deeper only when needed

TicketFlow's planner already checks source, callers, invariants, tests, failures, rollout, and open decisions. Its compact output is an advantage. Superpowers contributes useful requirements-discovery, alternative evaluation, implementation step sizing, test specificity, and pre-implementation review.

Possible enhancements:

- **Discovery only when needed:** identify genuine missing requirements or consequential alternatives before committing to a design; avoid repeating questions already answered by the ticket/code.
- **Adaptive plan depth:** a small change gets a concise plan or skips one under existing rules; larger changes need enough interface, dependency, test and rollout detail to execute reliably.
- **Plan quality checks:** acceptance criteria mapped to verification; major cross-cutting invariants and consumers covered; no unacknowledged decisions; no obsolete plan treated as current.
- **Optional independent design/plan review:** for hard or irreversible changes, not all tickets.
- **Task decomposition:** each task should be verifiable, but avoid fragmenting work into meaningless microsteps or creating excess commits/agents.

Do not import an always-on brainstorming interview or require approval after each routine planning step.

### F. Native test-first and systematic debugging practices

Superpowers' dedicated TDD and debugging skills are more detailed than TicketFlow's current native development protocol. TicketFlow currently mentions using those skills **when installed**, which leaves a potentially important practice dependent on outside tooling.

A self-contained version should supply adequate native guidance without making all changes expensive:

- For bugs, reproduce or otherwise demonstrate the original failure when feasible; explain the root cause rather than stacking speculative fixes.
- For meaningful behavior changes, favor regression/behavioral tests that fail for the right reason before implementation when feasible.
- Verify a test covers the intended invariant, not merely mocks or wiring.
- Require full relevant verification before completion claims; explicitly state what could not run.
- After repeated unsuccessful fixes, stop repeating the same tactic, gather evidence and escalate to a targeted diagnosis or architecture reconsideration.
- Allow sensible exceptions for docs, generated files, research spikes, configuration-only changes, pre-existing untested code, or situations where test-first is impossible or less useful. Require honest rationale, not rigid performative compliance.

Decide whether this belongs inside `implement-ticket`, in small **on-demand native skills**, or a combination. Optimize discoverability and token footprint.

### G. Subagent strategy: do not blindly copy Superpowers

Superpowers can use fresh implementers and reviewers **per task**, plus a final review; this improves isolation and early defect detection but adds repeated codebase reads, tool calls, latency, and context overhead. TicketFlow presently prefers one main implementation context with selectively delegated hard tasks and parallel, nonconflicting tickets.

Evaluate an **adaptive execution strategy**:

- Default to a single coding context for short, cohesive tasks.
- Use read-only/lightweight helpers for broad searches only when they save overall work.
- Use fresh implementers or task reviewers for genuinely separable, complex, or high-risk tasks where the quality gain justifies the extra handoff.
- Preserve branch/worktree ownership, avoid concurrent editing of the same files, pass compact briefs, and coordinate cross-task invariants.
- Consider a final independent review that sees the complete change even if task-level reviews occurred.
- Never assume more agents means faster or better; compare approaches empirically.

### H. Skill precedence and instruction conflicts

The earlier `core/skills/implement-ticket/SKILL.md` explicitly states that it replaces Superpowers' brainstorming, writing-plans, executing-plans, and subagent-driven-development flows for ticket work, while invoking separate debugging, TDD, and verification practices if installed.

**Eliminate accidental reliance on optional third-party skills (both Superpowers and Ponytail).** Give TicketFlow an unambiguous native route. Existing installations of Superpowers, Ponytail, or other skills must not create double orchestration, conflicting approvals, or duplicate context loading. If optional external tooling still coexists, define clear, minimal precedence and interoperability rules. Do not require users to install or configure Superpowers or Ponytail.

### I. Missing measurement of agent behavior

TicketFlow has a substantial suite of Node.js tests and recent green GitHub Actions runs, but scripted unit tests do not prove that actual Claude/Codex sessions consistently follow the workflow or produce better code.

Superpowers also has agent-oriented workflow tests and diagnostics worth inspecting. Adapt only the valuable evaluation approaches, especially those that expose real-world failures. Avoid building an expensive evaluation platform before small repeatable fixtures prove useful.

---

## 4. Additional research: Ponytail principles, evidence and integration decisions

**Repository:** https://github.com/dietrichgebert/ponytail  
**Read before deciding:** [main skill](https://github.com/dietrichgebert/ponytail/blob/main/skills/ponytail/SKILL.md), [PR review](https://github.com/dietrichgebert/ponytail/blob/main/skills/ponytail-review/SKILL.md), [repo audit](https://github.com/dietrichgebert/ponytail/blob/main/skills/ponytail-audit/SKILL.md), [deliberate-debt report](https://github.com/dietrichgebert/ponytail/blob/main/skills/ponytail-debt/SKILL.md), [benchmarks](https://github.com/dietrichgebert/ponytail/blob/main/benchmarks/agentic/README.md), and [7 October 2026 results](https://github.com/dietrichgebert/ponytail/blob/main/benchmarks/results/2026-10-07-agentic.md). Inspect the *current* equivalents and source/tests; these links may move.

### A. Core hypothesis: code minimalism **without** incomplete work

Ponytail's strongest contribution is *not* "fewest lines wins." Its principle is: deliver the **smallest readable, complete and safe change**, including affected callers, tests, fixtures, configuration, and necessary validations.

Its rough solution ladder is:

1. Don't implement speculative features, options, infrastructure, or flexibility nobody needs.
2. Use an existing project helper, component, layer, interface or convention if fit for purpose.
3. Prefer native language/platform capabilities over inventing similar functionality, unless local project conventions should prevail.
4. Reuse an installed dependency rather than adding another one for a minor feature.
5. Implement the simplest understandable solution, including all required behavior and edge cases.
6. Preserve necessary validation, authorization, privacy, error handling, resilience, accessibility, and test coverage even when they take additional code.

**Potential TicketFlow integration:** make the above a lightweight evaluation in `ticket-planner` *and* the implementation flow; let `pr-reviewer` challenge unnecessary complexity with **specific evidence**, not vague style objections. Do not introduce a second mandatory Ponytail-like orchestrator or require a new plugin. For complex changes, “smallest” must be evaluated at the **total cost of ownership**, not just initial lines or token count.

### B. Current overlap that must be checked before adding anything

The earlier TicketFlow source inspection found:

- `core/agents/ticket-planner.md` already says to apply the Ponytail ladder if installed, and otherwise reuse existing code, choose the smallest correct change, prefer native features and delete before adding.
- `core/agents/pr-reviewer.md` already asks what can be removed/simplified without compromising security, validation or accessibility.
- Multiple core files use `// ponytail:` comments for acknowledged deliberate limitations (e.g., limited paging, regex assumptions). These should **not** be treated as proof that every intentional shortcut is tracked or reviewed.
- Some setup documentation may offer Ponytail and Superpowers as optional companion installs; a self-contained mode should not require either.

**Action:** map exact overlaps. Refine and unify existing behaviors rather than duplicating them across `AGENTS.md`, skills, reviewers and generated stubs. Assess if a more generic `shortcut:` convention (with a ceiling and a future trigger) improves clarity, or if GitHub issues and existing documented limitations are already sufficient.

### C. Review discipline to learn from

Ponytail's reviewer goes beyond the diff: it examines callers, inputs/outputs, expected scale and meaningful failure modes. It prioritizes **correctness → safety/data loss → realistic load → tests → performance → leanness**. It demands a concrete demonstrable case for a finding and rejects hypothetical style-only feedback.

Useful TicketFlow improvements to assess:

- Ask "what real input or production condition breaks?" before declaring a blocking finding.
- Check every affected caller when APIs, signatures, return values, money logic or shared behavior change; confirm the whole flow, not just the changed lines.
- Distinguish current expected load from speculative future scale; don't overengineer a single-user script for distributed scale.
- Highlight genuinely unnecessary code, duplicated helpers, unused configs, needless adapters and avoidable dependencies.
- Provide the smallest credible fix and a plain-English impact statement, including consequences of deferring it.
- Keep review outcomes decisive: **must fix**, **should fix**, **optional**, with a verdict and evidence. Map these to TicketFlow's **enforced** reviewer state appropriately; a narrative "looks okay" is not an automatic GitHub approval.

An optional whole-repo audit could be useful, but should not be a mandatory step for every ticket. Keep it bounded and risk-focused; include unexamined areas in the report.

### D. Test strategy: resolve Ponytail-versus-Superpowers tensions

Superpowers strongly favors explicit red/green/refactor; Ponytail emphasizes that nontrivial/risky logic requires a meaningful targeted test, while trivial changes may require no new test. **Do not combine their rules mechanically** into contradictory mandatory requirements.

Proposed *outcome* for the agent to refine: choose tests according to the risk and nature of the change. For reproducible bugs and meaningful behavioral changes, favor a failing regression test or equivalent demonstrated pre-fix failure. For security, authorization, money, data integrity, migrations, external boundaries, concurrency and serialization, require robust validation and relevant negative cases. For docs, formatting or truly trivial edits, avoid ceremonial test scaffolding, but still verify the changed behavior as appropriate. Test quality matters more than coverage count.

Never shorten code at the cost of required safety, correctness, accessibility or maintainability. Avoid enforcing low LOC as a gate.

### E. Deliberate shortcuts and visibility of technical debt

Ponytail's `ponytail-debt` recognizes explicit comments such as `shortcut: <limit>, <trigger to upgrade>`. Evaluate whether TicketFlow should support a native, non-intrusive **shortcut-debt ledger** or an optional audit command/practice:

- Make known, *acceptable* limitations visible, with the actual constraint and revisiting trigger.
- Distinguish deliberate tradeoffs from unresolved defects. A known security gap, money/data-loss risk, or broken requirement cannot become safe merely by adding a `shortcut:` comment.
- Avoid duplicating GitHub issues, existing code comments or decision records; choose one practical source of truth.
- Optionally identify deferrals that have lost their trigger or whose threshold has already been exceeded.

### F. Benchmark claims: promising, not proven for TicketFlow

Ponytail's **published** benchmark dated 7 October 2026 reports: **-53% source lines, -45% output tokens, -41% time and -26% cost** for Ponytail 5 against an unmodified Claude Code baseline on **39 tasks × 5 runs** with **Opus 5.5**. On the 18 hidden-check tasks, it reports 87/90 passing runs versus the baseline's 86/90. It reports tests on 98% of tasks categorized as requiring one, versus 68% for the baseline. These are **third-party reported results**, not a reproduction here, and not measurements of TicketFlow.

The benchmark isolates skill effects carefully, including comparisons against a no-skill control, but it also explicitly **disabled shell commands in agents**, so it does **not** prove improvements in long-running autonomous debugging, live application verification, CI/review/merge workflows or Codex. Only 18 of the 39 tasks had executable hidden checks; other completeness judgments included model-based assessment. Different tests or model versions may change the results.

**Action:** reproduce enough claims to establish relevance if feasible. More importantly, run representative **TicketFlow before/after** agent sessions and report correctness, review misses, regression detection, source churn, token cost, time and interventions. Document what cannot be measured. Prefer small controlled tests over assuming the headline percentages will carry over.

### G. Ponytail-specific features to prioritize or decline

| Candidate | Initial priority | Reason and caution |
|---|---|---|
| Consistent reuse-before-build and minimal-complete-solution guidance | **P1** | Likely good quality/efficiency gain with little new infrastructure. Already partly present. |
| Review of concrete bugs, realistic load, affected callers and unnecessary complexity | **P1** | Complements Superpowers' correctness and TicketFlow's review; preserve independent review enforcement. |
| Clear, proportional test policy | **P1** | Resolve conflicting test rituals without skipping critical coverage. |
| Optional shortcut/debt reporting | **P2** | Helpful when limits are real; must not hide blockers or multiply ledgers. |
| Optional targeted repository audit | **P2/P3** | Useful for maintenance, not every PR. Reuse reviewer logic where reasonable. |
| Behavioral comparison of full ticket runs and cost | **P1/P2** | Provides evidence that the combined method helps rather than merely grows in complexity. |
| Ponytail plugin hooks, UX/status bars, unrelated agents and commands | **Usually reject** | Integration and maintenance overhead without demonstrated TicketFlow benefit. |

### H. Licensing and attribution

The earlier audit indicated Ponytail, like Superpowers and TicketFlow, used MIT licensing. **Recheck all current licenses.** Distinguish learning engineering *ideas* from copying exact skill text/code. If substantial source is reused, preserve required copyright and license notices. Favor independently expressed, concise TicketFlow-native material to minimize duplication and dependency drift.

---

## 5. New feature request: optional persistent-minded, lean-context, multi-ticket orchestration

**Product intent:** A user can say "orchestrate these tickets / this initiative / the ready backlog" and TicketFlow continuously executes eligible tickets through fresh delegated workers while the coordinator retains only the small amount of state needed to decide what to do next. It must avoid filling a single primary conversation with source code, diffs, logs, error traces and implementation details. This feature must **not** replace normal one-ticket execution.

**Example motivating user workflow (illustrative, not a mandatory implementation):**

> Continue the ticket work as an orchestrator only. Keep the coordinating context lean; do not read source code, diffs or raw logs. For each ticket spawn a fresh Ticket Lead, which runs `implement-ticket` end to end and may delegate planning, implementation or review to specialist agents (maximum two levels of delegation). Process tickets sequentially by default. Parallelize only provably independent tickets. Ask the user only for material decisions and keep unblocked work moving. Return compact, verifiable results for each ticket and a short final summary.

### A. Recommended logical roles and boundaries

```text
Level 0  MULTI-TICKET ORCHESTRATOR (small coordination context)
         - Select eligible tickets, respect ordering and dependencies
         - Dispatch/track fresh Ticket Leads
         - Track hard limits, blockers, user decisions and checkpoints
         - Consume compact outcomes with evidence links, not code or logs
         |
         +-- Level 1  TICKET LEAD (fresh context for each ticket)
                      - Own TicketFlow's existing implement-ticket lifecycle
                      - Read relevant code, plan and verify actual repo state
                      - Implement directly when cheaper / appropriately safe
                      - Optionally dispatch bounded specialists (Level 2)
                      |
                      +-- Level 2  PLANNER (when needed; read-only)
                      +-- Level 2  IMPLEMENTER (when delegation pays off)
                      +-- Level 2  INDEPENDENT REVIEWER (when required)

No Level 3 delegation. L2 specialists usually run sequentially, not all at once.
```

**Design choice to review:** It is usually better for a Level 1 **Ticket Lead** to coordinate its planner, implementer and reviewer than for the planner to own implementation and spawn the rest. That keeps the parent responsible for ticket state, evidence, safety, review feedback, merge and handoff. An alternative structure can be justified by the agent's independent evaluation, but **one role must own the ticket end to end**.

The main orchestrator is *strictly a coordinator*: no edits, git worktree manipulation, diff analysis, ad-hoc debugging, raw CI log inspection, or self-approval. It may inspect GitHub issue/PR metadata, dependencies, project statuses and **compact structured evidence** for scheduling. If deeper investigation is necessary, delegate it to a ticket-context agent. The coordinator should not silently copy the worker's full transcript into its own context.

### B. On-demand native entry points

Choose the simplest native surface: e.g., an optional `orchestrate-tickets` skill plus a small coordinator role, or another architecture that fits TicketFlow's skill/agent adapter conventions. Evaluate examples:

- "Orchestrate all ready tickets in initiative #86."
- "Continue the backlog sequentially. Stop for material decisions."
- "Orchestrate #99–#103 with maximum three active agents including the coordinator."
- "Resume my previous orchestration run."
- "Process independent ready tickets in parallel where safe."

No need for an always-running external server simply to expose a skill. Avoid coupling to one model provider. Don't register a large new global prompt that every single-ticket user must load. Keep **one canonical orchestrator skill** with thin generated Claude/Codex/generic adapters.

### C. Ticket selection, ordering and safe parallelism

- Honor explicitly specified tickets and initiatives; otherwise prefer ready, unblocked, highest-value tickets using the existing Project/issue conventions, not invented priorities.
- Preserve sub-issue dependencies, material pending decisions, branch/PR state and previously in-progress work. Avoid selecting the same ticket twice.
- Default to **sequential ticket execution**, which is easier to reason about and works within small model concurrency quotas.
- If the user enables parallelism, require independence across **files, shared interfaces, database migrations, deployed services, infrastructure configuration, code generation, locks, stateful tests and environment resources**. Do not assume independence just because issue descriptions are different.
- Each editing Ticket Lead should own an isolated branch/worktree, use TicketFlow's configured conventions, and avoid editing shared working trees. Shared base branch changes and CI runs are still global integration points.
- Use a **global agent budget**, not merely a per-parent cap. Example: "max 3 active agents including orchestrator" means the orchestrator plus a Ticket Lead plus **at most one simultaneously active specialist** under strict counting. Two Ticket Leads in parallel may leave no capacity to create the required reviewer. Prevent starvation/deadlock with reserved capacity, sequencing or a configured larger cap.
- Distinguish **maximum nesting depth** (L0→L1→L2) from **number of concurrently active agents** and **maximum ticket parallelism**. These are separate controls; exact backend semantics must be verified.

### D. Model, effort and delegation routing

Use configurable **agent roles / model classes / effort** rather than hardcoded per-user model IDs. A sample *starting hypothesis* (to test against real capabilities and token cost):

| Role | Example policy (not required) |
|---|---|
| L0 orchestrator | Cheapest model that can reliably classify dependencies, dispatch and synthesize results; limited reasoning; no code exploration. |
| L1 Ticket Lead | A capable implementation model, e.g. Sonnet/high on Claude; owns the full ticket. |
| L2 planner/architect | Stronger reasoning model, e.g. Opus/high for complex or risky planning; skip/scale down when not warranted. |
| L2 implementer | Economical capable coding model, e.g. Sonnet/appropriate effort, only when isolation or task split improves results. |
| L2 reviewer | Independent capable model, scaled by risk and review contract; never equate self-attestation with a verified approval. |

Explicitly document every dispatch's chosen model/effort when the agent runtime supports it; support safe defaults and configuration overrides. Separate **risk tier**, **cognitive complexity**, **execution cost** and **required independent verification**. Avoid automatically dispatching the strongest model on every step. Agents can use a native model/effort fallback if the requested model is unavailable, but must disclose the fallback and preserve risk controls.

### E. Context isolation and compact handoffs

- L0 reads **issue metadata and summarized verification state**. Do not feed it full agent transcripts, code, diffs or logs.
- Each ticket starts with a *fresh* L1 context. Do not reuse a giant conversation over many tickets. Where platform-native fresh contexts cannot be guaranteed, use a new process/session or an equivalent supported mechanism; do not claim isolation without evidence.
- A Ticket Lead reads the installed repo's `AGENTS.md`, relevant agent instructions, the canonical `implement-ticket` skill and *only the files needed*. Do not load all optional skills and guides by default.
- Specialists get a compact brief containing ticket ID, assigned subtask, constraints/invariants, locations to investigate and evidence expectations. They read the canonical local instructions relevant to their work; never pass an entire parent transcript.
- Worker return values should be machine-readable or predictably parseable, with optional human text **around 10 lines**: ticket, branch/PR, merge SHA, deployment/worker version if applicable, CI/test/live check evidence, review result, unresolved findings, what remains unverified, blockers/decisions, and follow-up issue IDs. Avoid demanding a deployment version where deployment does not exist.
- A compact result is **not a substitute for** a link to actual GitHub status/CI/review evidence. Verify state after dispatch, before claiming completion, and on resume.
- Do not report a merged ticket as "Done": honor TicketFlow's **In Review** owner handoff until the owner expressly marks it Done.

### F. Durable resume, failure recovery and idempotence

A prompt or skill alone cannot guarantee survival through a closed terminal, crashed runtime, exhausted context or disconnected agent. Design **resumability** around real durable state, with a lightweight checkpoint or ledger only if GitHub's issue/PR/Project state cannot represent it adequately.

At minimum, persist or reconstruct: requested scope (ticket list/initiative/filter), active ticket and worktree/branch, ownership/claim, plan reference, PR URL/ID, last verified head SHA, current gate/review state, unresolved decisions, next eligible ticket, attempted/retried operations, and any explicit stop condition. Prefer GitHub as the source of truth for actual merges, reviews and ticket status; do **not** trust a stale orchestrator summary when it disagrees with GitHub.

- Relaunch safely after interruption and **reconcile** current GitHub state before modifying anything.
- Avoid duplicate issue creation, duplicate branches/PRs, repeated merges, and re-executing non-idempotent migration/deployment steps on resume.
- Detect lost workers, failed jobs, stale branches, orphan worktrees, partially merged states and expired reviews. Retry only safely with bounded attempts/backoff; otherwise report blocked and continue other eligible work.
- Prevent two active orchestrators from unknowingly claiming the same ticket. Determine if existing GitHub state and claims suffice or an explicit lease/lock is warranted. Account for races and expired owners.
- Separate **recoverable** stalls from real **security/permission/architecture** decisions that need user input.
- Determine whether merely "continue working" is supported while the user's session is open versus genuine persistent background operation on a VPS. Do **not** advertise continuous unattended execution after process termination unless an actual host/service/scheduler exists to provide it. A resumable workflow is valuable even without a daemon.
- Preserve the normal TicketFlow rule of not bypassing protected branch CI, reviews, or authorizations during recovery.

### G. Codex and Claude Code capability/adapter audit

**Do not assume previous chat claims about model names, nested subagents, depth settings or background flags remain accurate.** Check the **current** official CLI, IDE/app, configuration schema, tools, feature flags and version-specific restrictions. Verify as much as possible with small local probe sessions, without affecting production files.

Potential research starting points:

- [Claude Code subagent documentation](https://code.claude.com/docs/en/sub-agents): how child agents are dispatched, whether grandchildren are supported, background behavior, model/effort routing and any actual spawn-depth control.
- [Codex documentation](https://developers.openai.com/codex/): multi-agent support across CLI, IDE and app, agent roles, delegation, model/effort configuration and any limitations of the selected backend.
- [Codex configuration schema](https://github.com/openai/codex/blob/main/codex-rs/core/config.schema.json): an earlier October 2026 read documented `agents.max_depth` as "Maximum nesting depth for V1 agent threads. Ignored by V2." **Validate current behavior and do not falsely claim depth enforcement in V2.**
- [OpenAI managed Agents multi-agent guide](https://developers.openai.com/api/docs/guides/agents-api/multi-agent) and [Responses multi-agent guide](https://developers.openai.com/api/docs/guides/responses-multi-agent) describe *different API surfaces* with different concurrency semantics; do not mistake either API setting for a Codex CLI configuration feature. Prefer the user's existing local coding-agent environment.

Required compatibility behavior:

- Native L0→L1→L2 when supported reliably.
- If nesting isn't supported, explore an adapter that achieves the same **logical** roles through supported sequential fresh sessions, or gracefully fall back to L0→L1 with the Ticket Lead handling planning/implementation/review directly under the existing mandatory verification controls.
- If independent review cannot be achieved on a fallback backend, honor the existing TicketFlow escalation/owner-approval behavior rather than claiming full review independence.
- Fail visibly for hard constraints the backend cannot meet; never silently exceed depth/concurrency, or fabricate a subagent execution.
- Retain a generic-agent mode with transparent limitations; do not force Claude-specific tool names or Codex-specific configuration onto other tools.

### H. Orchestrator acceptance and negative-path scenarios

Implement tests or small, repeatable dry-run scenarios showing:

1. **Sequential initiative:** three ordered tickets use three separate ticket contexts, all decisions/evidence remain linked, owner status remains In Review.
2. **Plan bypass:** a truly trivial ticket avoids unnecessary planner/subagents while passing its mandatory checks.
3. **Parallel independence:** two disjoint tickets can run concurrently when allowed; overlapping files, migrations, settings, deployments or constraints force serialization.
4. **Three-agent budget:** L0 + L1 + one L2 never becomes four running agents; nesting never exceeds two delegations; no deadlock when a reviewer is needed.
5. **Unsupported backend:** nesting or model selection unavailable; correct graceful behavior and explicit limitations.
6. **Interrupt/resume:** parent context/session dies mid-ticket or after merge; next run reconciles status and does not duplicate side effects.
7. **Stale and hostile inputs:** outdated head/review, failed CI, reviewer quota outage and prompt-injection issue text cannot bypass normal gates.
8. **Material decision:** blocked ticket pauses while unrelated eligible work continues; no invented product decision or infinite spin.
9. **Worktree/claim conflicts:** competing coordinators cannot silently corrupt the same work; orphan cleanup and recovery is safe.
10. **Evidence:** coordinator's final claims distinguish merged, deployed, waiting owner approval, blocked, unverified, and no-op cases.

Verify both quality and efficiency against the existing single-ticket path: task success, time, total model tokens/cost across **all** descendants, concurrency, context growth, recovery reliability and owner interventions. Be candid if provider usage metrics are unavailable.

### I. Open architecture trade-offs for the agent to decide

- Skill vs role vs a tiny script/CLI vs a minimal hybrid: **prefer the simplest design** that can meet durability, context isolation and supported runtimes.
- Native nested agent dispatch vs serialized separate sessions as the portable fallback.
- Whether to persist an explicit run ledger, store progress in GitHub, or reconstruct on demand.
- How to detect independent work accurately enough without reading source in the coordinator (e.g., preflight by a Ticket Lead or lightweight metadata scan delegated to a separate context).
- Whether to permit all eligible backlog tickets or require user-selected scope, stop conditions and budgets; **default conservatively** and make scope clear.
- Whether the review process can be delegated without diluting independence and whether the worker can safely merge after all gates.
- How to surface compact progress to the user without triggering continuous reporting costs.

**The priority is reliable bounded-context delivery, not adding a multi-agent swarm.** If a simpler coordinator achieves the objective, prefer it.

---

## 6. Integrate the three approaches without conflicts

**Conceptual division of responsibility:**

| Concern | TicketFlow-native answer | External inspiration |
|---|---|---|
| *What should be shipped next?* | Multi-ticket coordinator + GitHub issues, Project state and dependencies | TicketFlow, new feature request |
| *What is the smallest valid change?* | Native planner/implementer decisions, explicit scope discipline | Ponytail |
| *How to design, test and debug correctly?* | Adaptive planning, test-first where valuable, root-cause investigation | Superpowers |
| *How is a ticket delivered and independently verified?* | Canonical `implement-ticket`, CI/PR review and exact-head merge gates | TicketFlow |
| *How to keep a long run's context bounded?* | Fresh per-ticket contexts, compact summaries, checkpoints/resume | New orchestration mode |

**Unify, do not concatenate, incompatible rules.** In particular:

- **Planning:** Superpowers-style deep design on genuinely ambiguous/high-complexity work; Ponytail-style scope restraint on every plan; TicketFlow's existing default-and-skip policy remains canonical until evidence warrants changing it.
- **Testing:** risk-based effective tests and test-first diagnosis without rote ceremony; never cut critical coverage in the name of minimalism.
- **Review:** combine evidence-based fault finding and design economy with TicketFlow's independent review *and machine-enforced outcomes*.
- **Subagents:** separate the optional **long-running multi-ticket coordinator** from selective **per-ticket delegation**. Do not introduce competing session managers or create one fresh agent for every small subtask by default.
- **Context:** lightweight instructions are not enough if run state and raw transcripts accumulate. Combine lazy loading with explicit context ownership, bounded result contracts, new per-ticket sessions and recovery.
- **Low overhead:** minimize extra skills, hooks, configuration, dependencies, model effort, source diff volume, CI reruns and owner approvals. Measure net end-to-end results.
- **Security:** a detailed prompt, a `shortcut:` comment, an agent-issued verification statement or a reviewer comment are **not** hard security enforcement. Trust boundaries remain GitHub permissions, protection, vetted statuses and correctly implemented merging.

**Priority hierarchy:** correctness and safety first; complete required behavior second; meaningful testing and independent review third; then simpler code, lower cost and speed, always subject to the earlier constraints. The precise ordering of safe refactoring vs testing can be task-dependent; no LOC or token target may veto required behavior.

---

## 7. Improvements to consider, in priority order

**These are candidate priorities, not pre-approved tasks. Re-rank after your independent three-repository audit and orchestrator capability checks.**

| Priority | Candidate improvement | Intended benefit | Guardrail |
|---|---|---|---|
| P0 | Confirm and, if needed, fix reviewer acceptance and unresolved-finding handling before autonomous merge. | Avoid merging known-bad PRs. | Support different reviewer products; fail closed where evidence is ambiguous without permanently blocking valid workflows. |
| P0 | Clarify and strengthen review attestation, credential boundaries, and status provenance. | Prevent false assurance from self-reported checks. | Maintain normal owner override and existing CI/fallback compatibility. |
| P1 | Make ticket planning more adaptive and technically complete for complex work. | Reduce implementation drift and avoid missed requirements. | No mandatory brainstorming or giant plans for routine tickets. |
| P1 | Add native, compact test-first and root-cause debugging guidance. | Better regression prevention and fewer speculative fixes. | Sensible exceptions; do not add an external Superpowers dependency. |
| P1 | Improve complexity-aware model/effort/delegation decisions. | Better quality-per-token and lower turnaround time. | Keep risk-based verification separate from model selection. |
| P1 | Introduce agent-behavior evaluation scenarios. | Validate real compliance, not just scripts. | Start with small, deterministic, useful cases. |
| P1 | Consistently integrate Ponytail-style minimum-complete-solution, reuse and evidence-based review principles. | Cut unnecessary code, prompts and costly detours. | Preserve all necessary behavior, safety, readability and tests. |
| P1 | Add an **optional multi-ticket orchestrator** with fresh ticket contexts and role-based dispatch. | Keep the main context lean while implementing long ticket sequences. | Preserve single-ticket workflow, depth and total-concurrency limits; do not overdelegate. |
| P1 | Implement robust bounded-state recovery and dependency-aware scheduling. | Resume safely after interruption without duplicate side effects. | Confirm actual GitHub state; no implied always-on daemon or bypasses. |
| P1/P2 | Add Claude/Codex capability detection, validated nesting behavior and graceful fallback. | Make orchestration portable and honest about environment limits. | Do not hardcode V1/V2 depth semantics or model IDs. |
| P2 | Add optional independent plan/task review for large or critical work. | Catch defects earlier. | Trigger selectively with a measurable benefit. |
| P2 | Improve native skill discovery, conflict prevention, portability, and upgrade handling. | Easier adoption, lower maintenance. | Preserve canonical runtime and generated-stub architecture. |
| P2 | Extend observability: per-ticket decisions, evidence, failure reasons, token/round metrics. | Find bottlenecks and regressions. | Leverage existing `Run:` lines; do not require a new service or telemetry platform. |
| P2/P3 | Optional lean-code/shortcut-debt reports and targeted repository audit. | Reveal intentional limitations, bloat and maintainability risks. | No mandatory audit per ticket, no issue duplication, no dangerous shortcuts. |

Also look for **things Superpowers or Ponytail do poorly** that TicketFlow should explicitly avoid: workflow friction, repeated approvals, excessive context loading, overly rigid TDD for unsuitable tasks, mandatory subagent fan-out, extreme LOC-minimization, insufficient completeness testing, deep coupling to a specific agent harness, and redundant instruction sets. Conversely, look for TicketFlow capabilities that should stay more robust than their Superpowers counterparts: GitHub issue and Project lifecycle, versioned updates, CI/protection gates, local fallback, external reviewer integration, owner acceptance, and deferred verification tracking.

---

## 8. Required independent comparison: how to challenge this brief

Perform an **evidence-driven audit** before designing changes. At minimum:

1. **Baseline all three repos:** record the current default branch, commit SHAs, recent releases, relevant changes, and tested environment. Note if the source moved since this brief.
2. **Read actual behavior:** compare skills and orchestration instructions **and** the implementation code/tests for enforcement. Read Ponytail's benchmarks and limitations, and explicitly audit whether its existing concepts are already embedded in TicketFlow. Check how each project behaves for trivial fixes, feature planning, bug diagnosis, large multi-task work, PR reviews, and finishing/merging.
3. **Cross-check overlap:** identify what TicketFlow already does as well as, better than, or differently from Superpowers **and Ponytail**. Do not duplicate existing functionality with a new skill simply because Superpowers names it differently.
4. **Test material claims:** inspect the reviewer state machine and merge paths carefully; use safe local fixtures/tests to reproduce suspected gaps. Do not conduct destructive or permission-bypassing tests against production repositories.
5. **Inspect newer or overlooked ideas:** search Superpowers' and Ponytail's full skill sets, newer release notes, diagnostics/evaluations and execution choices. Independently verify Claude/Codex nesting, model/effort and background/runtime behavior. Look for beneficial practices absent from this document.
6. **Assess operational reality:** consider ongoing unattended agents, GitHub Actions quota/billing failures, reviewer quotas, worktree cleanup, stale PRs, and cases where automated live verification is unavailable. Include session interruption, global agent quotas, misconfigured nesting, concurrency deadlocks, stale orchestration checkpoints, multi-session claims and resumption.
7. **Estimate costs and trade-offs:** complexity, token consumption, latency, number of human approvals, security benefit, quality benefit, maintenance, migration pain, and compatibility, together with whether delegation truly reduces the top-level context and improves end-to-end results.
8. **Correct the record:** classify each major initial claim as **confirmed, partially confirmed, already fixed, incorrect, or unresolved**, with repository paths and concise supporting evidence. For platform capability claims, link official docs or configuration/source evidence and state which backend/version was tested. Explicitly report unexpected findings rather than fitting your analysis to the initial recommendation.

A short, candid comparison is preferable to a long report that merely repeats the claims above. If the review shows that an idea is unnecessary or harmful, **reject it** and explain why.

### Suggested evaluation scenarios

Use a small representative set, ideally applied consistently to both methodologies or simulated with equivalent agents/tools:

- A trivial documentation or one-line change, where heavy planning would be wasted.
- A contained bug with a reproducible failure and regression test.
- An ambiguous feature requiring a real product or architecture choice.
- A high-risk money/authorization/idempotency or migration scenario.
- A user-facing change requiring actual browser/live verification.
- A reviewer that posts blocking findings or `CHANGES_REQUESTED` on the latest head.
- A reviewer that is silent, out of quota, updates an existing comment, or returns a result for an older commit.
- GitHub Actions refusing to start, or a legitimate CI failure.
- Changes to the base branch during review/merge, and a head that changes after review.
- Untrusted issue/PR text containing instructions that conflict with TicketFlow policy.
- An interrupted or resumed agent session with incomplete evidence.
- Several ready tickets with dependency order, a high-risk change, a trivial change and a real decision blocking one of them.
- Two superficially disjoint tickets that actually share migration, configuration or deployment surfaces.
- A strict three-active-agent budget where the Ticket Lead needs a planner and reviewer at different times.
- A Codex or Claude backend with nesting disabled, unavailable model roles or unsupported background execution.
- Ponytail-style code minimization that accidentally removes a trust-boundary check, caller adjustment or test.

Where full head-to-head runs are too expensive, use targeted fixtures and a clear explanation of what the evidence does **not** establish.

**Potential metrics:** correct task completion, escaped bugs, acceptance-criteria coverage, misleading completion claims, security bypasses, review findings missed, source-code churn, redundant dependencies/abstractions, agent turns, model tokens/cost (including descendants), wall-clock time, CI reruns, review rounds, coordinator context size, safe resume outcomes, and required owner interventions. Measure before/after using comparable cases where practicable.

---

## 9. Architecture and implementation guidance

Prefer to **absorb principles into TicketFlow-native implementation**, not wholesale import Superpowers'/Ponytail's plugins, prompts or workflows. Add an optional coordinator that delegates to the unchanged canonical single-ticket lifecycle rather than duplicating it.

Maintain a small core around the existing canonical skills and roles:

- `create-ticket`: clear problem framing, observable current behavior, acceptance criteria, dependencies, decisions, and risk recommendation.
- `ticket-planner`: adaptive discovery, technical decisions, smallest complete solution, task boundaries, invariants, verification and rollout.
- `implement-ticket`: owns the **single-ticket** lifecycle, execution strategy, test/debug behavior, handoffs and evidence; must remain directly usable without a multi-ticket coordinator.
- `pr-reviewer`: independent and skeptical review with explicit evidence, realistic-load concerns, useful minimization findings, finding outcomes and head binding.
- CI/merge scripts: machine-enforced conditions, safe fallbacks and integration with GitHub's native protections.
- Optional `orchestrate-tickets` skill/role or equivalent thin native front door: selects/monitors tickets, delegates to fresh leads, enforces concurrency budgets, and recovers from durable state **without reading implementation details**.
- Optional practices or small native skills (e.g., targeted audit/shortcut debt): only if they improve discoverability, trigger isolation, and token usage over expanding a monolith.

Consider **one clear source of truth** for each rule. Load specialized instructions on demand. Avoid duplicating long documents into `AGENTS.md`, generated agent stubs, multiple practice files and the core skill. Generated assets should stay generated.

Existing structure worth preserving and inspecting:

- `core/skills/`, `core/agents/`, `core/scripts/`, `core/lib/`
- `practices/` and `.ticketflow/custom/`
- `core/adapters/`, `core/agents-map/`, generated Claude/Codex stubs
- `.ticketflow/` installed runtime, config, manifest and sync/update process
- `.github/workflows/` managed blocks, GitHub rulesets and existing team configuration
- Current doctor, render, gen-stubs, init, sync and compatibility tests

**Keep backwards compatibility in view:** determine whether a change requires optional orchestration configuration, state/checkpoint representation, schema updates, migrations, release notes, a new optional practice, new model-class defaults, adjusted stubs, or changed GitHub permissions. Do not edit installed/generated copies as the canonical source. Test upgrades from an existing TicketFlow installation and initialization into a repo with pre-existing workflows/settings, not just fresh installs.

**Avoid:** new mandatory dependencies, unnecessary background services, arbitrary hardcoded model IDs, an always-on multi-agent swarm, duplicated repository indexes, massive prompts, GitHub settings changes without clear owner consent, unreliable pseudo-persistence, silently dropped delegate failures, and automatically closing tickets on merge.

### A note on code and license reuse

The three repositories were publicly marked **MIT-licensed** during the initial assessment. Verify their current licenses. You may study or adapt ideas. If copying or adapting substantial actual text/code from Superpowers or Ponytail, preserve the required attribution and license notices. Prefer original, concise TicketFlow-native instructions where possible, both to keep ownership clear and to avoid inheriting unnecessary complexity.

---

## 10. Required implementation plan

After the independent **three-repository** comparison and platform audit, create a **real, actionable plan** that you can subsequently execute using TicketFlow's normal workflow. It should include:

1. **Corrected findings** across Superpowers, Ponytail, TicketFlow, Claude Code and Codex: which initial claims were confirmed, wrong, outdated or incomplete, with links to files/lines, official docs or test evidence.
2. **Recommended target behavior**, including the new optional L0/L1/L2 orchestrator, clearly distinguishing hard enforcement from agent conventions, persistence guarantees and optional practices.
3. **Architecture choice and rejected alternatives**: why to expand existing skills versus create small new ones; where orchestration belongs; how to keep the result self-contained, portable, resumable and conflict-free.
4. **Prioritized deliverable slices** that are independently reviewable, with order/dependencies. Separate urgent merge/review security correctness from methodology improvements and later optimizations.
5. **High-level file/component impact**, without prematurely specifying every implementation detail. Keep sufficient freedom to design the simplest correct solution.
6. **Acceptance criteria and negative tests** for each slice, including nesting/concurrency, interrupted/restarted orchestration, double claims, correct review outcomes, code minimalism without omitted behavior, and existing single-ticket behavior.
7. **Migration/upgrade, existing-user compatibility, documentation and release strategy**.
8. **Performance/cost expectations and validation plan**: what will be measured, including cross-descendant tokens, coordinator context size, workflow success, and when multi-agent delegation adds more overhead than value.
9. **Risks, explicit owner decisions and safe defaults** including ticket-selection scope, concurrency budget, stop conditions, background persistence limitations and safe fallback. Only ask about material security, product, credential/permission or compatibility choices.
10. **Execution and rollback strategy**, with checkpoints, verification evidence and handling of incomplete changes.

Do not create an enormous ticket hierarchy merely for planning's sake. Choose the minimum reasonable number of well-scoped GitHub issues/PRs and explain why the work is split that way. If an essential reviewer/merge vulnerability is confirmed, address it before unrelated process refinements.

### Suggested delivery sequencing (revise as evidence dictates)

- **Phase 1: Independent baseline and urgent safety fixes.** Re-audit **all three** repositories and agent runtimes; reproduce/correct review and merge concerns; record performance and true trust boundaries.
- **Phase 2: Native engineering quality plus leanness.** Integrate useful Superpowers and Ponytail principles into existing planner/implementer/reviewer, resolve test policies and instruction conflicts, preserve the fast path.
- **Phase 3: Optional orchestrator minimal viable path.** Single-run, sequential L0→fresh L1 ticket leads with native nesting only where supported, compact evidence contracts, explicit global budgets and a straightforward stop/resume story.
- **Phase 4: Orchestrator hardening.** Durable state reconciliation, claim/race protection, idempotent recovery, optional safe parallelism, Claude/Codex backend fallbacks, observability and failure tests.
- **Phase 5: Behavior evaluation and release.** Compare baseline vs new methods, including long ticket sequences; test existing installs/sync, document limitations and complete release notes.

**Priority rule:** If review/merge enforcement has confirmed material safety flaws, fix them before allowing unattended orchestration to increase merge throughput. Do not postpone straightforward orchestrator design or evidence collection needlessly while investigating unrelated enhancements.

This sequence is a starting point, not a mandate. Consolidate or reorder work when that is demonstrably simpler or safer.

---

## 11. Definition of done

Treat the effort as complete only when the implemented scope meets the following relevant outcomes:

- TicketFlow can run its normal workflow **without Superpowers or Ponytail installed** and no new undocumented external runtime requirement.
- Existing ticket creation, planning, worktrees, CI gates, PR handling, review, merge, Project status transitions, owner-controlled `Done`, deferred checks, init and sync continue to operate.
- Review-related security claims are supported by **tests and actual enforcement** or their unavoidable limitations are clearly documented. A reviewer merely posting on a head is not mistaken for approval when blockers remain.
- High-risk/complex tickets get appropriately deeper engineering checks, while simple tickets can still run quickly without needless planning or agent fan-out.
- Changes use the smallest **complete and maintainable** solution, based on existing code and native capabilities, without omitting any required feature, error handling, safety check, accessibility need or necessary test.
- The new orchestrator can continuously process a bounded, dependency-aware sequence of eligible tickets in **fresh ticket contexts**, without filling its own context with raw implementation transcripts. The standard single-ticket workflow is unchanged.
- Strict two-level delegation (L0→L1→L2), correctly interpreted **global** concurrency, model/effort selection or reported fallback, and isolated worktrees are exercised in tests.
- Interrupted/restarted runs safely reconcile from real GitHub state and do not silently re-run destructive operations, double-claim tickets, duplicate merges or misreport deployment/Done status.
- The product does not promise unattended operation after a terminated runtime without an actual persistent execution host; graceful resume is still provided.
- Native debugging, testing, verification and evidence requirements are available without relying on Superpowers prompts.
- Claude Code, Codex and generic-agent paths remain coherent, with no duplicate orchestrators or instructions that can silently override TicketFlow. Unsupported nesting has a tested, honest fallback.
- New logic has unit/integration and relevant negative-path tests. At least a small realistic agent-behavior evaluation exists for the most important workflows or limitations are clearly stated.
- Generated stubs, documentation, configuration, upgrades, release notes and migration tests are updated as needed. Existing user customizations are preserved.
- All verification results, unresolved limitations, security trade-offs and actual before/after measures are reported honestly.

Do not claim completion based only on a green CI run. Check that the intended workflow and safety behavior actually hold.

---

## 12. What to report back

Provide a concise decision-oriented report, then links to the **implemented** plans/issues/PRs and any remaining blockers:

1. **Independent verdict:** where the Superpowers/Ponytail/TicketFlow comparison and Claude/Codex feature assumptions were right, partly right, wrong or incomplete.
2. **What to absorb and what not to absorb** from both Superpowers and Ponytail, with reasons based on quality, cost, completeness and integration benefits.
3. **Confirmed defects and risk assessment**, especially around reviewer completion, attestations, privileged operations, and merge correctness.
4. **Prioritized plan**, covering native engineering-method integration and the new optional orchestration mode, with slices, acceptance tests and migration considerations.
5. **What you actually implemented**, the tests/evaluations run and results, orchestrator backend modes and tested limitations, remaining gaps and decisions genuinely needing the owner.

**Do not seek to make TicketFlow a clone of Superpowers or Ponytail, or a standalone agent swarm.** The desired result is a cohesive, self-contained, low-friction, high-quality engineering and delivery framework, preserving TicketFlow's differentiating GitHub automation, adding a reliable opt-in multi-ticket coordination layer, and improving only the engineering parts where the independent audit demonstrates real value.
