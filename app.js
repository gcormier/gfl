'use strict';

const LS_FAV_KEY   = 'gfl_favorites';
const APP_VERSION = '1.9.1';

// Base path — works at /gfl/ (GitHub Pages) and / (custom domain)
const BASE = location.pathname.endsWith('/')
  ? location.pathname
  : location.pathname.slice(0, location.pathname.lastIndexOf('/') + 1);
const assetUrl = path => BASE + path.replace(/^\//, '');

// ─── State ────────────────────────────────────────────────────────────────────

let standards = [];
let selectedStandard = null;
let selectedMdiIcon = null;       // { type:'mdi'|'svg', name, path }
let selectedCustomIcon = null;    // { id, name, path }
let mdiMeta = null;               // lazy-loaded MDI metadata
let customIconsMeta = null;       // lazy-loaded custom icon library
let renderDebounce = null;
let serialPort = null;            // active Web Serial port
let batchIndex = 0;               // current label index in batch preview
let showImage = true;             // IMAGE chip state
let iconPosition = 'right';       // 'left' | 'right' — icon placement side
let specMode = 'standard';        // 'standard' | 'freeform'
let printQueue = [];              // accumulated labels for multi-print

// ─── Boot ─────────────────────────────────────────────────────────────────────

async function init() {
  const el = document.getElementById('appVersion');
  if (el) el.textContent = `v${APP_VERSION}`;
  await loadStandards();
  bindEvents();
  initSegmentedControls();
  initViewChips();
  initHeightToggle();
  initOutputTabs();
  renderFavoritesPanel();
  updateStarButtons();
  render();
}

// ─── Events ───────────────────────────────────────────────────────────────────

function bindEvents() {
  // Standard search
  const searchInput = document.getElementById('standardSearch');
  searchInput.addEventListener('input', onStandardSearch);
  searchInput.addEventListener('keydown', onSearchKeydown);
  document.getElementById('clearStandard').addEventListener('click', clearStandard);

  // Hide dropdowns on outside click
  document.addEventListener('click', e => {
    if (!e.target.closest('.search-container')) {
      document.getElementById('searchResults').hidden = true;
      document.getElementById('iconSearchResults').hidden = true;
      document.getElementById('customIconSearchResults').hidden = true;
    }
  });

  // Re-render inputs
  ['threadSize', 'threadSizeImperial', 'lengthInput', 'generalName', 'noteInput', 'qrUrl'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', id === 'lengthInput' ? onLengthInput : scheduleRender);
  });

  ['printScale'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', scheduleRender);
  });

  document.getElementById('downloadBtn').addEventListener('click', downloadPng);

  // MDI icon picker
  document.getElementById('mdiSearch').addEventListener('input', onMdiSearch);
  document.getElementById('clearIconBtn').addEventListener('click', clearMdiIcon);
  document.getElementById('starIconBtn').addEventListener('click', toggleFavoriteIcon);
  document.getElementById('svgUpload').addEventListener('change', onSvgUpload);

  // Custom icon picker
  document.getElementById('customIconSearch').addEventListener('input', onCustomIconSearch);
  document.getElementById('clearCustomIconBtn').addEventListener('click', clearCustomIcon);

  // Standard star
  document.getElementById('starStandardBtn').addEventListener('click', toggleFavoriteStandard);

  // Favorites
  document.getElementById('exportFavBtn').addEventListener('click', exportFavorites);
  document.getElementById('importFavInput').addEventListener('change', onImportFavorites);

  // Batch scrubber
  document.getElementById('batchPrev')?.addEventListener('click', () => { batchIndex = Math.max(0, batchIndex - 1); updateBatchUI(); scheduleRender(); });
  document.getElementById('batchNext')?.addEventListener('click', () => { batchIndex = Math.min(getLengths().length - 1, batchIndex + 1); updateBatchUI(); scheduleRender(); });

  // Print queue
  document.getElementById('addToQueueBtn')?.addEventListener('click', addToQueue);
  document.getElementById('clearQueueBtn')?.addEventListener('click', clearPrintQueue);

  // Ctrl+Enter to print
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      const agentBtn = document.getElementById('printAgentBtn');
      if (agentBtn && !agentBtn.disabled && !document.getElementById('outBodyAgent').hidden) {
        agentBtn.click();
      } else {
        const serialBtn = document.getElementById('printSerialBtn');
        if (serialBtn && !document.getElementById('outBodySerial').hidden) serialBtn.click();
      }
    }
    if (e.shiftKey && e.key === 'Enter') {
      e.preventDefault();
      const queueBtn = document.getElementById('addToQueueBtn');
      if (queueBtn && !queueBtn.disabled) queueBtn.click();
    }
  });

  // Shortcuts help
  document.getElementById('shortcutsBtn')?.addEventListener('click', showShortcutsHelp);
  document.getElementById('shortcutsOverlay')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) hideShortcutsHelp();
  });
  document.getElementById('shortcutsCloseBtn')?.addEventListener('click', hideShortcutsHelp);

  // Agent status poll
  pollAgentStatus();
  document.getElementById('printAgentBtn')?.addEventListener('click', printViaAgent);
  document.getElementById('printSerialBtn')?.addEventListener('click', printViaSerial);
}

