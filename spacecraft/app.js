// ---- State ----
const state = {
  items: [],
  category: 'All',
  query: '',
  plan: [],
};

const PLAN_STORAGE_KEY = 'spacecraft-blueprint-plan';

function loadPlan() {
  try {
    const raw = localStorage.getItem(PLAN_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return []; // storage unavailable (private browsing etc.) — plan just won't persist
  }
}

function savePlan() {
  try {
    localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify(state.plan));
  } catch (e) {
    // ignore — not fatal if it can't persist
  }
}

function addToPlan(itemId, qty) {
  qty = qty > 0 ? qty : 1;
  const existing = state.plan.find((p) => p.id === itemId);
  if (existing) {
    existing.qty += qty;
  } else {
    state.plan.push({ id: itemId, qty });
  }
  savePlan();
  updatePlanCount();
  if (!document.getElementById('plan-overlay').hidden) renderPlanModal();
}

function removeFromPlan(itemId) {
  state.plan = state.plan.filter((p) => p.id !== itemId);
  savePlan();
  updatePlanCount();
  renderPlanModal();
}

function setPlanQty(itemId, qty) {
  const entry = state.plan.find((p) => p.id === itemId);
  if (entry) {
    entry.qty = qty > 0 ? qty : 1;
    savePlan();
    renderPlanModal();
  }
}

function updatePlanCount() {
  const badge = document.getElementById('plan-count');
  if (badge) badge.textContent = state.plan.length;
}

// ---- Init ----
async function init() {
  const res = await fetch('data/recipes.json?v=4');
  state.items = await res.json();
  state.plan = loadPlan();
  updatePlanCount();

  render();

  document.getElementById('search').addEventListener('input', (e) => {
    state.query = e.target.value.trim().toLowerCase();
    render();
  });

  document.getElementById('category-select').addEventListener('change', (e) => {
    state.category = e.target.value;
    render();
  });

  document.getElementById('plan-button').addEventListener('click', openPlanModal);
  document.getElementById('plan-close').addEventListener('click', closePlanModal);
  document.getElementById('plan-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'plan-overlay') closePlanModal();
  });
}

// ---- Plan modal ----
function openPlanModal() {
  document.getElementById('plan-overlay').hidden = false;
  renderPlanModal();
}

function closePlanModal() {
  document.getElementById('plan-overlay').hidden = true;
}

function renderPlanModal() {
  const body = document.getElementById('plan-modal-body');
  const idLookup = new Set(state.items.map((i) => i.id));

  if (!state.plan.length) {
    body.innerHTML = `<p class="plan-empty">Nothing in your plan yet — find an item, set a quantity, and tap "+ Plan" to add it here.</p>`;
    return;
  }

  const planRows = state.plan
    .map((p) => {
      const item = state.items.find((i) => i.id === p.id);
      if (!item) return '';
      return `
        <li class="plan-row" data-plan-item="${p.id}">
          <span class="plan-row-name">${escapeHtml(item.name)}</span>
          <input type="number" class="qty-input plan-qty-input" min="1" step="1" value="${p.qty}" data-plan-item="${p.id}" aria-label="Quantity">
          <button class="plan-remove" data-plan-item="${p.id}" aria-label="Remove from plan">&times;</button>
        </li>
      `;
    })
    .join('');

  const ctx = newCraftCtx();
  state.plan.forEach((p) => {
    if (idLookup.has(p.id)) walkCraftTree(p.id, p.qty, new Set(), ctx);
  });

  const depthMemo = new Map();
  const depthOf = (name) => getCraftDepth(slugify(name), depthMemo, new Set());

  // The plan can mix items with recipes and pure raw materials with none, so the tax
  // section is shown whenever there's at least one taxed craft step anywhere in the
  // combined chain — not gated on a single top-level recipe like the per-item view is.
  const taxBlock = ctx.taxSteps.size ? renderTaxSection(ctx.taxSteps, 'station', 'this plan', depthOf, idLookup) : '';

  body.innerHTML = `
    <p class="section-label">Items in this plan</p>
    <ul class="plan-list">${planRows}</ul>
    ${renderStationsLine(ctx.stations)}
    ${taxBlock}
    ${renderIntermediatesSection(ctx.intermediates, depthOf, idLookup)}
    ${renderRawMaterialsSection(ctx.rawTotals, idLookup)}
  `;

  body.querySelectorAll('.plan-qty-input').forEach((input) => {
    input.addEventListener('change', () => setPlanQty(input.dataset.planItem, parseFloat(input.value)));
  });
  body.querySelectorAll('.plan-remove').forEach((btn) => {
    btn.addEventListener('click', () => removeFromPlan(btn.dataset.planItem));
  });
  body.querySelectorAll('.ing-name.linkable').forEach((link) => {
    link.addEventListener('click', () => {
      closePlanModal();
      goToItem(link.dataset.target);
    });
  });
}

