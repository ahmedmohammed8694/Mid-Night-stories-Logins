// support.js — Redesigned Support & Helpdesk UI Controller

window.openSupportModal = function() {
  const m = document.getElementById('newTicketModal');
  if (m) {
    m.classList.add('open');
    m.classList.add('active');
    m.style.display = 'flex';
  }
};

window.closeSupportModal = function() {
  const m = document.getElementById('newTicketModal');
  if (m) {
    m.classList.remove('open');
    m.classList.remove('active');
    m.style.display = 'none';
  }
};

document.addEventListener('DOMContentLoaded', async () => {
  const token = localStorage.getItem('token');
  const isGuest = !token;

  // DOM References
  const ticketListScroll = document.getElementById('ticketListScroll');
  const ticketCountBadge = document.getElementById('ticketCountBadge');
  const ticketDetailEmpty = document.getElementById('ticketDetailEmpty');
  const ticketDetailContent = document.getElementById('ticketDetailContent');
  const supportSplit = document.getElementById('supportSplit');

  const viewTicketId = document.getElementById('viewTicketId');
  const viewRefNumber = document.getElementById('viewRefNumber');
  const viewTicketSubject = document.getElementById('viewTicketSubject');
  const viewTicketCategory = document.getElementById('viewTicketCategory');
  const viewTicketCreated = document.getElementById('viewTicketCreated');
  const viewTicketPriority = document.getElementById('viewTicketPriority');
  const viewTicketStatus = document.getElementById('viewTicketStatus');
  const btnCloseTicketBtn = document.getElementById('btnCloseTicketBtn');
  
  const ticketMessages = document.getElementById('ticketMessages');
  const ticketReplyArea = document.getElementById('ticketReplyArea');
  const replyText = document.getElementById('replyText');
  const replyBtn = document.getElementById('replyBtn');
  const replyFileChips = document.getElementById('replyFileChips');
  
  const csatRatingContainer = document.getElementById('csatRatingContainer');
  const reopenBanner = document.getElementById('reopenBanner');
  const resolvedNotice = document.getElementById('resolvedNotice');
  const formErrorAlert = document.getElementById('formErrorAlert');

  let activeTicketId = null;
  let currentStatusFilter = 'all';
  let currentSort = 'recently_updated';
  let currentSearch = '';
  let currentPage = 1;
  let totalPages = 1;
  let allTickets = [];

  let modalSelectedFiles = [];
  let replySelectedFiles = [];
  let selectedCsatStars = 5;

  // ── Modal Handlers ──
  const btnOpen = document.getElementById('btnOpenCreateTicketModal');
  const btnClose = document.getElementById('btnCloseModal');
  const btnCancel = document.getElementById('btnCancelModal');
  const modal = document.getElementById('newTicketModal');

  if (btnOpen) btnOpen.addEventListener('click', window.openSupportModal);
  if (btnClose) btnClose.addEventListener('click', window.closeSupportModal);
  if (btnCancel) btnCancel.addEventListener('click', window.closeSupportModal);
  if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) window.closeSupportModal(); });

  // ── Modal Attachment Chips Handler ──
  window.handleModalFileDrop = function(e) {
    e.preventDefault();
    const dropzone = document.getElementById('fileDropzone');
    if (dropzone) dropzone.style.background = 'rgba(124,58,237,0.03)';
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addModalFiles(Array.from(e.dataTransfer.files));
    }
  };

  window.handleModalFileSelect = function(input) {
    if (input.files && input.files.length > 0) {
      addModalFiles(Array.from(input.files));
    }
  };

  function addModalFiles(files) {
    files.forEach(f => {
      if (f.size > 10 * 1024 * 1024) {
        showToast(`File "${f.name}" exceeds 10MB limit.`, 'warning');
        return;
      }
      if (!modalSelectedFiles.some(existing => existing.name === f.name && existing.size === f.size)) {
        modalSelectedFiles.push(f);
      }
    });
    renderModalFileChips();
  }

  function renderModalFileChips() {
    const container = document.getElementById('modalFileChips');
    if (!container) return;
    container.innerHTML = '';
    modalSelectedFiles.forEach((file, idx) => {
      const chip = document.createElement('div');
      chip.className = 'file-chip';
      chip.innerHTML = `
        <span>📄</span>
        <span>${escapeHtml(file.name)}</span>
        <span style="opacity:0.6; font-size:0.75rem;">(${(file.size / (1024*1024)).toFixed(2)} MB)</span>
        <button type="button" class="file-chip-remove" onclick="window.removeModalFile(${idx})">✕</button>
      `;
      container.appendChild(chip);
    });
  }

  window.removeModalFile = function(idx) {
    modalSelectedFiles.splice(idx, 1);
    renderModalFileChips();
  };

  // ── Reply Attachments Handler ──
  window.handleReplyFileSelect = function(input) {
    if (input.files && input.files.length > 0) {
      Array.from(input.files).forEach(f => {
        if (f.size > 10 * 1024 * 1024) {
          showToast(`File "${f.name}" exceeds 10MB limit.`, 'warning');
          return;
        }
        if (!replySelectedFiles.some(e => e.name === f.name && e.size === f.size)) {
          replySelectedFiles.push(f);
        }
      });
      renderReplyFileChips();
    }
  };

  function renderReplyFileChips() {
    if (!replyFileChips) return;
    replyFileChips.innerHTML = '';
    replySelectedFiles.forEach((file, idx) => {
      const chip = document.createElement('div');
      chip.className = 'file-chip';
      chip.innerHTML = `
        <span>📄</span>
        <span>${escapeHtml(file.name)}</span>
        <button type="button" class="file-chip-remove" onclick="window.removeReplyFile(${idx})">✕</button>
      `;
      replyFileChips.appendChild(chip);
    });
  }

  window.removeReplyFile = function(idx) {
    replySelectedFiles.splice(idx, 1);
    renderReplyFileChips();
  };

  // ── CSAT Star Handler ──
  window.setCsatRating = function(rating) {
    selectedCsatStars = rating;
    document.querySelectorAll('.csat-star').forEach((star, idx) => {
      if (idx < rating) {
        star.textContent = '★';
        star.style.color = '#f59e0b';
      } else {
        star.textContent = '☆';
        star.style.color = 'var(--text-muted)';
      }
    });
  };

  window.submitCsatRating = async function() {
    if (!activeTicketId) return;
    const feedback = document.getElementById('csatFeedbackInput') ? document.getElementById('csatFeedbackInput').value.trim() : '';
    try {
      await api(`/api/user/tickets/${activeTicketId}/rate`, {
        method: 'POST',
        body: JSON.stringify({ rating: selectedCsatStars, feedback })
      });
      showToast('Thank you for your rating! ⭐', 'success');
      if (csatRatingContainer) csatRatingContainer.style.display = 'none';
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // ── Load User Tickets ──
  async function loadTickets() {
    if (isGuest) {
      if (ticketListScroll) {
        ticketListScroll.innerHTML = `
          <div class="empty-state">
            <span class="icon">🔒</span>
            <p style="font-weight:600; color:var(--text-primary);">Guest Mode Active</p>
            <p style="font-size:0.8rem;">Log in to track status and reply to support agents.</p>
            <a href="/login.html" class="btn-send" style="display:inline-block; text-decoration:none; margin-top:6px; padding:6px 16px; font-size:0.82rem;">🔐 Log In</a>
          </div>
        `;
      }
      return;
    }

    if (ticketListScroll) {
      ticketListScroll.innerHTML = `<div class="empty-state"><span class="icon">⏳</span><p>Loading tickets...</p></div>`;
    }

    try {
      const query = new URLSearchParams({
        status: currentStatusFilter,
        sort: currentSort,
        page: currentPage,
        limit: 30
      });
      if (currentSearch) query.append('search', currentSearch);

      const res = await api(`/api/user/tickets?${query.toString()}`);
      allTickets = res.tickets || [];
      totalPages = res.totalPages || 1;

      // Update Filter counts if returned
      updateFilterCounters();

      renderTicketsList();
    } catch (err) {
      if (ticketListScroll) {
        ticketListScroll.innerHTML = `<div class="empty-state"><span class="icon">⚠️</span><p>${escapeHtml(err.message)}</p></div>`;
      }
      showToast('Failed to load tickets: ' + err.message, 'error');
    }
  }

  function updateFilterCounters() {
    const counts = { all: allTickets.length, open: 0, investigating: 0, waiting_on_user: 0, resolved: 0 };
    allTickets.forEach(t => {
      const st = t.ticket_status || 'open';
      if (counts[st] !== undefined) counts[st]++;
    });
    const setCnt = (id, c) => { const el = document.getElementById(id); if (el) el.textContent = `(${c})`; };
    setCnt('cntAll', counts.all);
    setCnt('cntOpen', counts.open);
    setCnt('cntInv', counts.investigating);
    setCnt('cntWait', counts.waiting_on_user);
    setCnt('cntRes', counts.resolved);
  }

  function renderTicketsList() {
    if (!ticketListScroll) return;

    if (ticketCountBadge) {
      ticketCountBadge.textContent = `${allTickets.length} ticket${allTickets.length !== 1 ? 's' : ''}`;
    }

    if (allTickets.length === 0) {
      ticketListScroll.innerHTML = `
        <div class="empty-state">
          <span class="icon">📭</span>
          <p>No tickets found.</p>
          <button class="action-btn-sm" onclick="window.openSupportModal()" style="margin-top:6px;">➕ Submit Ticket</button>
        </div>
      `;
      return;
    }

    ticketListScroll.innerHTML = '';
    allTickets.forEach(t => {
      const card = document.createElement('div');
      card.className = `ticket-card ${activeTicketId === t.id ? 'active' : ''}`;
      card.dataset.id = t.id;

      const dateStr = t.last_activity_at || t.created_at
        ? new Date(t.last_activity_at || t.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : '';
      const titleDisplay = t.subject || t.reason || 'Support Request';
      const statusClass = `badge-${t.ticket_status || 'open'}`;
      const priorityClass = `badge-priority-${t.priority || 'medium'}`;
      const hasUnread = t.user_unread_count > 0;

      card.innerHTML = `
        <div class="ticket-card-header">
          <span class="ticket-card-id">${escapeHtml(t.ticket_id || ('TKT-' + t.id))}</span>
          ${hasUnread ? '<span class="ticket-card-unread-dot" title="Unread updates"></span>' : ''}
        </div>
        <div class="ticket-card-title">${escapeHtml(titleDisplay)}</div>
        <div class="ticket-card-preview">${escapeHtml(t.latest_message_preview || t.report_description || '')}</div>
        <div class="ticket-card-footer">
          <span class="badge-status ${statusClass}">${(t.ticket_status || 'open').replace(/_/g, ' ')}</span>
          <span class="badge-status ${priorityClass}">${t.priority || 'medium'}</span>
          <span style="font-size:0.72rem; color:var(--text-muted); margin-left:auto;">${dateStr}</span>
        </div>
      `;

      card.addEventListener('click', () => {
        document.querySelectorAll('.ticket-card').forEach(el => el.classList.remove('active'));
        card.classList.add('active');
        // Clear unread dot immediately in UI
        const dot = card.querySelector('.ticket-card-unread-dot');
        if (dot) dot.remove();
        loadTicketDetail(t.id);
      });

      ticketListScroll.appendChild(card);
    });
  }

  // ── Load Ticket Detail Workspace ──
  async function loadTicketDetail(id) {
    activeTicketId = id;

    // Mobile layout toggle
    if (supportSplit) supportSplit.classList.add('show-detail');

    if (ticketDetailEmpty) ticketDetailEmpty.style.display = 'none';
    if (ticketDetailContent) ticketDetailContent.style.display = 'flex';

    if (ticketMessages) {
      ticketMessages.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-muted);">⏳ Loading conversation thread...</div>`;
    }

    try {
      const data = await api(`/api/user/tickets/${id}`);
      const ticket = data.ticket;
      const messages = data.messages || [];
      const attachments = data.attachments || [];

      if (viewTicketId) viewTicketId.textContent = ticket.ticket_id || `TKT-${ticket.id}`;
      if (viewRefNumber) {
        if (ticket.reference_number) {
          viewRefNumber.textContent = `Ref: ${ticket.reference_number}`;
          viewRefNumber.style.display = 'inline-block';
        } else {
          viewRefNumber.style.display = 'none';
        }
      }
      if (viewTicketSubject) viewTicketSubject.textContent = ticket.subject || ticket.reason || 'Support Request';
      if (viewTicketCategory) viewTicketCategory.textContent = ticket.category_name ? `📂 ${ticket.category_name}` : '📂 General Inquiry';
      if (viewTicketCreated) viewTicketCreated.textContent = ticket.created_at ? `Created: ${new Date(ticket.created_at).toLocaleString()}` : '';

      if (viewTicketPriority) {
        const p = ticket.priority || 'medium';
        viewTicketPriority.textContent = p.charAt(0).toUpperCase() + p.slice(1);
        viewTicketPriority.className = `badge-status badge-priority-${p}`;
      }

      if (viewTicketStatus) {
        const s = ticket.ticket_status || 'open';
        viewTicketStatus.textContent = s.replace(/_/g, ' ');
        viewTicketStatus.className = `badge-status badge-${s}`;
      }

      const isResolvedOrClosed = ticket.ticket_status === 'resolved' || ticket.ticket_status === 'closed';
      if (btnCloseTicketBtn) {
        btnCloseTicketBtn.style.display = !isResolvedOrClosed ? 'inline-block' : 'none';
      }

      // Render Messages Thread
      renderThreadMessages(messages, attachments, ticket);

      // Handle Resolution / Reopen Banner
      if (isResolvedOrClosed) {
        if (ticketReplyArea) ticketReplyArea.style.display = 'none';
        if (ticket.can_reopen) {
          if (reopenBanner) reopenBanner.style.display = 'flex';
          if (resolvedNotice) resolvedNotice.style.display = 'none';
        } else {
          if (reopenBanner) reopenBanner.style.display = 'none';
          if (resolvedNotice) resolvedNotice.style.display = 'block';
        }

        if (csatRatingContainer) {
          if (ticket.csat_rating) {
            csatRatingContainer.style.display = 'none';
          } else {
            csatRatingContainer.style.display = 'block';
            window.setCsatRating(5);
          }
        }
      } else {
        if (ticketReplyArea) ticketReplyArea.style.display = 'block';
        if (reopenBanner) reopenBanner.style.display = 'none';
        if (resolvedNotice) resolvedNotice.style.display = 'none';
        if (csatRatingContainer) csatRatingContainer.style.display = 'none';
      }

    } catch (err) {
      if (ticketMessages) {
        ticketMessages.innerHTML = `<div style="text-align:center; padding:20px; color:#f87171;">⚠️ ${escapeHtml(err.message)}</div>`;
      }
      showToast('Failed to load ticket: ' + err.message, 'error');
    }
  }

  function renderThreadMessages(messages, attachments, ticket) {
    if (!ticketMessages) return;
    ticketMessages.innerHTML = '';

    const allMsgs = [...messages];

    // Fallback initial description bubble if thread is empty
    if (allMsgs.length === 0 && ticket.report_description) {
      allMsgs.push({
        sender_role: 'user',
        message_body: ticket.report_description,
        created_at: ticket.created_at
      });
    }

    allMsgs.forEach((msg, index) => {
      const isAdmin = msg.sender_role === 'admin' || msg.sender_role === 'system';
      const msgCard = document.createElement('div');
      msgCard.className = `msg-card ${isAdmin ? 'from-admin' : 'from-user'}`;

      const avatarInitials = isAdmin ? '🛡️' : '👤';
      const senderTitle = isAdmin ? 'Support Team' : 'You';
      const roleTag = isAdmin ? '<span class="msg-role-badge">Support Agent</span>' : '';

      // Match attachments for this message or initial ticket attachments
      const msgAttachments = attachments.filter(a => a.message_id === msg.id || (index === 0 && !a.message_id));
      let attHtml = '';
      if (msgAttachments.length > 0) {
        attHtml = `
          <div class="msg-attachments">
            ${msgAttachments.map(a => `
              <a href="${a.download_url}" target="_blank" class="attachment-chip" download="${escapeHtml(a.file_name)}">
                📎 ${escapeHtml(a.file_name)} <span style="opacity:0.7; font-size:0.72rem;">(${(a.file_size / (1024*1024)).toFixed(2)} MB)</span>
              </a>
            `).join('')}
          </div>
        `;
      }

      msgCard.innerHTML = `
        <div class="msg-avatar">${avatarInitials}</div>
        <div class="msg-content">
          <div class="msg-header">
            <div style="display:flex; align-items:center; gap:6px;">
              <span class="msg-sender-name">${senderTitle}</span>
              ${roleTag}
            </div>
            <span class="msg-time">${msg.created_at ? new Date(msg.created_at).toLocaleString() : ''}</span>
          </div>
          <div class="msg-text">${escapeHtml(msg.message_body)}</div>
          ${attHtml}
        </div>
      `;

      ticketMessages.appendChild(msgCard);
    });

    ticketMessages.scrollTop = ticketMessages.scrollHeight;
  }

  // ── Mobile Back Button ──
  window.backToTicketList = function() {
    if (supportSplit) supportSplit.classList.remove('show-detail');
  };

  // ── Close Ticket ──
  window.closeActiveTicket = async function() {
    if (!activeTicketId) return;
    if (!confirm('Are you sure you want to mark this ticket as resolved and closed?')) return;
    try {
      await api(`/api/user/tickets/${activeTicketId}/close`, { method: 'POST' });
      showToast('✅ Ticket closed.', 'success');
      await loadTickets();
      await loadTicketDetail(activeTicketId);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // ── Reopen Ticket ──
  window.reopenActiveTicket = async function() {
    if (!activeTicketId) return;
    try {
      await api(`/api/user/tickets/${activeTicketId}/reopen`, { method: 'POST' });
      showToast('✅ Ticket reopened!', 'success');
      await loadTickets();
      await loadTicketDetail(activeTicketId);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // ── Submit New Ticket Form ──
  const createTicketForm = document.getElementById('createTicketForm');
  if (createTicketForm) {
    createTicketForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (formErrorAlert) formErrorAlert.style.display = 'none';

      const subject = document.getElementById('ticketSubjectInput').value.trim();
      const category_id = document.getElementById('ticketCategorySelect').value;
      const priority = document.getElementById('ticketPrioritySelect').value;
      const reference_number = document.getElementById('ticketReferenceInput') ? document.getElementById('ticketReferenceInput').value.trim() : '';
      const details = document.getElementById('ticketDetailsInput').value.trim();

      if (!subject || subject.length < 3) {
        showFormError('Please enter a valid Subject (min 3 characters).');
        return;
      }
      if (!category_id) {
        showFormError('Please select a Category.');
        return;
      }
      if (!details || details.length < 10) {
        showFormError('Please provide a Detailed Description (min 10 characters).');
        return;
      }

      const submitBtn = document.getElementById('btnSubmitNewTicket');
      submitBtn.disabled = true;
      submitBtn.textContent = '⏳ Submitting...';

      try {
        const formData = new FormData();
        formData.append('subject', subject);
        formData.append('category_id', category_id);
        formData.append('priority', priority);
        formData.append('details', details);
        if (reference_number) formData.append('reference_number', reference_number);

        modalSelectedFiles.forEach(file => {
          formData.append('file', file);
        });

        const res = await api('/api/user/tickets', {
          method: 'POST',
          body: formData
        });

        showToast(`✅ Ticket Created! ID: ${res.ticket_id || 'TKT-' + res.id}`, 'success');
        createTicketForm.reset();
        modalSelectedFiles = [];
        renderModalFileChips();
        window.closeSupportModal();

        await loadTickets();
        if (res.id) {
          setTimeout(() => {
            const card = document.querySelector(`.ticket-card[data-id="${res.id}"]`);
            if (card) card.click();
          }, 250);
        }
      } catch (err) {
        showFormError('Failed to create ticket: ' + err.message);
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = '🚀 Submit Ticket';
      }
    });
  }

  function showFormError(msg) {
    if (formErrorAlert) {
      formErrorAlert.textContent = msg;
      formErrorAlert.style.display = 'block';
    } else {
      showToast(msg, 'warning');
    }
  }

  // ── Reply Handler with Optimistic UI & Retry ──
  if (replyBtn) {
    const doReply = async () => {
      if (!activeTicketId) return;
      const body = replyText.value.trim();
      if (!body && replySelectedFiles.length === 0) {
        return showToast('Please enter a reply message.', 'warning');
      }

      replyBtn.disabled = true;
      replyBtn.textContent = '⏳ Sending...';

      // Optimistic message card insertion
      const optMsgId = `opt_${Date.now()}`;
      const optCard = document.createElement('div');
      optCard.className = 'msg-card from-user';
      optCard.id = optMsgId;
      optCard.innerHTML = `
        <div class="msg-avatar">👤</div>
        <div class="msg-content" style="opacity:0.7;">
          <div class="msg-header">
            <span class="msg-sender-name">You</span>
            <span class="msg-time">Sending...</span>
          </div>
          <div class="msg-text">${escapeHtml(body)}</div>
        </div>
      `;
      if (ticketMessages) {
        ticketMessages.appendChild(optCard);
        ticketMessages.scrollTop = ticketMessages.scrollHeight;
      }

      try {
        const formData = new FormData();
        formData.append('message_body', body);
        replySelectedFiles.forEach(f => formData.append('file', f));

        await api(`/api/user/tickets/${activeTicketId}/messages`, {
          method: 'POST',
          body: formData
        });

        replyText.value = '';
        replySelectedFiles = [];
        renderReplyFileChips();

        showToast('✅ Reply sent!', 'success');
        await loadTicketDetail(activeTicketId);
        await loadTickets();
      } catch (err) {
        const optEl = document.getElementById(optMsgId);
        if (optEl) optEl.remove();
        showToast('Failed to send reply: ' + err.message, 'error');
      } finally {
        replyBtn.disabled = false;
        replyBtn.textContent = '📤 Send Reply';
      }
    };

    replyBtn.addEventListener('click', doReply);

    if (replyText) {
      replyText.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'Enter') {
          e.preventDefault();
          doReply();
        }
      });
    }
  }

  // ── Filters & Search Controls ──
  document.querySelectorAll('.chip[data-user-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.chip[data-user-filter]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentStatusFilter = btn.dataset.userFilter;
      currentPage = 1;
      loadTickets();
    });
  });

  const searchInput = document.getElementById('userTicketSearch');
  if (searchInput) {
    let timer;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        currentSearch = e.target.value.trim();
        currentPage = 1;
        loadTickets();
      }, 300);
    });
  }

  const sortSelect = document.getElementById('ticketSortSelect');
  if (sortSelect) {
    sortSelect.addEventListener('change', (e) => {
      currentSort = e.target.value;
      currentPage = 1;
      loadTickets();
    });
  }

  // Initial Load
  await loadTickets();
});
