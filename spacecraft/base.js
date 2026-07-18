// ---- State ----
const state = {
  items: [],       // full recipes.json
  buildings: [],    // just the placeable Base Building group
  category: 'All',
  build: [],        // [{ id, qty }]
  inventory: {},    // shared with the crafter and Ship Planner
};

const BASE_BUILD_STORAGE_KEY = 'spacecraft-base-build';
const INVENTORY_STORAGE_KEY = 'spacecraft-inventory'; // same key as the crafter/ship pages

// A base's own starting capacity before any buildings are added — confirmed from an
// in-game Specs screenshot. Command Tower (and similar Command-category buildings,
// once confirmed) ADD to these rather than consuming from them.
const BASE_STATS = {
  footprintCapacity: 60,
  decorationCapacity: 50,
  experienceCapacity: 400,
  powerGeneration: 50,
  maxConnections: 6,
  solidStorage: 500,
};

// Maps each crafting station name (as used in recipes.json) to whether there's a
// real, automatable building that does that job, and which one. Only marked true
// where the game's own building description explicitly says it runs unattended
// ("no human input") — everything else stays null (unconfirmed) rather than guessed.
const STATION_AUTOMATION = {
  Workshop: { building: 'Assembler', buildingId: 'assembler', automatable: true, note: 'The Assembler is the automated alternative to the manual workshop bundled with your base.' },
  Smelter: { building: 'Smelter', buildingId: 'smelter', automatable: true, note: 'Confirmed automatable — runs continuously once powered, no one has to be there.' },
  Assembler: { building: 'Assembler', buildingId: 'assembler', automatable: true, note: 'Confirmed automatable.' },
  Extractor: { building: 'Extractor', buildingId: 'extractor', automatable: true, note: 'Drills a claimed deposit automatically once placed and powered.' },
  'Chemical Factory': { building: 'Chemical Factory', buildingId: null, automatable: true, note: "Confirmed automatable per its own in-game description — stats not yet added to this planner." },
  Crystallizer: { building: 'Crystallizer', buildingId: null, automatable: null, note: 'Automation status not yet confirmed.' },
  Factory: { building: 'Factory', buildingId: null, automatable: null, note: 'Automation status not yet confirmed.' },
  'Bottling Plant': { building: 'Bottling Plant', buildingId: null, automatable: null, note: 'Automation status not yet confirmed.' },
  'Construction Tool': { building: null, buildingId: null, automatable: false, note: "A handheld tool, not a base building — this step is always manual." },
};