// ─── Segmented Controls ───────────────────────────────────────────────────────

function initSegmentedControls() {
  // Product type
  initSegCtrl('productTypeSeg', value => {
    document.querySelector(`input[name="productType"][value="${value}"]`).checked = true;
    onProductTypeChange();
  });

  // Measurement system
  initSegCtrl('measureSeg', value => {
    document.querySelector(`input[name="measureSystem"][value="${value}"]`).checked = true;
    onMeasureSystemChange();
  });

  // Spec mode (standard / freeform)
  initSegCtrl('modeSeg', value => {
    specMode = value;
    document.getElementById('standardGroup').hidden = value !== 'standard';
    if (value !== 'standard') clearStandard();
    scheduleRender();
  });

  // ISO/DIN pref
  initSegCtrl('stdPrefSeg', value => {
    document.querySelector(`input[name="stdPref"][value="${value}"]`).checked = true;
    scheduleRender();
  });

  // Image source
  initSegCtrl('imageSourceSeg', value => {
    document.querySelector(`input[name="imageSource"][value="${value}"]`).checked = true;
    onImageSourceChange();
  });

  // Icon position (left / right)
  initSegCtrl('iconPosSeg', value => {
    iconPosition = value;
    scheduleRender();
  });
}

function initSegCtrl(id, onChange) {
  const seg = document.getElementById(id);
  if (!seg) return;
  seg.querySelectorAll('.seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setSegActive(seg, btn.dataset.value);
      onChange(btn.dataset.value);
    });
  });
}

function setSegActive(segEl, value) {
  segEl.querySelectorAll('.seg-btn').forEach(btn => {
    const active = btn.dataset.value === value;
    btn.classList.toggle('seg-active', active);
    btn.setAttribute('aria-checked', String(active));
  });
}

function setSegValue(segId, value) {
  const seg = document.getElementById(segId);
  if (seg) setSegActive(seg, value);
}

// ─── View Chips ───────────────────────────────────────────────────────────────

function initViewChips() {
  const chipImage   = document.getElementById('chipImage');
  const chipQR      = document.getElementById('chipQR');
  const chipMargins = document.getElementById('chipMargins');

  chipImage?.addEventListener('click', () => {
    showImage = !showImage;
    chipImage.classList.toggle('chip-active', showImage);
    scheduleRender();
  });

  chipQR?.addEventListener('click', () => {
    const cb = document.getElementById('showQR');
    cb.checked = !cb.checked;
    chipQR.classList.toggle('chip-active', cb.checked);
    scheduleRender();
  });

  chipMargins?.addEventListener('click', () => {
    const cb = document.getElementById('showMargins');
    cb.checked = !cb.checked;
    chipMargins.classList.toggle('chip-active', cb.checked);
    scheduleRender();
  });

}

// ─── Height Toggle ────────────────────────────────────────────────────────────

function initHeightToggle() {
  document.querySelectorAll('.ht-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ht-btn').forEach(b => b.classList.remove('ht-active'));
      btn.classList.add('ht-active');
      document.querySelector(`input[name="labelHeight"][value="${btn.dataset.h}"]`).checked = true;
      onLabelHeightChange();
    });
  });
}

// ─── Output Tabs ──────────────────────────────────────────────────────────────

function initOutputTabs() {
  document.querySelectorAll('.out-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.out-tab').forEach(t => {
        t.classList.remove('out-tab-active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('out-tab-active');
      tab.setAttribute('aria-selected', 'true');
      const tabId = tab.dataset.tab;
      document.getElementById('outBodyAgent').hidden    = tabId !== 'agent';
      document.getElementById('outBodySerial').hidden   = tabId !== 'serial';
      document.getElementById('outBodyDownload').hidden = tabId !== 'download';
      // sync hidden printPath radio
      if (tabId === 'agent')  document.querySelector('input[name="printPath"][value="agent"]').checked  = true;
      if (tabId === 'serial') document.querySelector('input[name="printPath"][value="serial"]').checked = true;
    });
  });
}

