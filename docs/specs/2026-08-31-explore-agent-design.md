# Explore Agent Design

Status: approved (brainstorm), ready for implementation planning
Builds on: `docs/specs/2026-05-29-hermes-workflows-mvp-design.md` (run model),
and the node audit record shipped in `bc4d5b6`..`8886f8d`.

## 1. Goal

Make the `explore` stage produce a finding a person can act on without repeating
the work: a diagnosis or a design that states what it is, what it is based on,
and what it could not establish.

The audit record shipped earlier answers *what the step did*. It does not make
the step work well. Measured on two real runs (`coding-AUDIT2`, `coding-ISSUE188`):
the agent used **0 symbolic queries**, 4 greps and 29 shell commands, invoked
**0 skills**, and ran with **no instruction file of any kind**. The method exists
on the operator's workstation and nowhere near the agent.

Non-goal: implementation. The pipeline deliberately ends at human approval. A
step allowed to both diagnose and change the code is a step whose diagnosis
cannot be trusted, because "I found the cause" and "I made the symptom go away"
stop being distinguishable.

## 2. What the agent is given

| Capability | Before | After |
| --- | --- | --- |
| Symbols | Serena present, unused | Serena plus a hook that refuses grep on a symbol until Serena has been asked |
| Browser | none | Playwright MCP (`@playwright/mcp` 0.0.79, chromium headless shell) |
| Data | none | Per-project `SELECT`-only database account, never the operator's |
| Method | none | the box user's own `~/.claude/CLAUDE.md` |

Provisioned on the box 2026-08-31 and verified by running, not by installing:
chromium 151, docker 26.1.5 (`hello-world` ran), Playwright screenshot of
`example.com` produced a 1280x720 PNG.

The database role exists as of the same date: `hermes_explore` on solutionbox2,
`LOGIN` only, no `SUPERUSER` / `CREATEDB` / `CREATEROLE`, connection limit 5.
Read-only by construction and verified empirically: `SELECT` succeeds,
`DELETE` and `CREATE TABLE` are refused, and a production application table is
refused. Granted so far on `taxi-nova-testovaci-00` only (150 tables); every
other database is unread until granted deliberately. The credential lives in
mirobot1's git-crypt encrypted `~/.hermes/.env`.

## 3. Three tiers of enforcement

The central decision. The method does not fail because it is wrong; it fails
because nothing obliges the agent to follow it. Each rule belongs in the
cheapest tier that can actually hold it, and **a rule that can be wired is never
left to prose**.

### 3.1 Hook (mechanical, blocks in flight)

Ported from the operator's `~/.claude/hooks/lsp-first.py`, which exists because
the same rule written out in full prose was ignored anyway.

- `PreToolUse` on `Grep|Bash`: refuse a grep for a mixed-case identifier when no
  Serena query has been made for it in this session. Refuse **once**; a second
  attempt passes with a warning, because a stuck agent is worse than a grep.
- `PostToolUse` on `mcp__serena__.*`: record that the symbol was queried.
- A write outside `.orchestrator/<task>/` is refused.

### 3.2 Checklist in the envelope (verifiable at the gate)

What cannot be enforced mechanically can still be *asked*, and the answer
rendered where a reviewer sees it. The step declares, per run:

- did reference discovery run, and with which tool
- is the finding **evidenced** or a **hypothesis**, and by what
- was a screenshot taken, and was it opened and confirmed to contain the defect
- which shared callers were examined and found unaffected

A missing answer is rendered as missing. It is never hidden, and it never
silently reads as a pass.

### 3.3 The box's own `CLAUDE.md` (the method)

The method is written to `~/.claude/CLAUDE.md` **of the `hermes` user on the
box**, not to a separate file the stage prompt has to remember to point at.

This matters more than it looks. A referenced document is loaded only if the
prompt says so and only for the stage that says it; an instruction file is
loaded by Claude Code itself, for every step, without anyone remembering. It is
also the same mechanism the operator relies on locally, and the session digest
already reports it, so "Instruction files in force" stops reading `None found`
and starts naming the file that was actually in effect.

Its content is a distillation of the operator's `CLAUDE.md` (37k characters)
down to what applies to unattended exploration:

