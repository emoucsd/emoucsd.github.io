# Mission Clock

A single static page that renders a spacecraft's transit from Earth to the Moon, stretched
across exactly 365 real days.

| | |
|---|---|
| Launch | 2026-08-31 |
| Touchdown | 2027-08-31 |
| Clock | Anchored permanently to US Pacific time |

The page derives its entire state from the current time. There is no backend, no database, no
build step and no runtime dependencies. Every day is generated once, encrypted under a key
derived from its own date, and committed. The page opens any day that has already arrived
and does not open one that has not. The keys are derivable by anyone who goes looking, so the
seal stops accidents rather than determined readers (system spec §11).

You watch. You cannot steer it, choose anything, or fail. You can scrub backwards and replay
the mission from launch to the present moment, and the present moment is a wall the control
cannot pass.

## Layout

    docs/PLAN.md                     build phases and their exit criteria
    docs/superpowers/specs/          design specs
    docs/reference/                  verified trajectory constants

## Two specs, one of them sealed

`2026-09-12-mission-clock-system-design.md` describes the machine: time handling, the physics
table, rendering, layout, schemas, encryption, testing, deployment. It contains no narrative
and is safe to read at any time.

The companion content spec holds the world, the voice and the arc. It is encrypted and sealed
to unlock on 2027-08-31, at which point it becomes part of the monument rather than a spoiler.

## Status

Pre-launch. See `docs/PLAN.md`.

---

*This README will be replaced at launch by one written from inside the world.*
