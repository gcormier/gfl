
// ─── JSCad State ──────────────────────────────────────────────────────────────

let selectedJscadOutlines = null;
let selectedJscadBbox     = null;

function setJscadResult(outlines, bbox) {
  selectedJscadOutlines = outlines;
  selectedJscadBbox     = bbox;
}

async function loadJscadStandard(id) {
  const url = assetUrl('standards-jscad/' + id + '.js');
  return new Promise((resolve, reject) => {
    if (typeof _jscadRegistry !== 'undefined' && _jscadRegistry.has(id)) {
      const { code } = _jscadRegistry.get(id);
      resolve(code);
      return;
    }
    const callbacks = (typeof _jscadPending !== 'undefined' && _jscadPending.get(id)) || [];
    if (typeof _jscadPending !== 'undefined') {
      callbacks.push({ resolve, reject });
      _jscadPending.set(id, callbacks);
    }
    if (!document.querySelector(`script[data-jscad="${id}"]`)) {
      const s = document.createElement('script');
      s.src = url;
      s.dataset.jscad = id;
      s.onerror = () => reject(new Error('Failed to load standard: ' + id));
      document.head.appendChild(s);
    }
    setTimeout(() => {
      if (typeof _jscadPending !== 'undefined' && _jscadPending.has(id)) {
        _jscadPending.delete(id);
        reject(new Error('Timeout loading standard: ' + id));
      }
    }, 8000);
  });
}

async function loadStandards() {
  try {
    const res = await fetch(assetUrl('standards.json'));
    standards = await res.json();
  } catch (e) {
    console.error('Failed to load standards:', e);
  }
}
// ─── Standard Search ──────────────────────────────────────────────────────────

function onStandardSearch(e) {
  const q = e.target.value.trim().toLowerCase();
  const results = document.getElementById('searchResults');

  if (q.length < 1) {
    results.hidden = true;
    return;
  }

  const matches = standards.filter(s => {
    if (s.description.toLowerCase().includes(q)) return true;
    if (s.id.toLowerCase().includes(q)) return true;
    for (const d of s.designations) {
      if (`${d.system} ${d.code}`.toLowerCase().includes(q)) return true;
      if (d.system.toLowerCase() === q || d.code.toLowerCase() === q) return true;
    }
    return false;
  }).slice(0, 20);

  results.innerHTML = '';
  if (matches.length === 0) {
    results.innerHTML = '<div class="search-no-results">No results</div>';
  } else {
    matches.forEach(s => {
      const item = document.createElement('div');
      item.className = 'search-item';
      item.dataset.id = s.id;
      const label = s.designations.map(d => `${d.system} ${d.code}`).join(' / ');
      item.innerHTML = `
        <span class="search-item-code">${escHtml(label)}</span>
        <span class="search-item-desc">${escHtml(s.description.slice(0, 80))}</span>
      `;
      item.addEventListener('click', () => selectStandard(s));
      results.appendChild(item);
    });
  }
  results.hidden = false;
}
function onSearchKeydown(e) {
  const results = document.getElementById('searchResults');
  const items = results.querySelectorAll('.search-item');
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    searchHighlightIdx = Math.min(searchHighlightIdx + 1, items.length - 1);
    updateHighlight(items);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    searchHighlightIdx = Math.max(searchHighlightIdx - 1, 0);
    updateHighlight(items);
  } else if (e.key === 'Enter' && searchHighlightIdx >= 0 && items[searchHighlightIdx]) {
    items[searchHighlightIdx].click();
  } else if (e.key === 'Escape') {
    results.hidden = true;
  }
}

function updateHighlight(items) {
  items.forEach((el, i) => el.classList.toggle('highlighted', i === searchHighlightIdx));
}

