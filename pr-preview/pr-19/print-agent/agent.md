# GFL Print Agent — Design Notes

This document summarises the key decisions, dead ends, and working solutions
discovered while building the USB print path for the Brother PT-P710BT.

---

## Architecture

The agent is a small HTTP server (`localhost:9100`) that receives a base64-encoded
PNG from the web app, converts it to Brother raster format, and sends it to the
printer. It is intentionally self-contained: a single Python file with inline PEP 723
dependency declarations, runnable with `uv run agent.py` and no separate install step.

Backend is universally:
- **PyUSB** → (requires udev rule on Linux, or Zadig/libusbK on Windows)

---

## Raster format (Brother P-touch)

The PT-P710BT uses Brother's raster protocol over USB at 180 DPI with a 128-dot
print head. The printable width varies by tape:

| Tape (mm) | Printable dots |
|-----------|---------------|
| 4  | 24  |
| 6  | 32  |
| 9  | 50  |
| 12 | 70  |
| 18 | 112 |
| 24 | 128 |

### PNG → raster conversion

The web app produces a **landscape** PNG where width = feed direction and
height = tape width. Conversion:

1. Derive `px_per_mm = img.height / tape_mm`
2. Derive `feed_dots = round((img.width / px_per_mm) * DPI / 25.4)`
3. Resize to `(feed_dots, printable_dots)` with LANCZOS
4. Walk columns (x = feed position); for each column build a 16-byte row:
   - Centre the printable dots within the 128-dot head using `dot_offset = (128 - printable_dots) // 2`
   - Set bit `dot_offset + y` for each dark pixel
5. Compress each row with TIFF PackBits (`0x47` raster line / `0x5A` empty line)

### Job structure

```
[invalidate 100×0x00] [ESC @]      ← preamble
ESC i a 0x01                       ← raster mode
ESC i z <info>                     ← print info (line count, tape size)
ESC i M <mode>                     ← auto-cut flag
ESC i K <flags>                    ← advanced mode (0x08 for cut end, +0x40 for high res)
ESC i d 0x00 0x00                  ← margin = 0
0x4D 0x02                          ← TIFF compression
<raster lines>
0x1A                               ← print + feed
```

Do **not** include `ESC i ! 0x00` (status notify) in the job. The printer
responds with a 32-byte status packet that the win32print driver does not
consume, which previously caused repeated copies and driver instability.

---

## Windows print path — what was tried and why we pivot

### Approach 1: win32print RAW (Historical failure)

We initially tried to send the raster job via `win32print.StartDocPrinter` / `WritePrinter` in RAW
mode using the official Brother driver without requiring Zadig.

**Gotchas & Crash source:** The 100-byte invalidate sequence (`0x00 × 100`) sent
through the driver DLL crashes the Windows Print Spooler. We tried omitting the
preamble (`preamble=False`). This allowed single prints, but subsequently crashed
the Windows Print Spooler when chaining multi-page files, looping prints, or 
waiting for status data over persistent RAW ports. The Windows Print Spooler is 
excessively fragile when bridging binary instructions to Brother PT hardware.

### Approach 2: rawport `\\.\USB002` — did not work

The spooler port name (`USB002`) is a logical name inside the Brother port
monitor DLL. There is no corresponding kernel device object at `\\.\USB002`,
so `CreateFile` always returns `ERROR_FILE_NOT_FOUND (2)` regardless of
whether the printer is connected.

### Approach 3: SetupAPI `GUID_DEVINTERFACE_USBPRINT` — did not work

The standard usbprint.sys interface GUID is not registered by the Brother driver.

### Approach 4: PyUSB / Zadig (Current Working Path)

To completely decouple from the highly crash-prone Windows Print Spooler, we
enforce replacing the class driver with **libusbK** (via Zadig). This allows PyUSB 
to claim the bulk endpoint directly. 

**Important:** We strictly use *libusbK*, not WinUSB. PyUSB has native legacy
bindings for libusbK shipped with standard python packages, whereas standard WinUSB
requires users manually downloading and placing `libusb-1.0.dll` next to the script.

This guarantees connection resilience and avoids any service level faults.

---

## Linux / Mac path (PyUSB)

Straightforward bulk write to the PT-P710BT USB endpoint (VID `0x04F9`,
PID `0x20AF`). Requires either a udev rule granting `MODE="0666"` or running
as root. The preamble (invalidate + initialize) is included constantly for this path since
the host manages the USB connection directly.
