'use strict';

// ─── GitHub Contribution Flow ─────────────────────────────────────────────────
// Static-site safe: no OAuth, no API tokens, no backend. Opens GitHub's
// "create new file" page in a new tab, pre-filled with the standard contents.
// GitHub handles fork + branch + commit + PR through its own UI.

const GH_ORIGIN = 'gcormier/gfl';
const GH_BRANCH = 'main';

function buildStandardFile(id, code) {
  return `registerJscadStandard('${id}', \`\n${code}\n\`);\n`;
}

function _sanitizeId(raw) {
  return (raw || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
}

function _buildNewFileUrl(id, code) {
  const filename = `${id}.js`;
  const content = buildStandardFile(id, code);
  const params = new URLSearchParams({
    filename,
    value: content,
    message: `Add JSCad standard: ${id}`,
    description: 'Contributed via the GFL in-browser editor.',
  });
  return `https://github.com/${GH_ORIGIN}/new/${GH_BRANCH}/standards-jscad?${params.toString()}`;
}

function _buildEditFileUrl(id) {
  // GitHub's /edit/ endpoint does not support pre-filling content via URL params.
  // We copy content to clipboard and ask the user to paste.
  return `https://github.com/${GH_ORIGIN}/edit/${GH_BRANCH}/standards-jscad/${id}.js`;
}

// ─── Modal UI ─────────────────────────────────────────────────────────────────

let _pendingCode = '';
let _pendingIsExisting = false;

function openContribModal(standardId, code, isExisting) {
  console.log('[github-contrib] openContribModal standardId=', standardId, 'isExisting=', isExisting);
  const overlay = document.getElementById('contribOverlay');
  if (!overlay) return;

  _pendingCode = code || '';
  _pendingIsExisting = !!isExisting;

  const title = document.getElementById('contribModalTitle');
  const idRow = document.getElementById('contribIdRow');
  const input = document.getElementById('contribStdIdInput');
  const errEl = document.getElementById('contribErrorMsg');

  const hintNew  = document.getElementById('contribHintNew');
  const hintEdit = document.getElementById('contribHintEdit');

  if (_pendingIsExisting) {
    if (title)    title.textContent = 'Propose Changes to Standard';
    if (idRow)    idRow.hidden    = true;
    if (hintNew)  hintNew.hidden  = true;
    if (hintEdit) hintEdit.hidden = false;
  } else {
    if (title)    title.textContent = 'Submit New Standard as PR';
    if (idRow)    idRow.hidden    = false;
    if (hintNew)  hintNew.hidden  = false;
    if (hintEdit) hintEdit.hidden = true;
    if (input) {
      input.value = standardId ? _sanitizeId(standardId) : '';
      setTimeout(() => input.focus(), 0);
    }
  }

  if (errEl) errEl.textContent = '';
  overlay.hidden = false;
  _pendingId = standardId ? _sanitizeId(standardId) : '';
}

let _pendingId = '';

function submitContribModal() {
  const errEl = document.getElementById('contribErrorMsg');

  let id;
  if (_pendingIsExisting) {
    id = _pendingId;
  } else {
    const input = document.getElementById('contribStdIdInput');
    id = _sanitizeId(input ? input.value : '');
  }

  if (!id) {
    if (errEl) errEl.textContent = 'Please enter a standard ID (letters, digits, dashes).';
    return;
  }

  if (_pendingIsExisting) {
    const content = buildStandardFile(id, _pendingCode);
    console.log('[github-contrib] modify flow — copying to clipboard, content length=', content.length);
    navigator.clipboard.writeText(content)
      .then(() => console.log('[github-contrib] clipboard write succeeded'))
      .catch(err => console.warn('[github-contrib] clipboard write failed:', err));
    window.open(_buildEditFileUrl(id), '_blank', 'noopener');
    closeContribModal();
    return;
  }

  const url = _buildNewFileUrl(id, _pendingCode);
  // URL length cap: GitHub silently rejects very long URLs (~8KB practical limit)
  if (url.length > 7800) {
    if (errEl) errEl.textContent = 'Standard code is too large for the URL-based flow. Please open a PR manually.';
    return;
  }
  window.open(url, '_blank', 'noopener');
  closeContribModal();
}

function closeContribModal() {
  const overlay = document.getElementById('contribOverlay');
  if (overlay) overlay.hidden = true;
}