- Serena, then LSP, then grep, in that order
- "grep found nothing" is not evidence of absence
- verify anything you will rely on a second way
- reference discovery is a required output, not a step
- battle-tested libraries before a hand-written equivalent
- a shared caller the change does not affect is still listed, with the reason

Deliberately omitted, because unattended they do not apply or are unsafe: asking
the user, deployment authorisation, git safety, database migration rules.

Known cost: this is a second source of truth beside `CLAUDE.md` and the two will
drift when either changes. Accepted knowingly; the alternative was shipping the
operator's personal and company rules, including push authorisation, to an agent
with nobody to ask.

## 4. What the step must produce

A fixed skeleton, so two findings can be compared:

```
BUG | FEATURE              decided first, explicitly
Evidenced | Hypothesis     and by exactly what
What happens               file:line, the sequence
Places affected            direct references, consumers reading the same data,
                           duplicates across roles and platforms, backend and
                           frontend counterparts, tests, specs and docs
                           (including the ones NOT affected, with the reason)
Edge cases
Open decisions             <hermes_questions>, mandatory
```

Written to `.orchestrator/<task>/report.md`, with screenshots beside it.

### 4.1 Environment rules

- Production is read-only. Always. No writes, no "harmless" test record.
- On staging the step may create data when that is the only way to reproduce,
  and must state exactly what it created and how to remove it.
- If the step cannot tell which environment it is pointed at, it treats it as
  production.

## 5. Gate rendering

The mechanics stay; the presentation is corrected. Observed in the browser on
2026-08-31 against `coding-ISSUE188-503fe53e`:

- a `markdown` artifact renders as markdown, not as its source. A 21 kB report
  currently shows `## Step 1` and `**FEATURE**` literally.
- one language for the section labels. `ROZHODUJEŠ` and `CHCE PO TOBĚ ROZHODNOUT`
  currently sit next to `WHAT YOU ARE APPROVING` and `CONTINUE HERE`.
- "where each choice leads" moves above the report. It is what the reviewer
  needs before pressing a button and it is currently furthest from the buttons.
- the `ok` headline is dropped. It carries nothing.
- the command collapses into a `<details>`. It is the visually heaviest element
  in the panel and close to worthless for the decision.
- `DEFINITION` appears twice in one modal, once for the judged step and once for
  the gate. The two need distinct labels.

## 6. What this does not solve

- **Electron targets.** Playwright cannot reach Helper-2's UI. The bug path
  works for web projects; for Helper-2 it stays code plus data.
- **Drift between the box's `CLAUDE.md` and the operator's** (section 3.3).
- **Schema is visible on every database.** The read-only account cannot read
  application data it was not granted, but PostgreSQL lets any role connect to
  any database by default (PUBLIC holds CONNECT) and read the system catalogues,
  so table and column names on production are enumerable. Closing that means
  either revoking CONNECT from PUBLIC, which affects every other role, or a
  `pg_hba.conf` rule. Neither was done unilaterally on a production server.
- **Box provisioning is not in git.** chromium, docker and Playwright were
  installed by hand today. A rebuilt box would not have them. A provisioning
  script is outstanding.
- **Docker has no consumer.** It was installed for a Postgres container that the
  design then dropped, because the databases live on solutionbox2.

## 7. Decisions recorded

| Decision | Chosen | Rejected, and why |
| --- | --- | --- |
| How much of the method to inherit | Distil the explore-relevant part into `EXPLORE.md` | Shipping `CLAUDE.md` whole: contains rules that are meaningless or unsafe without a human to ask |
| How to make Serena actually used | Port the `PreToolUse` hook | Prompt instruction alone: measurably already failed, 0 symbolic queries across two runs |
| Database access | Per-project `SELECT`-only account | A local Postgres container: the data lives on solutionbox2, and a copy will not show a bug that depends on fresh data |
| Where the method lives | The box user's `~/.claude/CLAUDE.md` | A referenced `EXPLORE.md`: loaded only when a prompt remembers to point at it, and invisible to the digest |
| Where this spec lives | `docs/specs/`, this repo's existing model | Spec Kit or OpenSpec: both would put a second spec model beside the 13 specs already here |
