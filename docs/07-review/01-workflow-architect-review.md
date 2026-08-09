# Pre-Development Review — Workflow Architect Pass

**Status:** Resolved · **Version:** 0.3 · **Date:** 2026-08-09 · **Reviewer:** Workflow Architect
**Subject:** The full `docs/` set (70 documents, ~25,600 lines) at commit state of 2026-08-09
**Purpose:** Find every contradiction, gap, unspecified branch, orphaned resource, and untracked assumption **before** the first migration is written.

---

## Resolution status

**All 21 findings are fixed, and all three deferred suggestions have been decided and applied.** This review is kept as the record of what was wrong and why, because the reasoning behind several fixes is not obvious from the corrected text alone — and because three of these defects were introduced by a *previous* correction that only landed in one of the two documents that needed it.

| # | Finding | Status | Where the fix lives |
|---|---|---|---|
| B-1 | Brute-force counter rolled back by its own `RAISE` | **Fixed** | SPEC-010 R49a, R49b, §6 `confirm_handoff` rewritten to return rather than raise; T35, T35a–c |
| B-2 | `scheduled`/`scheduling` → `disputed` missing | **Fixed** | Arch §3, §6 (13 edges), §8 generated tables; SPEC-010 R67, §6.2, T49 |
| B-3 | `listings_single_reservation` no-op variant | **Fixed** | SPEC-010 R71; Data Model §10 comment; THR-26 |
| B-4 | Disputed sessions orphan their reservation | **Fixed** | Arch §3.2 (new); SPEC-010 R68a–d; SPEC-012 §5.7; SPEC-900 R39–R41 |
| H-1 | `p_idempotency_key` never read | **Fixed** | Arch §4.1 (new helpers + table); SPEC-010 R80, R80a; T60, T60a–b |
| H-2 | Handoff code returned at acceptance | **Fixed** | Arch §3.1, §4 return type; SPEC-010 R30, R45; API Contract §4.7, §5.4 |
| H-3 | Generator won't compile; 6.25% biased | **Fixed** | Arch §4 rejection sampling; SPEC-010 R30a; T24, T24a |
| H-4 | Version guard defeats the H4 statement | **Fixed** | Arch §5 H5; SPEC-010 R42a, R75; T54, T55 |
| H-5 | Dependency cycles and build-order conflict | **Fixed** | All 18 specs split into `Schema depends on` / `Behaviourally coupled with`; README build order regenerated — **verified acyclic** |
| H-6 | Five rate limits in prose only | **Fixed** | SPEC-010 R63a, R63b; arch §4 `consume_token`; T29a |
| M-1…M-8 | Counts, taxonomy, window, buffer, invariants | **Fixed** | See each document's change log |
| P-1 | 18 specs `Approved` with nothing verified | **Fixed** | All downgraded to `Review`; entry gate in Doc Conventions §6.1; CI gate in CI/CD §5.1 |
| P-2 | No drift detection | **Fixed** | `docs/workflows/REGISTRY.md` + generated-artefact gates in CI/CD §5.1 |
| P-3 | `T-##` / `T##` namespace collision | **Fixed** | Threats renamed `THR-##` across 8 documents; Doc Conventions §3 |
| S-1…S-4 | Suggestions not needing a decision | **Applied** | Idempotent `finalize_completed_session` (R68b), Cleanup Inventory in the spec template, orphan/SLA alerting (R68c–d), lock-order sampling |
| S-5 | Handoff code at rest | **Applied — decided 2026-08-09** | **Encrypted, not hashed.** The original suggestion was under-thought: hashing is one-way, and both parties must be able to *read* the code at the meeting, possibly days later on a reinstalled app. A hash makes it displayable once and lost forever. Vault-keyed `pgp_sym_encrypt`, single audited decrypt path (`rpc.get_handoff_code`), `SELECT` revoked from `authenticated`, key rotation as [Runbook 14](../05-operations/05-runbooks.md). THR-27b |
| S-6 | Contestable no-show marker | **Applied — decided 2026-08-09** | One tap, no free text. Clears attribution, leaves the session terminal, records a trust signal rather than hard-clearing. SPEC-010 R64a–d, EC-22a–b, T48a–b |
| S-7 | SPEC-010 Q7, completion model | **Closed — decided 2026-08-09** | Dual confirmation ships. `dual_with_fallback` is written, tested and disabled so the reversal is a config change rather than a schema change under time pressure; `single` needs an ADR because it deletes US-10. Switching threshold committed in advance: SPEC-010 §5.10, R87–R91 |

**Still open and deliberately so:** the 21 `Before launch` open questions. They are decisions, not defects — but the new CI gate means no spec can reach `Approved` while one is outstanding, which is the point.

**What this review does not cover** — the things that are not wrong but will still cost someone a day — is [Development Notes](02-development-notes.md), organised by when each one bites rather than by topic.

---

## 0. Verdict

This is an unusually good spec set. The lock ordering is explicit, the concurrency hazards are enumerated rather than hand-waved, the transition tables are data rather than code, the privacy invariant is stated as an invariant, and the risk register is honest enough to say "the plan contains roughly 18 weeks of engineering and approximately zero weeks of supply seeding." Most spec sets this size do not survive a branch-by-branch read. This one mostly does.