// ---- Filtering ----
function matches(item) {
  const inCategory = state.category === 'All' || item.group === state.category;
  if (!inCategory) return false;
  if (!state.query) return true;

  const haystack = [item.name, item.used_for, ...(item.ingredients || []).map((i) => i.item)]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return haystack.includes(state.query);
}

// ---- Rendering ----
function render() {
  const list = document.getElementById('list');
  const visible = state.items.filter(matches);

  document.getElementById('count').textContent = `${state.items.length} items indexed`;

  if (visible.length === 0) {
    list.innerHTML = `<p class="empty">No blueprints match "${escapeHtml(state.query)}".</p>`;
    return;
  }

  list.innerHTML = visible.map(renderItem).join('');

  // accordion toggles — on wide screens, also push the item into the detail panel
  list.querySelectorAll('.item-head').forEach((head) => {
    head.addEventListener('click', () => {
      const itemEl = head.closest('.item');
      toggleItem(itemEl, !itemEl.classList.contains('open'));
      if (isDesktopLayout()) {
        renderDetailPanel(itemEl.id.replace('item-', ''));
      }
    });
  });

  wireItemControls(list);
}

function isDesktopLayout() {
  return window.matchMedia('(min-width: 860px)').matches;
}

// Navigating to an ingredient: on wide screens, update the persistent detail panel
// (the list never moves). On narrow screens, fall back to scrolling/expanding in place.
function goToItem(targetId) {
  if (isDesktopLayout()) {
    renderDetailPanel(targetId);
  } else {
    jumpTo(targetId);
  }
}

// Wires up every interactive control (jump links, raw-materials toggle, qty input,
// manual/auto toggle) within a given root — used for both the main list and the
// detail panel so they behave identically wherever an item is rendered.
function wireItemControls(root) {
  root.querySelectorAll('.ing-name.linkable').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.stopPropagation();
      goToItem(link.dataset.target);
    });
  });

  root.querySelectorAll('.raw-controls').forEach((wrap) => {
    const id = wrap.dataset.item;
    const dom = wrap.dataset.dom;
    const toggleBtn = wrap.querySelector('.raw-toggle');
    const qtyInput = wrap.querySelector('.qty-input');
    const speedBtn = wrap.querySelector('.speed-toggle');
    const locBtn = wrap.querySelector('[data-loc]');
    const container = wrap.querySelector('.raw-breakdown');

    const refresh = () => {
      renderRawBreakdown(id, container, getQty(qtyInput), getMode(speedBtn), getLocation(locBtn));
      refreshAccordionHeight(wrap);
    };

    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasHidden = container.hidden;
      if (wasHidden) refresh();
      container.hidden = !wasHidden;
      toggleBtn.innerHTML = wasHidden ? 'Hide full raw materials &#9652;' : 'Show full raw materials &#9662;';
      refreshAccordionHeight(wrap);
    });

    qtyInput.addEventListener('click', (e) => e.stopPropagation());
    qtyInput.addEventListener('input', () => {
      if (!container.hidden) refresh();
    });

    speedBtn && speedBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const nextMode = speedBtn.dataset.mode === 'manual' ? 'auto' : 'manual';
      speedBtn.dataset.mode = nextMode;
      speedBtn.textContent = nextMode === 'auto' ? 'Auto' : 'Manual';
      speedBtn.classList.toggle('active', nextMode === 'auto');
      if (!container.hidden) refresh();
    });

    locBtn && locBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const nextLoc = locBtn.dataset.loc === 'station' ? 'base' : 'station';
      locBtn.dataset.loc = nextLoc;
      locBtn.textContent = nextLoc === 'base' ? 'Base' : 'Station';
      locBtn.classList.toggle('active', nextLoc === 'base');
      if (!container.hidden) refresh();
    });

    const planBtn = wrap.querySelector('.plan-add-btn');
    planBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      addToPlan(id, getQty(qtyInput));
      const original = planBtn.textContent;
      planBtn.textContent = 'Added';
      planBtn.classList.add('active');
      setTimeout(() => {
        planBtn.textContent = original;
        planBtn.classList.remove('active');
      }, 900);
    });
  });
}

