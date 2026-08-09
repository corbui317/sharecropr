# Personas & Journeys

**Status:** Approved · **Version:** 1.0.0 · **Owner:** Product

Who we build for, and what a whole season looks like from their side. Journeys here cross feature boundaries deliberately — individual specs describe screens, and this describes the experience those screens add up to.

---

## 1. Primary — Maya, the surplus gardener

**42, works from home three days a week, suburban lot with six raised beds and two apple trees.**

Maya grows more than her household can eat, in bursts. Three weeks of zucchini, then nothing. Forty pounds of tomatoes in a fortnight. She has given produce away at work, left bags on neighbours' porches, and composted more than she likes to admit. She has never grown a decent pepper.

**What she wants:** for the surplus to go to someone who'll use it, and to get something she can't grow.

**What she's worried about:** meeting strangers. She would not drive to an unknown address, and she would not give her own to someone from an app.

**How she uses it:** opens the app twice a week in season, mostly in the evening. Lists something when a glut arrives. Doesn't want notifications about things she can't act on. Vanishes entirely from November to March, and that is correct behaviour.

**What would make her quit:** one uncomfortable exchange. A map with nothing on it three visits in a row. Notification spam.

**She is the core user.** Every design tradeoff should be checked against her.

---

## 2. Secondary — Devon, the variety seeker

**29, apartment with a sunny balcony, eight containers and a shelf of herbs.**

Devon grows herbs and salad greens well and has no space for anything that sprawls. He wants variety — heirloom tomatoes, unusual squash, things that aren't in a supermarket. He has more time than space.

**What he wants:** access to things he can't grow, and to meet people who know more than he does.

**What he's worried about:** having nothing worth trading. Basil feels like a weak offer against forty pounds of tomatoes.

**How he uses it:** browses often, more than he trades. Uses filters and search. Responds fast when something interesting appears.

**Design implication:** the app must never make a small grower feel unwelcome. `accepts_any` on listings exists partly for Devon. So does the deliberate absence of any quantity-based ranking.

---

## 3. Secondary — Ray, the community gardener

**66, retired, plot at a community garden and thirty years of experience.**

Ray grows a lot, gives most of it away, and knows everyone at the allotment. Not especially interested in apps but will use one that works. Has poor eyesight and uses the largest text setting on his phone.

**What he wants:** less waste, and to meet the newer gardeners.

**What he's worried about:** fiddly interfaces. Being asked for his ID by a company he's never heard of.