It does not survive it entirely. The defects below are concentrated exactly where the docs themselves say the danger is — the exchange critical section — and several of them are the kind that pass code review and fail in production at 2am.

**Four findings block development.** They are not stylistic. Three of them mean a test named in the spec cannot pass against the implementation the spec describes, and one means a documented security control does not exist at runtime.

| Severity | Count | Meaning |
|---|---|---|
| **Blocker** | 4 | Fix the spec before the migration is written |
| **High** | 6 | Fix before the affected spec is implemented |
| **Medium** | 8 | Fix during implementation; each is a latent bug or a test that will confuse |
| **Process** | 3 | Change how the doc set is governed, not what it says |

**Coverage note.** Read in full: `07-exchange-state-machine.md`, `SPEC-010`, `03-data-model.md` §10, `05-rls-design.md` §3, `08-realtime-and-notifications.md` §5, `02-open-risks.md`, `03-specs/README.md`. Read structurally (headings, tables, cross-references, front matter) across all 70 documents. Findings below carry file and line references and were each re-verified against source text. Depth is uneven by design — the exchange path got the most attention because it is where a bug puts a person in a car park.

---

## 1. Blockers

### B-1 — The handoff brute-force counter never increments

**Where:** `SPEC-010-exchange-lifecycle.md` §6, `confirm_handoff`, lines 330–343
**Contradicts:** R49, T35, T71, `02-security/01-threat-model.md`
**Severity: Blocker** — a documented security control that does not exist at runtime

The wrong-code branch does this:

```sql
IF NOT app.digest_equals(v_s.handoff_code, p_code) THEN
  UPDATE public.exchange_sessions
     SET handoff_attempts = handoff_attempts + 1,
         handoff_locked_until = CASE WHEN handoff_attempts + 1 >= 5
                                     THEN now() + interval '15 minutes' END
   WHERE id = p_session_id;
  IF v_s.handoff_attempts + 1 >= 5 THEN
    PERFORM app.enqueue_notification(...);   -- both parties
  END IF;
  RAISE EXCEPTION 'validation_failed' USING ERRCODE = '22023';
END IF;
```

`RAISE EXCEPTION` in PL/pgSQL with no enclosing `EXCEPTION` block aborts the transaction. **The `UPDATE`, the lockout timestamp, and both `safety_alert` outbox rows are all rolled back.** `handoff_attempts` is permanently 0, `handoff_locked_until` is permanently NULL, and neither party is ever notified.

The consequence is not academic. R49's lockout is the entire bound on brute-forcing a six-digit code, and §9's risk arithmetic ("10⁶ codes against 5 attempts per 15 minutes per session is ~2 × 10⁻⁵ per lockout window") assumes it works. Without it an attacker gets unlimited attempts at 10⁶ codes with no notification to the victim. T35 ("Five wrong codes lock the session for 15 minutes … enqueue a `safety_alert` for both parties") and T71 ("10,000 attempts across 50 sessions → total successful guesses: 0") both fail.

**Fix.** State-changing side effects cannot share a transaction with a `RAISE`. Pick one:

- **Return a result, don't raise.** Change `confirm_handoff` to return `(ok boolean, reason text, attempts_remaining smallint, …)` and let the caller map `ok = false` to an HTTP status. The transaction commits, the counter sticks. This is the cleanest option and it also fixes the "attempts remaining" live region the accessibility section already promises (§12).
- **Move the counter out of the transaction.** Use the `private.rate_buckets` / `app.consume_token` mechanism the spec already lists in §6's data table and §9's definer-function list but never actually calls here — consumed *before* the comparison, so the token is spent whether or not the code matches.

The second option is arguably what the spec intended, since `private.rate_buckets` is listed under §6 as written-to by R49. Reconcile the two.

**Also fix while you are in there:** `handoff_attempts` on a *successful* comparison is reset to 0 in the same `UPDATE` that completes the session. That is correct, but it means R49's stated window ("within 15 minutes") is not what the code implements — see M-3.

---

### B-2 — A report against a `scheduled` session cannot freeze it

**Where:** R67 (line 171) and T49 (line 1064) vs `private.legal_session_transitions` in `07-exchange-state-machine.md` §6 (lines 332–336) and `SPEC-010` §6.2 (lines 429–441)
**Severity: Blocker** — a named test cannot pass; a safety path is unreachable

R67 says:

> A report filed against a session that is **non-terminal**, or that completed within the last 72 hours, MUST freeze it to `disputed`.

Non-terminal session states are `scheduling`, `scheduled`, and `in_progress`. The legal-transition table contains exactly two edges into `disputed`:

```sql
('in_progress','disputed'),
('completed','disputed');
```

`trg_guard_session_transition` is a `BEFORE UPDATE` trigger on the table, so it rejects `scheduled → disputed` and `scheduling → disputed` **regardless of role** — including from `moderation-action` running as `service_role`, which is precisely the property EC-20 celebrates.

T49 tests the broken case explicitly: *"A report against a `scheduled`, `in_progress`, and 71-hour-old `completed` session each freezes it to `disputed`."* That test fails against the migration in §6.

