---
name: plan-to-issues
description: Split this repo's plan.md into GitHub issues with gh, one per unit of work, after a human has reviewed the split. Use when a plan is ready and has no issues yet.
---

# plan-to-issues

Turns `plan.md` into GitHub issues that workers can pick up cold. Easiest with `gh`, authenticated,
in a shell this agent can run.

## Steps

1. Read `plan.md`, `AGENTS.md` and `docs/adr/`.
2. Draft the split as a table: title · plan section · scope · done when · blocked by.
   One issue per unit of work.
3. **Stop and show the table to the human.** Publish nothing until they approve it.
4. Give every issue the shape in [What every issue carries](#what-every-issue-carries). Ask the
   human only for what that section does not cover.
5. Create each issue in dependency order, so blocked-by can cite real numbers:

   ```sh
   gh label create "plan:<plan>" --force   # once per plan
   gh issue create --title "<title>" --label "plan:<plan>" --body-file <tmp.md>
   ```

6. Record every issue URL from gh's output (not from memory) and reply with the list.

## What every issue carries

Decided by the repo owner on 2026-10-30, because the reviewer sorts issues by source and label.
`<plan>` is the `plan:` value in `plan.md`'s frontmatter, `<n>` the plan section (`1`, `2a`, ...).

- Label `plan:<plan>`, for example `plan:morning-digest`.
- The body opens with this exact first line, then three sections:

  ```md
  Source: plan.md § <n>

  ## Scope

  <what this issue changes, from the plan section; nothing the plan doesn't say>

  ## Done when

  <the section's "Done when", as a check someone else can run>

  ## Blocked by

  - <issue URL> - <what exactly blocks, if only part of it>
  ```

  With no blocker, `## Blocked by` holds `None.`
- A step that waits on someone outside the lane (a review, an approval) is its own issue. Its
  "Done when" names their answer, not the sending, so it stays open until they reply, and the
  steps after it (clean-up) list it under `## Blocked by`.
- Issues as files (ADR 0004) carry the same body; the label goes in `labels`.

Closing one, with the closing comment from AGENTS.md:

```sh
gh issue close <n> -c "<closing comment>"
```

## No `gh`

Steps 1–4 hold either way. GitHub reachable another way (a connector, the REST API, the web UI):
the same issues, made that way. GitHub issues out of reach altogether: write them as files in
`docs/issues/`, format in ADR 0004, then commit and push.

## Don'ts

- Don't paste the whole plan into one issue, and don't keep issues only in chat.
- Don't invent sections the plan doesn't have. If the plan is unclear, ask.
