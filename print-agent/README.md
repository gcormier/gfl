# GFL Print Agent

Local HTTP agent that bridges the Gridfinity Label Generator web app to a **Brother PT-P710BT** label printer over USB. The web app sends a rendered PNG; the agent converts it to the Brother raster protocol and sends it directly to the printer — no P-touch Editor required.

## Requirements

- [UV](https://docs.astral.sh/uv/) (Python package manager / script runner)
- Brother PT-P710BT connected via USB
- Libusb drivers (via Zadig on Windows, or udev on Linux)

## Installation

UV manages all Python dependencies automatically when you run the script — no `pip install` or virtual environment setup needed.

**Install UV on Windows:**
```
winget install astral-sh.uv
```

**Install UV on Linux/Mac:**
```
curl -LsSf https://astral.sh/uv/install.sh | sh
```

## Printer Setup

**Note on Windows Print Spooler**
Why don't we use the official Brother driver? The Windows Print Spooler service regularly crashes when streaming multi-page RAW batches. Directly addressing the printer via `PyUSB` using the `libusbK` driver prevents the print spooler limits, ensuring stability.

### Windows (Zadig)

1. Download [Zadig](https://zadig.akeo.ie/) and run it.
2. Select **PT-P710BT** from the device list (enable **Options → List All Devices** if it doesn't appear).
3. Set the driver to **libusbK** and click **Replace Driver**.
   *Make sure you select `libusbK`, and not `WinUSB`! The python PyUSB library natively supports libusbK without needing to manually side-load extra dlls.*
4. Run the agent.

### Linux

Create a udev rule so the printer is accessible without root:

```
sudo tee /etc/udev/rules.d/99-brother-pt.rules <<'UDEV_EOF'
SUBSYSTEM=="usb", ATTRS{idVendor}=="04f9", ATTRS{idProduct}=="20af", MODE="0666"
UDEV_EOF
sudo udevadm control --reload-rules && sudo udevadm trigger
```

## Running

```
uv run agent.py
```

The agent starts an HTTP server on `http://localhost:9100` and waits for print jobs from the web app. Keep it running while printing; stop it with **Ctrl-C**.

Startup output confirms the printer was detected:

```
GFL print agent v0.4.4 — http://127.0.0.1:9100
Backend:  usb
Printer:  found: PT-P710BT ✓
Waiting for print jobs... (Ctrl-C to stop)
```

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--port PORT` | `9100` | Port to listen on |
| `--host HOST` | `127.0.0.1` | Address to bind (use `0.0.0.0` to allow LAN access) |

## Tape widths

The agent reads the **Label Height** selected in the web app and maps it to the correct number of printable dots for the tape in use. Supported widths: 4 mm, 6 mm, 9 mm, 12 mm, 18 mm, 24 mm.

## Troubleshooting

**Printer not detected (No backend error)**
- PyUSB isn't finding its library backend on Windows. Confirm you chose `libusbK` in Zadig, because `WinUSB` requires a manual `.dll` installation.

**Printer not detected (Check USB cable)**
- On Linux, confirm the udev rule is in place and re-plug the USB cable.
- Under Windows Device Manager, ensure the PT-P710BT appears as a `libusbK USB Device` and not as a generic Printer or conflicting driver.

**Print job sent but nothing prints**
- Try toggling auto-cut off in the web UI and printing again.
- Make sure the tape cassette is seated and the cover is closed.
- The printer LED should briefly flash during a job; if it doesn't, the job bytes are not reaching the printer.

**Web app shows agent as offline**
- The agent must be running before the web app checks status. Refresh the page after starting the agent.
- On Windows, Windows Firewall may block `localhost:9100`. Allow it, or run with `--host 0.0.0.0` and point the web app at your LAN IP.
