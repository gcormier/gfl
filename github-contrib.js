'use strict';

// ─── GitHub Contribution Flow ─────────────────────────────────────────────────
// Static-site safe: no OAuth, no API tokens, no backend. Opens GitHub's
// "create new file" page in a new tab, pre-filled with a single SVG file under
// images/custom/. GitHub handles fork + branch + commit + PR through its own UI.
// CI regenerates custom-icons.json from the directory, so contributors only ever
// touch one file.

const GH_ORIGIN = 'gcormier/gfl';
const GH_BRANCH = 'main';

function _sanitizeId(raw) {
  return (raw || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '');
}

function _escXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Inject <title> (name) and <desc> (keywords) metadata into the exported SVG so
// the icon-manifest generator can read it back. The frontend reads only the
// first <path d="…">, but the metadata is what makes the icon searchable.
function _svgWithMetadata(svgMarkup, name, keywords) {
  const meta = `\n  <title>${_escXml(name)}</title>\n  <desc>${_escXml(keywords)}</desc>`;
  return svgMarkup.replace(/(<svg\b[^>]*>)/, `$1${meta}`);
}

function _buildNewFileUrl(id, content, isUpdate) {
  const params = new URLSearchParams({
    filename: `${id}.svg`,
    value: content,
    message: `${isUpdate ? 'Update' : 'Add'} custom icon: ${id}`,
    description: 'Contributed via the GFL in-browser image editor.',
  });
  return `https://github.com/${GH_ORIGIN}/new/${GH_BRANCH}/images/custom?${params.toString()}`;
}

// ─── Modal UI ─────────────────────────────────────────────────────────────────

let _pendingSvg = '';

// Called by jscad-editor.js with the exported SVG markup (single <path>).
function openContribModal(svgMarkup) {
  const overlay = document.getElementById('contribOverlay');
  if (!overlay) return;

  _pendingSvg = svgMarkup || '';

  const errEl = document.getElementById('contribErrorMsg');
  if (errEl) errEl.textContent = '';

  // Pre-fill fields and adjust title when editing an existing gallery icon
  const meta = typeof getGalleryMeta === 'function' ? getGalleryMeta() : null;
  const titleEl = document.getElementById('contribModalTitle');
  const nameInput = document.getElementById('contribNameInput');
  const kwInput   = document.getElementById('contribKeywordsInput');
  const idInput   = document.getElementById('contribStdIdInput');
  const hintEl    = document.getElementById('contribHintNew');

  if (meta) {
    if (titleEl)   titleEl.textContent = 'Update Gallery Icon';
    if (nameInput) nameInput.value = meta.name;
    if (kwInput)   kwInput.value   = meta.keywords;
    if (idInput)   idInput.value   = meta.id;
    if (hintEl)    hintEl.textContent = 'Clicking Open on GitHub opens a tab pre-filled with the updated SVG. GitHub will offer to fork the repo and open a pull request replacing the existing file — no authentication required here.';
  } else {
    if (titleEl) titleEl.textContent = 'Contribute to Gallery as PR';
    if (nameInput) nameInput.value = '';
    if (kwInput)   kwInput.value   = '';
    if (idInput)   idInput.value   = '';
    if (hintEl)    hintEl.textContent = 'Clicking Open on GitHub opens a new tab on github.com with the SVG file pre-filled. GitHub will offer to fork the repo and open a pull request — no authentication required here. Once merged it appears under Icon → Gallery for everyone.';
  }

  overlay.hidden = false;
  if (nameInput) setTimeout(() => nameInput.focus(), 0);
}

function submitContribModal() {
  const errEl = document.getElementById('contribErrorMsg');
  const setErr = msg => { if (errEl) errEl.textContent = msg; };

  const name     = (document.getElementById('contribNameInput')?.value || '').trim();
  const keywords = (document.getElementById('contribKeywordsInput')?.value || '').trim();
  const idRaw    = (document.getElementById('contribStdIdInput')?.value || '').trim();
  const id       = _sanitizeId(idRaw || name);

  if (!name)     { setErr('Please enter a name.'); return; }
  if (!keywords) { setErr('Please enter at least one keyword.'); return; }
  if (!id)       { setErr('Please enter a filename id (letters, digits, dashes).'); return; }
  if (!_pendingSvg) { setErr('No shape to submit — run your design first.'); return; }

  const meta     = typeof getGalleryMeta === 'function' ? getGalleryMeta() : null;
  const isUpdate = !!(meta && meta.id === id);
  const content  = _svgWithMetadata(_pendingSvg, name, keywords);
  const url      = _buildNewFileUrl(id, content, isUpdate);

  // URL length cap: GitHub silently rejects very long URLs (~8KB practical limit).
  if (url.length > 7800) {
    setErr('This shape is too detailed for the URL-based flow. Try the Simplify slider, or open a PR manually.');
    return;
  }

  window.open(url, '_blank', 'noopener');
  closeContribModal();
}

function closeContribModal() {
  const overlay = document.getElementById('contribOverlay');
  if (overlay) overlay.hidden = true;
}