This matters more than a missing enum row. The window between `scheduled` and `in_progress` is the window in which someone has a confirmed time and place with a person they have become afraid of, and has not yet met them. It is the single most important moment to be able to freeze an exchange. Right now it is the one state from which you cannot.

**Fix.** Add both edges to `private.legal_session_transitions` in `07-exchange-state-machine.md` §6 (the normative source) and to `SPEC-010` §6.2:

```sql
('scheduling','disputed'), ('scheduled','disputed'),
```

Then the legal-edge count becomes 11 and T59's arithmetic becomes "the 11 legal ones succeed, the other 38 raise." Update both. The generated `LEGAL_SESSION_TRANSITIONS` in §8 of the architecture doc needs the same two entries or R81's compile-time drift check will fail on the first regeneration.

**Then answer the question this exposes:** a session frozen from `scheduling` has no `safe_spot_id` and no `scheduled_start`. What does the §8.3 hold copy say when there is no time and place to hold? Currently undefined.

---

### B-3 — `listings_single_reservation` is defined two different ways, and SPEC-010 has the broken one

**Where:** `SPEC-010` R71 (line 182) vs `07-exchange-state-machine.md` §5 H1 (line 249) and `03-data-model.md` §10 (lines 437–439)
**Severity: Blocker** — the backstop for the highest-consequence race is a no-op in the spec engineers will implement from

Three documents, two definitions:

| Document | Definition |
|---|---|
| `03-data-model.md` line 438 | `ON public.listings (reserved_request_id) WHERE reserved_request_id IS NOT NULL` ✅ |
| `07-exchange-state-machine.md` line 249 | Same as above ✅ — and explicitly calls the other version out as wrong |
| `SPEC-010` R71 line 182 | `ON listings (id) WHERE status = 'reserved'` ❌ |

The architecture document already diagnosed this, in a parenthesis that reads like it was written after someone caught it:

> *An earlier draft indexed `(id) WHERE status = 'reserved'`, which is a no-op because `id` is already the primary key — a reminder that a "backstop" constraint nobody tested is not a backstop.*

The earlier draft survived into R71. `SPEC-010` §2 states its own precedence rule — *"where it would contradict, the architecture document wins and this spec is wrong"* — so the resolution is not in doubt. But R71 is what an engineer implementing the exchange reads, and R71 is wrong.

The concrete failure: T30's second half repeats the 50-acceptor race *"with the in-lock status assertion stubbed out to prove `listings_single_reservation` alone still holds the line."* With the `(id)` variant, nothing holds the line — every acceptor succeeds, and the test's whole purpose evaporates.

**Fix.** Correct R71 to the `reserved_request_id` form. Then add the missing companion invariant — see M-5.

---

### B-4 — A disputed session orphans its listing and its inventory item forever

**Where:** `SPEC-010` R67/R68 (lines 171–172), EC-19 (line 955); `SPEC-012` §5 (no covering requirement)
**Severity: Blocker** — unbounded resource leak with no owner, on the safety path

Every other terminal session state has a release path:

| Terminal state | Listing | Inventory item | Released by |
|---|---|---|---|
| `completed` | → `completed` | → `exchanged` | `app.finalize_completed_session` (R50) |
| `cancelled` | → `active` | → `listed` | `cancel_session` (R59) |
| `no_show` | → `active` | → `listed` | `app.release_reservation` (§6, line 402) |
| **`disputed`** | **stays `reserved`** | **stays `reserved`** | **nothing** |

`in_progress → disputed` leaves `listings.status = 'reserved'` with `reserved_request_id` set and `inventory_items.status = 'reserved'`. `app.expire_due_listings` explicitly skips `reserved` rows (R78/H8 — correctly, for a different reason). `detect_no_shows` only selects `scheduled`/`in_progress`, so it never revisits the row. `listings_one_active_per_item` covers `('draft','active','reserved')`, so **the owner can never list that item again.**

R68 says resolution is a moderator action through `moderation-action`. `SPEC-012` §5 has no requirement that says what `moderation-action` does to the reservation, `SPEC-900` has none either, and the `disputed` row is terminal in the transition table, so a moderator cannot even move it to `cancelled`.

The honest framing: a disputed exchange is exactly the case where the owner most needs their produce back in circulation and least wants a stuck row reminding them of it.

**Fix.** Three decisions to make, in this order:

1. **Does resolution release the reservation?** Almost certainly yes for `in_progress → disputed` (the goods may or may not have moved; the listing should not stay frozen for weeks) and no for `completed → disputed` (already released as part of completion).
2. **What state does a resolved dispute land in?** Options: stay `disputed` and release the reservation as a side effect; or add `disputed → cancelled` and `disputed → completed` as moderator-only edges. The second is more honest but requires the guard trigger to distinguish moderator writes, which it deliberately does not do today.
3. **Who owns the requirement?** It spans `SPEC-010` (the states), `SPEC-012` (the resolution action), and `SPEC-900` (the console affordance). Put the normative statement in `07-exchange-state-machine.md` and cite it from all three.

**Then add a guard against the general case:** an alert on `listings` in `reserved` whose session is terminal, or older than 21 days (the listing `expires_at` cap). Any occurrence is an orphan. There is currently no metric for this — `§11` has `exchange.double_reservation` for two reservations and nothing for one that never ends.

