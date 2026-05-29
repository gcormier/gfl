#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "pillow",
#   "pyusb",
# ]
# ///
"""
Gridfinity Label — local print agent for Brother PT-P710BT.

Usage:
    uv run agent.py [--port 9100]

The agent requires PyUSB on all platforms.
  Windows — Requires Zadig (install libusbK).
  Linux/Mac — PyUSB (requires a udev rule or root; see Setup below).

Setup (Windows — one-time):
    1. Install UV:  winget install astral-sh.uv
    2. Run Zadig, select the PT-P710BT, and replace the driver with `libusbK`.
    3. uv run agent.py

Setup (Linux — one-time):
    Create /etc/udev/rules.d/99-brother-pt.rules:
        SUBSYSTEM=="usb", ATTRS{idVendor}=="04f9", ATTRS{idProduct}=="20af", MODE="0666"
    Then: sudo udevadm control --reload-rules && sudo udevadm trigger
    uv run agent.py

The agent listens on http://localhost:9100 and accepts requests from the web app.
Keep it running while printing; stop with Ctrl-C.
"""

# Single source of truth for the agent version. Informational only (printed in
# the startup banner) — the browser does not read or compare it. Bump this
# deliberately when cutting a print-agent release. Unlike the web app's version,
# the agent has no deploy/build step to derive a version into, so this stays a
# plain hand-set release number.
__version__ = "0.4.11"

import argparse
import base64
import io
import json
import struct
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Optional

try:
    from PIL import Image
except ImportError:
    print("Missing dependencies. Run with:  uv run agent.py")
    sys.exit(1)

# ── Printer constants ──────────────────────────────────────────────────────────

BROTHER_VID     = 0x04F9
PT_P710BT_PID   = 0x20AF
BROTHER_MODEL   = "PT-P710BT"
PRINT_HEAD_DOTS  = 128
PRINT_DPI_STD    = 180   # standard quality (180×180 dpi)
PRINT_DPI_HIGH   = 360   # high quality (180×360 dpi, double feed stepping)

TAPE_PRINTABLE_DOTS = {4: 24, 6: 32, 9: 50, 12: 70, 18: 112, 24: 128}

ALLOWED_ORIGIN = "*"


# ── Brother raster protocol ───────────────────────────────────────────────────

def _invalidate():  return b"\x00" * 100
def _initialize():  return b"\x1b\x40"
def _status_request(): return b"\x1b\x69\x53"
def _raster_mode(): return b"\x1b\x69\x61\x01"
def _status_notify(): return b"\x1b\x69\x21\x00"

def _print_info(num_raster_lines: int, tape_mm: int, high_quality: bool = False,
                is_first_page: bool = True):
    # n1 valid flags: PI_RECOVER(0x80) | PI_WIDTH(0x04); add PI_QUALITY(0x40) for high-res
    pi_kind = 0xC4 if high_quality else 0x84
    # n9: 0x00 = starting page, 0x01 = other pages (per PT-P710BT spec).
    # The "last page" is signalled by the print command (0x1A vs 0x0C), not n9.
    page_num = 0x00 if is_first_page else 0x01
    return (b"\x1b\x69\x7a" + bytes([pi_kind, 0x00, tape_mm, 0])
            + struct.pack("<I", num_raster_lines)
            + bytes([page_num, 0x00]))

def _set_mode(auto_cut: bool):
    return b"\x1b\x69\x4d" + bytes([0x40 if auto_cut else 0x00])

def _set_advanced(high_quality: bool = False):
    flag = 0x08
    if high_quality:
        flag |= 0x40
    return b"\x1b\x69\x4b" + bytes([flag])
def _margin(dots: int = 14): return b"\x1b\x69\x64" + struct.pack("<H", dots)
def _compression_tiff(): return b"\x4d\x02"
def _print_feed(): return b"\x1a"


