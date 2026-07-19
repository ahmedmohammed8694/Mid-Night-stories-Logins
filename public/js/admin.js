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
    const code = document.getElementById('mfaCode').value.replace(/\s+/g, '');
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

  // ── Reports / Tickets ──
  let currentTicketStatus = 'open';

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
        tr.innerHTML = `
          <td><span style="font-family: monospace; font-weight: bold;">${report.ticket_id || report.id}</span></td>
          <td><span class="status-badge status-badge--pending">${report.reported_item_type}</span></td>
          <td><div class="admin-table__preview">${escapeHtml(report.target_preview || `ID: ${report.reported_item_id}`)}</div></td>
          <td>${escapeHtml(report.reason)}</td>
          <td>
            <div style="font-size: 0.9rem;">${escapeHtml(report.reporter_name || 'User ' + report.reporter_id)}</div>
            <div style="font-size: 0.75rem; color: var(--text-muted);">${formatDate(report.created_at)}</div>
          </td>
          <td><span class="status-badge status-badge--${report.ticket_status.replace('_', '-')}">${report.ticket_status.replace('_', ' ')}</span></td>
          <td>
            <div class="admin-table__actions">
              <button class="btn btn--primary btn--sm" onclick='window.openTicketModal(${JSON.stringify(report).replace(/'/g, "&#39;")})'>Review Ticket</button>
            </div>
          </td>
        `;
        tbody.appendChild(tr);
      });
    } catch (err) {
      showToast('Failed to load tickets.', 'error');
    }
  }

  window.openTicketModal = async function (report) {
    window.currentTicketId = report.id;
    window.currentTicketTargetUser = report.target_user_id;

    document.getElementById('modalTicketId').textContent = report.ticket_id || report.id;
    document.getElementById('modalTicketStatus').textContent = report.ticket_status.replace('_', ' ');
    document.getElementById('modalTicketStatus').className = `filter-chip status-${report.ticket_status.replace('_', '-')}`;
    
    document.getElementById('modalTargetType').textContent = report.reported_item_type;
    document.getElementById('modalTargetId').textContent = report.reported_item_id;
    document.getElementById('modalTargetUserId').textContent = report.target_user_id || 'Unknown';
    document.getElementById('modalTargetPreview').textContent = report.target_preview || 'No preview available.';
    
    document.getElementById('enforcementAction').value = report.enforcement_action || '';
    document.getElementById('adminMsgTitle').value = '';
    document.getElementById('adminMsgBody').value = '';
    document.getElementById('adminReplyText').value = '';
    
    document.getElementById('ticketChatMessages').innerHTML = '<div class="empty-state">Loading chat...</div>';
    document.getElementById('reportDetailsModal').classList.add('active');
    
    await loadTicketMessages(report);
    window.loadUserAuditData(report.target_user_id);
  };

  async function loadTicketMessages(report) {
    try {
      const data = await api(`/api/tickets/${report.id}/messages`);
      const container = document.getElementById('ticketChatMessages');
      container.innerHTML = '';
      
      const descHtml = report.report_description ? escapeHtml(report.report_description) : '<i>[No description provided]</i>';
      const attachHtml = report.attachment_url ? `<div style="margin-top: 1rem;"><a href="${report.attachment_url}" target="_blank" style="color: var(--primary);">View Attachment 📁</a></div>` : '';
      
      container.innerHTML += `
        <div style="background: rgba(255,255,255,0.05); padding: 1rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1);">
          <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.5rem;">Original Report from User ${report.reporter_id}</div>
          <div style="font-weight: bold; margin-bottom: 0.5rem;">Reason: ${escapeHtml(report.reason)}</div>
          <div style="font-size: 0.9rem; color: var(--text-secondary);">${descHtml}${attachHtml}</div>
        </div>
      `;

      data.messages.forEach(msg => {
        const isUser = msg.sender_role === 'user';
        const color = isUser ? 'rgba(255,255,255,0.05)' : 'rgba(92, 106, 196, 0.15)';
        const align = isUser ? 'flex-start' : 'flex-end';
        
        container.innerHTML += `
          <div style="align-self: ${align}; max-width: 80%; background: ${color}; padding: 1rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1);">
            <div style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 0.5rem; display: flex; justify-content: space-between; gap: 1rem;">
              <strong>${isUser ? 'User' : 'Admin (You)'}</strong>
              <span>${new Date(msg.created_at).toLocaleString()}</span>
            </div>
            <div style="font-size: 0.9rem;">${escapeHtml(msg.message_body)}</div>
          </div>
        `;
      });
      container.scrollTop = container.scrollHeight;
    } catch (err) {
      document.getElementById('ticketChatMessages').innerHTML = `<div class="empty-state">Failed to load chat: ${err.message}</div>`;
    }
  }

  window.sendTicketReply = async function() {
    const text = document.getElementById('adminReplyText').value.trim();
    if (!text) return showToast('Enter a reply message.', 'warning');
    
    try {
      await api(`/api/tickets/${window.currentTicketId}/reply`, {
        method: 'POST',
        body: JSON.stringify({ message_body: text })
      });
      document.getElementById('adminReplyText').value = '';
      const dummyReport = { id: window.currentTicketId };
      await loadTicketMessages(dummyReport); // Ideally fetch full report again, but this works to append chat
      window.loadReports(); // Refresh table
      showToast('Reply sent.', 'success');
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

  window.sendSystemAlert = async function() {
    const title = document.getElementById('adminMsgTitle').value.trim();
    const body = document.getElementById('adminMsgBody').value.trim();
    if (!title || !body) return showToast('Title and message required for system alert.', 'warning');
    if (!window.currentTicketTargetUser) return showToast('Unknown target user ID.', 'error');
    
    try {
      await api('/api/admin/messages/send', {
        method: 'POST',
        body: JSON.stringify({ user_id: window.currentTicketTargetUser, title, body })
      });
      showToast('System alert sent to violator.', 'success');
      document.getElementById('adminMsgTitle').value = '';
      document.getElementById('adminMsgBody').value = '';
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
    const code = document.getElementById('mfaSetupCode').value.replace(/\s+/g, '');
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

      const reportsChips = document.querySelectorAll('[data-ticket-status]');
      reportsChips.forEach(chip => {
        chip.addEventListener('click', () => {
          document.querySelectorAll('[data-ticket-status]').forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          loadReports(chip.dataset.ticketStatus);
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
})();

