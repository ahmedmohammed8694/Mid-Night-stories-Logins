document.addEventListener('DOMContentLoaded', async () => {
  // ── Auth Check ──
  const token = localStorage.getItem('token');
  const isGuest = !token;

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
  const viewSlaTimer = document.getElementById('viewSlaTimer');
  const ticketMessages = document.getElementById('ticketMessages');
  const ticketReplyArea = document.getElementById('ticketReplyArea');
  const resolvedNotice = document.getElementById('resolvedNotice');
  const reopenBanner = document.getElementById('reopenBanner');
  const reopenTicketBtn = document.getElementById('reopenTicketBtn');
  const replyText = document.getElementById('replyText');
  const replyBtn = document.getElementById('replyBtn');
  const csatRatingContainer = document.getElementById('csatRatingContainer');

  let activeTicketId = null;
  let currentUserFilter = 'all';
  let allRawTickets = [];
  let formConfig = { categories: [], subcategories: [], customFields: [], slaRules: [] };
  let selectedCsatStars = 5;

  // ── Modal Logic ──
  const modal = document.getElementById('newTicketModal');
  const btnOpen = document.getElementById('btnOpenCreateTicketModal');
  const btnClose = document.getElementById('btnCloseModal');
  const btnCancel = document.getElementById('btnCancelModal');

  window.openSupportModal = function() { 
    if (modal) modal.classList.add('open'); 
    const guestBox = document.getElementById('guestEmailContainer');
    if (guestBox) guestBox.style.display = isGuest ? 'block' : 'none';
  };
  function closeModal() { if (modal) modal.classList.remove('open'); }

  if (btnOpen) btnOpen.addEventListener('click', window.openSupportModal);
  if (btnClose) btnClose.addEventListener('click', closeModal);
  if (btnCancel) btnCancel.addEventListener('click', closeModal);
  if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  // ── Category Card Selection ──
  window.selectCategoryCard = function(catId) {
    document.querySelectorAll('.cat-card').forEach(c => {
      c.style.background = 'rgba(255,255,255,0.03)';
      c.style.borderColor = 'rgba(255,255,255,0.08)';
      c.classList.remove('active');
    });
    const card = document.querySelector(`.cat-card[data-cat-id="${catId}"]`);
    if (card) {
      card.style.background = 'rgba(124,58,237,0.15)';
      card.style.borderColor = 'rgba(124,58,237,0.4)';
      card.classList.add('active');
    }
    const select = document.getElementById('ticketCategorySelect');
    if (select) {
      select.value = catId;
      select.dispatchEvent(new Event('change'));
    }
  };

  // ── SLA Preview Live Update ──
  window.updateSlaPreview = function(priority) {
    const titleEl = document.getElementById('slaPreviewTitle');
    const descEl = document.getElementById('slaPreviewDesc');
    const slaDetails = {
      urgent: { title: '🔴 Urgent Priority Guarantee (1h SLA)', desc: 'Guaranteed first agent response within 1 hour. Immediate escalation for system outages & DMCA notices.' },
      high: { title: '🟡 High Priority Guarantee (4h SLA)', desc: 'Guaranteed first agent response within 4 hours. Priority routing for billing & core features.' },
      medium: { title: '🔵 Medium Priority Guarantee (12h SLA)', desc: 'Guaranteed first agent response within 12 hours. Standard helpdesk SLA for inquiries & requests.' },
      low: { title: '🟢 Low Priority Guarantee (24h SLA)', desc: 'Guaranteed first agent response within 24 hours. Recommended for general feedback & feature ideas.' },
    };
    const info = slaDetails[priority] || slaDetails.medium;
    if (titleEl) titleEl.textContent = info.title;
    if (descEl) descEl.textContent = info.desc;
  };

  // ── File Drag and Drop & Upload Controls ──
  window.handleFileDrop = function(e) {
    e.preventDefault();
    const dropzone = document.getElementById('fileDropzone');
    if (dropzone) dropzone.style.background = 'rgba(124,58,237,0.03)';
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const fileInput = document.getElementById('ticketFileInput');
      if (fileInput) {
        fileInput.files = e.dataTransfer.files;
        window.handleFileSelect(fileInput);
      }
    }
  };

  window.handleFileSelect = function(input) {
    const preview = document.getElementById('filePreviewBadge');
    const nameEl = document.getElementById('filePreviewName');
    const sizeEl = document.getElementById('filePreviewSize');
    if (input.files && input.files[0]) {
      const f = input.files[0];
      if (nameEl) nameEl.textContent = f.name;
      if (sizeEl) sizeEl.textContent = `(${(f.size / (1024 * 1024)).toFixed(2)} MB)`;
      if (preview) preview.style.display = 'flex';
    } else {
      if (preview) preview.style.display = 'none';
    }
  };

  window.removeSelectedFile = function() {
    const input = document.getElementById('ticketFileInput');
    if (input) input.value = '';
    const preview = document.getElementById('filePreviewBadge');
    if (preview) preview.style.display = 'none';
  };

  // ── CSAT Rating Star Handlers ──
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
      showToast('Thank you for rating your support experience! ⭐', 'success');
      if (csatRatingContainer) csatRatingContainer.style.display = 'none';
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // ── Load Ticket Form Config ──
  async function loadTicketFormConfig() {
    try {
      const config = await api('/api/user/ticket-form-config');
      formConfig = config;
      // Default to category 1
      window.selectCategoryCard(1);
    } catch (e) {
      console.error('Error loading ticket form config:', e);
      window.selectCategoryCard(1);
    }
  }

  // ── Category Change Listener ──
  const categorySelect = document.getElementById('ticketCategorySelect');
  if (categorySelect) {
    categorySelect.addEventListener('change', (e) => {
      const catId = parseInt(e.target.value);
      const subSelect = document.getElementById('ticketSubcategorySelect');
      const customContainer = document.getElementById('dynamicCustomFieldsContainer');

      if (!catId) {
        if (subSelect) subSelect.innerHTML = '<option value="">Select Category First</option>';
        if (customContainer) customContainer.innerHTML = '';
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

      // Contextual Field Rendering
      if (!customContainer) return;
      if (catId === 1) {
        customContainer.innerHTML = `
          <label class="form-label">Infringing Story URL / Chapter *</label>
          <input type="text" class="form-input-field" id="customStoryUrl" placeholder="e.g. https://midnightstories.dpdns.org/story/dark-chapter">
        `;
      } else if (catId === 2) {
        customContainer.innerHTML = `
          <label class="form-label">Book Title / Format *</label>
          <input type="text" class="form-input-field" id="customBookTitle" placeholder="e.g. Midnight Tales Vol 1 (.epub)">
        `;
      } else if (catId === 4) {
        customContainer.innerHTML = `
          <label class="form-label">Transaction / Invoice ID *</label>
          <input type="text" class="form-input-field" id="customOrderId" placeholder="e.g. INV-2026-8842">
        `;
      } else if (catId === 5) {
        customContainer.innerHTML = `
          <label class="form-label">Device &amp; Operating System *</label>
          <input type="text" class="form-input-field" id="customDevice" placeholder="e.g. Windows 11 / Chrome v122 or iOS 17">
        `;
      } else {
        customContainer.innerHTML = '';
      }
    });
  }

  // ── Load Tickets List ──
  async function loadTickets() {
    if (isGuest) {
      if (ticketListScroll) {
        ticketListScroll.innerHTML = `
          <div class="empty-tickets" style="padding:24px 16px; text-align:center;">
            <span class="empty-icon">🔒</span>
            <p style="font-weight:600; font-size:0.9rem; color:var(--text-primary);">Guest Mode Active</p>
            <p style="font-size:0.78rem; color:var(--text-muted); margin-bottom:12px; line-height:1.4;">Log in or create an account to view ticket status history & track SLA updates.</p>
            <a href="/login.html" class="btn-send" style="display:inline-block; text-decoration:none; padding:8px 18px; font-size:0.82rem;">🔐 Log In / Register</a>
          </div>
        `;
      }
      return;
    }

    if (ticketListScroll) {
      ticketListScroll.innerHTML = `<div class="empty-tickets"><span class="empty-icon">⏳</span><p>Loading your tickets...</p></div>`;
    }

    try {
      const tickets = await api('/api/user/tickets');
      allRawTickets = tickets || [];

      // Update Filter Counter Badges
      const counts = { all: allRawTickets.length, open: 0, investigating: 0, waiting_on_user: 0, resolved: 0 };
      allRawTickets.forEach(t => {
        const st = t.ticket_status || 'open';
        if (counts[st] !== undefined) counts[st]++;
      });
      const updateCnt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = `(${val})`; };
      updateCnt('cntAll', counts.all);
      updateCnt('cntOpen', counts.open);
      updateCnt('cntInv', counts.investigating);
      updateCnt('cntWait', counts.waiting_on_user);
      updateCnt('cntRes', counts.resolved);

      renderTicketsList();
    } catch (err) {
      if (ticketListScroll) {
        ticketListScroll.innerHTML = `<div class="empty-tickets"><span class="empty-icon">⚠️</span><p>${escapeHtml(err.message)}</p></div>`;
      }
      showToast('Failed to load tickets: ' + err.message, 'error');
    }
  }

  function renderTicketsList() {
    if (!ticketListScroll) return;

    const searchTerm = (document.getElementById('userTicketSearch') ? document.getElementById('userTicketSearch').value : '').toLowerCase().trim();

    let filtered = allRawTickets.filter(t => {
      const matchFilter = currentUserFilter === 'all' || (t.ticket_status || 'open') === currentUserFilter;
      if (!matchFilter) return false;
      if (!searchTerm) return true;
      const tId = (t.ticket_id || ('TKT-' + t.id)).toLowerCase();
      const subj = (t.subject || t.reason || '').toLowerCase();
      const cat = (t.category_name || '').toLowerCase();
      return tId.includes(searchTerm) || subj.includes(searchTerm) || cat.includes(searchTerm);
    });

    if (ticketCountBadge) {
      ticketCountBadge.textContent = `${filtered.length} ticket${filtered.length !== 1 ? 's' : ''}`;
    }

    if (filtered.length === 0) {
      ticketListScroll.innerHTML = `
        <div class="empty-tickets">
          <span class="empty-icon">📭</span>
          <p>No tickets found.</p>
          <p style="font-size:0.78rem; opacity:0.6;">Create a new ticket to get help!</p>
        </div>
      `;
      return;
    }

    ticketListScroll.innerHTML = '';
    filtered.forEach(ticket => {
      const card = document.createElement('div');
      card.className = `ticket-card ${activeTicketId === ticket.id ? 'active' : ''}`;
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
  }

  // Live search listener
  const searchInput = document.getElementById('userTicketSearch');
  if (searchInput) {
    searchInput.addEventListener('input', () => renderTicketsList());
  }

  // Filter chips listener
  document.querySelectorAll('.chip[data-user-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.chip[data-user-filter]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentUserFilter = btn.dataset.userFilter;
      renderTicketsList();
    });
  });

  // ── Load Ticket Detail Workspace ──
  async function loadTicketDetail(id) {
    activeTicketId = id;

    if (ticketDetailEmpty) ticketDetailEmpty.style.display = 'none';
    if (ticketDetailContent) {
      ticketDetailContent.style.display = 'flex';
      ticketDetailContent.style.flexDirection = 'column';
      ticketDetailContent.style.height = '100%';
    }
    if (ticketMessages) {
      ticketMessages.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-muted);">⏳ Loading ticket messages...</div>`;
    }

    try {
      const data = await api(`/api/tickets/${id}/messages`);
      const ticket = data.ticket;
      const messages = data.messages || [];

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

      // Render SLA Badge
      if (viewSlaTimer) {
        if (ticket.sla_due_at) {
          const due = new Date(ticket.sla_due_at);
          const now = new Date();
          if (due < now && ticket.ticket_status !== 'resolved' && ticket.ticket_status !== 'closed') {
            viewSlaTimer.textContent = '⚠️ SLA Overdue';
            viewSlaTimer.style.background = 'rgba(239,68,68,0.15)';
            viewSlaTimer.style.color = '#f87171';
            viewSlaTimer.style.borderColor = 'rgba(239,68,68,0.3)';
          } else {
            viewSlaTimer.textContent = `⏱️ SLA Target: ${due.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}`;
            viewSlaTimer.style.background = 'rgba(124,58,237,0.15)';
            viewSlaTimer.style.color = 'var(--support-accent)';
            viewSlaTimer.style.borderColor = 'rgba(124,58,237,0.3)';
          }
          viewSlaTimer.style.display = 'inline-block';
        } else {
          viewSlaTimer.style.display = 'none';
        }
      }

      // Render Messages
      ticketMessages.innerHTML = '';
      const allMsgs = [...messages];

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

      ticketMessages.scrollTop = ticketMessages.scrollHeight;

      // Handle UI States & CSAT
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

        // Show CSAT card if not rated yet
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

  // ── Create Ticket Form Submission ──
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
      if (isGuest) {
        const gEmail = document.getElementById('guestEmailInput') ? document.getElementById('guestEmailInput').value.trim() : '';
        if (!gEmail || !gEmail.includes('@')) {
          submitBtn.disabled = false;
          submitBtn.textContent = '🚀 Submit Support Request';
          return showToast('Please enter a valid email address so we can reply to your request.', 'warning');
        }
        customFields.guest_email = gEmail;
      }
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
            submitBtn.textContent = '🚀 Submit Support Request';
            return showToast('Attachment exceeds 10MB limit.', 'warning');
          }
          formData.append('file', file);
        }

        const res = await api('/api/user/tickets/create', {
          method: 'POST',
          body: formData
        });

        showToast(`✅ Support Ticket Created! Tracking ID: ${res.ticket_id || 'TKT-' + res.id}`, 'success');
        createTicketForm.reset();
        window.removeSelectedFile();
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
        submitBtn.textContent = '🚀 Submit Support Request';
      }
    });
  }

  // ── Reply Button & Keyboard Shortcut ──
  if (replyBtn) {
    const doReply = async () => {
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
        showToast('✅ Reply sent to support operations!', 'success');
        await loadTicketDetail(activeTicketId);
        await loadTickets();
      } catch (err) {
        showToast('Failed to send: ' + err.message, 'error');
      } finally {
        replyBtn.textContent = '📤 Send Update';
        replyBtn.disabled = false;
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

  // Initial Load
  await loadTicketFormConfig();
  await loadTickets();
});
