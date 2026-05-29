/**
 * Minimal, build-free Workflows dashboard tab. Read-only: lists workflows and
 * active runs and shows the OpenSecondBrain connection badge. Uses the React /
 * fetch helpers the Hermes dashboard exposes on window, so it needs no bundler.
 * The visual @xyflow editor is a later phase.
 */
(function () {
  var PLUGINS = window.__HERMES_PLUGINS__;
  var SDK = window.__HERMES_PLUGIN_SDK__;
  if (!PLUGINS || !SDK) return;

  var React = SDK.React;
  var useState = SDK.hooks.useState;
  var useEffect = SDK.hooks.useEffect;
  var fetchJSON = SDK.fetchJSON;
  var h = React.createElement;

  function rows(items, columns) {
    return items.map(function (item, i) {
      return h(
        "tr",
        { key: i },
        columns.map(function (col, j) {
          return h("td", { key: j, style: { padding: "4px 12px 4px 0" } }, String(item[col] || ""));
        }),
      );
    });
  }

  function WorkflowsTab() {
    var workflowsState = useState([]);
    var runsState = useState([]);
    var o2bState = useState(null);
    var workflows = workflowsState[0];
    var runs = runsState[0];
    var o2b = o2bState[0];

    useEffect(function () {
      fetchJSON("/api/plugins/workflows/workflows")
        .then(function (d) { workflowsState[1]((d && d.workflows) || []); })
        .catch(function () {});
      fetchJSON("/api/plugins/workflows/runs")
        .then(function (d) { runsState[1]((d && d.runs) || []); })
        .catch(function () {});
      fetchJSON("/api/plugins/workflows/o2b-status")
        .then(function (d) { o2bState[1](d ? d.connected : false); })
        .catch(function () {});
    }, []);

    return h(
      "div",
      { style: { padding: 16 } },
      h("h2", null, "Workflows"),
      h(
        "p",
        null,
        "OpenSecondBrain: " + (o2b === null ? "…" : o2b ? "connected" : "not connected"),
      ),
      h(
        "table",
        null,
        h("tbody", null, rows(workflows, ["id", "name", "scope", "trigger"])),
      ),
      h("h3", null, "Active runs"),
      h(
        "table",
        null,
        h("tbody", null, rows(runs, ["run_id", "workflow_id", "status"])),
      ),
    );
  }

  PLUGINS.register("workflows", WorkflowsTab);
})();
