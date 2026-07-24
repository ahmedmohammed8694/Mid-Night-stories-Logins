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
  let currentStoriesList = [];

  async function loadStoriesQueue(status) {
    if (status) currentStoryQueueStatus = status;
    try {
      const data = await api(`/api/admin/queue?type=stories&status=${currentStoryQueueStatus}`);
      const tbody = document.getElementById('storiesQueueBody');
      const empty = document.getElementById('noStoriesQueue');
      tbody.innerHTML = '';
      currentStoriesList = data.items || [];

      if (currentStoriesList.length === 0) {
        empty.classList.remove('hidden');
        document.getElementById('storiesQueueTable').closest('.admin-table-wrapper').classList.add('hidden');
        return;
      }

      empty.classList.add('hidden');
      document.getElementById('storiesQueueTable').closest('.admin-table-wrapper').classList.remove('hidden');

      currentStoriesList.forEach(item => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${item.id}</td>
          <td style="font-weight: 500;">
            <a href="#" class="admin-story-detail-trigger" data-story-id="${item.id}" style="color: var(--text-primary); text-decoration: none;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">
              ${escapeHtml(item.title || 'Untitled')}
            </a>
          </td>
          <td><div class="admin-table__preview" style="max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(item.body ? item.body.substring(0, 100) : '')}</div></td>
          <td>${escapeHtml(item.category_name || 'General')}</td>
          <td><span class="status-badge status-badge--${item.status === 'approved' ? 'approved' : item.status === 'rejected' ? 'rejected' : 'pending'}">${escapeHtml(item.status)}</span></td>
          <td>${formatDate(item.created_at)}</td>
          <td>
            <div class="admin-table__actions" style="display: flex; gap: 6px;">
              <button class="btn btn--secondary btn--sm admin-story-detail-trigger" data-story-id="${item.id}" style="padding: 4px 8px; font-size: 0.8rem;">🔍 Details</button>
              ${item.status !== 'approved' ? `<button class="btn btn--success btn--sm" onclick="moderateItem('story', ${item.id}, 'approve')" style="padding: 4px 8px;" title="Approve">✓</button>` : ''}
              ${item.status !== 'rejected' ? `<button class="btn btn--danger btn--sm" onclick="moderateItem('story', ${item.id}, 'reject')" style="padding: 4px 8px;" title="Reject">✕</button>` : ''}
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
      showToast('Failed to load stories.', 'error');
    }
  }

  function openAdminStoryModal(story) {
    const modal = document.getElementById('adminStoryReviewModal');
    if (!modal) return;

    document.getElementById('adminStoryId').textContent = `ID: #${story.id}`;
    document.getElementById('adminStoryTitle').textContent = story.title || 'Untitled Story';
    document.getElementById('adminStoryMeta').textContent = `By ${story.author_name || (story.user_id ? 'User #' + story.user_id : 'Anonymous')} • Submitted ${formatDate(story.created_at)}`;
    document.getElementById('adminStoryCategory').textContent = story.category_name || 'General';
    document.getElementById('adminStoryContent').textContent = story.body || 'No text content available.';
    document.getElementById('adminStoryLikes').textContent = story.like_count || 0;
    document.getElementById('adminStoryComments').textContent = story.comment_count || 0;

    const badge = document.getElementById('adminStoryStatusBadge');
    badge.className = `status-badge status-badge--${story.status === 'approved' ? 'approved' : story.status === 'rejected' ? 'rejected' : 'pending'}`;
    badge.textContent = (story.status || 'pending').toUpperCase();

    const imgContainer = document.getElementById('adminStoryImageContainer');
    const imgEl = document.getElementById('adminStoryImage');
    if (story.image_url) {
      imgEl.src = story.image_url;
      imgContainer.style.display = 'block';
    } else {
      imgContainer.style.display = 'none';
    }

    // Bind modal actions
    const approveBtn = document.getElementById('adminStoryApproveBtn');
    const rejectBtn = document.getElementById('adminStoryRejectBtn');

    approveBtn.onclick = async () => {
      await moderateItem('story', story.id, 'approve');
      modal.style.display = 'none';
      modal.classList.remove('active');
    };

    rejectBtn.onclick = async () => {
      await moderateItem('story', story.id, 'reject');
      modal.style.display = 'none';
      modal.classList.remove('active');
    };

    modal.style.display = 'flex';
    modal.classList.add('active');
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
        const isAdmin = msg.sender_role === 'admin' || msg.sender_role === 'system';
        const color = isAdmin ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255,255,255,0.06)';
        const borderColor = isAdmin ? '#818cf8' : 'rgba(255,255,255,0.12)';
        const align = isAdmin ? 'flex-end' : 'flex-start';
        
        container.innerHTML += `
          <div style="align-self: ${align}; max-width: 85%; background: ${color}; padding: 12px 16px; border-radius: 12px; border: 1px solid ${borderColor}; margin-bottom: 8px;">
            <div style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 6px; display: flex; justify-content: space-between; gap: 12px; align-items: center;">
              ${isAdmin ? 
                `<span style="background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; padding: 2px 8px; border-radius: 12px; font-weight: bold; font-size: 0.7rem;">🛡️ Admin (You)</span>` : 
                `<strong style="color: var(--text-primary);">👤 User</strong>`
              }
              <span>${new Date(msg.created_at).toLocaleString()}</span>
            </div>
            <div style="font-size: 0.92rem; color: var(--text-primary); line-height: 1.5; white-space: pre-wrap;">${escapeHtml(msg.message_body)}</div>
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
            <option value="naval" ${item.channel_type === 'naval' ? 'selected' : ''}>Naval</option>
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
})();

