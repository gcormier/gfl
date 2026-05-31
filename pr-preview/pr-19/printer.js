// ─── Print UI ─────────────────────────────────────────────────────────────────

function onPrintPathChange() {
  const path = document.querySelector('input[name="printPath"]:checked')?.value;
  document.getElementById('agentPanel').hidden  = path !== 'agent';
  document.getElementById('serialPanel').hidden = path !== 'serial';
}

async function pollAgentStatus() {
  const dot = document.getElementById('agentDot');
  const label = document.getElementById('agentStatusLabel');
  if (!dot) return;
  const hint = document.getElementById('agentFirstRunHint');
  try {
    const res = await fetch(`${AGENT_URL}/status`, { signal: AbortSignal.timeout(1500) });
    const data = await res.json();
    const btn = document.getElementById('printAgentBtn');
    if (hint) hint.hidden = true;
    if (data.ready) {
      dot.className = 'status-dot online';
      label.textContent = data.warning ? `Printer ready — ⚠ ${data.warning}` : 'Printer ready';
      if (btn) { btn.disabled = false; updatePrintBtnLabel(); }
    } else {
      dot.className = 'status-dot waiting';
      label.textContent = data.warning ? `⚠ ${data.warning}` : 'Agent running — printer not detected';
      if (btn) btn.disabled = true;
    }
  } catch {
    dot.className = 'status-dot offline';
    label.textContent = 'Agent offline';
    if (hint) hint.hidden = false;
    const btn = document.getElementById('printAgentBtn');
    if (btn) btn.disabled = true;
  }
}

function getTapeHeightMm() {
  return parseInt(document.querySelector('input[name="labelHeight"]:checked')?.value || '12', 10);
}

function getAutoCut() {
  return document.getElementById('autoCut')?.checked ?? true;
}
// ─── Raster Encoding ──────────────────────────────────────────────────────────

