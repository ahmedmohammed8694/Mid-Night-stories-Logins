// story.js — Story detail page: comments, likes, reports

(function () {
  let storyId = null;

  // ── Get Story ID from URL ──
  function getStoryId() {
    const params = new URLSearchParams(window.location.search);
    return params.get('id');
  }

  // ── Load Story ──
  async function loadStory() {
    storyId = getStoryId();
    if (!storyId) {
      showNotFound();
      return;
    }

    try {
      const data = await api(`/api/stories/${storyId}`);
      renderStory(data.story, data.comments);
    } catch (err) {
      showNotFound();
    }
  }

  function showNotFound() {
    document.getElementById('storyLoading').classList.add('hidden');
    document.getElementById('storyNotFound').classList.remove('hidden');
  }

  // ── Render Story ──
  function renderStory(story, comments) {
    document.getElementById('storyLoading').classList.add('hidden');
    const content = document.getElementById('storyContent');
    content.classList.remove('hidden');

    // Update page title
    document.title = `${story.title || 'Untitled Story'} — Midnight Stories`;

    // Category
    const categoryEl = document.getElementById('storyCategory');
    if (story.category_name) {
      categoryEl.textContent = story.category_name;
      categoryEl.dataset.category = story.category_slug || '';
    } else {
      categoryEl.style.display = 'none';
    }

    // Title
    document.getElementById('storyTitle').textContent = story.title || 'Untitled Story';

    // Meta
    document.getElementById('storyDate').querySelector('span').textContent = formatDate(story.created_at);
    document.getElementById('storyLikes').querySelector('span').textContent = formatNumber(story.like_count || story.likes_count || 0);
    document.getElementById('storyComments').querySelector('span').textContent = formatNumber(story.comment_count || 0);

    const authorLink = document.getElementById('storyAuthorLink');
    if (authorLink) {
      const authorName = story.author_name || 'Anonymous';
      const targetId = story.author_user_id || story.user_id;
      authorLink.textContent = authorName;
      if (targetId) {
        authorLink.href = `/profile.html?id=${encodeURIComponent(targetId)}`;
      } else {
        authorLink.removeAttribute('href');
      }
    }

    // Image
    const imageEl = document.getElementById('storyImage');
    if (story.image_url) {
      imageEl.src = story.image_url;
      imageEl.classList.remove('hidden');
    }

    // Body — convert newlines to paragraphs
    const bodyEl = document.getElementById('storyBody');
    bodyEl.textContent = story.content || story.body;

    // Like count
    document.getElementById('likeBtnCount').textContent = formatNumber(story.like_count || story.likes_count || 0);

    // Comments
    renderComments(comments);
    document.getElementById('commentCount').textContent = comments.length;

    content.classList.add('animate-slide-up');
  }

  // ── Render Comments ──
  function renderComments(comments) {
    const list = document.getElementById('commentsList');
    const noComments = document.getElementById('noComments');
    list.innerHTML = '';

    if (comments.length === 0) {
      noComments.classList.remove('hidden');
      return;
    }

    noComments.classList.add('hidden');

    comments.forEach((comment, index) => {
      const el = document.createElement('div');
      el.className = 'comment';
      el.style.animationDelay = `${index * 0.05}s`;
      
      const authorName = comment.author_name || 'Anonymous';
      const targetId = comment.author_user_id || comment.user_id;
      const authorHtml = targetId 
        ? `<a href="/profile.html?id=${encodeURIComponent(targetId)}" style="color:var(--page-accent); text-decoration:none; font-weight:600;">${authorName}</a>`
        : `<span>${authorName}</span>`;

      el.innerHTML = `
        <div class="comment__header">
          <div class="comment__author">
            <div class="comment__avatar">👤</div>
            <span class="comment__name">${authorHtml}</span>
          </div>
          <span class="comment__time">${formatDate(comment.created_at)}</span>
        </div>
        <div class="comment__body">${escapeHtml(comment.body)}</div>
        <div class="comment__actions">
          <button class="btn btn--ghost btn--sm" onclick="reportContent('comment', ${comment.id})">🚩 Report</button>
        </div>
      `;
      list.appendChild(el);
    });
  }

  // ── Like Story ──
  async function likeStory() {
    if (!storyId) return;
    const btn = document.getElementById('likeBtn');

    try {
      const data = await api(`/api/stories/${storyId}/like`, {
        method: 'POST',
        body: JSON.stringify({})
      });

      const icon = btn.querySelector('.like-btn__icon');
      const count = document.getElementById('likeBtnCount');
      count.textContent = formatNumber(data.like_count);

      if (data.liked) {
        btn.classList.add('liked');
        icon.textContent = '❤️';
        showToast('Story liked!', 'success');
      } else {
        btn.classList.remove('liked');
        icon.textContent = '🤍';
        showToast('Like removed.', 'info');
      }

      // Update header meta too
      document.getElementById('storyLikes').querySelector('span').textContent = formatNumber(data.like_count);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // ── Post Comment ──
  async function postComment(e) {
    e.preventDefault();
    const body = document.getElementById('commentBody').value.trim();
    if (!body || body.length < 1) {
      showToast('Comment cannot be empty.', 'warning');
      return;
    }

    const btn = document.getElementById('commentSubmitBtn');
    btn.disabled = true;
    btn.textContent = 'Posting...';

    try {
      const data = await api(`/api/stories/${storyId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body })
      });

      document.getElementById('commentBody').value = '';
      showToast(data.message, 'success');

      if (data.status === 'approved') {
        // Reload comments
        const storyData = await api(`/api/stories/${storyId}`);
        renderComments(storyData.comments);
        document.getElementById('commentCount').textContent = storyData.comments.length;
      }
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '💬 Post Comment';
    }
  }

  // ── Report Content ──
  let reportTarget = { type: null, id: null };

  window.reportContent = function (type, id) {
    reportTarget = { type, id };
    document.getElementById('reportModal').classList.add('active');
    document.querySelectorAll('input[name="report_reason"]').forEach(r => r.checked = false);
    document.querySelectorAll('.report-reason').forEach(r => r.classList.remove('selected'));
    document.getElementById('reportSubmitBtn').disabled = true;
  };

  async function submitReport() {
    const reason = document.querySelector('input[name="report_reason"]:checked');
    if (!reason) {
      showToast('Please select a reason.', 'warning');
      return;
    }

    try {
      const data = await api('/api/reports', {
        method: 'POST',
        body: JSON.stringify({
          target_type: reportTarget.type,
          target_id: reportTarget.id,
          reason: reason.value
        })
      });
      showToast(data.message, 'success');
      document.getElementById('reportModal').classList.remove('active');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // ── Share Functions ──
  function copyLink() {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
      showToast('Link copied to clipboard!', 'success');
    }).catch(() => {
      showToast('Failed to copy link.', 'error');
    });
  }

  function shareTwitter() {
    const title = document.getElementById('storyTitle').textContent;
    const url = encodeURIComponent(window.location.href);
    const text = encodeURIComponent(`"${title}" — Read this anonymous life story`);
    window.open(`https://twitter.com/intent/tweet?text=${text}&url=${url}`, '_blank');
  }

  function shareFacebook() {
    const url = encodeURIComponent(window.location.href);
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${url}`, '_blank');
  }

  // ── Event Bindings ──
  document.addEventListener('DOMContentLoaded', () => {
    loadStory();

    // Like
    const likeBtn = document.getElementById('likeBtn');
    if (likeBtn) likeBtn.addEventListener('click', likeStory);

    // Comment form
    const commentForm = document.getElementById('commentForm');
    if (commentForm) commentForm.addEventListener('submit', postComment);

    // Report button (story)
    const reportBtn = document.getElementById('reportBtn');
    if (reportBtn) reportBtn.addEventListener('click', () => reportContent('story', storyId));

    // Report modal
    document.querySelectorAll('.report-reason').forEach(reason => {
      reason.addEventListener('click', () => {
        const radio = reason.querySelector('input[type="radio"]');
        radio.checked = true;
        document.querySelectorAll('.report-reason').forEach(r => r.classList.remove('selected'));
        reason.classList.add('selected');
        document.getElementById('reportSubmitBtn').disabled = false;
      });
    });

    const reportSubmitBtn = document.getElementById('reportSubmitBtn');
    if (reportSubmitBtn) reportSubmitBtn.addEventListener('click', submitReport);

    const reportCancelBtn = document.getElementById('reportCancelBtn');
    if (reportCancelBtn) reportCancelBtn.addEventListener('click', () => {
      document.getElementById('reportModal').classList.remove('active');
    });

    // Close modal on overlay click
    const reportModal = document.getElementById('reportModal');
    if (reportModal) reportModal.addEventListener('click', (e) => {
      if (e.target === reportModal) reportModal.classList.remove('active');
    });

    // Share buttons
    const shareCopyBtn = document.getElementById('shareCopyBtn');
    if (shareCopyBtn) shareCopyBtn.addEventListener('click', copyLink);

    const shareTwitterBtn = document.getElementById('shareTwitterBtn');
    if (shareTwitterBtn) shareTwitterBtn.addEventListener('click', shareTwitter);

    const shareFbBtn = document.getElementById('shareFbBtn');
    if (shareFbBtn) shareFbBtn.addEventListener('click', shareFacebook);
  });
})();