// ─── Batch Mode ───────────────────────────────────────────────────────────────

function getLengths() {
  const raw = document.getElementById('lengthInput').value.trim();
  if (!raw) return [];
  return raw.split(',').map(s => s.trim()).filter(s => s.length > 0);
}

function isBatch() { return getLengths().length > 1; }

function getBatchLength() {
  const lengths = getLengths();
  if (!lengths.length) return '';
  return lengths[Math.min(batchIndex, lengths.length - 1)] || '';
}

function onLengthInput() {
  const lengths = getLengths();
  const n = lengths.length;
  const hint = document.getElementById('batchHint');
  if (n > 1) {
    hint.textContent = `→ ${n} labels will be generated`;
    hint.hidden = false;
    batchIndex = Math.min(batchIndex, n - 1);
  } else {
    hint.hidden = true;
    batchIndex = 0;
  }
  updateBatchUI();
  scheduleRender();
}

function updateBatchUI() {
  const lengths = getLengths();
  const n = lengths.length;
  const batch = n > 1;

  document.getElementById('batchQueueCard').hidden = !batch;
  document.getElementById('batchScrubber').hidden  = !batch;

  if (batch) {
    document.getElementById('batchCount').textContent = String(n);
    document.getElementById('batchPos').textContent   = `${String(batchIndex + 1).padStart(2, '0')} / ${n}`;
    renderBatchQueue(lengths);
    updatePrintBtnLabel();
  } else {
    document.getElementById('batchPos').textContent = '01 / 1';
    updatePrintBtnLabel();
  }
}

function renderBatchQueue(lengths) {
  const content = buildLabelContent();
  const sys  = getMeasureSystem();
  const unit = sys === 'metric' ? '' : '"';
  const size = (sys === 'metric'
    ? document.getElementById('threadSize').value
    : document.getElementById('threadSizeImperial').value) || '—';
  const note = document.getElementById('noteInput').value.trim();
  const heightMm = getLabelHeight();
  const tbody = document.getElementById('batchTableBody');
  tbody.innerHTML = '';

  lengths.forEach((len, i) => {
    const tr = document.createElement('tr');
    if (i === batchIndex) tr.classList.add('bq-row-active');
    const name = size && len ? `${size} × ${len}${unit}` : size || len || '—';
    tr.innerHTML = `
      <td>${String(i + 1).padStart(2, '0')}</td>
      <td>${escHtml(name)}</td>
      <td>${escHtml(len)}${escHtml(unit)}</td>
      <td>${escHtml(note || '—')}</td>
      <td>${LABEL_WIDTH_MM}×${heightMm}mm</td>
      <td class="bq-del" data-idx="${i}">×</td>
    `;
    tr.addEventListener('click', e => {
      if (e.target.dataset.idx !== undefined) return; // handled below
      batchIndex = i;
      updateBatchUI();
      scheduleRender();
    });
    tr.querySelector('.bq-del').addEventListener('click', e => {
      e.stopPropagation();
      const lengths2 = getLengths();
      lengths2.splice(i, 1);
      document.getElementById('lengthInput').value = lengths2.join(', ');
      batchIndex = Math.min(batchIndex, Math.max(0, lengths2.length - 1));
      onLengthInput();
    });
    tbody.appendChild(tr);
  });

  // summary
  const summary = [size, content.secondaryText].filter(Boolean).join(' · ');
  document.getElementById('batchSummary').textContent = summary;
}

function updatePrintBtnLabel() {
  const q = printQueue.length;
  const n = q > 0 ? q : (isBatch() ? getLengths().length : 1);
  const btn = document.getElementById('printAgentBtn');
  if (btn && !btn.disabled) btn.textContent = `Print ${n} label${n > 1 ? 's' : ''} →`;
  const sBtn = document.getElementById('printSerialBtn');
  if (sBtn) sBtn.textContent = n > 1 ? `Connect & Print ${n} labels` : 'Connect & Print';
}

// ─── Print Queue ──────────────────────────────────────────────────────────────

