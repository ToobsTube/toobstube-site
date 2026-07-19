// ---- State ----
const state = {
  items: [], // full recipes.json, kept around so "Gather materials" links and
             // su lookups work the same way the crafter does
  parts: [], // just the Ship Parts group
  subcategory: 'All',
  onlyUnlocked: false,
  build: [], // [{ id, qty }]
  inventory: {}, // itemId -> qty already on hand — shared with the crafter page
  progress: { levels: { Exploration: 0, Science: 0, Technology: 0, Social: 0 }, nodes: {}, analysisCounts: {} },
};

const BUILD_STORAGE_KEY = 'spacecraft-ship-build';
const UNLOCKED_STORAGE_KEY = 'spacecraft-only-unlocked'; // shared with the crafter — one
                                                          // preference, remembered everywhere
const INVENTORY_STORAGE_KEY = 'spacecraft-inventory'; // same key as the crafter page — marking
                                                       // something on hand in either place
                                                       // shows up in both

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

function loadInventory() {
  try {
    const raw = localStorage.getItem(INVENTORY_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveInventory() {
  try {
    localStorage.setItem(INVENTORY_STORAGE_KEY, JSON.stringify(state.inventory));
  } catch (e) {
    // ignore — not fatal if it can't persist
  }
}

function getOwnedQty(itemId) {
  const val = state.inventory[itemId];
  return val > 0 ? val : 0;
}

function setOwnedQty(itemId, qty) {
  qty = qty > 0 ? qty : 0;
  if (qty === 0) {
    delete state.inventory[itemId];
  } else {
    state.inventory[itemId] = qty;
  }
  saveInventory();
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
  state.inventory = loadInventory();

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

  const materialsToggleBtn = document.getElementById('materials-toggle');
  if (materialsToggleBtn) {
    materialsToggleBtn.addEventListener('click', () => {
      const container = document.getElementById('build-materials');
      const wasHidden = container.hidden;
      if (wasHidden) renderShipMaterials();
      container.hidden = !wasHidden;
      materialsToggleBtn.innerHTML = wasHidden
        ? 'Hide materials needed for this ship &#9652;'
        : 'Show materials needed for this ship &#9662;';
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
  updateMaterialsAvailability();
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

  // If this part is already in the build with a chosen quantity, carry that quantity
  // over to the Crafting Calculator too — no reason to make someone re-type it there.
  const buildEntry = state.build.find((b) => b.id === item.id);
  const gatherHref = buildEntry && buildEntry.qty > 1
    ? `index.html?item=${encodeURIComponent(item.id)}&qty=${encodeURIComponent(buildEntry.qty)}`
    : `index.html?item=${encodeURIComponent(item.id)}`;

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
      <a class="gather-link" href="${gatherHref}" target="spacecraft-calculator" rel="noopener">Gather materials for this →</a>
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
          <a class="gather-link build-gather-link" href="index.html?item=${encodeURIComponent(b.id)}&qty=${encodeURIComponent(b.qty)}" target="spacecraft-calculator" rel="noopener" data-id="${b.id}">Gather →</a>
          <button class="plan-remove build-remove" data-id="${b.id}" aria-label="Remove">&times;</button>
        </li>
      `;
    })
    .join('');

  listEl.querySelectorAll('.build-qty-input').forEach((input) => {
    input.addEventListener('change', () => setBuildQty(input.dataset.id, parseFloat(input.value)));
    // Keep that row's gather link in sync as the quantity changes, without a full re-render.
    input.addEventListener('input', () => {
      const link = listEl.querySelector(`.build-gather-link[data-id="${input.dataset.id}"]`);
      if (link) {
        const qty = parseFloat(input.value) > 0 ? parseFloat(input.value) : 1;
        link.href = `index.html?item=${encodeURIComponent(input.dataset.id)}&qty=${encodeURIComponent(qty)}`;
      }
    });
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

  // Most stats genuinely accumulate when you add more parts (more Power Storage,
  // more Weight, and so on) — but a handful don't work that way. Two 100%-efficient
  // batteries aren't 200% efficient; Theoretical Efficiency and Self-Discharge are
  // rates, so they get averaged, weighted by each battery's own Power Storage
  // (a bigger battery's efficiency should count for more than a tiny one's).
  // Required Exploration Level is a minimum you have to clear, not a total — so it
  // takes the highest single value among your parts, not the sum of all of them.
  const AVERAGE_WEIGHTED_BY_POWER_STORAGE = new Set(['Theoretical Efficiency', 'Self-Discharge']);
  const MAX_NOT_SUM = new Set(['Required Exploration Level']);

  const rawEntries = [];
  state.build.forEach(({ id, qty }) => {
    const item = state.items.find((i) => i.id === id);
    if (!item) return;

    const su = suFor(item);
    if (su != null) cargoSu += su * qty;
    else cargoSuUnknown = true;

    const stats = (item.module_info && item.module_info.stats) || {};
    const powerStorageStat = stats['Power Storage'] ? parseStat(stats['Power Storage']) : null;
    const weightPerUnit = powerStorageStat ? powerStorageStat.value : 0;

    Object.entries(stats).forEach(([name, raw]) => {
      const parsed = parseStat(raw);
      if (!parsed) return;
      rawEntries.push({ name, unit: parsed.unit, value: parsed.value, qty, weightPerUnit });
    });
  });

  const weightedSums = new Map(); // key -> { sum, weight } for the averaged stats
  rawEntries.forEach(({ name, unit, value, qty, weightPerUnit }) => {
    const key = `${name}|${unit}`;
    if (MAX_NOT_SUM.has(name)) {
      const cur = totals.get(key);
      if (cur == null || value > cur) totals.set(key, value);
    } else if (AVERAGE_WEIGHTED_BY_POWER_STORAGE.has(name)) {
      // Fall back to equal weighting (by quantity alone) if this part has no logged
      // Power Storage of its own to weight by, rather than silently dropping it.
      const w = weightPerUnit > 0 ? weightPerUnit : 1;
      const entry = weightedSums.get(key) || { sum: 0, weight: 0 };
      entry.sum += value * qty * w;
      entry.weight += qty * w;
      weightedSums.set(key, entry);
    } else {
      totals.set(key, (totals.get(key) || 0) + value * qty);
    }
  });
  weightedSums.forEach((entry, key) => {
    totals.set(key, entry.weight > 0 ? entry.sum / entry.weight : 0);
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

// ---- Craft tree computation (same engine as the crafter's app.js, kept in sync by
// hand since these are separate static pages with no shared module system — see
// app.js for the full explanation of why this needs two passes). Computes combined
// materials demand for every part in the build at once, so a Copper Ingot needed by
// three different parts shows up as one correct total instead of three separate ones,
// and anything marked as on hand (shared with the crafter's own inventory) is
// subtracted before it cascades down to raw materials. ----
function computeCraftContext(roots) {
  const ctx = newCraftCtx();
  const grossDemand = new Map();
  const nodeInfo = new Map();
  const discovered = new Set();
  const postOrder = [];
  const rootIds = new Set(roots.map((r) => r.id));

  function discover(itemId, visiting) {
    if (discovered.has(itemId) || visiting.has(itemId)) return;
    const item = state.items.find((i) => i.id === itemId);
    if (!item) return;

    const recipe = item.recipes && item.recipes.length ? item.recipes[0] : null;
    const flatIngredients = !recipe && item.ingredients && item.ingredients.length ? item.ingredients : null;
    const ingredients = recipe ? recipe.ingredients : flatIngredients;

    if (!ingredients || !ingredients.length) {
      nodeInfo.set(itemId, { item, isLeaf: true });
      discovered.add(itemId);
      postOrder.push(itemId);
      return;
    }

    visiting.add(itemId);
    const batchSize = recipe ? recipe.output_qty || 1 : 1;
    const edges = ingredients.map((ing) => {
      const slug = slugify(ing.item);
      const subItem = state.items.find((i) => i.id === slug);
      const cyclic = subItem && visiting.has(slug);
      const trackable = subItem && !cyclic;
      if (trackable) discover(slug, visiting);
      return { slug: trackable ? slug : null, displayName: ing.item, qty: ing.qty };
    });
    visiting.delete(itemId);

    nodeInfo.set(itemId, { item, isLeaf: false, recipe, batchSize, edges });
    discovered.add(itemId);
    postOrder.push(itemId);
  }

  roots.forEach((r) => {
    grossDemand.set(r.id, (grossDemand.get(r.id) || 0) + r.qty);
    discover(r.id, new Set());
  });

  const topoOrder = postOrder.slice().reverse();

  // Shared across every node this context computes — tracks how much of each
  // alternate-recipe raw material (Iron Nugget, etc.) is still "available" to draw
  // on. Without this, if the same material were ever eligible as an alt for two
  // different intermediates, both could independently think they had the full
  // stash to themselves and double-count it. Starts lazily at whatever's actually
  // in inventory the first time something asks for it.
  const altPool = new Map();
  function drawFromAltPool(slug, maxAmount) {
    if (maxAmount <= 0) return 0;
    const available = altPool.has(slug) ? altPool.get(slug) : getOwnedQty(slug);
    const used = Math.min(available, maxAmount);
    altPool.set(slug, available - used);
    return used;
  }

  topoOrder.forEach((itemId) => {
    const info = nodeInfo.get(itemId);
    const gross = grossDemand.get(itemId) || 0;
    if (!info || gross <= 0) return;

    // A simple single-ingredient alternate recipe (Iron Ingot from Iron Ore OR Iron
    // Nugget, say) — hand-mining often turns up a pile of Nuggets instead of Ore, so
    // any of that on hand counts toward covering this item's demand just like native
    // inventory would, on top of it rather than instead of it.
    let alt = null;
    if (!info.isLeaf && info.recipe && info.item.recipes && info.item.recipes.length > 1 && info.recipe.ingredients.length === 1) {
      const altRecipe = info.item.recipes[1];
      const altIngredients = altRecipe.ingredients || [];
      if (altIngredients.length === 1) {
        const altIng = altIngredients[0];
        const altSlug = slugify(altIng.item);
        const altItem = state.items.find((i) => i.id === altSlug);
        const altIsLeaf = !altItem || !((altItem.recipes && altItem.recipes.length) || (altItem.ingredients && altItem.ingredients.length));
        if (altIsLeaf) {
          alt = { name: altIng.item, slug: altSlug, qtyPerBatch: altIng.qty, batchSize: altRecipe.output_qty || 1 };
        }
      }
    }

    const nativeOwned = Math.min(gross, getOwnedQty(itemId));
    const afterNative = gross - nativeOwned;

    // Nugget inventory only comes in whole recipe batches (can't craft 3/4 of an
    // ingot's worth), so the credit it can offer is rounded down, not up.
    let altCredit = 0;
    let altUsedQty = 0;
    if (alt) {
      const maxCoverableBatches = Math.ceil(afterNative / alt.batchSize - 1e-9);
      const altAvailable = altPool.has(alt.slug) ? altPool.get(alt.slug) : getOwnedQty(alt.slug);
      const affordableBatches = Math.min(maxCoverableBatches, Math.floor(altAvailable / alt.qtyPerBatch + 1e-9));
      altUsedQty = drawFromAltPool(alt.slug, affordableBatches * alt.qtyPerBatch);
      altCredit = Math.floor(altUsedQty / alt.qtyPerBatch) * alt.batchSize;
    }

    const altApplied = Math.min(afterNative, altCredit);
    const net = afterNative - altApplied;
    const owned = nativeOwned + altApplied;
    if (owned > 0) ctx.owned.set(info.item.name, (ctx.owned.get(info.item.name) || 0) + owned);

    if (info.isLeaf) {
      ctx.rawTotals.set(info.item.name, (ctx.rawTotals.get(info.item.name) || 0) + net);
      return;
    }

    if (!rootIds.has(itemId)) {
      ctx.intermediates.set(info.item.name, (ctx.intermediates.get(info.item.name) || 0) + net);
    }
    if (net > 0 && info.item.station) ctx.stations.add(info.item.station);

    // Batches must be a whole number — see app.js for the full explanation of why
    // this matters (a fractional batch count silently under-counts ingredients for
    // whatever gets rounded up to complete the last real craft).
    const batches = Math.ceil(net / info.batchSize - 1e-9);

    if (alt && (net > 0 || altUsedQty > 0)) {
      const primaryName = info.recipe.ingredients[0].item;
      const moreAltBatches = Math.ceil(net / alt.batchSize - 1e-9);
      const moreAltQty = alt.qtyPerBatch * moreAltBatches;
      const perPrimary = ctx.altRaw.get(primaryName) || new Map();
      const prev = perPrimary.get(alt.name) || { needed: 0, used: 0 };
      perPrimary.set(alt.name, { needed: prev.needed + moreAltQty, used: prev.used + altUsedQty, slug: alt.slug });
      ctx.altRaw.set(primaryName, perPrimary);
    }

    if (net > 0 && info.recipe) {
      const taxedEntry = info.recipe.tax && Object.entries(info.recipe.tax).find(([loc]) => loc !== 'personal_base');
      const entry = ctx.taxSteps.get(info.item.name) || { cost: 0, confirmed: true };
      if (taxedEntry) {
        entry.cost += batches * taxedEntry[1];
      } else {
        entry.confirmed = false;
      }
      ctx.taxSteps.set(info.item.name, entry);
    }

    info.edges.forEach((edge) => {
      const requiredQty = edge.qty * batches;
      if (edge.slug) {
        grossDemand.set(edge.slug, (grossDemand.get(edge.slug) || 0) + requiredQty);
      } else {
        ctx.rawTotals.set(edge.displayName, (ctx.rawTotals.get(edge.displayName) || 0) + requiredQty);
      }
    });
  });

  return ctx;
}

function newCraftCtx() {
  return { rawTotals: new Map(), intermediates: new Map(), taxSteps: new Map(), stations: new Set(), owned: new Map(), altRaw: new Map() };
}

function getCraftDepth(itemId, memo, visiting) {
  if (memo.has(itemId)) return memo.get(itemId);
  if (visiting.has(itemId)) return 0;

  const item = state.items.find((i) => i.id === itemId);
  if (!item) return 0;

  const recipe = item.recipes && item.recipes.length ? item.recipes[0] : null;
  const flatIngredients = !recipe && item.ingredients && item.ingredients.length ? item.ingredients : null;
  const ingredients = recipe ? recipe.ingredients : flatIngredients;
  if (!ingredients || !ingredients.length) {
    memo.set(itemId, 0);
    return 0;
  }

  visiting.add(itemId);
  let deepestSub = 0;
  ingredients.forEach((ing) => {
    const slug = slugify(ing.item);
    const subItem = state.items.find((i) => i.id === slug);
    const subExpandable = subItem && !visiting.has(slug) && ((subItem.recipes && subItem.recipes.length) || (subItem.ingredients && subItem.ingredients.length));
    if (subExpandable) {
      const d = getCraftDepth(slug, memo, visiting);
      if (d > deepestSub) deepestSub = d;
    }
  });
  visiting.delete(itemId);

  const depth = deepestSub + 1;
  memo.set(itemId, depth);
  return depth;
}

function stationForMaterial(name) {
  const item = state.items.find((i) => i.id === slugify(name));
  return item && item.recipes && item.recipes.length ? item.station : null;
}

function renderStationsLine(stations) {
  if (!stations.size) return '';
  const chips = Array.from(stations)
    .map((s) => `<span class="station-chip">${escapeHtml(s)}</span>`)
    .join('');
  return `<p class="section-label">Stations needed</p><div class="stations-line">${chips}</div>`;
}

function renderTaxSection(taxSteps, qtyLabel, depthOf) {
  let total = 0;
  let incomplete = false;
  taxSteps.forEach((s) => {
    total += s.cost;
    if (!s.confirmed) incomplete = true;
  });
  const incompleteNote = incomplete
    ? " — one or more steps below don't have a confirmed tax number yet, so this is a lower bound"
    : '';
  const costLine = `<p class="cost-line">&#128176; ~${total.toFixed(2)} cr in station tax for ${qtyLabel}, across every craft step in the chain${incompleteNote}</p>`;

  const taxRows = Array.from(taxSteps.entries())
    .sort((a, b) => depthOf(b[0]) - depthOf(a[0]) || b[1].cost - a[1].cost)
    .map(([name, s]) => {
      const valueHtml = s.confirmed ? `${s.cost.toFixed(2)} cr` : 'tax not confirmed yet';
      return `<li>${shipMatLink(name)}<span class="ing-qty">${valueHtml}</span></li>`;
    })
    .join('');
  const taxListSection = taxSteps.size
    ? `<p class="section-label">Tax by craft step</p><ul class="ingredients tax-list">${taxRows}</ul>`
    : '';

  return costLine + ' ' + taxListSection;
}

// Ingredient names in the ship materials list link back to the Crafting Calculator
// (a different page) rather than jumping in-page, so this always opens in a new tab —
// there's no in-page detail panel to jump to here the way there is on the crafter.
function shipMatLink(name) {
  const slug = slugify(name);
  const linkable = state.items.some((i) => i.id === slug);
  if (!linkable) return `<span class="ing-name">${escapeHtml(name)}</span>`;
  return `<a class="ing-name linkable" href="index.html?item=${encodeURIComponent(slug)}" target="spacecraft-calculator" rel="noopener">${escapeHtml(name)}</a>`;
}

// Same idea as the crafter's material rows, but with a live-editable "have" box
// instead of a static tag, since this is the one place someone can mark inventory
// directly on the Ship Planner page.
function renderShipMaterialRows(map, sortFn, withStation, altRawMap) {
  return Array.from(map.entries())
    .sort(sortFn)
    .map(([name, total]) => {
      const slug = slugify(name);
      const displayQty = Math.ceil(total - 1e-9);
      const station = withStation && displayQty > 0 ? stationForMaterial(name) : null;
      const stationTag = station ? `<span class="station-chip station-chip-inline">${escapeHtml(station)}</span>` : '';
      const owned = getOwnedQty(slug);
      const coveredTag = displayQty === 0 ? `<span class="covered-tag">✓ covered</span>` : '';

      const alts = altRawMap ? altRawMap.get(name) : null;
      const altHtml = alts && alts.size
        ? Array.from(alts.entries())
            .map(([altName, info]) => {
              const needMore = Math.ceil(info.needed - 1e-9);
              const usedText = info.used > 0 ? `using ${Math.ceil(info.used - 1e-9).toLocaleString()} already · ` : '';
              const needText = needMore > 0
                ? `${usedText}${needMore.toLocaleString()} more would cover the rest`
                : `${usedText}fully covers the rest`;
              return `
                <div class="alt-raw-note">
                  <span>or ${escapeHtml(altName)} instead — ${needText}</span>
                  <label class="ship-have-wrap">have<input type="text" inputmode="numeric" pattern="[0-9]*" class="ship-have-input" value="${getOwnedQty(info.slug) || ''}" placeholder="0" data-item="${info.slug}" aria-label="Quantity of ${escapeHtml(altName)} already on hand"></label>
                </div>
              `;
            })
            .join('')
        : '';

      return `
        <li class="ship-mat-row">
          <div class="ship-mat-row-main" data-item="${slug}">
            ${shipMatLink(name)}
            <span class="ship-mat-qty">${coveredTag}${stationTag}${displayQty > 0 ? `×${displayQty.toLocaleString()}` : ''}</span>
            <label class="ship-have-wrap">have<input type="text" inputmode="numeric" pattern="[0-9]*" class="ship-have-input" value="${owned || ''}" placeholder="0" data-item="${slug}" aria-label="Quantity of ${escapeHtml(name)} already on hand"></label>
          </div>
          ${altHtml}
        </li>
      `;
    })
    .join('');
}

function renderShipIntermediatesSection(intermediates, depthOf) {
  if (!intermediates.size) return '';
  const rows = renderShipMaterialRows(intermediates, (a, b) => depthOf(b[0]) - depthOf(a[0]) || b[1] - a[1], true);
  return `<p class="section-label">Sub-crafts needed along the way</p><p class="raw-note">Ordered top to bottom: most complex first, basic ingots last — right above the raw materials below.</p><ul class="ingredients raw-list">${rows}</ul>`;
}

function renderShipRawMaterialsSection(rawTotals, altRawMap) {
  const rows = renderShipMaterialRows(rawTotals, (a, b) => b[1] - a[1], false, altRawMap);
  return `<p class="section-label">Base/raw materials</p><ul class="ingredients raw-list">${rows}</ul>`;
}

// ---- Combined materials list for the whole build ----
function updateMaterialsAvailability() {
  const toggleBtn = document.getElementById('materials-toggle');
  const container = document.getElementById('build-materials');
  if (!toggleBtn || !container) return;

  if (!state.build.length) {
    toggleBtn.hidden = true;
    container.hidden = true;
    container.innerHTML = '';
    toggleBtn.innerHTML = 'Show materials needed for this ship &#9662;';
    return;
  }
  toggleBtn.hidden = false;
  if (!container.hidden) renderShipMaterials(); // keep it in sync if it's left open
}

function renderShipMaterials() {
  const container = document.getElementById('build-materials');
  if (!container) return;

  const roots = state.build.map((b) => ({ id: b.id, qty: b.qty }));
  const ctx = computeCraftContext(roots);
  const depthMemo = new Map();
  const depthOf = (name) => getCraftDepth(slugify(name), depthMemo, new Set());

  const stationsLine = renderStationsLine(ctx.stations);
  const taxBlock = ctx.taxSteps.size ? renderTaxSection(ctx.taxSteps, 'this ship', depthOf) : '';
  const intermediateSection = renderShipIntermediatesSection(ctx.intermediates, depthOf);
  const rawSection = renderShipRawMaterialsSection(ctx.rawTotals, ctx.altRaw);

  container.innerHTML = `
    ${stationsLine}
    ${taxBlock}
    <p class="raw-note">Everything needed across every part in your build, combined into one list — mark anything you've already made below and the rest adjusts for it.</p>
    ${intermediateSection}
    ${rawSection}
  `;

  container.querySelectorAll('.ship-have-input').forEach((input) => {
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('input', () => {
      const digitsOnly = input.value.replace(/[^0-9]/g, '');
      if (digitsOnly !== input.value) {
        const pos = input.selectionStart - (input.value.length - digitsOnly.length);
        input.value = digitsOnly;
        input.setSelectionRange(pos, pos);
      }
      setOwnedQty(input.dataset.item, parseFloat(digitsOnly) || 0);
      refreshShipMaterials(input.dataset.item, input.selectionStart);
    });
  });
}

// Recomputes and redraws the materials list after a "have" edit, then restores focus
// and cursor position on whichever input was being typed in — otherwise every
// keystroke would knock focus out of the box, which makes it unusable for typing a
// multi-digit number.
function refreshShipMaterials(focusItemId, cursorPos) {
  renderShipMaterials();
  if (!focusItemId) return;
  const container = document.getElementById('build-materials');
  const input = container && container.querySelector(`.ship-have-input[data-item="${focusItemId}"]`);
  if (input) {
    input.focus();
    if (cursorPos != null) input.setSelectionRange(cursorPos, cursorPos);
  }
}

init();
