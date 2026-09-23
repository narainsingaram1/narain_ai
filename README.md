# Orbit — personal life OS

A working, local-first MVP for tasks, calendar events, notes, journaling, goals, life areas, and workspace-grounded actions. No account, API key, or cloud service is required. Agent actions use a local Ollama model.

## Run

Requires Node.js 24 or newer.

```bash
ollama pull qwen3.5:4b
npm run dev
```

Make sure Ollama is running (`ollama serve` if it is not already). Open **http://127.0.0.1:3000**. The app binds to loopback only. Data is saved in `data/orbit.sqlite` and ignored by Git. Export a JSON backup from the dashboard. `npm start` runs without file watching. Set `ORBIT_MODEL` to another locally installed tool-capable Ollama model if preferred. Set `ORBIT_THINK=true` to enable model reasoning at the cost of slower responses.

Measure the agent path against your real model with `npm run bench` (it starts its own server and a temporary workspace, so your data is untouched). `npm run bench -- --ask "mark the robinhood task done"` runs one request, and `--model`, `--url`, and `--server` pick the model, the Ollama address, and the server file. It prints wall time, model calls, and prompt/output tokens per request. Set `ORBIT_DEBUG=1` to log one line per model call yourself.

## What is real now

- Create, edit, complete, delete, and filter tasks. Attach a life area, academic class, due date, and priority.
- Create and edit personal events, notes, journal entries, and goals. Calendar events appear in a visual month or week view. Click a date's **+** to create an event there, navigate with the arrows or **Today**, and move events by dragging them or using **Move date** in the selected day's agenda.
- Add custom life areas. When you select **Academics**, choose a class you have created. Use **Manage classes** in Academics or the entry form to add, rename, and remove classes. Removing a class keeps its linked entries and makes them unassigned.
- Search saved records and class names with the search button or `⌘K`/`Ctrl+K`.
- View a daily focus summary, upcoming tasks/events, and active goals.
- Ask Orbit to find, create, edit, or delete tasks, events, notes, journal entries, and goals. It uses local Ollama tool calls, and the server resolves a record from its title, so naming a record the way you normally would is usually enough; it searches and reads first only when your wording is vague, and when several records match it asks which one instead of guessing. One validated create or edit runs immediately; grouped changes and deletions show a preview and require **Apply**. Milestone tasks link to their parent task and inherit its life area and class. Changes use a SQLite transaction and edits are rejected if a record changed after Orbit read it. The earlier deterministic retrieval remains available through the API with `mode: "search"`.
- Build professor outreach, LinkedIn messages, and job-application drafts through a controlled action loop. Add verified facts in **Action Center**, optionally configure a Brave Search API key, then ask Orbit to research a specific target and draft the action. Research is read-only and cited; external page text is treated as untrusted data. The exact draft is stored as `pending_approval`, and only an explicit approval unlocks a mail/client or browser handoff. Orbit never claims a handoff was sent or submitted; you mark it complete after doing so.
- Export readable JSON. The SQLite database itself is the full local backup source.

Existing academic entries with free-text class names are linked to editable classes on first startup after this update. A pre-migration SQLite backup is saved in `data/orbit-before-classes-20260921.sqlite` for the current workspace.

## Current boundaries

There is no Google/Apple calendar sync, Apple Health connection, authentication, multi-device sync, recurring events, reminders, attachment upload, or import yet. Email, LinkedIn, and job-site actions use a user-driven handoff; direct OAuth sending and automatic form submission are deliberately not connected yet. LinkedIn and job-board browser automation is brittle and may violate site rules, so it should be added only through site-specific adapters with explicit per-action approval. Orbit's local model can misunderstand a request; review every external-action card, especially recipients, claims, dates, and attachments. API keys are currently stored in the local SQLite settings table, not macOS Keychain. Do not expose this server to the internet. The app is intended for one user on one machine. `node:sqlite` is still labeled a release-candidate API in Node 24 documentation, so pin and test the Node version when deploying.

## Agentic security model

- The model may research, retrieve, summarize, plan, and draft. Deterministic code validates URLs, profile visibility, state transitions, and execution permissions.
- Web fetching requires HTTPS, resolves DNS before the request, blocks private/local addresses, re-checks redirects, accepts only text/HTML, and caps time and response size.
- Profile facts marked `sensitive` stay in local storage and are excluded from the drafting tool.
- External actions move through `pending_approval → approved → handed_off → executed`. Approval is single-purpose and the audit log records each transition.
- `executed` means the user confirmed completion. It is never inferred from a model response or merely opening a handoff.

The detailed product and engineering buildout is in [MVP_PLAN.md](MVP_PLAN.md).

## Suggested next build prompt for Codex

> Read `README.md` and `MVP_PLAN.md`. Implement Phase 1 from the plan in small, reviewable commits. Preserve the current local data and API contract. Add migrations before altering the schema. Verify create/edit/delete, date handling, and backup restore with tests, then report what is and is not connected to external services.
