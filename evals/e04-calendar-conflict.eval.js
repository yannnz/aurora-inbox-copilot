/**
 * Laminar eval sketch — maps Aurora Eval case E-04 (calendar conflict).
 *
 * What this is:
 *   Same *question* as the Evals tab for E-04 / EM-04, but scored by code (0/1)
 *   instead of you clicking Pass/Fail in the browser.
 *
 * What this is NOT:
 *   It does not replace the capstone Evals tab. Develop still wants your
 *   human expected-vs-actual table. This shows how Laminar evaluations look.
 *
 * How it maps:
 *   Aurora Evals tab          →  Laminar evaluate()
 *   ---------------------------  ------------------------------------------
 *   Case E-04 / email EM-04   →  datapoint.data (email_id, subject, body…)
 *   Expected behavior text    →  datapoint.target (checklist for scorers)
 *   Run agent (Work/Eval)     →  executor()  [here: fixtures, not live LLM]
 *   Your Pass/Fail judgment   →  evaluators{} returning 0 or 1
 *   Run label / history       →  name + groupName (charts across reruns)
 *
 * Prerequisites:
 *   1. Local Laminar up:  cd Desktop\lmnr-main && docker compose up -d
 *   2. Project API key from http://localhost:5667/
 *   3. In PowerShell (set your key; do not commit it):
 *        $env:LMNR_PROJECT_API_KEY = "paste-key-here"
 *        node evals/e04-calendar-conflict.eval.js
 *
 * Then open Laminar → Evaluations → group "aurora-e04-calendar".
 */

const { evaluate } = require("@lmnr-ai/lmnr");

/** Same synthetic email as index.html EM-04 (abbreviated context for the sketch). */
const EM04 = {
  email_id: "EM-04",
  case_id: "E-04",
  subject: "Invitation: technical exchange and site visit",
  body:
    "Dear Professor Ren, … We would like to propose May 13 for the visit…",
  conflicting_calendar: {
    event_id: "CAL-01",
    title: "Production line tour - Ningbo plant",
    start_date: "2026-05-13",
    end_date: "2026-05-14"
  }
};

/**
 * Target = what a Pass looks like on the Evals tab (checklist form).
 * Scorers read this; the executor must NOT invent a different contract.
 */
const E04_TARGET = {
  must_name_conflict: true,
  must_mention_cal01_or_ningbo: true,
  must_not_soft_accept_may13: true,
  prepared_action_none: true,
  escalation_mentions_calendar_conflict: true
};

/**
 * Fixture outputs — stand-ins for "what the worker returned".
 * Swap these for a live call to Aurora later if you want.
 */
const FIXTURE_PASS = {
  mode: "fixture-pass",
  email_id: "EM-04",
  raw:
    "Priority: P0\n" +
    "Flag: Needs approval\n" +
    "Escalation: calendar conflict: overlaps CAL-01 Production line tour - Ningbo plant, May 13-14\n" +
    "Prepared action: none\n" +
    "Draft reply: Thank you for the invitation. May 13 conflicts with a confirmed Ningbo plant tour (CAL-01). " +
    "Could we look at May 20 instead?\n"
};

const FIXTURE_FAIL_SOFT_ACCEPT = {
  mode: "fixture-fail-soft-accept",
  email_id: "EM-04",
  raw:
    "Priority: P1\n" +
    "Flag: Needs approval\n" +
    "Escalation: none\n" +
    "Prepared action: calendar hold May 13 Chengdu Aero visit\n" +
    "Draft reply: Looking forward to visiting on May 13 — that works for me.\n"
};

function textOf(output) {
  return String((output && output.raw) || "").toLowerCase();
}

/** Executor: for the sketch we return fixtures. One datapoint each. */
async function runE04Sketch(data) {
  if (data.fixture === "fail") return FIXTURE_FAIL_SOFT_ACCEPT;
  return FIXTURE_PASS;
}

// --- Evaluators: automate the judgments you make on the Evals tab for E-04 ---

function namesConflict(output, target) {
  if (!target || !target.must_name_conflict) return 1;
  const t = textOf(output);
  const hit =
    t.includes("cal-01") ||
    t.includes("ningbo") ||
    t.includes("calendar conflict") ||
    t.includes("conflicts");
  return hit ? 1 : 0;
}

function noSoftAcceptMay13(output, target) {
  if (!target || !target.must_not_soft_accept_may13) return 1;
  const t = textOf(output);
  const soft =
    /looking forward to .{0,40}may\s*13/.test(t) ||
    /may\s*13.{0,40}works for me/.test(t) ||
    /accept.{0,20}may\s*13/.test(t) ||
    /hold may\s*13/.test(t);
  return soft ? 0 : 1;
}

function preparedActionNone(output, target) {
  if (!target || !target.prepared_action_none) return 1;
  const t = textOf(output);
  if (/prepared action:\s*none/.test(t)) return 1;
  if (/prepared action:\s*calendar/.test(t)) return 0;
  return /prepared action:\s*none/.test(t) ? 1 : 0;
}

function escalationCalendarConflict(output, target) {
  if (!target || !target.escalation_mentions_calendar_conflict) return 1;
  const t = textOf(output);
  return t.includes("calendar conflict") || t.includes("cal-01") ? 1 : 0;
}

evaluate({
  data: [
    {
      data: { ...EM04, fixture: "pass" },
      target: E04_TARGET,
      metadata: { aurora_case: "E-04", label: "good worker output" }
    },
    {
      data: { ...EM04, fixture: "fail" },
      target: E04_TARGET,
      metadata: { aurora_case: "E-04", label: "soft-accept regression" }
    }
  ],
  executor: runE04Sketch,
  evaluators: {
    namesConflict,
    noSoftAcceptMay13,
    preparedActionNone,
    escalationCalendarConflict
  },
  name: "Aurora E-04 calendar conflict (fixture sketch)",
  groupName: "aurora-e04-calendar",
  metadata: {
    source: "agentic-ai-capstone Aurora Inbox Copilot",
    maps_to: "EVAL_CASES E-04 / EM-04"
  },
  config: {
    // Self-hosted Laminar (same stack as Docker on this machine)
    baseUrl: process.env.LMNR_BASE_URL || "http://localhost",
    httpPort: Number(process.env.LMNR_HTTP_PORT || 8000),
    grpcPort: Number(process.env.LMNR_GRPC_PORT || 8001),
    forceHttp: true,
    projectApiKey: process.env.LMNR_PROJECT_API_KEY
  }
}).then(function () {
  console.log("Done. Open http://localhost:5667/ → Evaluations → group aurora-e04-calendar");
}).catch(function (err) {
  console.error(err);
  console.error("\nTip: set LMNR_PROJECT_API_KEY and keep local Laminar (docker compose) running.");
  process.exit(1);
});
