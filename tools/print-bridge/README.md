# TCK print bridge

Connects the cloud app to the prep-room label printer (TSC DA210/DA220 or
Zebra ZD421, direct thermal, 102×25mm stock — pick which on the app's Label
printer page so labels are written in that printer's language). Runs on any always-on Mac or Windows PC. The iPads
never talk to the printer — they queue jobs in the app, this script prints
them. Tap → label in about a second.

## One-time setup

1. Install Node.js LTS on the factory PC (nodejs.org, accept defaults).
2. Copy this folder onto the PC (e.g. `C:\tck-print-bridge`).
3. Create a file called `.env` next to `bridge.mjs`:

   ```
   APP_URL=https://<the live app URL>
   PRINT_BRIDGE_TOKEN=<same value as the Railway PRINT_BRIDGE_TOKEN variable>
   PRINTER_MODE=tcp
   PRINTER_HOST=<printer IP>
   ```

   Generate the token once (any long random string) and set it in BOTH
   places: Railway app service variables and this file.

4. Start it: `node bridge.mjs` — it logs `printed job N` as labels fire.
5. In the app: Inventory → Tools → Label printer → **Print test label**.

## Testing from a Mac with the printer on USB

1. Install Node.js LTS (nodejs.org, accept defaults).
2. Plug the printer into the Mac by USB and switch it on.
3. System Settings → Printers & Scanners → Add Printer → pick the printer
   (TSC or Zebra). If it asks for a driver, "Generic PostScript Printer" is
   fine — the bridge sends the printer its own language and bypasses the
   driver.
4. In Terminal, run `lpstat -p` — note the queue name it prints after
   "printer" (e.g. `TSC_DA210`).
5. In this folder, create `.env`:

   ```
   APP_URL=https://<the live app URL>
   PRINT_BRIDGE_TOKEN=<same value as the Railway PRINT_BRIDGE_TOKEN variable>
   PRINTER_MODE=mac
   PRINTER_QUEUE=TSC_DA210
   ```

6. In Terminal, from this folder: `node bridge.mjs`. Leave the window open
   while testing — closing it stops printing (jobs wait in the app until it
   is running again).
7. In the app: Inventory → Tools → Label printer → **Print test label**.

If a label comes out blank or prints the commands as text, the queue is
rasterising: re-add the printer with the maker's macOS driver (tscprinters.com
or zebra.com) and try again. On a Zebra, also check the app's Label printer
page is set to Zebra, not TSC.

## Printer connection

**Preferred — Ethernet/Wi-Fi (PRINTER_MODE=tcp):** plug the printer into the
network, give it a DHCP reservation on the router so its IP never changes,
put that IP in `PRINTER_HOST`. The printer can be anywhere in the building.
(Print the printer's self-test page — hold FEED while powering on — to see
its current IP.)

**Fallback — USB (PRINTER_MODE=share):** if the prep-room unit turns out to
be USB-only: install it on this PC with the TSC driver, Printer properties →
Sharing → share as `TSC`, then use:

```
PRINTER_MODE=share
PRINTER_SHARE=TSC
```

Note: plain USB is only rated to ~5 m — don't run a 10 m USB cable, use the
Ethernet port instead.

## Start on boot (Windows)

Task Scheduler → Create Task:
- Run whether user is logged on or not; run at startup.
- Action: Start a program — `node`, arguments `C:\tck-print-bridge\bridge.mjs`,
  start in `C:\tck-print-bridge`.
- Settings: restart the task if it fails, every 1 minute.

## How you know it's working

The app's Label printer page shows a green "bridge connected" light (the
bridge checks in at least every ~26 s) and the last 20 jobs with status.
If the printer is off, jobs queue server-side and print when it returns —
nothing is lost, and the page says so.

## Wrapping back labels (Windows, USB printer)

The wrapping PC prints the calzone **back labels** through this bridge so a
roll running out never reprints the whole run. Each label is sent as its
**own Windows print job** through the printer's normal driver (the same
driver Chrome uses today, at actual size), and the next label only goes once
Windows says the last one finished. When the roll runs out, Windows retries
just the one label that was in the printer after the new roll goes in, and
the run carries on by itself from the exact count — what Label LIVE did.
The packer sees "47 of 120 printed" / "Out of labels — put a new roll in"
on the wrapping station. Nothing depends on the printer's make or language.

This is a second, separate copy of the bridge from the prep-room one, with
its own `.env`. The prep-room printer setup above is unchanged.

### One-time setup on the wrapping PC

1. **Node.js LTS** — nodejs.org → LTS → install with the defaults.
2. **SumatraPDF** — sumatrapdfreader.org → Download → the 64-bit installer →
   install with the defaults (it installs for this Windows user). It's the
   small free PDF reader the bridge uses to print each label at actual size.