function packBits(data) {
  const out = [];
  let i = 0;
  while (i < data.length) {
    let run = 1;
    while (run < 128 && i + run < data.length && data[i + run] === data[i]) run++;
    if (run > 1) {
      out.push((257 - run) & 0xFF);
      out.push(data[i]);
      i += run;
      continue;
    }
    let lit = 1;
    while (lit < 128 && i + lit < data.length) {
      if (i + lit + 1 < data.length && data[i + lit] === data[i + lit + 1]) break;
      lit++;
    }
    out.push(lit - 1);
    for (let j = i; j < i + lit; j++) out.push(data[j]);
    i += lit;
  }
  return new Uint8Array(out);
}
// Pixel-crunch a rendered label canvas → array of 16-byte 1-bit raster rows.
async function canvasToRasterRows(canvas, tapeHeightMm, dpi) {
  const printableDots = TAPE_PRINTABLE_DOTS[tapeHeightMm] ?? 70;
  const dotOffset = (PRINT_HEAD_DOTS - printableDots) >> 1;
  const feedDots  = Math.round(LABEL_WIDTH_MM / (25.4 / dpi));

  const tmp = document.createElement('canvas');
  tmp.width  = feedDots;
  tmp.height = printableDots;
  const ctx  = tmp.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, feedDots, printableDots);

  const scale = getPrintScale();
  // Cross-feed (tape width) is always 180 DPI regardless of quality setting.
  // The printable area is smaller than the full tape height, so crop the
  // source to only the printable portion to preserve the correct aspect ratio.
  const printableHeightMm = printableDots * 25.4 / 180;
  const topCropMm = (tapeHeightMm - printableHeightMm) / 2;
  ctx.drawImage(canvas,
    LABEL_MARGIN_LEFT * scale, (LABEL_MARGIN_TOP + topCropMm) * scale,
    LABEL_WIDTH_MM * scale, printableHeightMm * scale,
    0, 0, feedDots, printableDots
  );

  const px = ctx.getImageData(0, 0, feedDots, printableDots).data;
  const rows = [];
  for (let x = 0; x < feedDots; x++) {
    const rowBytes = new Uint8Array(16);
    for (let y = 0; y < printableDots; y++) {
      const i = (y * feedDots + x) * 4;
      const luma = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      if (luma < 128) {
        const bit = dotOffset + y;
        rowBytes[bit >> 3] |= 0x80 >> (bit & 7);
      }
    }
    rows.push(rowBytes);
  }
  return rows;
}
// Compress rows + wrap with per-label Brother commands.
// ESC i z n9 (page number per PT-P710BT spec): 0x00 = starting page, 0x01 = other pages.
// The "last page" is signalled by the print command (0x1A vs 0x0C), NOT by n9.
function buildLabelJobChunks(rows, tapeHeightMm, autoCut, dpi, isFirst, isLast) {
  const piKind   = dpi >= PRINT_DPI_HIGH ? 0xC4 : 0x84;
  const numLines = rows.length;
  const pageNum  = isFirst ? 0x00 : 0x01;
  const rasterBuf = [];
  for (const row of rows) {
    if (row.every(b => b === 0)) {
      rasterBuf.push(new Uint8Array([0x5A]));
    } else {
      const compressed = packBits(row);
      rasterBuf.push(
        new Uint8Array([0x47, compressed.length & 0xFF, compressed.length >> 8]),
        compressed
      );
    }
  }
  return [
    new Uint8Array([
      0x1B, 0x69, 0x7A, piKind, 0x00, tapeHeightMm, 0x00,
      numLines & 0xFF, (numLines >> 8) & 0xFF,
      (numLines >> 16) & 0xFF, (numLines >> 24) & 0xFF,
      pageNum, 0x00,
    ]),
    new Uint8Array([0x1B, 0x69, 0x4D, autoCut ? 0x40 : 0x00]),
    new Uint8Array([0x1B, 0x69, 0x4B, (isLast ? 0x08 : 0x00) | (dpi >= PRINT_DPI_HIGH ? 0x40 : 0x00)]),
    // ESC i d: margin = 14 dots (2mm) at 180dpi, 28 dots at 360dpi — matches LABEL_MARGIN_LEFT
    new Uint8Array(dpi >= PRINT_DPI_HIGH ? [0x1B, 0x69, 0x64, 0x1C, 0x00] : [0x1B, 0x69, 0x64, 0x0E, 0x00]),
    new Uint8Array([0x4D, 0x02]),
    ...rasterBuf,
    new Uint8Array([isLast ? 0x1A : 0x0C]),
  ];
}
// Concatenate per-label chunk groups with a single shared preamble.
function assembleRasterJob(labelChunkGroups) {
  const preamble = [
    new Uint8Array(100),
    new Uint8Array([0x1B, 0x40]),
    new Uint8Array([0x1B, 0x69, 0x61, 0x01]),
    // ESC i ! 00 (auto-status notify ON) omitted — default is already 'notify',
    // and we don't read status responses from the printer in the current flow.
  ];
  const all = [...preamble, ...labelChunkGroups.flat()];
  const out = new Uint8Array(all.reduce((s, a) => s + a.length, 0));
  let offset = 0;
  for (const chunk of all) { out.set(chunk, offset); offset += chunk.length; }
  return out;
}
// Render canvases → chain print job. Single label = normal job; multiple = chain.
async function buildBatchRasterJob(canvases, tapeHeightMm, autoCut, dpi) {
  const chunkGroups = [];
  for (let i = 0; i < canvases.length; i++) {
    const rows = await canvasToRasterRows(canvases[i], tapeHeightMm, dpi);
    chunkGroups.push(buildLabelJobChunks(rows, tapeHeightMm, autoCut, dpi, i === 0, i === canvases.length - 1));
  }
  return assembleRasterJob(chunkGroups);
}
// ─── Print via Local USB Agent ────────────────────────────────────────────────

