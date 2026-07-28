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
      case 'accounts': loadAccounts(); break;
      case 'taxonomy': loadTaxonomy(); break;
      case 'roles': loadRoles(); break;
      case 'teams': loadTeams(); break;
      case 'employees': loadEmployees(); break;
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
      window.currentReportsCache = reports;
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
              ${!report.resolved ? `<button class="btn btn--primary btn--sm" onclick="window.openReportDetails(${report.id})">Review</button>` : '<span style="color: var(--accent-emerald);">Resolved</span>'}
            </div>
          </td>
        `;
        tbody.appendChild(tr);
      });
    } catch (err) {
      showToast('Failed to load reports.', 'error');
    }
  }

  window.openReportDetails = function(id) {
    const report = window.currentReportsCache.find(r => r.id === id);
    if (!report) return;
    
    window.currentReviewingReportId = id;
    window.currentReviewingReporterId = report.reporter_id;
    
    let detailsHtml = `
      <p><strong>Reason:</strong> ${escapeHtml(report.reason)}</p>
      <p><strong>Target:</strong> ${escapeHtml(report.target_type)} #${report.target_id}</p>
      <p><strong>Target Preview:</strong> ${escapeHtml(report.target_preview || 'N/A')}</p>
    `;
    
    if (report.details) {
      detailsHtml += `<p><strong>Additional Details:</strong><br/>${escapeHtml(report.details).replace(/\\n/g, '<br/>')}</p>`;
    }
    
    if (report.attachment_url) {
      detailsHtml += `
        <div style="margin-top: 1rem;">
          <strong>Evidence Attachment:</strong><br/>
          <a href="${report.attachment_url}" target="_blank">
            <img src="${report.attachment_url}" alt="Attachment" style="max-width: 100%; max-height: 200px; border-radius: 4px; border: 1px solid var(--border); margin-top: 0.5rem;" />
          </a>
        </div>
      `;
    }
    
    document.getElementById('reportDetailsContent').innerHTML = detailsHtml;
    document.getElementById('reportReplyBox').value = '';
    document.getElementById('reportDetailsModal').classList.add('active');
  };

  window.submitReportReply = async function () {
    const id = window.currentReviewingReportId;
    const replyBody = document.getElementById('reportReplyBox').value.trim();
    
    try {
      // 1. Resolve Report
      await api(`/api/admin/reports/${id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({})
      });
      
      // 2. Send System Message if provided
      if (replyBody) {
        await api('/api/admin/messages/send', {
          method: 'POST',
          body: JSON.stringify({
            user_id: window.currentReviewingReporterId,
            title: 'Report Resolution Update',
            body: replyBody
          })
        });
      }
      
      showToast('Report resolved.', 'success');
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
      window.currentUsersCache = data;
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

  // ── Event Bindings ──
  function initAdminPanel() {
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

    const enableMfaBtn = document.getElementById('enableMfaBtn');
    if (enableMfaBtn) enableMfaBtn.addEventListener('click', enableMFA);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAdminPanel);
  } else {
    initAdminPanel();
  }
})();



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
  document.getElementById('openCreateAccountBtn')?.addEventListener('click', () => openAccountDrawer());
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
  document.getElementById('accountsSearch')?.addEventListener('input', renderAccountsTable);
  document.getElementById('accountsStatusFilter')?.addEventListener('change', renderAccountsTable);

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
      api('/api/admin/tax/categories'),
      api('/api/admin/tax/subcategories'),
      api('/api/admin/teams'),
      api('/api/admin/sla-rules')
    ]);
    _allCategories = cats;
    _allTeams = teams;
    _allSlaRules = slaRules;
    renderCategoryCards();
    renderSubcatsTable();
    // Populate subcategory parent filter
    const pf = document.getElementById('taxSubcatParentFilter');
    if (pf) pf.innerHTML = '<option value="">All Categories</option>' + cats.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  } catch (err) { showToast('Failed to load taxonomy.', 'error'); }
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
  // We need to re-fetch filtered subcategories or use cached
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
  // Load selects
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

  // Account multi-check
  const acctList = document.getElementById('catFormAccountList');
  acctList.innerHTML = accounts.map(a => `<label class="multi-check-item"><input type="checkbox" value="${a.id}" name="catAccounts"> ${escapeHtml(a.name)}</label>`).join('');

  // Reset / populate form
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
    // If account-specific, load which accounts have access
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
      // Save account access if account-specific
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
  // Simple inline edit via prompt for now
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
      api('/api/admin/roles'),
      api('/api/admin/permissions').catch(() => [])
    ]);
    _allRoles = roles;
    _allPermissions = perms;
    renderRolesTable();
  } catch (err) { showToast('Failed to load roles.', 'error'); }
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
    // Load permissions
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
  // Group by module
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
      // For system roles, skip name edit but save permissions
      const role = _allRoles.find(r => r.id === parseInt(id));
      if (!role?.is_system) {
        await api(`/api/admin/roles/${id}`, { method: 'PUT', body: JSON.stringify({ name, description, scope }) }).catch(() => {});
      }
    }
    // Save permissions if matrix is visible
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
    const teams = await api('/api/admin/teams');
    _allTeams = teams;
    renderTeamsTable();
    // Populate account filter
    const accountFilter = document.getElementById('teamsAccountFilter');
    if (accountFilter && _allAccounts.length) {
      accountFilter.innerHTML = '<option value="">All Accounts</option>' + _allAccounts.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
    }
  } catch (err) { showToast('Failed to load teams.', 'error'); }
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
  // Load coverage chips async
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

  // Populate account select
  document.getElementById('teamFormAccount').innerHTML =
    '<option value="">Platform-wide (no restriction)</option>' +
    accounts.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');

  // Populate roles multi-check
  document.getElementById('teamFormRoleList').innerHTML =
    roles.map(r => `<label class="multi-check-item"><input type="checkbox" name="teamRoles" value="${r.id}"> ${escapeHtml(r.name)}${r.is_system ? ' 🔒' : ''}</label>`).join('');

  // Populate categories multi-check
  document.getElementById('teamFormCategoryList').innerHTML =
    cats.map(c => `<label class="multi-check-item"><input type="checkbox" name="teamCats" value="${c.id}" data-name="${escapeHtml(c.name)}"> ${escapeHtml(c.name)}</label>`).join('');

  document.getElementById('editTeamId').value = id || '';
  if (id) {
    const team = _allTeams.find(t => t.id === id);
    document.getElementById('teamDrawerTitle').textContent = `Edit Team: ${team?.name || ''}`;
    document.getElementById('teamFormName').value = team?.name || '';
    document.getElementById('teamFormAccount').value = team?.account_id || '';
    document.getElementById('teamFormStatus').value = team?.status || 'active';
    // Load existing roles+categories
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
    // Save roles
    const roles = [...document.querySelectorAll('input[name="teamRoles"]:checked')].map(cb => ({ role_id: parseInt(cb.value), is_default: false }));
    await api(`/api/admin/teams/${teamId}/roles`, { method: 'PUT', body: JSON.stringify({ roles }) });
    // Save categories
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
// ██  ACCOUNTS
// ══════════════════════════════════════════════════════════

async function loadAccounts() {
  try {
    const accounts = await api('/api/admin/accounts');
    _allAccounts = accounts;
    renderAccountsTable();
  } catch { showToast('Failed to load accounts.', 'error'); }
}

function renderAccountsTable() {
  const tbody = document.getElementById('accountsBody');
  if (!tbody) return;
  const search = (document.getElementById('accountsSearch')?.value || '').toLowerCase();
  const statusF = document.getElementById('accountsStatusFilter')?.value;
  let filtered = _allAccounts.filter(a => {
    if (search && !a.name.toLowerCase().includes(search)) return false;
    if (statusF && a.status !== statusF) return false;
    return true;
  });
  tbody.innerHTML = filtered.map(a => `
    <tr>
      <td>${a.id}</td>
      <td><strong>${escapeHtml(a.name)}</strong></td>
      <td><span style="font-size:12px;opacity:.7">${escapeHtml(a.domain || '—')}</span></td>
      <td><span class="status-badge status-badge--${a.status === 'active' ? 'approved' : 'rejected'}">${a.status}</span></td>
      <td>${a.employee_count ?? 0}</td>
      <td>${a.team_count ?? 0}</td>
      <td>
        <button class="btn btn--ghost btn--sm" onclick="toggleAccountStatus(${a.id},'${a.status === 'active' ? 'suspended' : 'active'}','${escapeHtml(a.name)}')">${a.status === 'active' ? 'Suspend' : 'Activate'}</button>
        <button class="btn btn--danger btn--sm" onclick="deleteAccount(${a.id})">🗑</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="7" style="text-align:center;opacity:.5">No accounts found.</td></tr>';
}

function openAccountDrawer() {
  const name = prompt('Account name:');
  if (!name) return;
  const domain = prompt('Domain (optional):');
  api('/api/admin/accounts', { method: 'POST', body: JSON.stringify({ name, domain: domain || undefined }) })
    .then(() => { showToast('Account created.', 'success'); loadAccounts(); })
    .catch(err => showToast(err.message, 'error'));
}

window.toggleAccountStatus = async (id, newStatus, name) => {
  if (!confirm(`Set account "${name}" to ${newStatus}?`)) return;
  try {
    await api(`/api/admin/accounts/${id}`, { method: 'PUT', body: JSON.stringify({ status: newStatus }) });
    showToast('Account updated.', 'success');
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

// ══════════════════════════════════════════════════════════
// ██  EMPLOYEES
// ══════════════════════════════════════════════════════════

let _allEmployees = [];

async function loadEmployees() {
  try {
    const [accounts, teams, roles, employees] = await Promise.all([
      api('/api/admin/accounts'),
      api('/api/admin/teams'),
      api('/api/admin/roles'),
      api('/api/admin/employees'),
    ]);
    _allAccounts = accounts; _allTeams = teams; _allRoles = roles; _allEmployees = employees;
    renderEmployeesTable();
    // Populate filter selects
    const acctFilter = document.getElementById('employeesAccountFilter');
    if (acctFilter) acctFilter.innerHTML = '<option value="">All Accounts</option>' + accounts.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
  } catch { showToast('Failed to load employees.', 'error'); }
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
    api('/api/admin/accounts'),
    api('/api/admin/teams'),
    api('/api/admin/roles'),
  ]);
  _allAccounts = accounts; _allTeams = teams; _allRoles = roles;

  // Populate form selects
  const acctSel = document.getElementById('empFormAccount');
  acctSel.innerHTML = '<option value="">Select account…</option>' + accounts.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');

  const roleSel = document.getElementById('empFormRole');
  roleSel.innerHTML = '<option value="">Select role…</option>' + roles.map(r => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');

  // All teams initially in team select
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
    // Load overrides
    const overrides = await api(`/api/admin/employees/${id}/overrides`).catch(() => []);
    renderOverridesList(overrides);
    // Populate permission select for adding overrides
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

// ══════════════════════════════════════════════════════════
// ██  STATS — RBAC row
// ══════════════════════════════════════════════════════════
// Extend the existing loadStats to also populate RBAC stat cards
const _origLoadStats = window._loadStats || null;
function extendLoadStatsWithRBAC(stats) {
  const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val ?? '—'; };
  setEl('statAccounts', stats.totalAccounts);
  setEl('statTeams', stats.totalTeams);
  setEl('statEmployees', stats.totalEmployees);
  setEl('statPendingInvites', stats.pendingInvites);
  setEl('statRoles', stats.totalRoles);
  setEl('statTicketCategories', stats.totalTicketCategories);
}
// Patch: expose for admin.js closure to call
window._extendLoadStatsWithRBAC = extendLoadStatsWithRBAC;

  try {
    const [cats, subcats] = await Promise.all([
      api('/api/admin/tax/categories'),
      api('/api/admin/tax/subcategories')
    ]);

    // Populate categories table
    const catBody = document.getElementById('taxCategoriesBody');
    catBody.innerHTML = cats.map(c => `
      <tr>
        <td>${c.id}</td>
        <td>${escapeHtml(c.name)}</td>
        <td>${escapeHtml(c.description || '—')}</td>
        <td><span class="status-badge status-badge--${c.is_active ? 'approved' : 'rejected'}">${c.is_active ? 'Active' : 'Inactive'}</span></td>
        <td><button class="btn btn--danger btn--sm" onclick="deleteTaxCategory(${c.id})">Delete</button></td>
      </tr>`).join('') || '<tr><td colspan="5" style="text-align:center;opacity:.5">No categories yet.</td></tr>';

    // Populate parent select
    const parentSelect = document.getElementById('newSubcatParent');
    parentSelect.innerHTML = '<option value="">Select category...</option>' +
      cats.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');

    // Populate subcategories table
    const subBody = document.getElementById('taxSubcatsBody');
    subBody.innerHTML = subcats.map(s => `
      <tr>
        <td>${s.id}</td>
        <td>${escapeHtml(s.category_name || '—')}</td>
        <td>${escapeHtml(s.name)}</td>
        <td><button class="btn btn--danger btn--sm" onclick="deleteTaxSubcat(${s.id})">Delete</button></td>
      </tr>`).join('') || '<tr><td colspan="4" style="text-align:center;opacity:.5">No sub-categories yet.</td></tr>';
  } catch (err) {
    showToast('Failed to load taxonomy.', 'error');
  }
}

window.deleteTaxCategory = async function(id) {
  if (!confirm('Delete this category?')) return;
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
    loadTaxonomy();
  } catch (err) { showToast(err.message, 'error'); }
};

// ── Roles ──
async function loadRoles() {
  try {
    const roles = await api('/api/admin/roles');
    const tbody = document.getElementById('rolesBody');
    tbody.innerHTML = roles.map(r => `
      <tr>
        <td>${r.id}</td>
        <td>${escapeHtml(r.name)}</td>
        <td>${escapeHtml(r.description || '—')}</td>
        <td>${r.is_system ? '🔒 System' : 'Custom'}</td>
        <td>${!r.is_system ? `<button class="btn btn--danger btn--sm" onclick="deleteRole(${r.id})">Delete</button>` : '—'}</td>
      </tr>`).join('') || '<tr><td colspan="5" style="text-align:center;opacity:.5">No roles yet.</td></tr>';
  } catch (err) { showToast('Failed to load roles.', 'error'); }
}

window.deleteRole = async function(id) {
  if (!confirm('Delete this role?')) return;
  try {
    await api(`/api/admin/roles/${id}`, { method: 'DELETE' });
    showToast('Role deleted.', 'success');
    loadRoles();
  } catch (err) { showToast(err.message, 'error'); }
};

// ── Teams ──
async function loadTeams() {
  try {
    const teams = await api('/api/admin/teams');
    const tbody = document.getElementById('teamsBody');
    tbody.innerHTML = teams.map(t => `
      <tr>
        <td>${t.id}</td>
        <td>${escapeHtml(t.name)}</td>
        <td>${escapeHtml(t.description || '—')}</td>
        <td><span class="status-badge status-badge--${t.is_active ? 'approved' : 'rejected'}">${t.is_active ? 'Active' : 'Inactive'}</span></td>
        <td><button class="btn btn--danger btn--sm" onclick="deleteTeam(${t.id})">Delete</button></td>
      </tr>`).join('') || '<tr><td colspan="5" style="text-align:center;opacity:.5">No teams yet.</td></tr>';

    // Populate invite team select
    const inviteTeam = document.getElementById('inviteTeam');
    if (inviteTeam) {
      inviteTeam.innerHTML = '<option value="">Select team...</option>' +
        teams.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
    }
  } catch (err) { showToast('Failed to load teams.', 'error'); }
}

window.deleteTeam = async function(id) {
  if (!confirm('Delete this team?')) return;
  try {
    await api(`/api/admin/teams/${id}`, { method: 'DELETE' });
    showToast('Team deleted.', 'success');
    loadTeams();
  } catch (err) { showToast(err.message, 'error'); }
};

// ── Employees ──
async function loadAccounts() {
  try {
    const accounts = await api('/api/admin/accounts');
    const tbody = document.getElementById('accountsBody');
    tbody.innerHTML = accounts.map(a => `
      <tr>
        <td>${a.id}</td>
        <td>${escapeHtml(a.name)}</td>
        <td>${escapeHtml(a.domain || '\u2014')}</td>
        <td><span class="status-badge status-badge--${a.status === 'active' ? 'approved' : 'rejected'}">${a.status}</span></td>
        <td>${a.employee_count ?? 0}</td>
        <td>${a.team_count ?? 0}</td>
        <td>
          <button class="btn btn--ghost btn--sm" onclick="toggleAccountStatus(${a.id},'${a.status === 'active' ? 'suspended' : 'active'}','${escapeHtml(a.name)}')">${a.status === 'active' ? 'Suspend' : 'Activate'}</button>
          <button class="btn btn--danger btn--sm" onclick="deleteAccount(${a.id})">Delete</button>
        </td>
      </tr>`).join('') || '<tr><td colspan="7" style="text-align:center;opacity:.5">No accounts yet.</td></tr>';
  } catch { showToast('Failed to load accounts.', 'error'); }
}

window.toggleAccountStatus = async (id, newStatus, name) => {
  if (!confirm(`Set account "${name}" to ${newStatus}?`)) return;
  try {
    await api(`/api/admin/accounts/${id}`, { method: 'PUT', body: JSON.stringify({ status: newStatus }) });
    showToast('Account updated.', 'success');
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

async function loadEmployees() {
  try {
    const [accounts, teams, roles, employees] = await Promise.all([
      api('/api/admin/accounts'),
      api('/api/admin/teams'),
      api('/api/admin/roles'),
      api('/api/admin/employees'),
    ]);
    const acctSel = document.getElementById('inviteAccount');
    const teamSel = document.getElementById('inviteTeam');
    const roleSel = document.getElementById('inviteRole');
    acctSel.innerHTML = '<option value="">Select account...</option>' + accounts.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
    teamSel.innerHTML = '<option value="">Select team...</option>' + teams.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
    roleSel.innerHTML = '<option value="">Select role...</option>' + roles.map(r => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
    const tbody = document.getElementById('employeesBody');
    tbody.innerHTML = employees.map(e => `
      <tr>
        <td>${e.id}</td>
        <td>${escapeHtml(e.full_name)}</td>
        <td>${escapeHtml(e.email)}</td>
        <td>${escapeHtml(e.account_name || '\u2014')}</td>
        <td>${escapeHtml(e.team_name || '\u2014')}</td>
        <td>${escapeHtml(e.role_name || '\u2014')}</td>
        <td><span class="status-badge status-badge--${e.employment_status === 'active' ? 'approved' : e.employment_status === 'pending_invite' ? 'pending' : 'rejected'}">${e.employment_status}</span></td>
        <td style="display:flex;gap:6px;">
          <button class="btn btn--ghost btn--sm" onclick="viewEmployeePerms(${e.id},'${escapeHtml(e.full_name)}')">Permissions</button>
          <button class="btn btn--danger btn--sm" onclick="deleteEmployee(${e.id})">Remove</button>
        </td>
      </tr>`).join('') || '<tr><td colspan="8" style="text-align:center;opacity:.5">No employees yet.</td></tr>';
  } catch { showToast('Failed to load employees.', 'error'); }
}

window.viewEmployeePerms = async (id, name) => {
  try {
    const perms = await api(`/api/admin/employees/${id}/effective-permissions`);
    document.getElementById('empPermsName').textContent = name;
    document.getElementById('empPermsAllowed').innerHTML = perms.allowed.length
      ? perms.allowed.map(p => `<li><code>${p}</code></li>`).join('')
      : '<li style="opacity:.5">None</li>';
    document.getElementById('empPermsDenied').innerHTML = perms.denied.length
      ? perms.denied.map(p => `<li><code>${p}</code></li>`).join('')
      : '<li style="opacity:.5">None</li>';
    document.getElementById('empPermsModal').classList.add('active');
  } catch (err) { showToast(err.message, 'error'); }
};

window.deleteEmployee = async (id) => {
  if (!confirm('Remove this employee? This cannot be undone.')) return;
  try {
    await api(`/api/admin/employees/${id}`, { method: 'DELETE' });
    showToast('Employee removed.', 'success');
    loadEmployees();
  } catch (err) { showToast(err.message, 'error'); }
}catch (err) { showToast('Failed to load employees.', 'error'); }
}

// ── Event bindings for new panels ──
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('addTaxCategoryBtn')?.addEventListener('click', async () => {
    const name = document.getElementById('newTaxCategoryName').value.trim();
    const description = document.getElementById('newTaxCategoryDesc').value.trim();
    if (!name) return showToast('Name is required.', 'warning');
    try {
      await api('/api/admin/tax/categories', { method: 'POST', body: JSON.stringify({ name, description }) });
      document.getElementById('newTaxCategoryName').value = '';
      document.getElementById('newTaxCategoryDesc').value = '';
      showToast('Category added.', 'success');
      loadTaxonomy();
    } catch (err) { showToast(err.message, 'error'); }
  });

  document.getElementById('addSubcatBtn')?.addEventListener('click', async () => {
    const category_id = document.getElementById('newSubcatParent').value;
    const name = document.getElementById('newSubcatName').value.trim();
    if (!category_id || !name) return showToast('Select a category and enter a name.', 'warning');
    try {
      await api('/api/admin/tax/subcategories', { method: 'POST', body: JSON.stringify({ category_id: parseInt(category_id), name }) });
      document.getElementById('newSubcatName').value = '';
      showToast('Sub-category added.', 'success');
      loadTaxonomy();
    } catch (err) { showToast(err.message, 'error'); }
  });

  document.getElementById('addRoleBtn')?.addEventListener('click', async () => {
    const name = document.getElementById('newRoleName').value.trim();
    const description = document.getElementById('newRoleDesc').value.trim();
    if (!name) return showToast('Role name is required.', 'warning');
    try {
      await api('/api/admin/roles', { method: 'POST', body: JSON.stringify({ name, description }) });
      document.getElementById('newRoleName').value = '';
      document.getElementById('newRoleDesc').value = '';
      showToast('Role created.', 'success');
      loadRoles();
    } catch (err) { showToast(err.message, 'error'); }
  });

  document.getElementById('addTeamBtn')?.addEventListener('click', async () => {
    const name = document.getElementById('newTeamName').value.trim();
    const description = document.getElementById('newTeamDesc').value.trim();
    if (!name) return showToast('Team name is required.', 'warning');
    try {
      await api('/api/admin/teams', { method: 'POST', body: JSON.stringify({ name, description }) });
      document.getElementById('newTeamName').value = '';
      document.getElementById('newTeamDesc').value = '';
      showToast('Team created.', 'success');
      loadTeams();
    } catch (err) { showToast(err.message, 'error'); }
  });

  document.getElementById('addAccountBtn')?.addEventListener('click', async () => {
    const name = document.getElementById('newAccountName').value.trim();
    const domain = document.getElementById('newAccountDomain').value.trim();
    if (!name) return showToast('Account name is required.', 'warning');
    try {
      await api('/api/admin/accounts', { method: 'POST', body: JSON.stringify({ name, domain: domain || undefined }) });
      document.getElementById('newAccountName').value = '';
      document.getElementById('newAccountDomain').value = '';
      showToast('Account created.', 'success');
      loadAccounts();
    } catch (err) { showToast(err.message, 'error'); }
  });

  document.getElementById('sendInviteBtn')?.addEventListener('click', async () => {
    const full_name = document.getElementById('inviteFullName').value.trim();
    const email = document.getElementById('inviteEmail').value.trim();
    const account_id = document.getElementById('inviteAccount').value;
    const team_id = document.getElementById('inviteTeam').value;
    const role_id = document.getElementById('inviteRole').value;
    if (!full_name || !email || !account_id) return showToast('Full name, email, and account are required.', 'warning');
    try {
      const res = await api('/api/admin/employees/invite', { method: 'POST', body: JSON.stringify({
        full_name, email,
        account_id: parseInt(account_id),
        team_id: team_id ? parseInt(team_id) : null,
        role_id: role_id ? parseInt(role_id) : null
      })});
      document.getElementById('inviteFullName').value = '';
      document.getElementById('inviteEmail').value = '';
      showToast(`Invite sent. Token: ${res.token}`, 'success');
      loadEmployees();
    } catch (err) { showToast(err.message, 'error'); }
  });

});
