---
name: antigravity-protocol
description: High-efficiency, low-token execution protocol — targeted edits, minimal chat output, no exploratory guessing. Use only when explicitly invoked ("antigravity", "fast path") or when the user complains about token usage or over-thinking.
disable-model-invocation: true
---

# Antigravity Protocol: High-Efficiency Coding

Drop high-token conversational behavior and adopt a strict, structured approach to
software development, prioritizing exact edits over exploratory guessing.

## 1. Core Directives

1. **Never use generic terminal commands** (`cat`, `grep`, `sed`, `ls`, or complex bash scripts) for file operations or exploration. Use your built-in edit/search tools.
2. **Chunk-based editing ONLY.** Never output full file contents. Issue search-and-replace style edits targeting exact locations.
3. **Stop guessing.** If a request is ambiguous, do NOT write test scripts to "figure it out". Stop and ask the user a specific question.
4. **No chat clutter.** Do not dump 100+ lines of code, logs, or planning into the chat. Cite code with file references; keep summaries to a few sentences.
5. **Acknowledge and act.** No preambles ("I understand you want to..."). Make the tool calls, then report tersely.

## 2. Process Intent (Determine Mode)

### Mode A: Investigatory (information requests)

- **Trigger:** "How does X work?", "Find where Y happens."
- **Action:** Search the codebase silently. Output only the short answer. Do not create a plan.

### Mode B: The Fast Path (small changes)

- **Trigger:** "Fix this typo", "Center the button", "Make the background red".
- **Action:** Read just enough context, issue the precise edit, close with a one-sentence summary. No planning.

### Mode C: Large tasks

- **Trigger:** "Add a new page", "Implement auth", "Refactor the database".
- **Action:** Use Cursor's native plan mode (trace dependencies silently, present a plan, wait for approval). During execution, verify before claiming completion: run `pnpm typecheck` and `pnpm test`.

## 3. Persistent Knowledge

Do not create ad-hoc knowledge files (`system_architecture.md`, `.cursorrules`,
`implementation_plan.md`). This repo already has homes for durable knowledge: record
decisions as ADRs in `docs/adr/`, vocabulary in `CONTEXT.md`, and workflow guidance
in `.cursor/rules/` and `.cursor/skills/`.

## 4. Tool Hierarchy

1. Read / search tools (targeted reads, low token).
2. Edit / replace tools (targeted code edits).
3. File-creation tools (brand-new files only).
4. Terminal commands (ONLY for running tests, starting servers, or installing packages — never for edits or file reading).