async function printViaAgent() {
  const btn = document.getElementById('printAgentBtn');
  const useQueue = printQueue.length > 0;
  const tapeHeightMm = getTapeHeightMm();
  const autoCut = getAutoCut();
  const dpi = getPrintDpi();

  try {
    let canvases;
    let n;

    if (useQueue) {
      canvases = printQueue.map(item => item.canvas);
      n = canvases.length;
    } else {
      const lengths = getLengths();
      n = isBatch() ? lengths.length : 1;
      canvases = [];
      const savedBatchIndex = batchIndex;
      for (let i = 0; i < n; i++) {
        setButtonState(btn, n > 1 ? `Rendering ${i + 1} / ${n}…` : 'Rendering…', true);
        batchIndex = i;
        canvases.push(await getPrintCanvas());
      }
      batchIndex = savedBatchIndex;
    }

    setButtonState(btn, n > 1 ? 'Building job…' : 'Printing…', true);
    const job = await buildBatchRasterJob(canvases, tapeHeightMm, autoCut, dpi);

    setButtonState(btn, 'Sending…', true);
    const res = await fetch(`${AGENT_URL}/print`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raster_base64: uint8ToBase64(job), label_count: n }),
    });
    const data = await res.json();
    if (data.success) {
      setButtonState(btn, n > 1 ? `✓ Printed ${n} labels!` : '✓ Printed!', false);
      if (useQueue && shouldClearQueueAfterPrint()) clearPrintQueue();
      setTimeout(() => { btn.disabled = false; updatePrintBtnLabel(); }, 3000);
    } else {
      alert(`Print failed: ${data.error}`);
      btn.disabled = false;
      updatePrintBtnLabel();
    }
  } catch (e) {
    alert(`Agent error: ${e.message}\n\nIs the agent running?  uv run agent.py`);
    btn.disabled = false;
    updatePrintBtnLabel();
  }
}
// ─── Print via Web Serial (BT RFCOMM) ────────────────────────────────────────

async function printViaSerial() {
  const btn = document.getElementById('printSerialBtn');

  if (!('serial' in navigator)) {
    alert('Web Serial API is not available.\nUse Chrome or Edge on desktop.');
    return;
  }

  try {
    if (!serialPort) {
      serialPort = await navigator.serial.requestPort({});
    }

    const useQueue = printQueue.length > 0;
    const tapeHeightMm = getTapeHeightMm();
    const autoCut = getAutoCut();
    const dpi = getPrintDpi();

    let canvases;
    let n;

    if (useQueue) {
      canvases = printQueue.map(item => item.canvas);
      n = canvases.length;
    } else {
      const lengths = getLengths();
      n = isBatch() ? lengths.length : 1;
      canvases = [];
      const savedBatchIndex = batchIndex;
      for (let i = 0; i < n; i++) {
        setButtonState(btn, n > 1 ? `Rendering ${i + 1} / ${n}…` : 'Connecting…', true);
        batchIndex = i;
        canvases.push(await getPrintCanvas());
      }
      batchIndex = savedBatchIndex;
    }

    setButtonState(btn, n > 1 ? 'Building job…' : 'Printing…', true);
    const job = await buildBatchRasterJob(canvases, tapeHeightMm, autoCut, dpi);

    if (!serialPort.readable) {
      await serialPort.open({ baudRate: 9600 });
    }

    setButtonState(btn, 'Sending…', true);
    const writer = serialPort.writable.getWriter();
    await writer.write(job);
    writer.releaseLock();

    setButtonState(btn, n > 1 ? `✓ Printed ${n} labels!` : '✓ Printed!', false);
    if (useQueue && shouldClearQueueAfterPrint()) clearPrintQueue();
    setTimeout(() => { btn.disabled = false; updatePrintBtnLabel(); }, 3000);
  } catch (e) {
    if (e.name !== 'NotFoundError') {
      alert(`Serial print error: ${e.message}`);
    }
    serialPort = null;
    btn.disabled = false;
    updatePrintBtnLabel();
  }
}

function setButtonState(btn, text, disabled) {
  if (!btn) return;
  btn.textContent = text;
  btn.disabled = disabled;
}

function uint8ToBase64(bytes) {
  const CHUNK = 0x8000;
  const parts = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK)));
  }
  return btoa(parts.join(''));
}

const PRINT_HEAD_DOTS = 128;
const PRINT_DPI_STD  = 180;   // feed-direction dots/inch, standard quality
const PRINT_DPI_HIGH = 360;   // feed-direction dots/inch, high quality (double-step)
// Printable dots across the tape for each tape width (mm)
const TAPE_PRINTABLE_DOTS = { 4: 24, 6: 32, 9: 50, 12: 70, 18: 112, 24: 128 };
const AGENT_URL    = 'http://localhost:9100';