function selectStandard(s) {
  selectedStandard = s;
  document.getElementById('searchResults').hidden = true;
  document.getElementById('standardSearch').value = '';
  searchHighlightIdx = -1;

  const box = document.getElementById('selectedStandard');
  const img = document.getElementById('standardImage');
  const name = document.getElementById('standardName');
  const desc = document.getElementById('standardDesc');
  const prefGroup = document.getElementById('standardPrefGroup');

  const label = s.designations.map(d => `${d.system} ${d.code}`).join(' / ');
  name.textContent = label;
  desc.textContent = s.description.slice(0, 100);

  if (s.image) {
    img.src = assetUrl(s.image);
    img.hidden = false;
  } else {
    img.hidden = true;
  }
  box.hidden = false;

  // Show ISO/DIN preference if standard has both
  const systems = new Set(s.designations.map(d => d.system));
  prefGroup.hidden = !(systems.has('ISO') && systems.has('DIN'));

  updateStarButtons();

  scheduleRender();
}

function clearStandard() {
  selectedStandard = null;
  selectedJscadOutlines = null;
  selectedJscadBbox     = null;
  document.getElementById('selectedStandard').hidden = true;
  document.getElementById('standardPrefGroup').hidden = true;
  document.getElementById('standardSearch').value = '';
  updateStarButtons();
  scheduleRender();
}
// ─── MDI Icon Picker ──────────────────────────────────────────────────────────

async function loadMdiMeta() {
  if (mdiMeta) return mdiMeta;
  const res = await fetch(`${MDI_BASE}/meta.json`);
  mdiMeta = await res.json();
  return mdiMeta;
}

async function fetchMdiPath(name) {
  const res = await fetch(`${MDI_BASE}/svg/${name}.svg`);
  const text = await res.text();
  const m = text.match(/\sd="([^"]+)"/);
  return m ? m[1] : null;
}

function searchMdiIcons(query, limit = 36) {
  if (!mdiMeta) return [];
  const q = query.toLowerCase().replace(/-/g, ' ');
  const scored = [];
  for (const icon of mdiMeta) {
    const name = icon.name.replace(/-/g, ' ');
    let score = 0;
    if (name === q)                                                   score = 100;
    else if (name.startsWith(q))                                      score = 80;
    else if (name.includes(q))                                        score = 60;
    else if (icon.aliases?.some(a => a.replace(/-/g, ' ').includes(q))) score = 40;
    else if (icon.tags?.some(t => t.toLowerCase().includes(q)))      score = 20;
    if (score) scored.push({ icon, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(s => s.icon);
}

function mdiIconImgUrl(name) {
  return `${MDI_BASE}/svg/${name}.svg`;
}

async function onMdiSearch(e) {
  const q = e.target.value.trim().toLowerCase();
  const results = document.getElementById('iconSearchResults');

  if (q.length < 2) {
    showFavoriteIconsInResults(results);
    return;
  }

  try {
    await loadMdiMeta();
  } catch {
    results.innerHTML = '<div class="search-no-results">Could not load icon library</div>';
    results.hidden = false;
    return;
  }

  const matches = searchMdiIcons(q);
  results.innerHTML = '';

  if (matches.length === 0) {
    results.innerHTML = '<div class="search-no-results">No icons found</div>';
  } else {
    const grid = document.createElement('div');
    grid.className = 'icon-grid';
    matches.forEach(icon => grid.appendChild(createIconGridItem(icon.name)));
    results.appendChild(grid);
  }
  results.hidden = false;
}

function showFavoriteIconsInResults(results) {
  const favs = getFavorites();
  results.innerHTML = '';
  if (favs.icons.length === 0) { results.hidden = true; return; }
  const hdr = document.createElement('div');
  hdr.className = 'icon-search-section-header';
  hdr.textContent = 'Favorites';
  results.appendChild(hdr);
  const grid = document.createElement('div');
  grid.className = 'icon-grid';
  favs.icons.forEach(fav => grid.appendChild(createIconGridItem(fav.name, fav.path)));
  results.appendChild(grid);
  results.hidden = false;
}

function createIconGridItem(name, cachedPath) {
  const item = document.createElement('div');
  item.className = 'icon-grid-item';
  item.title = name;
  const img = document.createElement('img');
  img.src = mdiIconImgUrl(name);
  img.alt = name;
  img.width = 28;
  img.height = 28;
  const label = document.createElement('span');
  label.textContent = name.replace(/-/g, '‑'); // non-breaking hyphens
  item.append(img, label);
  item.addEventListener('click', () => selectMdiIcon(name, cachedPath));
  return item;
}

async function selectMdiIcon(name, cachedPath) {
  document.getElementById('mdiSearch').value = '';
  document.getElementById('iconSearchResults').hidden = true;
  const path = cachedPath ?? await fetchMdiPath(name);
  if (!path) { alert(`Could not load icon: ${name}`); return; }
  selectedMdiIcon = { type: 'mdi', name, path };
  showSelectedMdiIcon();
  updateStarButtons();
  scheduleRender();
}

function showSelectedMdiIcon() {
  if (!selectedMdiIcon) {
    document.getElementById('selectedIconDisplay').hidden = true;
    return;
  }
  document.getElementById('selectedIconName').textContent = selectedMdiIcon.name;
  const canvas = document.getElementById('iconPreviewCanvas');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 36, 36);
  ctx.fillStyle = '#000';
  ctx.setTransform(36 / 24, 0, 0, 36 / 24, 0, 0);
  try { ctx.fill(new Path2D(selectedMdiIcon.path)); } catch { /* bad path */ }
  ctx.resetTransform();
  document.getElementById('selectedIconDisplay').hidden = false;
}

function clearMdiIcon() {
  selectedMdiIcon = null;
  document.getElementById('selectedIconDisplay').hidden = true;
  document.getElementById('mdiSearch').value = '';
  updateStarButtons();
  scheduleRender();
}

async function onSvgUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  const m = text.match(/\sd="([^"]+)"/);
  if (!m) { alert('No path data found in this SVG file.'); e.target.value = ''; return; }
  selectedMdiIcon = { type: 'svg', name: file.name.replace(/\.svg$/i, ''), path: m[1] };
  showSelectedMdiIcon();
  updateStarButtons();
  scheduleRender();
  e.target.value = '';
}
// ─── Custom Icon Picker ───────────────────────────────────────────────────────