function loadBaseBuild() {
  try {
    const raw = localStorage.getItem(BASE_BUILD_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveBaseBuild() {
  try {
    localStorage.setItem(BASE_BUILD_STORAGE_KEY, JSON.stringify(state.build));
  } catch (e) {
    // ignore
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
    // ignore
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

// ---- Init ----
async function init() {
  const res = await fetch('data/recipes.json?v=4');
  state.items = await res.json();

  // Base Deploy Kit and Base Core Drive establish the base itself — they aren't
  // placeable buildings with their own footprint/power, so they're excluded from
  // the buildable list.
  state.buildings = state.items.filter((i) => i.group === 'Base Building' && i.id !== 'base-deploy-kit' && i.id !== 'base-core-drive');
  state.build = loadBaseBuild();
  state.inventory = loadInventory();

  const categorySelect = document.getElementById('building-category-select');
  const cats = Array.from(new Set(state.buildings.map((i) => i.category))).sort();
  cats.forEach((c) => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    categorySelect.appendChild(opt);
  });
  categorySelect.addEventListener('change', (e) => {
    state.category = e.target.value;
    render();
  });

  const searchInput = document.getElementById('automate-search');
  const qtyInput = document.getElementById('automate-qty');
  searchInput.addEventListener('input', () => renderAutomateSuggestions());
  qtyInput.addEventListener('input', () => {
    const digitsOnly = qtyInput.value.replace(/[^0-9]/g, '');
    if (digitsOnly !== qtyInput.value) qtyInput.value = digitsOnly;
  });

  render();
}

function render() {
  renderBuildingList();
  renderBaseBuildList();
  renderBaseTotals();
  updateMaterialsAvailability();
}

// ---- Building browser ----
function renderBuildingList() {
  const listEl = document.getElementById('building-list');
  const visible = state.buildings.filter((i) => state.category === 'All' || i.category === state.category);

  listEl.innerHTML = visible.map(renderBuildingCard).join('');

  listEl.querySelectorAll('.part-add-btn').forEach((btn) => {
    btn.addEventListener('click', () => addToBase(btn.dataset.id));
  });
}

function renderBuildingCard(item) {
  const info = item.building_info || {};
  const rows = [];
  if (info.footprint != null) rows.push(['Footprint', `${info.footprint} FP`]);
  else if ('footprint' in info) rows.push(['Footprint', 'unconfirmed']);
  if (info.power != null) rows.push(['Power', `${info.power > 0 ? '+' : ''}${info.power}`]);
  else if ('power' in info) rows.push(['Power', 'unconfirmed']);
  if (info.max_connections != null) rows.push(['Max connections', info.max_connections]);
  if (info.adds_footprint_capacity) rows.push(['Adds footprint cap.', `+${info.adds_footprint_capacity} FP`]);
  if (info.adds_decoration_capacity) rows.push(['Adds decoration cap.', `+${info.adds_decoration_capacity} DP`]);
  if (info.adds_experience_capacity) rows.push(['Adds XP cap.', `+${info.adds_experience_capacity}`]);

  const statRows = rows.map(([k, v]) => `<li><span>${escapeHtml(k)}</span><span>${escapeHtml(String(v))}</span></li>`).join('');
  const autoTag = info.automatable === true
    ? `<span class="auto-tag auto-yes">Automatable</span>`
    : info.automatable === false
      ? `<span class="auto-tag auto-no">Manual only</span>`
      : `<span class="auto-tag auto-unknown">Automation unconfirmed</span>`;
  const note = info.note ? `<p class="lock-reason">${escapeHtml(info.note)}</p>` : '';

  return `
    <div class="item part-card">
      <div class="item-head part-head">
        <div>
          <span class="badge">${escapeHtml(item.category || '')}</span>
          <strong>${escapeHtml(item.name)}</strong>
          ${autoTag}
        </div>
        <div class="part-head-right">
          <button class="part-add-btn plan-button" type="button" data-id="${item.id}">+ Add</button>
        </div>
      </div>
      ${item.module_info && item.module_info.description ? `<p class="part-desc">${escapeHtml(item.module_info.description)}</p>` : ''}
      ${note}
      <ul class="ingredients part-stats">${statRows}</ul>
    </div>
  `;
}

function addToBase(id) {
  const existing = state.build.find((b) => b.id === id);
  if (existing) {
    existing.qty += 1;
  } else {
    state.build.push({ id, qty: 1 });
  }
  saveBaseBuild();
  render();
}

function removeFromBase(id) {
  state.build = state.build.filter((b) => b.id !== id);
  saveBaseBuild();
  render();
}

function setBaseQty(id, qty) {
  const entry = state.build.find((b) => b.id === id);
  if (!entry) return;
  entry.qty = qty > 0 ? qty : 1;
  saveBaseBuild();
  render();
}

// ---- Your base list + totals ----
function renderBaseBuildList() {
  const listEl = document.getElementById('base-build-list');
  const emptyEl = document.getElementById('base-build-empty');
  emptyEl.hidden = state.build.length > 0;

  listEl.innerHTML = state.build
    .map((b) => {
      const item = state.items.find((i) => i.id === b.id);
      if (!item) return '';
      return `
        <li class="build-row" data-id="${b.id}">
          <span class="build-row-name">${escapeHtml(item.name)}</span>
          <input type="text" inputmode="numeric" pattern="[0-9]*" class="qty-input base-qty-input" value="${b.qty}" data-id="${b.id}" aria-label="Quantity">
          <button class="plan-remove base-remove" data-id="${b.id}" aria-label="Remove">&times;</button>
        </li>
      `;
    })
    .join('');

  listEl.querySelectorAll('.base-qty-input').forEach((input) => {
    input.addEventListener('input', () => {
      const digitsOnly = input.value.replace(/[^0-9]/g, '');
      if (digitsOnly !== input.value) input.value = digitsOnly;
    });
    input.addEventListener('change', () => setBaseQty(input.dataset.id, parseFloat(input.value)));
  });
  listEl.querySelectorAll('.base-remove').forEach((btn) => {
    btn.addEventListener('click', () => removeFromBase(btn.dataset.id));
  });
}

function renderBaseTotals() {
  const totalsEl = document.getElementById('base-totals');
  if (!state.build.length) {
    totalsEl.innerHTML = '';
    return;
  }

  let footprintUsed = 0;
  let footprintCapBonus = 0;
  let decorationCapBonus = 0;
  let xpCapBonus = 0;
  let powerUsed = 0; // consumption, positive number
  let powerGenerated = 0;
  let connectionCapacity = 0;
  let solidStorageBonus = 0;
  let droneRouteCapacity = 0;
  let unconfirmedFootprint = false;
  let unconfirmedPower = false;
  let hasCraftingBuildings = false;

  state.build.forEach((b) => {
    const item = state.items.find((i) => i.id === b.id);
    if (!item) return;
    const info = item.building_info || {};

    if (info.footprint != null) footprintUsed += info.footprint * b.qty;
    else if ('footprint' in info) unconfirmedFootprint = true;

    if (info.power != null) {
      if (info.power > 0) powerGenerated += info.power * b.qty;
      else powerUsed += -info.power * b.qty;
    } else if ('power' in info) {
      unconfirmedPower = true;
    }

    if (info.adds_footprint_capacity) footprintCapBonus += info.adds_footprint_capacity * b.qty;
    if (info.adds_decoration_capacity) decorationCapBonus += info.adds_decoration_capacity * b.qty;
    if (info.adds_experience_capacity) xpCapBonus += info.adds_experience_capacity * b.qty;
    if (info.max_connections) connectionCapacity += info.max_connections * b.qty;
    if (info.storage_solid) solidStorageBonus += info.storage_solid * b.qty;
    if (info.max_drone_routes != null) droneRouteCapacity += info.max_drone_routes * b.qty;
    if (['smelter', 'assembler', 'micro-furnace'].includes(b.id)) hasCraftingBuildings = true;
  });

  const footprintCap = BASE_STATS.footprintCapacity + footprintCapBonus;
  const totalPowerGen = BASE_STATS.powerGeneration + powerGenerated;
  const powerBalance = totalPowerGen - powerUsed;
  const totalConnectionCap = BASE_STATS.maxConnections + connectionCapacity;
  const totalSolidStorage = BASE_STATS.solidStorage + solidStorageBonus;

  const fpOver = footprintUsed > footprintCap;
  const powerOver = powerBalance < 0;

  totalsEl.innerHTML = `
    <p class="section-label">Base totals</p>
    <div class="su-summary">
      <ul class="su-breakdown build-stat-totals">
        <li><span>Footprint</span><span class="${fpOver ? 'balance-bad' : ''}">${footprintUsed}${unconfirmedFootprint ? '+' : ''} / ${footprintCap} FP</span></li>
        <li><span>Power</span><span class="${powerOver ? 'balance-bad' : 'balance-good'}">${powerBalance >= 0 ? '+' : ''}${powerBalance} mA (${totalPowerGen} gen, ${powerUsed}${unconfirmedPower ? '+' : ''} used)</span></li>
        <li><span>Connections available</span><span>${totalConnectionCap} (base 6 + Pylons — see note below)</span></li>
        <li><span>Solid storage</span><span>${totalSolidStorage.toLocaleString()} su</span></li>
        <li><span>Drone routes (Extractor/Warehouse)</span><span>${droneRouteCapacity || 0}</span></li>
      </ul>
    </div>
    ${unconfirmedFootprint || unconfirmedPower ? '<p class="raw-note">Some buildings in your base have unconfirmed footprint/power — totals above are a lower bound until those are filled in.</p>' : ''}
    <p class="raw-note">Connections are simplified for now — this just adds up capacity, it doesn't check that everything is actually wired up correctly.${hasCraftingBuildings ? ' Drone route totals only cover Extractor/Warehouse — crafting buildings (Assembler, Smelter, etc.) may have their own per-recipe route limit that isn\'t modeled here yet.' : ''}</p>
  `;
}

// ---- Materials needed (reuses the same engine as the Crafting Calculator/Ship Planner) ----
function updateMaterialsAvailability() {
  const toggleBtn = document.getElementById('base-materials-toggle');
  const container = document.getElementById('base-materials');
  if (!toggleBtn || !container) return;

  if (!state.build.length) {
    toggleBtn.hidden = true;
    container.hidden = true;
    container.innerHTML = '';
    toggleBtn.innerHTML = 'Show materials needed for this base &#9662;';
    return;
  }
  toggleBtn.hidden = false;
  if (!container.hidden) renderBaseMaterials();
}

function renderBaseMaterials() {
  const container = document.getElementById('base-materials');
  if (!container) return;

  const roots = state.build.map((b) => ({ id: b.id, qty: b.qty }));
  const ctx = computeCraftContext(roots);
  const depthMemo = new Map();
  const depthOf = (name) => getCraftDepth(slugify(name), depthMemo, new Set());

  const stationsLine = renderStationsLine(ctx.stations);
  const taxBlock = ctx.taxSteps.size ? renderTaxSection(ctx.taxSteps, 'this base', depthOf) : '';
  const intermediateSection = renderPlannerIntermediatesSection(ctx.intermediates, depthOf);
  const rawSection = renderPlannerRawMaterialsSection(ctx.rawTotals, ctx.altRaw);

  container.innerHTML = `
    ${stationsLine}
    ${taxBlock}
    <p class="raw-note">Everything needed to construct every building in your base plan, combined into one list.</p>
    ${intermediateSection}
    ${rawSection}
  `;

  container.querySelectorAll('.row-have-input').forEach((input) => {
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('input', () => {
      const digitsOnly = input.value.replace(/[^0-9]/g, '');
      if (digitsOnly !== input.value) {
        const pos = input.selectionStart - (input.value.length - digitsOnly.length);
        input.value = digitsOnly;
        input.setSelectionRange(pos, pos);
      }
      setOwnedQty(input.dataset.item, parseFloat(digitsOnly) || 0);
      const focusItemId = input.dataset.item;
      const cursorPos = input.selectionStart;
      renderBaseMaterials();
      const fresh = container.querySelector(`.row-have-input[data-item="${focusItemId}"]`);
      if (fresh) {
        fresh.focus();
        if (cursorPos != null) fresh.setSelectionRange(cursorPos, cursorPos);
      }
    });
  });
}

document.addEventListener('click', (e) => {
  if (e.target && e.target.id === 'base-materials-toggle') {
    const container = document.getElementById('base-materials');
    const wasHidden = container.hidden;
    if (wasHidden) renderBaseMaterials();
    container.hidden = !wasHidden;
    e.target.innerHTML = wasHidden
      ? 'Hide materials needed for this base &#9652;'
      : 'Show materials needed for this base &#9662;';
  }
});

// ---- "I want to automate ___" advisor ----
function renderAutomateSuggestions() {
  const query = document.getElementById('automate-search').value.trim().toLowerCase();
  const listEl = document.getElementById('automate-suggestions');
  if (!query) {
    listEl.innerHTML = '';
    return;
  }
  const matches = state.items
    .filter((i) => i.name.toLowerCase().includes(query) && (i.recipes && i.recipes.length))
    .slice(0, 8);
  listEl.innerHTML = matches
    .map((i) => `<li><button class="automate-suggestion-btn" data-id="${i.id}">${escapeHtml(i.name)}</button></li>`)
    .join('');
  listEl.querySelectorAll('.automate-suggestion-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.getElementById('automate-search').value = btn.textContent;
      listEl.innerHTML = '';
      runAutomateCheck(btn.dataset.id);
    });
  });
}

function runAutomateCheck(itemId) {
  const item = state.items.find((i) => i.id === itemId);
  const resultEl = document.getElementById('automate-result');
  if (!item) return;

  const qty = parseFloat(document.getElementById('automate-qty').value) || 1;
  const ctx = computeCraftContext([{ id: itemId, qty }]);

  if (!ctx.stations.size) {
    resultEl.innerHTML = `<p class="raw-note">No crafting stations needed for ×${qty.toLocaleString()} ${escapeHtml(item.name)} — it's gathered/raw, not built at a station.</p>`;
    return;
  }

  // Drone routes are one-item-per-route (confirmed in-game), so every distinct
  // crafted item along the chain needs its own route count based on its own recipe's
  // ingredient list — not just one number per station, since a station like Smelter
  // might be doing several different recipes with different ingredient counts.
  const itemsByStation = new Map();
  const allItemNames = [item.name, ...Array.from(ctx.intermediates.keys())];
  allItemNames.forEach((name) => {
    const it = state.items.find((i) => i.id === slugify(name));
    if (!it || !it.station || !it.recipes || !it.recipes.length) return;
    const ingredientCount = it.recipes[0].ingredients.length;
    const list = itemsByStation.get(it.station) || [];
    list.push({ name, ingredientCount });
    itemsByStation.set(it.station, list);
  });

  const rows = Array.from(ctx.stations)
    .map((station) => {
      const info = STATION_AUTOMATION[station];
      const craftedHere = itemsByStation.get(station) || [];
      const routeLines = craftedHere
        .map((c) => `<li>${escapeHtml(c.name)}: ${c.ingredientCount} route${c.ingredientCount === 1 ? '' : 's'} in (one per ingredient) + 1 more if you want the output sent to a Warehouse</li>`)
        .join('');
      const routeHtml = routeLines
        ? `<p class="raw-note">Drone routes needed here (each drone only carries one item type, confirmed in-game):</p><ul class="raw-note" style="padding-left:18px; list-style: disc;">${routeLines}</ul>`
        : '';

      if (!info) {
        return `<li class="automate-step"><span class="auto-tag auto-unknown">Unconfirmed</span><strong>${escapeHtml(station)}</strong><p class="raw-note">Not yet mapped to a specific building in this planner.</p>${routeHtml}</li>`;
      }
      const tag = info.automatable === true
        ? `<span class="auto-tag auto-yes">Automatable</span>`
        : info.automatable === false
          ? `<span class="auto-tag auto-no">Manual only</span>`
          : `<span class="auto-tag auto-unknown">Unconfirmed</span>`;
      const buildingText = info.building ? ` — build a <strong>${escapeHtml(info.building)}</strong>` : '';
      const addBtn = info.buildingId
        ? `<button class="automate-add-btn" data-id="${info.buildingId}">+ Add ${escapeHtml(info.building)} to base</button>`
        : '';
      return `
        <li class="automate-step">
          ${tag}<strong>${escapeHtml(station)}</strong>${buildingText}
          <p class="raw-note">${escapeHtml(info.note)}</p>
          ${routeHtml}
          ${addBtn}
        </li>
      `;
    })
    .join('');

  resultEl.innerHTML = `
    <p class="section-label">To automate ×${qty.toLocaleString()} ${escapeHtml(item.name)}, you'll need:</p>
    <ul class="automate-steps">${rows}</ul>
    <p class="raw-note">Remember: each route also uses up one of the SOURCE Warehouse or Extractor's own route slots, not just the crafting building's — plan Warehouse placement with that in mind.</p>
  `;

  resultEl.querySelectorAll('.automate-add-btn').forEach((btn) => {
    btn.addEventListener('click', () => addToBase(btn.dataset.id));
  });
}

// ---- Craft tree computation (same engine as the crafter's app.js — see app.js for
// the full explanation of the two-pass inventory-aware approach and the alt-recipe
// substitution logic. Kept in sync by hand since these are separate static pages
// with no shared module system.) ----
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
      return `<li>${plannerMatLink(name)}<span class="ing-qty">${valueHtml}</span></li>`;
    })
    .join('');
  const taxListSection = taxSteps.size
    ? `<p class="section-label">Tax by craft step</p><ul class="ingredients tax-list">${taxRows}</ul>`
    : '';

  return costLine + ' ' + taxListSection;
}

