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

function _buildNewFileUrl(id, content) {
  const params = new URLSearchParams({
    filename: `${id}.svg`,
    value: content,
    message: `Add custom icon: ${id}`,
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
  overlay.hidden = false;
}

function submitContribModal() {
  const errEl = document.getElementById('contribErrorMsg');
  const setErr = msg => { if (errEl) errEl.textContent = msg; };

  // Read metadata from the inline form fields (section 02)
  const name     = (document.getElementById('iconMetaName')?.value || '').trim();
  const keywords = (document.getElementById('iconMetaKeywords')?.value || '').trim();
  const idRaw    = (document.getElementById('iconMetaId')?.value || '').trim();
  const id       = _sanitizeId(idRaw || name);

  if (!name)     { setErr('Please fill in a Name in the Metadata section.'); return; }
  if (!keywords) { setErr('Please fill in Keywords in the Metadata section.'); return; }
  if (!id)       { setErr('Please fill in a Filename ID in the Metadata section.'); return; }
  if (!_pendingSvg) { setErr('No shape to submit — run your design first.'); return; }

  const content = _svgWithMetadata(_pendingSvg, name, keywords);
  const url = _buildNewFileUrl(id, content);

  // URL length cap: GitHub silently rejects very long URLs (~8KB practical limit).
  if (url.length > 7800) {
    setErr('Shape is too complex for the URL-based flow. Try the Simplify slider, or use Export SVG ↓ (metadata is already embedded) and open a PR manually.');
    return;
  }

  window.open(url, '_blank', 'noopener');
  closeContribModal();
}

function closeContribModal() {
  const overlay = document.getElementById('contribOverlay');
  if (overlay) overlay.hidden = true;
}
