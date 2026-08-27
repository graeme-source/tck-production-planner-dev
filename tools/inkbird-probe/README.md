# Inkbird INT-11P-B probe — local proof of concept

Reads temperatures off an INT-11P-B wireless probe over Bluetooth, on this Mac,
with no Inkbird cloud account involved. The same scripts run on the packing-room
Windows PC later (see "Moving to the packing-room PC").

## How to run it

1. Take the probe **out of its charging case** so it wakes up.
2. **Close the Inkbird app on your phone** and disconnect the probe there.
   The probe accepts only one Bluetooth connection at a time — if the phone
   has it, this Mac cannot.
3. In Finder, open this folder and double-click **`1 - Find probe.command`**.
   - If macOS asks *"Terminal would like to use Bluetooth"* → click **OK**.
   - It lists nearby Bluetooth devices and highlights anything Inkbird-ish.
4. Double-click **`2 - Read temperatures.command`** for live readings.
   Press `Ctrl-C` to stop. Every reading is also appended to `readings.csv`.

If no Bluetooth prompt ever appears, add Terminal by hand:
System Settings → Privacy & Security → Bluetooth → enable **Terminal**.

## What we know about this probe

The probe does **not** broadcast its temperature. It has to be connected to and
asked, which is why the phone app must let go of it first. Readings live on
Bluetooth characteristic `fff1`, in a fixed 7-byte buffer:

| byte | meaning                                        |
|-----:|------------------------------------------------|
| 0    | header (`0xAA`)                                |
| 1    | probe / food temperature, whole degrees C      |
| 2    | flags (bit 7 = probe charging)                 |
| 3    | ambient temperature, whole degrees C (0 = none)|
| 4    | probe battery: low 7 bits = percent            |
| 5    | case battery: bits 1-7 = percent               |
| 6    | unknown                                        |

Two caveats worth knowing before trusting this for anything:

**1. This layout is community guesswork, not Inkbird's spec.** The `inkbird-ble`
library's own source says the byte layout "is not yet verified against hardware
here". So the first job is to check the numbers on screen against the numbers in
the Inkbird app / a calibrated probe.

**2. Below 0 C is unproven, and probably wrong.** The temperature is a single
byte, and the official library reads it as *unsigned* — which cannot go below
zero. If the probe encodes -5 C as `0xFB`, the library reports **251 C**.
So `read.py` deliberately prints the byte decoded **both ways**:

```
sub-zero?  unsigned= 251C  signed=  -5C
```

Put the probe in a fridge, then a freezer, and watch which column stays sane.
That single test settles whether this probe can support the blast-freezer
cooling-curve idea. Until it's settled, treat sub-zero readings as unknown.

**3. Resolution is whole degrees.** No decimals — the probe reports 75 C, never
75.4 C. Fine for a cooling curve, coarse for CCP verification.

## Moving to the packing-room PC

Same two Python files. On Windows: install Python 3.12 from python.org, then
`pip install bleak inkbird-ble`, then `python read.py`. Windows has no
equivalent of the macOS Bluetooth permission prompt, so it is actually simpler.

## Next step (not built yet)

`read.py` currently prints and writes CSV. Feeding the planner means replacing
the CSV write with a POST to a new endpoint, tagged with a batch, e.g.
`POST /api/temperature-readings { probe_id, batch_id, food_temp_c, recorded_at }`.
