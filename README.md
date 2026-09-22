# Orbit — personal life OS

A working, local-first MVP for tasks, calendar events, notes, journaling, goals, life areas, and workspace-grounded answers. No account, API key, package install, or cloud service is required.

## Run

Requires Node.js 24 or newer.

```bash
npm run dev
```

Open **http://127.0.0.1:3000**. The app binds to loopback only. Data is saved in `data/orbit.sqlite` and ignored by Git. Export a JSON backup from the dashboard. `npm start` runs without file watching.

## What is real now

- Create, edit, complete, delete, and filter tasks. Attach a life area, academic class, due date, and priority.
- Create and edit personal events, notes, journal entries, and goals. Calendar events appear in a visual month or week view. Click a date's **+** to create an event there, navigate with the arrows or **Today**, and move events by dragging them or using **Move date** in the selected day's agenda.
- Add custom life areas. When you select **Academics**, choose a class you have created. Use **Manage classes** in Academics or the entry form to add, rename, and remove classes. Removing a class keeps its linked entries and makes them unassigned.
- Search saved records and class names with the search button or `⌘K`/`Ctrl+K`.
- View a daily focus summary, upcoming tasks/events, and active goals.
- Ask Orbit about priorities, deadlines, goals, or a topic. Answers cite matching local records. This is deterministic retrieval, not a language model.
- Export readable JSON. The SQLite database itself is the full local backup source.

Existing academic entries with free-text class names are linked to editable classes on first startup after this update. A pre-migration SQLite backup is saved in `data/orbit-before-classes-20260921.sqlite` for the current workspace.

## Current boundaries

There is no Google/Apple calendar sync, Apple Health connection, AI model, authentication, multi-device sync, recurring events, reminders, attachment upload, or import yet. Do not expose this server to the internet. The app is intended for one user on one machine. `node:sqlite` is still labeled a release-candidate API in Node 24 documentation, so pin and test the Node version when deploying.

The detailed product and engineering buildout is in [MVP_PLAN.md](MVP_PLAN.md).

## Suggested next build prompt for Codex

> Read `README.md` and `MVP_PLAN.md`. Implement Phase 1 from the plan in small, reviewable commits. Preserve the current local data and API contract. Add migrations before altering the schema. Verify create/edit/delete, date handling, and backup restore with tests, then report what is and is not connected to external services.