function refreshAccordionHeight(el) {
  const itemEl = el.closest('.item');
  if (itemEl && itemEl.classList.contains('open')) {
    const body = itemEl.querySelector('.item-body');
    body.style.maxHeight = body.scrollHeight + 'px';
  }
}

function getQty(input) {
  const val = parseFloat(input && input.value);
  return val > 0 ? val : 1;
}

function getMode(btn) {
  return (btn && btn.dataset.mode) || 'manual';
}

function getLocation(btn) {
  return (btn && btn.dataset.loc) || 'station';
}

// ---- Detail panel (persistent second column on wide screens) ----
function renderDetailPanel(itemId) {
  const panel = document.getElementById('detail');
  const item = state.items.find((i) => i.id === itemId);
  if (!panel || !item) return;

  const idLookup = new Set(state.items.map((i) => i.id));
  const domId = 'detail-' + item.id;
  const bodyHtml = buildItemBody(item, idLookup, domId);
  const verifiedDot = item.verified === false ? ' class="dot unverified"' : ' class="dot verified"';

  panel.innerHTML = `
    <div class="detail-head">
      <span${verifiedDot} title="${item.verified === false ? 'Unverified' : 'Verified in-game'}"></span>
      <span class="item-name">${escapeHtml(item.name)}</span>
      <span class="badge type-${item.type}">${item.type}</span>
      <button class="detail-close" aria-label="Close">&times;</button>
    </div>
    <div class="detail-body body-inner">${bodyHtml}</div>
  `;

  panel.querySelector('.detail-close').addEventListener('click', () => {
    panel.innerHTML = '<div class="detail-empty">Tap any item to see its full recipe and complete raw-materials breakdown here.</div>';
  });

  wireItemControls(panel);

  // auto-expand the raw breakdown immediately — the whole point of this panel
  const wrap = panel.querySelector('.raw-controls');
  if (wrap) {
    const container = wrap.querySelector('.raw-breakdown');
    const toggleBtn = wrap.querySelector('.raw-toggle');
    renderRawBreakdown(item.id, container, 1, 'manual', 'station');
    container.hidden = false;
    toggleBtn.innerHTML = 'Hide full raw materials &#9652;';
  }
}

function renderItem(item) {
  const idLookup = new Set(state.items.map((i) => i.id));
  const bodyHtml = buildItemBody(item, idLookup, item.id);
  const verifiedDot = item.verified === false ? ' class="dot unverified"' : ' class="dot verified"';
  const isBuy = item.type === 'buy';
  const isExtract = item.type === 'extract';
  const isBuild = item.type === 'build';
  const isGather = item.type === 'gather';

  return `
    <div class="item${isBuy ? ' buy' : ''}${isExtract ? ' extract' : ''}${isBuild ? ' build' : ''}${isGather ? ' gather' : ''}" id="item-${item.id}">
      <div class="item-head">
        <span${verifiedDot} title="${item.verified === false ? 'Unverified' : 'Verified in-game'}"></span>
        <span class="item-name">${escapeHtml(item.name)}</span>
        <span class="badge type-${item.type}">${item.type}</span>
        ${item.tier ? `<span class="badge tier">T${item.tier}</span>` : ''}
        <span class="chevron">&#9656;</span>
      </div>
      <div class="item-body"><div class="body-inner">${bodyHtml}</div></div>
    </div>
  `;
}

