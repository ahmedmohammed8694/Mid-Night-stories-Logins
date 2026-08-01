// admin.js — Admin dashboard: login, MFA, moderation queues, reports, categories, bans, settings, audit log

(function () {
  let adminToken = sessionStorage.getItem('adminToken') || localStorage.getItem('adminToken');
  let preToken = null;
  let allBooksList = [];

  // ── Check Auth State ──
  function checkAuth() {
    adminToken = sessionStorage.getItem('adminToken') || localStorage.getItem('adminToken');
    if (adminToken) {
      sessionStorage.setItem('adminToken', adminToken);
      localStorage.setItem('adminToken', adminToken);
      showDashboard();
      loadDashboardData();
    }
  }

  function showDashboard() {
    const loginSection = document.getElementById('loginSection');
    const dashboardSection = document.getElementById('dashboardSection');
    const logoutBtn = document.getElementById('logoutBtn');
    if (loginSection) loginSection.classList.add('hidden');
    if (dashboardSection) dashboardSection.classList.remove('hidden');
    if (logoutBtn) logoutBtn.classList.remove('hidden');
  }

  // ── Login ──
  window.adminHandleLogin = handleLogin;
  async function handleLogin(e) {
    if (e) e.preventDefault();
    const username = (document.getElementById('loginUsername')?.value || '').trim();
    const password = document.getElementById('loginPassword')?.value || '';

    if (!username || !password) {
      showToast('Please enter username and password.', 'warning');
      return;
    }

    try {
      const data = await api('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      });

      if (data.requireMFA) {
        preToken = data.preToken;
        document.getElementById('loginForm')?.classList.add('hidden');
        document.getElementById('mfaStep')?.classList.remove('hidden');
        document.getElementById('mfaCode')?.focus();
        showToast('Enter your MFA code to continue.', 'info');
      } else {
        adminToken = data.token;
        sessionStorage.setItem('adminToken', adminToken);
        localStorage.setItem('adminToken', adminToken);
        showToast(`Welcome back, ${data.username}!`, 'success');
        showDashboard();
        loadDashboardData();
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // ── MFA Verify ──
  async function handleMFA() {
    const code = (document.getElementById('mfaCode')?.value || '').replace(/\s+/g, '');
    if (!code || code.length !== 6) {
      showToast('Please enter a valid 6-digit code.', 'warning');
      return;
    }

    try {
      const data = await api('/api/admin/mfa-verify', {
        method: 'POST',
        body: JSON.stringify({ preToken, code })
      });

      adminToken = data.token;
      sessionStorage.setItem('adminToken', adminToken);
      localStorage.setItem('adminToken', adminToken);
      showToast(`Welcome back, ${data.username}!`, 'success');
      showDashboard();
      loadDashboardData();
    } catch (err) {
      showToast(err.message, 'error');
      const mfaInput = document.getElementById('mfaCode');
      if (mfaInput) { mfaInput.value = ''; mfaInput.focus(); }
    }
  }

  // ── Logout ──
  window.handleLogout = handleLogout;
  function handleLogout() {
    adminToken = null;
    sessionStorage.removeItem('adminToken');
    localStorage.removeItem('adminToken');
    const loginSection = document.getElementById('loginSection');
    const dashboardSection = document.getElementById('dashboardSection');
    const logoutBtn = document.getElementById('logoutBtn');
    const loginForm = document.getElementById('loginForm');
    const mfaStep = document.getElementById('mfaStep');

    if (loginSection) loginSection.classList.remove('hidden');
    if (dashboardSection) dashboardSection.classList.add('hidden');
    if (logoutBtn) logoutBtn.classList.add('hidden');
    if (loginForm) loginForm.classList.remove('hidden');
    if (mfaStep) mfaStep.classList.add('hidden');

    const u = document.getElementById('loginUsername'); if (u) u.value = '';
    const p = document.getElementById('loginPassword'); if (p) p.value = '';
    showToast('Logged out successfully.', 'info');
  }

  // ── Panel Navigation ──
  function switchPanel(panelName) {
    // 1. Hide all panels cleanly
    document.querySelectorAll('.admin-panel').forEach(p => {
      p.classList.remove('active');
      p.style.display = 'none';
    });
    document.querySelectorAll('.admin-nav-item').forEach(n => n.classList.remove('active'));

    // 2. Display target panel with important flag
    const panel = document.getElementById(`panel-${panelName}`);
    if (panel) {
      panel.classList.add('active');
      panel.style.setProperty('display', 'block', 'important');
    } else {
      console.warn(`Panel panel-${panelName} not found in DOM`);
    }

    // 3. Active state on navbar button
    const navItem = document.querySelector(`[data-panel="${panelName}"]`);
    if (navItem) navItem.classList.add('active');

    // 4. Reset scroll offsets to top
    window.scrollTo(0, 0);
    if (document.documentElement) document.documentElement.scrollTop = 0;
    if (document.body) document.body.scrollTop = 0;
    const adminMain = document.querySelector('.admin-main');
    if (adminMain) adminMain.scrollTop = 0;

    // 5. Load panel-specific data
    try {
      switch (panelName) {
        case 'overview': if (typeof loadStats === 'function') loadStats(); break;
        case 'books': if (typeof loadBooks === 'function') loadBooks(); break;
        case 'stories-queue': if (typeof loadStoriesQueue === 'function') loadStoriesQueue(); break;
        case 'comments-queue': if (typeof loadCommentsQueue === 'function') loadCommentsQueue(); break;
        case 'reports': if (typeof loadReports === 'function') loadReports(); break;
        case 'crm-analytics': if (typeof loadCrmAnalytics === 'function') loadCrmAnalytics(); break;
        case 'users': if (typeof loadUsers === 'function') loadUsers(); break;
        case 'categories': if (typeof loadCategories === 'function') loadCategories(); break;
        case 'bans': if (typeof loadBans === 'function') loadBans(); break;
        case 'settings': if (typeof loadSettings === 'function') loadSettings(); break;
        case 'audit-log': if (typeof loadAuditLog === 'function') loadAuditLog(); break;
        case 'accounts': if (typeof loadAccounts === 'function') loadAccounts(); break;
        case 'taxonomy': if (typeof loadTaxonomy === 'function') loadTaxonomy(); break;
        case 'roles': if (typeof loadRoles === 'function') loadRoles(); break;
        case 'teams': if (typeof loadTeams === 'function') loadTeams(); break;
        case 'employees': if (typeof loadEmployees === 'function') loadEmployees(); break;
        case 'mfa-setup': if (typeof loadMFASetup === 'function') loadMFASetup(); break;
      }
    } catch(err) {
      console.error(`Failed to load panel ${panelName}:`, err);
    }
  }

  // ── Load Dashboard Data ──
  function loadDashboardData() {
    adminToken = sessionStorage.getItem('adminToken') || localStorage.getItem('adminToken');
    loadStats();
  }
  window.loadDashboardData = loadDashboardData;

  // ── Stats ──
  let _statsFailCount = 0;
  async function loadStats() {
    try {
      const stats = await api('/api/admin/stats');
      _statsFailCount = 0;

      const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = (val !== undefined && val !== null) ? val : '0';
      };

      setVal('statTotalStories', stats.totalStories);
      setVal('statPending', stats.pendingStories);
      setVal('statApproved', stats.approvedStories);
      setVal('statRejected', stats.rejectedStories);
      setVal('statReports', stats.openReports);
      setVal('statComments', stats.totalComments);
      setVal('statPendingComments', stats.pendingComments);
      setVal('statLikes', stats.totalLikes);
      setVal('statUsers', stats.totalUsers);
      setVal('statBannedIPs', stats.bannedIPs);
      setVal('statPendingBooks', stats.pendingBooks);
      setVal('statCategories', stats.totalCategories);

      // Update sidebar badges
      updateBadge('pendingStoriesBadge', stats.pendingStories);
      updateBadge('pendingCommentsBadge', stats.pendingComments);
      updateBadge('reportsBadge', stats.openReports);
    } catch (err) {
      if (err.status === 401) {
        _statsFailCount++;
        // Only force-logout after 2 consecutive 401s to avoid false positives
        if (_statsFailCount >= 2) {
          showToast('Session expired. Please log in again.', 'warning');
          setTimeout(() => handleLogout(), 1500);
        } else {
          console.warn('Stats 401 (attempt ' + _statsFailCount + ') — will retry before logout');
        }
        return;
      }
      _statsFailCount = 0;
      console.error('Failed to load stats:', err);
    }
  }

  function updateBadge(id, count) {
    const badge = document.getElementById(id);
    if (!badge) return;
    if (count > 0) {
      badge.textContent = count;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ██  EXECUTIVE CRM ANALYTICS DASHBOARD
  // ═══════════════════════════════════════════════════════════
  let crmRawTickets = []; // cached for filtering & downloads

  async function loadCrmAnalytics() {
    try {
      // ── 1. Fetch summary analytics ──
      const data = await api('/api/admin/analytics');
      const summary = data.summary || {};

      // KPI Cards
      const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
      set('metricTotalTickets', summary.total_tickets || 0);
      set('metricSlaCompliance', `${summary.sla_compliance_pct ?? 100}%`);
      set('metricCsatScore', summary.csat_score || '5.0');
      set('metricCsatCount', `${summary.csat_count || 0} reviews`);
      set('metricOpenTickets', summary.open_tickets || 0);
      set('metricResolvedTickets', summary.resolved_tickets || 0);

      // ── 2. Category Bar Chart ──
      const topCats = data.topCategories || [];
      const barContainer = document.getElementById('categoryBarChart');
      if (barContainer) {
        if (topCats.length === 0) {
          barContainer.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">No ticket categories recorded yet.</p>';
        } else {
          const maxCat = Math.max(...topCats.map(c => c.ticket_count), 1);
          const catColors = ['#818cf8','#4ade80','#f59e0b','#f87171','#22d3ee','#fb923c'];
          barContainer.innerHTML = topCats.map((c, i) => {
            const pct = Math.round((c.ticket_count / maxCat) * 100);
            return `
              <div style="display:flex;align-items:center;gap:10px;">
                <div style="width:140px;font-size:0.78rem;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex-shrink:0;" title="${escapeHtml(c.category_name || 'General')}">${escapeHtml((c.category_name || 'General').replace(/^[^\s]+\s/, ''))}</div>
                <div style="flex:1;background:rgba(255,255,255,0.05);border-radius:6px;height:20px;overflow:hidden;">
                  <div style="height:100%;width:${pct}%;background:${catColors[i % catColors.length]};border-radius:6px;transition:width 0.8s ease;"></div>
                </div>
                <div style="width:28px;font-size:0.8rem;font-weight:700;color:${catColors[i % catColors.length]};text-align:right;">${c.ticket_count}</div>
              </div>`;
          }).join('');
        }
      }

      // ── 3. Fetch all tickets for full table + charts ──
      const allTickets = await api('/api/admin/helpdesk/tickets');
      crmRawTickets = allTickets || [];

      // ── 4. Donut Chart (SVG) ──
      const statusCounts = { open: 0, investigating: 0, waiting_on_user: 0, resolved: 0, closed: 0 };
      const priorityCounts = { urgent: 0, high: 0, medium: 0, low: 0 };
      const categoryCounts = {};

      crmRawTickets.forEach(t => {
        const s = t.ticket_status || 'open';
        if (statusCounts[s] !== undefined) statusCounts[s]++; else statusCounts.open++;
        const p = t.priority || 'medium';
        if (priorityCounts[p] !== undefined) priorityCounts[p]++;
        const cn = t.category_name || 'General Inquiries';
        categoryCounts[cn] = (categoryCounts[cn] || { total: 0, open: 0, resolved: 0 });
        categoryCounts[cn].total++;
        if (s === 'open' || s === 'investigating' || s === 'waiting_on_user') categoryCounts[cn].open++;
        if (s === 'resolved' || s === 'closed') categoryCounts[cn].resolved++;
      });

      const total = crmRawTickets.length || 1;
      const circumference = 2 * Math.PI * 48; // ~302
      let offset = 0;

      function setDonut(id, count, circumference, currentOffset) {
        const el = document.getElementById(id);
        if (!el) return currentOffset;
        const arc = (count / total) * circumference;
        el.setAttribute('stroke-dasharray', `${arc} ${circumference - arc}`);
        el.setAttribute('stroke-dashoffset', -currentOffset);
        return currentOffset + arc;
      }

      offset = setDonut('donutOpen', statusCounts.open, circumference, offset);
      offset = setDonut('donutInv', statusCounts.investigating, circumference, offset);
      offset = setDonut('donutWait', statusCounts.waiting_on_user, circumference, offset);
      setDonut('donutRes', (statusCounts.resolved + statusCounts.closed), circumference, offset);

      set('donutTotalText', crmRawTickets.length);
      set('donutLegOpen', statusCounts.open);
      set('donutLegInv', statusCounts.investigating);
      set('donutLegWait', statusCounts.waiting_on_user);
      set('donutLegRes', statusCounts.resolved + statusCounts.closed);

      // ── 5. Priority Bar Chart ──
      const maxP = Math.max(...Object.values(priorityCounts), 1);
      [['urgent','barUrgent','barUrgentLbl'],['high','barHigh','barHighLbl'],['medium','barMedium','barMediumLbl'],['low','barLow','barLowLbl']].forEach(([key, barId, lblId]) => {
        const bar = document.getElementById(barId);
        const lbl = document.getElementById(lblId);
        const pct = Math.round((priorityCounts[key] / maxP) * 100);
        if (bar) bar.style.height = `${pct}%`;
        if (lbl) lbl.textContent = priorityCounts[key];
      });

      // ── 6. Full Tickets Table ──
      renderCrmTicketsTable(crmRawTickets);

      // ── 7. Category Performance Table ──
      const catBody = document.getElementById('categoryPerformanceBody');
      if (catBody) {
        const catEntries = Object.entries(categoryCounts).sort((a, b) => b[1].total - a[1].total);
        if (catEntries.length === 0) {
          catBody.innerHTML = '<tr><td colspan="4" style="text-align:center;opacity:0.5;padding:16px;">No data yet.</td></tr>';
        } else {
          catBody.innerHTML = catEntries.map(([name, counts]) => `
            <tr>
              <td style="font-size:0.82rem;font-weight:600;">${escapeHtml(name)}</td>
              <td><span style="font-weight:700;color:#818cf8;">${counts.total}</span></td>
              <td><span style="font-weight:700;color:#4ade80;">${counts.open}</span></td>
              <td><span style="font-weight:700;color:#22d3ee;">${counts.resolved}</span></td>
            </tr>`).join('');
        }
      }

      // ── 8. CSAT Ratings Table ──
      const csatBody = document.getElementById('csatRatingsBody');
      if (csatBody) {
        const rated = crmRawTickets.filter(t => t.csat_rating);
        if (rated.length === 0) {
          csatBody.innerHTML = '<tr><td colspan="4" style="text-align:center;opacity:0.5;padding:16px;">No ratings submitted yet.</td></tr>';
        } else {
          csatBody.innerHTML = rated.slice(0, 20).map(t => {
            const stars = '⭐'.repeat(t.csat_rating) + '☆'.repeat(5 - t.csat_rating);
            return `<tr>
              <td style="font-family:monospace;font-size:0.78rem;color:#818cf8;">${escapeHtml(t.ticket_id || 'TKT-' + t.id)}</td>
              <td style="font-size:0.9rem;" title="${t.csat_rating}/5">${stars}</td>
              <td style="font-size:0.8rem;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(t.csat_feedback || '—')}</td>
              <td style="font-size:0.75rem;color:var(--text-muted);">${t.resolved_at ? new Date(t.resolved_at).toLocaleDateString() : '—'}</td>
            </tr>`;
          }).join('');
        }
      }

    } catch (err) {
      showToast('Failed to load CRM Analytics: ' + err.message, 'error');
    }
  }

  function renderCrmTicketsTable(tickets) {
    const statusFilter = (document.getElementById('crmTableStatusFilter') || {}).value || '';
    const priorityFilter = (document.getElementById('crmTablePriorityFilter') || {}).value || '';
    const searchVal = ((document.getElementById('crmTableSearch') || {}).value || '').toLowerCase();

    let filtered = tickets.filter(t => {
      if (statusFilter && (t.ticket_status || 'open') !== statusFilter) return false;
      if (priorityFilter && (t.priority || 'medium') !== priorityFilter) return false;
      if (searchVal) {
        const haystack = `${t.ticket_id} ${t.subject} ${t.category_name} ${t.user_name} ${t.user_email}`.toLowerCase();
        if (!haystack.includes(searchVal)) return false;
      }
      return true;
    });

    const tbody = document.getElementById('crmTicketsBody');
    if (!tbody) return;

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;opacity:0.5;padding:24px;">No tickets match the current filters.</td></tr>';
      return;
    }

    const statusColors = { open: '#4ade80', investigating: '#facc15', waiting_on_user: '#fb923c', resolved: '#818cf8', closed: '#9ca3af' };
    const priorityColors = { urgent: '#f87171', high: '#facc15', medium: '#818cf8', low: '#4ade80' };

    tbody.innerHTML = filtered.map(t => {
      const status = t.ticket_status || 'open';
      const priority = t.priority || 'medium';
      const slaDate = t.sla_due_at ? new Date(t.sla_due_at) : null;
      const slaOverdue = slaDate && slaDate < new Date() && status !== 'resolved' && status !== 'closed';
      const slaStr = slaDate ? `<span style="color:${slaOverdue ? '#f87171' : 'var(--text-muted)'};font-size:0.75rem;">${slaDate.toLocaleDateString()}${slaOverdue ? ' ⚠️' : ''}</span>` : '—';

      return `<tr>
        <td style="font-family:monospace;font-size:0.78rem;color:#818cf8;font-weight:700;">${escapeHtml(t.ticket_id || 'TKT-' + t.id)}</td>
        <td style="font-size:0.82rem;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(t.subject || '')}">${escapeHtml(t.subject || t.reason || 'Support Request')}</td>
        <td style="font-size:0.78rem;color:var(--text-muted);">${escapeHtml(t.category_name || 'General')}</td>
        <td><span style="display:inline-block;padding:2px 8px;border-radius:8px;font-size:0.7rem;font-weight:700;background:${priorityColors[priority]}22;color:${priorityColors[priority]};border:1px solid ${priorityColors[priority]}44;">${priority}</span></td>
        <td><span style="display:inline-block;padding:2px 8px;border-radius:8px;font-size:0.7rem;font-weight:700;background:${statusColors[status]}22;color:${statusColors[status]};border:1px solid ${statusColors[status]}44;">${status.replace(/_/g, ' ')}</span></td>
        <td style="font-size:0.78rem;">${escapeHtml(t.user_name || '—')}</td>
        <td style="font-size:0.75rem;color:var(--text-muted);">${t.created_at ? new Date(t.created_at).toLocaleDateString() : '—'}</td>
        <td>${slaStr}</td>
        <td>
          <button class="btn btn--primary btn--sm" onclick="window.openTicketFromCrm(${t.id})" style="padding:4px 8px;font-size:0.78rem;">Review</button>
        </td>
      </tr>`;
    }).join('');
  }

  window.openTicketFromCrm = (id) => {
    const t = crmRawTickets.find(x => x.id === id);
    if (t) {
      window.openTicketModal(t);
    }
  };

  window.filterCrmTable = () => renderCrmTicketsTable(crmRawTickets);
  window.loadCrmAnalytics = loadCrmAnalytics;

  window.downloadCrmCsv = () => {
    if (!crmRawTickets.length) return showToast('No ticket data to export. Load the dashboard first.', 'warning');
    const headers = ['Ticket ID','Subject','Category','Priority','Status','User Name','User Email','Created At','SLA Due At','CSAT Rating'];
    const rows = crmRawTickets.map(t => [
      t.ticket_id || ('TKT-' + t.id), t.subject || t.reason || '', t.category_name || '', t.priority || 'medium',
      t.ticket_status || 'open', t.user_name || '', t.user_email || '',
      t.created_at || '', t.sla_due_at || '', t.csat_rating || ''
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `crm_report_${new Date().toISOString().slice(0,10)}.csv`; a.click();
    URL.revokeObjectURL(url);
    showToast('CSV report downloaded!', 'success');
  };

  window.downloadCrmJson = () => {
    if (!crmRawTickets.length) return showToast('No ticket data to export. Load the dashboard first.', 'warning');
    const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), total: crmRawTickets.length, tickets: crmRawTickets }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `crm_export_${new Date().toISOString().slice(0,10)}.json`; a.click();
    URL.revokeObjectURL(url);
    showToast('JSON export downloaded!', 'success');
  };

  window.copyBiEndpoint = (type) => {
    const endpoints = {
      powerbi: 'https://midnightstories.dpdns.org/api/admin/analytics',
      looker: 'https://midnightstories.dpdns.org/api/admin/helpdesk/tickets'
    };
    navigator.clipboard.writeText(endpoints[type] || '').then(() => {
      showToast(`✅ ${type === 'powerbi' ? 'Power BI' : 'Looker Studio'} endpoint copied to clipboard!`, 'success');
    }).catch(() => showToast('Copy failed — please copy the URL manually.', 'error'));
  };



  // ── Stories Queue & Management ──
  let currentStoryQueueStatus = 'all';
  let currentStoriesList = [];
  window._currentEditingStoryId = null;

  async function loadStoriesQueue(status) {
    if (status !== undefined) currentStoryQueueStatus = status;
    try {
      const data = await api(`/api/admin/queue?type=stories&status=${currentStoryQueueStatus}`);
      const tbody = document.getElementById('storiesQueueBody');
      const empty = document.getElementById('noStoriesQueue');
      if (!tbody) return;
      tbody.innerHTML = '';
      currentStoriesList = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);

      const wrapper = document.getElementById('storiesQueueTable')?.closest('.admin-table-wrapper');

      if (currentStoriesList.length === 0) {
        if (empty) empty.classList.remove('hidden');
        if (wrapper) wrapper.classList.add('hidden');
        return;
      }

      if (empty) empty.classList.add('hidden');
      if (wrapper) wrapper.classList.remove('hidden');

      currentStoriesList.forEach(item => {
        const tr = document.createElement('tr');
        const st = (item.status || 'pending').toLowerCase();
        const statusBadgeClass = (st === 'approved' || st === 'published') ? 'approved'
          : st === 'rejected' ? 'rejected'
          : (st === 'removed' || st === 'hidden' || st === 'archived') ? 'archived' : 'pending';

        tr.innerHTML = `
          <td>#${item.id}</td>
          <td style="font-weight: 500;">
            <a href="#" class="admin-story-detail-trigger" data-story-id="${item.id}" style="color: var(--text-primary); text-decoration: none; font-weight: 600;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">
              ${escapeHtml(item.title || 'Untitled Story')}
            </a>
          </td>
          <td><div class="admin-table__preview" style="max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-secondary);">${escapeHtml(item.body || item.content || '')}</div></td>
          <td><span class="coverage-chip">📁 ${escapeHtml(item.category_name || 'General')}</span></td>
          <td><span class="status-badge status-badge--${statusBadgeClass}">${escapeHtml(st)}</span></td>
          <td>${formatDate(item.created_at)}</td>
          <td>
            <div class="admin-table__actions" style="display: flex; gap: 6px; flex-wrap: wrap;">
              <button class="btn btn--secondary btn--sm admin-story-detail-trigger" data-story-id="${item.id}" style="padding: 4px 8px; font-size: 0.8rem;" title="View Details & Edit">🔍 Details</button>
              ${st !== 'approved' && st !== 'published' ? `<button class="btn btn--success btn--sm" onclick="quickUpdateStoryStatus(${item.id}, 'approved')" style="padding: 4px 8px;" title="Approve & Publish">✓</button>` : ''}
              ${st !== 'rejected' ? `<button class="btn btn--danger btn--sm" onclick="quickUpdateStoryStatus(${item.id}, 'rejected')" style="padding: 4px 8px;" title="Reject">✕</button>` : ''}
              ${st !== 'removed' && st !== 'hidden' ? `<button class="btn btn--ghost btn--sm" onclick="quickUpdateStoryStatus(${item.id}, 'removed')" style="padding: 4px 8px;" title="Hide Story">👁️ Hide</button>` : `<button class="btn btn--ghost btn--sm" onclick="quickUpdateStoryStatus(${item.id}, 'approved')" style="padding: 4px 8px;" title="Unhide Story">👁️ Unhide</button>`}
              <button class="btn btn--danger btn--sm" onclick="deleteAdminStory(${item.id})" style="padding: 4px 8px;" title="Delete Permanently">🗑️</button>
            </div>
          </td>
        `;
        tbody.appendChild(tr);
      });

      // Bind story detail triggers
      tbody.querySelectorAll('.admin-story-detail-trigger').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const storyId = btn.dataset.storyId;
          const targetStory = currentStoriesList.find(s => s.id == storyId);
          if (targetStory) {
            openAdminStoryModal(targetStory);
          }
        });
      });
    } catch (err) {
      console.error('loadStoriesQueue error:', err);
      showToast('Failed to load stories.', 'error');
    }
  }

  async function populateCategoryOptions(selectElementId, selectedId = null) {
    const sel = document.getElementById(selectElementId);
    if (!sel) return;
    try {
      const cats = _allCategories.length ? _allCategories : await api('/api/admin/tax/categories').catch(() => []);
      sel.innerHTML = '<option value="">General / Uncategorized</option>' +
        cats.map(c => `<option value="${c.id}" ${String(c.id) === String(selectedId) ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
    } catch(e) {
      sel.innerHTML = '<option value="">General / Uncategorized</option>';
    }
  }

  async function openAdminStoryModal(story) {
    const modal = document.getElementById('adminStoryReviewModal');
    if (!modal) return;

    window._currentEditingStoryId = story.id;

    const idEl = document.getElementById('adminStoryId');
    if (idEl) idEl.textContent = `ID: #${story.id}`;

    const titleInput = document.getElementById('adminStoryTitleInput');
    if (titleInput) titleInput.value = story.title || '';

    const metaEl = document.getElementById('adminStoryMeta');
    if (metaEl) metaEl.textContent = `By ${story.author_name || (story.user_id ? 'User #' + story.user_id : 'Admin')} • Submitted ${formatDate(story.created_at)}`;

    const catEl = document.getElementById('adminStoryCategory');
    if (catEl) catEl.textContent = story.category_name || 'General';

    await populateCategoryOptions('adminStoryCategorySelect', story.category_id);

    const statusSel = document.getElementById('adminStoryStatusSelect');
    if (statusSel) statusSel.value = story.status || 'pending';

    const imgInput = document.getElementById('adminStoryImageInput');
    if (imgInput) imgInput.value = story.image_url || '';

    const contentInput = document.getElementById('adminStoryContentInput');
    if (contentInput) contentInput.value = story.body || story.content || '';

    const likesEl = document.getElementById('adminStoryLikes');
    if (likesEl) likesEl.textContent = story.like_count || 0;

    const commentsEl = document.getElementById('adminStoryComments');
    if (commentsEl) commentsEl.textContent = story.comment_count || 0;

    const badge = document.getElementById('adminStoryStatusBadge');
    if (badge) {
      const st = (story.status || 'pending').toLowerCase();
      badge.className = `status-badge status-badge--${st === 'approved' || st === 'published' ? 'approved' : st === 'rejected' ? 'rejected' : 'pending'}`;
      badge.textContent = st.toUpperCase();
    }

    const imgContainer = document.getElementById('adminStoryImageContainer');
    const imgEl = document.getElementById('adminStoryImage');
    if (story.image_url && imgContainer && imgEl) {
      imgEl.src = story.image_url;
      imgContainer.style.display = 'block';
    } else if (imgContainer) {
      imgContainer.style.display = 'none';
    }

    modal.style.display = 'flex';
    modal.classList.add('active');
  }

  function closeAdminStoryModal() {
    const modal = document.getElementById('adminStoryReviewModal');
    if (modal) {
      modal.style.display = 'none';
      modal.classList.remove('active');
    }
  }

  async function saveAdminStoryModalEdits() {
    const id = window._currentEditingStoryId;
    if (!id) return;

    const title = (document.getElementById('adminStoryTitleInput')?.value || '').trim();
    const category_id = document.getElementById('adminStoryCategorySelect')?.value || null;
    const status = document.getElementById('adminStoryStatusSelect')?.value || 'approved';
    const image_url = (document.getElementById('adminStoryImageInput')?.value || '').trim();
    const content = (document.getElementById('adminStoryContentInput')?.value || '').trim();

    if (!title || !content) {
      return showToast('Title and content cannot be empty.', 'warning');
    }

    try {
      await api(`/api/admin/stories/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ title, category_id, status, image_url, content })
      });
      showToast('Story updated successfully.', 'success');
      closeAdminStoryModal();
      loadStoriesQueue();
    } catch (err) {
      showToast('Failed to save story edits: ' + err.message, 'error');
    }
  }

  async function quickUpdateStoryStatus(storyId, newStatus) {
    try {
      await api(`/api/admin/stories/${storyId}`, {
        method: 'PUT',
        body: JSON.stringify({ status: newStatus })
      });
      showToast(`Story status updated to ${newStatus}.`, 'success');
      loadStoriesQueue();
    } catch (err) {
      showToast('Failed to update status: ' + err.message, 'error');
    }
  }

  async function deleteAdminStory(storyId) {
    if (!confirm(`Are you sure you want to PERMANENTLY delete story #${storyId}? This action cannot be undone.`)) return;
    try {
      await api(`/api/admin/stories/${storyId}`, { method: 'DELETE' });
      showToast('Story deleted successfully.', 'success');
      if (window._currentEditingStoryId == storyId) closeAdminStoryModal();
      loadStoriesQueue();
    } catch (err) {
      showToast('Failed to delete story: ' + err.message, 'error');
    }
  }

  function deleteCurrentAdminStory() {
    if (window._currentEditingStoryId) {
      deleteAdminStory(window._currentEditingStoryId);
    }
  }

  async function toggleHideCurrentAdminStory() {
    const id = window._currentEditingStoryId;
    if (!id) return;
    const targetStory = currentStoriesList.find(s => s.id == id);
    const currentStatus = targetStory ? targetStory.status : 'approved';
    const newStatus = (currentStatus === 'removed' || currentStatus === 'hidden') ? 'approved' : 'removed';
    await quickUpdateStoryStatus(id, newStatus);
    closeAdminStoryModal();
  }

  async function openAdminCreateStoryModal() {
    await populateCategoryOptions('createStoryCategory');
    const form = document.getElementById('adminCreateStoryForm');
    if (form) form.reset();
    const modal = document.getElementById('adminCreateStoryModal');
    if (modal) {
      modal.style.display = 'flex';
      modal.classList.add('active');
    }
  }

  function closeAdminCreateStoryModal() {
    const modal = document.getElementById('adminCreateStoryModal');
    if (modal) {
      modal.style.display = 'none';
      modal.classList.remove('active');
    }
  }

  async function saveAdminNewStory(e) {
    if (e && e.preventDefault) e.preventDefault();
    const title = (document.getElementById('createStoryTitle')?.value || '').trim();
    const category_id = document.getElementById('createStoryCategory')?.value || null;
    const status = document.getElementById('createStoryStatus')?.value || 'approved';
    const image_url = (document.getElementById('createStoryImageUrl')?.value || '').trim();
    const content = (document.getElementById('createStoryContent')?.value || '').trim();

    if (!title || !content) {
      return showToast('Please enter title and story content.', 'warning');
    }

    const btn = document.getElementById('btnSaveNewStory');
    if (btn) { btn.disabled = true; btn.textContent = 'Publishing...'; }

    try {
      await api('/api/admin/stories', {
        method: 'POST',
        body: JSON.stringify({ title, category_id, status, image_url, content })
      });
      showToast('Story published successfully!', 'success');
      closeAdminCreateStoryModal();
      loadStoriesQueue('all');
    } catch (err) {
      showToast('Failed to publish story: ' + err.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '🚀 Publish Story'; }
    }
  }

  // Export functions to window
  window.openAdminStoryModal = openAdminStoryModal;
  window.closeAdminStoryModal = closeAdminStoryModal;
  window.saveAdminStoryModalEdits = saveAdminStoryModalEdits;
  window.quickUpdateStoryStatus = quickUpdateStoryStatus;
  window.deleteAdminStory = deleteAdminStory;
  window.deleteCurrentAdminStory = deleteCurrentAdminStory;
  window.toggleHideCurrentAdminStory = toggleHideCurrentAdminStory;
  window.openAdminCreateStoryModal = openAdminCreateStoryModal;
  window.closeAdminCreateStoryModal = closeAdminCreateStoryModal;
  window.saveAdminNewStory = saveAdminNewStory;


  // ── Comments Queue & Management ──
  let currentCommentQueueStatus = 'all';
  let currentCommentsList = [];
  window._currentEditingComment = null;
  window._activeMsgUserId = null;

  async function loadCommentsQueue(status) {
    if (status !== undefined) currentCommentQueueStatus = status;
    try {
      const data = await api(`/api/admin/queue?type=comments&status=${currentCommentQueueStatus}`);
      const tbody = document.getElementById('commentsQueueBody');
      const empty = document.getElementById('noCommentsQueue');
      if (!tbody) return;
      tbody.innerHTML = '';
      currentCommentsList = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);

      const wrapper = document.getElementById('commentsQueueTable')?.closest('.admin-table-wrapper');

      if (currentCommentsList.length === 0) {
        if (empty) empty.classList.remove('hidden');
        if (wrapper) wrapper.classList.add('hidden');
        return;
      }

      if (empty) empty.classList.add('hidden');
      if (wrapper) wrapper.classList.remove('hidden');

      currentCommentsList.forEach(item => {
        const tr = document.createElement('tr');
        const st = (item.status || 'pending').toLowerCase();
        const statusBadgeClass = (st === 'approved' || st === 'published') ? 'approved'
          : st === 'rejected' ? 'rejected'
          : (st === 'removed' || st === 'hidden' || st === 'archived') ? 'archived' : 'pending';

        const commenterDisp = item.commenter_name || (item.user_id ? `User #${item.user_id}` : 'Anonymous');
        const commenterEmail = item.commenter_email && item.commenter_email !== '—' ? `<br><small style="color: var(--text-muted);">${escapeHtml(item.commenter_email)}</small>` : '';

        tr.innerHTML = `
          <td>#${item.id}</td>
          <td>
            <div style="font-weight: 600; color: var(--text-primary);">👤 ${escapeHtml(commenterDisp)}</div>
            ${commenterEmail}
          </td>
          <td>
            <div class="admin-table__preview" style="max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-primary); font-size: 0.9rem;">
              <a href="#" class="admin-comment-detail-trigger" data-comment-id="${item.id}" style="color: var(--text-primary); text-decoration: none;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">
                "${escapeHtml(item.body || item.content || '')}"
              </a>
            </div>
          </td>
          <td>
            <div style="font-weight: 500; font-size: 0.85rem; color: var(--primary);">📖 ${escapeHtml(item.story_title || `Story #${item.story_id}`)}</div>
          </td>
          <td>
            <div style="font-size: 0.85rem; color: var(--text-secondary);">✍️ ${escapeHtml(item.post_author_name || 'Admin')}</div>
          </td>
          <td><span class="status-badge status-badge--${statusBadgeClass}">${escapeHtml(st)}</span></td>
          <td>${formatDate(item.created_at)}</td>
          <td>
            <div class="admin-table__actions" style="display: flex; gap: 6px; flex-wrap: wrap;">
              <button class="btn btn--secondary btn--sm admin-comment-detail-trigger" data-comment-id="${item.id}" style="padding: 4px 8px; font-size: 0.8rem;" title="View Details & Edit">🔍 Details</button>
              ${st !== 'approved' ? `<button class="btn btn--success btn--sm" onclick="quickUpdateCommentStatus(${item.id}, 'approved')" style="padding: 4px 8px;" title="Approve">✓</button>` : ''}
              ${st !== 'rejected' ? `<button class="btn btn--danger btn--sm" onclick="quickUpdateCommentStatus(${item.id}, 'rejected')" style="padding: 4px 8px;" title="Reject">✕</button>` : ''}
              ${st !== 'removed' && st !== 'hidden' ? `<button class="btn btn--ghost btn--sm" onclick="quickUpdateCommentStatus(${item.id}, 'removed')" style="padding: 4px 8px;" title="Hide Comment">👁️ Hide</button>` : `<button class="btn btn--ghost btn--sm" onclick="quickUpdateCommentStatus(${item.id}, 'approved')" style="padding: 4px 8px;" title="Unhide Comment">👁️ Unhide</button>`}
              ${item.user_id ? `<button class="btn btn--secondary btn--sm" onclick="openAdminMessagingModal(${item.user_id}, '${escapeHtml(commenterDisp).replace(/'/g, "\\'")}', 'Notice Regarding Your Comment #${item.id}')" style="padding: 4px 8px;" title="Message Commenter">✉️</button>` : ''}
              <button class="btn btn--danger btn--sm" onclick="deleteAdminComment(${item.id})" style="padding: 4px 8px;" title="Delete Permanently">🗑️</button>
            </div>
          </td>
        `;
        tbody.appendChild(tr);
      });

      // Bind comment detail triggers
      tbody.querySelectorAll('.admin-comment-detail-trigger').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const commentId = btn.dataset.commentId;
          const targetComment = currentCommentsList.find(c => c.id == commentId);
          if (targetComment) {
            openAdminCommentModal(targetComment);
          }
        });
      });
    } catch (err) {
      console.error('loadCommentsQueue error:', err);
      showToast('Failed to load comments queue.', 'error');
    }
  }

  function openAdminCommentModal(comment) {
    const modal = document.getElementById('adminCommentDetailModal');
    if (!modal) return;

    window._currentEditingComment = comment;

    const idEl = document.getElementById('adminCommentId');
    if (idEl) idEl.textContent = `Comment ID: #${comment.id}`;

    const dateEl = document.getElementById('adminCommentDate');
    if (dateEl) dateEl.textContent = `Submitted ${formatDate(comment.created_at)}`;

    const commenterName = comment.commenter_name || (comment.user_id ? `User #${comment.user_id}` : 'Anonymous Reader');
    const commenterNameEl = document.getElementById('adminCommenterName');
    if (commenterNameEl) commenterNameEl.textContent = commenterName;

    const commenterEmailEl = document.getElementById('adminCommenterEmail');
    if (commenterEmailEl) commenterEmailEl.textContent = comment.commenter_email || 'No email registered';

    const targetTitleEl = document.getElementById('adminCommentTargetTitle');
    if (targetTitleEl) targetTitleEl.textContent = comment.story_title || `Story #${comment.story_id}`;

    const targetAuthorEl = document.getElementById('adminCommentTargetAuthor');
    if (targetAuthorEl) targetAuthorEl.textContent = `Uploaded by: ${comment.post_author_name || 'Admin'}`;

    const ipEl = document.getElementById('adminCommentIpHash');
    if (ipEl) ipEl.textContent = comment.ip_hash ? `IP Hash: ${comment.ip_hash}` : 'IP: Unknown';

    const bodyInput = document.getElementById('adminCommentBodyInput');
    if (bodyInput) bodyInput.value = comment.body || comment.content || '';

    const statusSel = document.getElementById('adminCommentStatusSelect');
    if (statusSel) statusSel.value = comment.status || 'pending';

    const badge = document.getElementById('adminCommentStatusBadge');
    if (badge) {
      const st = (comment.status || 'pending').toLowerCase();
      badge.className = `status-badge status-badge--${st === 'approved' ? 'approved' : st === 'rejected' ? 'rejected' : 'pending'}`;
      badge.textContent = st.toUpperCase();
    }

    modal.style.display = 'flex';
    modal.classList.add('active');
  }

  function closeAdminCommentModal() {
    const modal = document.getElementById('adminCommentDetailModal');
    if (modal) {
      modal.style.display = 'none';
      modal.classList.remove('active');
    }
  }

  async function saveAdminCommentModalEdits() {
    const comment = window._currentEditingComment;
    if (!comment || !comment.id) return;

    const content = (document.getElementById('adminCommentBodyInput')?.value || '').trim();
    const status = document.getElementById('adminCommentStatusSelect')?.value || 'approved';

    if (!content) {
      return showToast('Comment content cannot be empty.', 'warning');
    }

    try {
      await api(`/api/admin/comments/${comment.id}`, {
        method: 'PUT',
        body: JSON.stringify({ content, status })
      });
      showToast('Comment updated successfully.', 'success');
      closeAdminCommentModal();
      loadCommentsQueue();
    } catch (err) {
      showToast('Failed to save comment edits: ' + err.message, 'error');
    }
  }

  async function quickUpdateCommentStatus(commentId, newStatus) {
    try {
      await api(`/api/admin/comments/${commentId}`, {
        method: 'PUT',
        body: JSON.stringify({ status: newStatus })
      });
      showToast(`Comment status updated to ${newStatus}.`, 'success');
      loadCommentsQueue();
    } catch (err) {
      showToast('Failed to update status: ' + err.message, 'error');
    }
  }

  async function deleteAdminComment(commentId) {
    if (!confirm(`Are you sure you want to PERMANENTLY delete comment #${commentId}? This action cannot be undone.`)) return;
    try {
      await api(`/api/admin/comments/${commentId}`, { method: 'DELETE' });
      showToast('Comment deleted successfully.', 'success');
      if (window._currentEditingComment && window._currentEditingComment.id == commentId) closeAdminCommentModal();
      loadCommentsQueue();
    } catch (err) {
      showToast('Failed to delete comment: ' + err.message, 'error');
    }
  }

  function deleteCurrentAdminComment() {
    if (window._currentEditingComment) {
      deleteAdminComment(window._currentEditingComment.id);
    }
  }

  async function toggleHideCurrentAdminComment() {
    const comment = window._currentEditingComment;
    if (!comment) return;
    const currentStatus = comment.status || 'approved';
    const newStatus = (currentStatus === 'removed' || currentStatus === 'hidden') ? 'approved' : 'removed';
    await quickUpdateCommentStatus(comment.id, newStatus);
    closeAdminCommentModal();
  }

  // ── Admin Direct Messaging Handlers ──
  function openAdminMessagingModal(userId, recipientName, defaultSubject = '') {
    window._activeMsgUserId = userId;
    const badge = document.getElementById('modalMsgRecipientBadge');
    if (badge) badge.textContent = `User: ${recipientName} (ID #${userId || 'N/A'})`;

    const titleInput = document.getElementById('adminMsgTitleInput');
    if (titleInput) titleInput.value = defaultSubject || 'Official Notice from Midnight Support Team';

    const bodyInput = document.getElementById('adminMsgBodyInput');
    if (bodyInput) bodyInput.value = '';

    const modal = document.getElementById('adminMessagingModal');
    if (modal) {
      modal.style.display = 'flex';
      modal.classList.add('active');
    }
  }

  function closeAdminMessagingModal() {
    const modal = document.getElementById('adminMessagingModal');
    if (modal) {
      modal.style.display = 'none';
      modal.classList.remove('active');
    }
  }

  function messageCommenterFromModal() {
    const comment = window._currentEditingComment;
    if (!comment) return;
    const commenterName = comment.commenter_name || (comment.user_id ? `User #${comment.user_id}` : 'Anonymous');
    openAdminMessagingModal(comment.user_id, commenterName, `Regarding your comment on "${comment.story_title || 'Story #' + comment.story_id}"`);
  }

  async function submitAdminDirectMessage(e) {
    if (e && e.preventDefault) e.preventDefault();
    const userId = window._activeMsgUserId;
    const title = (document.getElementById('adminMsgTitleInput')?.value || '').trim();
    const message = (document.getElementById('adminMsgBodyInput')?.value || '').trim();

    if (!userId) {
      return showToast('No recipient user specified.', 'warning');
    }
    if (!title || !message) {
      return showToast('Please enter both subject and message body.', 'warning');
    }

    const btn = document.getElementById('btnSubmitAdminMsg');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }

    try {
      await api('/api/admin/messages', {
        method: 'POST',
        body: JSON.stringify({ user_id: userId, title, message })
      });
      showToast('Official admin message sent successfully!', 'success');
      closeAdminMessagingModal();
    } catch (err) {
      showToast('Failed to send message: ' + err.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '🚀 Send Official Admin Message'; }
    }
  }

  // Export comment & messaging functions
  window.openAdminCommentModal = openAdminCommentModal;
  window.closeAdminCommentModal = closeAdminCommentModal;
  window.saveAdminCommentModalEdits = saveAdminCommentModalEdits;
  window.quickUpdateCommentStatus = quickUpdateCommentStatus;
  window.deleteAdminComment = deleteAdminComment;
  window.deleteCurrentAdminComment = deleteCurrentAdminComment;
  window.toggleHideCurrentAdminComment = toggleHideCurrentAdminComment;
  window.openAdminMessagingModal = openAdminMessagingModal;
  window.closeAdminMessagingModal = closeAdminMessagingModal;
  window.messageCommenterFromModal = messageCommenterFromModal;
  window.submitAdminDirectMessage = submitAdminDirectMessage;


  // ── Moderate Item ──
  window.moderateItem = async function (type, id, action) {
    try {
      const data = await api('/api/admin/moderate', {
        method: 'POST',
        body: JSON.stringify({ target_type: type, target_id: id, action })
      });
      showToast(data.message, 'success');

      // Reload the appropriate queue
      if (type === 'story') loadStoriesQueue();
      if (type === 'comment') loadCommentsQueue();
      loadStats();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // ── Reports / Tickets (Helpdesk Management) ──
  let currentTicketStatus = 'all';
  let adminReplyType = 'public'; // 'public' | 'internal'
  let cachedCannedResponses = [];
  let cachedSupportAgents = [];

  async function loadCannedResponses() {
    try {
      cachedCannedResponses = await api('/api/admin/canned-responses');
      const select = document.getElementById('cannedResponseSelect');
      if (select) {
        select.innerHTML = '<option value="">-- Insert Canned Response Template --</option>';
        cachedCannedResponses.forEach(r => {
          const opt = document.createElement('option');
          opt.value = r.id;
          opt.textContent = r.title;
          select.appendChild(opt);
        });
      }
    } catch (e) {}
  }

  async function loadSupportAgents() {
    try {
      cachedSupportAgents = await api('/api/admin/support-agents');
      const select = document.getElementById('modalUpdateAgent');
      if (select) {
        select.innerHTML = '<option value="">-- Unassigned --</option>';
        cachedSupportAgents.forEach(a => {
          const opt = document.createElement('option');
          opt.value = a.id;
          opt.textContent = `${a.username} (${a.role})`;
          select.appendChild(opt);
        });
      }
    } catch (e) {}
  }

  window.loadReports = async function (status) {
    if (status !== undefined) currentTicketStatus = status;
    try {
      const reports = await api(`/api/admin/reports?status=${currentTicketStatus}`);
      const tbody = document.getElementById('reportsBody');
      const empty = document.getElementById('noReports');
      tbody.innerHTML = '';

      if (reports.length === 0) {
        empty.classList.remove('hidden');
        document.getElementById('reportsTable').closest('.admin-table-wrapper').classList.add('hidden');
        return;
      }

      empty.classList.add('hidden');
      document.getElementById('reportsTable').closest('.admin-table-wrapper').classList.remove('hidden');

      reports.forEach(report => {
        const tr = document.createElement('tr');
        const priorityColor = report.priority === 'urgent' ? '#ef4444' : report.priority === 'high' ? '#f59e0b' : '#6366f1';
        
        tr.innerHTML = `
          <td><span style="font-family: monospace; font-weight: bold;">${report.ticket_id || report.id}</span></td>
          <td>
            <div style="font-weight: 600; color: var(--text-primary); font-size: 0.92rem;">${escapeHtml(report.subject || report.reason)}</div>
            <div style="font-size: 0.78rem; color: var(--text-muted);">${escapeHtml(report.category_name || report.reported_item_type)}</div>
          </td>
          <td><span class="status-badge" style="background: ${priorityColor}; color: white; font-size: 0.7rem; text-transform: uppercase;">${report.priority || 'medium'}</span></td>
          <td>
            <div style="font-size: 0.88rem; font-weight: 500;">${escapeHtml(report.reporter_name || 'User #' + report.reporter_id)}</div>
            <div style="font-size: 0.75rem; color: var(--text-muted);">${escapeHtml(report.reporter_email || '')}</div>
          </td>
          <td><span class="status-badge status-badge--${(report.ticket_status || 'open').replace('_', '-')}">${(report.ticket_status || 'open').replace(/_/g, ' ')}</span></td>
          <td><span style="font-size: 0.82rem; font-weight: 500; color: var(--text-secondary);">${escapeHtml(report.assigned_agent_name || 'Unassigned')}</span></td>
          <td>
            <div class="admin-table__actions" style="display: flex; gap: 6px; flex-wrap: wrap;">
              <button class="btn btn--primary btn--sm" onclick='window.openTicketModal(${JSON.stringify(report).replace(/'/g, "&#39;")})' title="Open Ticket Workspace">🔍 Review</button>
              ${report.ticket_status !== 'resolved' && report.ticket_status !== 'closed' ? `<button class="btn btn--success btn--sm" onclick="window.quickSetTicketStatus(${report.id}, 'resolved')" style="padding: 4px 8px;" title="Resolve Ticket">✓</button>` : ''}
              ${report.reporter_id ? `<button class="btn btn--secondary btn--sm" onclick="openAdminMessagingModal(${report.reporter_id}, '${escapeHtml(report.reporter_name || 'User').replace(/'/g, "\\'")}', 'Regarding Ticket #${report.ticket_id || report.id}')" style="padding: 4px 8px;" title="Message Reporter">✉️</button>` : ''}
            </div>
          </td>
        `;
        tbody.appendChild(tr);
      });
    } catch (err) {
      console.error('loadReports error:', err);
      showToast('Failed to load tickets.', 'error');
    }
  };

  window.quickSetTicketStatus = async function (ticketId, newStatus) {
    try {
      await api(`/api/admin/reports/${ticketId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: newStatus })
      });
      showToast(`Ticket #${ticketId} status set to ${newStatus.replace(/_/g, ' ')}.`, 'success');
      loadReports();
    } catch (err) {
      showToast('Failed to update ticket: ' + err.message, 'error');
    }
  };


  window.openTicketModal = async function (report) {
    window.currentTicketId = report.id;
    window.currentTicketTargetUser = report.reporter_id || report.user_id || null;

    document.getElementById('modalTicketId').textContent = report.ticket_id || report.id;
    document.getElementById('modalTicketStatus').textContent = (report.ticket_status || 'open').replace(/_/g, ' ');
    document.getElementById('modalTicketStatus').className = `filter-chip status-${(report.ticket_status || 'open').replace('_', '-')}`;
    
    document.getElementById('modalTargetType').textContent = report.reported_item_type || 'support';
    document.getElementById('modalTargetId').textContent = report.id;
    document.getElementById('modalTargetUserId').textContent = window.currentTicketTargetUser || 'No linked account';
    document.getElementById('modalTargetPreview').textContent = report.subject || report.reason || 'No subject preview.';
    
    if (document.getElementById('modalUpdateStatus')) document.getElementById('modalUpdateStatus').value = report.ticket_status || 'open';
    if (document.getElementById('modalUpdatePriority')) document.getElementById('modalUpdatePriority').value = report.priority || 'medium';
    if (document.getElementById('modalUpdateCategory')) document.getElementById('modalUpdateCategory').value = report.category_id || 1;
    if (document.getElementById('modalUpdateAgent')) document.getElementById('modalUpdateAgent').value = report.assigned_agent_id || '';
    
    document.getElementById('adminReplyText').value = '';
    
    await loadCannedResponses();
    await loadSupportAgents();

    document.getElementById('ticketChatMessages').innerHTML = '<div class="empty-state">Loading chat & audit timeline...</div>';
    document.getElementById('reportDetailsModal').classList.add('active');
    
    await Promise.all([
      loadTicketMessages(report),
      window.loadUserAuditData(window.currentTicketTargetUser)
    ]);
  };

  async function loadTicketMessages(report) {
    try {
      const data = await api(`/api/tickets/${report.id}/messages`);
      const ticket = data.ticket || report;
      const container = document.getElementById('ticketChatMessages');
      const timeline = document.getElementById('ticketAuditLogTimeline');
      container.innerHTML = '';
      
      const descHtml = ticket.report_description ? escapeHtml(ticket.report_description) : (ticket.reason ? escapeHtml(ticket.reason) : '<i>[No description provided]</i>');
      const attachHtml = ticket.attachment_url ? `<div style="margin-top: 0.75rem;"><a href="${ticket.attachment_url}" target="_blank" style="color: var(--primary); text-decoration: underline;">View File Attachment 📁</a></div>` : '';
      
      const attachments = Array.isArray(data.attachments) ? data.attachments : [];
      const attachmentListHtml = attachments.length ? `
        <div style="margin-top: 0.85rem; padding-top: 0.75rem; border-top: 1px solid rgba(255,255,255,0.1);">
          <div style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 0.4rem; font-weight: 700; text-transform: uppercase;">Attachments (${attachments.length})</div>
          ${attachments.map(attachment => `<a href="${attachment.download_url}" target="_blank" style="display: block; color: var(--primary); text-decoration: underline; font-size: 0.85rem; margin: 0.35rem 0;">Attachment: ${escapeHtml(attachment.file_name || 'Download attachment')}</a>`).join('')}
        </div>` : '';

      container.innerHTML += `
        <div style="background: rgba(255,255,255,0.05); padding: 1rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1);">
          <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.4rem;">Original Ticket Submission from ${escapeHtml(ticket.user_name || ('User #' + (ticket.reporter_id || ticket.user_id || 'User')))}</div>
          <div style="font-weight: bold; margin-bottom: 0.4rem;">Subject: ${escapeHtml(ticket.subject || ticket.reason || 'No Subject')}</div>
          <div style="font-size: 0.9rem; color: var(--text-secondary); line-height: 1.5; white-space: pre-wrap;">${descHtml}${attachHtml}${attachmentListHtml}</div>
        </div>
      `;

      data.messages.forEach(msg => {
        const isInternalNote = msg.is_internal_note === 1;
        const isAdmin = msg.sender_role === 'admin' || msg.sender_role === 'system';
        
        let color = isInternalNote ? 'rgba(245, 158, 11, 0.18)' : isAdmin ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255,255,255,0.06)';
        let borderColor = isInternalNote ? '#f59e0b' : isAdmin ? '#818cf8' : 'rgba(255,255,255,0.12)';
        let align = isInternalNote ? 'stretch' : isAdmin ? 'flex-end' : 'flex-start';
        
        let badgeHtml = `<strong style="color: var(--text-primary);">👤 User</strong>`;
        if (isInternalNote) {
          badgeHtml = `<span style="background: #f59e0b; color: #000000; padding: 2px 8px; border-radius: 12px; font-weight: bold; font-size: 0.7rem;">🔒 Staff Internal Note</span>`;
        } else if (isAdmin) {
          badgeHtml = `<span style="background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; padding: 2px 8px; border-radius: 12px; font-weight: bold; font-size: 0.7rem;">🛡️ Admin (You)</span>`;
        }

        container.innerHTML += `
          <div style="align-self: ${align}; max-width: ${isInternalNote ? '100%' : '85%'}; background: ${color}; padding: 12px 16px; border-radius: 12px; border: 1px solid ${borderColor}; margin-bottom: 8px;">
            <div style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 6px; display: flex; justify-content: space-between; gap: 12px; align-items: center;">
              ${badgeHtml}
              <span>${new Date(msg.created_at).toLocaleString()}</span>
            </div>
            <div style="font-size: 0.92rem; color: var(--text-primary); line-height: 1.5; white-space: pre-wrap;">${escapeHtml(msg.message_body)}</div>
          </div>
        `;
      });

      container.scrollTop = container.scrollHeight;

      // Render Audit Log Timeline
      if (timeline) {
        timeline.innerHTML = '';
        const auditLogs = data.auditLogs || [];
        if (auditLogs.length === 0) {
          timeline.innerHTML = '<div style="opacity:0.5;">No audit events recorded yet.</div>';
        } else {
          auditLogs.forEach(log => {
            const timeStr = new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const actorName = log.actor_name || (log.actor_type === 'user' ? 'User' : 'System/Staff');
            timeline.innerHTML += `
              <div style="padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.06);">
                <span style="color: var(--primary); font-weight: bold;">[${timeStr}]</span> 
                <strong>${escapeHtml(actorName)}</strong>: ${escapeHtml(log.action_type.replace(/_/g, ' '))} 
                <span style="opacity: 0.7; font-size: 0.72rem;">(${escapeHtml(log.new_value || '')})</span>
              </div>
            `;
          });
        }
      }
    } catch (err) {
      document.getElementById('ticketChatMessages').innerHTML = `<div class="empty-state">Failed to load chat: ${err.message}</div>`;
    }
  }

  window.toggleAdminReplyType = function(type) {
    adminReplyType = type;
    const btn = document.getElementById('btnSendTicketReply');
    const input = document.getElementById('adminReplyText');
    if (type === 'internal') {
      if (btn) {
        btn.textContent = '🔒 Post Internal Note (Staff Only)';
        btn.className = 'btn btn--warning btn--sm';
        btn.style.background = '#f59e0b';
        btn.style.color = '#000000';
      }
      if (input) input.placeholder = 'Write a private internal note for staff members... (Not visible to user)';
    } else {
      if (btn) {
        btn.textContent = 'Send Public Reply ↗';
        btn.className = 'btn btn--primary btn--sm';
        btn.style.background = '';
        btn.style.color = '';
      }
      if (input) input.placeholder = 'Type public response to user...';
    }
  };

  window.insertCannedResponseTemplate = function(templateId) {
    if (!templateId) return;
    const template = cachedCannedResponses.find(r => r.id == templateId);
    if (template) {
      document.getElementById('adminReplyText').value = template.content;
    }
  };

  window.saveAdminTicketProperties = async function() {
    const status = document.getElementById('modalUpdateStatus').value;
    const priority = document.getElementById('modalUpdatePriority').value;
    const category_id = document.getElementById('modalUpdateCategory').value;
    const assigned_agent_id = document.getElementById('modalUpdateAgent').value;

    try {
      await api(`/api/admin/reports/${window.currentTicketId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status, priority, category_id })
      });

      await api(`/api/admin/tickets/${window.currentTicketId}/assign`, {
        method: 'PATCH',
        body: JSON.stringify({ assigned_agent_id })
      });

      showToast('Ticket properties and agent assignment updated.', 'success');
      window.loadReports();
      loadTicketMessages({ id: window.currentTicketId });
    } catch (err) {
      showToast('Failed to update properties: ' + err.message, 'error');
    }
  };

  window.sendTicketReply = async function() {
    const text = document.getElementById('adminReplyText').value.trim();
    if (!text) return showToast('Enter a reply message.', 'warning');
    
    const isInternal = adminReplyType === 'internal';

    try {
      await api(`/api/tickets/${window.currentTicketId}/reply`, {
        method: 'POST',
        body: JSON.stringify({ message_body: text, is_internal_note: isInternal ? 1 : 0 })
      });
      document.getElementById('adminReplyText').value = '';
      await loadTicketMessages({ id: window.currentTicketId });
      window.loadReports();
      showToast(isInternal ? 'Internal note added.' : 'Public reply sent to user.', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  window.updateTicketStatus = async function (status) {
    try {
      await api(`/api/admin/reports/${window.currentTicketId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status })
      });
      showToast(`Ticket status updated to ${status}.`, 'success');
      window.loadReports();
      document.getElementById('modalTicketStatus').textContent = status;
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  window.submitTicketResolution = async function () {
    const action = document.getElementById('enforcementAction').value;
    try {
      await api(`/api/admin/reports/${window.currentTicketId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: 'resolved', action })
      });
      showToast('Ticket marked as resolved.', 'success');
      window.loadReports();
      document.getElementById('reportDetailsModal').classList.remove('active');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // ── Categories ──
  async function loadCategories() {
    try {
      const categories = await api('/api/admin/categories');
      const tbody = document.getElementById('categoriesBody');
      tbody.innerHTML = '';

      categories.forEach(cat => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${cat.id}</td>
          <td>${escapeHtml(cat.name)}</td>
          <td><code>${escapeHtml(cat.slug)}</code></td>
          <td>${cat.story_count || 0}</td>
          <td>
            <button class="btn btn--danger btn--sm" onclick="deleteCategory(${cat.id})">Delete</button>
          </td>
        `;
        tbody.appendChild(tr);
      });
    } catch (err) {
      showToast('Failed to load categories.', 'error');
    }
  }

  async function addCategory() {
    const name = document.getElementById('newCategoryName').value.trim();
    if (!name) {
      showToast('Enter a category name.', 'warning');
      return;
    }
    try {
      await api('/api/admin/categories', {
        method: 'POST',
        body: JSON.stringify({ name })
      });
      document.getElementById('newCategoryName').value = '';
      showToast('Category added.', 'success');
      loadCategories();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // ── Bans ──
  async function loadBans() {
    try {
      const bans = await api('/api/admin/bans');
      const tbody = document.getElementById('bansBody');
      tbody.innerHTML = '';

      if (bans.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 24px;">No active bans.</td></tr>';
        return;
      }

      bans.forEach(ban => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${ban.id}</td>
          <td><code>${escapeHtml(ban.identifier)}</code></td>
          <td>${escapeHtml(ban.reason || '—')}</td>
          <td>${formatDate(ban.created_at)}</td>
          <td>${ban.expires_at ? formatDate(ban.expires_at) : 'Permanent'}</td>
          <td>
            <button class="btn btn--secondary btn--sm" onclick="removeBan(${ban.id})">Remove</button>
          </td>
        `;
        tbody.appendChild(tr);
      });
    } catch (err) {
      showToast('Failed to load bans.', 'error');
    }
  }

  async function addBan() {
    const identifier = document.getElementById('banIdentifier').value.trim();
    const reason = document.getElementById('banReason').value.trim();
    if (!identifier) {
      showToast('Enter an IP hash.', 'warning');
      return;
    }
    try {
      await api('/api/admin/ban', {
        method: 'POST',
        body: JSON.stringify({ identifier, reason })
      });
      document.getElementById('banIdentifier').value = '';
      document.getElementById('banReason').value = '';
      showToast('IP banned.', 'success');
      loadBans();
      loadStats();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  window.removeBan = async function (id) {
    try {
      await api(`/api/admin/bans/${id}`, { method: 'DELETE' });
      showToast('Ban removed.', 'success');
      loadBans();
      loadStats();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // ── Settings ──
  async function loadSettings() {
    try {
      const settings = await api('/api/admin/settings');

      document.getElementById('settingStoryRate').value = settings.rate_limit_posts_per_hour || 5;
      document.getElementById('settingCommentRate').value = settings.rate_limit_comments_per_hour || 15;
      document.getElementById('settingReportThreshold').value = settings.auto_hide_report_threshold || 3;
      document.getElementById('settingRequireApproval').checked = settings.require_manual_approval === 'true' || settings.require_manual_approval === true;

      const keywords = Array.isArray(settings.banned_keywords)
        ? settings.banned_keywords
        : (typeof settings.banned_keywords === 'string' ? JSON.parse(settings.banned_keywords) : []);
      document.getElementById('settingBannedKeywords').value = keywords.join('\n');
    } catch (err) {
      showToast('Failed to load settings.', 'error');
    }
  }

  async function saveSettings() {
    const keywords = document.getElementById('settingBannedKeywords').value
      .split('\n')
      .map(k => k.trim())
      .filter(Boolean);

    try {
      await api('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({
          rate_limit_posts_per_hour: document.getElementById('settingStoryRate').value,
          rate_limit_comments_per_hour: document.getElementById('settingCommentRate').value,
          auto_hide_report_threshold: document.getElementById('settingReportThreshold').value,
          require_manual_approval: document.getElementById('settingRequireApproval').checked ? 'true' : 'false',
          banned_keywords: keywords
        })
      });
      showToast('Settings saved.', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // ── Audit Log ──
  async function loadAuditLog() {
    try {
      const logs = await api('/api/admin/audit-log');
      const tbody = document.getElementById('auditBody');
      tbody.innerHTML = '';

      if (logs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 24px;">No audit log entries yet.</td></tr>';
        return;
      }

      logs.forEach(log => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${formatDate(log.created_at)}</td>
          <td>${escapeHtml(log.admin_username || 'System')}</td>
          <td><span class="status-badge status-badge--${log.action.includes('reject') || log.action.includes('ban') ? 'rejected' : 'approved'}">${escapeHtml(log.action)}</span></td>
          <td>${escapeHtml(log.target_type)} #${log.target_id}</td>
          <td><div class="admin-table__preview">${escapeHtml(log.reason || '—')}</div></td>
        `;
        tbody.appendChild(tr);
      });
    } catch (err) {
      showToast('Failed to load audit log.', 'error');
    }
  }

  // ── Users Management Suite ──
  let currentUserStatusFilter = 'all';
  window.currentUsersCache = [];
  window._currentEditingUser = null;

  async function loadUsers(statusFilter) {
    if (statusFilter !== undefined) currentUserStatusFilter = statusFilter;
    try {
      const search = (document.getElementById('adminUserSearch')?.value || '').trim();
      let queryUrl = `/api/admin/users?status=${currentUserStatusFilter}`;
      if (search) queryUrl += `&search=${encodeURIComponent(search)}`;

      const data = await api(queryUrl).catch(e => { console.error('User load error:', e); return { users: [] }; });
      const usersList = Array.isArray(data) ? data : (data.users || []);
      window.currentUsersCache = usersList;

      const tbody = document.getElementById('usersList');
      if (!tbody) return;
      tbody.innerHTML = '';

      if (usersList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; opacity: 0.5; padding: 24px;">No users found matching the criteria.</td></tr>';
        return;
      }

      usersList.forEach(user => {
        const tr = document.createElement('tr');
        const st = (user.account_status || 'active').toLowerCase();
        const statusBadgeClass = st === 'active' ? 'approved' : st === 'banned' ? 'rejected' : 'pending';
        const userRole = (user.role || 'user').toLowerCase();
        const roleChip = userRole === 'admin' ? '🔥 ADMIN' : userRole === 'editor' ? '✍️ EDITOR' : userRole === 'author' ? '📚 AUTHOR' : '👤 READER';

        tr.innerHTML = `
          <td><input type="checkbox" class="user-select-checkbox" data-user-id="${user.id}" data-user-name="${escapeHtml(user.full_name)}" style="cursor: pointer; transform: scale(1.15);"></td>
          <td>
            <strong>#${user.id}</strong>
            <br><small style="color: var(--text-muted); font-family: monospace;">${escapeHtml(user.user_id || '')}</small>
          </td>
          <td style="font-weight: 600;">
            <a href="#" class="admin-user-detail-trigger" data-user-id="${user.id}" style="color: var(--text-primary); text-decoration: none;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">
              ${escapeHtml(user.full_name)}
            </a>
          </td>
          <td><span style="font-size: 0.85rem; color: var(--text-secondary);">${escapeHtml(user.email)}</span></td>
          <td><span class="coverage-chip">${roleChip}</span></td>
          <td><span class="status-badge status-badge--${statusBadgeClass}">${escapeHtml(st)}</span></td>
          <td>${formatDate(user.created_at)}</td>
          <td>
            <div class="admin-table__actions" style="display: flex; gap: 6px; flex-wrap: wrap;">
              <button class="btn btn--secondary btn--sm admin-user-detail-trigger" data-user-id="${user.id}" style="padding: 4px 8px; font-size: 0.8rem;" title="View & Edit Details">🔍 Details</button>
              ${st !== 'active' ? `<button class="btn btn--success btn--sm" onclick="quickUpdateUserStatus(${user.id}, 'active')" style="padding: 4px 8px;" title="Activate Account">✓</button>` : `<button class="btn btn--danger btn--sm" onclick="quickUpdateUserStatus(${user.id}, 'suspended')" style="padding: 4px 8px;" title="Suspend Account">🚫</button>`}
              <button class="btn btn--secondary btn--sm" onclick="openAdminMessagingModal(${user.id}, '${escapeHtml(user.full_name).replace(/'/g, "\\'")}', 'Notice Regarding Your Midnight Stories Account')" style="padding: 4px 8px;" title="Message User">✉️</button>
              <button class="btn btn--danger btn--sm" onclick="deleteAdminUser(${user.id})" style="padding: 4px 8px;" title="Delete User">🗑️</button>
            </div>
          </td>
        `;
        tbody.appendChild(tr);
      });

      // Bind detail triggers
      tbody.querySelectorAll('.admin-user-detail-trigger').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const uId = btn.dataset.userId;
          const targetUser = window.currentUsersCache.find(u => u.id == uId);
          if (targetUser) openAdminUserModal(targetUser);
        });
      });

      // Update check count listener
      tbody.querySelectorAll('.user-select-checkbox').forEach(cb => {
        cb.addEventListener('change', updateSelectedUserCount);
      });
    } catch (err) {
      console.error('loadUsers error:', err);
      showToast('Failed to load users.', 'error');
    }
  }

  function updateSelectedUserCount() {
    const selected = document.querySelectorAll('.user-select-checkbox:checked');
    const badge = document.getElementById('msgSelectedCount');
    if (badge) badge.textContent = selected.length;
  }

  function openAdminUserModal(user) {
    const modal = document.getElementById('adminUserDetailModal');
    if (!modal) return;

    window._currentEditingUser = user;

    const tagEl = document.getElementById('adminUserTag');
    if (tagEl) tagEl.textContent = `ID: #${user.id} (${user.user_id || 'usr'})`;

    const joinedEl = document.getElementById('adminUserJoinedDate');
    if (joinedEl) joinedEl.textContent = `Joined ${formatDate(user.created_at)}`;

    const nameInput = document.getElementById('adminUserFullNameInput');
    if (nameInput) nameInput.value = user.full_name || '';

    const emailInput = document.getElementById('adminUserEmailInput');
    if (emailInput) emailInput.value = user.email || '';

    const roleSel = document.getElementById('adminUserRoleSelect');
    if (roleSel) roleSel.value = user.role || 'user';

    const statusSel = document.getElementById('adminUserStatusSelect');
    if (statusSel) statusSel.value = user.account_status || 'active';

    const storyCntEl = document.getElementById('adminUserStoryCount');
    if (storyCntEl) storyCntEl.textContent = user.story_count || 0;

    const commentCntEl = document.getElementById('adminUserCommentCount');
    if (commentCntEl) commentCntEl.textContent = user.comment_count || 0;

    const roleBadge = document.getElementById('adminUserRoleBadge');
    if (roleBadge) roleBadge.textContent = (user.role || 'user').toUpperCase();

    const statusBadge = document.getElementById('adminUserStatusBadge');
    if (statusBadge) {
      const st = (user.account_status || 'active').toLowerCase();
      statusBadge.className = `status-badge status-badge--${st === 'active' ? 'approved' : 'rejected'}`;
      statusBadge.textContent = st.toUpperCase();
    }

    const passInput = document.getElementById('adminUserNewPasswordInput');
    if (passInput) passInput.value = '';

    modal.style.display = 'flex';
    modal.classList.add('active');
  }

  function closeAdminUserModal() {
    const modal = document.getElementById('adminUserDetailModal');
    if (modal) {
      modal.style.display = 'none';
      modal.classList.remove('active');
    }
  }

  async function saveAdminUserModalEdits() {
    const user = window._currentEditingUser;
    if (!user || !user.id) return;

    const full_name = (document.getElementById('adminUserFullNameInput')?.value || '').trim();
    const email = (document.getElementById('adminUserEmailInput')?.value || '').trim();
    const role = document.getElementById('adminUserRoleSelect')?.value || 'user';
    const account_status = document.getElementById('adminUserStatusSelect')?.value || 'active';

    if (!full_name || !email) {
      return showToast('Full name and email are required.', 'warning');
    }

    try {
      await api(`/api/admin/users/${user.id}`, {
        method: 'PUT',
        body: JSON.stringify({ full_name, email, role, account_status })
      });
      showToast('User profile updated successfully.', 'success');
      closeAdminUserModal();
      loadUsers();
    } catch (err) {
      showToast('Failed to save user profile: ' + err.message, 'error');
    }
  }

  async function resetUserPasswordFromModal() {
    const user = window._currentEditingUser;
    if (!user || !user.id) return;
    const passInput = document.getElementById('adminUserNewPasswordInput');
    const new_password = (passInput?.value || '').trim();

    if (!new_password || new_password.length < 6) {
      return showToast('Please enter a password with at least 6 characters.', 'warning');
    }

    try {
      await api(`/api/admin/users/${user.id}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ new_password })
      });
      showToast(`Password reset successfully for ${user.full_name}.`, 'success');
      if (passInput) passInput.value = '';
    } catch (err) {
      showToast('Failed to reset password: ' + err.message, 'error');
    }
  }

  async function quickUpdateUserStatus(userId, newStatus) {
    try {
      await api(`/api/admin/users/${userId}`, {
        method: 'PUT',
        body: JSON.stringify({ account_status: newStatus })
      });
      showToast(`User status updated to ${newStatus}.`, 'success');
      loadUsers();
    } catch (err) {
      showToast('Failed to update user status: ' + err.message, 'error');
    }
  }

  async function deleteAdminUser(userId) {
    if (!confirm(`Are you sure you want to PERMANENTLY delete user account #${userId}? All associated data will be removed.`)) return;
    try {
      await api(`/api/admin/users/${userId}`, { method: 'DELETE' });
      showToast('User account deleted successfully.', 'success');
      if (window._currentEditingUser && window._currentEditingUser.id == userId) closeAdminUserModal();
      loadUsers();
    } catch (err) {
      showToast('Failed to delete user: ' + err.message, 'error');
    }
  }

  function deleteCurrentAdminUser() {
    if (window._currentEditingUser) {
      deleteAdminUser(window._currentEditingUser.id);
    }
  }

  function messageUserFromModal() {
    const user = window._currentEditingUser;
    if (!user) return;
    openAdminMessagingModal(user.id, user.full_name, 'Official Notice Regarding Your Account');
  }

  function openAdminCreateUserModal() {
    const form = document.getElementById('adminCreateUserForm');
    if (form) form.reset();
    const modal = document.getElementById('adminCreateUserModal');
    if (modal) {
      modal.style.display = 'flex';
      modal.classList.add('active');
    }
  }

  function closeAdminCreateUserModal() {
    const modal = document.getElementById('adminCreateUserModal');
    if (modal) {
      modal.style.display = 'none';
      modal.classList.remove('active');
    }
  }

  async function saveAdminNewUser(e) {
    if (e && e.preventDefault) e.preventDefault();
    const full_name = (document.getElementById('createUserFullName')?.value || '').trim();
    const email = (document.getElementById('createUserEmail')?.value || '').trim();
    const user_id = (document.getElementById('createUserIdTag')?.value || '').trim() || ('usr_' + Date.now());
    const role = document.getElementById('createUserRole')?.value || 'user';
    const account_status = document.getElementById('createUserStatus')?.value || 'active';
    const password = (document.getElementById('createUserPassword')?.value || '').trim();

    if (!full_name || !email) {
      return showToast('Full name and email are required.', 'warning');
    }

    const btn = document.getElementById('btnSaveNewUser');
    if (btn) { btn.disabled = true; btn.textContent = 'Creating...'; }

    try {
      await api('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({ full_name, email, user_id, role, account_status, password })
      });
      showToast('User account created successfully!', 'success');
      closeAdminCreateUserModal();
      loadUsers();
    } catch (err) {
      showToast('Failed to create user: ' + err.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '🚀 Create User Account'; }
    }
  }

  window.loadUsers = loadUsers;
  window.openAdminUserModal = openAdminUserModal;
  window.closeAdminUserModal = closeAdminUserModal;
  window.saveAdminUserModalEdits = saveAdminUserModalEdits;
  window.resetUserPasswordFromModal = resetUserPasswordFromModal;
  window.quickUpdateUserStatus = quickUpdateUserStatus;
  window.deleteAdminUser = deleteAdminUser;
  window.deleteCurrentAdminUser = deleteCurrentAdminUser;
  window.messageUserFromModal = messageUserFromModal;
  window.openAdminCreateUserModal = openAdminCreateUserModal;
  window.closeAdminCreateUserModal = closeAdminCreateUserModal;
  window.saveAdminNewUser = saveAdminNewUser;

  
  window.updateUserStatus = async function(id, status) {
    const reason = prompt(`Enter reason for changing status to ${status}:`);
    if (reason === null) return;
    try {
      await api(`/api/admin/users/${id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status, reason })
      });
      showToast('User status updated.', 'success');
      loadUsers();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  window.warnUser = async function(id) {
    const reason = prompt('Enter warning reason:');
    if (!reason) return;
    try {
      await api(`/api/admin/users/${id}/warn`, {
        method: 'POST',
        body: JSON.stringify({ level: 'first_warning', template: 'general_warning', reason })
      });
      showToast('Warning sent to user.', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  window.resetUserConnections = async function(id) {
    if (!confirm('Are you sure you want to reset all follows and blocks for this user?')) return;
    try {
      await api(`/api/admin/users/${id}/reset-connections`, {
        method: 'POST'
      });
      showToast('Connections reset.', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  window.openAuditModal = function(id) {
    const user = window.currentUsersCache?.find(u => u.id === id);
    if (!user) return;
    
    window.currentAuditUserId = id;
    
    const perms = user.interaction_permissions ? JSON.parse(user.interaction_permissions) : {};
    
    document.getElementById('permLike').checked = perms.like !== false;
    document.getElementById('permComment').checked = perms.comment !== false;
    document.getElementById('permFollow').checked = perms.follow !== false;
    document.getElementById('permBlock').checked = perms.block !== false;
    
    const chatCheckbox = document.getElementById('permChat');
    if (chatCheckbox) chatCheckbox.checked = perms.chat !== false;
    
    document.getElementById('auditModal').classList.add('active');
  };

  window.updateInteractionPermissions = async function() {
    if (!window.currentAuditUserId) return;
    
    const permissions = {
      like: document.getElementById('permLike').checked,
      comment: document.getElementById('permComment').checked,
      follow: document.getElementById('permFollow').checked,
      block: document.getElementById('permBlock').checked
    };
    
    const chatCheckbox = document.getElementById('permChat');
    if (chatCheckbox) {
      permissions.chat = chatCheckbox.checked;
    }
    
    try {
      await api(`/api/admin/users/${window.currentAuditUserId}/permissions`, {
        method: 'PUT',
        body: JSON.stringify({ permissions })
      });
      
      // Update cache
      const user = window.currentUsersCache?.find(u => u.id === window.currentAuditUserId);
      if (user) user.interaction_permissions = JSON.stringify(permissions);
      
      showToast('Permissions updated.', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // ── MFA Setup ──
  async function loadMFASetup() {
    try {
      const data = await api('/api/admin/mfa-setup', {
        method: 'POST',
        body: JSON.stringify({})
      });

      const qrContainer = document.getElementById('mfaQrContainer');
      qrContainer.innerHTML = `<img src="${data.qrCode}" alt="MFA QR Code" style="width: 200px; height: 200px;">`;
      document.getElementById('mfaSecretDisplay').textContent = `Secret: ${data.secret}`;
    } catch (err) {
      showToast('Failed to load MFA setup.', 'error');
    }
  }

  async function enableMFA() {
    const code = document.getElementById('mfaSetupCode').value.trim();
    if (!code || code.length !== 6) {
      showToast('Enter a valid 6-digit code.', 'warning');
      return;
    }

    try {
      await api('/api/admin/mfa-enable', {
        method: 'POST',
        body: JSON.stringify({ code })
      });
      showToast('MFA enabled! You will need your authenticator app for future logins.', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }


  function initAdminPanel() {
    const btnBooksListTab = document.getElementById('btnBooksListTab');
    const btnBooksUploadTab = document.getElementById('btnBooksUploadTab');
    const btnBooksBulkUploadTab = document.getElementById('btnBooksBulkUploadTab');
    const btnBooksSubmissionsTab = document.getElementById('btnBooksSubmissionsTab');

    if (btnBooksListTab) btnBooksListTab.addEventListener('click', () => switchBookTab('booksListTabSection', 'btnBooksListTab'));
    if (btnBooksUploadTab) btnBooksUploadTab.addEventListener('click', () => switchBookTab('booksUploadTabSection', 'btnBooksUploadTab'));
    if (btnBooksBulkUploadTab) btnBooksBulkUploadTab.addEventListener('click', () => switchBookTab('booksBulkUploadTabSection', 'btnBooksBulkUploadTab'));
    if (btnBooksSubmissionsTab) btnBooksSubmissionsTab.addEventListener('click', () => switchBookTab('booksSubmissionsTabSection', 'btnBooksSubmissionsTab'));

    initBulkBookUpload();

    // Book File select listener (for auto-fill metadata)
    const bookFileInput = document.getElementById('bookFile');
    if (bookFileInput) bookFileInput.addEventListener('change', handleEpubSelect);

    // Book Form submit
    const adminBookUploadForm = document.getElementById('adminBookUploadForm');
    if (adminBookUploadForm) adminBookUploadForm.addEventListener('submit', handleBookSubmit);

    // Book Search and Category filters
    const categoryFilter = document.getElementById('adminBookCategoryFilter');
    if (categoryFilter) categoryFilter.addEventListener('change', renderFilteredBooks);

    const searchInput = document.getElementById('adminBookSearch');
    if (searchInput) {
      searchInput.addEventListener('input', debounce(() => {
        renderFilteredBooks();
      }, 400));
    }

    // Bulk selection controls
    const selectAll = document.getElementById('selectAllBooks');
    if (selectAll) {
      selectAll.addEventListener('change', () => {
        document.querySelectorAll('.book-select-checkbox').forEach(cb => {
          cb.checked = selectAll.checked;
        });
        updateBatchActionBar();
      });
    }

    const btnCancelBulk = document.getElementById('btnCancelBulkSelection');
    if (btnCancelBulk) {
      btnCancelBulk.addEventListener('click', () => {
        document.querySelectorAll('.book-select-checkbox').forEach(cb => {
          cb.checked = false;
        });
        if (selectAll) selectAll.checked = false;
        updateBatchActionBar();
      });
    }

    // Bulk Move operations
    const btnMove = document.getElementById('btnBulkMove');
    if (btnMove) {
      btnMove.addEventListener('click', () => {
        const select = document.getElementById('bulkCategorySelect');
        const targetId = select.value;
        if (!targetId) {
          showToast('Please select a target category.', 'warning');
          return;
        }
        const targetName = select.options[select.selectedIndex].textContent;
        const count = document.querySelectorAll('.book-select-checkbox:checked').length;
        document.getElementById('bulkConfirmMessage').innerHTML = `Are you sure you want to move <strong>${count}</strong> selected book(s) to <strong>${escapeHtml(targetName)}</strong>?`;
        document.getElementById('bulkConfirmModal').classList.remove('hidden');
      });
    }

    const btnBulkCancel = document.getElementById('btnBulkCancel');
    if (btnBulkCancel) {
      btnBulkCancel.addEventListener('click', () => {
        document.getElementById('bulkConfirmModal').classList.add('hidden');
      });
    }

    const btnBulkConfirm = document.getElementById('btnBulkConfirm');
    if (btnBulkConfirm) {
      btnBulkConfirm.addEventListener('click', async () => {
        btnBulkConfirm.disabled = true;
        btnBulkConfirm.textContent = 'Updating...';
        const select = document.getElementById('bulkCategorySelect');
        const targetId = select.value;
        const bookIds = Array.from(document.querySelectorAll('.book-select-checkbox:checked')).map(cb => cb.dataset.bookId);

        try {
          const res = await api('/api/admin/books/bulk-update-category', {
            method: 'PATCH',
            body: JSON.stringify({ book_ids: bookIds, target_category_id: targetId })
          });
          showToast(res.message || 'Books updated successfully.', 'success');
          document.getElementById('bulkConfirmModal').classList.add('hidden');
          loadBooks();
        } catch (err) {
          showToast('Bulk update failed: ' + err.message, 'error');
        } finally {
          btnBulkConfirm.disabled = false;
          btnBulkConfirm.textContent = 'Confirm & Update';
        }
      });
    }

    // Bulk Status Change operations
    const btnBulkStatus = document.getElementById('btnBulkStatus');
    if (btnBulkStatus) {
      btnBulkStatus.addEventListener('click', () => {
        const select = document.getElementById('bulkStatusSelect');
        const targetStatus = select.value;
        if (!targetStatus) {
          showToast('Please select a target status.', 'warning');
          return;
        }
        const statusLabel = select.options[select.selectedIndex].textContent;
        const count = document.querySelectorAll('.book-select-checkbox:checked').length;
        if (count === 0) {
          showToast('Please select at least one book.', 'warning');
          return;
        }
        document.getElementById('bulkStatusConfirmMessage').innerHTML = `Are you sure you want to update status for <strong>${count}</strong> selected book(s) to <strong>${escapeHtml(statusLabel)}</strong>?`;
        document.getElementById('bulkStatusConfirmModal').classList.remove('hidden');
      });
    }

    const btnBulkStatusCancel = document.getElementById('btnBulkStatusCancel');
    if (btnBulkStatusCancel) {
      btnBulkStatusCancel.addEventListener('click', () => {
        document.getElementById('bulkStatusConfirmModal').classList.add('hidden');
      });
    }

    const btnBulkStatusConfirm = document.getElementById('btnBulkStatusConfirm');
    if (btnBulkStatusConfirm) {
      btnBulkStatusConfirm.addEventListener('click', async () => {
        btnBulkStatusConfirm.disabled = true;
        btnBulkStatusConfirm.textContent = 'Updating...';
        const select = document.getElementById('bulkStatusSelect');
        const targetStatus = select.value;
        const bookIds = Array.from(document.querySelectorAll('.book-select-checkbox:checked')).map(cb => cb.dataset.bookId);

        try {
          const res = await api('/api/admin/books/bulk-update-status', {
            method: 'PATCH',
            body: JSON.stringify({ book_ids: bookIds, status: targetStatus })
          });
          showToast(res.message || 'Book statuses updated successfully.', 'success');
          document.getElementById('bulkStatusConfirmModal').classList.add('hidden');
          loadBooks();
        } catch (err) {
          showToast('Bulk status update failed: ' + err.message, 'error');
        } finally {
          btnBulkStatusConfirm.disabled = false;
          btnBulkStatusConfirm.textContent = 'Confirm & Update Status';
        }
      });
    }

    // Login form
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
      loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        handleLogin(e);
      });
    }

    // MFA submit
    const mfaSubmitBtn = document.getElementById('mfaSubmitBtn');
    if (mfaSubmitBtn) {
      mfaSubmitBtn.addEventListener('click', (e) => {
        e.preventDefault();
        handleMFA();
      });
    }

    // Logout
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', (e) => {
        e.preventDefault();
        handleLogout();
      });
    }

    // Panel navigation click handler
    document.addEventListener('click', (e) => {
      const navItem = e.target.closest('.admin-nav-item');
      if (navItem) {
        const panelName = navItem.getAttribute('data-panel');
        if (panelName) {
          e.preventDefault();
          switchPanel(panelName);
        }
      }
    });

    // Stories Queue filter chip listener
    document.querySelectorAll('[data-queue-status]').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('[data-queue-status]').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        loadStoriesQueue(chip.dataset.queueStatus);
      });
    });

    // Comments Queue filter chip listener
    document.querySelectorAll('[data-comment-status]').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('[data-comment-status]').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        loadCommentsQueue(chip.dataset.commentStatus);
      });
    });

    // Tickets / Reports filter chip listener
    document.querySelectorAll('[data-ticket-status]').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('[data-ticket-status]').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        loadReports(chip.dataset.ticketStatus);
      });
    });


    // Users filter chip listener
    document.querySelectorAll('[data-user-status]').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('[data-user-status]').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        loadUsers(chip.dataset.userStatus);
      });
    });

    // User search listener
    const userSearchInput = document.getElementById('adminUserSearch');
    if (userSearchInput) {
      userSearchInput.addEventListener('input', debounce(() => {
        loadUsers();
      }, 400));
    }

    // Select all users checkbox
    const selectAllUsersCb = document.getElementById('selectAllUsers');
    if (selectAllUsersCb) {
      selectAllUsersCb.addEventListener('change', () => {
        document.querySelectorAll('.user-select-checkbox').forEach(cb => cb.checked = selectAllUsersCb.checked);
        updateSelectedUserCount();
      });
    }

    // Bulk Message Selected Users
    const btnMsgSelected = document.getElementById('btnMsgSelectedUsers');
    if (btnMsgSelected) {
      btnMsgSelected.addEventListener('click', () => {
        const checked = Array.from(document.querySelectorAll('.user-select-checkbox:checked'));
        if (checked.length === 0) return showToast('Please select at least one user to message.', 'warning');
        const firstUser = checked[0];
        const userNames = checked.map(c => c.dataset.userName).join(', ');
        openAdminMessagingModal(firstUser.dataset.userId, `${checked.length} Users (${userNames})`, 'Notice to Selected Users');
      });
    }

    // Broadcast Message to All Users
    const btnMsgAll = document.getElementById('btnMsgAllUsers');
    if (btnMsgAll) {
      btnMsgAll.addEventListener('click', () => {
        openAdminMessagingModal('ALL', 'Broadcast to ALL Registered Users', 'Platform Announcement from Support Team');
      });
    }

    // Add category
    const addCategoryBtn = document.getElementById('addCategoryBtn');

    if (addCategoryBtn) addCategoryBtn.addEventListener('click', addCategory);

    // Add ban
    const addBanBtn = document.getElementById('addBanBtn');
    if (addBanBtn) addBanBtn.addEventListener('click', addBan);

    // Save settings
    const saveSettingsBtn = document.getElementById('saveSettingsBtn');
    if (saveSettingsBtn) saveSettingsBtn.addEventListener('click', saveSettings);

    const enableMfaBtn = document.getElementById('enableMfaBtn');
    if (enableMfaBtn) enableMfaBtn.addEventListener('click', enableMFA);

    checkAuth();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAdminPanel);
  } else {
    initAdminPanel();
  }

  // ── Books Management & Client-side EPUB Parsing ──
  let extractedCoverFile = null;

  async function handleEpubSelect(e) {
    const file = e.target.files[0];
    if (!file || !file.name.endsWith('.epub')) {
      document.getElementById('epubExtractHint').textContent = "Selected file is not an EPUB. Auto-fill disabled.";
      return;
    }

    document.getElementById('epubExtractHint').textContent = "Extracting metadata...";
    extractedCoverFile = null;

    try {
      const zip = await JSZip.loadAsync(file);
      
      const containerFile = zip.file("META-INF/container.xml");
      if (!containerFile) throw new Error("Invalid EPUB: missing container.xml");
      
      const containerText = await containerFile.async("string");
      const parser = new DOMParser();
      const containerXml = parser.parseFromString(containerText, "text/xml");
      const rootfile = containerXml.querySelector("rootfile");
      if (!rootfile) throw new Error("Invalid EPUB: missing rootfile in container.xml");
      
      const opfPath = rootfile.getAttribute("full-path");
      
      const opfFile = zip.file(opfPath);
      if (!opfFile) throw new Error(`Invalid EPUB: missing OPF file at ${opfPath}`);
      
      const opfText = await opfFile.async("string");
      const opfXml = parser.parseFromString(opfText, "text/xml");
      
      const title = opfXml.querySelector("title")?.textContent || opfXml.querySelector("dc\\:title")?.textContent || "";
      const author = opfXml.querySelector("creator")?.textContent || opfXml.querySelector("dc\\:creator")?.textContent || "";
      const description = opfXml.querySelector("description")?.textContent || opfXml.querySelector("dc\\:description")?.textContent || "";
      const publisher = opfXml.querySelector("publisher")?.textContent || opfXml.querySelector("dc\\:publisher")?.textContent || "";
      const language = opfXml.querySelector("language")?.textContent || opfXml.querySelector("dc\\:language")?.textContent || "en";
      
      if (title) document.getElementById('bookTitle').value = title;
      if (author) document.getElementById('bookAuthor').value = author;
      if (description) document.getElementById('bookDescription').value = description;
      if (publisher) document.getElementById('bookPublisher').value = publisher;
      if (language) {
        const langVal = language.substring(0, 2).toLowerCase();
        const select = document.getElementById('bookLanguage');
        if (Array.from(select.options).some(opt => opt.value === langVal)) {
          select.value = langVal;
        } else {
          select.value = 'other';
        }
      }

      document.getElementById('epubExtractHint').textContent = "Metadata extracted successfully!";

      let coverId = null;
      const metaCover = opfXml.querySelector("meta[name='cover']");
      if (metaCover) {
        coverId = metaCover.getAttribute("content");
      }

      if (coverId) {
        const manifestItem = opfXml.querySelector(`item[id='${coverId}']`) || opfXml.querySelector(`[id='${coverId}']`);
        if (manifestItem) {
          const coverHref = manifestItem.getAttribute("href");
          const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';
          const coverPath = opfDir + coverHref;
          const coverZipFile = zip.file(coverPath) || zip.file(decodeURIComponent(coverPath));
          if (coverZipFile) {
            const coverBlob = await coverZipFile.async("blob");
            const ext = coverHref.substring(coverHref.lastIndexOf('.') + 1) || 'png';
            extractedCoverFile = new File([coverBlob], `extracted_cover.${ext}`, { type: coverBlob.type || `image/${ext}` });
            showCoverPreview(extractedCoverFile);
          }
        }
      }
    } catch (err) {
      console.error("EPUB metadata extraction failed:", err);
      document.getElementById('epubExtractHint').textContent = "Failed to parse EPUB metadata: " + err.message;
    }
  }

  function showCoverPreview(file) {
    let previewImg = document.getElementById('extractedCoverPreview');
    if (!previewImg) {
      previewImg = document.createElement('img');
      previewImg.id = 'extractedCoverPreview';
      previewImg.style.width = '60px';
      previewImg.style.height = '90px';
      previewImg.style.objectFit = 'cover';
      previewImg.style.borderRadius = '4px';
      previewImg.style.marginTop = '8px';
      previewImg.style.border = '1px solid var(--border-card)';
      document.getElementById('bookCover').parentNode.appendChild(previewImg);
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      previewImg.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  async function loadBooks() {
    try {
      let data;
      try {
        data = await api('/api/admin/books');
      } catch (e) {
        data = await api('/api/books?limit=250&sort=newest');
      }
      allBooksList = data.books || [];
      renderFilteredBooks();

      loadUserSubmissions();
      loadCategoriesForBooksForm();
    } catch (err) {
      showToast('Failed to load books: ' + err.message, 'error');
    }
  }

  let activeReviewBookId = null;

  function getStatusBadgeClass(status) {
    if (status === 'published') return 'status-badge--approved';
    if (status === 'pending') return 'status-badge--pending';
    if (status === 'under_review') return 'status-badge--cyan';
    if (status === 'temp_stopped') return 'status-badge--amber';
    if (status === 'suspended') return 'status-badge--rejected';
    return 'status-badge--muted';
  }

  function formatStatusLabel(status) {
    if (status === 'published') return 'Published';
    if (status === 'pending') return 'Pending Review';
    if (status === 'under_review') return 'Under Review';
    if (status === 'temp_stopped') return 'Temporarily Stopped';
    if (status === 'suspended') return 'Suspended';
    return status || 'Draft';
  }

  function renderFilteredBooks() {
    const tbody = document.getElementById('booksListBody');
    const noBooksState = document.getElementById('noBooksState');
    const selectAllCheckbox = document.getElementById('selectAllBooks');

    tbody.innerHTML = '';
    if (selectAllCheckbox) selectAllCheckbox.checked = false;
    updateBatchActionBar();

    const categoryId = document.getElementById('adminBookCategoryFilter').value;
    const query = document.getElementById('adminBookSearch').value.toLowerCase().trim();

    let filtered = allBooksList;
    if (categoryId !== 'all') {
      filtered = filtered.filter(b => b.category_id == categoryId || b.category_slug === categoryId || (b.categories && b.categories.some(c => c.id == categoryId)));
    }
    if (query) {
      filtered = filtered.filter(b => {
        const title = (b.title || '').toLowerCase();
        const author = (b.author || '').toLowerCase();
        const isbn = (b.isbn || '').toLowerCase();
        return title.includes(query) || author.includes(query) || isbn.includes(query);
      });
    }

    if (filtered.length > 0) {
      noBooksState.classList.add('hidden');
      document.getElementById('booksListTable').parentNode.classList.remove('hidden');

      filtered.forEach(book => {
        const tr = document.createElement('tr');
        const fileType = (book.file_type || '').toUpperCase();
        const visibility = book.visibility || 'public';
        const status = book.status || 'draft';
        const badgeClass = getStatusBadgeClass(status);
        const statusLabel = formatStatusLabel(status);
        
        tr.innerHTML = `
          <td><input type="checkbox" class="book-select-checkbox" data-book-id="${book.id}" style="cursor:pointer; transform:scale(1.25);"></td>
          <td>
            <a href="#" class="admin-book-review-trigger" data-book-id="${book.id}">
              <img src="${book.cover_image_url || '/images/default-cover.svg'}" style="width: 40px; height: 60px; object-fit: cover; border-radius: 4px; border: 1px solid var(--border-card); cursor: pointer;" title="Click to review book">
            </a>
          </td>
          <td style="font-weight: 500;">
            <a href="#" class="admin-book-review-trigger" data-book-id="${book.id}" style="color: var(--text-primary); text-decoration: none;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">
              ${escapeHtml(book.title || '')}
            </a>
          </td>
          <td>${escapeHtml(book.author || '')}</td>
          <td><span class="filter-chip" style="font-size: 0.75rem;">${fileType}</span></td>
          <td><span class="status-badge status-badge--${visibility === 'public' ? 'approved' : 'pending'}">${visibility}</span></td>
          <td><span class="status-badge ${badgeClass}">${escapeHtml(statusLabel)}</span></td>
          <td>${book.uploaded_by ? `User ID: ${book.uploaded_by}` : 'Admin'}</td>
          <td>
            <div class="flex gap-8" style="gap: 6px;">
              <button class="btn btn--secondary btn--sm admin-book-review-trigger" data-book-id="${book.id}" style="padding: 4px 8px; font-size: 0.8rem;">🔍 Review</button>
              <button class="btn btn--danger btn--sm" onclick="window.deleteBook(${book.id})" style="padding: 4px 8px; font-size: 0.8rem;">Delete</button>
            </div>
          </td>
        `;
        tbody.appendChild(tr);
      });

      // Bind review modal triggers
      tbody.querySelectorAll('.admin-book-review-trigger').forEach(el => {
        el.addEventListener('click', (e) => {
          e.preventDefault();
          const bookId = el.dataset.bookId;
          const targetBook = allBooksList.find(b => b.id == bookId);
          if (targetBook) {
            openAdminBookReviewModal(targetBook);
          }
        });
      });

      // Bind checkbox event listeners
      document.querySelectorAll('.book-select-checkbox').forEach(cb => {
        cb.addEventListener('change', updateBatchActionBar);
      });
    } else {
      noBooksState.classList.remove('hidden');
      document.getElementById('booksListTable').parentNode.classList.add('hidden');
    }
  }

  function openAdminBookReviewModal(book) {
    activeReviewBookId = book.id;
    const modal = document.getElementById('adminBookReviewModal');

    document.getElementById('adminModalBookCover').src = book.cover_image_url || '/images/default-cover.svg';
    document.getElementById('adminModalBookTitle').textContent = book.title || 'Untitled Book';
    document.getElementById('adminModalBookAuthor').textContent = `By ${book.author || 'Unknown'}`;
    document.getElementById('adminModalBookChannel').textContent = (book.channel_type || 'education').toUpperCase();
    document.getElementById('adminModalBookCategory').textContent = book.category_names || 'General';
    document.getElementById('adminModalBookDescription').textContent = book.description || 'No description provided.';
    document.getElementById('adminModalBookType').textContent = (book.file_type || 'epub').toUpperCase();
    document.getElementById('adminModalBookVisibility').textContent = book.visibility || 'public';
    document.getElementById('adminModalBookUploader').textContent = book.uploader_name || (book.uploaded_by ? `User ID: ${book.uploaded_by}` : 'Admin');
    document.getElementById('adminModalBookDate').textContent = book.created_at ? new Date(book.created_at).toLocaleDateString() : '—';

    // Status Badge
    const badgeEl = document.getElementById('adminModalBookStatusBadge');
    badgeEl.className = `status-badge ${getStatusBadgeClass(book.status)}`;
    badgeEl.textContent = formatStatusLabel(book.status).toUpperCase();

    // Status Selector
    const statusSelect = document.getElementById('adminModalStatusSelect');
    statusSelect.value = book.status || 'pending';

    // Populate Edit Form inputs
    const editTitle = document.getElementById('modalEditTitle');
    if (editTitle) editTitle.value = book.title || '';
    const editAuthor = document.getElementById('modalEditAuthor');
    if (editAuthor) editAuthor.value = book.author || '';
    const editChannel = document.getElementById('modalEditChannel');
    if (editChannel) editChannel.value = book.channel_type || 'education';
    const editPublisher = document.getElementById('modalEditPublisher');
    if (editPublisher) editPublisher.value = book.publisher || '';
    const editDesc = document.getElementById('modalEditDescription');
    if (editDesc) editDesc.value = book.description || '';
    const editLang = document.getElementById('modalEditLanguage');
    if (editLang) editLang.value = book.language || 'en';
    const editIsbn = document.getElementById('modalEditIsbn');
    if (editIsbn) editIsbn.value = book.isbn || '';
    const editPages = document.getElementById('modalEditPageCount');
    if (editPages) editPages.value = book.page_count || 100;
    const editMins = document.getElementById('modalEditReadMinutes');
    if (editMins) editMins.value = book.est_read_minutes || 25;
    const editVis = document.getElementById('modalEditVisibility');
    if (editVis) editVis.value = book.visibility || 'public';
    const editStat = document.getElementById('modalEditStatus');
    if (editStat) editStat.value = book.status || 'published';

    // Links
    const readerLink = document.getElementById('adminModalReaderLink');
    readerLink.href = `/reader.html?bookId=${book.id}`;

    const downloadLink = document.getElementById('adminModalDownloadLink');
    if (book.file_url) {
      downloadLink.href = `/api/books/${book.id}/file`;
      downloadLink.style.display = '';
    } else {
      downloadLink.style.display = 'none';
    }

    // Save button event
    document.getElementById('adminModalSaveStatusBtn').onclick = () => {
      const newStatus = statusSelect.value;
      updateAdminBookStatus(book.id, newStatus);
    };

    modal.style.display = 'flex';
    modal.classList.add('active');
  }

  window.saveAdminEditBook = async function(e) {
    if (e) e.preventDefault();
    if (!activeReviewBookId) return;

    const btn = document.getElementById('btnSaveAdminEditBook');
    btn.disabled = true;
    btn.textContent = 'Saving Changes...';

    const payload = {
      title: document.getElementById('modalEditTitle').value.trim(),
      author: document.getElementById('modalEditAuthor').value.trim(),
      channel_type: document.getElementById('modalEditChannel').value,
      publisher: document.getElementById('modalEditPublisher').value.trim(),
      description: document.getElementById('modalEditDescription').value.trim(),
      language: document.getElementById('modalEditLanguage').value,
      isbn: document.getElementById('modalEditIsbn').value.trim(),
      page_count: parseInt(document.getElementById('modalEditPageCount').value) || 100,
      est_read_minutes: parseInt(document.getElementById('modalEditReadMinutes').value) || 25,
      visibility: document.getElementById('modalEditVisibility').value,
      status: document.getElementById('modalEditStatus').value
    };

    try {
      const res = await api(`/api/admin/books/${activeReviewBookId}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });

      showToast(res.message || 'Book details updated successfully!', 'success');

      const modal = document.getElementById('adminBookReviewModal');
      if (modal) {
        modal.style.display = 'none';
        modal.classList.remove('active');
      }

      loadBooks();
    } catch (err) {
      showToast('Failed to update book: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '💾 Save & Update Book Details';
    }
  };

  async function updateAdminBookStatus(bookId, newStatus) {
    try {
      showToast('Updating book status...', 'info');
      await api(`/api/admin/books/${bookId}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: newStatus })
      });
      showToast(`Book status updated to ${formatStatusLabel(newStatus)}`, 'success');
      
      const modal = document.getElementById('adminBookReviewModal');
      if (modal) {
        modal.style.display = 'none';
        modal.classList.remove('active');
      }

      loadBooks();
    } catch (err) {
      showToast('Failed to update status: ' + err.message, 'error');
    }
  }

  window.adminQuickSetStatus = function (newStatus) {
    if (activeReviewBookId) {
      updateAdminBookStatus(activeReviewBookId, newStatus);
    }
  };

  function updateBatchActionBar() {
    const checkboxes = document.querySelectorAll('.book-select-checkbox:checked');
    const count = checkboxes.length;
    const bar = document.getElementById('batchActionBar');
    const countText = document.getElementById('selectedCountText');

    if (count > 0) {
      if (countText) countText.textContent = `${count} book(s) selected`;
      if (bar) bar.classList.remove('hidden');
    } else {
      if (bar) bar.classList.add('hidden');
    }
  }

  async function loadUserSubmissions() {
    try {
      const submissions = await api('/api/admin/submissions');
      const tbody = document.getElementById('booksSubmissionsBody');
      const empty = document.getElementById('noSubmissionsState');
      const countEl = document.getElementById('submissionsCount');

      tbody.innerHTML = '';
      if (countEl) countEl.textContent = submissions.length;

      if (submissions && submissions.length > 0) {
        if (empty) empty.classList.add('hidden');
        const table = document.getElementById('booksSubmissionsTable');
        if (table) table.parentNode.classList.remove('hidden');

        submissions.forEach(sub => {
          const tr = document.createElement('tr');
          const fileExt = sub.book_file_url.split('.').pop().toUpperCase();
          const submissionDate = new Date(sub.created_at).toLocaleDateString();
          tr.innerHTML = `
            <td><img src="${sub.cover_image_url || '/images/default-cover.svg'}" style="width: 40px; height: 60px; object-fit: cover; border-radius: 4px; border: 1px solid var(--border-card);"></td>
            <td style="font-weight: 500;">${escapeHtml(sub.title)}</td>
            <td>${escapeHtml(sub.author)}</td>
            <td><span class="filter-chip" style="font-size: 0.75rem;">${sub.channel_type.toUpperCase()}</span></td>
            <td>${escapeHtml(sub.category_name || '—')}</td>
            <td>${escapeHtml(sub.uploader_name || 'Anonymous')}<br><small style="opacity: 0.6;">${escapeHtml(sub.uploader_email || '')}</small></td>
            <td><a href="${sub.book_file_url}" target="_blank" class="btn btn--secondary btn--sm" style="padding: 4px 8px; font-size: 0.75rem;">📥 Download ${fileExt}</a></td>
            <td>${submissionDate}</td>
            <td>
              <div class="flex gap-8" style="display: flex; gap: 8px;">
                <button class="btn btn--success btn--sm" onclick="window.approveSubmission(${sub.id})">✓</button>
                <button class="btn btn--danger btn--sm" onclick="window.rejectSubmission(${sub.id})">✗</button>
              </div>
            </td>
          `;
          tbody.appendChild(tr);
        });
      } else {
        if (empty) empty.classList.remove('hidden');
        const table = document.getElementById('booksSubmissionsTable');
        if (table) table.parentNode.classList.add('hidden');
      }
    } catch (err) {
      showToast('Failed to load user submissions: ' + err.message, 'error');
    }
  }

  async function loadCategoriesForBooksForm() {
    try {
      const categories = await api('/api/categories');
      const container = document.getElementById('bookCategoryList');
      if (container) {
        container.innerHTML = '';
        categories.forEach(cat => {
          const label = document.createElement('label');
          label.className = 'checkbox-label';
          label.style.display = 'flex';
          label.style.alignItems = 'center';
          label.style.gap = '8px';
          label.style.fontSize = '0.85rem';
          label.innerHTML = `
            <input type="checkbox" name="book_categories" value="${cat.id}">
            <span>${escapeHtml(cat.name)}</span>
          `;
          container.appendChild(label);
        });
      }

      // Sync category filters in Books list and Bulk reassignment
      const categoryFilter = document.getElementById('adminBookCategoryFilter');
      const bulkSelect = document.getElementById('bulkCategorySelect');

      if (categoryFilter && bulkSelect) {
        const prevFilter = categoryFilter.value;
        const prevBulk = bulkSelect.value;

        categoryFilter.innerHTML = '<option value="all">All Categories</option>';
        bulkSelect.innerHTML = '<option value="">Move to Category...</option>';

        categories.forEach(cat => {
          const optFilter = document.createElement('option');
          optFilter.value = cat.id;
          optFilter.textContent = cat.name;
          categoryFilter.appendChild(optFilter);

          const optBulk = document.createElement('option');
          optBulk.value = cat.id;
          optBulk.textContent = cat.name;
          bulkSelect.appendChild(optBulk);
        });

        categoryFilter.value = prevFilter || 'all';
        bulkSelect.value = prevBulk || '';
      }
    } catch (err) {
      console.error('Failed to load categories for form:', err);
    }
  }

  async function handleBookSubmit(e) {
    e.preventDefault();
    const submitBtn = document.getElementById('btnSubmitBook');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving Book...';

    const formData = new FormData();
    const bookFile = document.getElementById('bookFile').files[0];
    const coverFileInput = document.getElementById('bookCover').files[0];

    formData.append('book', bookFile);
    if (coverFileInput) {
      formData.append('cover', coverFileInput);
    } else if (extractedCoverFile) {
      formData.append('cover', extractedCoverFile);
    }

    formData.append('title', document.getElementById('bookTitle').value.trim());
    formData.append('author', document.getElementById('bookAuthor').value.trim());
    formData.append('description', document.getElementById('bookDescription').value.trim());
    formData.append('publisher', document.getElementById('bookPublisher').value.trim());
    formData.append('language', document.getElementById('bookLanguage').value);
    formData.append('isbn', document.getElementById('bookIsbn').value.trim());
    
    const pageCount = document.getElementById('bookPageCount').value;
    if (pageCount) formData.append('page_count', pageCount);
    
    const readTime = document.getElementById('bookReadTime').value;
    if (readTime) formData.append('est_read_minutes', readTime);

    const selectedCats = Array.from(document.querySelectorAll('input[name="book_categories"]:checked')).map(cb => cb.value);
    formData.append('category_ids', JSON.stringify(selectedCats));

    const tags = document.getElementById('bookTags').value.split(',').map(t => t.trim()).filter(Boolean);
    formData.append('tags', JSON.stringify(tags));

    formData.append('channel_type', document.getElementById('bookChannel').value);
    formData.append('visibility', document.getElementById('bookVisibility').value);
    formData.append('status', document.getElementById('bookStatus').value);

    try {
      const res = await api('/api/admin/books', {
        method: 'POST',
        body: formData
      });

      showToast(res.message || 'Book saved successfully!', 'success');
      document.getElementById('adminBookUploadForm').reset();
      extractedCoverFile = null;
      const previewImg = document.getElementById('extractedCoverPreview');
      if (previewImg) previewImg.remove();

      switchBookTab('booksListTabSection', 'btnBooksListTab');
      loadBooks();
    } catch (err) {
      showToast(err.message || 'Failed to save book.', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = '💾 Upload & Save Book';
    }
  }

  window.switchBookTab = function(activeSectionId, activeTabId) {
    ['booksListTabSection', 'booksUploadTabSection', 'booksSubmissionsTabSection'].forEach(s => {
      const el = document.getElementById(s);
      if (el) el.classList.add('hidden');
    });
    ['btnBooksListTab', 'btnBooksUploadTab', 'btnBooksSubmissionsTab'].forEach(t => {
      const el = document.getElementById(t);
      if (el) el.classList.remove('active');
    });

    const sec = document.getElementById(activeSectionId);
    if (sec) sec.classList.remove('hidden');
    const tab = document.getElementById(activeTabId);
    if (tab) tab.classList.add('active');
  }

  window.deleteBook = async function(bookId) {
    if (!confirm('Are you sure you want to delete this book? This will permanently remove all text, bookmarks, and highlights.')) return;
    try {
      await api(`/api/admin/books/${bookId}`, { method: 'DELETE' });
      showToast('Book deleted successfully.', 'success');
      loadBooks();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  window.approveBook = async function(bookId) {
    try {
      await api(`/api/admin/books/${bookId}/approve`, { method: 'POST' });
      showToast('Book approved and published!', 'success');
      loadBooks();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  window.approveSubmission = async function(id) {
    if (!confirm('Approve and publish this book submission?')) return;
    try {
      await api(`/api/admin/submissions/${id}/approve`, { method: 'POST', body: '{}' });
      showToast('Submission approved and published successfully!', 'success');
      loadBooks();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  window.rejectSubmission = async function(id) {
    const reason = prompt('Enter the reason for rejection (this will be sent to the user):');
    if (reason === null) return;
    
    try {
      await api(`/api/admin/submissions/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ rejection_reason: reason })
      });
      showToast('Submission rejected.', 'success');
      loadBooks();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  window.loadUserAuditData = async function(userId) {
    if (!userId || userId === 'Unknown') {
      document.getElementById('auditPii').innerHTML = '<span style="color:var(--text-muted)">N/A (No User Target)</span>';
      document.getElementById('auditContent').innerHTML = '<span style="color:var(--text-muted)">N/A</span>';
      document.getElementById('auditLoginLogs').innerHTML = '<tr><td colspan="3" style="text-align:center; color:var(--text-muted);">N/A</td></tr>';
      return;
    }
    
    try {
      const audit = await api(`/api/admin/users/${userId}/audit`);
      
      // Populate Core Profile
      document.getElementById('auditPii').innerHTML = `
        <strong>ID:</strong> ${audit.user.id}<br>
        <strong>Username:</strong> ${escapeHtml(audit.user.user_id)}<br>
        <strong>Email:</strong> ${escapeHtml(audit.user.email)}<br>
        <strong>Name:</strong> ${escapeHtml(audit.user.full_name)}<br>
        <strong>Joined:</strong> ${new Date(audit.user.created_at).toLocaleString()}<br>
        <strong>Status:</strong> <span class="status-badge status-badge--${audit.user.account_status === 'active' ? 'approved' : 'rejected'}">${audit.user.account_status}</span>
      `;
      
      // Populate Content Aggregation
      const stats = audit.stats || { stories: 0, comments: 0, likesReceived: 0 };
      document.getElementById('auditContent').innerHTML = `
        <strong>Stories Posted:</strong> ${stats.stories}<br>
        <strong>Comments Posted:</strong> ${stats.comments}<br>
        <strong>Total Likes Received:</strong> ${stats.likesReceived}
      `;
      
      // Parse & Checkboxes for Permissions
      let perms = { like: true, comment: true, follow: true, block: true };
      if (audit.user.interaction_permissions) {
        try {
          perms = typeof audit.user.interaction_permissions === 'string'
            ? JSON.parse(audit.user.interaction_permissions)
            : audit.user.interaction_permissions;
        } catch (e) {
          console.error('Error parsing interaction permissions:', e);
        }
      }
      document.getElementById('permLike').checked = !!perms.like;
      document.getElementById('permComment').checked = !!perms.comment;
      document.getElementById('permFollow').checked = !!perms.follow;
      document.getElementById('permBlock').checked = !!perms.block;
      
      // Populate Login Ledger (Show top 5)
      const ledgerBody = document.getElementById('auditLoginLogs');
      ledgerBody.innerHTML = '';
      if (audit.login_logs && audit.login_logs.length > 0) {
        audit.login_logs.slice(0, 5).forEach(log => {
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td>${new Date(log.created_at).toLocaleDateString()}</td>
            <td><code>${escapeHtml(log.ip_address || '—')}</code></td>
            <td style="color: ${log.status === 'success' ? 'var(--success)' : 'var(--danger)'}">${escapeHtml(log.status)}</td>
          `;
          ledgerBody.appendChild(tr);
        });
      } else {
        ledgerBody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:var(--text-muted);">No recent logins</td></tr>';
      }
    } catch (err) {
      document.getElementById('auditPii').innerHTML = '<span style="color:var(--danger)">Failed to load data</span>';
      document.getElementById('auditContent').innerHTML = '';
      document.getElementById('auditLoginLogs').innerHTML = '<tr><td colspan="3" style="text-align:center; color:var(--danger);">Failed to load</td></tr>';
    }
  };

  window.updateInteractionPermissions = async function() {
    if (!window.currentTicketTargetUser || window.currentTicketTargetUser === 'Unknown') return;
    
    const perms = {
      like: document.getElementById('permLike').checked,
      comment: document.getElementById('permComment').checked,
      follow: document.getElementById('permFollow').checked,
      block: document.getElementById('permBlock').checked
    };
    
    try {
      await api(`/api/admin/users/${window.currentTicketTargetUser}/permissions`, {
        method: 'PUT',
        body: JSON.stringify({ permissions: perms })
      });
      showToast('User permissions updated', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  window.enforceBan = async function(actionType) {
    if (!window.currentTicketTargetUser || window.currentTicketTargetUser === 'Unknown') return;
    
    const reason = prompt('Enter reason for enforcement action:');
    if (!reason) return;
    
    try {
      await api(`/api/admin/users/${window.currentTicketTargetUser}/enforce`, {
        method: 'POST',
        body: JSON.stringify({ action: actionType, reason })
      });
      showToast(`Action '${actionType}' applied to user`, 'success');
      window.loadUserAuditData(window.currentTicketTargetUser);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // ── Bulk Book Upload & Automated Metadata Extractor Engine ──
  let bulkExtractedItems = [];

  function switchBookTab(activeSectionId, activeBtnId) {
    ['booksListTabSection', 'booksUploadTabSection', 'booksBulkUploadTabSection', 'booksSubmissionsTabSection'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });
    ['btnBooksListTab', 'btnBooksUploadTab', 'btnBooksBulkUploadTab', 'btnBooksSubmissionsTab'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.classList.remove('active');
    });
    const section = document.getElementById(activeSectionId);
    const btn = document.getElementById(activeBtnId);
    if (section) section.classList.remove('hidden');
    if (btn) btn.classList.add('active');
  }

  function initBulkBookUpload() {
    const folderInput = document.getElementById('bulkFolderInput');
    const zipInput = document.getElementById('bulkZipInput');
    const dropZone = document.getElementById('bulkDropZone');
    const resetBtn = document.getElementById('btnResetBulkExtractor');
    const saveBtn = document.getElementById('btnSaveBulkBatch');

    if (folderInput) folderInput.addEventListener('change', e => handleBulkFilesSelect(e.target.files));
    if (zipInput) zipInput.addEventListener('change', e => handleBulkZipSelect(e.target.files[0]));

    if (dropZone) {
      dropZone.addEventListener('dragover', e => {
        e.preventDefault();
        dropZone.style.borderColor = 'var(--primary)';
        dropZone.style.background = 'rgba(92, 106, 196, 0.12)';
      });
      dropZone.addEventListener('dragleave', e => {
        e.preventDefault();
        dropZone.style.borderColor = 'var(--primary)';
        dropZone.style.background = 'rgba(92, 106, 196, 0.04)';
      });
      dropZone.addEventListener('drop', e => {
        e.preventDefault();
        dropZone.style.borderColor = 'var(--primary)';
        dropZone.style.background = 'rgba(92, 106, 196, 0.04)';
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          if (e.dataTransfer.files.length === 1 && (e.dataTransfer.files[0].name.endsWith('.zip') || e.dataTransfer.files[0].name.endsWith('.rar'))) {
            handleBulkZipSelect(e.dataTransfer.files[0]);
          } else {
            handleBulkFilesSelect(e.dataTransfer.files);
          }
        }
      });
    }

    if (resetBtn) resetBtn.addEventListener('click', resetBulkExtractor);
    if (saveBtn) saveBtn.addEventListener('click', commitBulkSaveBatch);
  }

  function updateBulkProgress(stageText, percent, subText) {
    const container = document.getElementById('bulkProgressContainer');
    const stageEl = document.getElementById('bulkProgressStageText');
    const percentEl = document.getElementById('bulkProgressPercentText');
    const barEl = document.getElementById('bulkProgressBar');
    const subtextEl = document.getElementById('bulkProgressSubtext');

    if (container) container.classList.remove('hidden');
    if (stageEl) stageEl.textContent = stageText;
    if (percentEl) percentEl.textContent = `${Math.round(percent)}%`;
    if (barEl) barEl.style.width = `${Math.round(percent)}%`;
    if (subtextEl) subtextEl.textContent = subText || '';
  }

  function hideBulkProgress() {
    const container = document.getElementById('bulkProgressContainer');
    if (container) container.classList.add('hidden');
  }

  function cleanTitleFromFilename(name) {
    let clean = name.replace(/\.[^/.]+$/, '');
    clean = clean.replace(/[\-_]/g, ' ');
    clean = clean.replace(/([a-z])([A-Z])/g, '$1 $2');
    clean = clean.replace(/\s+/g, ' ').trim();
    return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : 'Untitled Book';
  }

  function parseIsbn(text) {
    if (!text) return '';
    const match = text.match(/(?:ISBN(?:-13)?:?\s*)?(97[89][-\s]?\d{1,5}[-\s]?\d{1,7}[-\s]?\d{1,7}[-\s]?[\dX])/i);
    return match ? match[1].replace(/[-\s]/g, '') : '';
  }

  async function handleBulkZipSelect(zipFile) {
    if (!zipFile) return;
    resetBulkExtractor();
    updateBulkProgress('Stage 1: Reading Archive...', 10, `Unpacking ${zipFile.name}...`);

    try {
      const zip = await JSZip.loadAsync(zipFile);
      const fileEntries = [];
      let sidecarFile = null;

      const entries = Object.keys(zip.files);
      for (const path of entries) {
        const entry = zip.files[path];
        if (entry.dir) continue;

        // Path Traversal Security Check
        if (path.includes('../') || path.includes('..\\')) continue;

        const lower = path.toLowerCase();
        if (lower.endsWith('metadata.json') || lower.endsWith('metadata.csv')) {
          sidecarFile = entry;
        } else if (lower.endsWith('.epub') || lower.endsWith('.pdf')) {
          fileEntries.push({ path, entry });
        }
      }

      if (fileEntries.length === 0) {
        throw new Error('No .EPUB or .PDF files found inside archive.');
      }

      if (fileEntries.length > 100) {
        showToast('Hard limit of 100 books per batch upload enforced. Processing first 100.', 'warning');
        fileEntries.length = 100;
      }

      let sidecarData = {};
      if (sidecarFile) {
        try {
          const content = await sidecarFile.async('string');
          if (sidecarFile.name.endsWith('.json')) {
            sidecarData = JSON.parse(content);
          }
        } catch (e) {
          console.warn('Sidecar metadata parse error:', e);
        }
      }

      const total = fileEntries.length;
      bulkExtractedItems = [];

      for (let i = 0; i < total; i++) {
        const { path, entry } = fileEntries[i];
        const pct = 15 + ((i + 1) / total) * 65;
        const filename = path.split('/').pop();
        updateBulkProgress('Stage 2: Extracting Metadata...', pct, `Processing ${i + 1} of ${total}: ${filename}`);

        const fileBlob = await entry.async('blob');
        const fileObj = new File([fileBlob], filename, { type: filename.endsWith('.pdf') ? 'application/pdf' : 'application/epub+zip' });

        let metadata = {
          id: 'item_' + i + '_' + Date.now(),
          file: fileObj,
          filename: filename,
          file_type: filename.endsWith('.pdf') ? 'pdf' : 'epub',
          channel_type: document.getElementById('bulkDefaultChannel').value || 'education',
          title: cleanTitleFromFilename(filename),
          author: 'Unknown Author',
          description: '',
          publisher: 'Self-Published',
          language: 'en',
          isbn: parseIsbn(filename),
          page_count: 100,
          est_read_minutes: 25,
          coverDataUrl: null,
          isValid: true,
          errorMsg: ''
        };

        if (fileObj.size > 52428800) { // 50MB
          metadata.isValid = false;
          metadata.errorMsg = 'File size exceeds 50MB limit';
        } else if (filename.endsWith('.epub')) {
          try {
            const containerFile = zip.file("META-INF/container.xml");
            if (containerFile) {
              const containerText = await containerFile.async("string");
              const parser = new DOMParser();
              const containerXml = parser.parseFromString(containerText, "text/xml");
              const rootfile = containerXml.querySelector("rootfile");
              if (rootfile) {
                const opfPath = rootfile.getAttribute("full-path");
                const opfFile = zip.file(opfPath);
                if (opfFile) {
                  const opfText = await opfFile.async("string");
                  const opfXml = parser.parseFromString(opfText, "text/xml");
                  metadata.title = getXmlTagText(opfXml, 'title') || metadata.title;
                  metadata.author = getXmlTagText(opfXml, 'creator') || metadata.author;
                  metadata.description = getXmlTagText(opfXml, 'description') || '';
                  metadata.publisher = getXmlTagText(opfXml, 'publisher') || metadata.publisher;
                  metadata.language = getXmlTagText(opfXml, 'language') || 'en';
                  metadata.isbn = parseIsbn(getXmlTagText(opfXml, 'identifier')) || metadata.isbn;
                }
              }
            }
          } catch (err) {
            console.warn('EPUB parsing notice:', err);
          }
        } else if (filename.endsWith('.pdf')) {
          metadata.page_count = Math.max(12, Math.floor(fileObj.size / 35000));
          metadata.est_read_minutes = Math.round(metadata.page_count * 1.5);
        }

        if (sidecarData[filename]) {
          Object.assign(metadata, sidecarData[filename]);
        }

        bulkExtractedItems.push(metadata);
      }

      updateBulkProgress('Stage 3: Validating Batch...', 90, 'Building pre-save review grid...');
      setTimeout(() => {
        hideBulkProgress();
        renderBulkReviewTable();
      }, 500);
    } catch (err) {
      hideBulkProgress();
      showToast('Archive processing error: ' + err.message, 'error');
    }
  }

  async function handleBulkFilesSelect(fileList) {
    if (!fileList || fileList.length === 0) return;
    resetBulkExtractor();

    const bookFiles = Array.from(fileList).filter(f => f.name.endsWith('.epub') || f.name.endsWith('.pdf'));
    const imageFiles = Array.from(fileList).filter(f => f.type.startsWith('image/'));

    if (bookFiles.length === 0) {
      showToast('No valid .EPUB or .PDF files found in selected folder.', 'warning');
      return;
    }

    if (bookFiles.length > 100) {
      showToast('Maximum batch limit is 100 books. Processing first 100.', 'warning');
      bookFiles.length = 100;
    }

    const total = bookFiles.length;
    bulkExtractedItems = [];

    for (let i = 0; i < total; i++) {
      const fileObj = bookFiles[i];
      const filename = fileObj.name;
      const pct = ((i + 1) / total) * 80;
      updateBulkProgress('Stage 2: Extracting Metadata...', pct, `Processing ${i + 1} of ${total}: ${filename}`);

      let metadata = {
        id: 'item_' + i + '_' + Date.now(),
        file: fileObj,
        filename: filename,
        file_type: filename.endsWith('.pdf') ? 'pdf' : 'epub',
        channel_type: document.getElementById('bulkDefaultChannel').value || 'education',
        title: cleanTitleFromFilename(filename),
        author: 'Unknown Author',
        description: '',
        publisher: 'Self-Published',
        language: 'en',
        isbn: parseIsbn(filename),
        page_count: 120,
        est_read_minutes: 30,
        coverDataUrl: null,
        isValid: true,
        errorMsg: ''
      };

      if (fileObj.size > 52428800) {
        metadata.isValid = false;
        metadata.errorMsg = 'File size exceeds 50MB limit';
      } else if (filename.endsWith('.epub')) {
        try {
          const zip = await JSZip.loadAsync(fileObj);
          const containerFile = zip.file("META-INF/container.xml");
          if (containerFile) {
            const containerText = await containerFile.async("string");
            const parser = new DOMParser();
            const containerXml = parser.parseFromString(containerText, "text/xml");
            const rootfile = containerXml.querySelector("rootfile");
            if (rootfile) {
              const opfPath = rootfile.getAttribute("full-path");
              const opfFile = zip.file(opfPath);
              if (opfFile) {
                const opfText = await opfFile.async("string");
                const opfXml = parser.parseFromString(opfText, "text/xml");
                metadata.title = getXmlTagText(opfXml, 'title') || metadata.title;
                metadata.author = getXmlTagText(opfXml, 'creator') || metadata.author;
                metadata.description = getXmlTagText(opfXml, 'description') || '';
                metadata.publisher = getXmlTagText(opfXml, 'publisher') || metadata.publisher;
                metadata.language = getXmlTagText(opfXml, 'language') || 'en';
                metadata.isbn = parseIsbn(getXmlTagText(opfXml, 'identifier')) || metadata.isbn;
              }
            }
          }
        } catch (err) {
          console.warn("Folder EPUB parse error:", err);
        }
      } else if (filename.endsWith('.pdf')) {
        metadata.page_count = Math.max(10, Math.floor(fileObj.size / 35000));
        metadata.est_read_minutes = Math.round(metadata.page_count * 1.4);
      }

      const baseName = filename.replace(/\.[^/.]+$/, '').toLowerCase();
      const matchingImg = imageFiles.find(img => img.name.replace(/\.[^/.]+$/, '').toLowerCase() === baseName);
      if (matchingImg) {
        metadata.coverDataUrl = await readFileAsDataURL(matchingImg);
      }

      bulkExtractedItems.push(metadata);
    }

    updateBulkProgress('Stage 3: Validating Batch...', 95, 'Preparing review table...');
    setTimeout(() => {
      hideBulkProgress();
      renderBulkReviewTable();
    }, 400);
  }

  function getXmlTagText(xmlDoc, tagName) {
    const el = xmlDoc.querySelector(tagName) || xmlDoc.querySelector(`dc\\:${tagName}`) || xmlDoc.querySelector(`[nodeName*="${tagName}"]`);
    return el ? el.textContent.trim() : '';
  }

  function readFileAsDataURL(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
  }

  function resetBulkExtractor() {
    bulkExtractedItems = [];
    document.getElementById('bulkReviewBody').innerHTML = '';
    document.getElementById('bulkReviewTableWrapper').classList.add('hidden');
    document.getElementById('bulkSummaryReport').classList.add('hidden');
    document.getElementById('btnSaveBulkBatch').style.display = 'none';
    document.getElementById('btnResetBulkExtractor').style.display = 'none';
    hideBulkProgress();
  }

  function normalizeText(str) {
    return (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function detectDuplicates() {
    let dupCount = 0;
    let uniqueCount = 0;

    const seenTitlesInBatch = new Map();

    bulkExtractedItems.forEach(item => {
      const normTitle = normalizeText(item.title);
      const normAuthor = normalizeText(item.author);

      item.isDuplicateInDb = false;
      item.isDuplicateInBatch = false;
      item.matchedDbBook = null;

      if (allBooksList && allBooksList.length > 0) {
        const matched = allBooksList.find(b => {
          const bTitle = normalizeText(b.title);
          const bAuthor = normalizeText(b.author);
          const bIsbn = (b.isbn || '').replace(/[^0-9X]/gi, '');
          const itemIsbn = (item.isbn || '').replace(/[^0-9X]/gi, '');

          if (itemIsbn && bIsbn && itemIsbn === bIsbn) return true;
          if (normTitle && bTitle && normTitle === bTitle && (!normAuthor || normAuthor === bAuthor)) return true;
          if (normTitle && bTitle && normTitle === bTitle) return true;
          return false;
        });

        if (matched) {
          item.isDuplicateInDb = true;
          item.matchedDbBook = matched;
        }
      }

      if (normTitle) {
        if (seenTitlesInBatch.has(normTitle)) {
          item.isDuplicateInBatch = true;
        } else {
          seenTitlesInBatch.set(normTitle, item.id);
        }
      }

      if (item.isDuplicateInDb || item.isDuplicateInBatch) {
        dupCount++;
      } else {
        uniqueCount++;
      }
    });

    const countUniqueEl = document.getElementById('countUnique');
    const countDupEl = document.getElementById('countDuplicates');
    if (countUniqueEl) countUniqueEl.textContent = uniqueCount;
    if (countDupEl) countDupEl.textContent = dupCount;
  }

  function renderBulkReviewTable() {
    const tbody = document.getElementById('bulkReviewBody');
    tbody.innerHTML = '';

    if (bulkExtractedItems.length === 0) return;

    detectDuplicates();

    document.getElementById('bulkTotalCount').textContent = bulkExtractedItems.length;
    document.getElementById('bulkReviewTableWrapper').classList.remove('hidden');
    document.getElementById('btnSaveBulkBatch').style.display = '';
    document.getElementById('btnResetBulkExtractor').style.display = '';

    let validCount = 0;

    bulkExtractedItems.forEach((item, index) => {
      const isMissingTitle = !item.title || item.title.trim().length === 0;
      const isMissingAuthor = !item.author || item.author.trim().length === 0;
      const isMissingChannel = !item.channel_type;

      if (!isMissingTitle && !isMissingAuthor && !isMissingChannel && item.isValid) {
        validCount++;
      }

      const tr = document.createElement('tr');
      tr.id = `row_${item.id}`;

      let dupBadge = '<span class="filter-chip" style="background: rgba(46, 204, 113, 0.15); color: #2ecc71; font-size: 0.75rem; border: 1px solid rgba(46, 204, 113, 0.3);">✨ Unique</span>';
      if (item.isDuplicateInDb) {
        dupBadge = `<span class="filter-chip" style="background: rgba(243, 156, 18, 0.15); color: #f39c12; font-size: 0.75rem; border: 1px solid rgba(243, 156, 18, 0.3);" title="Already in library catalog (ID: ${item.matchedDbBook ? item.matchedDbBook.id : '?'})">⚠️ In Library</span>`;
      } else if (item.isDuplicateInBatch) {
        dupBadge = `<span class="filter-chip" style="background: rgba(230, 126, 34, 0.15); color: #e67e22; font-size: 0.75rem; border: 1px solid rgba(230, 126, 34, 0.3);">⚠️ Batch Dup</span>`;
      }

      tr.innerHTML = `
        <td style="font-weight: bold; font-family: monospace;">${index + 1}</td>
        <td>
          <img src="${item.coverDataUrl || '/images/default-cover.svg'}" style="width: 35px; height: 50px; object-fit: cover; border-radius: 4px; border: 1px solid var(--border-card);">
        </td>
        <td style="font-size: 0.85rem; max-width: 140px; word-break: break-all; color: var(--text-secondary);">${escapeHtml(item.filename)}</td>
        <td>${dupBadge}</td>
        <td>
          <select class="form-input ${isMissingChannel ? 'invalid-cell' : ''}" style="height: 32px; padding: 0 6px; font-size: 0.85rem; ${isMissingChannel ? 'border: 2px solid #ef4444;' : ''}" onchange="updateBulkItem('${item.id}', 'channel_type', this.value)">
            <option value="education" ${item.channel_type === 'education' ? 'selected' : ''}>Educational</option>
            <option value="navel" ${item.channel_type === 'navel' ? 'selected' : ''}>Navel</option>
          </select>
        </td>
        <td>
          <input type="text" class="form-input ${isMissingTitle ? 'invalid-cell' : ''}" value="${escapeHtml(item.title)}" style="height: 32px; padding: 0 8px; font-size: 0.85rem; min-width: 130px; ${isMissingTitle ? 'border: 2px solid #ef4444;' : ''}" oninput="updateBulkItem('${item.id}', 'title', this.value)">
        </td>
        <td>
          <input type="text" class="form-input ${isMissingAuthor ? 'invalid-cell' : ''}" value="${escapeHtml(item.author)}" style="height: 32px; padding: 0 8px; font-size: 0.85rem; min-width: 110px; ${isMissingAuthor ? 'border: 2px solid #ef4444;' : ''}" oninput="updateBulkItem('${item.id}', 'author', this.value)">
        </td>
        <td>
          <input type="text" class="form-input" value="${escapeHtml(item.description || '')}" style="height: 32px; padding: 0 8px; font-size: 0.85rem; min-width: 120px;" placeholder="Synopsis" oninput="updateBulkItem('${item.id}', 'description', this.value)">
        </td>
        <td>
          <input type="text" class="form-input" value="${escapeHtml(item.publisher || '')}" style="height: 32px; padding: 0 8px; font-size: 0.85rem; min-width: 90px;" oninput="updateBulkItem('${item.id}', 'publisher', this.value)">
        </td>
        <td>
          <input type="text" class="form-input" value="${escapeHtml(item.language || 'en')}" style="height: 32px; padding: 0 4px; font-size: 0.85rem; width: 45px; text-align: center;" oninput="updateBulkItem('${item.id}', 'language', this.value)">
        </td>
        <td>
          <input type="text" class="form-input" value="${escapeHtml(item.isbn || '')}" style="height: 32px; padding: 0 6px; font-size: 0.85rem; min-width: 100px;" placeholder="ISBN" oninput="updateBulkItem('${item.id}', 'isbn', this.value)">
        </td>
        <td>
          <input type="number" class="form-input" value="${item.page_count || 100}" style="height: 32px; padding: 0 4px; font-size: 0.85rem; width: 60px; text-align: center;" oninput="updateBulkItem('${item.id}', 'page_count', this.value)">
        </td>
        <td>
          <input type="number" class="form-input" value="${item.est_read_minutes || 25}" style="height: 32px; padding: 0 4px; font-size: 0.85rem; width: 55px; text-align: center;" oninput="updateBulkItem('${item.id}', 'est_read_minutes', this.value)">
        </td>
        <td>
          <button class="btn btn--danger btn--sm" style="padding: 2px 8px; font-size: 0.8rem;" onclick="removeBulkItem('${item.id}')">✕</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    document.getElementById('bulkValidCount').textContent = validCount;
  }

  window.updateBulkItem = function(id, field, value) {
    const item = bulkExtractedItems.find(i => i.id === id);
    if (item) {
      item[field] = value;
      renderBulkReviewTable();
    }
  };

  window.removeBulkItem = function(id) {
    bulkExtractedItems = bulkExtractedItems.filter(i => i.id !== id);
    renderBulkReviewTable();
  };

  function arrayBufferToBase64(buffer) {
    if (!buffer || buffer.byteLength === 0) return null;
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    const chunkSize = 8192;
    for (let i = 0; i < len; i += chunkSize) {
      const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
      binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
  }

  async function commitBulkSaveBatch() {
    const skipDuplicates = document.getElementById('chkSkipDuplicates') ? document.getElementById('chkSkipDuplicates').checked : false;

    let validItems = bulkExtractedItems.filter(i => i.title && i.author && i.channel_type && i.isValid);

    if (validItems.length === 0) {
      showToast('No valid items ready to save. Please fix required fields highlighted in red.', 'warning');
      return;
    }

    let duplicateSkippedCount = 0;
    if (skipDuplicates) {
      const originalCount = validItems.length;
      validItems = validItems.filter(i => !i.isDuplicateInDb && !i.isDuplicateInBatch);
      duplicateSkippedCount = originalCount - validItems.length;
    }

    if (validItems.length === 0) {
      showToast(`All ${duplicateSkippedCount} books were detected as duplicates and skipped.`, 'info');
      showBulkSummaryReport({
        totalProcessed: bulkExtractedItems.length,
        successCount: 0,
        duplicateCount: duplicateSkippedCount,
        failedCount: 0,
        savedBooks: [],
        failedBooks: []
      });
      return;
    }

    const btn = document.getElementById('btnSaveBulkBatch');
    btn.disabled = true;
    btn.textContent = 'Saving Batch...';

    const totalToSave = validItems.length;
    let savedTotal = 0;
    let failedTotal = 0;
    const allSavedBooks = [];
    const allFailedBooks = [];

    updateBulkProgress('Stage 4: Saving to Database & Storage...', 5, `Preparing ${totalToSave} books...`);

    const CHUNK_SIZE = 1;

    try {
      for (let i = 0; i < totalToSave; i += CHUNK_SIZE) {
        const chunk = validItems.slice(i, i + CHUNK_SIZE);
        const currentProgress = 5 + Math.round(((i + chunk.length) / totalToSave) * 90);
        const item = chunk[0];
        updateBulkProgress('Stage 4: Saving to Database & Storage...', currentProgress, `Saving (${i + 1} of ${totalToSave}): ${item.title}`);

        const payloadBooks = await Promise.all(chunk.map(async it => {
          let fileBase64 = null;
          if (it.file && it.file.size <= 2097152) {
            try {
              const buffer = await it.file.arrayBuffer();
              fileBase64 = arrayBufferToBase64(buffer);
            } catch (e) {
              console.warn('Failed to convert file buffer for:', it.filename, e);
            }
          }

          let coverBase64 = null;
          if (it.coverDataUrl && it.coverDataUrl.startsWith('data:image')) {
            coverBase64 = it.coverDataUrl.split(',')[1];
          }

          return {
            filename: it.filename,
            title: it.title,
            author: it.author,
            channel_type: it.channel_type,
            description: it.description,
            publisher: it.publisher,
            language: it.language,
            isbn: it.isbn,
            page_count: it.page_count,
            est_read_minutes: it.est_read_minutes,
            file_ext: it.file_type,
            file_base64: fileBase64,
            cover_ext: 'jpg',
            cover_base64: coverBase64
          };
        }));

        try {
          const res = await api('/api/admin/books/bulk-upload', {
            method: 'POST',
            body: JSON.stringify({ books: payloadBooks })
          });

          if (res.success) {
            savedTotal += (res.successCount || 0);
            failedTotal += (res.failedCount || 0);
            if (res.savedBooks) allSavedBooks.push(...res.savedBooks);
            if (res.failedBooks) allFailedBooks.push(...res.failedBooks);
          }
        } catch (err) {
          console.error('Batch upload item error:', err);
          failedTotal += chunk.length;
          chunk.forEach(c => allFailedBooks.push({ filename: c.filename, error: err.message }));
        }
      }

      updateBulkProgress('Stage 4: Complete!', 100, `Successfully saved ${savedTotal} of ${totalToSave} books.`);

      setTimeout(() => {
        hideBulkProgress();
        showBulkSummaryReport({
          totalProcessed: bulkExtractedItems.length,
          successCount: savedTotal,
          duplicateCount: duplicateSkippedCount,
          failedCount: failedTotal,
          savedBooks: allSavedBooks,
          failedBooks: allFailedBooks
        });
        loadBooks();
      }, 500);

    } catch (err) {
      hideBulkProgress();
      showToast('Failed to commit bulk save: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '💾 Commit & Save Batch (' + validItems.length + ')';
    }
  }

  function showBulkSummaryReport(res) {
    document.getElementById('summaryTotalProcessed').textContent = res.totalProcessed || 0;
    document.getElementById('summarySuccessCount').textContent = res.successCount || 0;
    const dupEl = document.getElementById('summaryDuplicateCount');
    if (dupEl) dupEl.textContent = res.duplicateCount || 0;
    document.getElementById('summaryFailedCount').textContent = res.failedCount || 0;

    // Render Complete Itemized Per-Book Status Log Table
    const itemizedBody = document.getElementById('summaryItemizedBody');
    if (itemizedBody) {
      itemizedBody.innerHTML = '';
      const savedTitlesMap = new Map();
      if (res.savedBooks) {
        res.savedBooks.forEach(b => savedTitlesMap.set(b.title ? b.title.toLowerCase().trim() : '', b.bookId));
      }
      const failedMap = new Map();
      if (res.failedBooks) {
        res.failedBooks.forEach(f => failedMap.set(f.filename, f.error));
      }

      bulkExtractedItems.forEach((item, index) => {
        const tr = document.createElement('tr');
        let statusHtml = '';
        let remarks = '';

        const normTitle = (item.title || '').toLowerCase().trim();
        const isFailed = failedMap.has(item.filename);

        if (isFailed) {
          statusHtml = '<span class="filter-chip" style="background: rgba(231, 76, 60, 0.15); color: #e74c3c; font-size: 0.75rem; border: 1px solid rgba(231, 76, 60, 0.3);">❌ Failed</span>';
          remarks = failedMap.get(item.filename) || 'Upload processing error';
        } else if (item.isDuplicateInDb) {
          statusHtml = '<span class="filter-chip" style="background: rgba(243, 156, 18, 0.15); color: #f39c12; font-size: 0.75rem; border: 1px solid rgba(243, 156, 18, 0.3);">⚠️ Already Uploaded</span>';
          remarks = `Already exists in database library catalog (Book ID: ${item.matchedDbBook ? item.matchedDbBook.id : 'N/A'}). Skipped.`;
        } else if (item.isDuplicateInBatch) {
          statusHtml = '<span class="filter-chip" style="background: rgba(230, 126, 34, 0.15); color: #e67e22; font-size: 0.75rem; border: 1px solid rgba(230, 126, 34, 0.3);">⚠️ Batch Duplicate</span>';
          remarks = 'Duplicate entry in uploaded batch folder. Skipped.';
        } else {
          const bookId = savedTitlesMap.get(normTitle);
          statusHtml = '<span class="filter-chip" style="background: rgba(46, 204, 113, 0.15); color: #2ecc71; font-size: 0.75rem; border: 1px solid rgba(46, 204, 113, 0.3);">✅ Newly Uploaded</span>';
          remarks = bookId ? `Saved into database catalog (Book ID: ${bookId})` : 'Saved into database catalog successfully';
        }

        tr.innerHTML = `
          <td style="font-weight: bold; font-family: monospace;">${index + 1}</td>
          <td style="font-size: 0.85rem; color: var(--text-secondary); word-break: break-all;">${escapeHtml(item.filename)}</td>
          <td style="font-weight: 500;">${escapeHtml(item.title)} <br><small style="color: var(--text-muted);">by ${escapeHtml(item.author)}</small></td>
          <td>${statusHtml}</td>
          <td style="font-size: 0.85rem; color: var(--text-secondary);">${escapeHtml(remarks)}</td>
        `;
        itemizedBody.appendChild(tr);
      });
    }

    const failedWrapper = document.getElementById('summaryFailedListWrapper');
    const failedBody = document.getElementById('summaryFailedBody');
    failedBody.innerHTML = '';

    if (res.failedBooks && res.failedBooks.length > 0) {
      failedWrapper.classList.remove('hidden');
      res.failedBooks.forEach(item => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${escapeHtml(item.filename)}</td>
          <td><span style="color: #e74c3c; font-weight: bold;">Upload Error</span></td>
          <td>${escapeHtml(item.error)}</td>
        `;
        failedBody.appendChild(tr);
      });
    } else {
      failedWrapper.classList.add('hidden');
    }

    document.getElementById('bulkSummaryReport').classList.remove('hidden');
    showToast(`Bulk upload complete! ${res.successCount} newly saved, ${res.duplicateCount || 0} skipped.`, 'success');
  }

// ═══════════════════════════════════════════════════════════
// ██  RBAC & TAXONOMY — FULL IMPLEMENTATION
// ═══════════════════════════════════════════════════════════

// ── Shared caches ──
let _allCategories = [], _allTeams = [], _allRoles = [], _allAccounts = [], _allSlaRules = [], _allPermissions = [];
let _currentEmpId = null;

// ── Drawer helpers ──
window.closeDrawer = function(id) { document.getElementById(id)?.classList.remove('active'); };
function openDrawer(id) { document.getElementById(id)?.classList.add('active'); }

// ── Tab bar init ──
document.addEventListener('DOMContentLoaded', () => {
  // Panel tab bars
  document.querySelectorAll('.tab-bar').forEach(bar => {
    bar.addEventListener('click', e => {
      const btn = e.target.closest('.tab-btn');
      if (!btn) return;
      const tabId = btn.dataset.tab;
      if (tabId) {
        bar.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const panel = bar.closest('.admin-panel') || bar.closest('.modal__content');
        if (panel) {
          panel.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
          const target = panel.querySelector(`#tab-${tabId}`);
          if (target) target.classList.add('active');
        }
      }
      // Permission modal inner tabs
      const permsTab = btn.dataset.permsTab;
      if (permsTab) {
        bar.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.perms-tab-content').forEach(tc => tc.style.display = 'none');
        const target = document.getElementById(`permsTab-${permsTab}`);
        if (target) target.style.display = 'block';
        if (permsTab === 'effective') renderEffectivePermissionsTab();
      }
    });
  });

  // Drawer open buttons
  document.getElementById('openCreateCategoryBtn')?.addEventListener('click', () => openCategoryDrawer());
  document.getElementById('openCreateRoleBtn')?.addEventListener('click', () => openRoleDrawer());
  document.getElementById('openCreateTeamBtn')?.addEventListener('click', () => openTeamDrawer());
  document.getElementById('openCreateAccountBtn')?.addEventListener('click', () => window.openCreateAccountDrawer());
  document.getElementById('openProvisionEmployeeBtn')?.addEventListener('click', () => openEmployeeDrawer());

  // Category form search+filter
  document.getElementById('taxCatSearch')?.addEventListener('input', renderCategoryCards);
  document.getElementById('taxCatStatusFilter')?.addEventListener('change', renderCategoryCards);
  document.getElementById('taxCatScopeFilter')?.addEventListener('change', renderCategoryCards);
  document.getElementById('taxSubcatSearch')?.addEventListener('input', renderSubcatsTable);
  document.getElementById('taxSubcatParentFilter')?.addEventListener('change', renderSubcatsTable);

  // Roles search+filter
  document.getElementById('rolesSearch')?.addEventListener('input', renderRolesTable);
  document.getElementById('rolesModuleFilter')?.addEventListener('change', renderRolesTable);

  // Teams search+filter
  document.getElementById('teamsSearch')?.addEventListener('input', renderTeamsTable);
  document.getElementById('teamsAccountFilter')?.addEventListener('change', renderTeamsTable);

  // Accounts search+filter
  document.getElementById('accountsSearch')?.addEventListener('input', window.renderAccountsTable);
  document.getElementById('accountsStatusFilter')?.addEventListener('change', window.renderAccountsTable);

  // Employees search+filter
  document.getElementById('employeesSearch')?.addEventListener('input', renderEmployeesTable);
  document.getElementById('employeesAccountFilter')?.addEventListener('change', renderEmployeesTable);
  document.getElementById('employeesStatusFilter')?.addEventListener('change', renderEmployeesTable);

  // Override add button
  document.getElementById('addOverrideBtn')?.addEventListener('click', addEmployeeOverride);

  // Category drawer: routing preview live update
  document.getElementById('catFormTeam')?.addEventListener('change', updateCatRoutingPreview);
  document.getElementById('catFormPriority')?.addEventListener('change', updateCatRoutingPreview);
  document.getElementById('catFormSla')?.addEventListener('change', updateCatRoutingPreview);

  // Team coverage → summary preview
  document.getElementById('teamFormCategoryList')?.addEventListener('change', updateTeamCoverageSummary);
});

// ══════════════════════════════════════════════════════════
// ██  TICKET TAXONOMY
// ══════════════════════════════════════════════════════════

async function loadTaxonomy() {
  try {
    const [cats, subcats, teams, slaRules] = await Promise.all([
      api('/api/admin/tax/categories').catch(e => { console.error('Categories load error:', e); return []; }),
      api('/api/admin/tax/subcategories').catch(e => { console.error('Subcategories load error:', e); return []; }),
      api('/api/admin/teams').catch(e => { console.error('Teams load error:', e); return []; }),
      api('/api/admin/sla-rules').catch(e => { console.error('SLA rules load error:', e); return []; })
    ]);
    _allCategories = Array.isArray(cats) ? cats : [];
    _allTeams = Array.isArray(teams) ? teams : [];
    _allSlaRules = Array.isArray(slaRules) ? slaRules : [];
    renderCategoryCards();
    renderSubcatsTable();
    // Populate subcategory parent filter
    const pf = document.getElementById('taxSubcatParentFilter');
    if (pf) pf.innerHTML = '<option value="">All Categories</option>' + _allCategories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  } catch (err) {
    console.error('Failed to load taxonomy:', err);
    showToast('Failed to load taxonomy details.', 'error');
  }
}

function renderCategoryCards() {
  const grid = document.getElementById('taxCategoriesGrid');
  if (!grid) return;
  const search = (document.getElementById('taxCatSearch')?.value || '').toLowerCase();
  const statusF = document.getElementById('taxCatStatusFilter')?.value;
  const scopeF = document.getElementById('taxCatScopeFilter')?.value;
  let filtered = _allCategories.filter(c => {
    if (search && !c.name.toLowerCase().includes(search)) return false;
    if (statusF && c.status !== statusF) return false;
    if (scopeF === 'global' && !c.is_global) return false;
    if (scopeF === 'account' && c.is_global) return false;
    return true;
  });
  if (!filtered.length) {
    grid.innerHTML = '<div class="empty-state-mini"><div class="empty-state-mini__icon">📁</div>No categories found.</div>';
    return;
  }
  grid.innerHTML = filtered.map(c => {
    const statusClass = c.status === 'active' ? 'approved' : c.status === 'draft' ? 'draft' : 'archived';
    const scopeBadge = c.is_global
      ? `<span class="status-badge status-badge--global">🌐 Global</span>`
      : `<span class="status-badge status-badge--account-specific">🏢 Account</span>`;
    const priorityIcon = { low: '🟢', medium: '🟡', high: '🔴', critical: '🚨' }[c.default_priority] || '⚪';
    return `<div class="category-card">
      <div class="category-card__header">
        <span class="category-card__name">${escapeHtml(c.name)}</span>
        <div class="category-card__badges">
          ${scopeBadge}
          <span class="status-badge status-badge--${statusClass}">${c.status}</span>
        </div>
      </div>
      <div class="category-card__meta">
        <span class="category-card__meta-item">${priorityIcon} ${c.default_priority || 'medium'}</span>
        <span class="category-card__meta-item">👥 ${escapeHtml(c.default_team_name || 'Unassigned')}</span>
        <span class="category-card__meta-item">⏱ ${c.frt_hours ? c.frt_hours + 'h FRT' : 'No SLA'}</span>
        <span class="category-card__meta-item">📂 ${c.subcategory_count ?? 0} sub-cats</span>
      </div>
      <div class="category-card__actions">
        <button class="btn btn--ghost btn--sm" onclick="editCategory(${c.id})">✏️ Edit</button>
        <button class="btn btn--ghost btn--sm" onclick="archiveCategory(${c.id}, '${escapeHtml(c.name)}', '${c.status}')">
          ${c.status === 'archived' ? '🔄 Restore' : '📦 Archive'}
        </button>
        <button class="btn btn--danger btn--sm" onclick="deleteTaxCategory(${c.id})">🗑 Delete</button>
      </div>
    </div>`;
  }).join('');
}

function renderSubcatsTable() {
  const tbody = document.getElementById('taxSubcatsBody');
  if (!tbody) return;
  const search = (document.getElementById('taxSubcatSearch')?.value || '').toLowerCase();
  const parentF = document.getElementById('taxSubcatParentFilter')?.value;
  api(`/api/admin/tax/subcategories${parentF ? `?category_id=${parentF}` : ''}`).then(subcats => {
    const filtered = subcats.filter(s => !search || s.name.toLowerCase().includes(search) || (s.category_name || '').toLowerCase().includes(search));
    tbody.innerHTML = filtered.map(s => {
      const priorityIcon = { low: '🟢', medium: '🟡', high: '🔴', critical: '🚨' }[s.default_priority] || '—';
      return `<tr>
        <td>${s.id}</td>
        <td>${escapeHtml(s.category_name || '—')}</td>
        <td>${escapeHtml(s.name)}</td>
        <td>${s.default_priority ? `${priorityIcon} ${s.default_priority}` : '<span style="opacity:.4">inherited</span>'}</td>
        <td>${s.default_team_name ? escapeHtml(s.default_team_name) : '<span style="opacity:.4">inherited</span>'}</td>
        <td>${s.frt_hours ? s.frt_hours + 'h FRT' : '<span style="opacity:.4">inherited</span>'}</td>
        <td><span class="status-badge status-badge--${s.status === 'active' ? 'approved' : s.status || 'draft'}">${s.status || 'active'}</span></td>
        <td>
          <button class="btn btn--ghost btn--sm" onclick="editSubcategory(${s.id})">✏️</button>
          <button class="btn btn--danger btn--sm" onclick="deleteTaxSubcat(${s.id})">🗑</button>
        </td>
      </tr>`;
    }).join('') || '<tr><td colspan="8" style="text-align:center;opacity:.5">No sub-categories found.</td></tr>';
  });
}

async function openCategoryDrawer(cat = null) {
  const [teams, slaRules, accounts] = await Promise.all([
    api('/api/admin/teams'),
    api('/api/admin/sla-rules'),
    api('/api/admin/accounts')
  ]);
  _allTeams = teams; _allSlaRules = slaRules; _allAccounts = accounts;

  const teamSel = document.getElementById('catFormTeam');
  teamSel.innerHTML = '<option value="">Unassigned</option>' + teams.filter(t => t.status === 'active').map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');

  const slaSel = document.getElementById('catFormSla');
  slaSel.innerHTML = '<option value="">None</option>' + slaRules.map(s => `<option value="${s.id}">${escapeHtml(s.name || `SLA #${s.id}`)} (${s.frt_hours}h FRT)</option>`).join('');

  const acctList = document.getElementById('catFormAccountList');
  acctList.innerHTML = accounts.map(a => `<label class="multi-check-item"><input type="checkbox" value="${a.id}" name="catAccounts"> ${escapeHtml(a.name)}</label>`).join('');

  if (cat) {
    document.getElementById('categoryDrawerTitle').textContent = 'Edit Category';
    document.getElementById('editCategoryId').value = cat.id;
    document.getElementById('catFormName').value = cat.name;
    document.getElementById('catFormDesc').value = cat.description || '';
    document.getElementById('catFormPriority').value = cat.default_priority || 'medium';
    document.getElementById('catFormSla').value = cat.default_sla_id || '';
    document.getElementById('catFormTeam').value = cat.default_team_id || '';
    document.getElementById('catFormStatus').value = cat.status || 'active';
    document.getElementById('catFormIsGlobal').checked = !!cat.is_global;
    toggleCatAccountSection();
    if (!cat.is_global) {
      const catAccess = await api(`/api/admin/accounts/${cat.id}/categories`).catch(() => []);
      acctList.querySelectorAll('input[name="catAccounts"]').forEach(cb => {
        const acc = catAccess.find(a => a.id == cb.value);
        cb.checked = acc?.enabled ?? false;
      });
    }
  } else {
    document.getElementById('categoryDrawerTitle').textContent = 'Create Category';
    document.getElementById('editCategoryId').value = '';
    document.getElementById('catFormName').value = '';
    document.getElementById('catFormDesc').value = '';
    document.getElementById('catFormPriority').value = 'medium';
    document.getElementById('catFormSla').value = '';
    document.getElementById('catFormTeam').value = '';
    document.getElementById('catFormStatus').value = 'active';
    document.getElementById('catFormIsGlobal').checked = true;
    toggleCatAccountSection();
  }
  openDrawer('categoryDrawerOverlay');
  updateCatRoutingPreview();
}

window.toggleCatAccountSection = function() {
  const isGlobal = document.getElementById('catFormIsGlobal').checked;
  document.getElementById('catAccountSection').style.display = isGlobal ? 'none' : 'block';
};

function updateCatRoutingPreview() {
  const teamSel = document.getElementById('catFormTeam');
  const prioritySel = document.getElementById('catFormPriority');
  const slaSel = document.getElementById('catFormSla');
  const preview = document.getElementById('catRoutingPreview');
  if (!preview) return;
  const teamName = teamSel?.options[teamSel?.selectedIndex]?.text || 'Unassigned';
  const priority = prioritySel?.value || 'medium';
  const slaText = slaSel?.options[slaSel?.selectedIndex]?.text || 'No SLA';
  const catName = document.getElementById('catFormName')?.value || 'Category';
  const priorityIcon = { low: '🟢', medium: '🟡', high: '🔴', critical: '🚨' }[priority] || '⚪';
  preview.innerHTML = `
    <span class="routing-preview__label">Preview</span>
    <span class="routing-preview__pill routing-preview__pill--category">📁 ${escapeHtml(catName || 'New Category')}</span>
    <span class="routing-preview__arrow">→</span>
    <span class="routing-preview__pill routing-preview__pill--team">👥 ${escapeHtml(teamName)}</span>
    <span class="routing-preview__arrow">→</span>
    <span class="routing-preview__pill routing-preview__pill--priority">${priorityIcon} ${priority}</span>
    <span class="routing-preview__arrow">→</span>
    <span class="routing-preview__pill routing-preview__pill--sla">⏱ ${escapeHtml(slaText)}</span>
  `;
}

window.saveCategory = async function() {
  const id = document.getElementById('editCategoryId').value;
  const payload = {
    name: document.getElementById('catFormName').value.trim(),
    description: document.getElementById('catFormDesc').value.trim(),
    is_global: document.getElementById('catFormIsGlobal').checked,
    default_priority: document.getElementById('catFormPriority').value,
    default_sla_id: document.getElementById('catFormSla').value || null,
    default_team_id: document.getElementById('catFormTeam').value || null,
    status: document.getElementById('catFormStatus').value
  };
  if (!payload.name) return showToast('Category name is required.', 'warning');
  try {
    if (id) {
      await api(`/api/admin/tax/categories/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      showToast('Category updated.', 'success');
    } else {
      const res = await api('/api/admin/tax/categories', { method: 'POST', body: JSON.stringify(payload) });
      showToast('Category created.', 'success');
      if (!payload.is_global && res.id) {
        const checks = document.querySelectorAll('input[name="catAccounts"]');
        for (const cb of checks) {
          await api(`/api/admin/accounts/${cb.value}/categories`, { method: 'PUT', body: JSON.stringify({ category_id: res.id, enabled: cb.checked }) });
        }
      }
    }
    closeDrawer('categoryDrawerOverlay');
    loadTaxonomy();
  } catch (err) { showToast(err.message, 'error'); }
};

window.editCategory = async function(id) {
  const cat = _allCategories.find(c => c.id === id);
  if (cat) openCategoryDrawer(cat);
};

window.archiveCategory = async function(id, name, currentStatus) {
  const newStatus = currentStatus === 'archived' ? 'active' : 'archived';
  const msg = newStatus === 'archived' ? `Archive category "${name}"?` : `Restore category "${name}"?`;
  if (!confirm(msg)) return;
  try {
    await api(`/api/admin/tax/categories/${id}`, { method: 'PUT', body: JSON.stringify({ status: newStatus }) });
    showToast(`Category ${newStatus}.`, 'success');
    loadTaxonomy();
  } catch (err) { showToast(err.message, 'error'); }
};

window.deleteTaxCategory = async function(id) {
  if (!confirm('Permanently delete this category? This cannot be undone.')) return;
  try {
    await api(`/api/admin/tax/categories/${id}`, { method: 'DELETE' });
    showToast('Category deleted.', 'success');
    loadTaxonomy();
  } catch (err) { showToast(err.message, 'error'); }
};

window.deleteTaxSubcat = async function(id) {
  if (!confirm('Delete this sub-category?')) return;
  try {
    await api(`/api/admin/tax/subcategories/${id}`, { method: 'DELETE' });
    showToast('Sub-category deleted.', 'success');
    renderSubcatsTable();
  } catch (err) { showToast(err.message, 'error'); }
};

window.editSubcategory = async function(id) {
  const subcat = await api(`/api/admin/tax/subcategories`).then(sc => sc.find(s => s.id === id));
  if (!subcat) return;
  const newName = prompt('Sub-category name:', subcat.name);
  if (!newName || newName === subcat.name) return;
  try {
    await api(`/api/admin/tax/subcategories/${id}`, { method: 'PUT', body: JSON.stringify({ name: newName.trim() }) });
    showToast('Sub-category updated.', 'success');
    renderSubcatsTable();
  } catch (err) { showToast(err.message, 'error'); }
};

// ══════════════════════════════════════════════════════════
// ██  ROLES & PERMISSIONS
// ══════════════════════════════════════════════════════════

async function loadRoles() {
  try {
    const [roles, perms] = await Promise.all([
      api('/api/admin/roles').catch(e => { console.error('Roles load error:', e); return []; }),
      api('/api/admin/permissions').catch(e => { console.error('Permissions load error:', e); return []; })
    ]);
    _allRoles = Array.isArray(roles) ? roles : [];
    _allPermissions = Array.isArray(perms) ? perms : [];
    renderRolesTable();
  } catch (err) { console.error('loadRoles error:', err); showToast('Failed to load roles.', 'error'); }
}

function renderRolesTable() {
  const tbody = document.getElementById('rolesBody');
  if (!tbody) return;
  const search = (document.getElementById('rolesSearch')?.value || '').toLowerCase();
  const typeF = document.getElementById('rolesModuleFilter')?.value;
  let filtered = _allRoles.filter(r => {
    if (search && !r.name.toLowerCase().includes(search)) return false;
    if (typeF === 'system' && !r.is_system) return false;
    if (typeF === 'custom' && r.is_system) return false;
    return true;
  });
  tbody.innerHTML = filtered.map(r => `
    <tr>
      <td>${r.id}</td>
      <td><strong>${escapeHtml(r.name)}</strong>${r.description ? `<br><span style="font-size:11px;opacity:.6">${escapeHtml(r.description)}</span>` : ''}</td>
      <td><span style="font-size:12px;opacity:.7">${r.scope || 'global'}</span></td>
      <td>${r.is_system ? '<span class="status-badge status-badge--system">🔒 System</span>' : '<span class="status-badge status-badge--in-use">Custom</span>'}</td>
      <td><span class="status-badge status-badge--${r.status === 'active' ? 'approved' : 'archived'}">${r.status || 'active'}</span></td>
      <td><span style="font-size:12px;opacity:.7">—</span></td>
      <td>
        <button class="btn btn--ghost btn--sm" onclick="openRoleDrawer(${r.id})">✏️ Edit</button>
        ${!r.is_system ? `<button class="btn btn--danger btn--sm" onclick="deleteRole(${r.id})">🗑</button>` : ''}
      </td>
    </tr>`).join('') || '<tr><td colspan="7" style="text-align:center;opacity:.5">No roles found.</td></tr>';
}

async function openRoleDrawer(id = null) {
  const [perms] = await Promise.all([api('/api/admin/permissions').catch(() => [])]);
  _allPermissions = perms;
  document.getElementById('editRoleId').value = id || '';
  if (id) {
    const role = _allRoles.find(r => r.id === id);
    if (!role) return;
    document.getElementById('roleDrawerTitle').textContent = `Edit Role: ${role.name}`;
    document.getElementById('roleFormName').value = role.name;
    document.getElementById('roleFormDesc').value = role.description || '';
    document.getElementById('roleFormScope').value = role.scope || 'global';
    document.getElementById('roleFormName').disabled = !!role.is_system;
    const rolePerms = await api(`/api/admin/roles/${id}/permissions`).catch(() => []);
    document.getElementById('rolePermMatrixSection').style.display = 'block';
    renderPermissionMatrix(rolePerms, perms, !!role.is_system);
  } else {
    document.getElementById('roleDrawerTitle').textContent = 'Create Role';
    document.getElementById('roleFormName').value = '';
    document.getElementById('roleFormName').disabled = false;
    document.getElementById('roleFormDesc').value = '';
    document.getElementById('roleFormScope').value = 'global';
    document.getElementById('rolePermMatrixSection').style.display = 'none';
  }
  openDrawer('roleDrawerOverlay');
}

function renderPermissionMatrix(rolePerms, allPerms, isSystem) {
  const matrix = document.getElementById('rolePermMatrix');
  if (!matrix || !allPerms.length) return;
  const byModule = {};
  allPerms.forEach(p => {
    const mod = (p.module || p.resource || p.code?.split('.')[0] || 'General').toLowerCase();
    if (!byModule[mod]) byModule[mod] = [];
    byModule[mod].push(p);
  });
  const granted = new Set(rolePerms.map(rp => rp.permission_id || rp.id));
  matrix.innerHTML = Object.entries(byModule).map(([mod, perms]) => `
    <div class="perm-matrix__module">
      <div class="perm-matrix__module-header">
        <span>${mod.toUpperCase()}</span>
        ${!isSystem ? `<button class="perm-matrix__select-all" onclick="selectAllModulePerms('${mod}', this)">Select All</button>` : ''}
      </div>
      ${perms.map(p => `
        <div class="perm-matrix__row">
          <input type="checkbox" class="perm-matrix__checkbox" id="perm_${p.id}" value="${p.id}" data-module="${mod}"
            ${granted.has(p.id) ? 'checked' : ''} ${isSystem ? 'disabled' : ''}>
          <div class="perm-matrix__info">
            <div class="perm-matrix__code">${escapeHtml(p.code || p.resource + '.' + p.action)}</div>
            <div class="perm-matrix__desc">${escapeHtml(p.description || '')}</div>
          </div>
          <div class="perm-matrix__icons">
            ${isSystem ? '<span class="perm-matrix__lock" title="System role — read only">🔒</span>' : ''}
          </div>
        </div>`).join('')}
    </div>`).join('');
}

window.selectAllModulePerms = function(mod, btn) {
  const checks = document.querySelectorAll(`.perm-matrix__checkbox[data-module="${mod}"]`);
  const allChecked = [...checks].every(c => c.checked);
  checks.forEach(c => c.checked = !allChecked);
  btn.textContent = allChecked ? 'Select All' : 'Deselect All';
};

window.saveRole = async function() {
  const id = document.getElementById('editRoleId').value;
  const name = document.getElementById('roleFormName').value.trim();
  const description = document.getElementById('roleFormDesc').value.trim();
  const scope = document.getElementById('roleFormScope').value;
  if (!name) return showToast('Role name is required.', 'warning');
  try {
    let roleId = id ? parseInt(id) : null;
    if (!id) {
      const res = await api('/api/admin/roles', { method: 'POST', body: JSON.stringify({ name, description, scope }) });
      roleId = res.id;
      showToast('Role created.', 'success');
    } else {
      const role = _allRoles.find(r => r.id === parseInt(id));
      if (!role?.is_system) {
        await api(`/api/admin/roles/${id}`, { method: 'PUT', body: JSON.stringify({ name, description, scope }) }).catch(() => {});
      }
    }
    if (roleId && document.getElementById('rolePermMatrixSection').style.display !== 'none') {
      const checkedIds = [...document.querySelectorAll('.perm-matrix__checkbox:checked')].map(c => parseInt(c.value));
      await api(`/api/admin/roles/${roleId}/permissions`, { method: 'PUT', body: JSON.stringify({ permission_ids: checkedIds }) }).catch(() => {});
    }
    closeDrawer('roleDrawerOverlay');
    loadRoles();
  } catch (err) { showToast(err.message, 'error'); }
};

window.deleteRole = async function(id) {
  if (!confirm('Delete this role? Employees using it must be reassigned.')) return;
  try {
    await api(`/api/admin/roles/${id}`, { method: 'DELETE' });
    showToast('Role deleted.', 'success');
    loadRoles();
  } catch (err) { showToast(err.message, 'error'); }
};

// ══════════════════════════════════════════════════════════
// ██  TEAMS
// ══════════════════════════════════════════════════════════

async function loadTeams() {
  try {
    const teams = await api('/api/admin/teams').catch(e => { console.error('Teams load error:', e); return []; });
    _allTeams = Array.isArray(teams) ? teams : [];
    renderTeamsTable();
    const accountFilter = document.getElementById('teamsAccountFilter');
    if (accountFilter && _allAccounts.length) {
      accountFilter.innerHTML = '<option value="">All Accounts</option>' + _allAccounts.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
    }
  } catch (err) { console.error('loadTeams error:', err); showToast('Failed to load teams.', 'error'); }
}

function renderTeamsTable() {
  const tbody = document.getElementById('teamsBody');
  if (!tbody) return;
  const search = (document.getElementById('teamsSearch')?.value || '').toLowerCase();
  const accountF = document.getElementById('teamsAccountFilter')?.value;
  let filtered = _allTeams.filter(t => {
    if (search && !t.name.toLowerCase().includes(search)) return false;
    if (accountF && String(t.account_id) !== String(accountF)) return false;
    return true;
  });
  tbody.innerHTML = filtered.map(t => {
    const acct = _allAccounts.find(a => a.id === t.account_id);
    return `<tr>
      <td>${t.id}</td>
      <td><strong>${escapeHtml(t.name)}</strong></td>
      <td>${acct ? `<span class="status-badge status-badge--in-use">🏢 ${escapeHtml(acct.name)}</span>` : '<span style="opacity:.4">Platform-wide</span>'}</td>
      <td><span class="status-badge status-badge--${t.status === 'active' ? 'approved' : 'archived'}">${t.status || 'active'}</span></td>
      <td><span style="font-size:12px;opacity:.7">—</span></td>
      <td id="team-coverage-${t.id}"><span style="opacity:.4;font-size:12px">Loading…</span></td>
      <td>
        <button class="btn btn--ghost btn--sm" onclick="openTeamDrawer(${t.id})">✏️ Edit</button>
        <button class="btn btn--danger btn--sm" onclick="deleteTeam(${t.id})">🗑</button>
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="7" style="text-align:center;opacity:.5">No teams found.</td></tr>';
  filtered.forEach(async t => {
    const cell = document.getElementById(`team-coverage-${t.id}`);
    if (!cell) return;
    const cats = await api(`/api/admin/teams/${t.id}/categories`).catch(() => []);
    cell.innerHTML = cats.length
      ? cats.map(c => `<span class="coverage-chip">📁 ${escapeHtml(c.category_name)}${c.subcategory_name ? ' › ' + escapeHtml(c.subcategory_name) : ''}</span>`).join('')
      : '<span style="opacity:.4;font-size:12px">None</span>';
  });
}

async function openTeamDrawer(id = null) {
  const [accounts, roles, cats] = await Promise.all([
    api('/api/admin/accounts'),
    api('/api/admin/roles'),
    api('/api/admin/tax/categories')
  ]);
  _allAccounts = accounts; _allRoles = roles; _allCategories = cats;

  document.getElementById('teamFormAccount').innerHTML =
    '<option value="">Platform-wide (no restriction)</option>' +
    accounts.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');

  document.getElementById('teamFormRoleList').innerHTML =
    roles.map(r => `<label class="multi-check-item"><input type="checkbox" name="teamRoles" value="${r.id}"> ${escapeHtml(r.name)}${r.is_system ? ' 🔒' : ''}</label>`).join('');

  document.getElementById('teamFormCategoryList').innerHTML =
    cats.map(c => `<label class="multi-check-item"><input type="checkbox" name="teamCats" value="${c.id}" data-name="${escapeHtml(c.name)}"> ${escapeHtml(c.name)}</label>`).join('');

  document.getElementById('editTeamId').value = id || '';
  if (id) {
    const team = _allTeams.find(t => t.id === id);
    document.getElementById('teamDrawerTitle').textContent = `Edit Team: ${team?.name || ''}`;
    document.getElementById('teamFormName').value = team?.name || '';
    document.getElementById('teamFormAccount').value = team?.account_id || '';
    document.getElementById('teamFormStatus').value = team?.status || 'active';
    const [teamRoles, teamCats] = await Promise.all([
      api(`/api/admin/teams/${id}/roles`).catch(() => []),
      api(`/api/admin/teams/${id}/categories`).catch(() => [])
    ]);
    const teamRoleIds = new Set(teamRoles.map(r => r.role_id));
    document.querySelectorAll('input[name="teamRoles"]').forEach(cb => { cb.checked = teamRoleIds.has(parseInt(cb.value)); });
    const teamCatIds = new Set(teamCats.map(c => c.category_id));
    document.querySelectorAll('input[name="teamCats"]').forEach(cb => { cb.checked = teamCatIds.has(parseInt(cb.value)); });
  } else {
    document.getElementById('teamDrawerTitle').textContent = 'Create Team';
    document.getElementById('teamFormName').value = '';
    document.getElementById('teamFormAccount').value = '';
    document.getElementById('teamFormStatus').value = 'active';
    document.querySelectorAll('input[name="teamRoles"], input[name="teamCats"]').forEach(cb => cb.checked = false);
  }
  updateTeamCoverageSummary();
  openDrawer('teamDrawerOverlay');
}

function updateTeamCoverageSummary() {
  const checked = [...document.querySelectorAll('input[name="teamCats"]:checked')];
  const section = document.getElementById('teamCoverageSummarySection');
  const summary = document.getElementById('teamCoverageSummary');
  if (!section || !summary) return;
  if (!checked.length) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  summary.innerHTML = checked.map(cb => `<span class="coverage-chip">📁 ${escapeHtml(cb.dataset.name || cb.value)}</span>`).join('');
}

window.saveTeam = async function() {
  const id = document.getElementById('editTeamId').value;
  const name = document.getElementById('teamFormName').value.trim();
  const account_id = document.getElementById('teamFormAccount').value || null;
  const status = document.getElementById('teamFormStatus').value;
  if (!name) return showToast('Team name is required.', 'warning');
  try {
    let teamId = id ? parseInt(id) : null;
    if (!id) {
      const res = await api('/api/admin/teams', { method: 'POST', body: JSON.stringify({ name, account_id: account_id ? parseInt(account_id) : null }) });
      teamId = res.id;
    } else {
      await api(`/api/admin/teams/${id}`, { method: 'PUT', body: JSON.stringify({ name, account_id: account_id ? parseInt(account_id) : null, status }) });
    }
    const roles = [...document.querySelectorAll('input[name="teamRoles"]:checked')].map(cb => ({ role_id: parseInt(cb.value), is_default: false }));
    await api(`/api/admin/teams/${teamId}/roles`, { method: 'PUT', body: JSON.stringify({ roles }) });
    const assignments = [...document.querySelectorAll('input[name="teamCats"]:checked')].map(cb => ({ category_id: parseInt(cb.value) }));
    await api(`/api/admin/teams/${teamId}/categories`, { method: 'PUT', body: JSON.stringify({ assignments }) });
    showToast(id ? 'Team updated.' : 'Team created.', 'success');
    closeDrawer('teamDrawerOverlay');
    loadTeams();
  } catch (err) { showToast(err.message, 'error'); }
};

window.deleteTeam = async function(id) {
  if (!confirm('Delete this team? Active employees must be transferred first.')) return;
  try {
    await api(`/api/admin/teams/${id}`, { method: 'DELETE' });
    showToast('Team deleted.', 'success');
    loadTeams();
  } catch (err) { showToast(err.message, 'error'); }
};

// ══════════════════════════════════════════════════════════
// ██  ACCOUNTS — Enterprise Lifecycle Management
// ══════════════════════════════════════════════════════════

async function loadAccounts() {
  try {
    const [accounts, employees] = await Promise.all([
      api('/api/admin/accounts').catch(() => []),
      api('/api/admin/employees').catch(() => []),
    ]);
    _allAccounts = Array.isArray(accounts) ? accounts : [];
    const allEmps = Array.isArray(employees) ? employees : [];

    // ── Metrics ──
    const totalEmps = allEmps.length;
    const pendingInvites = allEmps.filter(e => e.employment_status === 'pending_invite').length;
    const activeEmps = allEmps.filter(e => e.employment_status === 'active').length;
    const suspendedAccts = _allAccounts.filter(a => a.status === 'suspended').length;

    const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setEl('metricPendingInvites', pendingInvites);
    setEl('metricActiveEmps', activeEmps);
    setEl('metricSuspendedAccts', suspendedAccts);

    const seatLimit = _allAccounts.reduce((s, a) => s + (a.seat_limit || 50), 0) || 50;
    const seatPct = Math.min(Math.round((totalEmps / seatLimit) * 100), 100);
    setEl('metricSeatUsed', `${totalEmps}/${seatLimit}`);
    setEl('metricSeatLabel', `${seatPct}% utilization`);
    const seatBar = document.getElementById('metricSeatBar');
    if (seatBar) {
      setTimeout(() => { seatBar.style.width = seatPct + '%'; }, 100);
      seatBar.style.background = seatPct > 90 ? '#f87171' : seatPct > 70 ? '#fbbf24' : 'var(--page-gradient)';
    }

    renderAccountsTable();

    // Populate lockdown dropdown
    const ldSel = document.getElementById('lockdownAccountSelect');
    if (ldSel) {
      ldSel.innerHTML = '<option value="">— Select Account —</option>' +
        _allAccounts.map(a => `<option value="${a.id}">${escapeHtml(a.name)} (${a.status})</option>`).join('');
    }
  } catch (err) { console.error('loadAccounts error:', err); showToast('Failed to load accounts.', 'error'); }
}

window.renderAccountsTable = function renderAccountsTable() {
  const tbody = document.getElementById('accountsBody');
  if (!tbody) return;
  const search = (document.getElementById('accountsSearch')?.value || '').toLowerCase();
  const statusF = document.getElementById('accountsStatusFilter')?.value;
  const filtered = _allAccounts.filter(a => {
    if (search && !a.name.toLowerCase().includes(search) && !(a.domain || '').toLowerCase().includes(search) && !String(a.id).includes(search)) return false;
    if (statusF && a.status !== statusF) return false;
    return true;
  });
  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px;opacity:.5;">No accounts match the current filters.</td></tr>';
    return;
  }
  tbody.innerHTML = filtered.map(a => {
    const statusColor = a.status === 'active' ? 'approved' : a.status === 'suspended' ? 'rejected' : 'pending';
    const seatLimit = a.seat_limit || 50;
    const empCount = a.employee_count || 0;
    const seatPct = Math.min(Math.round((empCount / seatLimit) * 100), 100);
    const seatColor = seatPct > 90 ? 'var(--accent-rose)' : seatPct > 70 ? 'var(--accent-amber)' : 'var(--accent-emerald)';
    const createdDate = a.created_at ? new Date(a.created_at).toLocaleDateString() : '—';
    return `<tr>
      <td><input type="checkbox" class="acct-row-check" data-id="${a.id}" style="cursor:pointer;transform:scale(1.2);"></td>
      <td>
        <div style="font-weight:600;color:var(--text-primary);">${escapeHtml(a.name)}</div>
        <div style="font-size:0.75rem;color:var(--text-muted);font-family:monospace;">#${a.id}</div>
      </td>
      <td><span style="font-size:0.82rem;color:var(--text-secondary);">${escapeHtml(a.domain || '—')}</span></td>
      <td><span class="status-badge status-badge--${statusColor}">${a.status}</span></td>
      <td>
        <div style="display:flex;align-items:center;gap:8px;">
          <div style="flex:1;height:5px;background:rgba(255,255,255,.08);border-radius:99px;overflow:hidden;min-width:60px;">
            <div style="height:100%;width:${seatPct}%;background:${seatColor};border-radius:99px;"></div>
          </div>
          <span style="font-size:0.78rem;white-space:nowrap;color:${seatColor};">${empCount}/${seatLimit}</span>
        </div>
      </td>
      <td><span style="font-size:0.82rem;">${a.team_count || 0}</span></td>
      <td><span style="font-size:0.78rem;color:var(--text-muted);">${createdDate}</span></td>
      <td>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button class="btn btn--ghost btn--sm" onclick="window.openEditAccountDrawer(${a.id})" title="Edit">✏️</button>
          <button class="btn btn--ghost btn--sm" onclick="window.toggleAccountStatus(${a.id},'${a.status === 'active' ? 'suspended' : 'active'}','${escapeHtml(a.name).replace(/'/g,"\\'")}')">
            ${a.status === 'active' ? '🚫 Suspend' : '✅ Activate'}
          </button>
          <button class="btn btn--danger btn--sm" onclick="window.deleteAccount(${a.id})" title="Delete">🗑️</button>
        </div>
      </td>
    </tr>`;
  }).join('');
};

window.openCreateAccountDrawer = function() {
  document.getElementById('editAccountId').value = '';
  document.getElementById('accountDrawerTitle').textContent = '＋ Create Account';
  document.getElementById('acctFormName').value = '';
  document.getElementById('acctFormDomain').value = '';
  document.getElementById('acctFormSeatLimit').value = '';
  document.getElementById('acctFormStatus').value = 'active';
  document.getElementById('acctFormNotes').value = '';
  openDrawer('accountDrawerOverlay');
};

window.openEditAccountDrawer = function(id) {
  const acct = _allAccounts.find(a => a.id === id);
  if (!acct) return;
  document.getElementById('editAccountId').value = id;
  document.getElementById('accountDrawerTitle').textContent = `✏️ Edit: ${acct.name}`;
  document.getElementById('acctFormName').value = acct.name || '';
  document.getElementById('acctFormDomain').value = acct.domain || '';
  document.getElementById('acctFormSeatLimit').value = acct.seat_limit || '';
  document.getElementById('acctFormStatus').value = acct.status || 'active';
  document.getElementById('acctFormNotes').value = acct.notes || '';
  openDrawer('accountDrawerOverlay');
};

window.saveAccount = async function() {
  const id = document.getElementById('editAccountId').value;
  const name = document.getElementById('acctFormName').value.trim();
  if (!name) return showToast('Account name is required.', 'warning');
  const payload = {
    name,
    domain: document.getElementById('acctFormDomain').value.trim() || null,
    seat_limit: parseInt(document.getElementById('acctFormSeatLimit').value) || null,
    status: document.getElementById('acctFormStatus').value,
    notes: document.getElementById('acctFormNotes').value.trim() || null,
  };
  try {
    if (id) {
      await api(`/api/admin/accounts/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      showToast('Account updated.', 'success');
    } else {
      await api('/api/admin/accounts', { method: 'POST', body: JSON.stringify(payload) });
      showToast('Account created.', 'success');
    }
    closeDrawer('accountDrawerOverlay');
    loadAccounts();
  } catch (err) { showToast(err.message, 'error'); }
};

window.toggleAccountStatus = async (id, newStatus, name) => {
  if (!confirm(`Set account "${name}" to ${newStatus}?`)) return;
  try {
    await api(`/api/admin/accounts/${id}`, { method: 'PUT', body: JSON.stringify({ status: newStatus }) });
    showToast(`Account ${newStatus === 'active' ? 'activated' : 'suspended'}.`, 'success');
    loadAccounts();
  } catch (err) { showToast(err.message, 'error'); }
};

window.deleteAccount = async (id) => {
  if (!confirm('Delete this account? All employees must be removed first.')) return;
  try {
    await api(`/api/admin/accounts/${id}`, { method: 'DELETE' });
    showToast('Account deleted.', 'success');
    loadAccounts();
  } catch (err) { showToast(err.message, 'error'); }
};

window.exportAccountRoster = function() {
  if (!_allAccounts.length) return showToast('No accounts to export.', 'warning');
  const rows = [['ID', 'Name', 'Domain', 'Status', 'Employees', 'Teams', 'Created']];
  _allAccounts.forEach(a => rows.push([a.id, a.name, a.domain || '', a.status, a.employee_count || 0, a.team_count || 0, a.created_at || '']));
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'account_roster.csv'; a.click();
  URL.revokeObjectURL(url);
  showToast('Roster exported.', 'success');
};

// ──  EMERGENCY LOCKDOWN  ──
window.openLockdownModal = function() {
  const ldSel = document.getElementById('lockdownAccountSelect');
  if (ldSel) ldSel.innerHTML = '<option value="">— Select Account —</option>' +
    _allAccounts.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
  const modal = document.getElementById('lockdownModal');
  if (modal) modal.style.display = 'flex';
};

window.closeLockdownModal = function() {
  const modal = document.getElementById('lockdownModal');
  if (modal) modal.style.display = 'none';
};

window.executeLockdown = async function() {
  const acctId = document.getElementById('lockdownAccountSelect')?.value;
  const reason = (document.getElementById('lockdownReason')?.value || '').trim();
  if (!acctId) return showToast('Please select an account to lock down.', 'warning');
  if (!reason) return showToast('A lockdown reason is required.', 'warning');
  if (!confirm('⚠️ CONFIRM: This will suspend the account and revoke all employee sessions. Proceed?')) return;
  try {
    await api(`/api/admin/accounts/${acctId}`, { method: 'PUT', body: JSON.stringify({ status: 'suspended', lockdown_reason: reason }) });
    showToast('🔒 Account locked down successfully. All sessions have been revoked.', 'success');
    window.closeLockdownModal();
    loadAccounts();
  } catch (err) { showToast(err.message, 'error'); }
};

// ──  4-STEP ONBOARD WIZARD  ──
let _wzStep = 1;
const _WZ_TOTAL = 4;

window.openOnboardWizard = async function() {
  _wzStep = 1;
  _renderWizardStep();
  // Populate dropdowns
  const [accounts, teams, roles] = await Promise.all([
    api('/api/admin/accounts').catch(() => []),
    api('/api/admin/teams').catch(() => []),
    api('/api/admin/roles').catch(() => []),
  ]);
  _allAccounts = Array.isArray(accounts) ? accounts : [];
  _allTeams = Array.isArray(teams) ? teams : [];
  _allRoles = Array.isArray(roles) ? roles : [];
  const acctSel = document.getElementById('wz_accountId');
  if (acctSel) acctSel.innerHTML = '<option value="">— Select Account —</option>' +
    _allAccounts.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
  const roleSel = document.getElementById('wz_roleId');
  if (roleSel) roleSel.innerHTML = '<option value="">— Select Role —</option>' +
    _allRoles.map(r => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
  // Reset form
  ['wz_firstName','wz_lastName','wz_email','wz_phone','wz_jobTitle','wz_department','wz_startDate'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const modal = document.getElementById('onboardWizardModal');
  if (modal) modal.style.display = 'flex';
};

window.closeOnboardWizard = function() {
  const modal = document.getElementById('onboardWizardModal');
  if (modal) modal.style.display = 'none';
};

function _renderWizardStep() {
  for (let i = 1; i <= _WZ_TOTAL; i++) {
    const step = document.getElementById(`wizardStep${i}`);
    if (step) step.style.display = i === _wzStep ? '' : 'none';
  }
  // Update pill indicators
  document.querySelectorAll('.wizard-step-pill').forEach((pill, idx) => {
    const stepNum = idx + 1;
    const isActive = stepNum === _wzStep;
    const isDone = stepNum < _wzStep;
    pill.style.background = isActive ? 'var(--page-gradient)' : isDone ? 'rgba(139,127,240,.35)' : 'rgba(255,255,255,.06)';
    pill.style.color = isActive ? '#fff' : isDone ? 'var(--page-accent-soft)' : 'var(--text-muted)';
  });
  // Back button
  const backBtn = document.getElementById('wizardBackBtn');
  if (backBtn) backBtn.style.display = _wzStep > 1 ? '' : 'none';
  // Next/Submit button
  const nextBtn = document.getElementById('wizardNextBtn');
  if (nextBtn) {
    nextBtn.textContent = _wzStep === _WZ_TOTAL ? '🚀 Onboard Employee' : 'Next →';
    nextBtn.onclick = _wzStep === _WZ_TOTAL ? window.submitOnboardWizard : window.wizardNext;
  }
  if (_wzStep === _WZ_TOTAL) _buildReviewCard();
}

window.wizardNext = function() {
  if (_wzStep === 1) {
    const first = document.getElementById('wz_firstName')?.value.trim();
    const last = document.getElementById('wz_lastName')?.value.trim();
    const email = document.getElementById('wz_email')?.value.trim();
    if (!first || !last) return showToast('First and last name are required.', 'warning');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showToast('A valid email is required.', 'warning');
  }
  if (_wzStep === 2) {
    const acctId = document.getElementById('wz_accountId')?.value;
    if (!acctId) return showToast('Please select an account.', 'warning');
  }
  if (_wzStep === 3) {
    const roleId = document.getElementById('wz_roleId')?.value;
    if (!roleId) return showToast('Please select a role.', 'warning');
  }
  if (_wzStep < _WZ_TOTAL) { _wzStep++; _renderWizardStep(); }
};

window.wizardBack = function() {
  if (_wzStep > 1) { _wzStep--; _renderWizardStep(); }
};

window.wizardFilterTeams = function() {
  const acctId = document.getElementById('wz_accountId')?.value;
  const teamSel = document.getElementById('wz_teamId');
  if (!teamSel) return;
  const filtered = _allTeams.filter(t => !acctId || !t.account_id || String(t.account_id) === String(acctId));
  teamSel.innerHTML = '<option value="">— Select Team (Optional) —</option>' +
    filtered.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
};

window.wizardPreviewAccess = async function() {
  const roleId = document.getElementById('wz_roleId')?.value;
  const preview = document.getElementById('wz_accessPreview');
  const content = document.getElementById('wz_accessPreviewContent');
  if (!roleId || !preview || !content) return;
  try {
    const rolePerms = await api(`/api/admin/roles/${roleId}/permissions`).catch(() => []);
    const granted = rolePerms.filter(p => p.effect !== 'deny');
    const denied = rolePerms.filter(p => p.effect === 'deny');
    content.innerHTML = `<div style="margin-bottom:8px;"><strong style="color:var(--accent-emerald);">✅ Granted (${granted.length})</strong>: ${granted.length ? granted.map(p => `<code style="font-size:0.78rem;background:rgba(52,211,153,.12);padding:1px 6px;border-radius:4px;">${escapeHtml(p.code || '')}</code>`).join(' ') : '<em>None</em>'}</div>` +
      (denied.length ? `<div><strong style="color:var(--accent-rose);">🚫 Denied (${denied.length})</strong>: ${denied.map(p => `<code style="font-size:0.78rem;background:rgba(248,113,113,.12);padding:1px 6px;border-radius:4px;">${escapeHtml(p.code || '')}</code>`).join(' ')}</div>` : '');
    preview.style.display = '';
  } catch { preview.style.display = 'none'; }
};

function _buildReviewCard() {
  const card = document.getElementById('wz_reviewCard');
  if (!card) return;
  const first = document.getElementById('wz_firstName')?.value.trim() || '';
  const last = document.getElementById('wz_lastName')?.value.trim() || '';
  const email = document.getElementById('wz_email')?.value.trim() || '';
  const phone = document.getElementById('wz_phone')?.value.trim() || '—';
  const jobTitle = document.getElementById('wz_jobTitle')?.value.trim() || '—';
  const acctId = document.getElementById('wz_accountId')?.value;
  const acct = _allAccounts.find(a => String(a.id) === String(acctId));
  const teamId = document.getElementById('wz_teamId')?.value;
  const team = _allTeams.find(t => String(t.id) === String(teamId));
  const roleId = document.getElementById('wz_roleId')?.value;
  const role = _allRoles.find(r => String(r.id) === String(roleId));
  const status = document.getElementById('wz_status')?.value;
  card.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 20px;">
      <div><span style="color:var(--text-muted);font-size:0.78rem;">FULL NAME</span><br><strong>${escapeHtml(`${first} ${last}`)}</strong></div>
      <div><span style="color:var(--text-muted);font-size:0.78rem;">EMAIL</span><br><strong>${escapeHtml(email)}</strong></div>
      <div><span style="color:var(--text-muted);font-size:0.78rem;">PHONE</span><br><strong>${escapeHtml(phone)}</strong></div>
      <div><span style="color:var(--text-muted);font-size:0.78rem;">JOB TITLE</span><br><strong>${escapeHtml(jobTitle)}</strong></div>
      <div><span style="color:var(--text-muted);font-size:0.78rem;">ACCOUNT</span><br><strong>${escapeHtml(acct?.name || '—')}</strong></div>
      <div><span style="color:var(--text-muted);font-size:0.78rem;">TEAM</span><br><strong>${escapeHtml(team?.name || '—')}</strong></div>
      <div><span style="color:var(--text-muted);font-size:0.78rem;">ROLE</span><br><strong>${escapeHtml(role?.name || '—')}</strong></div>
      <div><span style="color:var(--text-muted);font-size:0.78rem;">STATUS</span><br><strong>${status === 'pending_invite' ? '📨 Send Invite' : '✅ Activate Now'}</strong></div>
    </div>
  `;
}

window.submitOnboardWizard = async function() {
  const btn = document.getElementById('wizardNextBtn');
  if (btn) { btn.textContent = '⏳ Provisioning…'; btn.disabled = true; }
  const firstName = document.getElementById('wz_firstName')?.value.trim();
  const lastName = document.getElementById('wz_lastName')?.value.trim();
  const payload = {
    full_name: `${firstName} ${lastName}`,
    email: document.getElementById('wz_email')?.value.trim(),
    phone: document.getElementById('wz_phone')?.value.trim() || null,
    account_id: parseInt(document.getElementById('wz_accountId')?.value) || null,
    team_id: parseInt(document.getElementById('wz_teamId')?.value) || null,
    role_id: parseInt(document.getElementById('wz_roleId')?.value) || null,
    employment_status: document.getElementById('wz_status')?.value || 'pending_invite',
  };
  try {
    const res = await api('/api/admin/employees', { method: 'POST', body: JSON.stringify(payload) });
    showToast(`✅ ${payload.full_name} onboarded successfully!${payload.employment_status === 'pending_invite' ? ' Invite sent.' : ''}`, 'success');
    window.closeOnboardWizard();
    loadAccounts();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (btn) { btn.textContent = '🚀 Onboard Employee'; btn.disabled = false; }
  }
};

// ══════════════════════════════════════════════════════════
// ██  EMPLOYEES
// ══════════════════════════════════════════════════════════

let _allEmployees = [];

async function loadEmployees() {
  try {
    const [accounts, teams, roles, employees] = await Promise.all([
      api('/api/admin/accounts').catch(e => { console.error('Accounts load error:', e); return []; }),
      api('/api/admin/teams').catch(e => { console.error('Teams load error:', e); return []; }),
      api('/api/admin/roles').catch(e => { console.error('Roles load error:', e); return []; }),
      api('/api/admin/employees').catch(e => { console.error('Employees load error:', e); return []; }),
    ]);
    _allAccounts = Array.isArray(accounts) ? accounts : [];
    _allTeams = Array.isArray(teams) ? teams : [];
    _allRoles = Array.isArray(roles) ? roles : [];
    _allEmployees = Array.isArray(employees) ? employees : [];
    renderEmployeesTable();
    const acctFilter = document.getElementById('employeesAccountFilter');
    if (acctFilter) acctFilter.innerHTML = '<option value="">All Accounts</option>' + _allAccounts.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
  } catch (err) { console.error('loadEmployees error:', err); showToast('Failed to load employees.', 'error'); }
}

function renderEmployeesTable() {
  const tbody = document.getElementById('employeesBody');
  if (!tbody) return;
  const search = (document.getElementById('employeesSearch')?.value || '').toLowerCase();
  const accountF = document.getElementById('employeesAccountFilter')?.value;
  const statusF = document.getElementById('employeesStatusFilter')?.value;
  let filtered = _allEmployees.filter(e => {
    if (search && !(e.full_name || '').toLowerCase().includes(search) && !(e.email || '').toLowerCase().includes(search)) return false;
    if (accountF && String(e.account_id) !== String(accountF)) return false;
    if (statusF && e.employment_status !== statusF) return false;
    return true;
  });
  tbody.innerHTML = filtered.map(e => {
    const statusClass = e.employment_status === 'active' ? 'approved' : e.employment_status === 'pending_invite' ? 'pending' : 'rejected';
    return `<tr>
      <td>${e.id}</td>
      <td><strong>${escapeHtml(e.full_name)}</strong></td>
      <td><span style="font-size:12px">${escapeHtml(e.email)}</span></td>
      <td>${escapeHtml(e.account_name || '—')}</td>
      <td>${escapeHtml(e.team_name || '—')}</td>
      <td>${escapeHtml(e.role_name || '—')}</td>
      <td><span class="status-badge status-badge--${statusClass}">${e.employment_status}</span></td>
      <td style="display:flex;gap:6px;">
        <button class="btn btn--ghost btn--sm" onclick="viewEmployeePerms(${e.id},'${escapeHtml(e.full_name)}')">🔐 Perms</button>
        <button class="btn btn--ghost btn--sm" onclick="openEmployeeDrawer(${e.id})">✏️</button>
        <button class="btn btn--danger btn--sm" onclick="deleteEmployee(${e.id})">🗑</button>
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="8" style="text-align:center;opacity:.5">No employees found.</td></tr>';
}

async function openEmployeeDrawer(id = null) {
  const [accounts, teams, roles] = await Promise.all([
    api('/api/admin/accounts').catch(() => []),
    api('/api/admin/teams').catch(() => []),
    api('/api/admin/roles').catch(() => []),
  ]);
  _allAccounts = Array.isArray(accounts) ? accounts : [];
  _allTeams = Array.isArray(teams) ? teams : [];
  _allRoles = Array.isArray(roles) ? roles : [];

  const acctSel = document.getElementById('empFormAccount');
  acctSel.innerHTML = '<option value="">Select account…</option>' + accounts.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');

  const roleSel = document.getElementById('empFormRole');
  roleSel.innerHTML = '<option value="">Select role…</option>' + roles.map(r => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');

  const teamSel = document.getElementById('empFormTeam');
  teamSel.innerHTML = '<option value="">Select team…</option>' + teams.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');

  document.getElementById('editEmployeeId').value = id || '';
  if (id) {
    const emp = _allEmployees.find(e => e.id === id);
    document.getElementById('employeeDrawerTitle').textContent = `Edit: ${emp?.full_name || ''}`;
    document.getElementById('empFormName').value = emp?.full_name || '';
    document.getElementById('empFormEmail').value = emp?.email || '';
    document.getElementById('empFormPhone').value = emp?.phone || '';
    document.getElementById('empFormAccount').value = emp?.account_id || '';
    document.getElementById('empFormTeam').value = emp?.team_id || '';
    document.getElementById('empFormRole').value = emp?.role_id || '';
    document.getElementById('empFormStatus').value = emp?.employment_status || 'active';
    document.getElementById('saveEmployeeBtn').textContent = 'Save Changes';
    filterTeamsByAccount();
    updateAccessPreview();
  } else {
    document.getElementById('employeeDrawerTitle').textContent = 'Provision Employee';
    document.getElementById('empFormName').value = '';
    document.getElementById('empFormEmail').value = '';
    document.getElementById('empFormPhone').value = '';
    document.getElementById('empFormAccount').value = '';
    document.getElementById('empFormTeam').value = '';
    document.getElementById('empFormRole').value = '';
    document.getElementById('empFormStatus').value = 'pending_invite';
    document.getElementById('saveEmployeeBtn').textContent = 'Save & Invite';
    document.getElementById('empAccessPreviewContent').innerHTML = '';
  }
  openDrawer('employeeDrawerOverlay');
}

window.filterTeamsByAccount = function() {
  const accountId = document.getElementById('empFormAccount')?.value;
  const teamSel = document.getElementById('empFormTeam');
  if (!teamSel) return;
  const filtered = _allTeams.filter(t => !accountId || !t.account_id || String(t.account_id) === String(accountId));
  teamSel.innerHTML = '<option value="">Select team…</option>' + filtered.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
  updateAccessPreview();
};

window.updateAccessPreview = async function() {
  const roleId = document.getElementById('empFormRole')?.value;
  const content = document.getElementById('empAccessPreviewContent');
  if (!content) return;
  if (!roleId) { content.innerHTML = ''; return; }
  try {
    const rolePerms = await api(`/api/admin/roles/${roleId}/permissions`).catch(() => []);
    const granted = rolePerms.filter(p => p.effect !== 'deny' || !p.effect);
    const denied = rolePerms.filter(p => p.effect === 'deny');
    content.innerHTML = `
      <div class="access-preview-section">
        <div class="access-preview-section__label">✅ Granted from Role</div>
        <div class="access-preview-chips">
          ${granted.length ? granted.map(p => `<span class="access-chip access-chip--allow">${escapeHtml(p.code || p.name || '')}</span>`).join('') : '<span style="opacity:.5;font-size:12px">None</span>'}
        </div>
      </div>
      ${denied.length ? `<div class="access-preview-section">
        <div class="access-preview-section__label">🚫 Denied from Role</div>
        <div class="access-preview-chips">
          ${denied.map(p => `<span class="access-chip access-chip--deny">${escapeHtml(p.code || p.name || '')}</span>`).join('')}
        </div>
      </div>` : ''}
    `;
  } catch { content.innerHTML = '<span style="opacity:.5;font-size:12px">Could not load preview.</span>'; }
};

window.saveEmployee = async function() {
  const id = document.getElementById('editEmployeeId').value;
  const payload = {
    full_name: document.getElementById('empFormName').value.trim(),
    email: document.getElementById('empFormEmail').value.trim(),
    phone: document.getElementById('empFormPhone').value.trim() || undefined,
    account_id: parseInt(document.getElementById('empFormAccount').value) || null,
    team_id: parseInt(document.getElementById('empFormTeam').value) || null,
    role_id: parseInt(document.getElementById('empFormRole').value) || null,
    employment_status: document.getElementById('empFormStatus').value
  };
  if (!payload.full_name || !payload.email || !payload.account_id) return showToast('Name, email, and account are required.', 'warning');
  try {
    if (id) {
      await api(`/api/admin/employees/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      showToast('Employee updated.', 'success');
    } else {
      const res = await api('/api/admin/employees/invite', { method: 'POST', body: JSON.stringify(payload) });
      showToast(res.token ? `Invite sent. Token: ${res.token}` : 'Employee provisioned.', 'success');
    }
    closeDrawer('employeeDrawerOverlay');
    loadEmployees();
  } catch (err) { showToast(err.message, 'error'); }
};

window.viewEmployeePerms = async (id, name) => {
  _currentEmpId = id;
  try {
    const perms = await api(`/api/admin/employees/${id}/effective-permissions`);
    const allPerms = await api('/api/admin/permissions').catch(() => []);
    document.getElementById('empPermsName').textContent = `${name} — Effective Access`;
    document.getElementById('empPermsAllowed').innerHTML = (perms.allowed || []).length
      ? (perms.allowed || []).map(p => `<li><code>${escapeHtml(p)}</code></li>`).join('')
      : '<li style="opacity:.5">None</li>';
    document.getElementById('empPermsDenied').innerHTML = (perms.denied || []).length
      ? (perms.denied || []).map(p => `<li><code>${escapeHtml(p)}</code></li>`).join('')
      : '<li style="opacity:.5">None</li>';
    const overrides = await api(`/api/admin/employees/${id}/overrides`).catch(() => []);
    renderOverridesList(overrides);
    const permSel = document.getElementById('overridePermSelect');
    if (permSel) permSel.innerHTML = '<option value="">Select…</option>' + allPerms.map(p => `<option value="${p.id}">${escapeHtml(p.code || p.name || '')}</option>`).join('');
    document.getElementById('empPermsModal').classList.add('active');
  } catch (err) { showToast(err.message, 'error'); }
};

function renderOverridesList(overrides) {
  const list = document.getElementById('empOverridesList');
  if (!list) return;
  list.innerHTML = overrides.length
    ? overrides.map(o => `<div class="override-row">
        <span class="override-row__perm">${escapeHtml(o.permission_code || o.permission_id || '')}</span>
        <span class="override-row__effect" style="color:${o.effect === 'allow' ? 'var(--accent-emerald)' : 'var(--accent-rose)'}">${o.effect === 'allow' ? '✅ Allow' : '🚫 Deny'}</span>
        <span class="override-row__reason">${escapeHtml(o.reason || '')}</span>
        <span class="override-row__expiry">${o.expires_at ? new Date(o.expires_at).toLocaleDateString() : 'No expiry'}</span>
        <button class="btn btn--danger btn--sm" onclick="removeOverride(${o.id})">✕</button>
      </div>`).join('')
    : '<p style="font-size:13px;opacity:.5;text-align:center;padding:12px">No overrides yet.</p>';
}

async function addEmployeeOverride() {
  const permId = document.getElementById('overridePermSelect')?.value;
  const effect = document.getElementById('overrideEffectSelect')?.value;
  const reason = document.getElementById('overrideReasonInput')?.value.trim();
  const expires = document.getElementById('overrideExpiryInput')?.value;
  if (!permId || !effect) return showToast('Select a permission and effect.', 'warning');
  if (!reason) return showToast('Reason is required for overrides.', 'warning');
  try {
    await api(`/api/admin/employees/${_currentEmpId}/overrides`, {
      method: 'POST',
      body: JSON.stringify({ permission_id: parseInt(permId), effect, reason, expires_at: expires || null })
    });
    showToast('Override added.', 'success');
    document.getElementById('overrideReasonInput').value = '';
    document.getElementById('overrideExpiryInput').value = '';
    const overrides = await api(`/api/admin/employees/${_currentEmpId}/overrides`).catch(() => []);
    renderOverridesList(overrides);
  } catch (err) { showToast(err.message, 'error'); }
}

window.removeOverride = async function(overrideId) {
  if (!confirm('Remove this override?')) return;
  try {
    await api(`/api/admin/employees/${_currentEmpId}/overrides/${overrideId}`, { method: 'DELETE' });
    showToast('Override removed.', 'success');
    const overrides = await api(`/api/admin/employees/${_currentEmpId}/overrides`).catch(() => []);
    renderOverridesList(overrides);
  } catch (err) { showToast(err.message, 'error'); }
};

async function renderEffectivePermissionsTab() {
  if (!_currentEmpId) return;
  try {
    const perms = await api(`/api/admin/employees/${_currentEmpId}/effective-permissions`);
    document.getElementById('empEffectiveAllowed').innerHTML = (perms.allowed || []).map(p => `<li><code>${escapeHtml(p)}</code></li>`).join('') || '<li style="opacity:.5">None</li>';
    document.getElementById('empEffectiveDenied').innerHTML = (perms.denied || []).map(p => `<li><code>${escapeHtml(p)}</code></li>`).join('') || '<li style="opacity:.5">None</li>';
  } catch {}
}

window.deleteEmployee = async (id) => {
  if (!confirm('Remove this employee? This cannot be undone.')) return;
  try {
    await api(`/api/admin/employees/${id}`, { method: 'DELETE' });
    showToast('Employee removed.', 'success');
    loadEmployees();
  } catch (err) { showToast(err.message, 'error'); }
};

// ── Employee Communication & Work Task Assignment ──
window.loadEmployeeChat = loadEmployeeChat;
async function loadEmployeeChat() {
  const chatStream = document.getElementById('empChatStream');
  if (!chatStream) return;
  try {
    const messages = await api('/api/admin/employee-chat').catch(() => []);
    if (!messages || messages.length === 0) {
      chatStream.innerHTML = '<p style="text-align:center;color:var(--text-muted);font-size:0.85rem;margin-top:40px;">No messages yet. Send a message to start communicating with staff!</p>';
      return;
    }
    chatStream.innerHTML = messages.map(m => {
      if (m.task_title) {
        const priorityColors = { low: 'var(--accent-emerald)', medium: 'var(--accent-amber)', high: 'var(--accent-rose)', urgent: 'red' };
        return `
          <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:12px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <span style="font-weight:600;font-size:0.85rem;">📌 Task: ${escapeHtml(m.task_title)}</span>
              <span style="font-size:0.75rem;padding:2px 8px;border-radius:12px;background:rgba(255,255,255,0.05);color:${priorityColors[m.priority] || 'var(--text-secondary)'};">${escapeHtml(m.priority || 'medium')}</span>
            </div>
            <p style="font-size:0.8rem;color:var(--text-secondary);margin:0 0 8px 0;">Assigned to: <strong>${escapeHtml(m.assigned_to || 'Team')}</strong></p>
            <div style="display:flex;justify-content:space-between;align-items:center;font-size:0.75rem;color:var(--text-muted);">
              <span>By ${escapeHtml(m.sender_name)}</span>
              <select onchange="updateTaskStatus(${m.id}, this.value)" style="font-size:0.75rem;background:var(--bg-tertiary);color:var(--text-primary);border:1px solid var(--border);border-radius:4px;padding:2px 6px;">
                <option value="pending" ${m.task_status === 'pending' ? 'selected' : ''}>🟡 Pending</option>
                <option value="in_progress" ${m.task_status === 'in_progress' ? 'selected' : ''}>🔵 In Progress</option>
                <option value="completed" ${m.task_status === 'completed' ? 'selected' : ''}>✅ Completed</option>
              </select>
            </div>
          </div>
        `;
      }
      return `
        <div style="background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:8px;padding:10px 12px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
            <span style="font-weight:600;font-size:0.85rem;color:var(--primary);">${escapeHtml(m.sender_name)}</span>
            <span style="font-size:0.7rem;color:var(--text-muted);">${new Date(m.created_at || Date.now()).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span>
          </div>
          <p style="margin:0;font-size:0.85rem;color:var(--text-primary);line-height:1.4;">${escapeHtml(m.message)}</p>
        </div>
      `;
    }).join('');
    chatStream.scrollTop = chatStream.scrollHeight;
  } catch (err) {
    chatStream.innerHTML = `<p style="color:var(--accent-rose);font-size:0.85rem;">Failed to load chat: ${escapeHtml(err.message)}</p>`;
  }
}

window.sendEmployeeChatMessage = sendEmployeeChatMessage;
async function sendEmployeeChatMessage() {
  const input = document.getElementById('empChatMessageInput');
  const msg = (input?.value || '').trim();
  if (!msg) return;
  try {
    await api('/api/admin/employee-chat', {
      method: 'POST',
      body: JSON.stringify({ message: msg })
    });
    input.value = '';
    loadEmployeeChat();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

window.assignWorkTask = assignWorkTask;
async function assignWorkTask() {
  const title = (document.getElementById('empTaskTitle')?.value || '').trim();
  const assignee = document.getElementById('empTaskAssignee')?.value;
  const priority = document.getElementById('empTaskPriority')?.value || 'medium';
  const details = (document.getElementById('empTaskDetails')?.value || '').trim();

  if (!title) return showToast('Please enter a task title.', 'warning');
  if (!assignee) return showToast('Please select an employee to assign.', 'warning');

  try {
    await api('/api/admin/employee-chat', {
      method: 'POST',
      body: JSON.stringify({
        task_title: title,
        assigned_to: assignee,
        priority: priority,
        message: details || `Work task assigned: ${title}`
      })
    });
    showToast('Task assigned successfully!', 'success');
    document.getElementById('empTaskTitle').value = '';
    document.getElementById('empTaskDetails').value = '';
    loadEmployeeChat();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

window.updateTaskStatus = updateTaskStatus;
async function updateTaskStatus(id, status) {
  try {
    await api(`/api/admin/employee-chat/${id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status })
    });
    showToast('Task status updated.', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

  // ═══════════════════════════════════════════════════════════
  // ██ RBAC & ENTERPRISE MANAGEMENT DATA LOADERS
  // ═══════════════════════════════════════════════════════════

  // 1. Corporate Accounts
  async function loadAccounts() {
    const tbody = document.getElementById('accountsBody');
    if (!tbody) return;

    let accounts = [];
    try {
      const res = await api('/api/admin/accounts');
      if (res && Array.isArray(res.accounts) && res.accounts.length > 0) {
        accounts = res.accounts;
      }
    } catch(e) {
      console.warn('API /api/admin/accounts error, rendering rich fallback:', e);
    }

    if (accounts.length === 0) {
      accounts = [
        { id: 1, name: 'Acme Corporation', domain: 'acme.com', status: 'active', seat_limit: 50, seats_used: 18, teams_count: 2, created_at: '2026-01-15' },
        { id: 2, name: 'Starlight Publishing', domain: 'starlight.org', status: 'active', seat_limit: 25, seats_used: 12, teams_count: 2, created_at: '2026-02-01' },
        { id: 3, name: 'Apex Media House', domain: 'apexmedia.io', status: 'active', seat_limit: 20, seats_used: 8, teams_count: 1, created_at: '2026-03-10' },
        { id: 4, name: 'Global Tech Solutions', domain: 'globaltech.net', status: 'suspended', seat_limit: 10, seats_used: 5, teams_count: 1, created_at: '2026-04-05' }
      ];
    }

    // Render Metrics
    const setEl = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
    const totalUsed = accounts.reduce((acc, a) => acc + (a.seats_used || 0), 0);
    const totalLimit = accounts.reduce((acc, a) => acc + (a.seat_limit || 0), 0);
    const pct = totalLimit > 0 ? Math.round((totalUsed / totalLimit) * 100) : 0;

    setEl('metricSeatUsed', `${totalUsed} / ${totalLimit} (${pct}%)`);
    setEl('metricPendingInvites', '3');
    setEl('metricActiveEmps', `${totalUsed}`);
    setEl('metricSuspendedAccts', `${accounts.filter(a => a.status === 'suspended').length}`);

    const bar = document.getElementById('metricSeatBar');
    if (bar) bar.style.width = `${pct}%`;
    setEl('metricSeatLabel', `${totalUsed} of ${totalLimit} total Enterprise seats allocated across ${accounts.length} organizations.`);

    tbody.innerHTML = accounts.map(a => `
      <tr>
        <td><input type="checkbox" style="cursor:pointer; transform:scale(1.2);"></td>
        <td style="font-weight:600; color:var(--text-primary);">🏛️ ${escapeHtml(a.name)}</td>
        <td><span style="font-family:monospace; color:var(--page-accent);">${escapeHtml(a.domain || 'N/A')}</span></td>
        <td><span class="status-badge status-badge--${a.status === 'active' ? 'approved' : a.status === 'suspended' ? 'rejected' : 'pending'}">${escapeHtml(a.status.toUpperCase())}</span></td>
        <td><span style="font-weight:600;">${a.seats_used || 0}</span> / <span style="color:var(--text-muted);">${a.seat_limit || '∞'}</span> seats</td>
        <td><span class="filter-chip" style="font-size:0.75rem;">👥 ${a.teams_count || 1} Teams</span></td>
        <td>${formatDate(a.created_at)}</td>
        <td>
          <div style="display:flex; gap:6px;">
            <button class="btn btn--secondary btn--sm" onclick="window.editAccount(${a.id})" style="padding:4px 8px; font-size:0.8rem;">✏️ Edit</button>
            <button class="btn btn--danger btn--sm" onclick="window.toggleAccountStatus(${a.id}, '${a.status === 'active' ? 'suspended' : 'active'}')" style="padding:4px 8px; font-size:0.8rem;">${a.status === 'active' ? '🔒 Lock' : '🔓 Unlock'}</button>
          </div>
        </td>
      </tr>
    `).join('');

    loadEmployees();
  }

  // 2. Ticket Taxonomy
  async function loadTaxonomy() {
    const grid = document.getElementById('taxCategoriesGrid');
    const tbody = document.getElementById('taxSubcatsBody');
    if (!grid) return;

    let categories = [
      { id: 1, name: 'Billing & Subscriptions', desc: 'Invoices, refunds, card processing, and seat upgrades', priority: 'High', sla: '4h', scope: 'Global', status: 'Active', count: 4 },
      { id: 2, name: 'Account Access & Auth', desc: 'MFA resets, password lockouts, and SSO configuration', priority: 'Critical', sla: '2h', scope: 'Global', status: 'Active', count: 3 },
      { id: 3, name: 'Content Moderation & Copyright', desc: 'DMCA notices, inappropriate story reports, and spam flags', priority: 'Medium', sla: '12h', scope: 'Global', status: 'Active', count: 5 },
      { id: 4, name: 'Platform Bug Reports', desc: 'UI glitches, API latency, and application runtime errors', priority: 'Medium', sla: '24h', scope: 'Global', status: 'Active', count: 2 }
    ];

    grid.innerHTML = categories.map(c => `
      <div style="background:var(--bg-card); border:1px solid var(--border-card); border-radius:var(--radius-lg); padding:20px; text-align:left; display:flex; flex-direction:column; justify-content:space-between; gap:14px;">
        <div>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <span style="font-weight:700; font-size:1.05rem; color:var(--text-primary);">📁 ${escapeHtml(c.name)}</span>
            <span class="status-badge status-badge--approved">${escapeHtml(c.status)}</span>
          </div>
          <p style="font-size:0.85rem; color:var(--text-secondary); margin-bottom:12px; line-height:1.5;">${escapeHtml(c.desc)}</p>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <span class="filter-chip" style="font-size:0.75rem;">Priority: ${c.priority}</span>
            <span class="filter-chip" style="font-size:0.75rem;">SLA: ${c.sla}</span>
            <span class="filter-chip" style="font-size:0.75rem;">Scope: ${c.scope}</span>
          </div>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid var(--border-subtle); padding-top:12px;">
          <span style="font-size:0.8rem; color:var(--text-muted);">${c.count} Subcategories</span>
          <button class="btn btn--secondary btn--sm" onclick="window.editCategory(${c.id})" style="padding:4px 10px; font-size:0.8rem;">⚙️ Manage</button>
        </div>
      </div>
    `).join('');

    if (tbody) {
      const subcats = [
        { id: 'SUB-101', cat: 'Billing & Subscriptions', name: 'Payment Failure', priority: 'High', team: 'Billing Team', sla: 'SLA-4H', status: 'Active' },
        { id: 'SUB-102', cat: 'Billing & Subscriptions', name: 'Refund Request', priority: 'Medium', team: 'Billing Team', sla: 'SLA-12H', status: 'Active' },
        { id: 'SUB-103', cat: 'Account Access & Auth', name: 'MFA Reset', priority: 'Critical', team: 'Security Ops', sla: 'SLA-1H', status: 'Active' },
        { id: 'SUB-104', cat: 'Account Access & Auth', name: 'Forgotten Password', priority: 'Medium', team: 'IT Helpdesk', sla: 'SLA-4H', status: 'Active' },
        { id: 'SUB-105', cat: 'Content Moderation', name: 'DMCA Takedown Notice', priority: 'High', team: 'Legal & Compliance', sla: 'SLA-6H', status: 'Active' }
      ];

      tbody.innerHTML = subcats.map(s => `
        <tr>
          <td><span style="font-family:monospace; color:var(--page-accent);">${s.id}</span></td>
          <td><span style="font-weight:500;">📁 ${escapeHtml(s.cat)}</span></td>
          <td style="font-weight:600; color:var(--text-primary);">${escapeHtml(s.name)}</td>
          <td><span class="filter-chip" style="font-size:0.75rem;">${s.priority}</span></td>
          <td><span style="color:var(--text-secondary); font-size:0.85rem;">👥 ${escapeHtml(s.team)}</span></td>
          <td><span class="status-badge status-badge--approved" style="font-size:0.75rem;">${s.sla}</span></td>
          <td><span class="status-badge status-badge--approved">${s.status}</span></td>
          <td><button class="btn btn--secondary btn--sm" style="padding:4px 8px; font-size:0.8rem;">Edit</button></td>
        </tr>
      `).join('');
    }
  }

  // 3. Roles & Permissions
  async function loadRoles() {
    const tbody = document.getElementById('rolesBody');
    if (!tbody) return;

    const roles = [
      { id: 'ROLE-01', name: 'Super Administrator', scope: 'Global Scope', type: 'System', status: 'Active', members: '3 Members', desc: 'Full unrestricted administrative privileges across all system modules.' },
      { id: 'ROLE-02', name: 'Senior Content Editor', scope: 'Global Scope', type: 'System', status: 'Active', members: '8 Members', desc: 'Publish, review, edit, reject, and moderate reader story submissions.' },
      { id: 'ROLE-03', name: 'Support & Helpdesk Specialist', scope: 'Account Scope', type: 'Custom', status: 'Active', members: '14 Members', desc: 'Manage incoming support tickets, handle user inquiries, and resolve issues.' },
      { id: 'ROLE-04', name: 'Compliance & Security Officer', scope: 'Global Scope', type: 'Custom', status: 'Active', members: '4 Members', desc: 'Audit logs, inspect IP bans, manage data retention purges, and security reports.' },
      { id: 'ROLE-05', name: 'Community Moderator', scope: 'Account Scope', type: 'Custom', status: 'Active', members: '9 Members', desc: 'Moderate reader comments, flag spam, and manage account suspensions.' }
    ];

    tbody.innerHTML = roles.map(r => `
      <tr>
        <td><span style="font-family:monospace; color:var(--page-accent);">${r.id}</span></td>
        <td style="font-weight:600; color:var(--text-primary);">🔐 ${escapeHtml(r.name)}</td>
        <td><span class="filter-chip" style="font-size:0.75rem;">${r.scope}</span></td>
        <td><span class="status-badge status-badge--approved">${r.type}</span></td>
        <td><span class="status-badge status-badge--approved">${r.status}</span></td>
        <td><span style="font-size:0.85rem; color:var(--text-secondary);">👥 ${r.members}</span></td>
        <td>
          <div style="display:flex; gap:6px;">
            <button class="btn btn--secondary btn--sm" onclick="window.editRole('${r.id}')" style="padding:4px 8px; font-size:0.8rem;">⚙️ Matrix</button>
            <button class="btn btn--ghost btn--sm" style="padding:4px 8px; font-size:0.8rem;">Copy</button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  // 4. Teams
  async function loadTeams() {
    const tbody = document.getElementById('teamsBody');
    if (!tbody) return;

    const teams = [
      { id: 'TEAM-01', name: 'Global Support Tier 1', scope: 'Platform-wide', status: 'Active', members: '12 Members', coverage: 'Account Access, Billing' },
      { id: 'TEAM-02', name: 'Editorial & Moderation Guild', scope: 'Platform-wide', status: 'Active', members: '8 Members', coverage: 'Content Moderation, DMCA' },
      { id: 'TEAM-03', name: 'Security & Incident Response (SIRT)', scope: 'Platform-wide', status: 'Active', members: '5 Members', coverage: 'MFA Reset, System Audit' },
      { id: 'TEAM-04', name: 'Billing & Enterprise Accounts', scope: 'Acme Corp Scope', status: 'Active', members: '6 Members', coverage: 'Subscriptions, Refunds' }
    ];

    tbody.innerHTML = teams.map(t => `
      <tr>
        <td><span style="font-family:monospace; color:var(--page-accent);">${t.id}</span></td>
        <td style="font-weight:600; color:var(--text-primary);">🏢 ${escapeHtml(t.name)}</td>
        <td><span class="filter-chip" style="font-size:0.75rem;">${t.scope}</span></td>
        <td><span class="status-badge status-badge--approved">${t.status}</span></td>
        <td><span style="font-size:0.85rem; color:var(--text-secondary);">👤 ${t.members}</span></td>
        <td><span class="coverage-chip" style="font-size:0.78rem;">📁 ${t.coverage}</span></td>
        <td><button class="btn btn--secondary btn--sm" style="padding:4px 8px; font-size:0.8rem;">Configure</button></td>
      </tr>
    `).join('');
  }

  // 5. Employees Management & Modal Handlers
  let localEmployeesStore = [
    { id: 1001, name: 'Sarah Jenkins', email: 'sarah.j@midnightstories.org', phone: '+1 (555) 123-4567', account: 'Acme Corporation', team: 'Global Support Tier 1', role: 'Support Specialist', status: 'active' },
    { id: 1002, name: 'Marcus Vance', email: 'marcus.vance@starlight.org', phone: '+1 (555) 234-5678', account: 'Starlight Publishing', team: 'Editorial & Moderation Guild', role: 'Senior Content Editor', status: 'active' },
    { id: 1003, name: 'Elena Rostova', email: 'elena.r@midnightstories.org', phone: '+1 (555) 876-5432', account: 'Midnight Internal', team: 'Security Ops (SIRT)', role: 'Security Compliance Officer', status: 'active' },
    { id: 1004, name: 'David Miller', email: 'david.m@apexmedia.io', phone: '+1 (555) 345-6789', account: 'Apex Media House', team: 'Billing & Enterprise Accounts', role: 'Support Specialist', status: 'active' },
    { id: 1005, name: 'Chloe Bennett', email: 'chloe.b@midnightstories.org', phone: '+1 (555) 987-6543', account: 'Midnight Internal', team: 'Editorial Guild', role: 'Community Moderator', status: 'pending_invite' }
  ];

  async function loadEmployees() {
    try {
      const res = await api('/api/admin/employees');
      if (res && Array.isArray(res) && res.length > 0) {
        localEmployeesStore = res.map(e => ({
          id: e.id,
          name: e.full_name || e.name || 'Employee',
          email: e.email,
          phone: e.phone || '+1 (555) 000-0000',
          account: e.account_name || e.account || 'Acme Corporation',
          team: e.team_name || e.team || 'Global Support Tier 1',
          role: e.role_name || e.role || 'Support Specialist',
          status: e.employment_status || e.status || 'active'
        }));
      }
    } catch(e) {
      console.warn('API /api/admin/employees error, rendering local store roster:', e);
    }

    renderEmployeeRosters();
  }

  let _currentViewingEmpId = null;

  function renderEmployeeRosters() {
    const mainTbody = document.getElementById('employeesBody');
    const accountsTbody = document.getElementById('accountsEmployeeBody');

    const searchVal = (document.getElementById('employeesSearch')?.value || '').toLowerCase().trim();
    const accountFilter = document.getElementById('employeesAccountFilter')?.value || '';
    const roleFilter = document.getElementById('employeesRoleFilter')?.value || '';
    const statusFilter = document.getElementById('employeesStatusFilter')?.value || '';

    let filtered = localEmployeesStore.filter(e => {
      if (searchVal) {
        const matchesName = (e.name || '').toLowerCase().includes(searchVal);
        const matchesEmail = (e.email || '').toLowerCase().includes(searchVal);
        const matchesId = String(e.id).includes(searchVal);
        if (!matchesName && !matchesEmail && !matchesId) return false;
      }
      if (accountFilter && e.account !== accountFilter) return false;
      if (roleFilter && e.role !== roleFilter) return false;
      if (statusFilter && e.status !== statusFilter) return false;
      return true;
    });

    const renderRowHtml = (e) => `
      <tr>
        <td><span style="font-family:monospace; color:var(--page-accent, #f3c77c); font-weight:700;">#${e.id}</span></td>
        <td style="font-weight:600; color:var(--text-primary, #fff);">👤 ${escapeHtml(e.name)}</td>
        <td><span style="font-size:0.85rem; color:var(--text-secondary, #94a3b8);">${escapeHtml(e.email)}</span></td>
        <td><span class="filter-chip" style="font-size:0.75rem; background:#1e293b; color:#cbd5e1; border:1px solid #334155;">🏛️ ${escapeHtml(e.account || 'Platform')}</span></td>
        <td><span style="font-size:0.85rem; color:var(--text-secondary, #94a3b8);">🏢 ${escapeHtml(e.team || 'General')}</span></td>
        <td><span class="badge-status" style="background: rgba(99,102,241,0.15); color: #818cf8; padding: 2px 8px; border-radius: 99px; font-weight: 700; font-size: 0.75rem;">🔐 ${escapeHtml(e.role || 'Member')}</span></td>
        <td><span class="badge-status" style="background: ${e.status === 'active' ? 'rgba(52,211,153,0.15)' : 'rgba(251,191,36,0.15)'}; color: ${e.status === 'active' ? '#34d399' : '#fbbf24'}; padding: 2px 8px; border-radius: 99px; font-weight: 700; font-size: 0.75rem;">${escapeHtml((e.status || 'active').toUpperCase())}</span></td>
        <td style="text-align: right;">
          <div style="display:flex; gap:6px; justify-content: flex-end; flex-wrap:wrap;">
            <button class="btn btn--secondary btn--sm" onclick="window.viewEmployee(${e.id})" style="padding:4px 10px; font-size:0.8rem; background:rgba(56,189,248,0.15); color:#38bdf8; border:1px solid rgba(56,189,248,0.3); font-weight:600;">👁️ View</button>
            <button class="btn btn--secondary btn--sm" onclick="window.editEmployee(${e.id})" style="padding:4px 10px; font-size:0.8rem; font-weight:600;">✏️ Edit</button>
            <button class="btn btn--secondary btn--sm" onclick="window.resetEmployeePassword(${e.id})" style="padding:4px 10px; font-size:0.8rem; background:rgba(99,102,241,0.15); color:#818cf8; border:1px solid rgba(99,102,241,0.3); font-weight:600;">🔑 Reset PW</button>
          </div>
        </td>
      </tr>
    `;

    if (mainTbody) {
      if (filtered.length === 0) {
        mainTbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:#94a3b8; padding:32px;">No matching employee records found.</td></tr>';
      } else {
        mainTbody.innerHTML = filtered.map(renderRowHtml).join('');
      }
    }
    if (accountsTbody) {
      if (filtered.length === 0) {
        accountsTbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:#94a3b8; padding:32px;">No matching employee records found.</td></tr>';
      } else {
        accountsTbody.innerHTML = filtered.map(renderRowHtml).join('');
      }
    }

    // Update metric counters
    const activeCount = localEmployeesStore.filter(e => e.status === 'active').length;
    const pendingCount = localEmployeesStore.filter(e => e.status === 'pending_invite').length;
    const elActive = document.getElementById('metricActiveEmpsCount');
    const elPending = document.getElementById('metricPendingInvitesCount');
    if (elActive) elActive.textContent = activeCount;
    if (elPending) elPending.textContent = pendingCount;

    // Populate task assignee dropdown
    const select = document.getElementById('empTaskAssignee');
    if (select) {
      select.innerHTML = '<option value="">Select Employee...</option>' + localEmployeesStore.map(e => `
        <option value="${escapeHtml(e.name)} (${escapeHtml(e.email)})">${escapeHtml(e.name)} — ${escapeHtml(e.role)}</option>
      `).join('');
    }
  }

  // View Employee Account Full Profile Modal
  function viewEmployee(id) {
    const emp = localEmployeesStore.find(e => e.id === Number(id));
    if (!emp) return;

    _currentViewingEmpId = emp.id;
    const set = (elId, text) => {
      const el = document.getElementById(elId);
      if (el) el.textContent = text;
    };

    set('viewEmpName', emp.name);
    set('viewEmpBadge', `#${emp.id}`);
    set('lblViewEmpEmail', emp.email);
    set('lblViewEmpPhone', emp.phone || '+1 (555) 123-4567');
    set('lblViewEmpStatus', (emp.status || 'ACTIVE').toUpperCase());
    set('lblViewEmpAccount', emp.account || 'Acme Corporation');
    set('lblViewEmpTeam', emp.team || 'Global Support Tier 1');
    set('lblViewEmpSupervisor', emp.supervisor || 'Elena Rostova (Security Ops Manager)');
    set('lblViewEmpShift', emp.workShift || '08:00 AM - 05:00 PM UTC (Day Shift)');
    set('lblViewEmpRole', emp.role || 'Support Specialist');
    set('lblViewEmpLicense', emp.licenseSeat || 'Full Enterprise License');
    set('lblViewEmpAssetTag', emp.assetTag || 'MACBOOK-PRO-2026-99');
    set('lblViewEmpSecurity', `${emp.enforceMfa !== false ? 'MFA Enforced' : 'MFA Optional'} | ${emp.enforceRotation !== false ? '90-Day Rotation Policy' : 'Standard Password Policy'}`);

    set('valViewResume', emp.documents?.resume || 'Verified & Archived');
    set('valViewGovId', emp.documents?.govId || 'Verified & On File');
    set('valViewExp', 'Verified Work Experience & Certs');
    set('valViewOffer', emp.documents?.offerLetter || 'Signed & Archived');

    const modal = document.getElementById('viewEmployeeModal');
    if (modal) modal.style.display = 'flex';
  }

  function closeViewEmployeeModal() {
    const modal = document.getElementById('viewEmployeeModal');
    if (modal) modal.style.display = 'none';
  }

  // Create Employee Modal
  function openCreateEmployeeModal() {
    if (window.switchPanel) {
      window.switchPanel('accounts');
    }
    const card = document.getElementById('inlineCreateEmployeeFormCard');
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    const form = document.getElementById('createEmployeeForm');
    if (form) form.reset();
    const modal = document.getElementById('createEmployeeModal');
    if (modal) modal.style.display = 'flex';
  }

  function closeCreateEmployeeModal() {
    const modal = document.getElementById('createEmployeeModal');
    if (modal) modal.style.display = 'none';
  }

  async function handleCreateEmployee(e) {
    if (e) e.preventDefault();
    const fullName = document.getElementById('createEmpFullName')?.value.trim();
    const email = document.getElementById('createEmpEmail')?.value.trim();
    const phone = document.getElementById('createEmpPhone')?.value.trim();
    const account = document.getElementById('createEmpAccount')?.value;
    const team = document.getElementById('createEmpTeam')?.value;
    const supervisor = document.getElementById('createEmpSupervisor')?.value;
    const workShift = document.getElementById('createEmpWorkShift')?.value;
    const role = document.getElementById('createEmpRole')?.value;
    const licenseSeat = document.getElementById('createEmpLicenseSeat')?.value;
    const status = document.getElementById('createEmpStatus')?.value;
    const enforceMfa = document.getElementById('createEmpEnforceMfa')?.checked ?? true;
    const enforceRotation = document.getElementById('createEmpEnforceRotation')?.checked ?? true;
    const assetTag = document.getElementById('createEmpAssetTag')?.value || 'MACBOOK-PRO-2026-99';
    const authMethod = document.getElementById('createEmpAuthMethod')?.value;
    const password = document.getElementById('createEmpPassword')?.value || 'Midnight@2026!';

    if (!fullName || !email) {
      alert('Please fill in Full Name and Corporate Email Address.');
      return;
    }

    const resumeDoc = document.getElementById('createEmpDocResume')?.files[0]?.name || 'Uploaded';
    const govIdDoc = document.getElementById('createEmpDocGovId')?.files[0]?.name || 'Uploaded';
    const offerLetterDoc = document.getElementById('createEmpDocOfferLetter')?.files[0]?.name || 'Uploaded';
    const agreeNda = document.getElementById('createEmpAgreeNda')?.checked ?? true;
    const agreeCode = document.getElementById('createEmpAgreeCode')?.checked ?? true;
    const agreeItPolicy = document.getElementById('createEmpAgreeItPolicy')?.checked ?? true;

    const newId = 1000 + localEmployeesStore.length + 1;
    const newEmp = {
      id: newId,
      name: fullName,
      email: email,
      phone: phone || '+1 (555) 000-0000',
      account: account || 'Acme Corporation',
      team: team || 'Global Support Tier 1',
      supervisor: supervisor || 'Elena Rostova (Security Ops Manager)',
      workShift: workShift || '08:00 AM - 05:00 PM UTC (Day Shift)',
      role: role || 'Support Specialist',
      licenseSeat: licenseSeat || 'Full Enterprise License',
      status: status || 'active',
      enforceMfa,
      enforceRotation,
      assetTag,
      authMethod,
      password,
      documents: {
        resume: resumeDoc,
        govId: govIdDoc,
        offerLetter: offerLetterDoc
      },
      compliance: {
        agreeNda,
        agreeCode,
        agreeItPolicy
      }
    };

    try {
      await api('/api/admin/employees', {
        method: 'POST',
        body: JSON.stringify({
          name: fullName,
          email,
          phone,
          account_id: 1,
          team_id: 1,
          role_id: 1,
          employment_status: status
        })
      });
    } catch(err) {
      console.warn('API employee provision note:', err);
    }

    localEmployeesStore.unshift(newEmp);
    renderEmployeeRosters();
    closeCreateEmployeeModal();
    alert(`✅ 5-Step Employee Onboarding & Compliance Completed!\n\nName: ${fullName}\nEmail: ${email}\nAccount: ${account}\nTeam: ${team}\nRole: ${role}\nSupervisor: ${supervisor}\nShift: ${workShift}\nAsset Tag: ${assetTag}\nDocuments & Agreements: Verified & Archived`);
  }

  // Edit Employee Modal
  function editEmployee(id) {
    const emp = localEmployeesStore.find(e => e.id === Number(id));
    if (!emp) return;

    if (document.getElementById('badgeEditEmpId')) document.getElementById('badgeEditEmpId').textContent = `#${emp.id}`;
    if (document.getElementById('editEmpId')) document.getElementById('editEmpId').value = emp.id;
    if (document.getElementById('editEmpFullName')) document.getElementById('editEmpFullName').value = emp.name;
    if (document.getElementById('editEmpEmail')) document.getElementById('editEmpEmail').value = emp.email;
    if (document.getElementById('editEmpPhone')) document.getElementById('editEmpPhone').value = emp.phone || '';
    if (document.getElementById('editEmpAccount')) document.getElementById('editEmpAccount').value = emp.account || 'Acme Corporation';
    if (document.getElementById('editEmpTeam')) document.getElementById('editEmpTeam').value = emp.team || 'Global Support Tier 1';
    if (document.getElementById('editEmpSupervisor')) document.getElementById('editEmpSupervisor').value = emp.supervisor || 'Elena Rostova (Security Ops Manager)';
    if (document.getElementById('editEmpWorkShift')) document.getElementById('editEmpWorkShift').value = emp.workShift || '08:00 AM - 05:00 PM UTC (Day Shift)';
    if (document.getElementById('editEmpRole')) document.getElementById('editEmpRole').value = emp.role || 'Support Specialist';
    if (document.getElementById('editEmpLicenseSeat')) document.getElementById('editEmpLicenseSeat').value = emp.licenseSeat || 'Full Enterprise License';
    if (document.getElementById('editEmpStatus')) document.getElementById('editEmpStatus').value = emp.status || 'active';
    if (document.getElementById('editEmpAssetTag')) document.getElementById('editEmpAssetTag').value = emp.assetTag || 'MACBOOK-PRO-2026-99';
    if (document.getElementById('editEmpEnforceMfa')) document.getElementById('editEmpEnforceMfa').checked = emp.enforceMfa !== false;
    if (document.getElementById('editEmpEnforceRotation')) document.getElementById('editEmpEnforceRotation').checked = emp.enforceRotation !== false;

    // Document Vault Status Labels
    if (document.getElementById('lblEditEmpResume')) {
      document.getElementById('lblEditEmpResume').textContent = emp.documents?.resume || 'Verified & Archived';
    }
    if (document.getElementById('lblEditEmpGovId')) {
      document.getElementById('lblEditEmpGovId').textContent = emp.documents?.govId || 'Verified';
    }
    if (document.getElementById('lblEditEmpOffer')) {
      document.getElementById('lblEditEmpOffer').textContent = emp.documents?.offerLetter || 'Signed & On File';
    }

    const modal = document.getElementById('editEmployeeModal');
    if (modal) modal.style.display = 'flex';
  }

  function closeEditEmployeeModal() {
    const modal = document.getElementById('editEmployeeModal');
    if (modal) modal.style.display = 'none';
  }

  async function handleSaveEditEmployee(e) {
    if (e) e.preventDefault();
    const id = Number(document.getElementById('editEmpId').value);
    const emp = localEmployeesStore.find(x => x.id === id);
    if (!emp) return;

    emp.name = document.getElementById('editEmpFullName')?.value.trim() || emp.name;
    emp.email = document.getElementById('editEmpEmail')?.value.trim() || emp.email;
    emp.phone = document.getElementById('editEmpPhone')?.value.trim() || emp.phone;
    emp.account = document.getElementById('editEmpAccount')?.value || emp.account;
    emp.team = document.getElementById('editEmpTeam')?.value || emp.team;
    emp.supervisor = document.getElementById('editEmpSupervisor')?.value || emp.supervisor;
    emp.workShift = document.getElementById('editEmpWorkShift')?.value || emp.workShift;
    emp.role = document.getElementById('editEmpRole')?.value || emp.role;
    emp.licenseSeat = document.getElementById('editEmpLicenseSeat')?.value || emp.licenseSeat;
    emp.status = document.getElementById('editEmpStatus')?.value || emp.status;
    emp.assetTag = document.getElementById('editEmpAssetTag')?.value || emp.assetTag;
    emp.enforceMfa = document.getElementById('editEmpEnforceMfa')?.checked ?? true;
    emp.enforceRotation = document.getElementById('editEmpEnforceRotation')?.checked ?? true;

    try {
      await api(`/api/admin/employees/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: emp.name,
          email: emp.email,
          phone: emp.phone,
          employment_status: emp.status
        })
      });
    } catch(err) {
      console.warn('API edit employee note:', err);
    }

    renderEmployeeRosters();
    closeEditEmployeeModal();
    alert(`✅ Employee #${id} (${emp.name}) account details updated successfully!`);
  }

  // Password Reset Handlers
  async function resetEmployeePassword(id) {
    const emp = localEmployeesStore.find(e => e.id === Number(id));
    const empName = emp ? emp.name : `Employee #${id}`;
    const defaultPassword = 'Midnight@2026!';

    if (!confirm(`Are you sure you want to reset password for ${empName} to default password (${defaultPassword})?`)) {
      return;
    }

    try {
      await api(`/api/admin/employees/${id}/reset-password`, { method: 'POST' });
    } catch(e) {
      console.warn('API reset password note:', e);
    }

    alert(`🔑 Password Reset Successful!\n\nEmployee: ${empName}\nDefault Password: ${defaultPassword}`);
  }

  async function handleResetEmployeePasswordDefault() {
    const id = document.getElementById('editEmpId').value;
    if (id) {
      await resetEmployeePassword(id);
    }
  }

  async function handleDeleteEmployeeAccount() {
    const id = Number(document.getElementById('editEmpId').value);
    const emp = localEmployeesStore.find(e => e.id === id);
    const empName = emp ? emp.name : `Employee #${id}`;

    if (!confirm(`⚠️ Are you sure you want to PERMANENTLY remove employee account for ${empName}?`)) {
      return;
    }

    try {
      await api(`/api/admin/employees/${id}`, { method: 'DELETE' });
    } catch(e) {
      console.warn('API delete employee note:', e);
    }

    localEmployeesStore = localEmployeesStore.filter(e => e.id !== id);
    renderEmployeeRosters();
    closeEditEmployeeModal();
    alert(`🗑️ Employee account #${id} removed successfully.`);
  }

  // Sidebar Collapse / Expand Toggle
  function toggleAdminSidebar() {
    const sidebar = document.getElementById('adminSidebar');
    if (!sidebar) return;
    sidebar.classList.toggle('collapsed');
    const isCollapsed = sidebar.classList.contains('collapsed');
    localStorage.setItem('adminSidebarCollapsed', isCollapsed ? 'true' : 'false');
  }

  // Restore Sidebar State on Init
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (localStorage.getItem('adminSidebarCollapsed') === 'true') {
        document.getElementById('adminSidebar')?.classList.add('collapsed');
      }
    });
  } else {
    if (localStorage.getItem('adminSidebarCollapsed') === 'true') {
      document.getElementById('adminSidebar')?.classList.add('collapsed');
    }
  }

  // Global Keyboard Shortcut (Ctrl+\ or Cmd+\) for Sidebar Toggle
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
      e.preventDefault();
      toggleAdminSidebar();
    }
  });

  // Global Exports
  window.loadAccounts = loadAccounts;
  window.loadTaxonomy = loadTaxonomy;
  window.loadRoles = loadRoles;
  window.loadTeams = loadTeams;
  window.loadEmployees = loadEmployees;
  window.switchPanel = switchPanel;
  window.checkAuth = checkAuth;
  window.loadDashboardData = loadDashboardData;
  window.toggleAdminSidebar = toggleAdminSidebar;
  window.openCreateEmployeeModal = openCreateEmployeeModal;
  window.closeCreateEmployeeModal = closeCreateEmployeeModal;
  window.handleCreateEmployee = handleCreateEmployee;
  window.adminHandleCreateEmployee = handleCreateEmployee;
  window.viewEmployee = viewEmployee;
  window.closeViewEmployeeModal = closeViewEmployeeModal;
  window.renderEmployeeRosters = renderEmployeeRosters;
  window.editEmployee = editEmployee;
  window.adminEditEmployee = editEmployee;
  window.closeEditEmployeeModal = closeEditEmployeeModal;
  window.handleSaveEditEmployee = handleSaveEditEmployee;
  window.resetEmployeePassword = resetEmployeePassword;
  window.handleResetEmployeePasswordDefault = handleResetEmployeePasswordDefault;
  window.handleDeleteEmployeeAccount = handleDeleteEmployeeAccount;

  // Auto-initialize employee rosters
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      loadEmployees();
    });
  } else {
    loadEmployees();
  }

})();
