"""Step 1 — find the Inkbird probe over Bluetooth.

Run:  ./.venv/bin/python scan.py
Prints every BLE device the Mac can see, highlighting anything Inkbird-ish.
"""
import asyncio
from bleak import BleakScanner

INTERESTING = ("int-11", "inkbird", "ibbq", "iht", "ibs-")


async def main() -> None:
    print("Scanning for 12 seconds... (probe out of the case, phone app closed)\n")
    devices = await BleakScanner.discover(timeout=12.0, return_adv=True)

    hits, others = [], []
    for address, (device, adv) in devices.items():
        name = (adv.local_name or device.name or "") or "(no name)"
        row = (name, address, adv.rssi)
        (hits if any(k in name.lower() for k in INTERESTING) else others).append(row)

    if hits:
        print("=== LIKELY YOUR PROBE ===")
        for name, address, rssi in sorted(hits, key=lambda r: -r[2]):
            print(f"  {name:<24} {address}   signal {rssi} dBm")
        print("\nCopy the long address above into read.py (PROBE_ADDRESS).")
    else:
        print("No Inkbird-looking device found.")

    print(f"\n=== everything else seen ({len(others)}) ===")
    for name, address, rssi in sorted(others, key=lambda r: -r[2])[:25]:
        print(f"  {name:<24} {address}   signal {rssi} dBm")


asyncio.run(main())