---

## 2. High

### H-1 — `p_idempotency_key` is a parameter that nothing reads

**Where:** `07-exchange-state-machine.md` §4 (lines 104–128) vs `SPEC-010` R80 (line 191), T60 (line 1075)

`accept_exchange_request(p_request_id uuid, p_idempotency_key uuid)` declares the key and never references it again. Idempotency is achieved by probing `exchange_sessions` on `(request_id, owner_id)`, which is a perfectly good mechanism — but it is not key-based, and R80 requires something key-based:

> Every mutating RPC in this spec MUST take `p_idempotency_key uuid`, MUST return the original result on replay, and **MUST raise `idempotency_conflict` 409 when the same key arrives with different arguments.**

You cannot detect "same key, different arguments" without persisting the key alongside the arguments it was first used with. Nothing in the §6 migration adds an idempotency column to `exchange_sessions` or `exchange_requests` (`exchange_requests_idem` on `(requester_id, idempotency_key)` exists for *create*, per R73 — but not for accept). T60 asserts this for **all eight** RPCs and will fail for accept, decline, withdraw, propose, confirm, cancel, and confirm_handoff.

Note also that EC-02 and T77 describe two different behaviours for the same scenario: EC-02 says different keys on the same request hit `request_not_pending`; T77 agrees. Neither produces `idempotency_conflict`. So R80's second clause is not just unimplemented — it is contradicted by the spec's own edge cases.

**Fix.** Either (a) add a shared `private.idempotency_keys (user_id, key, rpc_name, args_hash, result jsonb, created_at)` table with a helper `app.idempotent_call()` that all eight RPCs route through, and make the arch §4 body call it; or (b) weaken R80 to "MUST return the original result on replay" and delete the `idempotency_conflict` clause and its test. Option (b) is defensible — the probe-based approach genuinely is idempotent — but then `idempotency_conflict` must come out of the error taxonomy too.

---

### H-2 — The handoff code is returned at acceptance and also must not exist until `scheduled`

**Where:** `07-exchange-state-machine.md` §3.1 (line 86) and §4 (line 107) vs `SPEC-010` R30 (line 114), R45 (line 139), T73 (line 1093)

Three statements that cannot all be true:

| Source | Claim |
|---|---|
| Arch §3.1 line 86 | "At acceptance the system generates one six-digit code and **shows it to both parties**." |
| Arch §3.1 line 95 | "not displayed until the session is `scheduled`" |
| Arch §4 line 107 | `accept_exchange_request(...) RETURNS TABLE (session_id uuid, handoff_code char(6))` |
| SPEC-010 R30 | "MUST NOT be exposed until the session reaches `scheduled` (R45)." |
| SPEC-010 T73 | "Read `handoff_code` for a session in `scheduling` … → Empty result." |

The accept RPC hands the code to the owner the instant the session is created — in `scheduling`, hours or days before `scheduled`. The §3.1 sentences contradict each other four lines apart.

**And a real gap underneath it:** if the code is not returned from `accept`, and the `request_accepted` notification payload carries only `{session_id}` (arch §4 line 222; catalog row in `08-realtime-and-notifications.md` §5), **there is no specified path by which the requester ever learns the code.** R45 says it is "fetched by an explicit `GET ?select=handoff_code` from the handoff screen" — fine, but nothing in the spec says the *owner* uses the same path, and the accept RPC's return type says they do not.

**Fix.** Drop `handoff_code` from `accept_exchange_request`'s `RETURNS TABLE` (returning `session_id` alone), delete the "shows it to both parties" sentence at arch §3.1 line 86, and state once, normatively, that both parties obtain the code by the same gated single-column select at `state = 'scheduled'`. Then R24's idempotency probe returns `session_id` only, which is also simpler.

---

### H-3 — The handoff-code generator will not compile, and is biased

**Where:** `07-exchange-state-machine.md` §4 lines 181–183; `SPEC-010` T24 (line 1039)

```sql
v_code := lpad((get_byte(gen_random_bytes(3),0) * 65536
              + get_byte(gen_random_bytes(3),1) * 256
              + get_byte(gen_random_bytes(3),2)) % 1000000, 6, '0');
```

Three defects in one expression:

1. **Type error.** Postgres has `lpad(text, integer, text)`. The first argument here is `integer`, and Postgres will not implicitly cast `integer → text` during function resolution. This raises `function lpad(integer, integer, unknown) does not exist` at first call. Needs `::text`.
2. **Three separate calls to `gen_random_bytes(3)`.** Each returns a *different* random value; the expression takes byte 0 of the first, byte 1 of the second, byte 2 of the third. It works, but it burns three CSPRNG calls where one was intended and reads like a bug even though it isn't. Use one call into a variable.
3. **Modulo bias.** The maximum is 2²⁴ − 1 = 16,777,215. `16,777,216 mod 1,000,000 = 777,216`, so codes `000000`–`777215` are drawn with probability 17/16,777,216 and `777216`–`999999` with 16/16,777,216 — about **6.25% more likely** for the low 78% of the range. T24 asserts *"a uniform distribution over 100k generations."* Depending on how the test bins, it either fails or — worse — passes because the bias is under the noise floor, and the spec then claims a uniformity property it does not have.

