// ============================================================
// admin-activity.js — "User Activity" dashboard (admin only)
// Add near the end of index.html:  <script src="admin-activity.js"></script>
// Needs the Worker route GET /admin/user-activity.
// ============================================================
(function () {
  const API = (typeof WORKER_URL !== 'undefined') ? WORKER_URL : 'https://patient-base-c952.javalutionization.workers.dev';
  const KEY_SESSION = 'historyBowlAdminKey_v1';

  let DATA = null;          // { generatedAt, users:[...], daily:[[user,date,src,att,cor], ...] }
  let ROWS = [];            // per-user summaries
  let chart = null;
  const view = { period: 'week', sortKey: 'last', sortDir: -1, search: '', user: null };

  /* ── helpers ───────────────────────────────────────────── */
  const esc = (s) => String(s ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
  const dayStr = (d) => d.toISOString().slice(0, 10);
  const daysAgo = (n) => dayStr(new Date(Date.now() - n * 86400000));
  const pct = (c, a) => (a ? Math.round((100 * c) / a) + '%' : '—');
  const num = (n) => Number(n || 0).toLocaleString();
  const weekStart = (ds) => {
    const d = new Date(ds + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // Monday
    return dayStr(d);
  };
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmtLabel = (l) => {
    if (l.length === 7) return `${MONTHS[Number(l.slice(5, 7)) - 1]} ${l.slice(2, 4)}`;
    return `${Number(l.slice(5, 7))}/${Number(l.slice(8, 10))}`;
  };

  function adminKey() {
    if (typeof getSiteAdminKey === 'function') return getSiteAdminKey();
    let k = sessionStorage.getItem(KEY_SESSION) || '';
    if (!k) {
      k = (prompt('Enter admin key:') || '').trim();
      if (k) sessionStorage.setItem(KEY_SESSION, k);
    }
    return k;
  }

  function loadChartJs() {
    if (window.Chart) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  /* ── modal ─────────────────────────────────────────────── */
  function inject() {
    if (document.getElementById('uadModal')) return;
    document.body.insertAdjacentHTML('beforeend', `
<style>
#uadModal{position:fixed;inset:0;z-index:99999;background:rgba(8,20,12,.75);backdrop-filter:blur(6px);display:none;align-items:center;justify-content:center;font-family:"Segoe UI",Tahoma,sans-serif}
#uadModal.open{display:flex}
.uad-box{background:#16301f;border:1.5px solid #63ff8a44;border-radius:20px;width:min(1200px,97vw);max-height:94vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 80px rgba(60,200,117,.35);color:#cfefda}
.uad-header{padding:18px 24px;background:linear-gradient(135deg,#206039,#16301f);border-bottom:1px solid #63ff8a33;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
.uad-header h2{margin:0;color:#b8ffd2;font-size:1.25rem}
.uad-btn{background:#224831;color:#b8ffd2;border:1px solid #4fd87455;border-radius:8px;padding:6px 12px;font-weight:600;font-size:.8rem;cursor:pointer;margin-left:6px}
.uad-btn:hover{background:#2d603f}
.uad-btn.active{background:linear-gradient(135deg,#4fd874,#63f097);color:#fff;border-color:transparent}
.uad-body{flex:1;overflow:auto;padding:18px 24px;scrollbar-width:thin;scrollbar-color:#4fd874 #16301f}
.uad-status{font-size:.8rem;color:#85aa92;margin-bottom:12px}
.uad-status.err{color:#fc8181}
.uad-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:16px}
.uad-tile{background:#193d29;border:1px solid #4fd87422;border-radius:12px;padding:14px;text-align:center}
.uad-tile .val{font-size:1.5rem;font-weight:800;color:#b8ffd2;word-break:break-word}
.uad-tile .lbl{font-size:.75rem;color:#85aa92;margin-top:3px;text-transform:uppercase;letter-spacing:.4px}
.uad-tile .sub{font-size:.75rem;color:#9fd3b0;margin-top:6px}
.uad-tile a{color:#83ffb4}
.uad-card{background:#193d29;border:1px solid #4fd87422;border-radius:14px;padding:14px;margin-bottom:16px}
.uad-card-head{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;color:#b8ffd2;font-weight:600;font-size:.9rem}
.uad-chart-wrap{position:relative;height:280px}
.uad-table-head{display:flex;gap:10px;align-items:center;margin-bottom:8px;flex-wrap:wrap}
.uad-search{flex:1;min-width:180px;background:#102a17;border:1.5px solid #4fd87444;border-radius:8px;color:#dcffe7;padding:8px 12px;font-size:.88rem}
.uad-table-wrap{overflow:auto;max-height:46vh;border:1px solid #4fd87422;border-radius:10px}
.uad-table{width:100%;border-collapse:collapse;font-size:.82rem}
.uad-table th{position:sticky;top:0;background:#205033;color:#b8ffd2;padding:8px 10px;text-align:right;white-space:nowrap;cursor:pointer;user-select:none}
.uad-table th:first-child,.uad-table td:first-child{text-align:left}
.uad-table th.grp-h{border-left:2px solid #4fd87444}
.uad-table td{padding:7px 10px;border-bottom:1px solid #4fd87411;text-align:right;white-space:nowrap}
.uad-table tbody tr{cursor:pointer}
.uad-table tbody tr:hover{background:#205033}
.uad-table tbody tr.sel{background:#2d603f}
.uad-muted{color:#85aa92;font-size:.75rem}
</style>
<div id="uadModal">
  <div class="uad-box">
    <div class="uad-header">
      <h2>📈 User Activity</h2>
      <div>
        <button class="uad-btn" id="uadRefresh">↻ Refresh</button>
        <button class="uad-btn" id="uadCsv">⬇ CSV</button>
        <button class="uad-btn" id="uadClose">✕ Close</button>
      </div>
    </div>
    <div class="uad-body">
      <div class="uad-status" id="uadStatus"></div>
      <div class="uad-tiles" id="uadTiles"></div>
      <div class="uad-card">
        <div class="uad-card-head">
          <span id="uadChartTitle">Activity</span>
          <div>
            <button class="uad-btn active" data-period="week">Weekly</button>
            <button class="uad-btn" data-period="month">Monthly</button>
          </div>
        </div>
        <div class="uad-chart-wrap"><canvas id="uadChart"></canvas></div>
      </div>
      <div class="uad-table-head">
        <input class="uad-search" id="uadSearch" placeholder="Search users…">
        <span class="uad-muted" id="uadCount"></span>
      </div>
      <div class="uad-table-wrap">
        <table class="uad-table"><thead id="uadThead"></thead><tbody id="uadTbody"></tbody></table>
      </div>
      <div class="uad-muted" style="margin-top:8px">Click a user to see their own chart and totals. “7 d” = last 7 days, “30 d” = last 30 days. History counts include Missed/Spaced review (shown separately as “Review”).</div>
    </div>
  </div>
</div>`);

    const modal = document.getElementById('uadModal');
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    document.getElementById('uadClose').onclick = close;
    document.getElementById('uadRefresh').onclick = load;
    document.getElementById('uadCsv').onclick = downloadCsv;
    document.getElementById('uadSearch').oninput = (e) => { view.search = e.target.value.trim().toLowerCase(); renderTable(); };
    modal.querySelectorAll('[data-period]').forEach((b) => {
      b.onclick = () => {
        view.period = b.dataset.period;
        modal.querySelectorAll('[data-period]').forEach((x) => x.classList.toggle('active', x === b));
        renderChart();
      };
    });
  }

  function close() { document.getElementById('uadModal')?.classList.remove('open'); }

  function setStatus(msg, err) {
    const el = document.getElementById('uadStatus');
    el.textContent = msg;
    el.className = 'uad-status' + (err ? ' err' : '');
  }

  /* ── data ──────────────────────────────────────────────── */
  async function load() {
    setStatus('Loading…');
    const key = adminKey();
    if (!key) { close(); return; }
    try {
      const res = await fetch(`${API}/admin/user-activity`, { headers: { 'X-Admin-Key': key } });
      if (res.status === 401) {
        sessionStorage.removeItem(KEY_SESSION);
        throw new Error('Admin key rejected — close and reopen to enter the current key.');
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      DATA = await res.json();
      ROWS = summarize();
      setStatus(`Updated ${new Date(DATA.generatedAt).toLocaleString()} · ${DATA.users.length} registered accounts`);
      renderAll();
    } catch (e) {
      setStatus('⚠ ' + e.message, true);
    }
  }

  function summarize() {
    const d7 = daysAgo(6), d30 = daysAgo(29);
    const map = new Map();
    const get = (name) => {
      const key = String(name || '').toLowerCase();
      if (!map.has(key)) {
        map.set(key, {
          key, name: String(name || ''), registered: false, last: '',
          hAtt: [0, 0, 0], hCor: [0, 0, 0], rAtt: [0, 0, 0],
          gAtt: [0, 0, 0], gCor: [0, 0, 0], vid: [0, 0, 0],
        });
      }
      return map.get(key);
    };
    (DATA.users || []).forEach((u) => { const r = get(u); r.name = u; r.registered = true; });
    (DATA.daily || []).forEach(([u, date, src, att, cor]) => {
      if (!u || !date) return;
      const r = get(u);
      const slots = [0];               // 0 = all time, 1 = 7 d, 2 = 30 d
      if (date >= d7) slots.push(1);
      if (date >= d30) slots.push(2);
      const add = (arr, n) => slots.forEach((i) => { arr[i] += Number(n || 0); });
      if (src === 'history' || src === 'review') {
        add(r.hAtt, att); add(r.hCor, cor);
        if (src === 'review') add(r.rAtt, att);
      } else if (src === 'geo') {
        add(r.gAtt, att); add(r.gCor, cor);
      } else if (src === 'video') {
        add(r.vid, att);
      }
      if (date > r.last) r.last = date;
    });
    return [...map.values()];
  }

  function buildSeries(period, userKey) {
    const N = 12;
    const labels = [];
    if (period === 'week') {
      const start = new Date(weekStart(dayStr(new Date())) + 'T00:00:00Z');
      for (let i = N - 1; i >= 0; i--) {
        const d = new Date(start);
        d.setUTCDate(d.getUTCDate() - 7 * i);
        labels.push(dayStr(d));
      }
    } else {
      const now = new Date();
      for (let i = N - 1; i >= 0; i--) {
        labels.push(dayStr(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))).slice(0, 7));
      }
    }
    const keyFn = period === 'week' ? weekStart : (ds) => ds.slice(0, 7);
    const idx = Object.fromEntries(labels.map((l, i) => [l, i]));
    const hist = Array(N).fill(0), geo = Array(N).fill(0), vid = Array(N).fill(0);
    const active = labels.map(() => new Set());
    (DATA.daily || []).forEach(([u, date, src, att]) => {
      if (!u || !date) return;
      const uk = String(u).toLowerCase();
      if (userKey && uk !== userKey) return;
      const i = idx[keyFn(date)];
      if (i === undefined) return;
      if (src === 'geo') geo[i] += att;
      else if (src === 'video') vid[i] += att;
      else hist[i] += att;
      active[i].add(uk);
    });
    return { labels, hist, geo, vid, active: active.map((s) => s.size) };
  }

  /* ── render ────────────────────────────────────────────── */
  function renderAll() { renderTiles(); renderChart(); renderTable(); }

  function renderTiles() {
    const rows = view.user ? ROWS.filter((r) => r.key === view.user) : ROWS;
    const d7 = daysAgo(6), d30 = daysAgo(29);
    const q = [0, 0, 0], c = [0, 0, 0], v = [0, 0, 0];
    let a7 = 0, a30 = 0;
    rows.forEach((r) => {
      for (let i = 0; i < 3; i++) { q[i] += r.hAtt[i] + r.gAtt[i]; c[i] += r.hCor[i] + r.gCor[i]; v[i] += r.vid[i]; }
      if (r.last >= d7) a7++;
      if (r.last >= d30) a30++;
    });
    const tile = (val, lbl, sub) => `<div class="uad-tile"><div class="val">${val}</div><div class="lbl">${lbl}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
    let html = '';
    if (view.user) {
      const r = rows[0] || {};
      html += tile(esc(r.name), 'Selected user', '<a href="#" id="uadClearUser">← show all users</a>');
      html += tile(r.last ? esc(r.last) : 'never', 'Last active', r.registered ? 'has account' : 'no matching account');
    } else {
      html += tile(num(ROWS.filter((r) => r.registered).length), 'Registered users', `${a7} active this week · ${a30} this month`);
    }
    const hq = rows.reduce((s, r) => s + r.hAtt[0], 0), gq = rows.reduce((s, r) => s + r.gAtt[0], 0);
    html += tile(num(q[0]), 'Questions answered', `${num(q[1])} this week · ${num(q[2])} this month`);
    html += tile(pct(c[0], q[0]), 'Accuracy (all time)', `${pct(c[1], q[1])} this week · ${pct(c[2], q[2])} this month`);
    html += tile(num(v[0]), 'Videos watched', `${num(v[1])} this week · ${num(v[2])} this month`);
    html += tile(`${num(hq)} / ${num(gq)}`, 'History / Geo Qs', `review: ${num(rows.reduce((s, r) => s + r.rAtt[0], 0))}`);
    if (!view.user) {
      const best = [...ROWS].sort((a, b) => (b.hAtt[1] + b.gAtt[1]) - (a.hAtt[1] + a.gAtt[1]))[0];
      if (best && best.hAtt[1] + best.gAtt[1] > 0) {
        html += tile(esc(best.name), 'Most active this week', `${num(best.hAtt[1] + best.gAtt[1])} questions`);
      }
    }
    document.getElementById('uadTiles').innerHTML = html;
    const clear = document.getElementById('uadClearUser');
    if (clear) clear.onclick = (e) => { e.preventDefault(); view.user = null; renderAll(); };
  }

  async function renderChart() {
    if (!DATA) return;
    try { await loadChartJs(); } catch (_) { setStatus('⚠ Could not load the chart library.', true); return; }
    const s = buildSeries(view.period, view.user);
    const who = view.user ? (ROWS.find((r) => r.key === view.user)?.name || view.user) : 'All users';
    document.getElementById('uadChartTitle').textContent =
      `${who} — ${view.period === 'week' ? 'last 12 weeks (Mon–Sun)' : 'last 12 months'}`;
    const datasets = [
      { label: 'History questions', data: s.hist, backgroundColor: '#4fd874', stack: 'q' },
      { label: 'Geography questions', data: s.geo, backgroundColor: '#3aa8a3', stack: 'q' },
      { type: 'line', label: 'Videos watched', data: s.vid, borderColor: '#ffd166', backgroundColor: '#ffd166', yAxisID: 'y1', tension: 0.3 },
    ];
    if (!view.user) {
      datasets.push({ type: 'line', label: 'Active users', data: s.active, borderColor: '#b8a6ff', backgroundColor: '#b8a6ff', yAxisID: 'y1', borderDash: [5, 4], tension: 0.3 });
    }
    if (chart) chart.destroy();
    chart = new Chart(document.getElementById('uadChart'), {
      type: 'bar',
      data: { labels: s.labels.map(fmtLabel), datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { color: '#cfefda' } } },
        scales: {
          x: { stacked: true, ticks: { color: '#85aa92' }, grid: { color: '#4fd87411' } },
          y: { stacked: true, beginAtZero: true, ticks: { color: '#85aa92', precision: 0 }, grid: { color: '#4fd87422' }, title: { display: true, text: 'Questions', color: '#85aa92' } },
          y1: { position: 'right', beginAtZero: true, ticks: { color: '#85aa92', precision: 0 }, grid: { display: false }, title: { display: true, text: view.user ? 'Videos' : 'Videos / users', color: '#85aa92' } },
        },
      },
    });
  }

  const COLS = [
    { k: 'name', label: 'User', v: (r) => r.name.toLowerCase(), d: (r) => esc(r.name) + (r.registered ? '' : ' <span class="uad-muted">(no account)</span>') },
    { k: 'hAll', label: 'History Qs', v: (r) => r.hAtt[0], grp: true },
    { k: 'h7', label: '7 d', v: (r) => r.hAtt[1] },
    { k: 'h30', label: '30 d', v: (r) => r.hAtt[2] },
    { k: 'hAcc', label: 'Acc', v: (r) => (r.hAtt[0] ? r.hCor[0] / r.hAtt[0] : -1), d: (r) => pct(r.hCor[0], r.hAtt[0]) },
    { k: 'rAll', label: 'Review', v: (r) => r.rAtt[0] },
    { k: 'gAll', label: 'Geo Qs', v: (r) => r.gAtt[0], grp: true },
    { k: 'g7', label: '7 d', v: (r) => r.gAtt[1] },
    { k: 'g30', label: '30 d', v: (r) => r.gAtt[2] },
    { k: 'gAcc', label: 'Acc', v: (r) => (r.gAtt[0] ? r.gCor[0] / r.gAtt[0] : -1), d: (r) => pct(r.gCor[0], r.gAtt[0]) },
    { k: 'vAll', label: 'Videos', v: (r) => r.vid[0], grp: true },
    { k: 'v7', label: '7 d', v: (r) => r.vid[1] },
    { k: 'v30', label: '30 d', v: (r) => r.vid[2] },
    { k: 'last', label: 'Last active', v: (r) => r.last || '', d: (r) => r.last || '<span class="uad-muted">never</span>', grp: true },
  ];

  function renderTable() {
    const thead = document.getElementById('uadThead');
    thead.innerHTML = '<tr>' + COLS.map((c) => {
      const arrow = view.sortKey === c.k ? (view.sortDir > 0 ? ' ▲' : ' ▼') : '';
      return `<th data-k="${c.k}" class="${c.grp ? 'grp-h' : ''}">${c.label}${arrow}</th>`;
    }).join('') + '</tr>';
    thead.querySelectorAll('th').forEach((th) => {
      th.onclick = () => {
        const k = th.dataset.k;
        if (view.sortKey === k) view.sortDir *= -1;
        else { view.sortKey = k; view.sortDir = k === 'name' ? 1 : -1; }
        renderTable();
      };
    });

    const col = COLS.find((c) => c.k === view.sortKey) || COLS[0];
    const rows = ROWS
      .filter((r) => !view.search || r.key.includes(view.search))
      .sort((a, b) => {
        const va = col.v(a), vb = col.v(b);
        return (va < vb ? -1 : va > vb ? 1 : 0) * view.sortDir;
      });

    document.getElementById('uadCount').textContent = `${rows.length} user${rows.length === 1 ? '' : 's'}`;
    const tbody = document.getElementById('uadTbody');
    tbody.innerHTML = rows.map((r) => `<tr data-key="${esc(r.key)}" class="${r.key === view.user ? 'sel' : ''}">` +
      COLS.map((c) => `<td class="${c.grp ? 'grp-h' : ''}">${c.d ? c.d(r) : num(c.v(r))}</td>`).join('') + '</tr>').join('');
    tbody.querySelectorAll('tr').forEach((tr) => {
      tr.onclick = () => {
        view.user = view.user === tr.dataset.key ? null : tr.dataset.key;
        renderAll();
      };
    });
  }

  function downloadCsv() {
    if (!ROWS.length) return;
    const head = ['user', 'registered', 'history_all', 'history_7d', 'history_30d', 'history_accuracy', 'review_all',
      'geo_all', 'geo_7d', 'geo_30d', 'geo_accuracy', 'videos_all', 'videos_7d', 'videos_30d', 'last_active'];
    const lines = [head.join(',')].concat(ROWS.map((r) => [
      r.name, r.registered, r.hAtt[0], r.hAtt[1], r.hAtt[2], pct(r.hCor[0], r.hAtt[0]), r.rAtt[0],
      r.gAtt[0], r.gAtt[1], r.gAtt[2], pct(r.gCor[0], r.gAtt[0]), r.vid[0], r.vid[1], r.vid[2], r.last,
    ].map((x) => `"${String(x).replace(/"/g, '""')}"`).join(',')));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `user-activity-${dayStr(new Date())}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }

  /* ── public entry point ───────────────────────────────── */
  window.openUserActivityDashboard = function () {
    if (typeof isKizuruki === 'function' && !isKizuruki()) return;
    inject();
    document.getElementById('uadModal').classList.add('open');
    load();
  };
})();
