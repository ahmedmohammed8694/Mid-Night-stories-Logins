// admin.js — Admin dashboard: login, MFA, moderation queues, reports, categories, bans, settings, audit log

(function () {
  let adminToken = sessionStorage.getItem('adminToken');
  let preToken = null;

  // ── Check Auth State ──
  function checkAuth() {
    if (adminToken) {
      showDashboard();
      loadDashboardData();
    }
  }

  function showDashboard() {
    document.getElementById('loginSection').classList.add('hidden');
    document.getElementById('dashboardSection').classList.remove('hidden');
    document.getElementById('logoutBtn').classList.remove('hidden');
  }

  // ── Login ──
  async function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;

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
        document.getElementById('loginForm').classList.add('hidden');
        document.getElementById('mfaStep').classList.remove('hidden');
        document.getElementById('mfaCode').focus();
        showToast('Enter your MFA code to continue.', 'info');
      } else {
        adminToken = data.token;
        sessionStorage.setItem('adminToken', adminToken);
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
    const code = document.getElementById('mfaCode').value.trim();
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
      showToast(`Welcome back, ${data.username}!`, 'success');
      showDashboard();
      loadDashboardData();
    } catch (err) {
      showToast(err.message, 'error');
      document.getElementById('mfaCode').value = '';
      document.getElementById('mfaCode').focus();
    }
  }

  // ── Logout ──
  function handleLogout() {
    adminToken = null;
    sessionStorage.removeItem('adminToken');
    document.getElementById('loginSection').classList.remove('hidden');
    document.getElementById('dashboardSection').classList.add('hidden');
    document.getElementById('logoutBtn').classList.add('hidden');
    document.getElementById('loginForm').classList.remove('hidden');
    document.getElementById('mfaStep').classList.add('hidden');
    document.getElementById('loginUsername').value = '';
    document.getElementById('loginPassword').value = '';
    showToast('Logged out.', 'info');
  }

  // ── Panel Navigation ──
  function switchPanel(panelName) {
    document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.admin-nav-item').forEach(n => n.classList.remove('active'));

    const panel = document.getElementById(`panel-${panelName}`);
    if (panel) panel.classList.add('active');

    const navItem = document.querySelector(`[data-panel="${panelName}"]`);
    if (navItem) navItem.classList.add('active');

    // Load panel-specific data
    switch (panelName) {
      case 'overview': loadStats(); break;
      case 'stories-queue': loadStoriesQueue(); break;
      case 'comments-queue': loadCommentsQueue(); break;
      case 'reports': loadReports(); break;
      case 'users': loadUsers(); break;
      case 'categories': loadCategories(); break;
      case 'bans': loadBans(); break;
      case 'settings': loadSettings(); break;
      case 'audit-log': loadAuditLog(); break;
      case 'mfa-setup': loadMFASetup(); break;
    }
  }

  // ── Load Dashboard Data ──
  function loadDashboardData() {
    loadStats();
  }

  // ── Stats ──
  async function loadStats() {
    try {
      const stats = await api('/api/admin/stats');

      document.getElementById('statTotalStories').textContent = stats.totalStories;
      document.getElementById('statPending').textContent = stats.pendingStories;
      document.getElementById('statApproved').textContent = stats.approvedStories;
      document.getElementById('statRejected').textContent = stats.rejectedStories;
      document.getElementById('statReports').textContent = stats.openReports;
      document.getElementById('statComments').textContent = stats.totalComments;
      document.getElementById('statPendingComments').textContent = stats.pendingComments;
      document.getElementById('statLikes').textContent = stats.totalLikes;
      document.getElementById('statBans').textContent = stats.bannedIPs;
      document.getElementById('statUsers').textContent = stats.totalUsers;

      // Update sidebar badges
      updateBadge('pendingStoriesBadge', stats.pendingStories);
      updateBadge('pendingCommentsBadge', stats.pendingComments);
      updateBadge('reportsBadge', stats.openReports);
    } catch (err) {
      if (err.status === 401) {
        handleLogout();
        return;
      }
      showToast('Failed to load stats.', 'error');
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

  // ── Stories Queue ──
  let currentStoryQueueStatus = 'pending';

  async function loadStoriesQueue(status) {
    if (status) currentStoryQueueStatus = status;
    try {
      const data = await api(`/api/admin/queue?type=stories&status=${currentStoryQueueStatus}`);
      const tbody = document.getElementById('storiesQueueBody');
      const empty = document.getElementById('noStoriesQueue');
      tbody.innerHTML = '';

      if (data.items.length === 0) {
        empty.classList.remove('hidden');
        document.getElementById('storiesQueueTable').closest('.admin-table-wrapper').classList.add('hidden');
        return;
      }

      empty.classList.add('hidden');
      document.getElementById('storiesQueueTable').closest('.admin-table-wrapper').classList.remove('hidden');

      data.items.forEach(item => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${item.id}</td>
          <td>${escapeHtml(item.title || 'Untitled')}</td>
          <td><div class="admin-table__preview">${escapeHtml(item.body.substring(0, 150))}</div></td>
          <td>${escapeHtml(item.category_name || '—')}</td>
          <td><span class="status-badge status-badge--${item.status}">${item.status}</span></td>
          <td>${formatDate(item.created_at)}</td>
          <td>
            <div class="admin-table__actions">
              ${item.status !== 'approved' ? `<button class="btn btn--success btn--sm" onclick="moderateItem('story', ${item.id}, 'approve')">✓</button>` : ''}
              ${item.status !== 'rejected' ? `<button class="btn btn--danger btn--sm" onclick="moderateItem('story', ${item.id}, 'reject')">✗</button>` : ''}
            </div>
          </td>
        `;
        tbody.appendChild(tr);
      });
    } catch (err) {
      showToast('Failed to load queue.', 'error');
    }
  }

  // ── Comments Queue ──
  let currentCommentQueueStatus = 'pending';

  async function loadCommentsQueue(status) {
    if (status) currentCommentQueueStatus = status;
    try {
      const data = await api(`/api/admin/queue?type=comments&status=${currentCommentQueueStatus}`);
      const tbody = document.getElementById('commentsQueueBody');
      const empty = document.getElementById('noCommentsQueue');
      tbody.innerHTML = '';

      if (data.items.length === 0) {
        empty.classList.remove('hidden');
        document.getElementById('commentsQueueTable').closest('.admin-table-wrapper').classList.add('hidden');
        return;
      }

      empty.classList.add('hidden');
      document.getElementById('commentsQueueTable').closest('.admin-table-wrapper').classList.remove('hidden');

      data.items.forEach(item => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${item.id}</td>
          <td>${escapeHtml(item.story_title || `Story #${item.story_id}`)}</td>
          <td><div class="admin-table__preview">${escapeHtml(item.body)}</div></td>
          <td><span class="status-badge status-badge--${item.status}">${item.status}</span></td>
          <td>${formatDate(item.created_at)}</td>
          <td>
            <div class="admin-table__actions">
              ${item.status !== 'approved' ? `<button class="btn btn--success btn--sm" onclick="moderateItem('comment', ${item.id}, 'approve')">✓</button>` : ''}
              ${item.status !== 'rejected' ? `<button class="btn btn--danger btn--sm" onclick="moderateItem('comment', ${item.id}, 'reject')">✗</button>` : ''}
            </div>
          </td>
        `;
        tbody.appendChild(tr);
      });
    } catch (err) {
      showToast('Failed to load comments queue.', 'error');
    }
  }

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

  // ── Reports ──
  let currentReportResolved = '0';

  async function loadReports(resolved) {
    if (resolved !== undefined) currentReportResolved = resolved;
    try {
      const reports = await api(`/api/admin/reports?resolved=${currentReportResolved}`);
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
        tr.innerHTML = `
          <td>${report.id}</td>
          <td><span class="status-badge status-badge--pending">${report.target_type}</span></td>
          <td><div class="admin-table__preview">${escapeHtml(report.target_preview || `ID: ${report.target_id}`)}</div></td>
          <td>${escapeHtml(report.reason)}</td>
          <td>${formatDate(report.created_at)}</td>
          <td>
            <div class="admin-table__actions">
              ${!report.resolved ? `<button class="btn btn--success btn--sm" onclick='window.openReportModal(${JSON.stringify(report).replace(/'/g, "&#39;")})'>Review & Resolve</button>` : '<span style="color: var(--accent-emerald);">Resolved</span>'}
            </div>
          </td>
        `;
        tbody.appendChild(tr);
      });
    } catch (err) {
      showToast('Failed to load reports.', 'error');
    }
  }

  window.openReportModal = function (report) {
    window.currentReportId = report.id;
    window.currentReportTargetUser = report.target_user_id;

    const detailsContent = `
      <p><strong>Reporter ID:</strong> ${report.reporter_id || 'Anonymous'}</p>
      <p><strong>Reason:</strong> ${escapeHtml(report.reason)}</p>
      <p><strong>Target Type:</strong> ${report.target_type}</p>
      <p><strong>Target Preview:</strong> ${escapeHtml(report.target_preview || 'N/A')}</p>
      <p><strong>Details:</strong> ${escapeHtml(report.details || 'None provided')}</p>
      ${report.attachment_url ? `<p><strong>Evidence:</strong><br><img src="${escapeHtml(report.attachment_url)}" style="max-width:100%; border-radius:4px; margin-top:8px;"></p>` : ''}
    `;
    document.getElementById('reportDetailsContent').innerHTML = detailsContent;
    document.getElementById('reportReplyBox').value = '';
    document.getElementById('adminMsgTitle').value = '';
    document.getElementById('adminMsgBody').value = '';

    document.getElementById('reportDetailsModal').classList.add('active');
  };

  window.submitReportReply = async function () {
    const reportId = window.currentReportId;
    const targetUserId = window.currentReportTargetUser;
    
    const reply = document.getElementById('reportReplyBox').value.trim();
    const systemTitle = document.getElementById('adminMsgTitle').value.trim();
    const systemBody = document.getElementById('adminMsgBody').value.trim();

    try {
      // 1. Resolve and reply to reporter
      await api(`/api/admin/reports/${reportId}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ reply })
      });

      // 2. Send system message to reported user if provided
      if (systemTitle && systemBody && targetUserId) {
        await api('/api/admin/messages/send', {
          method: 'POST',
          body: JSON.stringify({ user_id: targetUserId, title: systemTitle, body: systemBody })
        });
      }

      showToast('Report resolved and messages sent.', 'success');
      document.getElementById('reportDetailsModal').classList.remove('active');
      loadReports();
      loadStats();
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

  window.deleteCategory = async function (id) {
    if (!confirm('Delete this category? Stories will be uncategorized.')) return;
    try {
      await api(`/api/admin/categories/${id}`, { method: 'DELETE' });
      showToast('Category deleted.', 'success');
      loadCategories();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

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

  // ── Users ──
  async function loadUsers() {
    try {
      const data = await api('/api/admin/users');
      const tbody = document.getElementById('usersList');
      if (!tbody) return;

      tbody.innerHTML = '';
      if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; opacity: 0.5;">No users found.</td></tr>';
        return;
      }

      data.forEach(user => {
        const tr = document.createElement('tr');
        let statusClass = 'approved';
        if (user.account_status === 'suspended') statusClass = 'pending';
        if (user.account_status === 'banned') statusClass = 'rejected';
        
        tr.innerHTML = `
          <td><a href="javascript:void(0)" onclick="window.openAuditModal(${user.id})" style="color:var(--primary);text-decoration:underline;">#${user.id}</a></td>
          <td>${escapeHtml(user.full_name)}<br><small style="opacity:0.6">${escapeHtml(user.user_id)}</small></td>
          <td>${escapeHtml(user.email)}</td>
          <td>
            <select class="form-input" style="padding: 4px 8px; width: auto; font-size: 0.85rem;" onchange="window.updateUserStatus(${user.id}, this.value)">
              <option value="active" ${user.account_status === 'active' ? 'selected' : ''}>Active</option>
              <option value="suspended" ${user.account_status === 'suspended' ? 'selected' : ''}>Suspended</option>
              <option value="banned" ${user.account_status === 'banned' ? 'selected' : ''}>Banned</option>
              <option value="shadowbanned" ${user.account_status === 'shadowbanned' ? 'selected' : ''}>Shadowbanned</option>
            </select>
          </td>
          <td>${formatDate(user.created_at)}</td>
          <td>
            <button class="btn btn--secondary btn--sm" onclick="window.warnUser(${user.id})">Warn</button>
            <button class="btn btn--ghost btn--sm" onclick="window.resetUserConnections(${user.id})">Reset Connections</button>
          </td>
        `;
        tbody.appendChild(tr);
      });
    } catch (err) {
      showToast('Failed to load users.', 'error');
    }
  }
  
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

  // ── Event Bindings ──
  document.addEventListener('DOMContentLoaded', () => {
    checkAuth();

    // Login form
    const loginForm = document.getElementById('loginForm');
    if (loginForm) loginForm.addEventListener('submit', handleLogin);

    // MFA submit
    const mfaSubmitBtn = document.getElementById('mfaSubmitBtn');
    if (mfaSubmitBtn) mfaSubmitBtn.addEventListener('click', handleMFA);

    // MFA code enter key
    const mfaCode = document.getElementById('mfaCode');
    if (mfaCode) mfaCode.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleMFA();
    });

    // Logout
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

    // Panel navigation
    document.querySelectorAll('.admin-nav-item[data-panel]').forEach(item => {
      item.addEventListener('click', () => switchPanel(item.dataset.panel));
    });

    // Stories queue filter chips
    document.querySelectorAll('[data-queue-status]').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('[data-queue-status]').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        loadStoriesQueue(chip.dataset.queueStatus);
      });
    });

    // Comments queue filter chips
    document.querySelectorAll('[data-comment-status]').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('[data-comment-status]').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        loadCommentsQueue(chip.dataset.commentStatus);
      });
    });

    // Reports filter chips
    document.querySelectorAll('[data-report-resolved]').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('[data-report-resolved]').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        loadReports(chip.dataset.reportResolved);
      });
    });

    // Add category
    const addCategoryBtn = document.getElementById('addCategoryBtn');
    if (addCategoryBtn) addCategoryBtn.addEventListener('click', addCategory);

    // Add ban
    const addBanBtn = document.getElementById('addBanBtn');
    if (addBanBtn) addBanBtn.addEventListener('click', addBan);

    // Save settings
    const saveSettingsBtn = document.getElementById('saveSettingsBtn');
    if (saveSettingsBtn) saveSettingsBtn.addEventListener('click', saveSettings);

    // Enable MFA
    const enableMfaBtn = document.getElementById('enableMfaBtn');
    if (enableMfaBtn) enableMfaBtn.addEventListener('click', enableMFA);
  });
})();

