// admin.js — Admin dashboard: login, MFA, moderation queues, reports, categories, bans, settings, audit log

(function () {
  let adminToken = sessionStorage.getItem('adminToken');
  let preToken = null;
  let allBooksList = [];

  // ── Check Auth State ──
  function checkAuth() {
    // Sync with the token that may have been set by the inline login handler
    adminToken = sessionStorage.getItem('adminToken');
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
  window.adminHandleLogin = handleLogin;
  async function handleLogin(e) {
    if (e) e.preventDefault();
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
      case 'books': loadBooks(); break;
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
    adminToken = sessionStorage.getItem('adminToken'); // always refresh from storage
    loadStats();
  }
  // Expose globally so inline login handler in admin.html can call it
  window.loadDashboardData = loadDashboardData;

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
      
      // Populate new book stats
      const statBooks = document.getElementById('statBooks');
      if (statBooks) statBooks.textContent = stats.totalBooks !== undefined ? stats.totalBooks : '—';
      const statPendingBooks = document.getElementById('statPendingBooks');
      if (statPendingBooks) statPendingBooks.textContent = stats.pendingBooks !== undefined ? stats.pendingBooks : '—';
      const statCategories = document.getElementById('statCategories');
      if (statCategories) statCategories.textContent = stats.totalCategories !== undefined ? stats.totalCategories : '—';

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
      const categories = await api('/api/categories');
      const tbody = document.getElementById('categoriesBody');
      tbody.innerHTML = '';

      categories.forEach(cat => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${cat.id}</td>
          <td>${escapeHtml(cat.name)}</td>
          <td><code>${escapeHtml(cat.slug)}</code></td>
          <td><span class="filter-chip" style="font-size: 0.75rem;">${escapeHtml(cat.channel_type || 'education')}</span></td>
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
    const channel_type = document.getElementById('newCategoryChannel').value;
    if (!name) {
      showToast('Enter a category name.', 'warning');
      return;
    }
    try {
      await api('/api/admin/categories', {
        method: 'POST',
        body: JSON.stringify({ name, channel_type })
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

    // Book tab triggers
    const btnBooksListTab = document.getElementById('btnBooksListTab');
    const btnBooksUploadTab = document.getElementById('btnBooksUploadTab');
    const btnBooksSubmissionsTab = document.getElementById('btnBooksSubmissionsTab');

    if (btnBooksListTab) btnBooksListTab.addEventListener('click', () => switchBookTab('booksListTabSection', 'btnBooksListTab'));
    if (btnBooksUploadTab) btnBooksUploadTab.addEventListener('click', () => switchBookTab('booksUploadTabSection', 'btnBooksUploadTab'));
    if (btnBooksSubmissionsTab) btnBooksSubmissionsTab.addEventListener('click', () => switchBookTab('booksSubmissionsTabSection', 'btnBooksSubmissionsTab'));

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
        
        tr.innerHTML = `
          <td><input type="checkbox" class="book-select-checkbox" data-book-id="${book.id}" style="cursor:pointer; transform:scale(1.25);"></td>
          <td><img src="${book.cover_image_url || '/images/default-cover.png'}" style="width: 40px; height: 60px; object-fit: cover; border-radius: 4px; border: 1px solid var(--border-card);"></td>
          <td style="font-weight: 500;">${escapeHtml(book.title || '')}</td>
          <td>${escapeHtml(book.author || '')}</td>
          <td><span class="filter-chip" style="font-size: 0.75rem;">${fileType}</span></td>
          <td><span class="status-badge status-badge--${visibility === 'public' ? 'approved' : 'pending'}">${visibility}</span></td>
          <td><span class="status-badge status-badge--${status === 'published' ? 'approved' : 'pending'}">${status}</span></td>
          <td>${book.uploaded_by ? `User ID: ${book.uploaded_by}` : 'Admin'}</td>
          <td>
            <div class="flex gap-8">
              <button class="btn btn--danger btn--sm" onclick="window.deleteBook(${book.id})">Delete</button>
            </div>
          </td>
        `;
        tbody.appendChild(tr);
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
            <td><img src="${sub.cover_image_url || '/images/default-cover.png'}" style="width: 40px; height: 60px; object-fit: cover; border-radius: 4px; border: 1px solid var(--border-card);"></td>
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
})();

