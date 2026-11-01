import { api, state, isSteward } from "../api.js";
import { h, svg, badge, pipeline, workflow, when, pct } from "../ui.js";
import { startTour, tourAvailable } from "../tour.js";

const READINESS_LABELS = {
  demo_mode_disabled: "Demonstration mode must be disabled",
  real_genotype_provenance: "Genotype provenance must be verified",
  participant_consent_records_verified: "Participant consent evidence must be verified",
  destructive_tamper_demo_disabled: "Destructive controls must be disabled",
  postgres_storage_configured: "Durable PostgreSQL storage must be configured",
  durable_storage_verified: "Persistence and recovery must be verified",
  external_audit_anchor_verified: "Independent audit anchoring must be verified",
  institutional_identity_provider_verified: "Institutional identity must be verified",
};
const fmt = (n) => Number.isFinite(Number(n)) ? Number(n).toLocaleString("en-US") : "—";
const fact = (label, value, note = "") => h("div", { class: "gg-fact" },
  h("span", { class: "gg-fact-label" }, label), h("strong", {}, value ?? "Not reported"),
  note ? h("small", {}, note) : null);

function helixGraphic() {
  const root = svg("svg", { viewBox: "0 0 460 300", class: "gg-helix", role: "img", "aria-label": "Abstract genomic double-helix visualization" });
  for (let i = 0; i < 14; i++) {
    const y = 18 + i * 19, a = 126 + Math.sin(i * .56) * 74, b = 300 - Math.sin(i * .56) * 74;
    root.append(
      svg("path", { d: "M " + a + " " + y + " Q 210 " + (y + 10) + " " + b + " " + (y + 19), fill: "none", stroke: "rgba(160,226,195,.34)", "stroke-width": 1.2 }),
      svg("circle", { cx: a, cy: y, r: 4.2, fill: i % 3 === 0 ? "#B7A6FF" : "#62D9A5" }),
      svg("circle", { cx: b, cy: y + 19, r: 4.2, fill: i % 3 === 1 ? "#FFB86B" : "#8CB8FF" }),
      svg("line", { x1: a, y1: y, x2: b, y2: y + 19, stroke: "rgba(222,245,232,.18)", "stroke-width": 1 })
    );
  }
  root.append(svg("circle", { cx: 220, cy: 150, r: 118, fill: "none", stroke: "rgba(120,220,170,.10)", "stroke-dasharray": "2 7" }));
  return root;
}
function metric(label, value, note, tone = "") {
  return h("article", { class: "gg-metric " + tone },
    h("div", { class: "gg-metric-top" }, h("span", {}, label), h("i", { "aria-hidden": "true" })),
    h("strong", {}, value), h("p", {}, note));
}
function workflowList() {
  const items = [
    ["01", "Policy evaluation", "Dataset use terms and request purpose are checked."],
    ["02", "Cohort eligibility", "Minimum cohort thresholds are enforced before release."],
    ["03", "Disclosure-risk assessment", "Heuristic risk signals are evaluated against the request."],
    ["04", "Output protection", "Aggregation and transformation controls are applied where required."],
    ["05", "Query monitoring", "Potentially probing request patterns are monitored."],
    ["06", "Human review", "Escalated decisions remain subject to authorized review."],
    ["07", "Audit record", "The decision is written to the tamper-evident event chain."],
  ];
  return h("ol", { class: "gg-workflow-list" }, items.map(([n, title, desc]) =>
    h("li", {}, h("span", { class: "gg-step-no" }, n), h("div", {},
      h("strong", {}, title), h("p", {}, desc)))));
}

