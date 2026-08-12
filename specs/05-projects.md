# 05 — Projects & Collaboration

Context: `00-overview.md`. Tables: `projects`, `milestones`, `tasks`, `docs`, `notes`, `project_game` (reads `memberships`). All project-scoped — see `06-identity-access.md` for the access model.

A **project** is a team **build effort** (a game or tool you ship), with lifecycle state (`active` / `paused` / `shipped` / `archived`), grouped into **milestones**, worked on a **Kanban board**. It is not a lens onto the tracker; linking tracked games is optional.

## Step 5.1 — The board

Tasks are cards in status lanes: `backlog → todo → in_progress → review → done` (+ `archived`). Each card carries `priority`, `assigneeId`, `dueAt`, an optional `milestoneId`, and up to **one level of subtasks** via `parentTaskId` (a subtask cannot itself have children — enforce one-deep at the API).

## Step 5.2 — Manual ordering (fractional index)

A card's position within a `(projectId, status)` lane is a **fractional index** stored as text in `orderKey`:

- New card at lane end → a key ordered after the current max.
- Drop between two cards → a key **midway between** the two neighbours' keys.

A reorder therefore rewrites **one row**, never the whole column. The `tasks_board_idx (projectId, status, orderKey)` serves the board fetch directly. If keys grow long after many reorders, a background rebalance pass can renumber a lane.

## Step 5.3 — Milestones

Milestones are phases within a project (e.g. "prototype", "closed test", "launch"), each with its own `status` and `targetDate` and its own `orderKey`. The board can filter to a single milestone. Deleting a milestone nulls its tasks' `milestoneId` — the tasks survive.

## Step 5.4 — Docs and notes

Two distinct surfaces:
- **`docs`** — long-form markdown project documents (specs, design notes, meeting notes).
- **`notes`** — short pins / quick observations / dated calls, optionally referencing a tracked `universeId`.

Keep them separate tables; they differ in length, purpose, and lifecycle.

## Step 5.5 — Optional tracker link

`project_game` pins tracked games into a project; a task or note may also reference a `universeId`. A project with **zero** linked games is completely valid. Deleting a linked game nulls the reference, never the task or note.

## Acceptance

- A project's board, milestones, docs, and notes are visible only to its members.
- A card can be dragged across lanes and reordered with a single-row write.
- Milestones group and filter the board.
- A project needs zero linked games to be fully usable.
- Deleting a milestone or a linked game never deletes tasks.
