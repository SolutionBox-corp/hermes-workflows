/**
 * SQLite schema for `runs.db` — the source of truth for workflow run state and
 * cron schedule bindings. Embedded as a string (rather than a .sql file) so the
 * core stays path-agnostic and needs no file resolution at load time.
 *
 * One `workflow_node_runs` row per (run, node): it holds the *current* node
 * state used to reconstruct a RunState. Full per-attempt history lives natively
 * in Hermes `task_runs`, not here.
 */

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS workflow_runs (
  id               TEXT PRIMARY KEY,
  workflow_id      TEXT NOT NULL,
  workflow_version INTEGER,
  status           TEXT NOT NULL,
  project_id       TEXT,
  input_json       TEXT,
  started_at       INTEGER,
  finished_at      INTEGER,
  error            TEXT
);

CREATE TABLE IF NOT EXISTS workflow_node_runs (
  id              TEXT PRIMARY KEY,
  run_id          TEXT NOT NULL,
  node_id         TEXT NOT NULL,
  status          TEXT NOT NULL,
  hermes_task_id  TEXT,
  outcome         TEXT,
  review_decision TEXT,
  seq             INTEGER,
  output_json     TEXT,
  error           TEXT,
  FOREIGN KEY(run_id) REFERENCES workflow_runs(id)
);

CREATE TABLE IF NOT EXISTS workflow_schedules (
  id              TEXT PRIMARY KEY,
  workflow_id     TEXT NOT NULL,
  cron_expression TEXT NOT NULL,
  hermes_cron_id  TEXT,
  enabled         INTEGER NOT NULL DEFAULT 1,
  last_run_id     TEXT,
  next_run_at     INTEGER
);

CREATE INDEX IF NOT EXISTS idx_runs_status      ON workflow_runs(status);
CREATE INDEX IF NOT EXISTS idx_node_runs_run    ON workflow_node_runs(run_id);
CREATE INDEX IF NOT EXISTS idx_schedules_wf     ON workflow_schedules(workflow_id);
`;
