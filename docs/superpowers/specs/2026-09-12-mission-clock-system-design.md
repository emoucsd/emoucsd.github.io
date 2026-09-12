# Mission Clock — System & Interface Design

**Status:** draft for review
**Date:** 2026-09-12
**Companion document:** `2026-09-12-mission-clock-content-design.md` (sealed; see §3)

---

## 1. What this is

A single static web page that renders a spacecraft's transit from Earth to the Moon,
stretched across exactly 365 real-world days.

| | |
|---|---|
| Launch | 2026-08-31, local midnight |
| Touchdown | 2027-08-31, local midnight |
| Duration | 365 days |
| Day index today (2026-09-12) | 12 |

The page derives its entire state from one input: the viewer's current local time.
There is no backend, no database, no build step, and nothing that must be kept alive
for the duration of the mission.

The viewer watches. They cannot steer, choose, fail, or fall behind. The only
interactions are looking, scrubbing back through time, and reading.

## 2. Non-goals

- **No gameplay.** No resources to manage, no decisions, no fail state.
- **No server.** Nothing that requires maintenance across a year.
- **No dependencies at runtime.** No framework, no CDN, no fonts fetched at load.
- **No account, no sync, no analytics.** Local storage only, for one purpose (§9).
- **No explicit reference** to employment, equity, vesting, money, or any company.
  The piece is a pure space metaphor and must remain safe to display on any screen.

## 3. Two documents, and the spoiler policy

This project is split across two specs.

**This document** describes the machine: layout, rendering, time handling, data
schemas, encryption, testing, deployment. It contains no narrative content of any
kind. It is safe for the project owner to read at any time, indefinitely.

**The content spec** contains the world bible, the narrator's voice, the mystery arc,
and all 365 days of writing. The project owner has asked not to see any of it. It is
plaintext during construction only, then encrypted before launch and sealed to
self-unlock on 2027-08-31, becoming part of the monument (§12).

Nothing narrative appears in this file. Content tiers below are described strictly as
empty containers with schemas.

## 4. Time model

**Day boundaries follow midnight in US Pacific time, permanently, regardless of where the
viewer is.** A personal clock should turn over when the viewer's day does, so UTC is wrong,
but following the device is also wrong: flying east would skip a day and flying west would
repeat one, corrupting a 365-day count. Anchoring to one zone forever fixes both. Launch and
touchdown are both defined as Pacific midnight on their respective dates.

Pacific time is derived from the IANA zone `America/Los_Angeles` via `Intl.DateTimeFormat`,
which is present in every target browser and carries its own daylight-saving rules. No
timezone library is needed.

```
dayIndex = floor((localMidnightOf(now) - localMidnightOf(2026-08-31)) / 86400000)
dayFraction = (now - localMidnightOf(now)) / 86400000
missionT = dayIndex + dayFraction          // continuous, 0.0 .. 365.0
```

Behaviour outside the window:

| Condition | Behaviour |
|---|---|
| `missionT < 0` | Pre-launch hold. Countdown to launch. |
| `0 <= missionT < 365` | Live mission. |
| `missionT >= 365` | Monument mode (§12). |

Daylight saving shifts a Pacific day boundary by an hour twice in the year. This needs no
special handling: the index is computed from successive Pacific midnights, so no day is
skipped or duplicated. A viewer in another timezone simply sees the day roll over at a local
hour that is not midnight, which is correct behaviour rather than a bug.

Clock skew and deliberate clock changes are not defended against. See §11.

## 5. The physics table

One pure function is the single source of truth for everything the page shows:

```
state(missionT) -> {
  phase,              // enum, see below
  rangeFromEarth,     // km
  rangeToMoon,        // km
  velocity,           // m/s
  deltaVRemaining,    // m/s
  earthAngularDia,    // degrees
  moonAngularDia,     // degrees
  sunAngle,           // degrees, for terminator placement
  earthPhase,         // illuminated fraction as seen from ship
  moonPhase,          // illuminated fraction as seen from ship
  lightDelay,         // seconds, one way
  trajectoryFraction  // 0..1, honest position along the arc
}
```

Values are interpolated from a waypoint table derived from real Apollo-class
translunar trajectory data. Requirements on this function:

