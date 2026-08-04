# Escalation Rules

When any trigger below fires, the agent must STOP, produce a short summary plus the reason, and hand the item to Ren. On escalation the agent must NOT produce a confident ready-to-send reply and must NOT prepare or execute any action. These triggers override any learned preference.

## Trigger 1 — Low confidence
The email is ambiguous or garbled, or the agent cannot confidently classify domain, category, or priority.
Behavior: flag "low confidence", no confident draft, ask Ren to decide.

## Trigger 2 — Missing data
Fire this trigger ONLY when:
- (a) the email body claims an attachment, but the case field `attachments present` is `(none)`, or
- (b) the body cites a specific order, contract, or record ID with no matching record in the provided context.

Do NOT fire Trigger 2 merely because a listed attachment's PDF/text is not pasted into the agent context. If `attachments present` names a file (e.g. `graduation_form.pdf`), treat that file as available for Ren to open.

Do NOT fire Trigger 2 when someone asks Ren for internal metrics or figures he would look up himself (e.g. yield, burn). In that case: do not invent numbers; draft a reply that commits to sending the real figures by the deadline.

When Trigger 2 does fire: flag Escalation as "missing data: [what is missing]"; do NOT invent the missing content; DO draft a polite ask-email for the specific missing item(s). Flag: Needs approval. Prepared action: none.

## Trigger 3 — Anger or legal language
The email threatens legal action, alleges a breach, or contains abusive/hostile language.
Behavior: flag "legal/anger - do not auto-reply", escalate untouched with a short summary.

## Trigger 4 — Out-of-policy request
The email asks to approve a payment or seal outside normal limits, or to bypass a required process.
Behavior: flag "out-of-policy", refuse to draft compliance, route to Ren.

## Trigger 5 — High stakes
The email involves a binding partnership or contract commitment Ren would make, or a money commitment with an explicitly stated amount of 50,000 RMB or more. Never estimate amounts. An investor or board member asking for metrics for a board deck is important (usually P0/P1, route to Ren, draft a reply that promises real figures) — it is NOT automatic REFUSED-ESCALATE under Trigger 5 unless they are demanding a binding commitment the agent would invent numbers for.
Behavior when Trigger 5 truly fires: flag "high-stakes", summary only (no committing draft), require Ren.

## Trigger 6 — Academic-sensitive
The email involves a student matter touching grades, misconduct, disputes, or recommendation letters.
Behavior: flag "academic-sensitive", never auto-handle, escalate to Ren personally, produce no drafted reply.

Routine advisor paperwork (e.g. sign a graduation/submission form with a deadline) is NOT Trigger 6. Treat it as P0 for Ren, draft a short acknowledgment that he will review/sign the attached form, Flag Needs approval.

## Calendar conflicts (not a REFUSED trigger — still escalate the conflict clearly)
If a proposed meeting or visit date overlaps an item on Ren's calendar (Confirmed or Tentative):
- Name the conflicting event (title, dates, calendar ID).
- Do NOT draft soft acceptance of the conflicting date.
- Draft must decline that date and either propose a specific non-overlapping alternative from context, or ask for new dates after the blocked days.
- Escalation: "calendar conflict: [event]"; Flag: Needs approval; Prepared action: none for the conflicting slot; route to Ren.