function buildItemBody(item, idLookup, domId) {
  const isBuy = item.type === 'buy';
  const isExtract = item.type === 'extract';
  const isBuild = item.type === 'build';
  const isGather = item.type === 'gather';
  const hasRecipes = item.recipes && item.recipes.length;
  const legacyTime = item.time_sec; // old wiki-only field, only used when there's no recipes array

  let bodyHtml = '';

  if (item.verified === false) {
    bodyHtml += `<p class="source-note">⚠ Unverified — pulled from wiki, not confirmed in-game yet.</p>`;
  }

  if (item.subcategory) {
    bodyHtml += `<p class="module-breadcrumb">${escapeHtml(item.category)} &rsaquo; ${escapeHtml(item.subcategory)}</p>`;
  }

  if (item.value != null || item.storage_units != null) {
    const bits = [];
    if (item.value != null) bits.push(`<strong>${item.value}</strong> value`);
    if (item.storage_units != null) bits.push(`${item.storage_units} su`);
    bodyHtml += `<p class="material-stats">${bits.join(' &nbsp;·&nbsp; ')}</p>`;
  }

  if (isBuy) {
    bodyHtml += `<div class="price-line">${item.price.toFixed(2)} cr</div>`;
    bodyHtml += `<p class="station-line">Buy at <strong>${escapeHtml(item.station)}</strong></p>`;
  } else if (isExtract) {
    const ex = item.extraction_info || {};
    bodyHtml += `<p class="station-line">Extracted via <strong>${escapeHtml(item.station)}</strong></p>`;
    const exSpecs = [];
    if (ex.cycle_time_sec != null) exSpecs.push(`${formatDuration(ex.cycle_time_sec)} per cycle`);
    if (ex.storage_capacity_su != null) exSpecs.push(`${ex.storage_capacity_su} su capacity`);
    if (ex.output_buffer_max != null) exSpecs.push(`${ex.output_buffer_max} max output buffer`);
    if (ex.energy_consumption_ma != null) exSpecs.push(`${ex.energy_consumption_ma} MA when running`);
    if (exSpecs.length) {
      bodyHtml += `<p class="specs-line">${exSpecs.map(escapeHtml).join(' &nbsp;·&nbsp; ')}</p>`;
    }
  } else if (isBuild) {
    const bi = item.build_info || {};
    if (bi.description) {
      bodyHtml += `<p class="module-desc">${escapeHtml(bi.description)}</p>`;
    }
    const buildSpecs = [];
    if (bi.fp_cost != null) buildSpecs.push(`${bi.fp_cost} FP`);
    if (bi.xp_bonus != null) buildSpecs.push(`+${bi.xp_bonus} XP first build`);
    if (buildSpecs.length) {
      bodyHtml += `<p class="specs-line">${buildSpecs.map(escapeHtml).join(' &nbsp;·&nbsp; ')}</p>`;
    }
    bodyHtml += `<p class="station-line">Place with <strong>${escapeHtml(item.station)}</strong></p>`;
    const buildRows = (item.ingredients || [])
      .map((ing) => {
        const slug = slugify(ing.item);
        const linkable = idLookup.has(slug);
        const linkAttrs = linkable ? ` data-target="${slug}"` : '';
        const linkClass = linkable ? ' linkable' : '';
        return `<li><span class="ing-name${linkClass}"${linkAttrs}>${escapeHtml(ing.item)}</span><span class="ing-qty">×${ing.qty}</span></li>`;
      })
      .join('');
    bodyHtml += `<ul class="ingredients">${buildRows}</ul>`;
  } else if (isGather) {
    // Gathered/found-in-the-world materials. Most have no synthesis recipe at all
    // (pure raw resource — nothing to "craft"). A handful (Pyrite, Aquamarine, Quartz,
    // Graphite Crystal, Sulfur) can ALSO be synthesized at a Crystallizer or Smelter —
    // show that recipe if present, but skip the "Craft at" line entirely otherwise.
    if (hasRecipes) {
      bodyHtml += `<p class="station-line">Synthesized at <strong>${escapeHtml(item.station)}</strong></p>`;
      bodyHtml += item.recipes.map((r) => renderRecipeBlock(r, idLookup)).join('');
    }
  } else {
    const timeNote = !hasRecipes && legacyTime ? ` · ${legacyTime}s` : '';
    bodyHtml += `<p class="station-line">Craft at <strong>${escapeHtml(item.station)}</strong>${timeNote}</p>`;

    if (hasRecipes) {
      bodyHtml += item.recipes.map((r) => renderRecipeBlock(r, idLookup)).join('');
    } else {
      const rows = (item.ingredients || [])
        .map((ing) => {
          const slug = slugify(ing.item);
          const linkable = idLookup.has(slug);
          const linkAttrs = linkable ? ` data-target="${slug}"` : '';
          const linkClass = linkable ? ' linkable' : '';
          return `<li><span class="ing-name${linkClass}"${linkAttrs}>${escapeHtml(ing.item)}</span><span class="ing-qty">×${ing.qty}</span></li>`;
        })
        .join('');

      bodyHtml += `<ul class="ingredients">${rows}</ul>`;
    }
  }

  const hasAnyIngredients = hasRecipes || (item.ingredients && item.ingredients.length);
  if (hasAnyIngredients && !isBuy && !isExtract) {
    bodyHtml += `
      <div class="raw-controls" data-item="${item.id}" data-dom="${domId}">
        <div class="raw-row">
          <button class="raw-toggle">Show full raw materials &#9662;</button>
          <input type="number" class="qty-input" id="qty-${domId}" min="1" step="1" value="1" aria-label="Quantity">
          ${hasRecipes ? `<button class="speed-toggle" id="speed-${domId}" data-mode="manual">Manual</button>` : ''}
          ${hasRecipes ? `<button class="speed-toggle" id="loc-${domId}" data-loc="station">Station</button>` : ''}
          <button class="plan-add-btn" data-item="${item.id}">+ Plan</button>
        </div>
        <div class="raw-breakdown" id="raw-${domId}" hidden></div>
      </div>
    `;
  }

  if (item.used_for) {
    bodyHtml += `<p class="used-for">Used for: ${escapeHtml(item.used_for)}</p>`;
  }

  if (item.note) {
    bodyHtml += `<p class="note-line">📝 ${escapeHtml(item.note)}</p>`;
  }

  if (item.specs && item.specs.length) {
    bodyHtml += renderSpecsInfo(item.specs);
  }

  if (item.analysis_tiers && item.analysis_tiers.length) {
    bodyHtml += renderAnalysisTiers(item.analysis_tiers);
  }

  if (item.deposits && item.deposits.length) {
    bodyHtml += renderDeposits(item.deposits);
  }

  if (item.module_info) {
    bodyHtml += renderModuleInfo(item.module_info, item.category);
  }

  return bodyHtml;
}