export async function render() {
  const hasIdentity = !!(state.demo || state.who || state.adminKey), hl = state.health || {};
  const readyRequest = hl.readiness ? Promise.resolve({ ok: true, status: 200, data: hl.readiness }) : api("/health/ready");
  const [reqs, verify, ev, readyResult] = await Promise.all([
    hasIdentity ? api("/requests") : Promise.resolve({ ok: false, status: 401, data: null }),
    api("/audit/verify"),
    state.demo ? api("/eval/results") : Promise.resolve({ ok: false }),
    readyRequest,
  ]);
  const rows = reqs.ok ? (reqs.data.requests || []) : [];
  const readiness = hl.readiness ? { ok: true, data: hl.readiness } : readyResult;
  const chain = verify.ok ? verify.data : null;
  const latest = rows[0], pv = hl.provenance || {};
  const diff = ev.ok ? ev.data?.differencing?.accuracy : null;
  const root = h("div", { class: "stack gg-overview" });

  root.append(h("section", { class: "gg-command" },
    h("div", { class: "gg-command-copy" },
      h("div", { class: "gg-eyebrow" }, h("span", { class: "gg-live-dot" }), state.demo ? "DEMONSTRATION ENVIRONMENT / SYNTHETIC COHORT" : "GENOMIC DATA GOVERNANCE / RESEARCH WORKSPACE"),
      h("h1", {}, "Research access, governed with evidence."),
      h("p", {}, "A unified workspace for genomic dataset provenance, privacy-aware access decisions and accountable research operations."),
      h("div", { class: "gg-command-actions" },
        h("a", { class: "gg-primary-action", href: "#/requests" }, isSteward() ? "Open review queue" : "Create access request"),
        tourAvailable() ? h("button", { class: "gg-secondary-action", onclick: startTour }, "Explore platform") : null)),
    h("div", { class: "gg-command-art" }, helixGraphic(),
      h("div", { class: "gg-art-label" }, h("span", {}, "REFERENCE BUILD"),
        h("strong", {}, pv.genotypes_label || "Public research cohort")))));

  root.append(h("section", { class: "gg-metrics", "aria-label": "Research environment metrics" },
    metric("Individuals in cohort", fmt(hl.donors), pv.genotypes_label || "Reported by research API", "metric-green"),
    metric("Variant loci", fmt(hl.variants), "Loaded research variant set", "metric-blue"),
    metric("Minimum cohort threshold", fmt(hl.k_min), "Required before eligible aggregate release", "metric-violet"),
    metric("Audit chain", chain ? (chain.ok ? "Verified" : "Integrity issue") : "Unavailable",
      chain ? fmt(chain.length) + " recorded events" : "Integrity status unavailable", chain?.ok ? "metric-green" : "metric-amber")));

  root.append(h("section", { class: "gg-source-strip" },
    h("div", { class: "gg-source-heading" }, h("span", { class: "gg-section-index" }, "01"),
      h("div", {}, h("strong", {}, "Research dataset"), h("small", {}, "Live service-reported provenance"))),
    fact("Genotype source", pv.genotypes_label || "Not reported"),
    fact("Use-policy basis", pv.consent_label || "Not reported"),
    fact("Storage", hl.storage_backend || "Not reported"),
    fact("Release posture", readiness.data?.ready === true ? "Readiness checks passed" : "Research prototype")));

  if (!readiness.ok || readiness.data?.ready !== true) {
    const failed = Object.entries(readiness.data?.checks || {}).filter(([, ok]) => ok !== true)
      .map(([key]) => READINESS_LABELS[key] || key.replaceAll("_", " "));
    root.append(h("section", { class: "gg-release-gate" },
      h("div", { class: "gg-gate-mark" }, "!"),
      h("div", {}, h("div", { class: "gg-eyebrow" }, "DEPLOYMENT ASSURANCE"),
        h("strong", {}, "Research prototype — production release is not cleared"),
        h("p", {}, "The service is available for public-genotype research workflows. It is not approved for private participant data, controlled-access cohorts or clinical decisions."),
        failed.length ? h("details", {}, h("summary", {}, failed.length + " outstanding release controls"),
          h("ul", {}, failed.map((item) => h("li", {}, item)))) : null)));
  }

  const recent = h("section", { class: "gg-panel gg-activity" },
    h("div", { class: "gg-panel-head" },
      h("div", {}, h("span", { class: "gg-section-index" }, "02"), h("h2", {}, "Access activity")),
      h("a", { href: "#/requests" }, "View request register →")),
    rows.length
      ? h("div", { class: "gg-activity-list" }, rows.slice(0, 5).map((r) =>
          h("a", { class: "gg-activity-row", href: "#/request/" + r.id },
            h("span", { class: "gg-activity-id" }, "#" + r.id),
            h("span", { class: "gg-activity-description" },
              h("strong", {}, ((r.request || {}).purpose || "Research request").replaceAll("_", " ")),
              h("small", {}, ((r.request || {}).data_level || "Unspecified") + " · " + when(r.ts))),
            badge(r.outcome), h("span", { class: "gg-row-arrow" }, "↗"))))
      : h("div", { class: "gg-empty-activity" },
          h("div", { class: "gg-empty-icon" }, "↗"),
          h("div", {}, h("strong", {}, hasIdentity ? "No access requests recorded" : "Connect an authorized research identity"),
            h("p", {}, hasIdentity ? "New submissions and their review outcomes will appear here." :
              "Request-level activity is restricted to authenticated researchers and data stewards.")),
          h("a", { href: "#/requests" }, hasIdentity ? "Start a request →" : "Open request workspace →")));

  const governance = h("section", { class: "gg-panel gg-governance" },
    h("div", { class: "gg-panel-head" },
      h("div", {}, h("span", { class: "gg-section-index" }, "03"), h("h2", {}, "Governance controls")),
      h("a", { href: "#/audit" }, "Audit log →")),
    h("div", { class: "gg-governance-grid" },
      fact("Dataset provenance", pv.genotypes_label || "Not reported"),
      fact("Policy mapping", pv.consent_label || "Not reported"),
      fact("Audit integrity", chain ? (chain.ok ? "Verified" : "Integrity issue") : "Unavailable", chain ? fmt(chain.length) + " entries checked" : "No verification response"),
      fact("Model assistance", hl.agents_use_llm ? "Configured" : "Template-based explanations", "Advisory only; rules govern release"),
      fact("Minimum release cohort", fmt(hl.k_min), "Applied by policy engine"),
      fact("Identity assurance", readiness.data?.checks?.institutional_identity_provider_verified === true ? "Verified" : "Not verified", "Institutional identity provider")));
  root.append(h("div", { class: "gg-two-column" }, recent, governance));

  const flowPanel = h("section", { class: "gg-panel gg-workflow" },
    h("div", { class: "gg-panel-head" },
      h("div", {}, h("span", { class: "gg-section-index" }, "04"), h("h2", {}, "Decision architecture")),
      h("span", { class: "gg-panel-meta" }, "Seven-stage control path")),
    workflowList());
  if (latest) {
    const full = await api("/requests/" + latest.id);
    if (full.ok) root.append(h("section", { class: "gg-panel gg-latest" },
      h("div", { class: "gg-panel-head" },
        h("div", {}, h("span", { class: "gg-section-index" }, "05"), h("h2", {}, "Latest decision")),
        h("a", { href: "#/request/" + latest.id }, "Request #" + latest.id + " →")),
      pipeline(workflow(full.data), { play: true, caption: true })));
  }
  root.append(flowPanel);
  if (state.demo && diff) root.append(h("section", { class: "gg-panel gg-evidence" },
    h("div", { class: "gg-panel-head" },
      h("div", {}, h("span", { class: "gg-section-index" }, "06"), h("h2", {}, "Privacy evaluation evidence")),
      h("a", { href: "#/redteam" }, "Evaluation details →")),
    h("div", { class: "gg-evidence-grid" },
      fact("Attack recovery without controls", pct(diff.none?.mean, 0)),
      fact("With GenomeGuard protections", pct(diff.ladder_plus_guard?.mean, 0)),
      fact("Baseline guessing", pct(diff.baseline?.mean, 0)))));
  return root;
}
