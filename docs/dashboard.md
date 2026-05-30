# Dashboard

The dashboard ships a **Workflows** tab. The current frontend bundle is read-only
(it lists workflows and active runs and shows the OpenSecondBrain connection
state), but the backend now exposes the full authoring and run-control API the
visual `@xyflow/react` editor will consume — the editor frontend is the next
phase. The backend never starts its own web server: it exports an `APIRouter`
that the Hermes dashboard's running FastAPI app mounts.

## Contract

`dashboard/manifest.json` follows the Hermes dashboard-plugin contract:

```json
{
  "name": "workflows",
  "label": "Workflows",
  "icon": "Workflow",
  "version": "0.1.0",
  "tab": { "path": "/workflows", "position": "after:skills" },
  "slots": [],
  "entry": "dist/index.js",
  "api": "plugin_api.py"
}
```

## Backend

`dashboard/plugin_api.py` exports a FastAPI `APIRouter`, mounted by the dashboard
runtime at `/api/plugins/workflows/`. The routes are thin: each delegates to the
TypeScript core CLI (the core owns all spec logic) or the orchestrator.

Listing and status:

- `GET /workflows` — workflows discovered under the spec roots.
- `GET /runs` — active runs from `runs.db`.
- `GET /o2b-status` — `{ "connected": bool }`, best-effort and never raising.

Authoring (for the editor):

- `GET /workflows/{id}` — the full graph `{ workflow, ui?, path }`; `404` if absent.
- `PUT /workflows/{id}` — save an edited graph. Body is `{ workflow, ui? }`; the
  body id must match the URL. An invalid graph or id mismatch is a `400` (the
  core validates before writing, so no invalid spec is persisted).
- `POST /workflows/{id}/validate` — `{ valid, errors, warnings }` for the saved spec.
- `POST /workflows/{id}/compile-preview` — the Hermes plan the spec compiles to.

Execution control:

- `POST /workflows/{id}/run` — start a run (same path as the CLI `run`); `404` if absent.
- `GET /runs/{id}` — full run state with per-node detail, for the run inspector; `404` if absent.
- `POST /runs/{id}/cancel` — cancel a run; `404` if absent.
- `POST /runs/{id}/retry` — retry a run, or one failed node via `{ "node_id": "..." }`.

### Testing note

`fastapi` is a **test-only** dependency for this plugin and is intentionally not
declared in `pyproject.toml`: at runtime the Hermes dashboard provides the
FastAPI app and imports this router; the plugin never spawns its own instance.
The route tests are therefore guarded with `pytest.importorskip("fastapi")` and
skip cleanly in environments (like CI without the dashboard runtime) where
FastAPI is not installed.

## Frontend

`dashboard/dist/index.js` is a small, build-free bundle. It uses the React and
`fetchJSON` helpers the dashboard exposes on `window.__HERMES_PLUGIN_SDK__` and
registers its tab via `window.__HERMES_PLUGINS__.register("workflows", ...)`, so
it needs no bundler. It renders two tables (workflows, active runs) and the O2B
badge. A full `apps/dashboard` build lands with the visual editor.