// ---- Gathering-specific sections: SPECS, Analysis (Laboratory), Contained in Resources ----
function renderSpecsInfo(specs) {
  const rows = specs.map((s) => `<li>${escapeHtml(s)}</li>`).join('');
  return `<p class="section-label">Specs</p><ul class="specs-list">${rows}</ul>`;
}

function renderAnalysisTiers(tiers) {
  const rows = tiers
    .map((t) => {
      const tierClass = t.unlocked ? 'tier-unlocked' : 'tier-locked';
      const lockNote = !t.unlocked && t.unlock_requirement
        ? `<span class="lock-note">${escapeHtml(t.unlock_requirement)}</span>`
        : '';
      return `<li class="${tierClass}"><span class="tier-name">${escapeHtml(t.tier)}</span>${lockNote}</li>`;
    })
    .join('');
  return `<p class="section-label">Analysis (Laboratory)</p><ul class="analysis-list">${rows}</ul>`;
}

function renderDeposits(deposits) {
  const rows = deposits
    .map((d) => `<li><span class="ing-name">${escapeHtml(d.resource)}</span><span class="ing-qty">${escapeHtml(String(d.yield))}</span></li>`)
    .join('');
  return `<p class="section-label">Contained in resources</p><ul class="ingredients deposits-list">${rows}</ul>`;
}

