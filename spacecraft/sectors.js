// ---- State ----
const state = {
  sectors: [],
  items: [], // full recipes.json, for linking back to the crafting calculator
};

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

async function init() {
  try {
    const [sectorsRes, itemsRes] = await Promise.all([
      fetch('data/sectors.json?v=1'),
      fetch('data/recipes.json?v=4'),
    ]);
    if (!sectorsRes.ok) throw new Error(`data/sectors.json failed to load (HTTP ${sectorsRes.status}) — check it was uploaded to the data/ folder.`);
    if (!itemsRes.ok) throw new Error(`data/recipes.json failed to load (HTTP ${itemsRes.status}).`);
    state.sectors = await sectorsRes.json();
    state.items = await itemsRes.json();
  } catch (err) {
    document.getElementById('sector-content').innerHTML = `<p class="raw-note" style="color:var(--gold);">Couldn't load sector data: ${escapeHtml(err.message)}</p>`;
    return;
  }

  const searchInput = document.getElementById('resource-search');
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim();
    if (!q) {
      renderSectorDirectory();
      return;
    }
    renderSearchResults(q);
  });

  const params = new URLSearchParams(window.location.search);
  const deepLinkResource = params.get('resource');
  if (deepLinkResource) {
    const item = state.items.find((i) => i.id === deepLinkResource);
    const displayName = item ? item.name : deepLinkResource;
    searchInput.value = displayName;
    renderResourceDetail(displayName);
  } else {
    renderSectorDirectory();
  }
}

// Builds a lookup: resource name -> [{sector, tier, station, rarity}]
function findResourceOccurrences(name) {
  const out = [];
  state.sectors.forEach((s) => {
    const match = s.resources.find((r) => r.name.toLowerCase() === name.toLowerCase());
    if (match) {
      out.push({ sector: s.name, tier: s.tier, station: s.station, rarity: match.rarity, source: s.source });
    }
  });
  return out;
}

function rarityTag(rarity) {
  if (!rarity) return `<span class="auto-tag auto-unknown" title="Random yield — no fixed spawn weight">Random yield</span>`;
  const cls = rarity === 'Common' ? 'auto-yes' : rarity === 'Rare' ? 'auto-no' : 'auto-unknown';
  return `<span class="auto-tag ${cls}">${escapeHtml(rarity)}</span>`;
}

function renderSearchResults(query) {
  const container = document.getElementById('sector-content');
  const q = query.toLowerCase();

  // Every distinct resource name across all sectors, for matching against the search box.
  const allNames = new Set();
  state.sectors.forEach((s) => s.resources.forEach((r) => allNames.add(r.name)));
  const matches = Array.from(allNames).filter((n) => n.toLowerCase().includes(q)).sort();

  if (!matches.length) {
    container.innerHTML = `<p class="raw-note">No resource matching "${escapeHtml(query)}" found in any sector.</p>`;
    return;
  }

  if (matches.length === 1) {
    renderResourceDetail(matches[0]);
    return;
  }

  container.innerHTML = `
    <p class="section-label">${matches.length} matching resources</p>
    <ul class="automate-suggestions">
      ${matches.map((n) => `<li><button class="automate-suggestion-btn" data-name="${escapeHtml(n)}">${escapeHtml(n)}</button></li>`).join('')}
    </ul>
  `;
  container.querySelectorAll('.automate-suggestion-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.getElementById('resource-search').value = btn.dataset.name;
      renderResourceDetail(btn.dataset.name);
    });
  });
}