**Fix.** Rejection sampling, one CSPRNG call per attempt:

```sql
LOOP
  v_n := ('x' || encode(gen_random_bytes(3), 'hex'))::bit(24)::int;
  EXIT WHEN v_n < 16000000;   -- 16 000 000 = 16 × 10⁶, exactly divisible
END LOOP;
v_code := lpad((v_n % 1000000)::text, 6, '0');
```

Expected iterations: 1.05. Restate T24 as "uniform to within χ² at p=0.01 over 10⁶ generations" so the test can actually detect a 6% skew.

---

### H-4 — H4's atomic statement is defeated by H5's version check

**Where:** `SPEC-010` §6 `confirm_handoff` lines 312–359; R74 (line 185) vs R42/R75 (lines 131, 186); T54 (line 1069); EC-07 (line 943)

`confirm_handoff` does, in order:

```sql
SELECT * INTO v_s FROM exchange_sessions WHERE id = p_session_id FOR UPDATE;   -- blocks
...
IF v_s.version <> p_expected_version THEN RAISE EXCEPTION 'stale_state'; END IF;
...
UPDATE ... SET version = version + 1 ...   -- the H4 atomic statement
```

Two parties confirming simultaneously both read `version = N` before either commits. The first acquires the row lock, commits, `version = N+1`. The second's `FOR UPDATE` unblocks and — under `READ COMMITTED`, which re-reads the latest committed row version after a lock wait — sees `version = N+1` while holding `p_expected_version = N`. It raises **`stale_state`**, not `completed`.

So the elaborate `CASE`-based single-statement update, which is described as *"the single most delicate statement in the codebase"* and exists specifically to make simultaneous confirmation work, never executes on the second caller. It is dead code for the exact case it was written for.

EC-07 asserts the opposite: *"Whichever commits second sees the first's timestamp and produces `completed`."* T54 asserts *"200 paired simultaneous `confirm_handoff` calls: every session reaches `completed` exactly once … no session is stranded at one confirmation."* Both fail.

The user-visible outcome is recoverable — R83 has the client refetch and replay — but it is a spurious round-trip at the single worst moment in the product: two people standing in a library lobby with one bar of signal, watching a spinner turn into an error.

**Fix.** Optimistic-concurrency version checks and the H4 pattern are solving the same problem two incompatible ways. Exempt `confirm_handoff` from R42:

> `p_expected_version` is advisory on `confirm_handoff` and MUST NOT reject a mutation. The H4 statement's `WHERE state IN ('scheduled','in_progress')` predicate is the concurrency control for this RPC; the version is returned for the client's cache and is not a guard.

Keep the strict version check on `propose_schedule`, `confirm_schedule`, and `cancel_session`, where a stale client genuinely is sending a decision based on a screen that has moved. A handoff confirmation is not a decision about state — it is a claim that a person is standing there, and it is true regardless of what version the client thinks it holds.

Update R42, R74, R75, EC-07, T54, and T55 together.

---

### H-5 — The spec dependency graph has cycles and disagrees with the build order

**Where:** front matter of every `SPEC-*.md`; `03-specs/README.md` §Build order (lines 58–86)

Every spec declares `Depends on` and `Depended on by`. Cross-referencing all 18 produces cycles and asymmetries:

**Cycles:**

| Cycle | Evidence |
|---|---|
| 001 ↔ 002 | 001 "depended on by 002"; 002 "depended on by 001 (R32, R36, R44 cite R18)" |
| 002 ↔ 003 | 003 "depended on by 002"; 002 "depended on by 003 (recovery re-verification)" |
| 010 → 011 → 012 → 010 | 011 depends on 010 and 012; 012 depends on 010 and 011 |
| 010 ↔ 013 | 010 "depended on by 013"; 013 "depended on by … SPEC-010" |
| 007 → 900 → 012 → 010 → 007 | 007 "depends on SPEC-001, **SPEC-900**"; 900 depends on 012; 012 depends on 010; 010 depends on 007 |

**Asymmetries** (X claims Y depends on it; Y does not agree):

| Claimed by | About | Y's actual `Depends on` |
|---|---|---|
| 008 → "depended on by 009" | SPEC-009 | 006, 007 |
| 012 → "depended on by 009" | SPEC-009 | 006, 007 |
| 013 → "depended on by 004, 009, 010" | SPEC-004 | 001, 003 |

**Build order contradicts the front matter in two places:**

- README line 83: *"SPEC-005 (taxonomy) and SPEC-007 (safe spots) … depend on nothing. Start them on day one."* But SPEC-007's front matter says `Depends on: SPEC-001, SPEC-900`. Both cannot be true. (SPEC-900 is the moderation console — presumably SPEC-007 needs its curation affordance, which is a real dependency and a real problem for the "day one" plan.)
- The mermaid graph has `S010 → S011 → S013`, but SPEC-011 declares `Depends on: SPEC-010, SPEC-012, SPEC-013`. Messaging is scheduled before the two things it depends on.

Separately, the mermaid arrow `S002[002 2FA] -.optional.-> S001` points from 2FA to Auth, which reads as "2FA is a prerequisite of Auth" — the reverse of the intent.