- **Pure and deterministic.** Same input, same output, forever.
- **Continuous.** No discontinuities except at burn events, which are intentional.
- **Monotonic where physics demands it.** `rangeFromEarth` rises and `rangeToMoon`
  falls across the coast; angular diameters follow.
- **Numerically honest.** A technically literate viewer must not find an error.

The picture, the telemetry readouts and the written content all derive from this one
function, so they cannot disagree with each other.

### Mission phases

**Provisional, pending the propulsion decision.** The project is set in the present day, which
constrains how a real spacecraft could plausibly take a year to reach the Moon. The leading
answer is solar-electric propulsion: ESA's SMART-1 launched 2003-09-27 and reached lunar orbit
2004-11-15, roughly fourteen months, spiralling slowly outward under an ion thruster. A
year-long transit is therefore not a conceit but the unremarkable correct answer for a small
low-thrust spacecraft.

If that profile is adopted, the vehicle is never coasting. It thrusts almost continuously at
milli-newton scale, its path is a widening spiral rather than a line, and its progress is
orbital energy rather than raw distance. Three consequences for this document:

- `state()` gains orbital elements (semi-major axis, eccentricity, apogee, perigee) and
  cumulative thrust hours; `trajectoryFraction` becomes a function of orbital energy.
- The trajectory ribbon can show a real spiral, which is a better object than a straight line.
- The hero view geometry changes non-monotonically in the early months as the ship swings
  through successive apogees, before settling into a clean approach. The full-year sweep test
  must relax strict monotonicity for `rangeFromEarth` during the spiral and enforce it on
  orbital energy instead.

Phase names and boundaries are finalised in the content spec once the vehicle is fixed. The
renderer treats the phase schedule as data, so this decision does not block building the engine.

## 6. Rendering architecture

Two layers, no framework.

**Scalable vector graphics** renders everything structural: Earth, Moon, the ship,
terminator lines, atmosphere glow, the trajectory ribbon, all instrument chrome and
typography. Vectors are resolution-independent, animate under CSS, and stay crisp on
any display.

**One canvas element** renders everything particulate: the star field, exhaust plumes,
dust, and any effect requiring many small elements. Canvas handles volume that would
choke the DOM.

Art direction is *vector realism*: simplified flat-shaded forms with physically
plausible lighting. A single sun, consistent angle, real terminator lines on both
bodies, a real crater map on the Moon, a thin atmosphere band on Earth. Simplified in
form, not goofy in tone. Full colour, because the year-long change in the relative
size of the two bodies is the primary visual signal and monochrome would discard it.

Motion budget: the scene animates continuously but slowly. Nothing flashes, nothing
loops on a short cycle, nothing demands attention. The page must be pleasant to leave
open on a second monitor.

Reduced-motion preference disables parallax and particle motion, retaining a static
correctly-lit frame.

## 7. Screen layout

Three registers stacked vertically, each honest about a different thing.

### 7.1 Hero view

The majority of the frame. A cinematic near view of the ship with Earth behind and
Moon ahead, both scaled by true distance from the physics table.

This is where the year reads. Earth's angular diameter falls from 152.7° in low Earth orbit
to 1.91° at the Moon, while the Moon grows from 0.53° to filling the frame. At 302,106 km
from Earth the two subtend exactly the same angle, 2.42°: a real waypoint, and the moment the
destination stops being the smaller object. It deserves a beat.

Correcting an earlier assumption: Earth never becomes a pinprick. From the Moon it is 3.67×
the apparent size of the Moon seen from Earth, and 13.5× the apparent area. It ends as a
distinct blue disc. The arc is still enormous and it is legible at a glance without numbers,
but the final frame is a world, not a dot.

Free daily variation comes at no cost: Earth rotates once every 24 hours beneath a nearly
fixed terminator, so a different hemisphere faces the ship each half day. The terminator is a
straight line only at exactly half phase; at any other phase it is an ellipse bowing the
correct way. See `docs/reference/trajectory-constants.md`.

### 7.2 Trajectory ribbon

A thin horizontal strip beneath the hero view showing unexaggerated position along the
arc. Phase boundaries are marked. Past events appear as small ticks; clicking one jumps
the scrub bar to that day.

This register exists to be truthful where the hero view is cinematic. One day is
0.27% of the arc and it looks like it.

### 7.3 Log panel

