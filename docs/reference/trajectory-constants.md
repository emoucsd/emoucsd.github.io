# Trajectory reference constants

Verified against Apollo 11 telemetry (Mission Report MSC-00171 and the Apollo Flight
Journal). Model agreement with real callouts is within about 2% across most of the coast.
These feed the physics table in the system spec.

## Constants

| Symbol | Value |
|---|---|
| Earth radius | 6,378.137 km |
| Moon radius | 1,737.4 km |
| Earth gravitational parameter | 398,600.4418 km³/s² |
| Moon gravitational parameter | 4,902.800118 km³/s² |
| Mean Earth-Moon distance | 384,400 km |
| Speed of light | 299,792.458 km/s |

## Three distinct "boundary" points, commonly conflated

| Name | Definition | Distance from Earth | Distance from Moon |
|---|---|---|---|
| Gravitational neutral point | Equal gravitational pull | 346,024 km | 38,376 km |
| Lunar sphere of influence (Laplace) | Patched-conic handover | 318,217 km | 66,183 km |
| Apollo 11's actual SOI crossing | As flown | 345,281 km | 62,638 km |

Earth-relative velocity reaches its minimum at the true neutral point, about 911 m/s for
Apollo 11, then rises as the Moon takes over. Moon-relative velocity climbs monotonically
from before the crossing. Mission Control switched the displayed reference body from Earth
to Moon at the crossing; reproducing that switch is a real procedural detail worth showing.

## Angular diameter waypoints

| Range from Earth | Earth ∅ | Moon ∅ |
|---|---|---|
| 185 km | 152.74° | 0.53° |
| 20,000 km | 37.19° | 0.55° |
| 60,000 km | 12.20° | 0.61° |
| 100,000 km | 7.31° | 0.70° |
| 200,000 km | 3.66° | 1.08° |
| **302,106 km** | **2.42°** | **2.42°** |
| 346,024 km | 2.11° | 5.19° |
| Lunar orbit, 60 nm | 1.91° | horizon |
| Lunar surface | 1.91° | — |

**The crossover at 302,106 km is a real waypoint worth building a beat around: 78.6% of the
way out, Earth and the Moon subtend exactly the same angle, 2.42°. It is the moment the
destination stops being the smaller object.**

Correction to an earlier assumption: Earth never becomes a small dot on this trip. From the
lunar surface it subtends 1.91°, which is 3.67× the Moon's apparent size from Earth and 13.5×
its apparent area. It is always a visible disc. The visual arc is still enormous, from 152° to
1.9°, but the endpoint is a distinct blue disc, not a pinprick.

## Light delay

| Range | One-way | Round trip |
|---|---|---|
| 10,000 km | 0.033 s | 0.067 s |
| 100,000 km | 0.334 s | 0.667 s |
| 200,000 km | 0.667 s | 1.334 s |
| 346,024 km | 1.154 s | 2.309 s |
| 384,400 km | 1.282 s | 2.565 s |

Display the round trip. About 2.6 seconds at the Moon is the beat everyone recognises from
the Apollo tapes.

## Lighting rules that are commonly got wrong

- The terminator is a straight line through the disc centre **only** at exactly half phase.
  At any other phase it is an ellipse, bowing concave toward the illuminated limb for a
  crescent and convex for gibbous. Getting this wrong is the most common giveaway in space art.
- Continents desaturate toward grey with distance, from atmospheric scattering along a longer
  slant path. Oceans stay definitely blue.
- Earth's disc rotates once every 24 hours beneath a nearly fixed terminator, so a different
  hemisphere faces the spacecraft each half day. This is free daily variation for the hero view.
- The Moon's phase as approached is the complement of Earth's phase behind you.
- From the lunar surface, Earth does not rise or set. It holds position, librating through a
  slow monthly oval about 18° across. Earthrise was photographed from orbit, not the surface.
- The lunar sky is black in full daylight and the crews consistently reported not seeing stars
  during surface operations.

## Passive thermal control

The barbecue roll is 0.3 degrees per second, three revolutions per hour, about the
longitudinal axis. Use that exact number.

## Delta-v, low Earth orbit to lunar surface

Apollo 11 as flown totalled about 6,262 m/s. Round planning figure is 6,100 to 6,400 m/s,
usually split as 4,040 m/s to low lunar orbit and 1,870 m/s from there to the surface. A
solar-electric spiral has a very different and much larger delta-v total delivered at
milli-newton thrust over months, which is the whole reason it takes a year.

## Sources

Apollo 11 Mission Report MSC-00171; Apollo 11 Flight Plan (final, 1 July 1969); Apollo Flight
Journal days 2 through 4; Apollo Lunar Surface Journal sun angles and program alarms; NASA
Apollo Mission Control acronym list; AAS 20-649 Artemis I trajectory design.
