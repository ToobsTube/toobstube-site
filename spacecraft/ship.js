// ---- State ----
const state = {
  items: [], // full recipes.json, kept around so "Gather materials" links and
             // su lookups work the same way the crafter does
  parts: [], // just the Ship Parts group
  subcategory: 'All',
  onlyUnlocked: false,
  build: [], // [{ id, qty }]
  progress: { levels: { Exploration: 0, Science: 0, Technology: 0, Social: 0 }, nodes: {}, analysisCounts: {} },
};

const BUILD_STORAGE_KEY = 'spacecraft-ship-build';
const UNLOCKED_STORAGE_KEY = 'spacecraft-only-unlocked'; // shared with the crafter — one
                                                          // preference, remembered everywhere

function loadBuild() {
  try {
    const raw = localStorage.getItem(BUILD_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveBuild() {
  try {
    localStorage.setItem(BUILD_STORAGE_KEY, JSON.stringify(state.build));
  } catch (e) {
    // ignore — not fatal if it can't persist
  }
}

// ---- Visitor's own unlock progress (stored only in their browser — nothing shared,
// and shared with the crafter page via the same storage key/shape). ----
const PROGRESS_STORAGE_KEY = 'spacecraft-my-progress';
const PROGRESS_TRACKS = ['Exploration', 'Science', 'Technology', 'Social'];

function loadProgress() {
  try {
    const raw = localStorage.getItem(PROGRESS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return {
      levels: (parsed && parsed.levels) || { Exploration: 0, Science: 0, Technology: 0, Social: 0 },
      nodes: (parsed && parsed.nodes) || {},
      analysisCounts: (parsed && parsed.analysisCounts) || {},
    };
  } catch (e) {
    return { levels: { Exploration: 0, Science: 0, Technology: 0, Social: 0 }, nodes: {}, analysisCounts: {} };
  }
}

function saveProgress() {
  try {
    localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(state.progress));
  } catch (e) {
    // ignore
  }
}

// Same lock logic as the crafter (app.js) — kept in sync by hand since these are two
// separate static pages with no shared module system. See app.js for the full comment.
// Ship parts don't currently use analysis_tiers (that's a resource-only mechanic), but
// the check is here anyway so the logic stays identical between both pages.
function isAccessible(item) {
  if (item.unlock_track && item.unlock_level != null) {
    return (state.progress.levels[item.unlock_track] || 0) >= item.unlock_level;
  }
  if (item.unlock_node) {
    return !!state.progress.nodes[item.unlock_node];
  }
  if (item.analysis_tiers && item.analysis_tiers.length) {
    const firstTier = item.analysis_tiers[0];
    const required = firstTier.analyze_count_required != null ? firstTier.analyze_count_required : 1;
    return (state.progress.analysisCounts[item.name] || 0) >= required;
  }
  return true;
}

function collectUnlockNodes() {
  const nodes = new Set();
  state.items.forEach((i) => {
    if (i.unlock_node) nodes.add(i.unlock_node);
  });
  return Array.from(nodes).sort();
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

// Splits a stat string like "40.0 t" or "-50%" into a number + unit so totals across
// several parts can be summed. Returns null for stats that aren't numeric at all.
function parseStat(raw) {
  const m = String(raw).match(/^(-?[\d.]+)\s*(.*)$/);
  if (!m) return null;
  return { value: parseFloat(m[1]), unit: m[2].trim() };
}

function suFor(item) {
  if (item.storage_units != null) return item.storage_units;
  if (item.recipes && item.recipes.length && item.recipes[0].storage_units != null) return item.recipes[0].storage_units;
  return null;
}

// ---- Init ----
async function init() {
  const res = await fetch('data/recipes.json?v=4');
  state.items = await res.json();
  state.parts = state.items.filter((i) => i.group === 'Ship Parts');
  state.build = loadBuild();

  try {
    state.onlyUnlocked = localStorage.getItem(UNLOCKED_STORAGE_KEY) === '1';
  } catch (e) {
    state.onlyUnlocked = false;
  }
  document.getElementById('unlocked-toggle').checked = state.onlyUnlocked;
  state.progress = loadProgress();

  populateSubcategoryOptions();
  renderProgressPanel();
  render();

  document.getElementById('subcategory-select').addEventListener('change', (e) => {
    state.subcategory = e.target.value;
    render();
  });

  document.getElementById('unlocked-toggle').addEventListener('change', (e) => {
    state.onlyUnlocked = e.target.checked;
    try {
      localStorage.setItem(UNLOCKED_STORAGE_KEY, state.onlyUnlocked ? '1' : '0');
    } catch (err) {
      // ignore
    }
    render();
  });

  const progressToggleBtn = document.getElementById('progress-panel-toggle');
  if (progressToggleBtn) {
    progressToggleBtn.addEventListener('click', () => {
      const panel = document.getElementById('progress-panel');
      panel.hidden = !panel.hidden;
    });
  }
}

function renderProgressPanel() {
  const panel = document.getElementById('progress-panel');
  if (!panel) return;

  const levelInputs = PROGRESS_TRACKS.map((track) => `
    <label class="progress-level">
      ${track}
      <input type="number" min="0" step="1" class="progress-level-input" data-track="${track}" value="${state.progress.levels[track] || 0}">
    </label>
  `).join('');

  const nodes = collectUnlockNodes();
  const nodeChecks = nodes.map((node) => `
    <label class="progress-node">
      <input type="checkbox" class="progress-node-input" data-node="${escapeHtml(node)}" ${state.progress.nodes[node] ? 'checked' : ''}>
      ${escapeHtml(node)}
    </label>
  `).join('');

  panel.innerHTML = `
    <p class="progress-note">Stored only in your own browser — nothing here is shared with anyone else.</p>
    <p class="progress-sublabel">Progression levels</p>
    <div class="progress-levels">${levelInputs}</div>
    ${nodes.length ? `<p class="progress-sublabel">Researched tech-tree nodes</p><div class="progress-nodes">${nodeChecks}</div>` : ''}
  `;

  panel.querySelectorAll('.progress-level-input').forEach((input) => {
    input.addEventListener('change', () => {
      state.progress.levels[input.dataset.track] = parseInt(input.value, 10) || 0;
      saveProgress();
      render();
    });
  });
  panel.querySelectorAll('.progress-node-input').forEach((input) => {
    input.addEventListener('change', () => {
      state.progress.nodes[input.dataset.node] = input.checked;
      saveProgress();
      render();
    });
  });
}

function populateSubcategoryOptions() {
  const select = document.getElementById('subcategory-select');
  const subcats = Array.from(new Set(state.parts.map((p) => p.subcategory).filter(Boolean))).sort();
  subcats.forEach((sc) => {
    const opt = document.createElement('option');
    opt.value = sc;
    opt.textContent = sc;
    select.appendChild(opt);
  });
}

// ---- Filtering ----
function matchesPart(item) {
  if (state.subcategory !== 'All' && item.subcategory !== state.subcategory) return false;
  if (state.onlyUnlocked && !isAccessible(item)) return false;
  return true;
}

// ---- Rendering: parts list ----
function render() {
  renderPartsList();
  renderBuildList();
  renderTotals();
}

function renderPartsList() {
  const list = document.getElementById('parts-list');
  const visible = state.parts.filter(matchesPart);

  if (!visible.length) {
    list.innerHTML = `<p class="empty">No ship parts match that filter yet.</p>`;
    return;
  }

  list.innerHTML = visible.map(renderPartCard).join('');

  list.querySelectorAll('.part-add-btn').forEach((btn) => {
    btn.addEventListener('click', () => addToBuild(btn.dataset.id));
  });
}

function renderPartCard(item) {
  const stats = (item.module_info && item.module_info.stats) || {};
  const statRows = Object.entries(stats)
    .map(([k, v]) => `<li><span>${escapeHtml(k)}</span><span>${escapeHtml(v)}</span></li>`)
    .join('');
  const locked = !isAccessible(item);
  const lockBadge = locked ? `<span class="lock-badge">Not yet unlocked</span>` : '';
  const su = suFor(item);
  const suNote = su != null ? `<span class="part-su">${su} su to carry</span>` : '';

  // If it's locked, show what would unlock it.
  let lockReasonHtml = '';
  if (locked && item.unlock_track && item.unlock_level != null) {
    lockReasonHtml = `<p class="lock-reason">Unlocks at ${escapeHtml(item.unlock_track)} Level ${item.unlock_level}${item.unlock_node ? ` (${escapeHtml(item.unlock_node)})` : ''}</p>`;
  } else if (locked && item.unlock_node) {
    lockReasonHtml = `<p class="lock-reason">Unlocks via researching: ${escapeHtml(item.unlock_node)}</p>`;
  }

  return `
    <div class="item part-card ${locked ? 'locked' : ''}">
      <div class="item-head part-head">
        <div>
          <span class="badge">${escapeHtml(item.subcategory || item.category || '')}</span>
          <strong>${escapeHtml(item.name)}</strong>
          ${lockBadge}
        </div>
        <div class="part-head-right">
          ${suNote}
          <button class="part-add-btn plan-button" type="button" data-id="${item.id}">+ Add</button>
        </div>
      </div>
      ${item.module_info && item.module_info.description ? `<p class="part-desc">${escapeHtml(item.module_info.description)}</p>` : ''}
      ${lockReasonHtml}
      <ul class="ingredients part-stats">${statRows}</ul>
      <a class="gather-link" href="index.html?item=${encodeURIComponent(item.id)}" target="_blank" rel="noopener">Gather materials for this →</a>
    </div>
  `;
}

// ---- Build list (the ship being designed) ----
function addToBuild(itemId) {
  const existing = state.build.find((b) => b.id === itemId);
  if (existing) {
    existing.qty += 1;
  } else {
    state.build.push({ id: itemId, qty: 1 });
  }
  saveBuild();
  render();
}

function removeFromBuild(itemId) {
  state.build = state.build.filter((b) => b.id !== itemId);
  saveBuild();
  render();
}

function setBuildQty(itemId, qty) {
  const entry = state.build.find((b) => b.id === itemId);
  if (entry) {
    entry.qty = qty > 0 ? qty : 1;
    saveBuild();
    render();
  }
}

function renderBuildList() {
  const listEl = document.getElementById('build-list');
  const emptyEl = document.getElementById('build-empty');

  if (!state.build.length) {
    listEl.innerHTML = '';
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;

  listEl.innerHTML = state.build
    .map((b) => {
      const item = state.items.find((i) => i.id === b.id);
      if (!item) return '';
      return `
        <li class="build-row" data-id="${b.id}">
          <span class="build-row-name">${escapeHtml(item.name)}</span>
          <input type="number" class="qty-input build-qty-input" min="1" step="1" value="${b.qty}" data-id="${b.id}" aria-label="Quantity">
          <button class="plan-remove build-remove" data-id="${b.id}" aria-label="Remove">&times;</button>
        </li>
      `;
    })
    .join('');

  listEl.querySelectorAll('.build-qty-input').forEach((input) => {
    input.addEventListener('change', () => setBuildQty(input.dataset.id, parseFloat(input.value)));
  });
  listEl.querySelectorAll('.build-remove').forEach((btn) => {
    btn.addEventListener('click', () => removeFromBuild(btn.dataset.id));
  });
}

// ---- Aggregate stat totals across the whole build ----
function renderTotals() {
  const totalsEl = document.getElementById('build-totals');
  if (!state.build.length) {
    totalsEl.innerHTML = '';
    return;
  }

  const totals = new Map(); // key: "Stat Name|unit" -> summed value
  let cargoSu = 0;
  let cargoSuUnknown = false;

  state.build.forEach(({ id, qty }) => {
    const item = state.items.find((i) => i.id === id);
    if (!item) return;

    const su = suFor(item);
    if (su != null) cargoSu += su * qty;
    else cargoSuUnknown = true;

    const stats = (item.module_info && item.module_info.stats) || {};
    Object.entries(stats).forEach(([name, raw]) => {
      const parsed = parseStat(raw);
      if (!parsed) return;
      const key = `${name}|${parsed.unit}`;
      totals.set(key, (totals.get(key) || 0) + parsed.value * qty);
    });
  });

  // Heat and power balance are the two things that actually matter for whether a
  // design works in-game (run hot too long and you take damage; draw more power than
  // you generate and systems stall) — call those out above the raw stat dump.
  const heatGen = findTotal(totals, 'Heat Generation');
  const heatDis = findTotal(totals, 'Heat Dissipation');
  const powerGen = findTotal(totals, 'Power Generation');
  const powerCon = findTotal(totals, 'Power Consumption');

  let balanceHtml = '';
  if (heatGen || heatDis) {
    const net = (heatGen ? heatGen.value : 0) - (heatDis ? heatDis.value : 0);
    const unit = (heatGen || heatDis).unit;
    const cls = net > 0 ? 'balance-bad' : 'balance-good';
    balanceHtml += `<p class="build-balance ${cls}"><strong>Heat balance:</strong> ${net.toFixed(1)} ${escapeHtml(unit)} ${net > 0 ? '(net heating — will build up over time)' : '(net cooling or steady)'}</p>`;
  }
  if (powerGen || powerCon) {
    const net = (powerGen ? powerGen.value : 0) - (powerCon ? powerCon.value : 0);
    const unit = (powerGen || powerCon).unit;
    const cls = net < 0 ? 'balance-bad' : 'balance-good';
    balanceHtml += `<p class="build-balance ${cls}"><strong>Power balance:</strong> ${net.toFixed(1)} ${escapeHtml(unit)} ${net < 0 ? '(drawing more than you generate)' : '(covered)'}</p>`;
  }

  const rows = Array.from(totals.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, value]) => {
      const [name, unit] = key.split('|');
      return `<li><span>${escapeHtml(name)}</span><span>${value.toFixed(1)}${unit ? ' ' + escapeHtml(unit) : ''}</span></li>`;
    })
    .join('');

  const cargoNote = cargoSuUnknown
    ? `<p class="su-unknown-note">Some parts don't have a logged su size yet, so this is a lower bound.</p>`
    : '';

  totalsEl.innerHTML = `
    <div class="su-summary">
      <p class="section-label">Cargo to carry to the shipyard</p>
      <p class="su-grand-total"><strong>${cargoSu.toFixed(1)} su</strong></p>
      ${cargoNote}
    </div>
    ${balanceHtml}
    <p class="section-label">Combined stats</p>
    <ul class="su-breakdown build-stat-totals">${rows}</ul>
  `;
}

function findTotal(totals, statName) {
  for (const [key, value] of totals.entries()) {
    const [name, unit] = key.split('|');
    if (name === statName) return { value, unit };
  }
  return null;
}

init();