def _packbits(data: bytes) -> bytes:
    """TIFF PackBits encoder."""
    out = bytearray()
    i = 0
    n = len(data)
    while i < n:
        run = 1
        while run < 128 and i + run < n and data[i + run] == data[i]:
            run += 1
        if run > 1:
            out.append((257 - run) & 0xFF)
            out.append(data[i])
            i += run
            continue
        lit = 1
        while lit < 128 and i + lit < n:
            if i + lit + 1 < n and data[i + lit] == data[i + lit + 1]:
                break
            lit += 1
        out.append(lit - 1)
        out.extend(data[i:i + lit])
        i += lit
    return bytes(out)


def _raster_lines(image_rows: list[bytes]) -> bytes:
    out = bytearray()
    empty = b"\x00" * 16
    for row in image_rows:
        if row == empty:
            out.append(0x5A)
        else:
            compressed = _packbits(row)
            out.append(0x47)
            out.extend(struct.pack("<H", len(compressed)))
            out.extend(compressed)
    return bytes(out)


def _png_to_rows(png_bytes: bytes, tape_mm: int, dpi: int = PRINT_DPI_STD):
    """Decode PNG → list of 16-byte raster rows at printer resolution."""
    printable_dots = TAPE_PRINTABLE_DOTS.get(tape_mm, 70)

    img = Image.open(io.BytesIO(png_bytes)).convert("L")

    # PNG is landscape: width = feed direction, height = tape width.
    # Derive feed length in dots from the aspect ratio + known tape height.
    px_per_mm  = img.height / tape_mm
    length_mm  = img.width  / px_per_mm
    feed_dots  = max(1, round(length_mm * dpi / 25.4))

    # Cross-feed (tape width) is always 180 DPI.  The printable area is
    # smaller than the full tape, so crop to the printable portion first
    # to preserve the correct aspect ratio.
    printable_height_mm = printable_dots * 25.4 / 180
    top_crop_px = round((tape_mm - printable_height_mm) / 2 * px_per_mm)
    img = img.crop((0, top_crop_px, img.width, img.height - top_crop_px))

    img = img.resize((feed_dots, printable_dots), Image.LANCZOS)
    pixels     = img.load()
    dot_offset = (PRINT_HEAD_DOTS - printable_dots) // 2

    rows = []
    for x in range(feed_dots):
        row_bits = bytearray(16)
        for y in range(printable_dots):
            if pixels[x, y] < 128:
                bit_pos = dot_offset + y
                row_bits[bit_pos // 8] |= 0x80 >> (bit_pos % 8)
        rows.append(bytes(row_bits))
    return rows


def png_to_raster_job(png_bytes: bytes, tape_mm: int, auto_cut: bool,
                      dpi: int = PRINT_DPI_STD) -> bytes:
    """Convert a label PNG to a complete Brother raster print job.

    Includes the invalidate + initialize preamble so the printer's
    hardware buffer is flushed before the job.
    """
    high_quality = dpi >= PRINT_DPI_HIGH
    rows = _png_to_rows(png_bytes, tape_mm, dpi=dpi)

    header = _invalidate() + _initialize()

    return (
        header
        + _raster_mode()
        + _print_info(len(rows), tape_mm, high_quality=high_quality)
        + _set_mode(auto_cut)
        + _set_advanced(high_quality=high_quality)
        + _margin(0)
        + _compression_tiff()
        + _raster_lines(rows)
        + _print_feed()
    )


# ── PyUSB backend ─────────────────────────────────────────────────────────────

_usb_find_error: str = ""   # last error from _find_usb_printer, shown in status


def _find_usb_printer():
    """Return the usb.core.Device for the PT-P710BT, or None.

    On Windows with WinUSB (Zadig), PyUSB needs libusb-1.0.dll to be on the
    PATH or in the script directory.  If that DLL is missing the find() call
    raises NoBackendError; we capture it so status_usb() can surface it.
    """
    global _usb_find_error
    try:
        import usb.core
        dev = usb.core.find(idVendor=BROTHER_VID, idProduct=PT_P710BT_PID)
        _usb_find_error = "" if dev is not None else "Device not found (check USB cable and Zadig driver)"
        return dev
    except Exception as e:
        _usb_find_error = str(e)
        return None


def _drain_ep_in(ep_in, max_reads: int = 16):
    """Non-blocking drain of any pending status bytes on EP_IN."""
    for _ in range(max_reads):
        try:
            ep_in.read(32, timeout=10)
        except Exception:
            break


def _read_status(ep_in, timeout: int = 5000) -> Optional[bytes]:
    """Read a 32-byte status response from the printer, or None on timeout."""
    try:
        return bytes(ep_in.read(32, timeout=timeout))
    except Exception:
        return None


def _check_status_errors(status: bytes) -> Optional[str]:
    """Return error description if status indicates an error, else None."""
    if not status or len(status) < 32:
        return None
    err1, err2 = status[8], status[9]
    msgs = []
    if err1 & 0x01: msgs.append("No media")
    if err1 & 0x04: msgs.append("Cutter jam")
    if err1 & 0x08: msgs.append("Weak batteries")
    if err1 & 0x40: msgs.append("High-voltage adapter")
    if err2 & 0x01: msgs.append("Wrong media")
    if err2 & 0x10: msgs.append("Cover open")
    if err2 & 0x20: msgs.append("Overheating")
    if status[18] == 0x02 and not msgs:
        msgs.append("Printer error")
    return "; ".join(msgs) if msgs else None


def send_job_usb(job: bytes) -> dict:
    try:
        import usb.core
        import usb.util
    except ImportError:
        return {"success": False, "error": "pyusb not installed. Run with: uv run agent.py"}

    dev = _find_usb_printer()
    if dev is None:
        return {"success": False, "error": _usb_find_error or "Printer not found via USB."}

    try:
        try:
            if dev.is_kernel_driver_active(0):
                dev.detach_kernel_driver(0)
        except (NotImplementedError, Exception):
            pass  # Windows/libusbK doesn't support kernel driver detach
        dev.set_configuration()
        cfg = dev.get_active_configuration()
        intf = cfg[(0, 0)]
        ep_out = usb.util.find_descriptor(
            intf,
            custom_match=lambda e: usb.util.endpoint_direction(e.bEndpointAddress) == usb.util.ENDPOINT_OUT,
        )
        ep_in = usb.util.find_descriptor(
            intf,
            custom_match=lambda e: usb.util.endpoint_direction(e.bEndpointAddress) == usb.util.ENDPOINT_IN,
        )
        if ep_out is None:
            return {"success": False, "error": "USB OUT endpoint not found."}
        try:
            # ── Step 1: Clear any prior error state (e.g. red LED) ────────
            ep_out.write(_invalidate() + _initialize(), timeout=5000)
            time.sleep(0.2)
            if ep_in:
                _drain_ep_in(ep_in)

            # ── Step 2: Request + read printer status ─────────────────────
            ep_out.write(_status_request(), timeout=5000)
            if ep_in:
                status = _read_status(ep_in, timeout=5000)
                if status:
                    err = _check_status_errors(status)
                    if err:
                        return {"success": False, "error": f"Printer: {err}"}

            # ── Step 3: Send job in chunks ────────────────────────────────
            # The printer sends status responses during/between pages.
            # We must drain EP_IN between chunks so the printer doesn't
            # stall waiting for the host to read its status (USB flow
            # control). Each chunk gets a generous timeout so the printer
            # can finish printing a page before accepting the next one.
            CHUNK = 1024
            for i in range(0, len(job), CHUNK):
                ep_out.write(job[i:i + CHUNK], timeout=60000)
                if ep_in:
                    _drain_ep_in(ep_in, max_reads=4)

            # ── Step 4: Wait for completion ───────────────────────────────
            # Read status responses until "Printing completed" or timeout.
            # This ensures printing finishes before we release the USB
            # device, and lets us report actual print errors.
            if ep_in:
                deadline = time.time() + 60
                while time.time() < deadline:
                    status = _read_status(ep_in, timeout=3000)
                    if not status:
                        break  # no more responses → printer is done
                    err = _check_status_errors(status)
                    if err:
                        return {"success": False, "error": f"Print error: {err}"}
                    # status type 0x01 = "Printing completed"
                    # phase type 0x00 + phase 0x00 = "Editing state (reception possible)"
                    if status[18] == 0x06 and status[19] == 0x00:
                        break  # back to idle — all pages done

            return {"success": True, "printer": BROTHER_MODEL}
        finally:
            usb.util.dispose_resources(dev)
    except Exception as e:
        return {"success": False, "error": str(e)}


def status_usb() -> dict:
    dev = _find_usb_printer()
    result: dict = {"ready": dev is not None, "printer": BROTHER_MODEL if dev else None}
    if dev is None and _usb_find_error:
        result["error"] = _usb_find_error
    return result


# ── Backend dispatch ──────────────────────────────────────────────────────────

def make_backend(name: Optional[str]) -> str:
    """Resolve backend name."""
    return "usb"

def send_job(job: bytes, backend: str) -> dict:
    return send_job_usb(job)

def get_status(backend: str) -> dict:
    return status_usb()

# ── HTTP server ───────────────────────────────────────────────────────────────

_backend: str = "usb"  # set in main()

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(f"  {self.address_string()} {fmt % args}")

    def _cors(self, status: int, body: dict):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", ALLOWED_ORIGIN)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self._cors(204, {})

    def do_GET(self):
        if self.path == "/status":
            self._cors(200, get_status(_backend))
        else:
            self._cors(404, {"error": "Not found"})

    def do_POST(self):
        if self.path != "/print":
            self._cors(404, {"error": "Not found"})
            return
        length = int(self.headers.get("Content-Length", 0))
        try:
            req = json.loads(self.rfile.read(length))
        except Exception as e:
            self._cors(400, {"error": f"Bad request: {e}"})
            return

        # Pre-built raster job from browser (single label or batch chain print)
        if "raster_base64" in req:
            try:
                job = base64.b64decode(req["raster_base64"])
                label_count = int(req.get("label_count", 1))
                print(f"  → {label_count} label{'s' if label_count != 1 else ''} "
                      f"({len(job):,} bytes)")
                result = send_job(job, _backend)
            except Exception as e:
                self._cors(500, {"error": f"Print failed: {e}"})
                return
            self._cors(200 if result["success"] else 500, result)
            return

        # Legacy: PNG path (backward compat — single label only)
        try:
            png_bytes = base64.b64decode(req["png_base64"])
            tape_mm   = int(req.get("tape_mm", 12))
            auto_cut  = bool(req.get("auto_cut", True))
            dpi       = int(req.get("dpi", PRINT_DPI_STD))
        except Exception as e:
            self._cors(400, {"error": f"Bad request: {e}"})
            return

        try:
            job = png_to_raster_job(png_bytes, tape_mm, auto_cut, dpi=dpi)
        except Exception as e:
            self._cors(500, {"error": f"Raster conversion failed: {e}"})
            return

        result = send_job(job, _backend)
        self._cors(200 if result["success"] else 500, result)


def main():
    p = argparse.ArgumentParser(description="GFL local print agent")
    p.add_argument("--port", type=int, default=9100)
    p.add_argument("--host", default="127.0.0.1")
    args = p.parse_args()

    global _backend
    _backend = "usb"

    status = get_status(_backend)
    printer_info = f"found: {status['printer']} ✓" if status["ready"] else "not detected"

    print(f"GFL print agent v{__version__} — http://{args.host}:{args.port}")
    print(f"Backend:  {_backend}")
    print(f"Printer:  {printer_info}")
    if status.get("warning"):
        print(f"  ⚠ {status['warning']}")
    if not status["ready"]:
        if status.get("error"):
            print(f"  ✗ {status['error']}")
            if "NoBackendError" in status["error"] or "No backend" in status["error"]:
                print()
                print("  PyUSB has no libusb backend. Fix:")
                print("    Re-run Zadig, select the PT-P710BT, and install 'libusbK'.")
                print("    libusbK is natively supported by PyUSB on Windows — no extra DLL needed.")
        else:
            print("  → Check USB connection and udev rules (Linux) or Zadig driver (Windows).")
    print('Waiting for print jobs... (Ctrl-C to stop)')

    server = HTTPServer((args.host, args.port), Handler)
    server.daemon_threads = True
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        pass

    print("\nCtrl-C received, shutting down...")
    server._BaseServer__shutdown_request = True
    server.server_close()
    print("Stopped.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