function formatLocation(loc) {
  return loc.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function renderModuleInfo(info, category) {
  const statRows = info.stats
    ? Object.entries(info.stats)
        .map(([k, v]) => `<li><span class="stat-key">${escapeHtml(k)}</span><span class="stat-val">${escapeHtml(v)}</span></li>`)
        .join('')
    : '';

  return `
    <div class="module-info">
      ${info.subcategory ? `<p class="module-breadcrumb">${escapeHtml(category)} &rsaquo; ${escapeHtml(info.subcategory)}</p>` : ''}
      ${info.description ? `<p class="module-desc">${escapeHtml(info.description)}</p>` : ''}
      ${statRows ? `<ul class="module-stats">${statRows}</ul>` : ''}
      <div class="module-footer">
        ${info.tag ? `<span class="badge tag-badge">${escapeHtml(info.tag)}</span>` : ''}
        ${info.sell_price != null ? `<span class="sell-price">${info.sell_price} cr sell</span>` : ''}
      </div>
    </div>
  `;
}

function renderRecipeBlock(recipe, idLookup) {
  const rows = (recipe.ingredients || [])
    .map((ing) => {
      const slug = slugify(ing.item);
      const linkable = idLookup.has(slug);
      const linkAttrs = linkable ? ` data-target="${slug}"` : '';
      const linkClass = linkable ? ' linkable' : '';
      return `<li><span class="ing-name${linkClass}"${linkAttrs}>${escapeHtml(ing.item)}</span><span class="ing-qty">×${ing.qty}</span></li>`;
    })
    .join('');

  const yieldTag = recipe.output_qty && recipe.output_qty !== 1
    ? ` <span class="yield-tag">yields ×${recipe.output_qty}</span>`
    : '';

  let bonusHtml = '';
  if (recipe.additional_outputs && recipe.additional_outputs.length) {
    const bonusRows = recipe.additional_outputs
      .map((o) => {
        const slug = slugify(o.item);
        const linkable = idLookup.has(slug);
        const linkAttrs = linkable ? ` data-target="${slug}"` : '';
        const linkClass = linkable ? ' linkable' : '';
        return `<li><span class="ing-name${linkClass}"${linkAttrs}>${escapeHtml(o.item)}</span><span class="ing-qty">×${o.qty || 1}</span></li>`;
      })
      .join('');
    bonusHtml = `<p class="bonus-label">Also produces:</p><ul class="ingredients bonus-list">${bonusRows}</ul>`;
  }

  const specs = [];
  if (recipe.craft_time_sec != null) {
    const autoNote = recipe.auto_craft_time_sec != null ? ` / ${formatDuration(recipe.auto_craft_time_sec)} auto` : '';
    specs.push(`${recipe.craft_time_sec}s manual${autoNote}`);
  }
  if (recipe.storage_units != null) specs.push(`${recipe.storage_units} su`);
  if (recipe.added_value != null) specs.push(`+${recipe.added_value} value`);
  if (recipe.tax) {
    const bits = Object.entries(recipe.tax).map(([loc, val]) => `${val} (${formatLocation(loc)})`);
    specs.push(`tax — ${bits.join(', ')}`);
  }
  const specsLine = specs.length ? `<p class="specs-line">${specs.map(escapeHtml).join(' &nbsp;·&nbsp; ')}</p>` : '';

  return `
    <div class="recipe-block">
      ${recipe.label ? `<p class="recipe-label">${escapeHtml(recipe.label)}${yieldTag}</p>` : ''}
      <ul class="ingredients">${rows}</ul>
      ${bonusHtml}
      ${specsLine}
    </div>
  `;
}

// ---- Craft tree walker (unified) ----
// Walks every sub-recipe down to ingredients with no recipe of their own (true raw
// materials, or unconfirmed gaps), all in one pass. Populates four things on `ctx`:
//   - rawTotals: true raw leaves at the bottom of the chain (e.g. Copper Ore)
//   - intermediates: anything that itself has a recipe (e.g. Copper Ingot) — gets
//     fully expanded further, but we still record how much of it is needed along the way
//   - taxSteps: station tax per craft step (Map<name, {cost, confirmed}>) — confirmed is
//     false for any step whose recipe doesn't have a tax number yet (e.g. Crystallizer recipes)
//   - stations: the set of every station name touched anywhere in the chain
// This is the one function both the single-item breakdown AND the multi-item Plan use —
// the Plan just calls this once per planned item, passing the SAME ctx each time so
// everything accumulates together automatically.
// Where an item has multiple recipe paths, the first listed one is used. Items with a flat
// `ingredients` list (no recipes array, e.g. placeable buildings) are supported too —
// treated as a single batch of 1. `visiting` should be a fresh Set per top-level call.
function walkCraftTree(itemId, neededQty, visiting, ctx) {
  const item = state.items.find((i) => i.id === itemId);
  if (!item || visiting.has(itemId)) return;

  const recipe = item.recipes && item.recipes.length ? item.recipes[0] : null;
  const flatIngredients = !recipe && item.ingredients && item.ingredients.length ? item.ingredients : null;
  if (!recipe && !flatIngredients) return; // raw leaf — nothing further to expand

  visiting.add(itemId);
  const ingredients = recipe ? recipe.ingredients : flatIngredients;
  const batchSize = recipe ? recipe.output_qty || 1 : 1;
  const batches = neededQty / batchSize;

  if (item.station) ctx.stations.add(item.station);

  if (recipe) {
    const taxedEntry = recipe.tax && Object.entries(recipe.tax).find(([loc]) => loc !== 'personal_base');
    const entry = ctx.taxSteps.get(item.name) || { cost: 0, confirmed: true };
    if (taxedEntry) {
      entry.cost += batches * taxedEntry[1];
    } else {
      entry.confirmed = false;
    }
    ctx.taxSteps.set(item.name, entry);
  }

  (ingredients || []).forEach((ing) => {
    const slug = slugify(ing.item);
    const subItem = state.items.find((i) => i.id === slug);
    const requiredQty = ing.qty * batches;
    // If the sub-item is already being expanded further up this call stack, we've
    // hit a real cycle (e.g. Pyrite -> Sulfur -> Pyrite via the Crystallizer recipes).
    // Treat it as a raw leaf here instead of recursing again — recursing would just
    // return immediately and silently drop this quantity from the total.
    const cyclic = subItem && visiting.has(slug);
    const subExpandable = subItem && !cyclic && ((subItem.recipes && subItem.recipes.length) || (subItem.ingredients && subItem.ingredients.length));

    if (subExpandable) {
      ctx.intermediates.set(ing.item, (ctx.intermediates.get(ing.item) || 0) + requiredQty);
      walkCraftTree(slug, requiredQty, visiting, ctx);
    } else {
      ctx.rawTotals.set(ing.item, (ctx.rawTotals.get(ing.item) || 0) + requiredQty);
    }
  });

  visiting.delete(itemId);
}

function newCraftCtx() {
  return { rawTotals: new Map(), intermediates: new Map(), taxSteps: new Map(), stations: new Set() };
}

// ---- Craft depth (steps removed from raw materials) ----
// Used purely for display ordering. An item crafted directly from raw materials
// (e.g. Copper Ingot, straight from Copper Ore) has depth 1. An item built from THAT
// (e.g. Wire, from Copper Ingot) has depth 2, and so on — depth is always 1 + the
// deepest of its own expandable ingredients. Memoized since the same item can show up
// in many branches of a big breakdown.
function getCraftDepth(itemId, memo, visiting) {
  if (memo.has(itemId)) return memo.get(itemId);
  if (visiting.has(itemId)) return 0; // cycle guard — don't loop forever on Pyrite<->Sulfur etc.

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

// ---- Shared rendering for a computed craft-tree ctx (used by both the single-item
// breakdown and the multi-item Plan, so they always look and behave identically) ----
function renderStationsLine(stations) {
  if (!stations.size) return '';
  const chips = Array.from(stations)
    .map((s) => `<span class="station-chip">${escapeHtml(s)}</span>`)
    .join('');
  return `<p class="section-label">Stations needed</p><div class="stations-line">${chips}</div>`;
}

function renderTaxSection(taxSteps, location, qtyLabel, depthOf, idLookup) {
  if (location === 'base') {
    return `<p class="cost-line">&#128176; Free — no tax crafting at a personal base.</p>`;
  }
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
      const slug = slugify(name);
      const linkable = idLookup.has(slug);
      const linkAttrs = linkable ? ` data-target="${slug}"` : '';
      const linkClass = linkable ? ' linkable' : '';
      const valueHtml = s.confirmed ? `${s.cost.toFixed(2)} cr` : 'tax not confirmed yet';
      return `<li><span class="ing-name${linkClass}"${linkAttrs}>${escapeHtml(name)}</span><span class="ing-qty">${valueHtml}</span></li>`;
    })
    .join('');
  const taxListSection = taxSteps.size
    ? `<p class="section-label">Tax by craft step</p><ul class="ingredients tax-list">${taxRows}</ul>`
    : '';

  return costLine + ' ' + taxListSection;
}