function renderResourceDetail(name) {
  const container = document.getElementById('sector-content');
  const occurrences = findResourceOccurrences(name);

  if (!occurrences.length) {
    container.innerHTML = `<p class="raw-note">No sector data found for "${escapeHtml(name)}" yet.</p>`;
    return;
  }

  const item = state.items.find((i) => i.name.toLowerCase() === name.toLowerCase());
  const linkBack = item
    ? `<a class="ing-name linkable" href="index.html?item=${encodeURIComponent(item.id)}">View ${escapeHtml(name)} in the Crafting Calculator →</a>`
    : '';

  const rows = occurrences
    .sort((a, b) => (a.tier || 0) - (b.tier || 0))
    .map((o) => {
      const stationTag = o.station ? `<span class="station-chip station-chip-inline">${escapeHtml(o.station)}</span>` : '';
      const sourceTag = o.source ? `<span class="auto-tag auto-unknown">${escapeHtml(o.source)}</span>` : '';
      return `<li><span class="ing-name">${escapeHtml(o.sector)} <span style="color:var(--text-dim); font-weight:normal;">(Tier ${o.tier})</span></span><span class="ing-qty">${sourceTag}${stationTag}${rarityTag(o.rarity)}</span></li>`;
    })
    .join('');

  container.innerHTML = `
    <p class="section-label">${escapeHtml(name)} — found in ${occurrences.length} sector${occurrences.length === 1 ? '' : 's'}</p>
    ${linkBack ? `<p class="raw-note">${linkBack}</p>` : ''}
    <ul class="ingredients raw-list">${rows}</ul>
    <button class="raw-toggle" id="back-to-directory" style="margin-top:16px;">&larr; Back to all sectors</button>
  `;
  const backBtn = document.getElementById('back-to-directory');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      document.getElementById('resource-search').value = '';
      renderSectorDirectory();
    });
  }
}

function renderSectorDirectory() {
  const container = document.getElementById('sector-content');
  const bySectorOrder = state.sectors; // keep the order collected in, roughly tier order already

  container.innerHTML = `
    <p class="section-label">All sectors</p>
    <p class="raw-note">Search a resource above, or click a sector below to see everything it has.</p>
    <div id="sector-cards"></div>
  `;

  const cardsEl = document.getElementById('sector-cards');
  cardsEl.innerHTML = bySectorOrder
    .map((s) => {
      const stationTag = s.station ? `<span class="station-chip station-chip-inline">${escapeHtml(s.station)}</span>` : '';
      const obstacleNote = s.resources.length === 0 ? `<span class="auto-tag auto-no">Obstacle — no resources</span>` : '';
      return `
        <div class="item part-card sector-card" data-sector="${escapeHtml(s.name)}">
          <div class="item-head part-head">
            <div>
              <span class="badge">Tier ${s.tier}</span>
              <strong>${escapeHtml(s.name)} Sector</strong>
              ${obstacleNote}
            </div>
            <div class="part-head-right">
              ${stationTag}
              <span class="ing-qty">${s.resources.length} resources</span>
            </div>
          </div>
        </div>
      `;
    })
    .join('');

  cardsEl.querySelectorAll('.sector-card').forEach((card) => {
    card.addEventListener('click', () => renderSectorFull(card.dataset.sector));
  });
}

function renderSectorFull(sectorName) {
  const container = document.getElementById('sector-content');
  const sector = state.sectors.find((s) => s.name === sectorName);
  if (!sector) return;

  if (!sector.resources.length) {
    container.innerHTML = `
      <p class="section-label">${escapeHtml(sector.name)} Sector — Tier ${sector.tier}</p>
      <p class="raw-note">Obstacle sector — no mappable resources.</p>
      <button class="raw-toggle" id="back-to-directory" style="margin-top:16px;">&larr; Back to all sectors</button>
    `;
  } else {
    const stationLine = sector.station ? `<p class="raw-note">Station: <strong>${escapeHtml(sector.station)}</strong></p>` : '';
    const rows = sector.resources
      .slice()
      .sort((a, b) => {
        const order = { Common: 0, Uncommon: 1, Rare: 2 };
        const ao = a.rarity != null ? order[a.rarity] : 3;
        const bo = b.rarity != null ? order[b.rarity] : 3;
        return ao - bo || a.name.localeCompare(b.name);
      })
      .map((r) => {
        const item = state.items.find((i) => i.name.toLowerCase() === r.name.toLowerCase());
        const nameHtml = item
          ? `<a class="ing-name linkable" href="index.html?item=${encodeURIComponent(item.id)}">${escapeHtml(r.name)}</a>`
          : `<span class="ing-name">${escapeHtml(r.name)}</span>`;
        return `<li>${nameHtml}<span class="ing-qty">${rarityTag(r.rarity)}</span></li>`;
      })
      .join('');
    container.innerHTML = `
      <p class="section-label">${escapeHtml(sector.name)} Sector — Tier ${sector.tier}</p>
      ${stationLine}
      <ul class="ingredients raw-list">${rows}</ul>
      <button class="raw-toggle" id="back-to-directory" style="margin-top:16px;">&larr; Back to all sectors</button>
    `;
  }

  const backBtn = document.getElementById('back-to-directory');
  if (backBtn) backBtn.addEventListener('click', renderSectorDirectory);
}

init();
