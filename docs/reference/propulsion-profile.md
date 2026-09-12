# Propulsion profile: why the trip takes a year

Phase 1 deliverable. Non-narrative. These numbers fix the physics table.

## The question this answers

A ballistic Earth-to-Moon transfer takes three days. Stretching one to 365 days would be a
conceit, and the whole piece is grounded in the present day, so the duration has to be the
correct engineering answer rather than a device.

It is. A small solar-electric spacecraft spiralling outward under an ion thruster takes about
a year, and one really did. ESA's SMART-1 launched 2003-09-27 into geostationary transfer orbit
and did not enter lunar orbit until 2004-11-15: thirteen and a half months, on a 68 millinewton
Hall thruster, having fired for roughly 4,900 hours.

## The vehicle, as an engineering object

A small scout, rideshared to geostationary transfer orbit on a Falcon 9, then spiralling out
on its own.

| Parameter | Value |
|---|---|
| Wet mass | 320 kg |
| Thruster | Hall effect, 46 mN |
| Specific impulse | 2,000 s |
| Exhaust velocity | 19,613 m/s |
| Xenon load | 40 kg, 12.5% of wet mass |
| Jet power | 452 W |
| Thruster input power | 821 W |
| Solar array, with housekeeping | about 1.2 kW |
| Drop-off orbit | 250 km by 35,786 km, e = 0.728 |
| Duty cycle | 62%, giving 5,044 thrust hours |

Every one of those is in the range of real small solar-electric spacecraft. The array is
comparable to SMART-1's 1.19 kW and the thrust hours are comparable to its 4,900.

## The arithmetic

For a low-thrust spiral the useful measure of effort is the change in circular velocity, not a
sum of impulsive burns. Circular velocity falls linearly with time under continuous tangential
thrust, at the rate of the thrust acceleration.

| Quantity | Value |
|---|---|
| Circular velocity at the drop-off orbit | 4,042 m/s |
| Circular velocity at the target orbit | 1,428 m/s |
| Required change | 2,614 m/s |
| Thrust acceleration at 46 mN on 320 kg | 144 μm/s² |
| Thrust time required | 210 days |
| Elapsed time at 62% duty cycle | 339 days |

Twenty-six days then remain for lunar capture, orbit lowering, descent and landing, which
closes the year exactly.

Sanity check against the real mission: applying the same simplified metric to SMART-1's
acceleration and thrust hours gives 3,268 m/s against the roughly 3,900 m/s usually quoted. The
metric under-predicts by about a sixth because it ignores steering losses and the lunar capture
spiral. That is the expected direction and size of error, which is the point of running the
check.

## Why this is better than a coast, for this piece

A ballistic coast is a straight line at nearly constant speed. Nothing happens. A spiral is a
sequence of ellipses whose apogee climbs, and it gives the year real texture for free.

| progress | semi-major axis | eccentricity | perigee | apogee | period |
|---|---|---|---|---|---|
| 0% | 24,396 km | 0.728 | 6,628 km | 42,164 km | 10.5 h |
| 5% | 32,952 km | 0.799 | 6,628 km | 59,276 km | 16.5 h |
| 10% | 41,508 km | 0.840 | 6,628 km | 76,388 km | 23.4 h |
| 20% | 58,620 km | 0.887 | 6,628 km | 110,611 km | 1.63 d |
| 35% | 84,287 km | 0.921 | 6,628 km | 161,947 km | 2.82 d |
| 50% | 109,955 km | 0.940 | 6,628 km | 213,282 km | 4.20 d |
| 65% | 135,623 km | 0.951 | 6,628 km | 264,617 km | 5.75 d |
| 80% | 161,290 km | 0.959 | 6,628 km | 315,953 km | 7.46 d |
| 90% | 178,402 km | 0.963 | 6,628 km | 350,176 km | 8.68 d |
| 95% | 186,958 km | 0.965 | 6,628 km | 367,288 km | 9.31 d |
| 100% | 195,514 km | 0.966 | 6,628 km | 384,400 km | 9.96 d |

Perigee stays near 6,628 km throughout, because thrusting is concentrated near perigee where it
raises apogee most efficiently. Eccentricity therefore climbs as the semi-major axis grows.

Three consequences the design gets for nothing:

- **Distance oscillates, and the swing grows.** The craft is not receding steadily. It rushes
  outward, hangs at apogee, and falls back. Early on the whole cycle takes ten hours and is
  invisible at day resolution. By the end of the spiral one cycle takes ten days, so the range
  readout moves substantially between one visit and the next, in both directions.
- **Apogee passages become events.** Late in the mission the craft spends days near apogee
  barely moving, then days falling inward at increasing speed. That is a rhythm, and a rhythm is
  what a long quiet stretch needs.
- **The trajectory ribbon draws a real spiral.** Progress is orbital energy, which climbs
  monotonically, while distance does not. Showing both is honest and more interesting than a bar.

## What the physics table must expose

Beyond the values already listed in the system spec, the spiral adds:

    semiMajorAxis, eccentricity, perigee, apogee, orbitalPeriod,
    trueAnomaly, revolutionNumber, cumulativeThrustHours,
    orbitalEnergy            // the monotonic progress measure

`trajectoryFraction` is derived from orbital energy, not from range, so it never goes backwards
even though range does.

## Test consequence

The full-year sweep must not assert that range from Earth increases monotonically, because it
genuinely does not. Monotonicity is asserted on orbital energy, cumulative thrust hours and
revolution number instead. Range is asserted to stay within the perigee and apogee of the
current osculating orbit, which is a stronger check than monotonicity anyway.