async function addToQueue() {
  const btn = document.getElementById('addToQueueBtn');
  btn.disabled = true;
  btn.textContent = 'Adding…';

  try {
    if (isBatch()) {
      // Add all batch items to the queue
      const lengths = getLengths();
      const savedBatchIndex = batchIndex;
      for (let i = 0; i < lengths.length; i++) {
        batchIndex = i;
        const canvas = await getPrintCanvas();
        const content = buildLabelContent();
        printQueue.push({
          canvas,
          name: content.primaryText || '(untitled)',
          note: content.secondaryText || '',
          heightMm: getLabelHeight(),
        });
      }
      batchIndex = savedBatchIndex;
    } else {
      const canvas = await getPrintCanvas();
      const content = buildLabelContent();
      printQueue.push({
        canvas,
        name: content.primaryText || '(untitled)',
        note: content.secondaryText || '',
        heightMm: getLabelHeight(),
      });
    }
    renderPrintQueue();
    updatePrintBtnLabel();
  } finally {
    btn.disabled = false;
    btn.textContent = '+ Add to Queue';
  }
}

function removeFromQueue(idx) {
  printQueue.splice(idx, 1);
  renderPrintQueue();
  updatePrintBtnLabel();
}

function clearPrintQueue() {
  printQueue.length = 0;
  renderPrintQueue();
  updatePrintBtnLabel();
}