function stationFor(name) {
  const item = state.items.find((i) => i.id === slugify(name));
  return item && item.recipes && item.recipes.length ? item.station : null;
}

function renderMaterialRows(map, sortFn, idLookup, withStation) {
  return Array.from(map.entries())
    .sort(sortFn)
    .map(([name, total]) => {
      const slug = slugify(name);
      const linkable = idLookup.has(slug);
      const linkAttrs = linkable ? ` data-target="${slug}"` : '';
      const linkClass = linkable ? ' linkable' : '';
      const displayQty = Math.ceil(total - 1e-9); // tiny epsilon guards against float noise like 6.0000000001
      const station = withStation ? stationFor(name) : null;
      const stationTag = station ? `<span class="station-chip station-chip-inline">${escapeHtml(station)}</span>` : '';
      return `<li><span class="ing-name${linkClass}"${linkAttrs}>${escapeHtml(name)}</span><span class="ing-qty">${stationTag}×${displayQty}</span></li>`;
    })
    .join('');
}

function renderIntermediatesSection(intermediates, depthOf, idLookup) {
  if (!intermediates.size) return '';
  const rows = renderMaterialRows(intermediates, (a, b) => depthOf(b[0]) - depthOf(a[0]) || b[1] - a[1], idLookup, true);
  return `<p class="section-label">Sub-crafts needed along the way</p><p class="raw-note">Ordered top to bottom: most complex first, basic ingots last — right above the raw materials below.</p><ul class="ingredients raw-list">${rows}</ul>`;
}