Today's entry from the ship, with previous days scrollable above it. Active anomaly
investigations (§8) appear here as a pinned situation list until they resolve.

At phone width this becomes a sheet that pulls up over the hero view.

### 7.4 Chrome

Mission elapsed time, range, velocity, delta-v remaining, current phase, and time to
touchdown. Restrained, monospaced, framed around the scene rather than overlaid on it.

A small permanent marker opens the mission brief (§9).

### 7.5 Scrub bar

Full width, launch at the left edge, the present moment at the right. **The present
moment is a hard wall the control cannot pass.** Presets for a two-minute full replay,
a ten-minute slow replay, and single-day stepping. Any past day is deep-linkable by
URL fragment; a fragment referring to a future day is clamped to the present.

### 7.6 Responsive behaviour

At phone width the hero view stays full-bleed, the chrome collapses to a single line,
the ribbon persists, and the log becomes a pull-up sheet. Minimum supported width
360px. No horizontal scrolling at any width.

## 8. Content tiers

Four tiers, described here purely as containers.

| Tier | Frequency | Container |
|---|---|---|
| Daily log | Every day, 365 total | Title, body, timestamp |
| Event card | ~30–40 per year | Title, body, optional scene modifier |
| Anomaly investigation | ~4–8 per year | Multi-day: opens, ticks, resolves |
| Encyclopedia entry | ~2 per month | Title, body, source attribution |

An **anomaly investigation** is the only stateful tier. It opens on a given day,
remains live in the log panel for 2–14 days accumulating tick entries, then resolves
into a permanent archive record. Modelled on Stellaris anomaly research.

A **scene modifier** is a declarative instruction to the renderer, not free-form code:
a named visual element with parameters, drawn from a fixed vocabulary the renderer
implements. This keeps content data and prevents content from being able to break
rendering.

### Day record schema

```json
{
  "day": 12,
  "date": "2026-09-12",
  "log": { "title": "...", "body": "..." },
  "cards": [ { "id": "...", "title": "...", "body": "...", "scene": {...} } ],
  "anomalyTicks": [ { "anomalyId": "...", "body": "..." } ],
  "encyclopedia": null
}
```

Every day has a `log`. All other fields may be empty.

## 9. Onboarding

Deliberately minimal and diegetic. There is no tutorial and no explanatory overlay.

**Cold open.** The page loads straight into the live view, mid-mission, telemetry
running, as though it has been going the whole time without the viewer.

**Mission brief.** On first visit only, a single card offers the mission brief:
what the vehicle is, what the mission is, where it is going, how long it takes, and
who is speaking. Written from inside the world. It appears once and never again
automatically. Thereafter it is reachable at any time from a permanent marker in the
chrome (§7.4).

**Catch-up replay.** Alongside the brief, an offer to replay the mission from launch
to the present. This is load-bearing: it is where the viewer actually learns the world.
On later visits the offer is replaced by a digest of what happened since the last
visit.

Local storage holds exactly two keys: last visit timestamp, and whether the brief has
been shown. Both must degrade gracefully to a first-visit experience if unavailable,
since private windows and cleared site data will throw or return nothing.

## 10. Content pipeline and encryption

A Node script, used at development time only and never shipped to the browser:

1. Reads the authored content sources and the arc definition.
2. Generates all 366 day records (0 through 365).
3. Validates every record against the schema and the lint rules (§13).
4. Encrypts each day separately.
5. Emits a single content bundle committed to the repository.

**Per-day encryption.** Each day's record is encrypted with AES-GCM under a key
derived by HKDF from a project salt plus that day's ISO date. The page derives the key
for any date at or before the present and decrypts it. Future days are opaque
ciphertext in the repository.

The sealed content spec (§3) is encrypted the same way under the touchdown date, so it
becomes readable on 2027-08-31 and not before.

## 11. Determinism and the limits of the seal

**Determinism.** Content is generated once and committed. It is never regenerated at
runtime. A given day renders identically on every visit and every device, forever.
Regenerating content after launch would rewrite history the viewer has already read;
the pipeline therefore refuses to overwrite already-published days without an explicit
override flag.

**What the seal actually protects.** This is client-side. Setting the system clock
forward would unlock future days. This is stated plainly rather than overclaimed: the
seal raises spoiling from an accident to a deliberate act, which is the requested bar.
It stops curiosity, not determination.

