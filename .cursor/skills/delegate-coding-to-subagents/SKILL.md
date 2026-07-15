---
name: delegate-coding-to-subagents
description: Delegates code writing and editing to subagents running an appropriately lower-power model. ALWAYS use this skill for any coding task — implementing features, fixing bugs, refactoring, editing files, or writing tests. Judgment, review, and synthesis stay with the main agent.
---

# Delegate Coding to Subagents

"For all coding tasks use your judgement to decide an appropriate lower power model and run that in a subagent."

Why: cost/efficiency — implementation work rarely needs the top-tier model; judgment, review, and synthesis stay with the main loop.

## How to apply

When a task is primarily **writing or editing code**, delegate it via the Task tool (`subagent_type: generalPurpose`) with a `model` override:

| Work type | Model choice |
|---|---|
| Trivial / mechanical edits (renames, version bumps, config tweaks, boilerplate) | Fastest available model (e.g. `composer-2.5-fast`) |
| Substantive implementation (features, bug fixes, refactors, tests) | **Cursor Grok 4.5 high** (`grok-4.5-xhigh`) — the preferred executing agent: quality/cost-effective coding model |

**Cursor Grok 4.5 high is the default executing agent.** Reach for it first for any non-trivial implementation work. Fall back to Sonnet 5 (`claude-sonnet-5-thinking-high`) or another mid-tier model (e.g. `claude-4.6-sonnet-medium-thinking`) only if Grok 4.5 is unavailable in the Task tool's current model list.

Pick from the model slugs currently available to the Task tool; the guidance above sets the priority order, not a hard requirement.

## What stays in the main loop

Do **not** delegate:

- Design decisions and architecture choices
- Auditing, code review, and verifying subagent output
- Data synthesis and analysis
- Anything judgment-heavy or requiring the full conversation context

## Workflow

1. Decide whether the task is implementation (delegate) or judgment (keep).
2. Write a **self-contained prompt** for the subagent: full file paths, the exact change wanted, relevant project invariants (e.g. sim stays headless, commands-in/events-out, version bump rule), and what the subagent should report back.
3. Launch the subagent with the chosen model override.
4. **Review the result in the main loop** before considering the task done — read the diff, run `pnpm typecheck` / `pnpm test` where relevant, and fix or re-delegate anything wrong.