**Design implication:** Ray is why dynamic type and screen-reader support are non-negotiable, why the copy avoids jargon, and why the ID-verification explanation has to be genuinely convincing rather than a compliance notice. He is also why the [equity problem](../02-security/03-identity-verification.md#6-the-equity-problem) matters — a friend of Ray's with no driver's licence is exactly the person our verification requirement excludes.

---

## 4. The one we design against — the bad actor

Not a user we serve, but one we must assume exists on every screen.

Wants to find where a specific person lives, or to identify houses worth burgling, or to harass someone, or to scrape a location dataset. Will pass ID verification, because they have nothing to hide and their name is not the problem.

**Design implication:** every feature is checked against "what does this give someone who completes a real exchange under their real name?" See [Threat Model §5](../02-security/01-threat-model.md#5-abuse-cases).

---

## 5. Journey — first season (Maya)

### Week 1: install to first listing

She hears about it from a neighbour, installs, and signs up with Google. She's asked for a display name and whether she wants notifications — she declines for now, and the app doesn't push.

The map opens. **She can see the product before it asks her for anything.** Six safe spots near her, three with produce available. She taps the library and sees someone offering peppers. Not enough to commit, but enough to understand.

To offer anything, she needs a verified garden. She walks outside, photographs her beds, and submits. Then the ID request. She hesitates — this is the highest-friction moment in the whole product, and the copy has one shot: *"We verify everyone before they can trade, so you know who you're meeting. We never see or store your ID — our verification partner checks it and tells us pass or fail."*

She does it. Approved the next morning.

She lists twelve pounds of zucchini at the library and the community centre, wishlist: peppers, tomatoes.

**Where this fails:** if the map is empty on that first open, she never gets to the garden photo. [R-01](../06-roadmap/02-open-risks.md).

### Week 2: first exchange

A request arrives from Devon, offering basil and lemon thyme. She almost declines — basil for zucchini feels lopsided — then decides she'd rather it go to someone who wants it.

She accepts. A thread opens. They agree on the library, Thursday at four. Both confirm. She gets a reminder the day before and two hours ahead.

Thursday: she arrives, texts "I'm by the entrance in a green coat," and he's already there. Ninety seconds. They both enter the six-digit code. Done.

Walking back to the car she realises the thing she was worried about didn't happen, and probably won't.

She rates five stars. His rating stays hidden until he submits.

**The critical design moment is the two minutes before arrival** — the safe spot photo, the accessibility note, and the "I'm by the entrance" message are what make it fine instead of nerve-wracking.

### Weeks 3–10: the season

Four more exchanges. She learns the rhythm: list when there's a glut, check Sunday evenings. She turns on notifications after the second exchange, when they became about things she could act on.

One person cancels three hours before. Annoying, not fatal — the app notifies her immediately and the reason is there.

By August she recognises two regulars.

### November: winter

Nothing to trade. She stops opening the app.

**This is the retention cliff, and it is honest, not a failure.** [SPEC-020](../03-specs/SPEC-020-harvest-planning.md) exists so that in February she can log what she's planning and be told when neighbours will have seedlings. Whether that's enough is [R-13](../06-roadmap/02-open-risks.md).

---

## 6. Journey — the exchange that goes wrong

Maya accepts a request. They schedule for Tuesday at five. He doesn't show.

She waits fifteen minutes and messages. No reply. At six she cancels; the app asks why; she selects "they didn't show."

Two hours past the window, the cron marks it `no_show`. She's asked whether she wants to file a report. **She isn't required to** — a mandatory report for every no-show would drown the moderation queue.

She reports. It enters the queue at severity 4, 24-hour SLA. A moderator sees the session state corroborates it, checks his history — two prior no-shows — and issues a feature restriction: he can't send requests for fourteen days.

Maya gets one message: her report was reviewed and action was taken. **She is never told what action.** He gets a notice naming the category and the appeal path, and never learns who reported him.

**The design point:** the system corroborated her account without her having to prove anything, and neither party learned anything about the other that could be used for retaliation.

---

## 7. Journey — the exchange that goes badly wrong

The one every control exists for.

A user reports `unsafe_meeting` — the counterparty followed her to her car and asked where she lived.

The report is severity 1. It pages on-call within seconds. A moderator acknowledges in eight minutes, reads the report and thread (audited automatically), and immediately: blocks both directions, freezes the session, suspends the subject pending review, and sets a legal hold on everything.

Within the hour a human — not a form — contacts her and asks what she needs.

The playbook in [Trust & Safety §7](../02-security/05-trust-and-safety.md#7-after-a-real-world-incident) runs from there: counsel engaged, evidence preserved, other users checked for exposure to the same actor, insurers notified.

**What the architecture bought:** he never had her address. The safe spot was public. There is a complete, immutable record. And the response was minutes, not days.

**What it didn't buy:** it happened anyway. That is [R-03](../06-roadmap/02-open-risks.md), and it is irreducible.

---

## 8. Journey — Devon, small grower

Signs up on a Saturday. Verification is the same friction; he's more comfortable with it than Maya was, being used to identity checks in other apps.

His garden photo is eight containers on a balcony. **The ML score is low.** This is exactly the ambiguous case: the reviewer's instruction is to reject only when the photo is clearly not a growing space, so he's approved.

> If Devon gets rejected, we've told a legitimate gardener that his garden doesn't count. That is a worse outcome than admitting a marginal account, and the review guidance says so explicitly.

He lists basil and thinks nobody will want it. Three requests in two days. It turns out people with tomatoes want basil.

Over the season he trades eleven times — more than Maya, in smaller quantities. He becomes `trusted` before she does.

**Design implication:** trust tiers count *completed exchanges*, not volume traded. Devon should be able to become established as easily as someone with an acre.

---

## 9. Journey — Ray, accessibility

Ray's daughter installs it for him. He uses the largest text setting and sometimes VoiceOver.

The map is where he struggles — **a map is not usable with a screen reader**. He uses the list view, which shows the same safe spots ordered by distance with the same listings.

The list view is a **first-class path with its own E2E test** ([E-35](../04-testing/04-e2e-scenarios.md)), not a fallback nobody exercises. If it degrades, we've excluded a whole class of user from the core screen.

The ID verification worries him — he doesn't want to photograph his licence for a company he's never heard of. The explanation that we never see it is what convinces him, and it has to be true, which is why [ADR-0010](../01-architecture/adr/ADR-0010-kyc-vendor.md) is written the way it is.

His first exchange goes well. He tells four people at the allotment. **Ray is worth more than a hundred app-store installs**, and this is why launching in two metros with existing gardening communities beats launching nationally.

---

## 10. Design principles from these journeys

| Principle | Which journey |
| --- | --- |
| **Show the product before asking for anything.** The map opens before verification. | Maya, week 1 |
| **The verification explanation has one shot.** It must be convincing and true. | Maya, Ray |
| **Small growers must never feel unwelcome.** No volume ranking, `accepts_any` prominent. | Devon |
| **The two minutes before arrival matter most.** Photos, access notes, "I'm here" messages. | Maya, first exchange |
| **Ambiguity resolves toward the user.** Reject a garden only when clearly not a garden. | Devon |
| **Don't punish absence.** A quiet winter is correct behaviour, not churn to fight. | Maya, November |
| **The list view is not a fallback.** It's the core screen for some users. | Ray |
| **Corroborate rather than interrogate.** The system knew the no-show happened. | The no-show |
| **Never tell either party what happened to the other.** No retaliation vectors. | The no-show |
| **Minutes, not days, when it's serious.** | The bad incident |

---

## Change Log

| Date | Version | Author | Change |
| --- | --- | --- | --- |
| 2026-08-08 | 1.0.0 | Product | Initial personas and journeys |