## 12. Monument mode

From 2027-08-31 onward the page stops being a countdown and becomes a record.

The hero view holds the landed vehicle on the surface with Earth in the black sky. The
scrub bar covers the complete mission and no longer has a moving edge. The full archive
is browsable end to end, including every resolved anomaly. The sealed content spec
unlocks.

## 13. Testing and verification

A year cannot be reviewed by hand one day at a time. Verification is therefore
automated and holistic.

**Clock injection.** All time enters through one seam so tests can drive any date.

**Full-year sweep.** A headless run over all 366 days asserting:

- every day decrypts under its own date key, and fails to decrypt under any other;
- every day yields a log entry;
- no unfilled template placeholders or generation seams survive;
- generated filler does not repeat within a rolling window;
- phase boundaries land on their specified days;
- physics values are continuous and monotonic where required;
- every `scene` modifier names an element the renderer implements;
- no anomaly opens without resolving before day 365.

**Contact sheets.** The sweep renders every day's frame into a single large contact
sheet image, and dumps all 365 log entries into one reviewable text file. Both are
reviewed as a whole before launch. This is the only way to judge whether the year-long
visual progression actually works and whether the writing sags in the middle.

**Responsive and preference checks.** Render at 360px, tablet and desktop widths, in
light and dark, and with reduced motion, at a sample of dates across the year.

## 14. Deployment

GitHub Pages via GitHub Actions on push to the default branch. The workflow runs the full-year
sweep and refuses to deploy on failure. Static assets only. The repository URL is supplied by
the owner.

**Repository: `emoucsd/emoucsd.github.io`, branch `main`, public.**

This is a user-site repository, so on a free plan it must be public for Pages to serve at all.
Public is therefore the settled choice, and it costs little. All day content is ciphertext, and
the sealed content spec is ciphertext, so the repository being readable reveals the engine and
not the story. The account is separate from the owner's real-name professional presence, which
provides the separation that private visibility would otherwise have provided.

Two consequences accepted rather than mitigated:

- Commit timestamps, file sizes and message text are visible and leak a small amount of
  structure. Commit messages for content work must therefore say nothing about content.
- Anyone who finds the URL can open the page. Nothing links to it, and there is nothing
  sensitive on it.

## 15. Key decisions

| Decision | Choice | Why |
|---|---|---|
| Hosting | Static site, GitHub Pages | Nothing to maintain for a year |
| Framework | None | A dependency is a liability over a year; the page is small |
| Graphics | SVG structure + one canvas layer | Crisp vectors plus cheap particles, no library |
| Time basis | Viewer's local midnight | A personal clock turns over when your day does |
| Content storage | Pre-generated, per-day encrypted | Determinism plus a seal against accidental spoiling |
| Setting | Present day, real world, real hardware | The reader should be able to imagine reading about this mission in a news article this year |
| Time anchor | US Pacific, permanently | Travel must never skip or repeat a day in a 365-day count |
| Repo visibility | Public | Required for Pages on a free user-site repo; content is ciphertext, and the account is separate from the owner's real-name presence |
| Agency | None | Watch-only removes the possibility of failing your own mission |
| Art direction | Vector realism, full colour | The Earth/Moon scale change is the primary signal |

## 16. Risks

| Risk | Mitigation |
|---|---|
| The middle months are boring | Structural, not technical; addressed in the content spec |
| Content and picture drift apart | Both derive from the physics table; contact sheets catch drift |
| A bug in generated content ships sealed | Full-year sweep runs before encryption, and again in CI |
| Viewer spoils themselves | Accepted and bounded; see §11 |
| Repository is public and browsable | Content is ciphertext; the readable spec carries no narrative |

## 17. Extensibility

The owner may later want follow-on missions for subsequent vesting tranches. The design
does not build this, but does not preclude it: launch date, touchdown date, phase
schedule and content bundle are all parameters rather than constants baked into the
renderer. A second mission would be a new content bundle and a new date pair against
the same engine.

## 18. Open items

| Item | Owner | Blocking? |
|---|---|---|
| Propulsion profile and final phase schedule | Content spec | No. The renderer treats phases as data. |
| Enable GitHub Pages on the repository | Phase 7 | No |

All other decisions in this document are settled.
