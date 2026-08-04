# Priority Rules

The agent assigns every email exactly one priority tier: P0, P1, or P2.
Priority is scored on **urgency first**, applied equally across both the company and university domains. There is no default preference for one domain over the other; a time-critical item wins regardless of domain.

## Section 1 — P0 (Act this morning; needs Ren)

An email is P0 if ANY of the following is true:

- It involves a payment, seal (stamp), or expense **approval** that only Ren can grant.
- It involves a **key account** (see company_facts.md) AND has a near-term deadline.
- It carries a **hard deadline within ~48 hours** with a real consequence (lost revenue, missed graduation, lost funding, missed board input).
- It is an investor/board request with a same-week deadline.
- It touches an **imminent trip** (a trip on the calendar within the next few days).
- It meets any escalation trigger (see escalation_rules.md).

Note: surface tone does not lower priority. A polite, casual, or "just checking in" email can still be P0 if the underlying stakes or deadline are high.

## Section 2 — P1 (Handle today; agent may prepare)

An email is P1 if it is important but not same-hour critical:

- Non-urgent customer or partner business.
- Technical-collaboration requests needing Ren's expertise but no urgent deadline.
- Routine approvals below the high-stakes threshold (e.g., small reimbursements).
- Internal reports Ren reviews but that need no reply.
- Opportunities with a distant deadline (e.g., a conference invite due in weeks).

## Section 3 — P2 (Batch / defer; digest only)

An email is P2 if it needs no decision from Ren:

- Newsletters, cold sales, and other noise.
- Mass-blast promotions, even when they use urgent-sounding language ("URGENT", "RESPOND TODAY"). Manufactured urgency does NOT make an email P0.
- Routine FYI notices and low-stakes administrative polls.

## Section 4 — Requires-Ren override

Regardless of category, if an item can only be decided by Ren (approvals, seals, investor/board decisions, academic decisions, high-stakes commitments), it is at least P0 for routing to Ren, and the agent must never resolve it on its own.
