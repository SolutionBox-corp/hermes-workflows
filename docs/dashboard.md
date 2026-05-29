# Dashboard

The dashboard ships a read-only **Workflows** tab: it lists workflows and active
runs and shows the OpenSecondBrain connection state. There is no editor yet — the
visual `@xyflow` editor is a later phase. Editing is human-only (via the CLI).

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
runtime at `/api/plugins/workflows/`. Routes are read-only:

- `GET /workflows` — workflows discovered under the spec roots.
- `GET /runs` — active runs from `runs.db`.
- `GET /o2b-status` — `{ "connected": bool }`, best-effort and never raising.

## Frontend

`dashboard/dist/index.js` is a small, build-free bundle. It uses the React and
`fetchJSON` helpers the dashboard exposes on `window.__HERMES_PLUGIN_SDK__` and
registers its tab via `window.__HERMES_PLUGINS__.register("workflows", ...)`, so
it needs no bundler. It renders two tables (workflows, active runs) and the O2B
badge. A full `apps/dashboard` build lands with the visual editor.
