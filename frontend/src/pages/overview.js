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
  const stage = h("div", { class: "dna-stage", role: "img", "aria-label": "Interactive three-dimensional DNA double helix. Drag to rotate." });
  const model = h("div", { class: "dna-model", "aria-hidden": "true" });
  const colors = ["#72f0b2", "#9a8cff", "#63c9ff", "#ffc477"];
  for (let i = 0; i < 20; i++) {
    const angle = i * Math.PI / 5, y = -132 + i * 13.8;
    const x1 = Math.sin(angle) * 66, z1 = Math.cos(angle) * 66;
    const x2 = -x1, z2 = -z1;
    const rung = h("span", { class: "dna-rung", style: "top:50%;left:50%;margin-top:" + y + "px;transform:translate(-50%,-50%) rotateY(" + (angle * 180 / Math.PI) + "deg);--rung-hue:" + (i % 2 ? "#a99aff" : "#70e9b0") });
    const bead = (x, z, color, cls) => h("span", { class: "dna-bead " + cls, style: "left:50%;top:50%;background:radial-gradient(circle at 32% 27%,#fff 0%, " + color + " 20%, color-mix(in srgb," + color + " 52%,#071b14) 78%);transform:translate3d(" + (x - 8) + "px," + (y - 8) + "px," + z + "px)" });
    model.append(rung, bead(x1, z1, colors[i % colors.length], "dna-bead-a"), bead(x2, z2, colors[(i + 2) % colors.length], "dna-bead-b"));
  }
  for (let i = 0; i < 26; i++) {
    const x = ((i * 47) % 250) - 125, y = ((i * 73) % 270) - 135, z = ((i * 31) % 110) - 55;
    model.append(h("span", { class: "dna-particle", style: "left:50%;top:50%;transform:translate3d(" + x + "px," + y + "px," + z + "px);animation-delay:" + (i % 7) * -.43 + "s" }));
  }
  stage.append(model, h("span", { class: "dna-orbit dna-orbit-one" }), h("span", { class: "dna-orbit dna-orbit-two" }),
    h("span", { class: "dna-drag-hint" }, "↔ DRAG TO EXPLORE"));
  let dragging = false, lastX = 0, lastY = 0, rotY = -24, rotX = -10;
  stage.addEventListener("pointerdown", (e) => {
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    model.style.animation = "none"; stage.classList.add("is-dragging");
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    rotY += (e.clientX - lastX) * .72; rotX = Math.max(-45, Math.min(45, rotX - (e.clientY - lastY) * .42));
    lastX = e.clientX; lastY = e.clientY;
    model.style.transform = "rotateX(" + rotX + "deg) rotateY(" + rotY + "deg)";
  });
  const release = () => { dragging = false; stage.classList.remove("is-dragging"); };
  stage.addEventListener("pointerup", release);
  stage.addEventListener("pointercancel", release);
  return stage;
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
      h("div", { class: "gg-eyebrow" }, h("span", { class: hl.status === "ok" ? "gg-live-dot" : "gg-live-dot gg-live-dot-off" }), state.demo ? "DEMONSTRATION ENVIRONMENT / SYNTHETIC COHORT" : "GENOMIC DATA GOVERNANCE / RESEARCH WORKSPACE"),
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
      chain ? (chain.length ? fmt(chain.length) + " recorded events" : "No access events recorded yet") : "Integrity status unavailable", chain?.ok ? "metric-green" : "metric-amber")));

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
      fact("Audit integrity", chain ? (chain.ok ? "Verified" : "Integrity issue") : "Unavailable", chain ? (chain.length ? fmt(chain.length) + " entries checked" : "No access events recorded yet") : "No verification response"),
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