async function loadCustomIcons() {
  if (customIconsMeta) return customIconsMeta;
  try {
    const res = await fetch(assetUrl('custom-icons.json'));
    const entries = await res.json();
    // Fetch each SVG file and extract the path d attribute
    customIconsMeta = await Promise.all(entries.map(async icon => {
      if (icon.path) return icon;           // legacy inline path still works
      if (!icon.file) return icon;
      try {
        const svgRes = await fetch(assetUrl('images/custom/' + icon.file));
        const text = await svgRes.text();
        const m = text.match(/\sd="([^"]+)"/);
        if (m) icon.path = m[1];
      } catch { /* SVG fetch failed — icon will be skipped */ }
      return icon;
    }));
  } catch {
    customIconsMeta = [];
  }
  return customIconsMeta;
}

async function onCustomIconSearch(e) {
  const q = e.target.value.trim().toLowerCase();
  const results = document.getElementById('customIconSearchResults');

  await loadCustomIcons();

  if (q.length < 1) {
    results.hidden = true;
    return;
  }

  const matches = customIconsMeta.filter(icon =>
    icon.name.toLowerCase().includes(q) ||
    icon.tags?.some(t => t.toLowerCase().includes(q))
  ).slice(0, 36);

  results.innerHTML = '';
  if (matches.length === 0) {
    results.innerHTML = '<div class="search-no-results">No custom icons found</div>';
  } else {
    const grid = document.createElement('div');
    grid.className = 'icon-grid';
    matches.forEach(icon => {
      const item = document.createElement('div');
      item.className = 'icon-grid-item';
      item.title = icon.name;
      const cv = document.createElement('canvas');
      cv.width = 28; cv.height = 28;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#000';
      ctx.setTransform(28 / 24, 0, 0, 28 / 24, 0, 0);
      try { ctx.fill(new Path2D(icon.path)); } catch { /* bad path */ }
      ctx.resetTransform();
      const label = document.createElement('span');
      label.textContent = icon.name;
      item.append(cv, label);
      item.addEventListener('click', () => selectCustomIcon(icon));
      grid.appendChild(item);
    });
    results.appendChild(grid);
  }
  results.hidden = false;
}