**Why this matters now.** These cycles are mostly *documentation* cycles, not real ones — the actual base schema and helpers (`app.is_blocked_either_way`, `public.blocks`, `public.reports`, the notification tables) all live in `03-data-model.md` and `05-rls-design.md`, which land before any feature migration. But nobody can tell that from the front matter, and the first engineer to try to topologically sort 18 specs will conclude the plan is unbuildable.

**Fix.** Distinguish two relations and say which is which:

- **`Schema depends on`** — needs tables/functions another spec's migration creates. This must be acyclic and it must drive the build order.
- **`Behaviourally coupled with`** — calls into or is called by, at runtime. This may cycle freely and says nothing about ordering.

Then regenerate the README mermaid from the first relation only, mechanically, and add a CI check that the front matter is symmetric and the schema graph is a DAG. Resolve SPEC-007 ← SPEC-900 explicitly: either extract the curation console into an earlier slice or admit SPEC-007 is not a day-one item.

---

### H-6 — Five rate limits exist only in prose, with no requirement and no test

**Where:** `SPEC-010` §9 line 931; §5 has no covering requirement

§9's abuse-controls cell states:

> `accept_exchange_request` **30/hour**. `decline` / `withdraw` **60/hour**. `propose_schedule` / `confirm_schedule` **30/hour**.

None of these appears as a numbered `MUST`. `03-specs/README.md` §Traceability says *"Every `MUST` requirement in every spec maps to at least one test ID"* and CI enforces it — but the reverse is not enforced, so a limit stated only in a prose cell gets neither a requirement number nor a test. R13 (create, 10/h), R49 (handoff, 5/15min/session), and R63 (cancel, 20/day) are all properly numbered. These five are not.

**Compounding it:** the normative body of `accept_exchange_request` in `07-exchange-state-machine.md` §4 never calls `app.consume_token`, and R23 says the function *"MUST NOT diverge"* from that body. So the 30/hour accept limit is not merely untested — implementing it would violate R23.

**Fix.** Promote all five to numbered requirements in §5.8 with test IDs, and add the `app.consume_token` call to the arch §4 body (immediately after the authorization block, before the locks — a rate-limit check that queues behind a lock is a rate-limit check that amplifies the load it is meant to shed).

---

## 3. Medium

| # | Finding | Where | Fix |
|---|---|---|---|
| **M-1** | **36 vs 49.** Arch §6 line 355: *"That is 6 × 6 = 36 assertions."* There are **seven** `session_state` values (`03-data-model.md` line 96), so it is 7 × 7 = 49 — which is what `SPEC-010` R79 and T59 correctly say. | `07-exchange-state-machine.md:355` | Correct to 49. After B-2 adds two edges, T59's split becomes 11 legal / 38 illegal. |
| **M-2** | **The error taxonomy is incomplete and miscounted.** Arch §9 lists 11 codes and `SPEC-010` §2 promises *"eleven stable error codes."* SPEC-010 additionally uses `validation_failed` (400), `conflict` (409), `quota_exceeded` (422), `idempotency_conflict` (409), and `server_error` — 16 in total. Worse, a wrong handoff code and an out-of-window handoff both return bare `validation_failed`, so the client cannot render the two different strings §8.3 requires without parsing prose. | `07-exchange-state-machine.md:404–416`; `SPEC-010:30` | Add the five missing codes to arch §9. Split `validation_failed` on the handoff path into `handoff_code_invalid` and `handoff_window_closed`. Change "eleven" to a reference rather than a count — a number in prose is a number that goes stale. |
| **M-3** | **Three descriptions of one lockout.** R49: *"5 wrong code attempts on one session **within 15 minutes**."* The §6 implementation: a counter reset only on success — i.e. **lifetime**, not windowed. EC-16: *"5 attempts within one rolling counter reset on success."* Only EC-16 matches the code. | `SPEC-010:143, 330–343, 952` | Decide: lifetime counter (simpler, stricter, and means a legitimately fumbling pair gets locked out permanently) or a real 15-minute window (needs `handoff_first_attempt_at` or the rate-bucket approach from B-1). Then make R49, the SQL, and EC-16 say the same thing. |
| **M-4** | **`detect_no_shows` races `confirm_handoff` at the exact boundary.** R46 accepts a confirmation until `scheduled_end + 2h`; R64 sweeps sessions where `scheduled_end < now() - 2h`. They meet at precisely the same instant. A user confirming at +2h can find the cron already holding the row (`FOR UPDATE SKIP LOCKED` protects the cron, not the user), then fail with `invalid_transition` on a `no_show` row. | `SPEC-010:140, 168` | Give the cron a buffer: `scheduled_end < now() - interval '2 hours 15 minutes'`. A no-show detected 15 minutes late costs nothing; a confirmation rejected because a cron won a millisecond costs a real completed exchange. Add a boundary case to T47. |
| **M-5** | **No invariant ties `status = 'reserved'` to `reserved_request_id`.** `03-data-model.md` §10 defines both columns and the unique index on `reserved_request_id`, but nothing asserts they move together. R59 (cancel) and `app.release_reservation` (no-show) both say "return the listing to `active`" and neither says **clear `reserved_request_id`**. A listing left `active` with a stale `reserved_request_id` is silently wrong and will confuse the next reader of the row. | `03-data-model.md:418–440`; `SPEC-010:158` | Add `CHECK ((status = 'reserved') = (reserved_request_id IS NOT NULL))`, and make R59 and `app.release_reservation` explicitly null the column. Add to T43. |
| **M-6** | **`scheduled_end` has no origin.** R38 constrains it, `sessions_window_length` enforces it, R64 sweeps on it, and the `scheduling → scheduled` guard in arch §3 lists only `scheduled_start` (*"`scheduled_start` ≥ now() + 1h and ≤ now() + 14d"*). Nothing says whether `propose_schedule` takes an end time, derives one from a fixed slot length, or defaults it. | `07-exchange-state-machine.md:77`; `SPEC-010:127` | Add `scheduled_end` to the arch §3 guard row and state whether `p_end` is a parameter of `propose_schedule` or derived. `SPEC-010` §7.4's signature should settle it — make the arch table agree. |
| **M-7** | **Acceptance never re-checks the requester's standing.** `accept_exchange_request` checks `app.can_transact(v_uid)` — the *owner* — and `is_blocked_either_way`. It does not check that the **requester** can still transact. R19 says a suspension moves the request `pending → cancelled`, so the window is narrow, but it depends on the suspension fanout having already run. An owner accepting a request from someone suspended thirty seconds ago creates a session with a party who cannot act in it. | `07-exchange-state-machine.md:151–159`; `SPEC-010:110` | Add `IF NOT app.can_transact(v_req.requester_id) THEN RAISE EXCEPTION 'request_not_pending'` inside the lock — deliberately reusing the existing code rather than a new one, since the owner must not learn that the requester was suspended. Extend R26 and T21. |
| **M-8** | **"All 11 notification kinds"** — the enum has 11 values (`03-data-model.md:103`) but one, `surplus_alert`, is Phase 2 and gated behind SPEC-020. An MVP test that iterates 11 kinds will look for a template that does not exist, which is exactly the failure SPEC-013 R12 is designed to produce. | `SPEC-010:1046`; `08-realtime-and-notifications.md:456–470` | Say "every MVP `notification_kind`" and have the test derive the list from the templates table filtered by phase, not from the enum. |

