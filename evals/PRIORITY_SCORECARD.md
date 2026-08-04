# Priority matrix scorecard (teacher clearance)

Your Discovery metric needs numbers five demo cases cannot produce:
- **P0 recall**
- **3×3 priority confusion matrix** (actual vs predicted)
- **Critical downgrade count** (true P0 labeled P1 or P2)

Use this after **Run All** (or run each of EM-01…EM-16 once). Score **yourself** against `evals/answer_key.csv`. Never paste the answer key into the agent.

## How to run

1. Open `http://localhost:8787/` (proxy running).
2. Work tab → **Run All** (or run EM-01 through EM-16).
3. For each email, write the agent’s **Priority** into `priority_scorecard.csv` column `actual_priority`.
4. Open the **Priority matrix** tab in the app (or `http://localhost:8787/#matrix`), enter/sync Actuals, click **Compute**.
5. Paste the matrix + P0 recall into your Develop PRD / reply to your teacher.

## Collision / judgment cases (from answer key `label_source=human_judgment`)

These are the ones rules do not fully settle — call them out in your write-up:

| Email | Expected | Why it is a collision |
|-------|----------|------------------------|
| EM-01 | P0 | Friendly tone vs key-account + Friday deadline |
| EM-04 | P0 | Visit invite vs Ningbo calendar clash |
| EM-07 | P0 | “Admin form” vs 24h graduation cliff |
| EM-08 | P2 | Manufactured “URGENT” marketing (must not become P0) |
| EM-09 | P1 | Investor board metrics — important, not same-hour P0 |

## Formulas

- **P0 recall** = (true P0 correctly predicted P0) / (all true P0)  
  True P0s in the key: EM-01…EM-07 → **7** total.
- **Critical downgrades** = true P0 predicted as P1 or P2 (target: **0**).
- **Confusion matrix** rows = expected (answer key), columns = agent actual.
