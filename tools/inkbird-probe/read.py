"""Step 2 — read live temperatures from an Inkbird INT-11P-B.

Run:  ./.venv/bin/python read.py
Stop: press Ctrl-C

Connects over Bluetooth, reads the probe every few seconds, prints the values
and appends them to readings.csv.

IMPORTANT: the phone app must be closed / the probe disconnected from the
phone. The probe allows only one connection at a time.
"""
import asyncio
import csv
import struct
import sys
from datetime import datetime, timezone
from pathlib import Path

from bleak import BleakClient, BleakScanner

# Paste the address from scan.py here, or leave blank to search by name.
PROBE_ADDRESS = ""
PROBE_NAME_HINT = "int-11p"

# The characteristic the probe keeps its readings on.
DATA_UUID = "0000fff1-0000-1000-8000-00805f9b34fb"

SECONDS_BETWEEN_READINGS = 5
CSV_PATH = Path(__file__).with_name("readings.csv")


def decode(payload: bytes) -> dict:
    """Turn the probe's raw bytes into readings.

    Layout (community reverse-engineering, same as the inkbird-ble library):
      [0] header 0xAA
      [1] probe / food temperature, whole degrees C
      [2] flags, bit 7 = probe charging
      [3] ambient temperature, whole degrees C (0 = not reporting)
      [4] probe battery, low 7 bits = percent
      [5] case battery, bits 1-7 = percent
    """
    if len(payload) < 6:
        return {"error": f"short read ({len(payload)} bytes)"}

    return {
        "raw": payload.hex(" "),
        # Read the temperature byte BOTH ways until we have proven which is
        # right below 0 C. Unsigned can never go negative; signed can.
        "probe_unsigned": payload[1],
        "probe_signed": struct.unpack("b", payload[1:2])[0],
        "ambient": payload[3] or None,
        "probe_battery": payload[4] & 0x7F,
        "case_battery": payload[5] >> 1,
        "probe_charging": bool(payload[2] & 0x80),
        "case_charging": bool(payload[5] & 0x01),
    }


async def find_probe() -> str:
    if PROBE_ADDRESS:
        return PROBE_ADDRESS
    print(f"Looking for a device named like '{PROBE_NAME_HINT}'...")
    device = await BleakScanner.find_device_by_filter(
        lambda d, adv: PROBE_NAME_HINT in ((adv.local_name or d.name or "").lower()),
        timeout=20.0,
    )
    if device is None:
        sys.exit(
            "Could not find the probe.\n"
            "  - Take it out of the charging case so it wakes up\n"
            "  - Close the Inkbird app on your phone\n"
            "  - Run scan.py to see what Bluetooth devices are visible"
        )
    print(f"Found {device.name} at {device.address}")
    return device.address


def open_log():
    new_file = not CSV_PATH.exists()
    handle = CSV_PATH.open("a", newline="")
    writer = csv.writer(handle)
    if new_file:
        writer.writerow(
            ["timestamp", "probe_unsigned_c", "probe_signed_c", "ambient_c",
             "probe_battery_pct", "case_battery_pct", "raw_bytes"]
        )
    return handle, writer


async def main() -> None:
    address = await find_probe()
    handle, writer = open_log()

    print(f"\nLogging to {CSV_PATH.name}. Press Ctrl-C to stop.\n")
    print(f"{'time':<10} {'probe (unsigned)':>17} {'probe (signed)':>15} "
          f"{'ambient':>9} {'probe bat':>10} {'case bat':>9}   raw")

    try:
        while True:
            try:
                async with BleakClient(address, timeout=20.0) as client:
                    while True:
                        payload = await client.read_gatt_char(DATA_UUID)
                        reading = decode(bytes(payload))
                        now = datetime.now(timezone.utc)
                        stamp = now.astimezone().strftime("%H:%M:%S")

                        if "error" in reading:
                            print(f"{stamp:<10} {reading['error']}")
                        else:
                            ambient = reading["ambient"]
                            print(
                                f"{stamp:<10} {reading['probe_unsigned']:>15} C "
                                f"{reading['probe_signed']:>13} C "
                                f"{(str(ambient) + ' C') if ambient else '-':>9} "
                                f"{reading['probe_battery']:>9}% "
                                f"{reading['case_battery']:>8}%   {reading['raw']}"
                            )
                            writer.writerow([
                                now.isoformat(timespec="seconds"),
                                reading["probe_unsigned"],
                                reading["probe_signed"],
                                ambient if ambient is not None else "",
                                reading["probe_battery"],
                                reading["case_battery"],
                                reading["raw"],
                            ])
                            handle.flush()

                        await asyncio.sleep(SECONDS_BETWEEN_READINGS)
            except asyncio.CancelledError:
                raise
            except Exception as err:  # dropped connection, probe asleep, etc.
                print(f"  ! lost connection ({type(err).__name__}: {err}) — retrying in 10s")
                await asyncio.sleep(10)
    except KeyboardInterrupt:
        pass
    finally:
        handle.close()
        print(f"\nStopped. Readings saved in {CSV_PATH}")


try:
    asyncio.run(main())
except KeyboardInterrupt:
    print("\nStopped.")