---

## 4. Process findings

### P-1 — Eighteen specs are "Approved" and none has met the bar for approval

All 18 specs, including three Phase 2/3 specs, carry `Status: Approved`. Zero lines of code exist.

`06-doc-conventions.md` §6 defines a status lifecycle, and the workflow-architect method this review follows has an explicit rule: *never mark a spec Approved without a Reality Checker pass* — a verification against the actual implementation. That pass is not merely undone here; it is currently impossible.

More concretely, **21 open questions across the specs are marked "Needed by: Before launch"** and all 21 are open, spread across SPEC-005, 006, 007, 008, 010, 011, 012, 013, 022, 023, and 900. Several are not detail questions:

- `SPEC-010` Q3 / `SPEC-012` Q6 / arch Q2 — three documents asking the same unresolved question about whether a no-show files a report. Two paths to one fact, with nothing deciding which defers.
- `SPEC-012` Q3 — whether the report picker has an "Other" bucket, which `PRD C12` says it does and R21 says it does not. **That is a live contradiction between the PRD and a spec, parked as a question.**
- `SPEC-023` Q2 — whether the food-safety disclosure is mandatory, with Legal listed as a co-owner.
- `SPEC-012` Q7 — whether the `trusted` tier ships at all.

There are 109 open-question rows across the specs and 27 more in architecture and security: 136 open questions in an "Approved" doc set.

**Fix.** Add an explicit gate. `Approved` should mean *"reviewed, contradictions resolved, no Before-launch open question outstanding, and verified against the implementation."* Until code exists, the honest status for all 18 is **`Review`**. Then add a CI check: a spec cannot hold `Approved` while any of its open questions has `Needed by: Before launch`. That one rule would have caught most of what is in this section without a human reading anything.

### P-2 — There is no mechanism to detect spec-vs-code drift

The doc set has one genuinely excellent anti-drift device: R81's build-time generation of `LEGAL_SESSION_TRANSITIONS` from `private.legal_session_transitions`, which makes a client/server divergence a compile error. That is the right pattern and it is used exactly once.

Everything else relies on human diligence: lock ordering "is a code-review obligation, not a runtime one" (R25); the `MUST`-to-test mapping is enforced but the test-to-behaviour mapping is not; and there is no artefact that lists which workflows exist, which have specs, and when each was last checked against the code.

Findings B-1, B-3, and H-1 in this review are all instances of the same failure mode: **a document said a control existed, and nothing checked.** Every one of them would have been caught by a registry entry with a "last verified against code" date, or by a test that ran.

**Fix.** Adopt the registry (delivered alongside this review at `docs/workflows/REGISTRY.md`) and add a `Last verified` column that CI marks stale after 30 days. Extend the R81 generation pattern wherever a fact lives in two places: the notification catalog vs `private.notification_templates`, the error taxonomy vs `domain/errors/classify.ts`, the rate-limit table vs the `app.consume_token` call sites.

### P-3 — Test IDs are cited across documents but not owned anywhere

