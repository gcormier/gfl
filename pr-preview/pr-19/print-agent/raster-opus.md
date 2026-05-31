# Brother PT-P710BT Raster Command Reference

> Distilled from: **Brother Software Developer's Manual — Raster Command Reference v1.02**
> Covers: PT-E550W / PT-P750W / **PT-P710BT**
> Source PDF: `https://download.brother.com/welcome/docp100064/cv_pte550wp750wp710bt_eng_raster_102.pdf`

---

## Table of Contents

1. [Overview & Printing Procedure](#1-overview--printing-procedure)
2. [Print Data Structure](#2-print-data-structure)
3. [Page Geometry & Tape Specs](#3-page-geometry--tape-specs)
4. [Command Reference](#4-command-reference)
5. [Status Response Format (32 bytes)](#5-status-response-format-32-bytes)
6. [TIFF Compression](#6-tiff-compression)
7. [Raster Line Layout](#7-raster-line-layout)
8. [Flow Charts / Print Sequences](#8-flow-charts--print-sequences)
9. [USB Specifications](#9-usb-specifications)
10. [PT-P710BT-Specific Notes](#10-pt-p710bt-specific-notes)

---

## 1. Overview & Printing Procedure

"Raster" = binary bitmap data (a collection of dots). The protocol sends initialization commands, control codes, and raster data over USB (or network) to produce printed labels without needing a driver.

### Printing Steps

1. **Open** the USB port
2. **Request status** — send `ESC i S`, read 32-byte response. Verify media is loaded, no errors.
3. **Send print data** — initialization + control codes + raster lines + print command (see §2)
4. **Printer prints**
5. **Receive completion status** — printer sends 32-byte status with "Printing completed"
6. **Close** the USB port

> **Important:** No commands may be sent after print data is transmitted until the completion status is received. Even `ESC i S` cannot be sent during printing.

### Concurrent vs Buffered Printing

| Mode | Trigger | Behavior |
|------|---------|----------|
| **Concurrent** | USB + uncompressed data | Printing starts immediately when data arrives (before print command) |
| **Buffered** | USB + compressed data, or network | Printing starts after full page of data is received |

---

## 2. Print Data Structure

A print job consists of **(1) Initialization** (once), then per-page: **(2) Control Codes → (3) Raster Data → (4) Print Command**.

### 2.1 Initialization (once per job)

| Seq | Command | Hex | Description |
|-----|---------|-----|-------------|
| 1 | **Invalidate** | `00` × 100 bytes | Send 100 `NULL` bytes to reset printer to receiving state |
| 2 | **Initialize** | `1B 40` | Initialize mode settings, clear print buffer |

### 2.2 Control Codes (per page)

| Seq | Command | Hex Prefix | Description |
|-----|---------|------------|-------------|
| 1 | Switch dynamic command mode | `1B 69 61 01` | Switch to raster mode (**required**) |
| 2 | Switch auto status notification | `1B 69 21 00` | `00`=notify (default), `01`=don't notify |
| 3 | Print information command | `1B 69 7A ...` | Media type, width, length, raster count (10 params) |
| 4 | Various mode settings | `1B 69 4D {n1}` | Auto cut, mirror printing |
| 5 | Cut-each-N-labels | `1B 69 41 {n}` | **Not supported on PT-P710BT** |
| 6 | Advanced mode settings | `1B 69 4B {n1}` | Half cut, chain printing, high-res, special tape |
| 7 | Specify margin amount | `1B 69 64 {n1} {n2}` | Margin in dots = n1 + n2×256 |
| 8 | Select compression mode | `4D {n}` | `00`=none, `02`=TIFF |

### 2.3 Raster Data (per page)

Repeat for each raster line in the page:

| Command | Hex | Description |
|---------|-----|-------------|
| **Raster graphics transfer** | `47 {n1} {n2} {d1..dk}` | Transfer k bytes of raster data for one line |
| **Zero raster graphics** | `5A` | Blank line (all pixels 0). Only valid in TIFF compression mode. |

### 2.4 Print Command (end of page)

| Command | Hex | When |
|---------|-----|------|
| **Print command** (FF) | `0C` | End of every page **except the last** |
| **Print command with feeding** (Ctrl-Z) | `1A` | End of the **last page** |

---

## 3. Page Geometry & Tape Specs

### 3.1 Resolution

| Resolution | Aspect Ratio |
|------------|-------------|
| 180 dpi H × 180 dpi W | 1:1 |
| 180 dpi H × 360 dpi W | 1:2 |

### 3.2 TZe Tape Sizes

All printers have **128 total pins** on the print head. Raster transfers always use **16 bytes** per line.

| ID | Tape | Width (mm) | Width (dots) | Print Area (mm) | Print Area (dots) | Width Offset (mm) | Offset (dots) | Left Margin Pins | Right Margin Pins |
|----|------|-----------|-------------|-----------------|-------------------|-------------------|---------------|-----------------|-------------------|
| 263 | 3.5 mm | 3.40 | 24 | 3.40 | 24 | 0.00 | 0 | 52 | 52 |
| 257 | 6 mm | 5.90 | 42 | 4.50 | 32 | 0.70 | 5 | 48 | 48 |
| 258 | 9 mm | 9.00 | 64 | 7.10 | 50 | 0.98 | 7 | 39 | 39 |
| 259 | 12 mm | 11.9 | 84 | 9.90 | 70 | 0.98 | 7 | 29 | 29 |
| 260 | 18 mm | 18.1 | 128 | 15.8 | 112 | 1.12 | 8 | 8 | 8 |
| 261 | 24 mm | 24.0 | 170 | 18.1 | 128 | 2.96 | 21 | 0 | 0 |

### 3.3 Heat-Shrink Tube Sizes

**HS 2:1 (IDs 415–419):**

| ID | Tape | Width (dots) | Print Area (dots) | Offset (dots) | Left Margin Pins | Right Margin Pins |
|----|------|--------------|--------------------|---------------|-----------------|-------------------|
| 415 | HS 5.8 mm | 40 | 28 | 6 | 50 | 50 |
| 416 | HS 8.8 mm | 62 | 48 | 8 | 40 | 40 |
| 417 | HS 11.7 mm | 82 | 66 | 8 | 31 | 31 |
| 418 | HS 17.7 mm | 126 | 106 | 10 | 11 | 11 |
| 419 | HS 23.6 mm | 168 | 128 | 20 | 0 | 0 |

**HS 3:1 (IDs 420–423):**

| ID | Tape | Width (dots) | Print Area (dots) | Offset (dots) | Left Margin Pins | Right Margin Pins |
|----|------|--------------|--------------------|---------------|-----------------|-------------------|
| 420 | HS 5.2 mm | 36 | 20 | 8 | 54 | 54 |
| 421 | HS 9.0 mm | 64 | 44 | 10 | 42 | 42 |
| 422 | HS 11.2 mm | 80 | 50 | 15 | 39 | 39 |
| 423 | HS 21 mm | 148 | 120 | 14 | 4 | 4 |

### 3.4 Feed / Margin Limits

**180 dpi × 180 dpi:**

| | Min Margin | Max Margin | Min Margin (no precut) |
|-|------------|------------|----------------------|
| Normal | 2 mm / 14 dots | 127 mm / 900 dots | 24.3 mm / 172 dots |

**180 dpi × 360 dpi:**

| | Min Margin | Max Margin | Min Margin (no precut) |
|-|------------|------------|----------------------|
| Normal | 2 mm / 28 dots | 127 mm / 1800 dots | 24.3 mm / 344 dots |

### 3.5 Print Length Limits

**TZe tape — 180×180:**
- Min: 4.4 mm (31 dots)
- Max: 1000 mm (7086 dots)

**TZe tape — 180×360:**
- Min: 4.2 mm (60 dots)
- Max: 1000 mm (14172 dots)

**Heat-Shrink Tube:**
- Min: 4.4 mm (31 dots)
- Max: 500 mm (3543 dots)

> **Note:** The minimum tape that can physically be fed out is **24.5 mm** regardless of print data length. Shorter print data will still result in 24.5 mm of tape.

---

## 4. Command Reference

### 4.1 NULL — Invalidate

```
Hex: 00
```

- Skipped by the printer.
- Send 100 bytes of `00` before `Initialize` to reset the printer to receiving state.
- Also used to cancel a mid-transmission print job (send enough NULLs, then Initialize).

### 4.2 ESC @ — Initialize

```
Hex: 1B 40
```

- Initializes mode settings and clears print buffer.
- Also used to cancel printing.

### 4.3 ESC i S — Status Information Request

```
Hex: 1B 69 53
```

- Requests 32-byte status from the printer. See [§5](#5-status-response-format-32-bytes) for format.
- Send **once before printing**. Do **not** send during printing.
- The printer automatically sends error/status info during printing.

### 4.4 ESC i a — Switch Dynamic Command Mode

```
Hex: 1B 69 61 {n1}
```

| n1 | Mode |
|----|------|
| `00` | ESC/P mode (**not supported on PT-P710BT**) |
| `01` | **Raster mode** (always use this) |
| `03` | P-touch Template mode (**not supported on PT-P710BT**) |

- Must switch to raster mode before sending raster data.
- Persists until printer is turned off.

### 4.5 ESC i ! — Switch Automatic Status Notification Mode

```
Hex: 1B 69 21 {n1}
```

| n1 | Behavior |
|----|----------|
| `00` | Notify (default) |
| `01` | Do not notify |

- Controls whether printer sends automatic status during printing.
- Persists until printer is turned off.

### 4.6 ESC i z — Print Information Command

```
Hex: 1B 69 7A {n1} {n2} {n3} {n4} {n5} {n6} {n7} {n8} {n9} {n10}
```

| Param | Description |
|-------|-------------|
| **n1** | Valid flag (bitmask): |
| | `0x02` — Media type valid |
| | `0x04` — Media width valid |
| | `0x08` — Media length valid |
| | `0x40` — Priority print quality (not used) |
| | `0x80` — Printer recovery always on |
| **n2** | Media type: `00`=no tape, `01`=laminated, `03`=non-laminated, `11`=HS 2:1, `17`=HS 3:1, `FF`=incompatible |
| **n3** | Media width in mm (e.g. `18` for 24mm → `0x18`) |
| **n4** | Media length in mm (normally `0x00` for continuous tape) |
| **n5–n8** | Raster number (little-endian 32-bit): `n8×256³ + n7×256² + n6×256 + n5` = total number of raster lines |
| **n9** | Page flag: `0` = starting page, `1` = subsequent pages |
| **n10** | Fixed at `0` |

> If PI_KIND, PI_WIDTH, PI_LENGTH flags are set and media doesn't match, the printer returns an error status (bit 0 of Error info 2 = "Wrong media").

**Example — 24mm tape, 100mm print length at 180dpi:**
```
1B 69 7A 84 00 18 00 AA 02 00 00 00 00
```
- `84` = `0x80 | 0x04` = recovery on + width valid
- `00` = no tape type specified
- `18` = 24mm
- `00` = length 0 (continuous)
- `AA 02 00 00` = 682 raster lines (little-endian)

### 4.7 ESC i M — Various Mode Settings

```
Hex: 1B 69 4D {n1}
```

| Bit | Mask | Function |
|-----|------|----------|
| 0–5 | — | Not used |
| 6 | `0x40` | Auto cut: `1`=auto cut, `0`=no auto cut |
| 7 | `0x80` | Mirror printing: `1`=mirror, `0`=normal |

**Examples:**
- `1B 69 4D 00` — no auto cut, no mirror
- `1B 69 4D 40` — auto cut enabled

### 4.8 ESC i A — Cut-Each-N-Labels

```
Hex: 1B 69 41 {n}
```

- Page number `n` = 1–99. Default: 1 (cut every label).
- Only effective when auto cut is enabled.
- **⚠ Not supported on PT-P710BT.**

### 4.9 ESC i K — Advanced Mode Settings

```
Hex: 1B 69 4B {n1}
```

| Bit | Mask | Function |
|-----|------|----------|
| 0–1 | — | Not used |
| 2 | `0x04` | Half cut: `1`=on, `0`=off. **Not used on PT-P710BT.** |
| 3 | `0x08` | No chain printing: `1`=feed+cut after last label, `0`=chain (no feed/cut after last) |
| 4 | `0x10` | Special tape (no cutting): `1`=don't cut, `0`=normal |
| 5 | — | Not used |
| 6 | `0x40` | High-resolution printing: `1`=high-res, `0`=normal |
| 7 | `0x80` | No buffer clearing when printing: `1`=on, `0`=off |

**Common value:** `0x08` = no chain printing (feed and cut after last label).

> **No buffer clearing (bit 7):** If sent before the first label's data, only labels from the second onward require a print command. The expansion buffer is preserved between labels.

### 4.10 ESC i d — Specify Margin Amount

```
Hex: 1B 69 64 {n1} {n2}
```

- Margin amount in dots = `n1 + n2 × 256`
- Controls left/right feed margins on the tape.

**Example — 2mm margin at 180dpi (14 dots):**
```
1B 69 64 0E 00
```

### 4.11 M — Select Compression Mode

```
Hex: 4D {n}
```

| n | Mode |
|---|------|
| `00` | No compression |
| `01` | Reserved (disabled) |
| `02` | TIFF (PackBits) |

- Only affects raster graphics transfer data.
- With TIFF mode, `Z` (zero raster) command becomes available.

### 4.12 G — Raster Graphics Transfer

```
Hex: 47 {n1} {n2} {d1} ... {dk}
```

- Transfers one raster line.
- `k = n1 + n2 × 256` — number of data bytes following.
- **Uncompressed:** `k` = 16 bytes (128 pins / 8 = 16 bytes), always.
- **TIFF compressed:** `k` = compressed size (expands to 16 bytes).
- Data fills the expansion buffer; remainder filled with `0`, excess truncated.
- MSB of first byte = top-most pin (pin 0).

### 4.13 Z — Zero Raster Graphics

```
Hex: 5A
```

- Fills an entire raster line with zeros (blank line).
- Only valid when TIFF compression mode is selected.

### 4.14 FF — Print Command

```
Hex: 0C
```

- Print command for pages **other than the last page**.

### 4.15 Control-Z — Print Command with Feeding

```
Hex: 1A
```

- Print command for the **last page** of the job.

---

## 5. Status Response Format (32 bytes)

The printer returns exactly **32 bytes** in response to `ESC i S`, or automatically during/after printing.

| # | Offset | Size | Field | Value |
|---|--------|------|-------|-------|
| 1 | 0 | 1 | Print head mark | Fixed `0x80` |
| 2 | 1 | 1 | Size | Fixed `0x20` (32) |
| 3 | 2 | 1 | Brother code | Fixed `0x42` (`B`) |
| 4 | 3 | 1 | Series code | Fixed `0x30` (`0`) |
| 5 | 4 | 1 | Model code | `0x66`=PT-E550W, `0x68`=PT-P750W |
| 6 | 5 | 1 | Country code | Fixed `0x30` (`0`) |
| 7 | 6 | 1 | Reserved | `0x00` |
| 8 | 7 | 1 | Reserved | `0x00` |
| 9 | 8 | 1 | Error info 1 | Bitmask (see below) |
| 10 | 9 | 1 | Error info 2 | Bitmask (see below) |
| 11 | 10 | 1 | Media width | Width in mm (0–255) |
| 12 | 11 | 1 | Media type | See media type table |
| 13 | 12 | 1 | Number of colors | Fixed `0x00` |
| 14 | 13 | 1 | Fonts | Fixed `0x00` |
| 15 | 14 | 1 | Reserved | — |
| 16 | 15 | 1 | Mode | Value from "various mode settings" cmd, or `0x00` |
| 17 | 16 | 1 | Density | Fixed `0x00` |
| 18 | 17 | 1 | Media length | Length in mm (see table) |
| 19 | 18 | 1 | Status type | See below |
| 20 | 19 | 1 | Phase type | See below |
| 21 | 20 | 1 | Phase number (high byte) | See below |
| 22 | 21 | 1 | Phase number (low byte) | See below |
| 23 | 22 | 1 | Notification number | See below |
| 24 | 23 | 1 | Expansion area | Fixed `0x00` |
| 25 | 24 | 1 | Tape color info | See below |
| 26 | 25 | 1 | Text color info | See below |
| 27 | 26 | 4 | Hardware settings | Default HW info for checking |
| 31 | 30 | 1 | Reserved | `0x00` |
| 32 | 31 | 1 | Reserved | `0x00` |

### 5.1 Error Information 1 (offset 8)

| Bit | Mask | Error |
|-----|------|-------|
| 0 | `0x01` | No media |
| 1 | `0x02` | (Not used) |
| 2 | `0x04` | Cutter jam |
| 3 | `0x08` | Weak batteries |
| 4 | `0x10` | (Not used) |
| 5 | `0x20` | (Not used) |
| 6 | `0x40` | High-voltage adapter |
| 7 | `0x80` | (Not used) |

### 5.2 Error Information 2 (offset 9)

| Bit | Mask | Error |
|-----|------|-------|
| 0 | `0x01` | Wrong media / Replace media |
| 1 | `0x02` | (Not used) |
| 2 | `0x04` | (Not used) |
| 3 | `0x08` | (Not used) |
| 4 | `0x10` | Cover open |
| 5 | `0x20` | Overheating |
| 6 | `0x40` | (Not used) |
| 7 | `0x80` | (Not used) |

### 5.3 Media Width & Length (offsets 10, 17)

**TZe tape (length always 0):**

| Tape | Width byte |
|------|-----------|
| No tape | 0 |
| 3.5 mm | 4 |
| 6 mm | 6 |
| 9 mm | 9 |
| 12 mm | 12 |
| 18 mm | 18 |
| 24 mm | 24 |

### 5.4 Media Type (offset 11)

| Value | Type |
|-------|------|
| `0x00` | No media |
| `0x01` | Laminated tape |
| `0x03` | Non-laminated tape |
| `0x11` | Heat-Shrink Tube (HS 2:1) |
| `0x17` | Heat-Shrink Tube (HS 3:1) |
| `0xFF` | Incompatible tape |

### 5.5 Status Type (offset 18)

| Value | Meaning |
|-------|---------|
| `0x00` | Reply to status request |
| `0x01` | Printing completed |
| `0x02` | Error occurred |
| `0x04` | Turned off |
| `0x05` | Notification |
| `0x06` | Phase change |

### 5.6 Phase Type & Phase Number (offsets 19–21)

**Phase Type:**

| Value | State |
|-------|-------|
| `0x00` | Editing state (reception possible) |
| `0x01` | Printing state |

**Editing state phases:**

| Phase | High Byte | Low Byte |
|-------|-----------|----------|
| Reception possible | `0x00` | `0x00` |
| Feed | `0x00` | `0x01` |

**Printing state phases:**

| Phase | High Byte | Low Byte |
|-------|-----------|----------|
| Printing | `0x00` | `0x00` |
| Cover open while receiving | `0x00` | `0x14` |

### 5.7 Notification Number (offset 22)

| Value | Meaning |
|-------|---------|
| `0x00` | Not available |
| `0x01` | Cover open |
| `0x02` | Cover closed |

### 5.8 Tape Color Information (offset 24)

| Color | ID |
|-------|-----|
| White | `0x01` |
| Other | `0x02` |
| Clear | `0x03` |
| Red | `0x04` |
| Blue | `0x05` |
| Yellow | `0x06` |
| Green | `0x07` |
| Black | `0x08` |
| Clear (White text) | `0x09` |
| Matte White | `0x20` |
| Matte Clear | `0x21` |
| Matte Silver | `0x22` |
| Satin Gold | `0x23` |
| Satin Silver | `0x24` |
| Blue (D) | `0x30` |
| Red (D) | `0x31` |
| Fluorescent Orange | `0x40` |
| Fluorescent Yellow | `0x41` |
| Berry Pink (S) | `0x50` |
| Light Gray (S) | `0x51` |
| Lime Green (S) | `0x52` |
| Yellow (F) | `0x60` |
| Pink (F) | `0x61` |
| Blue (F) | `0x62` |
| White (Heat-shrink Tube) | `0x70` |
| White (Flex. ID) | `0x90` |
| Yellow (Flex. ID) | `0x91` |
| Cleaning | `0xF0` |
| Stencil | `0xF1` |
| Incompatible | `0xFF` |

### 5.9 Text Color Information (offset 25)

| Color | ID |
|-------|-----|
| White | `0x01` |
| Other | `0x02` |
| Red | `0x04` |
| Blue | `0x05` |
| Black | `0x08` |
| Gold | `0x0A` |
| Blue (F) | `0x62` |
| Cleaning | `0xF0` |
| Stencil | `0xF1` |
| Incompatible | `0xFF` |

---

## 6. TIFF Compression

Compression mode `02` uses **TIFF PackBits** encoding. This compresses raster line data (16 bytes uncompressed) into a variable-length byte stream.

### Encoding Rules

- Operates on **1-byte units**.
- **Repeated data:** encode as `[count_byte] [data_byte]` where `count_byte` = `-(repeat_count - 1)` (two's complement).
- **Non-repeating data:** encode as `[count_byte] [data_bytes...]` where `count_byte` = `byte_count - 1`.
- If compression produces > 16 bytes, treat entire line as non-repeating (17 bytes total including length byte).
- Compressed data **always expands to exactly 16 bytes** regardless of tape width.

### Example

Uncompressed (partial raster):
```
00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 22 22 23 BA BF A2 22 2B ...
```

Compressed:
```
ED 00    → 20 bytes of 0x00 (20-1=19 → negative = 0xED)
FF 22    → 2 bytes of 0x22 (2-1=1 → negative = 0xFF)
05 23 BA BF A2 22 2B   → 6 different bytes (6-1=5)
```

### Compressed vs Uncompressed Raster Layout

- **Uncompressed:** Data represents only offset pins + print area pins.
- **Compressed (TIFF):** Data always represents all 128 pins (16 bytes when expanded), including unused margin pins.

---

## 7. Raster Line Layout

### Pin Arrangement

The print head has **128 pins** total. The raster data is 16 bytes (128 bits). Each bit = one pin.

```
Byte 1 MSB ← Pin 0 (top of tape)
Byte 1 LSB ← Pin 7
Byte 2 MSB ← Pin 8
...
Byte 16 LSB ← Pin 127 (bottom of tape)
```

The print area is centered (or offset) within the 128-pin range depending on tape width:

```
┌───────────────────────────────────────┐
│  Right margin pins │ Print area pins │ Left margin pins  │
│  (top of raster)   │  (actual data)  │ (bottom of raster)│
└───────────────────────────────────────┘
Pin 0                                                Pin 127

Feeding direction →  (perpendicular to pins)
```

### Pin Distribution by Tape Width

| Tape | Left Margin Pins | Print Area Pins | Right Margin Pins | Bytes per Transfer |
|------|-----------------|-----------------|-------------------|-------------------|
| 3.5 mm | 52 | 24 | 52 | 16 |
| 6 mm | 48 | 32 | 48 | 16 |
| 9 mm | 39 | 50 | 39 | 16 |
| 12 mm | 29 | 70 | 29 | 16 |
| 18 mm | 8 | 112 | 8 | 16 |
| 24 mm | 0 | 128 | 0 | 16 |

> **Key insight:** Every raster line is always 16 bytes (128 bits) regardless of tape width. Narrower tapes simply have more zero-padding in the margin pin positions.

---

## 8. Flow Charts / Print Sequences

### 8.1 Buffered Printing — Normal Flow (most common with TIFF)

```
Host                                    Printer
 │                                        │
 │──── Invalidate (100×0x00) ────────────>│  Reset
 │──── Initialize (1B 40) ──────────────>│  Initialize
 │──── Status Request (1B 69 53) ───────>│  Check media
 │<─── Status (32 bytes) ───────────────-│  Response
 │                                        │
 │  [Verify media OK, no errors]          │
 │                                        │
 │──── Control codes ────────────────────>│  Receive
 │──── Raster data (lines) ─────────────>│
 │──── Raster data ... ─────────────────>│
 │──── Print cmd (0C or 1A) ────────────>│  Start printing
 │                                        │
 │<─── Status (Phase: Printing) ────────-│
 │<─── Status (Printing completed) ─────-│
 │<─── Status (Phase: Waiting) ─────────-│
 │                                        │
 │  [For multi-page: repeat from          │
 │   control codes for next page]         │
```

### 8.2 Concurrent Printing — Normal Flow (USB + uncompressed)

```
Host                                    Printer
 │                                        │
 │──── Invalidate + Initialize ─────────>│
 │──── Status Request ──────────────────>│
 │<─── Status ──────────────────────────-│
 │──── Control codes ────────────────────>│
 │──── Raster data ─────────────────────>│  Starts printing
 │<─── Status (Phase: Printing) ────────-│  IMMEDIATELY
 │──── More raster data ────────────────>│  (doesn't wait for
 │──── Print cmd ────────────────────────>│   print command)
 │<─── Status (Printing completed) ─────-│
 │<─── Status (Phase: Waiting) ─────────-│
```

### 8.3 Error Recovery

- If error occurs during printing, the printer sends `Status (Error occurred)`.
- All buffered data is cleared by the printer.
- To retry: send `Initialize`, then re-send from page 1 (or from the page that received a "Printing" phase acknowledgment).

**Concurrent printing error rule:**
- If the host received a "Phase: Printing" status for page N before the error, page N was acknowledged — resend from page N.
- If no "Phase: Printing" was received for that page, resend from page 1.

---

## 9. USB Specifications

| Item | Value |
|------|-------|
| USB Spec | 1.1 |
| Vendor ID | `0x04F9` |
| Product ID (PT-P710BT) | `0x20AF` |
| Product ID (PT-E550W) | `0x2060` |
| Product ID (PT-P750W) | `0x2062` |
| Device Class | Printer |
| Manufacturer String | `Brother` |
| Serial Number | `000` + last 9 digits of printer serial |
| Device Speed | Full speed |
| Interfaces | 1 |
| Power | Self-powered |
| Endpoint 1 (IN) | Bulk — status from printer → host. Max packet: 64 bytes |
| Endpoint 2 (OUT) | Bulk — commands/data from host → printer. Max packet: 64 bytes |

---

## 10. PT-P710BT-Specific Notes

1. **Does NOT support ESC/P mode** — only raster mode (`ESC i a 01`).
2. **Does NOT support P-touch Template mode.**
3. **Does NOT support `ESC i A`** (cut-each-N-labels command).
4. **Does NOT support half cut** (bit 2 of `ESC i K`).
5. **USB Product ID:** `0x20AF`
6. **Model code in status response:** Not explicitly listed in the PDF (only PT-E550W=`0x66`, PT-P750W=`0x68` are listed). Likely differs.

---

## Quick Reference: Complete Print Job Byte Sequence

For a single-page print on 24mm TZe tape, TIFF compression, auto-cut, 14-dot margins:

```
# 1. Invalidate — 100 bytes of 0x00
00 00 00 00 ... (×100)

# 2. Initialize
1B 40

# 3. Switch to raster mode
1B 69 61 01

# 4. Status notification (notify = default)
1B 69 21 00

# 5. Print information (24mm tape, N raster lines)
1B 69 7A 84 00 18 00 {n5} {n6} {n7} {n8} 00 00

# 6. Various mode settings (auto-cut on)
1B 69 4D 40

# 7. Advanced mode settings (no chain printing)
1B 69 4B 08

# 8. Margin amount (14 dots = 2mm at 180dpi)
1B 69 64 0E 00

# 9. Select compression mode (TIFF)
4D 02

# 10. Raster data lines (repeat for each line)
47 {n1} {n2} {compressed data...}   # line with data
5A                                    # blank line

# 11. Print command with feeding (last page)
1A
```

---

## Split Tape Sizes (for reference)

Split tapes divide a single tape into multiple parallel print areas:

| ID | Tape | Split | Print Area per Strip (dots) | Offset (dots) |
|----|------|-------|-----------------------------|---------------|
| 279 | 12mm | ×2 | 70 | 7 |
| 285 | 12mm | ×3 | 70 | 7 |
| 291 | 12mm | ×4 | 70 | 7 |
| 280 | 18mm | ×2 | 112 | 8 |
| 286 | 18mm | ×3 | 112 | 8 |
| 292 | 18mm | ×4 | 112 | 8 |
| 281 | 24mm | ×2 | 128 | 21 |
| 287 | 24mm | ×3 | 128 | 21 |
| 293 | 24mm | ×4 | 128 | 21 |

Overall width = (print area × split count) + (offset × 2).