function renderRawMaterialsSection(rawTotals, idLookup) {
  const rows = renderMaterialRows(rawTotals, (a, b) => b[1] - a[1], idLookup, false);
  return `<p class="section-label">Base/raw materials</p><ul class="ingredients raw-list">${rows}</ul>`;
}

function renderRawBreakdown(itemId, container, qty, mode, location) {
  qty = qty || 1;
  mode = mode || 'manual';
  location = location || 'station';
  const ctx = newCraftCtx();
  walkCraftTree(itemId, qty, new Set(), ctx);
  const idLookup = new Set(state.items.map((i) => i.id));
  const depthMemo = new Map();
  const depthOf = (name) => getCraftDepth(slugify(name), depthMemo, new Set());

  const topItem = state.items.find((i) => i.id === itemId);
  const topRecipe = topItem.recipes && topItem.recipes.length ? topItem.recipes[0] : null;

  let timeLine = '';
  if (topRecipe && topRecipe.craft_time_sec != null) {
    const batchSize = topRecipe.output_qty || 1;
    const batchesNeeded = Math.ceil(qty / batchSize);
    const usingAuto = mode === 'auto' && topRecipe.auto_craft_time_sec != null;
    const fellBack = mode === 'auto' && topRecipe.auto_craft_time_sec == null;
    const perCraft = usingAuto ? topRecipe.auto_craft_time_sec : topRecipe.craft_time_sec;
    const modeLabel = usingAuto ? 'auto machine' : 'manual craft';
    const fallbackNote = fellBack ? ' — auto time not confirmed yet for this one, showing manual instead' : '';
    timeLine = `<p class="time-line">&#9201; ~${formatDuration(batchesNeeded * perCraft)} to craft ×${qty} (${batchesNeeded} batch${batchesNeeded === 1 ? '' : 'es'} of ${perCraft}s each, ${modeLabel}, one machine running back-to-back)${fallbackNote}</p>`;
  }

  const stationsLine = renderStationsLine(ctx.stations);
  const taxBlock = topRecipe ? renderTaxSection(ctx.taxSteps, location, `×${qty}`, depthOf, idLookup) : '';
  const intermediateSection = renderIntermediatesSection(ctx.intermediates, depthOf, idLookup);

  container.innerHTML = `
    ${timeLine}
    ${stationsLine}
    ${taxBlock}
    <p class="raw-note">Everything needed for ×${qty}, tracing each sub-recipe down to its base materials (using the first recipe option at each step where there's more than one):</p>
    ${intermediateSection}
    ${renderRawMaterialsSection(ctx.rawTotals, idLookup)}
  `;

  container.querySelectorAll('.ing-name.linkable').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.stopPropagation();
      goToItem(link.dataset.target);
    });
  });
}

function formatDuration(totalSeconds) {
  if (totalSeconds < 60) return `${Math.round(totalSeconds)}s`;
  const totalMinutes = totalSeconds / 60;
  if (totalMinutes < 60) return `${Math.round(totalMinutes * 10) / 10}m`;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.round((totalSeconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

// ---- Accordion + jump-to-recipe helpers ----
function toggleItem(itemEl, open) {
  itemEl.classList.toggle('open', open);
  const body = itemEl.querySelector('.item-body');
  body.style.maxHeight = open ? body.scrollHeight + 'px' : '0px';
}

function jumpTo(id) {
  const alreadyVisible = document.getElementById('item-' + id);

  // if the target is filtered out right now, reset filters so it shows up
  if (!alreadyVisible) {
    state.query = '';
    state.category = 'All';
    document.getElementById('search').value = '';
    document.getElementById('category-select').value = 'All';
    render();
  }

  requestAnimationFrame(() => {
    const el = document.getElementById('item-' + id);
    if (!el) return;
    toggleItem(el, true);
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
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

// ---- Theme picker ----
function initTheme() {
  const saved = localStorage.getItem('spacecraft-theme') || 'default';
  applyTheme(saved);

  document.querySelectorAll('.theme-dot').forEach((dot) => {
    dot.classList.toggle('active', dot.dataset.theme === saved);
    dot.addEventListener('click', () => {
      const theme = dot.dataset.theme;
      applyTheme(theme);
      localStorage.setItem('spacecraft-theme', theme);
      document.querySelectorAll('.theme-dot').forEach((d) => d.classList.toggle('active', d === dot));
    });
  });
}

function applyTheme(theme) {
  if (theme === 'default') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

init();
initTheme();
