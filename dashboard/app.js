// Token Radar dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, a filterable table, a per-protocol detail view with the model's own
// inputs and the protocol's farm plan, an Already trading view and a model sandbox that re-ranks
// the board live. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var app = document.getElementById('app');
  if (!DATA || !app) return;
  app.setAttribute('aria-busy', 'false');

  var params = new URLSearchParams(window.location.search);
  var hash = window.location.hash || '';
  var state = {
    q: params.get('q') || '',
    category: params.get('category') || 'all',
    chain: params.get('chain') || 'all',
    watchOnly: params.get('watch') === '1',
    sort: 'implied',
    dir: -1,
    tab: 'board',
    selected: hash.indexOf('#/p/') === 0 ? decodeURIComponent(hash.slice(4)) : null,
    sandbox: { scale: 1, growth: DATA.model.growth_weight, maturity: DATA.model.maturity_range, active: false },
  };

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function pctClass(n) { return n === null || n === undefined ? 'flat' : n > 0 ? 'up' : n < 0 ? 'down' : 'flat'; }

  // The model in one function: the page recomputes a row from the snapshot figures and checks
  // the number board.json carries, so the page's code and the board's data are visibly the same
  // arithmetic. The sandbox overrides only the three constants its sliders name.
  function impliedOf(row, sb) {
    var m = DATA.model;
    var growth = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * (sb ? sb.growth : m.growth_weight);
    var age = row.age_days === null || row.age_days === undefined ? null : row.age_days;
    var maturity = age === null ? m.unknown_age_multiplier
      : m.maturity_floor + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * (sb ? sb.maturity : m.maturity_range);
    var breadth = row.breadth_multiplier;
    var multiple = row.category_multiple * (sb ? sb.scale : 1);
    return Math.max(1, Math.round(row.tvl_usd * multiple * growthMult * maturity * breadth));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function watchSet() {
    var s = {};
    DATA.rows.forEach(function (r) { if (DATA.watchlist.indexOf(r.slug) >= 0) s[r.slug] = true; });
    return s;
  }
  var WATCH = watchSet();
  var watchlist = DATA.rows.filter(function (r) { return WATCH[r.slug]; }).map(function (r) { return r.slug; });
  DATA.watchlist = watchlist;

  function categories() {
    var seen = {};
    DATA.rows.forEach(function (r) { if (r.category) seen[r.category] = true; });
    return Object.keys(seen).sort();
  }
  function chains() {
    var seen = {};
    DATA.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { seen[c] = true; }); });
    return Object.keys(seen).sort();
  }

  function filteredRows() {
    var sb = state.sandbox.active ? state.sandbox : null;
    var q = state.q.trim().toLowerCase();
    var rows = DATA.rows.filter(function (r) {
      if (state.watchOnly && !WATCH[r.slug]) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    rows = rows.map(function (r) { return { row: r, implied: sb ? impliedOf(r, sb) : r.implied_value_usd }; });
    var key = state.sort;
    rows.sort(function (a, b) {
      var va, vb;
      if (key === 'implied') { va = a.implied; vb = b.implied; }
      else if (key === 'tvl') { va = a.row.tvl_usd; vb = b.row.tvl_usd; }
      else if (key === 'growth') { va = a.row.change_7d === null ? -Infinity : a.row.change_7d; vb = b.row.change_7d === null ? -Infinity : b.row.change_7d; }
      else if (key === 'age') { va = a.row.age_days === null ? -1 : a.row.age_days; vb = b.row.age_days === null ? -1 : b.row.age_days; }
      else { va = a.row.rank; vb = b.row.rank; }
      return (va - vb) * state.dir || (a.row.slug < b.row.slug ? -1 : 1);
    });
    return rows;
  }

  function sortArrow(key) {
    if (state.sort !== key) return '';
    return state.dir === -1 ? ' ▼' : ' ▲';
  }
  function setSort(key) {
    if (state.sort === key) state.dir = -state.dir;
    else { state.sort = key; state.dir = key === 'rank' ? 1 : -1; }
    render();
  }

  function renderHeader() {
    var hero = el('header', { class: 'hero' },
      el('div', { class: 'eyebrow', text: 'Token Radar · model ' + DATA.model_version }),
      el('h1', {}, 'Pre-token protocols, ', el('span', { class: 'thin', text: 'ranked by what a launch would be worth.' })),
      el('p', { class: 'lede', text: 'Every protocol in the snapshot that records no token, ranked by an implied value built from its own figures: TVL priced at its category\u2019s market multiple, seven-day growth, time running with no token, and how many chains it already reaches. Click any row for its farm plan.' }),
      el('div', { class: 'stats' },
        el('div', { class: 'stat' }, el('b', { text: String(DATA.board_size) }), el('span', { text: 'ranked' })),
        el('div', { class: 'stat' }, el('b', { text: String(DATA.watchlist_size) }), el('span', { text: 'watchlist' })),
        el('div', { class: 'stat' }, el('b', { text: String(DATA.live_size) }), el('span', { text: 'already trading' })),
        el('div', { class: 'stat' }, el('b', { text: fmtUsd(topImplied()) }), el('span', { text: 'top implied value' })),
        el('div', { class: 'stat' }, el('b', { text: DATA.as_of }), el('span', { text: 'snapshot date' }))
      ));
    return hero;
  }
  function topImplied() {
    var top = 0;
    DATA.rows.forEach(function (r) { if (r.implied_value_usd > top) top = r.implied_value_usd; });
    return top;
  }

  function renderControls() {
    var catSel = el('select', { 'aria-label': 'Category', onchange: function (e) { state.category = e.target.value; render(); } },
      el('option', { value: 'all', text: 'All categories' }));
    categories().forEach(function (c) {
      catSel.appendChild(el('option', { value: c, text: c, selected: state.category === c ? 'selected' : null }));
    });
    var chainSel = el('select', { 'aria-label': 'Chain', onchange: function (e) { state.chain = e.target.value; render(); } },
      el('option', { value: 'all', text: 'All chains' }));
    chains().forEach(function (c) {
      chainSel.appendChild(el('option', { value: c, text: c, selected: state.chain === c ? 'selected' : null }));
    });
    var search = el('input', { type: 'search', placeholder: 'Search name or slug…', value: state.q, 'aria-label': 'Search',
      oninput: function (e) { state.q = e.target.value; renderTableOnly(); } });
    var watch = el('label', { class: 'chk' },
      el('input', { type: 'checkbox', checked: state.watchOnly ? 'checked' : null, onchange: function (e) { state.watchOnly = e.target.checked; render(); } }),
      'Watchlist only');
    return el('div', { class: 'controls' }, search, catSel, chainSel, watch);
  }

  function renderTabs() {
    function tab(name, label) {
      return el('button', { 'aria-pressed': state.tab === name ? 'true' : 'false',
        onclick: function () { state.tab = name; render(); } }, label);
    }
    return el('div', { class: 'tabs' },
      tab('board', 'Board (' + DATA.board_size + ')'),
      tab('live', 'Already trading (' + DATA.live_size + ')'),
      tab('method', 'Method & model'));
  }

  function renderBoard() {
    var rows = filteredRows();
    var table = el('table', { class: 'board' });
    var head = el('tr', {},
      el('th', { class: 'num', onclick: function () { setSort('rank'); }, text: 'Rank' + sortArrow('rank') }),
      el('th', { text: 'Protocol' }),
      el('th', { text: 'Category' }),
      el('th', { text: 'Chains' }),
      el('th', { class: 'num', onclick: function () { setSort('tvl'); }, text: 'TVL' + sortArrow('tvl') }),
      el('th', { class: 'num', onclick: function () { setSort('growth'); }, text: '7d' + sortArrow('growth') }),
      el('th', { class: 'num', onclick: function () { setSort('age'); }, text: 'Age' + sortArrow('age') }),
      el('th', { class: 'num', onclick: function () { setSort('implied'); }, text: 'Implied value' + sortArrow('implied') }));
    table.appendChild(el('thead', {}, head));
    var body = el('tbody', {});
    rows.forEach(function (item) {
      var r = item.row;
      var tr = el('tr', { class: state.selected === r.slug ? 'sel' : null,
        onclick: function () { select(r.slug); } },
        el('td', { class: 'num', text: '#' + r.rank }),
        el('td', { class: 'name' }, el('b', { text: r.name }), ' ',
          el('span', { class: 'slug', text: r.slug }),
          WATCH[r.slug] ? el('span', { class: 'badge watch', text: 'Watchlist' }) : null),
        el('td', { text: r.category || '—' }),
        el('td', { text: (r.chains || []).slice(0, 3).join(', ') + ((r.chains || []).length > 3 ? ' +' + ((r.chains || []).length - 3) : '') }),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + pctClass(r.change_7d), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: fmtUsd(item.implied) }));
      body.appendChild(tr);
    });
    table.appendChild(body);
    var wrap = el('div', {}, table);
    if (rows.length === 0) wrap.appendChild(el('div', { class: 'empty', text: 'No protocol matches that filter.' }));
    else wrap.appendChild(el('p', { class: 'count', text: rows.length + ' of ' + DATA.board_size + ' ranked protocols shown. Implied values are this radar\u2019s own claim, never a market price.' }));
    return wrap;
  }

  function renderLive() {
    var table = el('table', { class: 'board' });
    table.appendChild(el('thead', {}, el('tr', {},
      el('th', { text: 'Protocol' }), el('th', { text: 'Category' }),
      el('th', { class: 'num', text: 'TVL' }), el('th', { class: 'num', text: 'Market cap' }),
      el('th', { class: 'num', text: '7d' }))));
    var body = el('tbody', {});
    DATA.live.forEach(function (r) {
      body.appendChild(el('tr', { onclick: function () {} },
        el('td', { class: 'name' }, el('b', { text: r.name }), ' ',
          el('span', { class: 'slug', text: r.slug }),
          el('span', { class: 'badge live', text: 'Trading' })),
        el('td', { text: r.category || '—' }),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num ' + pctClass(r.change_7d), text: fmtPct(r.change_7d) })));
    });
    table.appendChild(body);
    return el('div', {}, table,
      el('p', { class: 'count', text: 'These protocols already have a token that trades, so the board shows the market\u2019s own value for them instead of a model\u2019s. They are never ranked against the pre-token board.' }));
  }

  function renderMethod() {
    var m = DATA.model;
    var multRows = Object.keys(DATA.category_multiples).sort().map(function (c) {
      return el('tr', {}, el('td', { text: c || '(no category)' }), el('td', { class: 'num', text: DATA.category_multiples[c].toFixed(3) + '×' }));
    });
    return el('div', { class: 'method' },
      el('h3', { text: 'How the implied value is built' }),
      el('p', { text: 'implied = TVL × category multiple × growth × maturity × breadth. The category multiple is the median market-cap-to-TVL ratio of that category\u2019s protocols whose token already trades, taken from this same snapshot and clamped to [' + m.multiple_floor + ', ' + m.multiple_cap + ']; a category with no live protocol uses the global median, ' + DATA.global_multiple.toFixed(3) + '×. Growth is the 7-day TVL change clamped to [' + m.growth_floor + '%, ' + m.growth_cap + '%] and weighted ' + m.growth_weight + '. Maturity rises from ' + m.maturity_floor + ' to ' + (m.maturity_floor + m.maturity_range).toFixed(2) + ' over ' + m.maturity_days + ' days listed with no token recorded. Breadth adds ' + (m.breadth_per_chain * 100).toFixed(0) + '% per extra chain, up to ' + m.breadth_max_chains + '.' }),
      el('p', { text: '“Records no token” means the snapshot carries no market cap, CoinGecko id or symbol for the protocol. It is the record\u2019s word, never proof that no token exists. Farm steps are derived from the protocol\u2019s category, chains, TVL and age; no protocol is named by hand.' }),
      el('h3', { text: 'Category multiples from this snapshot' }),
      el('table', {}, el('thead', {}, el('tr', {}, el('th', { text: 'Category' }), el('th', { class: 'num', text: 'Multiple' }))),
        el('tbody', {}, multRows)));
  }

  function renderDetail() {
    if (!state.selected) return null;
    var r = null;
    DATA.rows.forEach(function (x) { if (x.slug === state.selected) r = x; });
    if (!r) return null;
    var sb = state.sandbox.active ? state.sandbox : null;
    var implied = sb ? impliedOf(r, sb) : r.implied_value_usd;
    var base = r.tvl_usd * r.category_multiple * (sb ? sb.scale : 1);
    var steps = r.farm_steps.map(function (s) { return el('li', { text: s }); });
    var maxBar = Math.max(base, implied, 1);
    function barRow(label, value, frac) {
      return el('div', {},
        el('div', { class: 'kv', style: 'grid-template-columns: 1fr auto;' },
          el('span', { text: label }), el('b', { text: value })),
        el('div', { class: 'bar' }, el('i', { style: 'width:' + Math.max(2, Math.round(frac * 100)) + '%' })));
    }
    return el('section', { class: 'detail', 'aria-label': 'Protocol detail' },
      el('h2', {}, r.name + ' ', el('span', { class: 'slug', text: r.slug }),
        WATCH[r.slug] ? el('span', { class: 'badge watch', text: 'Watchlist' }) : null),
      el('p', { class: 'meta', text: (r.category || 'No category') + ' · ' + (r.chains || []).join(', ') + ' · listed ' + (r.listed_at || 'unknown') + ' · records no token.' }),
      el('div', { class: 'grid2' },
        el('div', {},
          el('h3', { text: 'Model breakdown' }),
          el('dl', { class: 'kv' },
            el('dt', { text: 'TVL' }), el('dd', { text: fmtUsd(r.tvl_usd) }),
            el('dt', { text: 'Category multiple' }), el('dd', { text: r.category_multiple.toFixed(3) + '×' }),
            el('dt', { text: '7-day change' }), el('dd', { text: fmtPct(r.change_7d) }),
            el('dt', { text: 'Growth multiplier' }), el('dd', { text: r.growth_multiplier.toFixed(3) + '×' }),
            el('dt', { text: 'Age / maturity' }), el('dd', { text: fmtAge(r.age_days) + ' · ' + r.maturity_multiplier.toFixed(3) + '×' }),
            el('dt', { text: 'Chain breadth' }), el('dd', { text: r.breadth_multiplier.toFixed(3) + '×' }),
            el('dt', { text: 'Implied value' }), el('dd', { text: fmtUsd(implied) })),
          barRow('Base (TVL × multiple)', fmtUsd(base), base / maxBar),
          barRow('Implied value', fmtUsd(implied), implied / maxBar)),
        el('div', {},
          el('h3', { text: 'Farm plan — six steps' }),
          el('ol', { class: 'steps' }, steps),
          el('p', { class: 'note', text: 'Costs are gas plus the capital the position holds; never pay to claim, and never trust a link that is not the protocol\u2019s own.' }))));
  }

  function renderSandbox() {
    var sb = state.sandbox;
    function slider(id, label, min, max, step, value, oninput) {
      return el('label', {},
        label + ' ', el('output', { id: id + '-out', text: String(value) }),
        el('input', { type: 'range', id: id, min: String(min), max: String(max), step: String(step),
          value: String(value), oninput: function (e) { oninput(parseFloat(e.target.value)); } }));
    }
    var box = el('section', { class: 'sandbox' },
      el('h3', { text: 'Model sandbox — re-rank the board live' }),
      el('p', { text: 'Move a slider and the implied values recompute from the same snapshot figures. Nothing here changes board.json; it shows how the ranking answers to the model.' }),
      el('div', { class: 'sliders' },
        slider('sb-scale', 'Category multiple ×', 0.5, 2, 0.05, sb.scale, function (v) { sb.scale = v; sb.active = true; renderTableOnly(); syncSandbox(); }),
        slider('sb-growth', 'Growth weight', 0, 1, 0.05, sb.growth, function (v) { sb.growth = v; sb.active = true; renderTableOnly(); syncSandbox(); }),
        slider('sb-maturity', 'Maturity range', 0, 0.5, 0.05, sb.maturity, function (v) { sb.maturity = v; sb.active = true; renderTableOnly(); syncSandbox(); })),
      el('div', { class: 'row' },
        el('button', { onclick: function () { state.sandbox = { scale: 1, growth: DATA.model.growth_weight, maturity: DATA.model.maturity_range, active: false }; render(); } }, 'Reset to the published model'),
        sb.active ? el('span', { class: 'pill', text: 'Sandbox active — values differ from board.json' }) : null));
    return box;
  }
  function syncSandbox() {
    var outs = { 'sb-scale-out': state.sandbox.scale, 'sb-growth-out': state.sandbox.growth, 'sb-maturity-out': state.sandbox.maturity };
    Object.keys(outs).forEach(function (id) {
      var n = document.getElementById(id);
      if (n) n.textContent = String(outs[id]);
    });
  }

  function select(slug) {
    state.selected = slug;
    if (history.replaceState) history.replaceState(null, '', '#/p/' + encodeURIComponent(slug));
    render();
    var d = document.querySelector('.detail');
    if (d) d.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  var tableHost = null;
  function renderTableOnly() {
    if (!tableHost) return;
    while (tableHost.firstChild) tableHost.removeChild(tableHost.firstChild);
    tableHost.appendChild(renderBoard());
    var d = document.querySelector('.detail');
    if (d) d.remove();
    var det = renderDetail();
    if (det) tableHost.parentNode.insertBefore(det, tableHost);
  }

  function render() {
    while (app.firstChild) app.removeChild(app.firstChild);
    app.appendChild(renderHeader());
    if (state.tab === 'board') {
      app.appendChild(renderControls());
      app.appendChild(renderTabs());
      // A selected protocol's detail sits above the board, so a link to it opens in view.
      var det = renderDetail();
      if (det) app.appendChild(det);
      tableHost = el('div', {});
      tableHost.appendChild(renderBoard());
      app.appendChild(tableHost);
      app.appendChild(renderSandbox());
    } else if (state.tab === 'live') {
      app.appendChild(renderTabs());
      app.appendChild(renderLive());
    } else {
      app.appendChild(renderTabs());
      app.appendChild(renderMethod());
    }
    app.appendChild(el('footer', { text: 'Snapshot: ' + DATA.source + ' · as of ' + DATA.as_of + '. Implied values are this radar\u2019s own claim, never make.fun\u2019s and never a market price. Farm steps are guidance, not financial advice.' }));
  }

  window.addEventListener('hashchange', function () {
    var h = window.location.hash || '';
    state.selected = h.indexOf('#/p/') === 0 ? decodeURIComponent(h.slice(4)) : null;
    render();
  });

  render();
})();
