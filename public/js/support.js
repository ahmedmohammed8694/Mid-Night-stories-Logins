document.addEventListener('DOMContentLoaded', async () => {
  const token = localStorage.getItem('token');
  if (!token) {
    window.location.href = '/login.html';
    return;
  }

  const ticketListEl = document.getElementById('ticketList');
  const ticketViewEl = document.getElementById('ticketView');
  const viewTicketId = document.getElementById('viewTicketId');
  const viewTicketReason = document.getElementById('viewTicketReason');
  const viewTicketStatus = document.getElementById('viewTicketStatus');
  const ticketMessagesEl = document.getElementById('ticketMessages');
  const ticketReplyBox = document.getElementById('ticketReplyBox');
  const resolvedNotice = document.getElementById('resolvedNotice');
  const replyText = document.getElementById('replyText');
  const replyBtn = document.getElementById('replyBtn');

  let activeTicketId = null;

  async function loadTickets() {
    try {
      const tickets = await api('/api/user/tickets');
      
      if (tickets.length === 0) {
        ticketListEl.innerHTML = '<div class="empty-state">You have no support tickets.</div>';
        return;
      }

      ticketListEl.innerHTML = '';
      tickets.forEach(ticket => {
        const item = document.createElement('div');
        item.className = 'ticket-item';
        item.dataset.id = ticket.id;
        
        const dateStr = new Date(ticket.created_at).toLocaleDateString();
        item.innerHTML = `
          <div class="ticket-id">${ticket.ticket_id}</div>
          <div style="font-size: 0.9rem; color: var(--text-secondary); margin-top: 4px;">${escapeHtml(ticket.reason)}</div>
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div class="ticket-status status-${ticket.ticket_status}">${ticket.ticket_status.replace('_', ' ')}</div>
            <div style="font-size: 0.8rem; color: var(--text-muted);">${dateStr}</div>
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
      const messages = data.messages;

      viewTicketId.textContent = ticket.ticket_id;
      viewTicketReason.textContent = ticket.reason;
      viewTicketStatus.textContent = ticket.ticket_status.replace('_', ' ');
      viewTicketStatus.className = `ticket-status status-${ticket.ticket_status}`;

      ticketMessagesEl.innerHTML = '';

      // Add the original report description as the first message
      if (ticket.report_description || ticket.attachment_url) {
        const descHtml = ticket.report_description ? escapeHtml(ticket.report_description) : '<i>[No description provided]</i>';
        const attachHtml = ticket.attachment_url ? `<div style="margin-top: 1rem;"><a href="${ticket.attachment_url}" target="_blank" style="color: var(--primary);">View Attachment 📁</a></div>` : '';
        const initialMsg = document.createElement('div');
        initialMsg.className = 'message-bubble msg-user';
        initialMsg.innerHTML = `
          <div class="msg-meta">
            <span class="msg-author">You</span>
            <span>${new Date(ticket.created_at).toLocaleString()}</span>
          </div>
          <div class="msg-body">${descHtml}${attachHtml}</div>
        `;
        ticketMessagesEl.appendChild(initialMsg);
      } else {
        const initialMsg = document.createElement('div');
        initialMsg.className = 'message-bubble msg-user';
        initialMsg.innerHTML = `
          <div class="msg-meta">
            <span class="msg-author">You</span>
            <span>${new Date(ticket.created_at).toLocaleString()}</span>
          </div>
          <div class="msg-body"><i>Report opened for: ${escapeHtml(ticket.reason)}</i></div>
        `;
        ticketMessagesEl.appendChild(initialMsg);
      }

      messages.forEach(msg => {
        const bubble = document.createElement('div');
        const isAdmin = msg.sender_role === 'admin' || msg.sender_role === 'system';
        bubble.className = `message-bubble ${isAdmin ? 'msg-admin' : 'msg-user'}`;
        
        const authorHtml = isAdmin 
          ? `<span style="background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #ffffff; padding: 2px 8px; border-radius: 12px; font-weight: bold; font-size: 0.75rem;">🛡️ Midnight Support Team (Admin)</span>`
          : `<span class="msg-author" style="color: var(--text-primary);">👤 You</span>`;
        
        bubble.innerHTML = `
          <div class="msg-meta" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            ${authorHtml}
            <span style="font-size: 0.75rem; color: var(--text-muted);">${new Date(msg.created_at).toLocaleString()}</span>
          </div>
          <div class="msg-body" style="font-size: 0.95rem; line-height: 1.5; white-space: pre-wrap;">${escapeHtml(msg.message_body)}</div>
        `;
        ticketMessagesEl.appendChild(bubble);
      });

      // Scroll to bottom
      ticketMessagesEl.scrollTop = ticketMessagesEl.scrollHeight;

      // Handle UI state based on ticket status
      if (ticket.ticket_status === 'resolved' || ticket.ticket_status === 'closed') {
        ticketReplyBox.classList.add('disabled');
        resolvedNotice.style.display = 'block';
      } else {
        ticketReplyBox.classList.remove('disabled');
        resolvedNotice.style.display = 'none';
      }

    } catch (err) {
      showToast(err.message, 'error');
    }
  }

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
      // Reload details to show new message and update status
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
      if (layoutSection) layoutSection.classList.add('hidden');
      if (msgSection) msgSection.classList.remove('hidden');
      loadAdminMessagesInbox();
    });
  }

  loadTickets();
  loadAdminMessagesInbox();
});