`SPEC-010` T30 is cited by name from `07-exchange-state-machine.md` §5 H1, `SPEC-009` EC-15, and `02-security/01-threat-model.md` THR-26. SPEC-010 §13.1 handles this well — it pins T30 with a note explaining why its number is stable. But that discipline is applied to exactly one test, and nothing prevents T31–T92 from being renumbered by an insertion.

Meanwhile `01-threat-model.md` uses `THR-26` for a *threat* and `SPEC-010` uses `T30` for a *test*. Two `T` namespaces, one hyphen apart, both cross-referenced.

**Fix.** Rename threat IDs to `THR-##`. Make every cross-document test citation a stable ID (`SPEC-010-T30`), never a bare `T30`, and add a link-checker to CI that fails on a citation with no matching row.

---

## 5. Suggestions (not defects)

1. **Hash the handoff code at rest.** `handoff_code char(6)` is stored plaintext, and the spec goes to heroic lengths to keep it out of the publication, the push body, the select list, MMKV, logs, and Sentry (R51). Storing `digest(code || session_id, 'sha256')` and comparing hashes would make most of that enforcement unnecessary rather than merely thorough — a database read no longer discloses it. The tradeoff is that the code must be returned exactly once, at generation, which H-2 already requires you to redesign. Worth doing at the same time.

2. **`app.finalize_completed_session` needs its own contract.** It is invoked from inside the most delicate statement in the codebase (§6 line 362) and carries five effects (R50) across four tables, but it has no specified failure behaviour. If it raises, the confirmation rolls back and the session that both parties just completed reverts to `in_progress` with no explanation. Give it a handoff contract and a test for "raises mid-way."

3. **Add a "Cleanup Inventory" section to the spec template.** `07-spec-template.md` §10 covers Edge Cases and §11 Observability, but nothing prompts an author to enumerate *every resource this workflow creates and what destroys it*. Finding B-4 exists because no section asked the question. One table — resource, created at, destroyed by, destroy method — would have surfaced it in review.

4. **Name the timing assumptions.** R25's lock order is enforced by code review. R43's reminder cadence assumes the cron is within its 15-minute budget. R11's expiry assumes 5-minute ticks. `§11`'s `exchange.cron_heartbeat` covers the last two well. The lock order has no runtime detection at all — consider a periodic `pg_locks` sampler in staging that flags any transaction acquiring `exchange_requests` before `listings`.

5. **The `no_show` attribution rule deserves the honesty the rest of the doc has.** R65 blames the party who did not confirm. But EC-22 describes the case where one party's phone has no signal — they showed up, they could not confirm, and they take the marker. R65's own hedge ("exactly as strong as the honesty assumption in R52") acknowledges this. Consider a one-tap "I was there, my phone wasn't" that converts the marker to `NULL`, or state plainly in the product copy that the marker is contestable.

6. **Q7 of SPEC-010 is the most consequential open question in the set** — whether completion requires both confirmations, or one plus a 24-hour silent window. The spec says so itself. EC-18 concedes that every forgetful pair produces an unattributed `no_show`, and if that is the majority case the whole no-show signal is noise. Consider instrumenting for it from day one (the `exchange.no_show` `attribution: none` ratio, already specified, with a `< 50%` alarm) and pre-writing the migration for the alternative, so the answer is a config change and not a quarter of rework.

---

## 6. Recommended sequence

| Order | Action | Blocks |
|---|---|---|
| 1 | Fix **B-1** (brute-force counter), **B-2** (dispute edges), **B-3** (index definition) in the normative documents | The `20260808_0092` migration |
| 2 | Decide **B-4** (dispute release path) across SPEC-010 / 012 / 900 | Same migration |
| 3 | Resolve **H-1** (idempotency), **H-2** (code exposure), **H-4** (version vs H4) — all three change RPC signatures | RPC implementation |
| 4 | Fix **H-3** (code generator), **H-6** (rate limits), and Medium M-1 through M-8 | Implementation, not design |
| 5 | Untangle **H-5** (dependency graph) and republish the build order | Sprint planning |
| 6 | Downgrade all 18 specs to `Review`; close the 21 Before-launch open questions; adopt the CI gate from **P-1** | First `Approved` spec |
| 7 | Adopt `docs/workflows/REGISTRY.md`; wire the staleness check from **P-2** | Ongoing |

**One more thing before code.** `02-open-risks.md` R-04 says the map spike runs *"before any other work"* — build the SPEC-008 screen with 200 clustered markers on both platforms under the New Architecture. That is correctly identified and correctly prioritised, and nothing in this review changes it. Do the spike first; do the fixes above while it runs.

---

## Change Log

| Date | Version | Author | Change |
|---|---|---|---|
| 2026-08-09 | 0.1 | Workflow Architect | Initial pre-development review |
| 2026-08-09 | 0.2 | Workflow Architect | All 21 findings applied to the documents; resolution table added. Findings text left unchanged so the record of what was wrong survives the fix. Three suggestions deferred pending product/security decisions |
| 2026-08-09 | 0.3 | Workflow Architect | The three deferred suggestions decided and applied. S-5's original framing (hash the code) was wrong and is corrected in place: encryption, not hashing, because the code must stay readable |
