document.addEventListener('DOMContentLoaded', async () => {
  const token = localStorage.getItem('token');
  if (!token) {
    window.location.href = '/login.html';
    return;
  }

  const ticketListEl = document.getElementById('ticketList');
  const ticketViewEl = document.getElementById('ticketView');
  const viewTicketId = document.getElementById('viewTicketId');
  const viewTicketSubject = document.getElementById('viewTicketSubject');
  const viewTicketCategory = document.getElementById('viewTicketCategory');
  const viewTicketPriority = document.getElementById('viewTicketPriority');
  const viewTicketStatus = document.getElementById('viewTicketStatus');
  const ticketMessagesEl = document.getElementById('ticketMessages');
  const ticketReplyBox = document.getElementById('ticketReplyBox');
  const resolvedNotice = document.getElementById('resolvedNotice');
  const reopenNoticeSection = document.getElementById('reopenNoticeSection');
  const reopenTicketBtn = document.getElementById('reopenTicketBtn');
  const replyText = document.getElementById('replyText');
  const replyBtn = document.getElementById('replyBtn');

  let activeTicketId = null;
  let currentUserFilter = 'all';

  async function loadTicketCategories() {
    try {
      const categories = await api('/api/user/ticket-categories');
      const select = document.getElementById('ticketCategorySelect');
      if (select && categories.length > 0) {
        select.innerHTML = '';
        categories.forEach(c => {
          const opt = document.createElement('option');
          opt.value = c.id;
          opt.textContent = c.name;
          select.appendChild(opt);
        });
      }
    } catch (e) {}
  }

  async function loadTickets() {
    try {
      const url = currentUserFilter !== 'all' ? `/api/user/tickets?status=${currentUserFilter}` : '/api/user/tickets';
      const tickets = await api(url);
      
      if (tickets.length === 0) {
        ticketListEl.innerHTML = '<div class="empty-state">No support tickets found for this filter.</div>';
        return;
      }

      ticketListEl.innerHTML = '';
      tickets.forEach(ticket => {
        const item = document.createElement('div');
        item.className = 'ticket-item';
        item.dataset.id = ticket.id;
        
        const dateStr = new Date(ticket.created_at).toLocaleDateString();
        const displayTitle = ticket.subject || ticket.reason;
        
        item.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div class="ticket-id" style="font-family:monospace; font-weight:bold;">${ticket.ticket_id}</div>
            <span class="status-badge" style="font-size:0.7rem; padding:2px 6px;">${ticket.priority || 'medium'}</span>
          </div>
          <div style="font-size: 0.92rem; font-weight: 600; color: var(--text-primary); margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(displayTitle)}</div>
          <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 2px;">${escapeHtml(ticket.category_name || 'General')}</div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 6px;">
            <div class="ticket-status status-${ticket.ticket_status}">${ticket.ticket_status.replace(/_/g, ' ')}</div>
            <div style="font-size: 0.78rem; color: var(--text-muted);">${dateStr}</div>
          </div>
        `;

        item.addEventListener('click', () => {
          document.querySelectorAll('.ticket-item').forEach(el => el.classList.remove('active'));
          item.classList.add('active');
          loadTicketDetails(ticket.id);
        });

        ticketListEl.appendChild(item);
      });
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function loadTicketDetails(id) {
    activeTicketId = id;
    ticketViewEl.classList.remove('hidden');
    ticketMessagesEl.innerHTML = '<div class="empty-state">Loading messages...</div>';

    try {
      const data = await api(`/api/tickets/${id}/messages`);
      const ticket = data.ticket;
      const messages = data.messages || [];
      const attachments = data.attachments || [];

      if (viewTicketId) viewTicketId.textContent = ticket.ticket_id;
      if (viewTicketSubject) viewTicketSubject.textContent = ticket.subject || ticket.reason;
      if (viewTicketCategory) viewTicketCategory.textContent = `Category: ${ticket.category_name || 'General Inquiry'}`;
      
      if (viewTicketPriority) {
        viewTicketPriority.textContent = ticket.priority || 'medium';
        const pColor = ticket.priority === 'urgent' ? '#ef4444' : ticket.priority === 'high' ? '#f59e0b' : '#6366f1';
        viewTicketPriority.style.background = pColor;
        viewTicketPriority.style.color = '#ffffff';
      }

      if (viewTicketStatus) {
        viewTicketStatus.textContent = ticket.ticket_status.replace(/_/g, ' ');
        viewTicketStatus.className = `ticket-status status-${ticket.ticket_status}`;
      }

      ticketMessagesEl.innerHTML = '';

      if (messages.length === 0) {
        const descHtml = ticket.report_description ? escapeHtml(ticket.report_description) : '<i>No message description provided</i>';
        const initialMsg = document.createElement('div');
        initialMsg.className = 'message-bubble msg-user';
        initialMsg.innerHTML = `
          <div class="msg-meta">
            <span class="msg-author">👤 You</span>
            <span>${new Date(ticket.created_at).toLocaleString()}</span>
          </div>
          <div class="msg-body">${descHtml}</div>
        `;
        ticketMessagesEl.appendChild(initialMsg);
      } else {
        messages.forEach(msg => {
          const bubble = document.createElement('div');
          const isAdmin = msg.sender_role === 'admin' || msg.sender_role === 'system';
          bubble.className = `message-bubble ${isAdmin ? 'msg-admin' : 'msg-user'}`;
          
          const authorHtml = isAdmin 
            ? `<span style="background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #ffffff; padding: 2px 8px; border-radius: 12px; font-weight: bold; font-size: 0.75rem;">🛡️ Midnight Support Team (Admin)</span>`
            : `<span class="msg-author" style="color: var(--text-primary);">👤 You</span>`;
          
          let fileLinksHtml = '';
          if (msg.attachment_url) {
            fileLinksHtml = `<div style="margin-top: 10px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.1);"><a href="${msg.attachment_url}" target="_blank" style="color: #a5b4fc; text-decoration: underline; font-size: 0.85rem;">📁 View Attachment</a></div>`;
          }

          bubble.innerHTML = `
            <div class="msg-meta" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
              ${authorHtml}
              <span style="font-size: 0.75rem; color: var(--text-muted);">${new Date(msg.created_at).toLocaleString()}</span>
            </div>
            <div class="msg-body" style="font-size: 0.95rem; line-height: 1.5; white-space: pre-wrap;">${escapeHtml(msg.message_body)}${fileLinksHtml}</div>
          `;
          ticketMessagesEl.appendChild(bubble);
        });
      }

      if (attachments.length > 0) {
        const attContainer = document.createElement('div');
        attContainer.style.cssText = 'background: rgba(255,255,255,0.04); border: 1px dashed var(--border-card); border-radius: 8px; padding: 12px; margin-top: 12px;';
        let attHtml = `<div style="font-size: 0.8rem; font-weight: 600; color: var(--text-muted); margin-bottom: 6px;">TICKET ATTACHMENTS (${attachments.length}):</div>`;
        attachments.forEach(a => {
          attHtml += `<div style="margin-bottom: 4px;"><a href="${a.file_path}" target="_blank" style="color: var(--primary); font-size: 0.88rem; text-decoration: underline;">📎 ${escapeHtml(a.file_name)} (${(a.file_size / 1024).toFixed(1)} KB)</a></div>`;
        });
        attContainer.innerHTML = attHtml;
        ticketMessagesEl.appendChild(attContainer);
      }

      ticketMessagesEl.scrollTop = ticketMessagesEl.scrollHeight;

      // Handle UI state based on ticket status & 7-day reopen eligibility
      const isResolved = ticket.ticket_status === 'resolved' || ticket.ticket_status === 'closed';
      if (isResolved) {
        ticketReplyBox.classList.add('disabled');
        if (ticket.can_reopen) {
          resolvedNotice.style.display = 'none';
          reopenNoticeSection.style.display = 'flex';
        } else {
          resolvedNotice.style.display = 'block';
          reopenNoticeSection.style.display = 'none';
        }
      } else {
        ticketReplyBox.classList.remove('disabled');
        resolvedNotice.style.display = 'none';
        reopenNoticeSection.style.display = 'none';
      }

    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // Create Ticket Trigger
  const btnOpenModal = document.getElementById('btnOpenCreateTicketModal');
  if (btnOpenModal) {
    btnOpenModal.addEventListener('click', () => {
      document.getElementById('newTicketModal').classList.remove('hidden');
    });
  }

  window.handleUserCreateTicketSubmit = async function(e) {
    if (e) e.preventDefault();

    const subject = document.getElementById('ticketSubjectInput').value.trim();
    const category_id = document.getElementById('ticketCategorySelect').value;
    const priority = document.getElementById('ticketPrioritySelect').value;
    const details = document.getElementById('ticketDetailsInput').value.trim();
    const fileInput = document.getElementById('ticketFileInput');

    if (!subject || !details) {
      return showToast('Please enter both a Subject and Detailed Message.', 'warning');
    }

    const submitBtn = document.getElementById('btnSubmitNewTicket');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting Ticket...';

    try {
      const formData = new FormData();
      formData.append('subject', subject);
      formData.append('category_id', category_id);
      formData.append('priority', priority);
      formData.append('details', details);

      if (fileInput && fileInput.files.length > 0) {
        const file = fileInput.files[0];
        if (file.size > 10 * 1024 * 1024) {
          submitBtn.disabled = false;
          submitBtn.textContent = '🚀 Create Ticket';
          return showToast('Attachment exceeds maximum allowed size of 10MB.', 'warning');
        }
        formData.append('attachment', file);
      }

      const res = await api('/api/user/tickets/create', {
        method: 'POST',
        body: formData
      });

      showToast(`Support Ticket created! Reference ID: ${res.ticket_id}`, 'success');
      document.getElementById('createTicketForm').reset();
      document.getElementById('newTicketModal').classList.add('hidden');
      
      await loadTickets();
      if (res.id) loadTicketDetails(res.id);
    } catch (err) {
      showToast('Failed to create ticket: ' + err.message, 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = '🚀 Create Ticket';
    }
  };

  // Reopen ticket action
  if (reopenTicketBtn) {
    reopenTicketBtn.addEventListener('click', async () => {
      if (!activeTicketId) return;
      if (!confirm('Reopen this ticket for additional support?')) return;

      reopenTicketBtn.disabled = true;
      reopenTicketBtn.textContent = 'Reopening...';

      try {
        await api(`/api/user/tickets/${activeTicketId}/reopen`, { method: 'POST' });
        showToast('Ticket reopened!', 'success');
        await loadTickets();
        await loadTicketDetails(activeTicketId);
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        reopenTicketBtn.disabled = false;
        reopenTicketBtn.textContent = '🔄 Reopen Ticket';
      }
    });
  }

  // Filter chips for user tickets
  document.querySelectorAll('[data-user-filter]').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('[data-user-filter]').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentUserFilter = chip.dataset.userFilter;
      loadTickets();
    });
  });

  replyBtn.addEventListener('click', async () => {
    if (!activeTicketId) return;
    const body = replyText.value.trim();
    if (!body) return showToast('Please enter a message', 'warning');

    const btnText = replyBtn.textContent;
    replyBtn.textContent = 'Sending...';
    replyBtn.disabled = true;

    try {
      await api(`/api/tickets/${activeTicketId}/reply`, {
        method: 'POST',
        body: JSON.stringify({ message_body: body })
      });
      replyText.value = '';
      showToast('Message sent', 'success');
      loadTicketDetails(activeTicketId);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      replyBtn.textContent = btnText;
      replyBtn.disabled = false;
    }
  });

  async function loadAdminMessagesInbox() {
    const listEl = document.getElementById('adminMessagesList');
    const countEl = document.getElementById('adminMsgCount');
    if (!listEl) return;

    try {
      const data = await api('/api/users/me/support-inbox');
      const messages = data.messages || [];
      
      if (countEl) countEl.textContent = messages.length;

      if (messages.length === 0) {
        listEl.innerHTML = '<div class="empty-state">No direct messages or alerts from Admin.</div>';
        return;
      }

      listEl.innerHTML = '';
      messages.forEach(msg => {
        const card = document.createElement('div');
        card.style.cssText = 'background: rgba(99, 102, 241, 0.12); border: 1px solid rgba(129, 140, 248, 0.35); border-radius: 12px; padding: 18px; text-align: left;';
        
        card.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; flex-wrap: wrap; gap: 8px;">
            <span style="background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #ffffff; padding: 3px 10px; border-radius: 12px; font-weight: bold; font-size: 0.78rem;">🛡️ Official Admin Message</span>
            <span style="font-size: 0.8rem; color: var(--text-muted);">${new Date(msg.created_at).toLocaleString()}</span>
          </div>
          <h4 style="font-size: 1.1rem; color: var(--text-primary); margin-bottom: 8px; font-weight: 600;">${escapeHtml(msg.title)}</h4>
          <div style="font-size: 0.95rem; color: var(--text-secondary); line-height: 1.6; white-space: pre-wrap;">${escapeHtml(msg.body)}</div>
        `;
        listEl.appendChild(card);
      });
    } catch (err) {
      if (listEl) listEl.innerHTML = `<div class="empty-state">Failed to load admin messages: ${err.message}</div>`;
    }
  }

  const tabTickets = document.getElementById('tabSupportTickets');
  const tabAdminMsg = document.getElementById('tabAdminDirectMessages');
  const layoutSection = document.getElementById('supportLayoutSection');
  const msgSection = document.getElementById('adminMessagesSection');

  if (tabTickets && tabAdminMsg) {
    tabTickets.addEventListener('click', () => {
      tabTickets.classList.add('active');
      tabAdminMsg.classList.remove('active');
      if (layoutSection) layoutSection.classList.remove('hidden');
      if (msgSection) msgSection.classList.add('hidden');
    });

    tabAdminMsg.addEventListener('click', () => {
      tabAdminMsg.classList.add('active');
      tabTickets.classList.remove('active');
      if (layoutSection) layoutSection.style.setProperty('display', 'none', 'important');
      if (msgSection) msgSection.classList.remove('hidden');
      loadAdminMessagesInbox();
    });
  }

  loadTicketCategories();
  loadTickets();
  loadAdminMessagesInbox();
});