function selectCustomIcon(icon) {
  document.getElementById('customIconSearch').value = '';
  document.getElementById('customIconSearchResults').hidden = true;
  selectedCustomIcon = { id: icon.id, name: icon.name, path: icon.path };
  showSelectedCustomIcon();
  scheduleRender();
}

function showSelectedCustomIcon() {
  if (!selectedCustomIcon) {
    document.getElementById('selectedCustomIconDisplay').hidden = true;
    return;
  }
  document.getElementById('selectedCustomIconName').textContent = selectedCustomIcon.name;
  const canvas = document.getElementById('customIconPreviewCanvas');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 36, 36);
  ctx.fillStyle = '#000';
  ctx.setTransform(36 / 24, 0, 0, 36 / 24, 0, 0);
  try { ctx.fill(new Path2D(selectedCustomIcon.path)); } catch { /* bad path */ }
  ctx.resetTransform();
  document.getElementById('selectedCustomIconDisplay').hidden = false;
}

function clearCustomIcon() {
  selectedCustomIcon = null;
  document.getElementById('selectedCustomIconDisplay').hidden = true;
  document.getElementById('customIconSearch').value = '';
  scheduleRender();
}

function buildDesignationText(standard, preference) {
  const designations = standard.designations;
  if (preference === 'auto') {
    // Show only the primary system's designation
    const primary = designations.filter(d => d.system === standard.primarySystem);
    const use = primary.length ? primary : designations;
    return use.map(d => `${d.system} ${d.code}`).join(' / ');
  }
  // ISO or DIN: show only designations matching the chosen system
  const filtered = designations.filter(d => d.system === preference);
  const use = filtered.length ? filtered : designations;
  return use.map(d => `${d.system} ${d.code}`).join(' / ');
}

function buildLabelContent() {
  const type = getProductType();
  let primaryText = '';
  let secondaryText = '';

  if (type === 'fastener') {
    const sys = getMeasureSystem();
    const size = sys === 'metric'
      ? document.getElementById('threadSize').value
      : document.getElementById('threadSizeImperial').value;
    const length = getBatchLength();
    const note = document.getElementById('noteInput').value.trim();

    if (size) {
      primaryText = length ? `${size} × ${length}${sys === 'metric' ? '' : '"'}` : size;
    }

    if (selectedStandard && specMode === 'standard') {
      secondaryText = buildDesignationText(selectedStandard, getStdPref());
    }

    if (note && !secondaryText) secondaryText = note;
    else if (note) primaryText += ` (${note})`;
  } else {
    primaryText = document.getElementById('generalName').value.trim();
    const note = document.getElementById('noteInput').value.trim();
    if (note) secondaryText = note;
  }

  const imgSrc = showImage ? getImageSource() : 'none';
  const activeIcon = getActiveIcon();
  return {
    primaryText,
    secondaryText,
    imageSource: imgSrc,
    iconPath: (imgSrc === 'mdi' || imgSrc === 'custom') ? (activeIcon?.path ?? null) : null,
    iconPosition,
    showQRCode: document.getElementById('showQR').checked,
    showMargins: document.getElementById('showMargins').checked,
    qrCodeUrl: document.getElementById('qrUrl').value.trim(),
    standard: selectedStandard,
    jscadOutlines: (imgSrc === 'drawing') ? selectedJscadOutlines : null,
    jscadBbox:     (imgSrc === 'drawing') ? selectedJscadBbox     : null,
  };
}
const MDI_VERSION  = '7.4.47';
const MDI_BASE     = `https://cdn.jsdelivr.net/npm/@mdi/svg@${MDI_VERSION}`;