function renderPrintQueue() {
  const card = document.getElementById('printQueueCard');
  const tbody = document.getElementById('printQueueBody');
  const badge = document.getElementById('printQueueCount');
  const n = printQueue.length;

  card.hidden = n === 0;
  badge.textContent = String(n);
  tbody.innerHTML = '';

  const heightMm = getLabelHeight();
  printQueue.forEach((item, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${String(i + 1).padStart(2, '0')}</td>
      <td>${escHtml(item.name)}</td>
      <td>${escHtml(item.note || '—')}</td>
      <td>${LABEL_WIDTH_MM}×${item.heightMm}mm</td>
      <td class="bq-del" data-idx="${i}">×</td>
    `;
    tr.querySelector('.bq-del').addEventListener('click', e => {
      e.stopPropagation();
      removeFromQueue(i);
    });
    tbody.appendChild(tr);
  });
}

function shouldClearQueueAfterPrint() {
  return document.getElementById('clearQueueOnPrint')?.checked ?? false;
}

function showShortcutsHelp() {
  document.getElementById('shortcutsOverlay').hidden = false;
}

function hideShortcutsHelp() {
  document.getElementById('shortcutsOverlay').hidden = true;
}

// ─── UI State Changes ─────────────────────────────────────────────────────────

function onProductTypeChange() {
  const isFastener = getProductType() === 'fastener';
  const measureSys = document.querySelector('input[name="measureSystem"]:checked').value;

  document.getElementById('fastenerSection').hidden = !isFastener;
  document.getElementById('generalSection').hidden  = isFastener;
  document.getElementById('standardPrefGroup').hidden = true;

  if (!isFastener && getImageSource() === 'drawing') {
    document.querySelector('input[name="imageSource"][value="none"]').checked = true;
    setSegValue('imageSourceSeg', 'none');
    onImageSourceChange();
  } else if (isFastener && getImageSource() === 'none') {
    document.querySelector('input[name="imageSource"][value="drawing"]').checked = true;
    setSegValue('imageSourceSeg', 'drawing');
    onImageSourceChange();
  }

  // Sync seg controls
  setSegValue('productTypeSeg', isFastener ? 'fastener' : 'general');

  // Drawing option only valid for fasteners
  const drawingBtn = document.querySelector('#imageSourceSeg .seg-btn[data-value="drawing"]');
  if (drawingBtn) drawingBtn.hidden = !isFastener;

  scheduleRender();
}

function onMeasureSystemChange() {
  const isMetric = getMeasureSystem() === 'metric';
  document.getElementById('threadMetricGroup').hidden = !isMetric;
  document.getElementById('threadImperialGroup').hidden = isMetric;
  document.getElementById('lengthLabel').textContent = isMetric ? 'Length (mm)' : 'Length (in)';
  scheduleRender();
}

function onLabelHeightChange() {
  const h = getLabelHeight();
  document.getElementById('labelSizeInfo').textContent = `${LABEL_WIDTH_MM}.0 × ${h}.0 mm`;
  updateLabelPxInfo();
  scheduleRender();
}

function updateLabelPxInfo() {
  const scale = getPrintScale();
  const h = getLabelHeight();
  const pw = (LABEL_WIDTH_MM + LABEL_MARGIN_LEFT * 2) * scale;
  const ph = (h + LABEL_MARGIN_TOP * 2) * scale;
  const el = document.getElementById('labelPxInfo');
  if (el) el.textContent = `${Math.round(pw)} × ${Math.round(ph)} px @ ${scale} px/mm`;
}

function onImageSourceChange() {
  const src = getImageSource();
  document.getElementById('mdiPickerGroup').hidden    = src !== 'mdi';
  document.getElementById('customPickerGroup').hidden = src !== 'custom';
  scheduleRender();
}


let searchHighlightIdx = -1;

// ─── Getters ──────────────────────────────────────────────────────────────────

function getProductType() {
  return document.querySelector('input[name="productType"]:checked')?.value || 'fastener';
}

function getMeasureSystem() {
  return document.querySelector('input[name="measureSystem"]:checked')?.value || 'metric';
}

function getLabelHeight() {
  return parseInt(document.querySelector('input[name="labelHeight"]:checked')?.value || '12', 10);
}

function getStdPref() {
  return document.querySelector('input[name="stdPref"]:checked')?.value || 'auto';
}

function getPrintScale() {
  return parseInt(document.getElementById('printScale').value, 10) || 12;
}

function getPrintDpi() {
  return document.getElementById('highQualityPrint')?.checked ? PRINT_DPI_HIGH : PRINT_DPI_STD;
}

function getImageSource() {
  return document.querySelector('input[name="imageSource"]:checked')?.value || 'drawing';
}

function getActiveIcon() {
  const src = getImageSource();
  if (src === 'mdi')    return selectedMdiIcon;
  if (src === 'custom') return selectedCustomIcon;
  return null;
}


















// ─── Favorites ────────────────────────────────────────────────────────────────

function getFavorites() {
  try { return JSON.parse(localStorage.getItem(LS_FAV_KEY)) || { icons: [], standards: [] }; }
  catch { return { icons: [], standards: [] }; }
}

function saveFavorites(fav) {
  localStorage.setItem(LS_FAV_KEY, JSON.stringify(fav));
}

function toggleFavoriteIcon() {
  if (!selectedMdiIcon) return;
  const fav = getFavorites();
  const idx = fav.icons.findIndex(f => f.type === selectedMdiIcon.type && f.name === selectedMdiIcon.name);
  if (idx >= 0) fav.icons.splice(idx, 1);
  else fav.icons.unshift({ ...selectedMdiIcon });
  saveFavorites(fav);
  updateStarButtons();
  renderFavoritesPanel();
}

function toggleFavoriteStandard() {
  if (!selectedStandard) return;
  const fav = getFavorites();
  const idx = fav.standards.findIndex(f => f.id === selectedStandard.id);
  if (idx >= 0) fav.standards.splice(idx, 1);
  else fav.standards.unshift({ ...selectedStandard });
  saveFavorites(fav);
  updateStarButtons();
  renderFavoritesPanel();
}

function updateStarButtons() {
  const fav = getFavorites();
  const iconBtn = document.getElementById('starIconBtn');
  if (iconBtn) {
    const starred = selectedMdiIcon && fav.icons.some(f => f.name === selectedMdiIcon.name && f.type === selectedMdiIcon.type);
    iconBtn.textContent = starred ? '★' : '☆';
    iconBtn.classList.toggle('starred', !!starred);
  }
  const stdBtn = document.getElementById('starStandardBtn');
  if (stdBtn) {
    const starred = selectedStandard && fav.standards.some(f => f.id === selectedStandard.id);
    stdBtn.textContent = starred ? '★' : '☆';
    stdBtn.classList.toggle('starred', !!starred);
  }
}

function renderFavStrip() {
  const fav = getFavorites();
  const container = document.getElementById('favChips');
  if (!container) return;
  container.innerHTML = '';

  fav.standards.forEach(std => {
    const chip = document.createElement('button');
    chip.className = 'fav-chip-strip';
    const label = std.designations.map(d => `${d.system} ${d.code}`).join(' / ');
    chip.title = label;
    const span = document.createElement('span');
    span.textContent = label;
    chip.appendChild(span);
    chip.addEventListener('click', () => {
      if (getProductType() !== 'fastener') {
        document.querySelector('input[name="productType"][value="fastener"]').checked = true;
        onProductTypeChange();
      }
      selectStandard(std);
    });
    container.appendChild(chip);
  });

  fav.icons.forEach(icon => {
    const chip = document.createElement('button');
    chip.className = 'fav-chip-strip';
    chip.title = icon.name;

    const iconBox = document.createElement('span');
    iconBox.className = 'chip-icon';
    if (icon.type === 'mdi') {
      const img = document.createElement('img');
      img.src = mdiIconImgUrl(icon.name);
      img.alt = icon.name;
      iconBox.appendChild(img);
    } else {
      const cv = document.createElement('canvas');
      cv.width = 12; cv.height = 12;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.setTransform(12 / 24, 0, 0, 12 / 24, 0, 0);
      try { ctx.fill(new Path2D(icon.path)); } catch { /* bad path */ }
      ctx.resetTransform();
      iconBox.appendChild(cv);
    }
    const label = document.createElement('span');
    label.textContent = icon.name;
    chip.append(iconBox, label);
    chip.addEventListener('click', () => {
      selectedMdiIcon = { ...icon };
      document.querySelector('input[name="imageSource"][value="mdi"]').checked = true;
      setSegValue('imageSourceSeg', 'mdi');
      onImageSourceChange();
      showSelectedMdiIcon();
      updateStarButtons();
      scheduleRender();
    });
    container.appendChild(chip);
  });
}

function renderFavoritesPanel() {
  renderFavStrip();
  const fav = getFavorites();
  const hasIcons = fav.icons.length > 0;
  const hasStds  = fav.standards.length > 0;
  const isEmpty  = !hasIcons && !hasStds;

  document.getElementById('favEmpty').hidden = !isEmpty;
  document.getElementById('favIconsSection').hidden = !hasIcons;
  document.getElementById('favStandardsSection').hidden = !hasStds;

  // Icons
  const iconsGrid = document.getElementById('favIconsGrid');
  iconsGrid.innerHTML = '';
  fav.icons.forEach(icon => {
    const chip = document.createElement('div');
    chip.className = 'fav-icon-chip';
    chip.title = icon.name;
    if (icon.type === 'mdi') {
      const img = document.createElement('img');
      img.src = mdiIconImgUrl(icon.name);
      img.alt = icon.name;
      chip.appendChild(img);
    }
    const label = document.createElement('span');
    label.textContent = icon.name;
    chip.appendChild(label);
    chip.addEventListener('click', () => {
      selectedMdiIcon = { ...icon };
      document.querySelector('input[name="imageSource"][value="mdi"]').checked = true;
      onImageSourceChange();
      showSelectedMdiIcon();
      updateStarButtons();
      scheduleRender();
    });
    iconsGrid.appendChild(chip);
  });

  // Standards
  const stdsGrid = document.getElementById('favStandardsGrid');
  stdsGrid.innerHTML = '';
  fav.standards.forEach(std => {
    const chip = document.createElement('div');
    chip.className = 'fav-standard-chip';
    const label = std.designations.map(d => `${d.system} ${d.code}`).join(' / ');
    const span = document.createElement('span');
    span.textContent = label;
    chip.appendChild(span);
    chip.addEventListener('click', () => {
      if (getProductType() !== 'fastener') {
        document.querySelector('input[name="productType"][value="fastener"]').checked = true;
        onProductTypeChange();
      }
      selectStandard(std);
    });
    stdsGrid.appendChild(chip);
  });
}

function exportFavorites() {
  const fav = getFavorites();
  const blob = new Blob([JSON.stringify(fav, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'gfl-favorites.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

async function onImportFavorites(e) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';
  try {
    const text = await file.text();
    const imported = JSON.parse(text);
    if (!Array.isArray(imported.icons) && !Array.isArray(imported.standards))
      throw new Error('Not a valid GFL favorites file');
    const overwrite = window.confirm(
      'Import favorites:\n\nOK → Replace all existing favorites\nCancel → Add to existing favorites'
    );
    if (overwrite) {
      saveFavorites({ icons: imported.icons ?? [], standards: imported.standards ?? [] });
    } else {
      const fav = getFavorites();
      for (const icon of (imported.icons ?? [])) {
        if (!fav.icons.some(f => f.name === icon.name && f.type === icon.type))
          fav.icons.push(icon);
      }
      for (const std of (imported.standards ?? [])) {
        if (!fav.standards.some(f => f.id === std.id))
          fav.standards.push(std);
      }
      saveFavorites(fav);
    }
    renderFavoritesPanel();
    updateStarButtons();
  } catch (err) {
    alert(`Import failed: ${err.message}`);
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Start ────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
