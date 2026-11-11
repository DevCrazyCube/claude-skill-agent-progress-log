---
name: agent-progress-log
description: Keep an append-only progress log in a repo that more than one agent or person works in. Use at the start of a session to find out where the work stands, and at the end of every session (also a failed one) to record what was done, what comes next and what is blocked. Each session adds one small file; PROGRESS.md is generated from them, so parallel sessions never conflict.
---

# Agent progress log

A repo that several sessions work in needs one place that says where the work stands. A hand-edited status file
does not survive that: two sessions edit the same lines, and the later one silently wins. Here every session
writes **one new file**, and a script builds `PROGRESS.md` from all of them.

`scripts/progress.mjs` is in this skill's folder. Copy it into the project once (for example to
`scripts/progress.mjs`) so every agent and CI can run it; it has no dependencies (Node 18+).

## At the start of a session

Read `PROGRESS.md`. Its "Now" block names the milestone in hand, who touched it last, the next action and what is
blocked. Start from "Next action" unless the user asks for something else.

If there is no `PROGRESS.md` yet, the project has not been set up: see "Setting up" below.

## At the end of a session

1. Make the fragment (it prints the path of the new file):

   ```bash
   node scripts/progress.mjs new --agent claude --milestone M1 --tests green --lint not-applicable
   ```

   Add `--done` only when the milestone's demo was actually run and worked. Give each check the result of running
   it **in this session**: `green`, `red`, or `not-applicable` when it was not run. Never write `green` from memory.

2. Fill in the three lines in that file:

   ```markdown
   **Did:** what changed, with the numbers that prove it (tests passed, rows imported, files touched).
   **Next:** the single next action, concrete enough for a session that knows nothing else.
   **Blockers:** what only a person can supply, or "nothing".
   ```

3. Regenerate and commit both files:

   ```bash
   node scripts/progress.mjs
   git add progress/ PROGRESS.md
   ```

## Rules

- **One fragment per session.** Not one per commit, not one per task.
- **Append-only.** Never edit or delete an earlier fragment, also not to correct it: write a new one that says
  what was wrong.
- **Never edit `PROGRESS.md` by hand.** It is overwritten on the next run.
- **A failed session still gets a fragment.** "Tried X, it failed because Y, next try Z" is what saves the next
  session an hour.
- **A check is red until it was seen green.** A milestone marked done with a red check shows as
  "in progress (a check is red)".
- **Blockers are things for people.** A key, a decision, an account, a file. Something the next session can do
  itself belongs under Next.
- When `git pull` brings in other sessions' fragments, run the script again. `PROGRESS.md` may conflict in a
  merge; take either side and regenerate, the fragments are the truth.

## Setting up

Put `progress.config.json` in the project root (every key is optional):

```json
{
  "title": "My project",
  "milestones": [
    { "id": "M0", "name": "Skeleton", "demo": "`npm start` prints the version" },
    { "id": "M1", "name": "Import",   "demo": "a CSV of 1,000 rows lands in the database" }
  ],
  "checks": ["tests", "lint"]
}
```

- `milestones`: each one has a **demo**, the thing someone can see when it is done. Without one, "done" is an
  opinion. Leave the list out and the page is a plain log.
- `checks`: the names of the commands that must pass (they become columns and `--<name>` options).
- `dir` (default `progress`) and `out` (default `PROGRESS.md`) move the files.

In CI, `node scripts/progress.mjs --check` exits 1 when `PROGRESS.md` is stale or a fragment is malformed
(no `at`, no `agent`, an unknown milestone, a check that is missing or misspelt, no **Did:** or **Next:** line).

See `example/` for a small project with three fragments and the page they generate.