3. Check the label printer is installed in Windows and prints the back-label
   PDF correctly from Chrome today (Actual size). In **Settings → Bluetooth &
   devices → Printers & scanners → the printer → Printing preferences**, set
   the default label size to the back label's size (the stock you print on
   now). Note the printer's name **exactly** as Windows shows it there.
4. Copy this folder onto the PC, e.g. `C:\tck-print-bridge`.
5. Create a file called `.env` next to `bridge.mjs`:

   ```
   APP_URL=https://<the live app URL>
   PRINT_BRIDGE_TOKEN=<same value as the Railway PRINT_BRIDGE_TOKEN variable>
   PRINTER_MODE=windows-labels
   STATION=wrapping
   ```

   Optional keys (leave them out unless the on-site test says otherwise):
   `BACK_LABEL_QUEUE_DEPTH=2` (faster — keeps one label waiting in Windows;
   only once the test below proves the count stays exact),
   `BACK_LABEL_STUCK_SECONDS=30`, `BACK_LABEL_SETTLE_MS=0`,
   `BACK_LABEL_PRINT_SETTINGS=noscale` (add e.g. `,landscape` if labels come
   out turned), `SUMATRA_PATH=` (only if SumatraPDF is somewhere unusual),
   `BACK_LABEL_PRINTER=` (fallback printer name if the app has none).
6. In the app: **Inventory → Tools → Label printer → Wrapping back-label
   printer** — type the Windows printer name from step 3 (bridge name
   `wrapping`). It saves by itself.
7. Start it: open Command Prompt in the folder and run `node bridge.mjs`. It
   logs `TCK print bridge starting — back labels…`, and within a minute the
   Label printer page shows the wrapping printer computer as connected.

### Start it when the PC starts (Task Scheduler)

Task Scheduler → Create Task:
- General: "Run only when user is logged on" (SumatraPDF prints as the
  logged-in Windows user, who has the printer installed).
- Triggers: At log on (of the wrapping user).
- Action: Start a program — `node`, arguments `C:\tck-print-bridge\bridge.mjs`,
  start in `C:\tck-print-bridge`.
- Settings: "If the task fails, restart every 1 minute"; untick "Stop the
  task if it runs longer than…".

Set Windows to log that user in automatically, or log in each morning.

### One-page test (do this before the first real run)

1. On the wrapping station, open a product's back labels, set **3**, and tap
   **Send 3 labels to the wrapping printer**.
2. As the first label comes out, **open the printer and pull the roll out**
   (or tear the stock so the printer runs out).
3. The app should say **"Out of labels — put a new roll in; it carries on by
   itself"** with **"0 of 3 printed"** or **"1 of 3 printed"**.
4. Put the roll back and close the printer. Within a few seconds the label
   that was cut off prints again, then the rest.
5. Check: exactly **3 good labels** in total (plus the torn one), the app
   says **"3 of 3 printed — Done ✓"**, and nothing else prints in the next
   minute. If more than 3 good labels came out, write down how many, don't
   use the bridge for real runs yet — use the PDF — and tell Graeme.
6. Also try **Cancel** part-way through a 10-label run: printing stops after
   the label that's coming out, and the app shows how many printed.
7. Unplug the printer's USB mid-run, plug it back in: the app says the
   printer is off or unplugged, then carries on.

What the bridge logs while it works (the Command Prompt window):
`run 123: waiting — out-of-labels (Error, PaperOut) — 47 of 120 printed`,
then `printing again`, then `run 123: done — 120 printed`.

### Speed

Strictly one label at a time, expect roughly **15–25 labels a minute**
(starting SumatraPDF and asking Windows about the job takes ~1–2 s per
label, on top of the print itself) — about 5–8 minutes for 120 labels. With
`BACK_LABEL_QUEUE_DEPTH=2` the next label is already waiting: roughly
**25–35 a minute**. The PDF stays on the dialog as the fast fallback
("Make a PDF instead").

### If something's wrong

- "Windows has no printer called …": the name on the Label printer page
  doesn't match Windows exactly — copy it again from Printers & scanners.
- "SumatraPDF isn't installed": install it (step 2) or set `SUMATRA_PATH`.
- The run waits with "The printer has stopped" though the printer is fine:
  some USB drivers never report out-of-paper, so the bridge pauses after
  30 s without progress instead. It carries on by itself once Windows prints.
- If Windows doesn't retry the label by itself after a new roll, open the
  printer's queue in Windows and choose **Restart** on the one waiting label
  — never print the PDF again for the same packs.
- If the PC restarts mid-run, the bridge takes the run back and carries on
  from the count: it notes each label as it prints in
  `back-labels-progress.json` next to `bridge.mjs`, and finds its own labels
  still in the Windows queue by name (`tck-bl-<run>-<label>`).
- A run not finished by the end of the day it was dated stops ("expired") —
  its print date would be wrong the next day.