function plannerMatLink(name) {
  const slug = slugify(name);
  const linkable = state.items.some((i) => i.id === slug);
  if (!linkable) return `<span class="ing-name">${escapeHtml(name)}</span>`;
  return `<a class="ing-name linkable" href="index.html?item=${encodeURIComponent(slug)}" target="_blank" rel="noopener">${escapeHtml(name)}</a>`;
}

function renderPlannerMaterialRows(map, sortFn, withStation, altRawMap) {
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
                  <label class="row-have-wrap">have<input type="text" inputmode="numeric" pattern="[0-9]*" class="row-have-input" value="${getOwnedQty(info.slug) || ''}" placeholder="0" data-item="${info.slug}" aria-label="Quantity of ${escapeHtml(altName)} already on hand"></label>
                </div>
              `;
            })
            .join('')
        : '';

      return `
        <li class="material-row">
          <div class="material-row-main" data-item="${slug}">
            ${plannerMatLink(name)}
            <span class="ing-qty">${coveredTag}${stationTag}${displayQty > 0 ? `×${displayQty.toLocaleString()}` : ''}</span>
            <label class="row-have-wrap">have<input type="text" inputmode="numeric" pattern="[0-9]*" class="row-have-input" value="${owned ? Math.ceil(owned - 1e-9) : ''}" placeholder="0" data-item="${slug}" aria-label="Quantity of ${escapeHtml(name)} already on hand"></label>
          </div>
          ${altHtml}
        </li>
      `;
    })
    .join('');
}

function renderPlannerIntermediatesSection(intermediates, depthOf) {
  if (!intermediates.size) return '';
  const rows = renderPlannerMaterialRows(intermediates, (a, b) => depthOf(b[0]) - depthOf(a[0]) || b[1] - a[1], true);
  return `<p class="section-label">Sub-crafts needed along the way</p><p class="raw-note">Ordered top to bottom: most complex first, basic ingots last — right above the raw materials below.</p><ul class="ingredients raw-list">${rows}</ul>`;
}

function renderPlannerRawMaterialsSection(rawTotals, altRawMap) {
  const rows = renderPlannerMaterialRows(rawTotals, (a, b) => b[1] - a[1], false, altRawMap);
  return `<p class="section-label">Base/raw materials</p><ul class="ingredients raw-list">${rows}</ul>`;
}

// ---- Utilities ----
function slugify(name) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

init();
