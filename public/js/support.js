document.addEventListener('DOMContentLoaded', async () => {
  // ── Auth Guard ──
  const token = localStorage.getItem('token');
  if (!token) {
    window.location.href = '/login.html';
    return;
  }

  // ── DOM References ──
  const ticketListScroll = document.getElementById('ticketListScroll');
  const ticketCountBadge = document.getElementById('ticketCountBadge');
  const ticketDetailEmpty = document.getElementById('ticketDetailEmpty');
  const ticketDetailContent = document.getElementById('ticketDetailContent');
  
  const viewTicketId = document.getElementById('viewTicketId');
  const viewTicketSubject = document.getElementById('viewTicketSubject');
  const viewTicketCategory = document.getElementById('viewTicketCategory');
  const viewTicketPriority = document.getElementById('viewTicketPriority');
  const viewTicketStatus = document.getElementById('viewTicketStatus');
  const ticketMessages = document.getElementById('ticketMessages');
  const ticketReplyArea = document.getElementById('ticketReplyArea');
  const resolvedNotice = document.getElementById('resolvedNotice');
  const reopenBanner = document.getElementById('reopenBanner');
  const reopenTicketBtn = document.getElementById('reopenTicketBtn');
  const replyText = document.getElementById('replyText');
  const replyBtn = document.getElementById('replyBtn');

  let activeTicketId = null;
  let currentUserFilter = 'all';
  let formConfig = { categories: [], subcategories: [], customFields: [], slaRules: [] };

  // ── Modal Logic ──
  const modal = document.getElementById('newTicketModal');
  const btnOpen = document.getElementById('btnOpenCreateTicketModal');
  const btnClose = document.getElementById('btnCloseModal');
  const btnCancel = document.getElementById('btnCancelModal');

  function openModal() { modal.classList.add('open'); }
  function closeModal() { modal.classList.remove('open'); }

  if (btnOpen) btnOpen.addEventListener('click', openModal);
  if (btnClose) btnClose.addEventListener('click', closeModal);
  if (btnCancel) btnCancel.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  // File input label update
  const fileInput = document.getElementById('ticketFileInput');
  const fileNameSpan = document.getElementById('selectedFileName');
  if (fileInput) {
    fileInput.addEventListener('change', () => {
      fileNameSpan.textContent = fileInput.files[0] ? `📎 ${fileInput.files[0].name}` : '';
    });
  }

  // ── Load Ticket Form Config ──
  async function loadTicketFormConfig() {
    try {
      const config = await api('/api/user/ticket-form-config');
      formConfig = config;
      const catSelect = document.getElementById('ticketCategorySelect');
      if (catSelect) {
        if (config.categories && config.categories.length > 0) {
          catSelect.innerHTML = '<option value="">— Select Category —</option>';
          config.categories.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = c.name;
            catSelect.appendChild(opt);
          });
        } else {
          // Fallback hardcoded categories if DB seeding hasn't run yet
          catSelect.innerHTML = `
            <option value="">— Select Category —</option>
            <option value="1">📖 Story & Content Moderation</option>
            <option value="2">📚 Book Library & Reader Mode</option>
            <option value="3">👤 Account & Access</option>
            <option value="4">💳 Billing & Subscriptions</option>
            <option value="5">🛠️ Platform & Technical Bugs</option>
            <option value="6">💡 Feature Requests & Author Tools</option>
          `;
        }
      }
    } catch (e) {
      console.error('Error loading ticket form config:', e);
    }
  }

  // ── Category Change → Dynamic Subcategories & Custom Fields ──
  const categorySelect = document.getElementById('ticketCategorySelect');
  if (categorySelect) {
    categorySelect.addEventListener('change', (e) => {
      const catId = parseInt(e.target.value);
      const subSelect = document.getElementById('ticketSubcategorySelect');
      const customContainer = document.getElementById('dynamicCustomFieldsContainer');

      if (!catId) {
        subSelect.innerHTML = '<option value="">Select Category First</option>';
        customContainer.innerHTML = '';
        return;
      }

      // Populate subcategories
      const subs = (formConfig.subcategories || []).filter(s => s.category_id === catId);
      if (subs.length > 0) {
        subSelect.innerHTML = '<option value="">— Select Sub-Category —</option>';
        subs.forEach(s => {
          const opt = document.createElement('option');
          opt.value = s.id;
          opt.textContent = s.name;
          subSelect.appendChild(opt);
        });
      } else {
        // Fallback subcategories
        const fallbackSubs = {
          1: ['Copyright / DMCA Takedown', 'Plagiarism Report', 'Story Spam / Inappropriate Content', 'Comment Harassment'],
          2: ['EPUB/PDF Not Loading', 'Corrupted File Download', 'Book Upload Failed', 'Reader Mode Bug'],
          3: ['Forgot Password / Reset', 'Account Suspended Appeal', 'Profile Not Updating', 'Login Issues'],
          4: ['Payment Failed', 'Refund Request', 'Subscription Not Activating', 'Invoice / Receipt Request'],
          5: ['App Crash / 500 Error', 'Slow Performance', 'UI Layout Bug', 'Mobile Device Issue'],
          6: ['New Feature Idea', 'Author Dashboard Request', 'Analytics Request', 'API Access Request'],
        };
        const options = fallbackSubs[catId] || [];
        subSelect.innerHTML = '<option value="">— Select Sub-Category —</option>';
        options.forEach((name, i) => {
          const opt = document.createElement('option');
          opt.value = `${catId}${i + 1}`;
          opt.textContent = name;
          subSelect.appendChild(opt);
        });
      }

      // Render dynamic custom fields
      if (catId === 1) {
        customContainer.innerHTML = `
          <label class="form-label">Infringing Story Title / URL</label>
          <input type="text" class="form-input-field" id="customStoryUrl" placeholder="e.g. Midnight Chapter 4 or story URL">
        `;
      } else if (catId === 2) {
        customContainer.innerHTML = `
          <label class="form-label">Book Title / Format</label>
          <input type="text" class="form-input-field" id="customBookTitle" placeholder="e.g. Dark Waters (.epub)">
        `;
      } else if (catId === 4) {
        customContainer.innerHTML = `
          <label class="form-label">Transaction / Order ID</label>
          <input type="text" class="form-input-field" id="customOrderId" placeholder="e.g. INV-99428">
        `;
      } else if (catId === 5) {
        customContainer.innerHTML = `
          <label class="form-label">Operating System / Device</label>
          <input type="text" class="form-input-field" id="customDevice" placeholder="e.g. Windows 11 / Chrome v120">
        `;
      } else {
        customContainer.innerHTML = '';
      }
    });
  }

  // ── Load Tickets List ──
  async function loadTickets() {
    ticketListScroll.innerHTML = `<div class="empty-tickets"><span class="empty-icon">⏳</span><p>Loading tickets...</p></div>`;

    try {
      const url = currentUserFilter !== 'all'
        ? `/api/user/tickets?status=${currentUserFilter}`
        : '/api/user/tickets';
      const tickets = await api(url);

      if (ticketCountBadge) {
        ticketCountBadge.textContent = `${tickets.length} ticket${tickets.length !== 1 ? 's' : ''}`;
      }

      if (!tickets || tickets.length === 0) {
        ticketListScroll.innerHTML = `
          <div class="empty-tickets">
            <span class="empty-icon">📭</span>
            <p>No tickets found for this filter.</p>
            <p style="font-size:0.78rem; opacity:0.6;">Submit a support ticket to get started!</p>
          </div>
        `;
        return;
      }

      ticketListScroll.innerHTML = '';
      tickets.forEach(ticket => {
        const card = document.createElement('div');
        card.className = 'ticket-card';
        card.dataset.id = ticket.id;

        const dateStr = ticket.created_at
          ? new Date(ticket.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          : '';
        const titleDisplay = ticket.subject || ticket.reason || 'Support Request';
        const statusClass = `badge-${ticket.ticket_status || 'open'}`;
        const priorityClass = `badge-priority-${ticket.priority || 'medium'}`;

        card.innerHTML = `
          <div class="ticket-card-id">${escapeHtml(ticket.ticket_id || ('TKT-' + ticket.id))}</div>
          <div class="ticket-card-title">${escapeHtml(titleDisplay)}</div>
          <div class="ticket-card-meta">
            <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
              <span class="badge-status ${statusClass}">${(ticket.ticket_status || 'open').replace(/_/g, ' ')}</span>
              <span class="badge-status ${priorityClass}">${ticket.priority || 'medium'}</span>
            </div>
          </div>
          <div class="ticket-card-meta" style="margin-top:6px;">
            <span class="ticket-card-cat">${escapeHtml(ticket.category_name || 'General')}</span>
            <span class="ticket-card-date">${dateStr}</span>
          </div>
        `;

        card.addEventListener('click', () => {
          document.querySelectorAll('.ticket-card').forEach(el => el.classList.remove('active'));
          card.classList.add('active');
          loadTicketDetail(ticket.id);
        });

        ticketListScroll.appendChild(card);
      });
    } catch (err) {
      ticketListScroll.innerHTML = `<div class="empty-tickets"><span class="empty-icon">⚠️</span><p>${escapeHtml(err.message)}</p></div>`;
      showToast('Failed to load tickets: ' + err.message, 'error');
    }
  }

  // ── Load Ticket Detail ──
  async function loadTicketDetail(id) {
    activeTicketId = id;

    // Show content, hide empty
    if (ticketDetailEmpty) ticketDetailEmpty.style.display = 'none';
    if (ticketDetailContent) {
      ticketDetailContent.style.display = 'flex';
      ticketDetailContent.style.flexDirection = 'column';
      ticketDetailContent.style.height = '100%';
    }
    ticketMessages.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-muted);">⏳ Loading messages...</div>`;

    try {
      const data = await api(`/api/tickets/${id}/messages`);
      const ticket = data.ticket;
      const messages = data.messages || [];

      // Populate header
      if (viewTicketId) viewTicketId.textContent = ticket.ticket_id || `TKT-${ticket.id}`;
      if (viewTicketSubject) viewTicketSubject.textContent = ticket.subject || ticket.reason || 'Support Request';
      if (viewTicketCategory) viewTicketCategory.textContent = ticket.category_name ? `📂 ${ticket.category_name}` : '📂 General Inquiry';

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

      // Render messages
      ticketMessages.innerHTML = '';
      const allMsgs = [...messages];

      // If no messages, show the initial ticket description as user message
      if (allMsgs.length === 0 && ticket.report_description) {
        const initBubble = document.createElement('div');
        initBubble.className = 'msg-bubble from-user';
        initBubble.innerHTML = `
          <div class="msg-sender user-sender">👤 You (Initial Report)</div>
          <div class="msg-body-text">${escapeHtml(ticket.report_description)}</div>
          <div class="msg-time">${ticket.created_at ? new Date(ticket.created_at).toLocaleString() : ''}</div>
        `;
        ticketMessages.appendChild(initBubble);
      } else {
        allMsgs.forEach(msg => {
          const isAdmin = msg.sender_role === 'admin' || msg.sender_role === 'system';
          const bubble = document.createElement('div');
          bubble.className = `msg-bubble ${isAdmin ? 'from-admin' : 'from-user'}`;

          if (isAdmin) {
            bubble.innerHTML = `
              <div class="msg-sender admin-sender">
                <span style="background:linear-gradient(135deg,#7c3aed,#6366f1); color:#fff; padding:2px 8px; border-radius:10px; font-size:0.7rem;">🛡️ Midnight Support Team</span>
              </div>
              <div class="msg-body-text">${escapeHtml(msg.message_body)}</div>
              <div class="msg-time">${msg.created_at ? new Date(msg.created_at).toLocaleString() : ''}</div>
            `;
          } else {
            bubble.innerHTML = `
              <div class="msg-sender user-sender">👤 You</div>
              <div class="msg-body-text">${escapeHtml(msg.message_body)}</div>
              <div class="msg-time">${msg.created_at ? new Date(msg.created_at).toLocaleString() : ''}</div>
            `;
          }
          ticketMessages.appendChild(bubble);
        });
      }

      if (ticketMessages.children.length === 0) {
        ticketMessages.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-muted);">No messages yet. The support team will respond soon.</div>`;
      }

      ticketMessages.scrollTop = ticketMessages.scrollHeight;

      // Handle UI state
      const isResolved = ticket.ticket_status === 'resolved' || ticket.ticket_status === 'closed';
      if (isResolved) {
        if (ticketReplyArea) ticketReplyArea.style.display = 'none';
        if (ticket.can_reopen) {
          if (reopenBanner) reopenBanner.style.display = 'flex';
          if (resolvedNotice) resolvedNotice.style.display = 'none';
        } else {
          if (reopenBanner) reopenBanner.style.display = 'none';
          if (resolvedNotice) resolvedNotice.style.display = 'block';
        }
      } else {
        if (ticketReplyArea) ticketReplyArea.style.display = 'block';
        if (reopenBanner) reopenBanner.style.display = 'none';
        if (resolvedNotice) resolvedNotice.style.display = 'none';
      }

    } catch (err) {
      ticketMessages.innerHTML = `<div style="text-align:center; padding:20px; color:#f87171;">⚠️ ${escapeHtml(err.message)}</div>`;
      showToast('Failed to load ticket: ' + err.message, 'error');
    }
  }

  // ── Create Ticket Submit ──
  const createTicketForm = document.getElementById('createTicketForm');
  if (createTicketForm) {
    createTicketForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const subject = document.getElementById('ticketSubjectInput').value.trim();
      const category_id = document.getElementById('ticketCategorySelect').value;
      const subcategory_id = document.getElementById('ticketSubcategorySelect').value;
      const priority = document.getElementById('ticketPrioritySelect').value;
      const details = document.getElementById('ticketDetailsInput').value.trim();

      if (!subject || !details) {
        return showToast('Please enter both a Subject and Detailed Description.', 'warning');
      }
      if (!category_id) {
        return showToast('Please select a Category.', 'warning');
      }

      const customFields = {};
      const storyUrl = document.getElementById('customStoryUrl');
      if (storyUrl && storyUrl.value.trim()) customFields.story_url = storyUrl.value.trim();
      const bookTitle = document.getElementById('customBookTitle');
      if (bookTitle && bookTitle.value.trim()) customFields.book_title = bookTitle.value.trim();
      const orderId = document.getElementById('customOrderId');
      if (orderId && orderId.value.trim()) customFields.order_id = orderId.value.trim();
      const device = document.getElementById('customDevice');
      if (device && device.value.trim()) customFields.device = device.value.trim();

      const submitBtn = document.getElementById('btnSubmitNewTicket');
      submitBtn.disabled = true;
      submitBtn.textContent = '⏳ Submitting...';

      try {
        const formData = new FormData();
        formData.append('subject', subject);
        formData.append('category_id', category_id);
        formData.append('subcategory_id', subcategory_id || '');
        formData.append('priority', priority);
        formData.append('details', details);
        formData.append('custom_fields_json', JSON.stringify(customFields));

        const fi = document.getElementById('ticketFileInput');
        if (fi && fi.files.length > 0) {
          const file = fi.files[0];
          if (file.size > 10 * 1024 * 1024) {
            submitBtn.disabled = false;
            submitBtn.textContent = '🚀 Create Ticket';
            return showToast('Attachment exceeds 10MB limit.', 'warning');
          }
          formData.append('file', file);
        }

        const res = await api('/api/user/tickets/create', {
          method: 'POST',
          body: formData
        });

        showToast(`✅ Ticket created! Reference: ${res.ticket_id}`, 'success');
        createTicketForm.reset();
        document.getElementById('dynamicCustomFieldsContainer').innerHTML = '';
        document.getElementById('selectedFileName').textContent = '';
        closeModal();
        await loadTickets();
        if (res.id) {
          setTimeout(() => {
            const card = document.querySelector(`.ticket-card[data-id="${res.id}"]`);
            if (card) card.click();
          }, 300);
        }
      } catch (err) {
        showToast('Failed to create ticket: ' + err.message, 'error');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = '🚀 Create Ticket';
      }
    });
  }

  // ── Reply Button ──
  if (replyBtn) {
    replyBtn.addEventListener('click', async () => {
      if (!activeTicketId) return;
      const body = replyText.value.trim();
      if (!body) return showToast('Please enter a message.', 'warning');

      replyBtn.textContent = '⏳ Sending...';
      replyBtn.disabled = true;

      try {
        await api(`/api/tickets/${activeTicketId}/reply`, {
          method: 'POST',
          body: JSON.stringify({ message_body: body })
        });
        replyText.value = '';
        showToast('✅ Message sent!', 'success');
        await loadTicketDetail(activeTicketId);
      } catch (err) {
        showToast('Failed to send: ' + err.message, 'error');
      } finally {
        replyBtn.textContent = '📤 Send Update';
        replyBtn.disabled = false;
      }
    });
  }

  // ── Reopen Ticket ──
  if (reopenTicketBtn) {
    reopenTicketBtn.addEventListener('click', async () => {
      if (!activeTicketId) return;
      if (!confirm('Reopen this ticket for additional support?')) return;

      reopenTicketBtn.disabled = true;
      reopenTicketBtn.textContent = '⏳ Reopening...';

      try {
        await api(`/api/user/tickets/${activeTicketId}/reopen`, { method: 'POST' });
        showToast('✅ Ticket reopened!', 'success');
        await loadTickets();
        await loadTicketDetail(activeTicketId);
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        reopenTicketBtn.disabled = false;
        reopenTicketBtn.textContent = '🔄 Reopen Ticket';
      }
    });
  }

  // ── Filter Chips ──
  document.querySelectorAll('[data-user-filter]').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('[data-user-filter]').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentUserFilter = chip.dataset.userFilter;
      loadTickets();
    });
  });

  // ── Initialize ──
  loadTicketFormConfig();
  loadTickets();
});
