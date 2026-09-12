# Build plan

Phases run in order. Each is checked off only when its exit criterion is met and, where
marked, reviewed. Narrative phases produce output into the sealed content spec and are
never summarised in conversation.

Agent budget per phase: grok is the primary workhorse, Opus reserved for synthesis and
judgment calls, Sonnet for mechanical breadth.

---

## Phase 0 — Foundations

- [x] Initialise git repository
- [x] System and interface spec, readable half
- [x] Trajectory reference verified against Apollo 11 telemetry
- [x] Correct the hero-view angular arc against real numbers

**Exit:** a readable spec exists that describes the machine and contains no narrative. Done.

---

## Phase 1 — The physics table

- [ ] Decide the propulsion profile and therefore why the trip takes a year
- [ ] Model the trajectory as a pure function of mission time
- [ ] Fix the phase schedule and its day boundaries
- [ ] Validate continuity, monotonic invariants, and agreement with real reference values
- [ ] Publish the resulting numbers for review

**Exit:** `state(t)` is implemented and every downstream phase can depend on it.
**Review:** the numbers, by the project owner. Non-narrative.

---

## Phase 2 — The world bible

- [ ] The vehicle: form, subsystems, capabilities, limits, payload
- [ ] The computer: what it is, who it addresses, and how it changes across five acts
- [ ] The mission: who launched it, stated objective, the other end of the radio
- [ ] The rules of the universe: what is allowed to exist, strictly bounded
- [ ] The mission brief, the prose the owner reads first
- [ ] The in-world repository README

**Exit:** the world is fixed and nothing later contradicts it.
**Review:** none. Sealed. The owner meets the world from inside the experience.

---

## Phase 3 — The arc skeleton

- [ ] Select and harden the mystery
- [ ] Place all six anomalies, the false solution, the collapse, the convergence
- [ ] Verify the ending's mechanism is planted before day 90 in a boring coat
- [ ] Beat sheet: every event pinned to a day number
- [ ] The 366-row calendar with slot assignments
- [ ] Fair-play audit: every component of the resolution appears three times prior

**Exit:** a complete day-by-day skeleton with no unfilled narrative slots.
**Review:** none. Sealed.

---

## Phase 4 — The visual system

- [ ] Palette, lighting model, type scale, chrome
- [ ] Vehicle silhouette and its idle and attentive motion
- [ ] Earth and Moon renderers, including level-of-detail across a 300:1 scale change
- [ ] The hero-view framing rule
- [ ] The trajectory ribbon
- [ ] The fixed anomaly rendering vocabulary
- [ ] Renderer built end to end against placeholder content
- [ ] Contact sheet of all 366 frames, reviewed as one image

**Exit:** the year reads visually with no text at all.
**Review:** the contact sheet, by the project owner. Non-narrative.

---

## Phase 5 — The voice

- [ ] Voice bible, including the five-act drift
- [ ] Fifteen sample days spread across the year
- [ ] Encyclopedia register established
- [ ] Event card register established
- [ ] Iterate until a dead day in the middle is genuinely good

**Exit:** the voice is fixed before fifty set pieces are committed to it.
**Review:** none. Sealed.

---

## Phase 6 — Content generation

- [ ] Quiet-day engine: taxonomy, architecture, anti-repetition rules, seasonal drift
- [ ] Write the set pieces
- [ ] Write the six anomaly investigations
- [ ] Write the encyclopedia entries and event cards
- [ ] Generate all 366 days
- [ ] Text contact sheet, reviewed whole, hunting repetition and seams
- [ ] Iterate

**Exit:** 366 days exist and none of them is bad.
**Review:** none. Sealed.

---

## Phase 7 — Seal and ship

- [ ] Per-day encryption keyed to date
- [ ] Full-year sweep test passing on all 366 days
- [ ] Responsive, theme and reduced-motion checks
- [ ] Encrypt the content spec, sealed to touchdown
- [ ] Enable GitHub Pages on `emoucsd/emoucsd.github.io` and deploy
- [ ] Verify today renders correctly and the past replays correctly

**Exit:** the page is live and the owner can open it.
**Review:** the live page, by the project owner.

---

## Settled facts

| | |
|---|---|
| Repository | `emoucsd/emoucsd.github.io`, branch `main`, public |
| Hosting | GitHub Pages |
| Clock | US Pacific, anchored permanently |
| Launch / touchdown | 2026-08-31 / 2027-08-31 |

---

## Standing rules

- Nothing narrative is ever reported in conversation.
- The repository is public, so commit messages for content work must reveal nothing about content.
- The red team runs continuously and its findings are addressed, not filed.
- Every phase from 3 onward keeps a running fair-play ledger.
