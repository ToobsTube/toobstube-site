// ---- State ----
const state = {
  items: [],
  category: 'All',
  query: '',
  plan: [],
  inventory: {}, // itemId -> qty already on hand
};

// Tracks which item's "Reset amounts used for this" button is currently armed
// (waiting for a confirming second click). Lives outside renderRawBreakdown on
// purpose: that function's whole button gets torn down and rebuilt on every
// unrelated edit (typing in a "have" box, changing quantity, etc.), so storing the
// armed state as a variable INSIDE that function meant any of those edits silently
// disarmed it, forcing several attempts to actually confirm a reset.
let resetArmedItemId = null;
let resetArmedTimeoutId = null;

const PLAN_STORAGE_KEY = 'spacecraft-blueprint-plan';
const INVENTORY_STORAGE_KEY = 'spacecraft-inventory';

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

// "I just crafted N of this" — adds N to the item's own on-hand stock, and subtracts
// what that actually took from its DIRECT ingredients' on-hand stock (one level only —
// crafting a Magnetic Coil uses up Wire/Iron Ingot/Nut and Bolt you already had, but it
// doesn't reach further down and touch Copper Ingot; that got consumed earlier, when
// the Wire itself was crafted). Ingredients with no matching catalog item are skipped
// since there's nowhere to track their inventory.
function markCrafted(itemId, qty) {
  if (!(qty > 0)) return;
  const item = state.items.find((i) => i.id === itemId);
  if (!item) return;

  const recipe = item.recipes && item.recipes.length ? item.recipes[0] : null;
  const flatIngredients = !recipe && item.ingredients && item.ingredients.length ? item.ingredients : null;
  const ingredients = recipe ? recipe.ingredients : flatIngredients;
  const batchSize = recipe ? recipe.output_qty || 1 : 1;
  const batches = qty / batchSize;

  setOwnedQty(itemId, getOwnedQty(itemId) + qty);

  (ingredients || []).forEach((ing) => {
    const slug = slugify(ing.item);
    const subItem = state.items.find((i) => i.id === slug);
    if (!subItem) return;
    const consumed = ing.qty * batches;
    setOwnedQty(slug, Math.max(0, getOwnedQty(slug) - consumed));
  });
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
  state.inventory = loadInventory();
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

  const clearInventoryBtn = document.getElementById('clear-inventory-btn');
  if (clearInventoryBtn) {
    let confirmingClear = false;
    clearInventoryBtn.addEventListener('click', () => {
      if (!confirmingClear) {
        confirmingClear = true;
        clearInventoryBtn.textContent = 'Sure? Click again to clear everything';
        clearInventoryBtn.classList.add('confirming');
        setTimeout(() => {
          confirmingClear = false;
          clearInventoryBtn.textContent = 'Clear all saved amounts';
          clearInventoryBtn.classList.remove('confirming');
        }, 3000);
        return;
      }
      state.inventory = {};
      saveInventory();
      render();
      // If something's currently open, refresh it too so it doesn't keep showing
      // stale "have" values until you navigate away and back.
      const openItemId = new URLSearchParams(window.location.search).get('item');
      if (openItemId) {
        if (isDesktopLayout()) renderDetailPanel(openItemId);
        else jumpTo(openItemId);
      }
    });
  }

  // Opening an ingredient link in a new tab lands here with ?item=<id> in the URL —
  // jump straight to that item so the new tab shows what was actually clicked. An
  // optional ?qty=<n> (e.g. from the Ship Planner's "Gather materials" link, which
  // knows how many of the part you actually want) pre-fills the quantity too, instead
  // of always landing on the default of 1.
  // push=false: the browser already created this history entry by navigating here,
  // so we don't want to push a second, identical one on top of it.
  const params = new URLSearchParams(window.location.search);
  const deepLinkId = params.get('item');
  const deepLinkQty = parseFloat(params.get('qty'));
  if (deepLinkId) goToItem(deepLinkId, false, deepLinkQty > 0 ? deepLinkQty : null);

  // Back/Forward: every in-page item jump pushes ?item=<id> onto the history stack,
  // so stepping back through it just re-reads the URL and re-opens whatever item was
  // showing at that point — search text, category filter, and your plan are untouched
  // since the page itself never reloads.
  window.addEventListener('popstate', () => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('item');
    const qty = parseFloat(params.get('qty'));
    if (id) {
      goToItem(id, false, qty > 0 ? qty : null);
    } else if (isDesktopLayout()) {
      closeDetailPanel();
    }
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

  const ctx = computeCraftContext(state.plan.filter((p) => idLookup.has(p.id)).map((p) => ({ id: p.id, qty: p.qty })));

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
    ${renderIntermediatesSection(ctx.intermediates, depthOf, idLookup, ctx.owned)}
    ${renderRawMaterialsSection(ctx.rawTotals, idLookup, ctx.owned, ctx.altRaw)}
  `;

  body.querySelectorAll('.plan-qty-input').forEach((input) => {
    input.addEventListener('change', () => setPlanQty(input.dataset.planItem, parseFloat(input.value)));
  });
  body.querySelectorAll('.plan-remove').forEach((btn) => {
    btn.addEventListener('click', () => removeFromPlan(btn.dataset.planItem));
  });
  body.querySelectorAll('.ing-name.linkable').forEach((link) => {
    link.addEventListener('click', (e) => {
      if (!isPlainLeftClick(e)) return;
      e.preventDefault();
      closePlanModal();
      goToItem(link.dataset.target);
    });
  });

  wireInlineHaveInputs(body, renderPlanModal);
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
        goToItem(itemEl.id.replace('item-', ''));
      }
    });
  });

  wireItemControls(list);
}

function isDesktopLayout() {
  return window.matchMedia('(min-width: 860px)').matches;
}

function closeDetailPanel() {
  const panel = document.getElementById('detail');
  if (panel) {
    panel.innerHTML = '<div class="detail-empty">Tap any item to see its full recipe and complete raw-materials breakdown here.</div>';
  }
}

// Navigating to an ingredient: on wide screens, update the persistent detail panel
// (the list never moves). On narrow screens, fall back to scrolling/expanding in place.
// `push` controls browser history: a real click adds a Back-able entry; restoring
// state from a popstate event or the initial page load should NOT push another one.
// `initialQty`, when given, pre-fills that item's quantity box instead of leaving it
// at the default of 1 — used by deep links that already know how many are wanted.
// Before leaving the current item (a real click, not a Back/Forward restore), stamp
// whatever quantity is currently showing onto ITS OWN history entry — not the one
// we're about to create. Otherwise hitting Back later lands back on this item with
// the quantity box reset to the default of 1, silently losing whatever number was
// actually there when you clicked away.
function snapshotCurrentQtyIntoHistory() {
  const currentParams = new URLSearchParams(window.location.search);
  const currentItemId = currentParams.get('item');
  if (!currentItemId) return;

  const qtyInput = isDesktopLayout()
    ? document.querySelector('#detail .qty-input')
    : (() => {
        const el = document.getElementById('item-' + currentItemId);
        return el && el.querySelector('.qty-input');
      })();
  if (!qtyInput) return;

  const qtyVal = getQty(qtyInput);
  currentParams.set('qty', qtyVal);
  history.replaceState({ item: currentItemId, qty: qtyVal }, '', '?' + currentParams.toString());
}

function goToItem(targetId, push = true, initialQty = null) {
  if (push) {
    snapshotCurrentQtyIntoHistory();
    const url = `?item=${encodeURIComponent(targetId)}`;
    history.pushState({ item: targetId }, '', url);
  }
  if (isDesktopLayout()) {
    renderDetailPanel(targetId, initialQty);
  } else {
    jumpTo(targetId, initialQty);
  }
}

// Wires up every interactive control (jump links, raw-materials toggle, qty input,
// manual/auto toggle) within a given root — used for both the main list and the
// detail panel so they behave identically wherever an item is rendered.
function wireItemControls(root) {
  root.querySelectorAll('.ing-name.linkable').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!isPlainLeftClick(e)) return;
      e.preventDefault();
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
      updateIngredientQuantities(wrap.closest('.body-inner'), getQty(qtyInput));
      if (!container.hidden) refresh();
    });

    const haveInput = wrap.querySelector('.have-input');
    if (haveInput) {
      haveInput.addEventListener('click', (e) => e.stopPropagation());
      haveInput.addEventListener('input', () => {
        setOwnedQty(id, parseFloat(haveInput.value) || 0);
        if (!container.hidden) refresh();
      });
    }

    const craftLogInput = wrap.querySelector('.craft-log-input');
    const craftLogBtn = wrap.querySelector('.craft-log-btn');
    if (craftLogInput && craftLogBtn) {
      craftLogInput.addEventListener('click', (e) => e.stopPropagation());
      craftLogInput.addEventListener('input', () => {
        const digitsOnly = craftLogInput.value.replace(/[^0-9]/g, '');
        if (digitsOnly !== craftLogInput.value) {
          const pos = craftLogInput.selectionStart - (craftLogInput.value.length - digitsOnly.length);
          craftLogInput.value = digitsOnly;
          craftLogInput.setSelectionRange(pos, pos);
        }
      });
      craftLogBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const craftedQty = parseFloat(craftLogInput.value) || 0;
        if (craftedQty <= 0) return;
        markCrafted(id, craftedQty);
        craftLogInput.value = '';
        if (haveInput) haveInput.value = getOwnedQty(id) || '';
        if (!container.hidden) refresh();
        const original = craftLogBtn.textContent;
        craftLogBtn.textContent = 'Added';
        craftLogBtn.classList.add('active');
        setTimeout(() => {
          craftLogBtn.textContent = original;
          craftLogBtn.classList.remove('active');
        }, 900);
      });
    }

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

// Scales the displayed per-craft ingredient/output amounts (the "STANDARD" recipe
// list, build costs, etc.) to match the quantity someone's actually trying to make —
// so "×5" becomes the real total for a run of 300 instead of leaving the user to do
// the multiplication themselves. Recipes that yield more than 1 per craft (e.g. 2
// Magnetic Coils per batch) need fewer actual crafts than the target quantity, so we
// divide by data-batch-size first — same math the full raw-materials trace already
// uses — otherwise this would overstate ingredients for anything with batch yield > 1.
function updateIngredientQuantities(root, qty) {
  if (!root) return;
  root.querySelectorAll('.ing-qty[data-base-qty]').forEach((el) => {
    const base = parseFloat(el.dataset.baseQty);
    if (!(base > 0)) return;
    const batchSize = parseFloat(el.dataset.batchSize) || 1;
    if (qty > 1) {
      const batches = qty / batchSize;
      const total = Math.ceil(base * batches - 1e-9);
      el.textContent = `×${total.toLocaleString()} (×${base} per craft)`;
    } else {
      el.textContent = `×${base}`;
    }
  });
}

function getMode(btn) {
  return (btn && btn.dataset.mode) || 'manual';
}

function getLocation(btn) {
  return (btn && btn.dataset.loc) || 'station';
}

// ---- Detail panel (persistent second column on wide screens) ----
function renderDetailPanel(itemId, initialQty) {
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

  panel.querySelector('.detail-close').addEventListener('click', closeDetailPanel);

  wireItemControls(panel);

  // auto-expand the raw breakdown immediately — the whole point of this panel
  const wrap = panel.querySelector('.raw-controls');
  if (wrap) {
    const container = wrap.querySelector('.raw-breakdown');
    const toggleBtn = wrap.querySelector('.raw-toggle');
    const qtyInput = wrap.querySelector('.qty-input');
    const qty = initialQty > 0 ? initialQty : 1;
    if (qtyInput && initialQty > 0) {
      qtyInput.value = initialQty;
      updateIngredientQuantities(panel.querySelector('.body-inner'), initialQty);
    }
    renderRawBreakdown(item.id, container, qty, 'manual', 'station');
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
    if (item.value != null) {
      bodyHtml += `<div class="price-line">${item.value.toFixed(2)} cr</div>`;
    }
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
        return `<li>${ingLinkTag(ing.item, slug, linkable)}<span class="ing-qty" data-base-qty="${ing.qty}">×${ing.qty}</span></li>`;
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
          return `<li>${ingLinkTag(ing.item, slug, linkable)}<span class="ing-qty" data-base-qty="${ing.qty}">×${ing.qty}</span></li>`;
        })
        .join('');

      bodyHtml += `<ul class="ingredients">${rows}</ul>`;
    }
  }

  const hasAnyIngredients = hasRecipes || (item.ingredients && item.ingredients.length);
  if (hasAnyIngredients && !isBuy && !isExtract) {
    const owned = getOwnedQty(item.id);
    bodyHtml += `
      <div class="raw-controls" data-item="${item.id}" data-dom="${domId}">
        <div class="raw-row">
          <button class="raw-toggle">Show full raw materials &#9662;</button>
          <input type="number" class="qty-input" id="qty-${domId}" min="1" step="1" value="1" aria-label="Quantity">
          ${hasRecipes ? `<button class="speed-toggle" id="speed-${domId}" data-mode="manual">Manual</button>` : ''}
          ${hasRecipes ? `<button class="speed-toggle" id="loc-${domId}" data-loc="station">Station</button>` : ''}
          <button class="plan-add-btn" data-item="${item.id}">+ Plan</button>
        </div>
        <div class="raw-row have-row">
          <label class="have-label" for="have-${domId}">You have</label>
          <input type="number" class="have-input" id="have-${domId}" min="0" step="1" value="${owned || ''}" placeholder="0" aria-label="Quantity already on hand">
          <span class="have-hint">already made — everything below adjusts for it</span>
        </div>
        <div class="raw-row craft-log-row">
          <label class="craft-log-label" for="crafted-${domId}">I just crafted</label>
          <input type="text" inputmode="numeric" pattern="[0-9]*" class="craft-log-input" id="crafted-${domId}" placeholder="0" aria-label="Quantity just crafted">
          <button class="craft-log-btn" data-item="${item.id}">Add to stock</button>
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
  } else if (item.gathering_note) {
    bodyHtml += `<p class="section-label">Contained in resources</p><p class="raw-note">${escapeHtml(item.gathering_note)}</p>`;
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

// Hand-mine sources (nodes and shells — both mined by hand, shells just need a mining
// weapon first to crack them open) are sorted most-likely-first. Deposits are a
// different mechanic entirely — a fixed, continuous-rate source you build an Extractor
// on — so they're always listed last, regardless of their rate.
function renderDeposits(deposits) {
  const handMined = deposits.filter((d) => d.type !== 'deposit').sort((a, b) => (b.chance || 0) - (a.chance || 0));
  const fixedDeposits = deposits.filter((d) => d.type === 'deposit');

  const rows = [...handMined, ...fixedDeposits]
    .map((d) => {
      const shellTag = d.type === 'shell' ? `<span class="station-chip station-chip-inline">Shell</span>` : '';
      const depositTag = d.type === 'deposit' ? `<span class="station-chip station-chip-inline">Deposit</span>` : '';
      let detail;
      if (d.type === 'deposit') {
        detail = escapeHtml(String(d.yield));
      } else {
        const chanceText = d.chance != null ? `${d.chance}% chance` : '';
        const yieldText = d.yield != null ? ` · ${escapeHtml(String(d.yield))} avg` : '';
        detail = chanceText + yieldText;
      }
      return `<li><span class="ing-name">${escapeHtml(d.resource)}</span><span class="ing-qty">${shellTag}${depositTag}${detail}</span></li>`;
    })
    .join('');
  return `<p class="section-label">Contained in resources</p><p class="raw-note">Hand-mined sources first, most likely to least likely — deposits (built with an Extractor) listed last.</p><ul class="ingredients deposits-list">${rows}</ul>`;
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
  const batchSize = recipe.output_qty || 1;
  const rows = (recipe.ingredients || [])
    .map((ing) => {
      const slug = slugify(ing.item);
      const linkable = idLookup.has(slug);
      return `<li>${ingLinkTag(ing.item, slug, linkable)}<span class="ing-qty" data-base-qty="${ing.qty}" data-batch-size="${batchSize}">×${ing.qty}</span></li>`;
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
        return `<li>${ingLinkTag(o.item, slug, linkable)}<span class="ing-qty" data-base-qty="${o.qty || 1}" data-batch-size="${batchSize}">×${o.qty || 1}</span></li>`;
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

// ---- Craft tree computation (inventory-aware, unified) ----
// Computes total demand for a set of "roots" — one root for a single-item breakdown,
// several for the combined Build Plan — cascading down through every sub-recipe to
// raw materials. Anything marked as already "on hand" (state.inventory) is subtracted
// from a node's total demand BEFORE that demand cascades further down: own 750 Nut
// and Bolts and the Iron Ingots (and everything else) that would have gone into
// crafting those 750 simply drop out of every total below it, at every level.
//
// This needs two passes because the same item can be needed by several different
// parents at once (Iron Ingot is needed directly by Motor's chain AND via Wire AND
// via Nut and Bolt) — inventory has to be subtracted once from the TOTAL combined
// demand, not separately from each fragment as it's discovered, or it'd either
// double-subtract or miss contributions that hadn't arrived yet.
//
// Pass 1 (discover): DFS from each root recording each node's recipe/ingredient
// edges (structure only — no quantities yet), appending every node to `postOrder`
// as its DFS call finishes. Reversing that list gives a valid topological order —
// every node appears after all of its own parents — which is exactly what pass 2
// needs to guarantee a node's full demand has arrived before it's finalized.
//
// Pass 2 (propagate): walk the topological order. For each node, subtract whatever's
// on hand from its now-fully-accumulated gross demand to get its net demand, record
// that net demand (raw leaf → rawTotals, expandable → intermediates + tax/station),
// then push net-demand-derived amounts on to each of its own ingredients' gross
// demand for the next nodes in line.
//
// Where an item has multiple recipe paths, the first listed one is used. Items with a
// flat `ingredients` list (no recipes array, e.g. placeable buildings) are treated as
// a single batch of 1, same as before.
function computeCraftContext(roots) {
  const ctx = newCraftCtx();
  const grossDemand = new Map(); // itemId -> accumulated gross demand across every parent
  const nodeInfo = new Map(); // itemId -> discovered node structure (see discover())
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
      // A cycle (e.g. Pyrite -> Sulfur -> Pyrite via the Crystallizer) gets treated as
      // a raw leaf here instead of recursing again, same guard as before.
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

  const topoOrder = postOrder.slice().reverse(); // parent-before-child order

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
      // Show it even at net 0 — the item is genuinely part of this chain, just fully
      // covered by what's on hand. Dropping the row would also drop its "have" input,
      // stranding whoever just typed a number into it with no way to adjust it back.
      ctx.rawTotals.set(info.item.name, (ctx.rawTotals.get(info.item.name) || 0) + net);
      return;
    }

    // A root's own demand is shown in the headline/plan list already, not repeated
    // in the "sub-crafts needed" list — but its tax and station still count normally.
    if (!rootIds.has(itemId)) {
      ctx.intermediates.set(info.item.name, (ctx.intermediates.get(info.item.name) || 0) + net);
    }
    if (net > 0 && info.item.station) ctx.stations.add(info.item.station);

    // Batches must be a whole number — you can't run a recipe "12.5 times." If a
    // recipe yields 20 per craft and 250 are needed, that's 12.5 batches on paper,
    // but you actually have to run a 13th batch in full to get enough. Rounding up
    // here (rather than leaving it fractional until final display) makes sure that
    // extra batch's own ingredient cost — the whole reason this bug existed — gets
    // counted everywhere downstream, not just quietly absorbed.
    const batches = Math.ceil(net / info.batchSize - 1e-9);

    // Whatever's STILL needed after both native and nugget-credit inventory is
    // applied — shown as "or gather ×N more Nugget instead" alongside the Ore total,
    // with its own editable "have" box (that's what altUsedQty/altPool feed).
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
      const valueHtml = s.confirmed ? `${s.cost.toFixed(2)} cr` : 'tax not confirmed yet';
      return `<li>${ingLinkTag(name, slug, linkable)}<span class="ing-qty">${valueHtml}</span></li>`;
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

function renderMaterialRows(map, sortFn, idLookup, withStation, ownedMap, altRawMap) {
  return Array.from(map.entries())
    .sort(sortFn)
    .map(([name, total]) => {
      const slug = slugify(name);
      const linkable = idLookup.has(slug);
      const displayQty = Math.ceil(total - 1e-9); // tiny epsilon guards against float noise like 6.0000000001
      const station = withStation && displayQty > 0 ? stationFor(name) : null;
      const stationTag = station ? `<span class="station-chip station-chip-inline">${escapeHtml(station)}</span>` : '';
      const owned = ownedMap ? ownedMap.get(name) : null;
      const coveredTag = displayQty === 0 ? `<span class="covered-tag">✓ covered</span>` : '';

      const alts = altRawMap ? altRawMap.get(name) : null;
      const altHtml = alts && alts.size
        ? Array.from(alts.entries())
            .map(([altName, info]) => {
              const altSlug = info.slug;
              const needMore = Math.ceil(info.needed - 1e-9);
              const usedText = info.used > 0 ? `using ${Math.ceil(info.used - 1e-9).toLocaleString()} already · ` : '';
              const needText = needMore > 0
                ? `${usedText}${needMore.toLocaleString()} more would cover the rest`
                : `${usedText}fully covers the rest`;
              return `
                <div class="alt-raw-note">
                  <span>or ${escapeHtml(altName)} instead — ${needText}</span>
                  <label class="row-have-wrap">have<input type="text" inputmode="numeric" pattern="[0-9]*" class="row-have-input" value="${getOwnedQty(altSlug) || ''}" placeholder="0" data-item="${altSlug}" aria-label="Quantity of ${escapeHtml(altName)} already on hand"></label>
                </div>
              `;
            })
            .join('')
        : '';

      return `
        <li class="material-row">
          <div class="material-row-main" data-item="${slug}">
            ${ingLinkTag(name, slug, linkable)}
            <span class="ing-qty">${coveredTag}${stationTag}${displayQty > 0 ? `×${displayQty.toLocaleString()}` : ''}</span>
            <label class="row-have-wrap">have<input type="text" inputmode="numeric" pattern="[0-9]*" class="row-have-input" value="${owned ? Math.ceil(owned - 1e-9) : ''}" placeholder="0" data-item="${slug}" aria-label="Quantity of ${escapeHtml(name)} already on hand"></label>
          </div>
          ${altHtml}
        </li>
      `;
    })
    .join('');
}

function renderIntermediatesSection(intermediates, depthOf, idLookup, ownedMap) {
  if (!intermediates.size) return '';
  const rows = renderMaterialRows(intermediates, (a, b) => depthOf(b[0]) - depthOf(a[0]) || b[1] - a[1], idLookup, true, ownedMap);
  return `<p class="section-label">Sub-crafts needed along the way</p><p class="raw-note">Ordered top to bottom: most complex first, basic ingots last — right above the raw materials below.</p><ul class="ingredients raw-list">${rows}</ul>`;
}

function renderRawMaterialsSection(rawTotals, idLookup, ownedMap, altRawMap) {
  const rows = renderMaterialRows(rawTotals, (a, b) => b[1] - a[1], idLookup, false, ownedMap, altRawMap);
  return `<p class="section-label">Base/raw materials</p><ul class="ingredients raw-list">${rows}</ul>`;
}

// Wires the inline "have" boxes that sit directly on each material row (as opposed
// to the one dedicated box on an item's own card, which sets ITS OWN quantity). Since
// editing one ripples through the whole computed list, `onChanged` re-renders
// everything — this just makes sure whichever box was being typed into keeps focus
// and cursor position across that re-render, or every keystroke would bump you out
// of the field.
function wireInlineHaveInputs(container, onChanged) {
  container.querySelectorAll('.row-have-input').forEach((input) => {
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('input', () => {
      // Plain text input (needed so the cursor behaves — see wireInlineHaveInputs
      // comment below) doesn't block non-digit characters the way type="number"
      // does, so strip anything that isn't a digit before using the value.
      const digitsOnly = input.value.replace(/[^0-9]/g, '');
      if (digitsOnly !== input.value) {
        const pos = input.selectionStart - (input.value.length - digitsOnly.length);
        input.value = digitsOnly;
        input.setSelectionRange(pos, pos);
      }
      setOwnedQty(input.dataset.item, parseFloat(digitsOnly) || 0);
      const focusItemId = input.dataset.item;
      const cursorPos = input.selectionStart;
      onChanged();
      const fresh = container.querySelector(`.row-have-input[data-item="${focusItemId}"]`);
      if (fresh) {
        fresh.focus();
        if (cursorPos != null) fresh.setSelectionRange(cursorPos, cursorPos);
      }
    });
  });
}

function renderRawBreakdown(itemId, container, qty, mode, location) {
  qty = qty || 1;
  mode = mode || 'manual';
  location = location || 'station';
  const ctx = computeCraftContext([{ id: itemId, qty }]);
  const idLookup = new Set(state.items.map((i) => i.id));
  const depthMemo = new Map();
  const depthOf = (name) => getCraftDepth(slugify(name), depthMemo, new Set());

  const topItem = state.items.find((i) => i.id === itemId);
  const topRecipe = topItem.recipes && topItem.recipes.length ? topItem.recipes[0] : null;

  // Owning some of the item itself counts too — if you've already got 20 Motors,
  // you only need to actually craft the remaining 280.
  const ownedRoot = getOwnedQty(itemId);
  const netQty = Math.max(0, qty - ownedRoot);
  const ownedNote = ownedRoot > 0
    ? `<p class="owned-note">You have ${ownedRoot.toLocaleString()} already — showing what's needed for the remaining ${netQty.toLocaleString()}.</p>`
    : '';

  let timeLine = '';
  if (topRecipe && topRecipe.craft_time_sec != null && netQty > 0) {
    const batchSize = topRecipe.output_qty || 1;
    const batchesNeeded = Math.ceil(netQty / batchSize);
    const usingAuto = mode === 'auto' && topRecipe.auto_craft_time_sec != null;
    const fellBack = mode === 'auto' && topRecipe.auto_craft_time_sec == null;
    const perCraft = usingAuto ? topRecipe.auto_craft_time_sec : topRecipe.craft_time_sec;
    const modeLabel = usingAuto ? 'auto machine' : 'manual craft';
    const fallbackNote = fellBack ? ' — auto time not confirmed yet for this one, showing manual instead' : '';
    timeLine = `<p class="time-line">&#9201; ~${formatDuration(batchesNeeded * perCraft)} to craft ×${netQty.toLocaleString()} (${batchesNeeded} batch${batchesNeeded === 1 ? '' : 'es'} of ${perCraft}s each, ${modeLabel}, one machine running back-to-back)${fallbackNote}</p>`;
  }

  const stationsLine = renderStationsLine(ctx.stations);
  const taxBlock = topRecipe ? renderTaxSection(ctx.taxSteps, location, `×${netQty.toLocaleString()}`, depthOf, idLookup) : '';
  const intermediateSection = renderIntermediatesSection(ctx.intermediates, depthOf, idLookup, ctx.owned);

  // Only worth showing if something in this chain actually has an amount set —
  // no point offering to clear a list of already-empty boxes.
  const resetIds = new Set(Array.from(ctx.intermediates.keys()).concat(Array.from(ctx.rawTotals.keys())).map(slugify));
  const hasAnythingToReset = Array.from(resetIds).some((id) => getOwnedQty(id) > 0);
  const isArmed = resetArmedItemId === itemId;
  const resetBtnHtml = hasAnythingToReset
    ? `<button class="reset-amounts-btn${isArmed ? ' confirming' : ''}">${isArmed ? 'Sure? Click again to reset' : 'Reset amounts used for this \u21bb'}</button>`
    : '';

  container.innerHTML = `
    ${ownedNote}
    ${timeLine}
    ${stationsLine}
    ${taxBlock}
    <p class="raw-note">Everything needed for ×${qty.toLocaleString()}, tracing each sub-recipe down to its base materials (using the first recipe option at each step where there's more than one):</p>
    ${intermediateSection}
    ${renderRawMaterialsSection(ctx.rawTotals, idLookup, ctx.owned, ctx.altRaw)}
    ${resetBtnHtml}
  `;

  container.querySelectorAll('.ing-name.linkable').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!isPlainLeftClick(e)) return;
      e.preventDefault();
      goToItem(link.dataset.target);
    });
  });

  const resetBtn = container.querySelector('.reset-amounts-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (resetArmedItemId !== itemId) {
        resetArmedItemId = itemId;
        clearTimeout(resetArmedTimeoutId);
        resetBtn.textContent = 'Sure? Click again to reset';
        resetBtn.classList.add('confirming');
        resetArmedTimeoutId = setTimeout(() => {
          resetArmedItemId = null;
          // Patch whichever button element currently exists (an unrelated edit may
          // have redrawn it since this timer started) rather than forcing a refresh.
          const stillThere = container.querySelector('.reset-amounts-btn');
          if (stillThere) {
            stillThere.textContent = 'Reset amounts used for this \u21bb';
            stillThere.classList.remove('confirming');
          }
        }, 3000);
        return;
      }
      // This item's own "have" box (on its own card) is untouched — this only clears
      // the ingredients/intermediates that fed into it, since those are what's
      // actually "used up" once a whole run like this is finished.
      resetArmedItemId = null;
      clearTimeout(resetArmedTimeoutId);
      const freshCtx = computeCraftContext([{ id: itemId, qty }]);
      const ids = new Set(Array.from(freshCtx.intermediates.keys()).concat(Array.from(freshCtx.rawTotals.keys())).map(slugify));
      ids.forEach((id) => setOwnedQty(id, 0));
      renderRawBreakdown(itemId, container, qty, mode, location);
    });
  }

  wireInlineHaveInputs(container, () => renderRawBreakdown(itemId, container, qty, mode, location));
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

function jumpTo(id, initialQty) {
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
    if (initialQty > 0) {
      const qtyInput = el.querySelector('.qty-input');
      if (qtyInput) {
        qtyInput.value = initialQty;
        updateIngredientQuantities(el.querySelector('.body-inner'), initialQty);
      }
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

// ---- Utilities ----
function slugify(name) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// Renders an ingredient/output name as a real link when it points at a known item.
// Using a genuine <a href> (rather than a plain span) means ctrl/cmd-click,
// middle-click, and "open in new tab" from the right-click menu all work natively —
// the click handler only intercepts a plain left-click to do the in-page jump instead.
// True for a plain left-click with no modifier keys — the case we intercept to do
// the in-page jump instead of a real navigation. Ctrl/cmd-click, shift-click, and
// middle-click all fall through untouched so the browser opens the link in a new tab.
function isPlainLeftClick(e) {
  return e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;
}

function ingLinkTag(displayName, slug, linkable) {
  const safeName = escapeHtml(displayName);
  if (!linkable) return `<span class="ing-name">${safeName}</span>`;
  return `<a class="ing-name linkable" href="?item=${encodeURIComponent(slug)}" data-target="${slug}">${safeName}</a>`;
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
