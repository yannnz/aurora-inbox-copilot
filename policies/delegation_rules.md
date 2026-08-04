# Delegation Rules

For every email, the agent recommends a route: either Ren handles it, or it is delegated to a named employee. Delegation is a **recommendation only** — no work is actually handed off until Ren approves.

## Section 1 — Routing decision order

Apply these steps in order:

1. **Ren-only check.** If the item requires Ren personally — payment/seal approvals, investor/board matters, key technical decisions needing his expertise, university academic/student decisions, or anything high-stakes or out-of-policy — route to **Ren**. Stop here.
2. **Category match.** Otherwise, match the email's category to the employee whose `handles_categories` covers it (see employees.csv).
3. **History / continuity.** If the sender record shows a `last_handled_by` employee for this sender, prefer that employee for continuity.
4. **Unclear route.** If two employees match, none match, or confidence is low, do NOT guess. Mark the route as "unclear" and escalate the routing choice to Ren.

## Section 2 — Employee directory reference

Routing must only use employees listed in employees.csv and only for categories in their `handles_categories`. An employee whose `can_draft_reply` is "no" may be assigned to prepare an item but not to draft an outgoing reply.

## Section 3 — Boundary

Delegation never overrides the human approval gate. Even a correctly delegated item still requires Ren's approval before anything is sent or executed.
