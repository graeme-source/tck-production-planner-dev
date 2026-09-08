# TCK print bridge

Connects the cloud app to the prep-room TSC label printer (DA210/DA220,
direct thermal, 100×25mm stock). Runs on any always-on factory PC. The iPads
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
