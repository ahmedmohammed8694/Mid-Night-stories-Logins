// feed.js — Story browsing, filtering, search, and pagination for index.html

(function () {
  let currentPage = 1;
  let currentSort = 'newest';
  let currentCategory = 'all';
  let currentSearch = '';
  let currentFeed = 'all';

  // ── Load Categories ──
  async function loadCategories() {
    try {
      const categories = await api('/api/categories');
      const container = document.getElementById('categoryFilters');
      if (!container) return;

      // Keep the "All" chip
      const allChip = container.querySelector('[data-category="all"]');
      container.innerHTML = '';
      if (allChip) container.appendChild(allChip);

      categories.forEach(cat => {
        const chip = document.createElement('button');
        chip.className = 'filter-chip';
        chip.dataset.category = cat.slug;
        chip.textContent = cat.name;
        container.appendChild(chip);
      });

      // Bind click handlers
      container.querySelectorAll('.filter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          container.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          currentCategory = chip.dataset.category;
          currentPage = 1;
          loadStories();
        });
      });
    } catch (err) {
      console.error('Failed to load categories:', err);
    }
  }

  // ── Load Stories ──
  async function loadStories() {
    const grid = document.getElementById('storyGrid');
    const emptyState = document.getElementById('emptyState');
    const pagination = document.getElementById('pagination');
    if (!grid) return;

    // Show loading skeletons
    grid.innerHTML = `
      <div class="card skeleton skeleton--card"></div>
      <div class="card skeleton skeleton--card"></div>
      <div class="card skeleton skeleton--card"></div>
    `;
    if (emptyState) emptyState.classList.add('hidden');
    if (pagination) pagination.classList.add('hidden');

    try {
      const params = new URLSearchParams({
        sort: currentSort,
        page: currentPage,
        limit: 12
      });

      if (currentFeed !== 'all') params.set('feed', currentFeed);
      if (currentCategory !== 'all') params.set('category', currentCategory);
      if (currentSearch) params.set('search', currentSearch);

      const data = await api(`/api/stories?${params}`);

      grid.innerHTML = '';

      if (data.stories.length === 0) {
        if (emptyState) emptyState.classList.remove('hidden');
        return;
      }

      data.stories.forEach(story => {
        grid.appendChild(createStoryCard(story));
      });

      // Render pagination
      if (data.totalPages > 1 && pagination) {
        renderPagination(pagination, data.page, data.totalPages);
        pagination.classList.remove('hidden');
      }
    } catch (err) {
      grid.innerHTML = '';
      showToast('Failed to load stories. Please try again.', 'error');
      console.error('Failed to load stories:', err);
    }
  }

  // ── Render Pagination ──
  function renderPagination(container, page, totalPages) {
    container.innerHTML = '';

    // Previous button
    const prevBtn = document.createElement('button');
    prevBtn.className = 'pagination__btn';
    prevBtn.textContent = '←';
    prevBtn.disabled = page <= 1;
    prevBtn.addEventListener('click', () => {
      if (currentPage > 1) { currentPage--; loadStories(); scrollToStories(); }
    });
    container.appendChild(prevBtn);

    // Page buttons
    const maxVisible = 5;
    let start = Math.max(1, page - Math.floor(maxVisible / 2));
    let end = Math.min(totalPages, start + maxVisible - 1);
    if (end - start + 1 < maxVisible) start = Math.max(1, end - maxVisible + 1);

    for (let i = start; i <= end; i++) {
      const btn = document.createElement('button');
      btn.className = `pagination__btn ${i === page ? 'active' : ''}`;
      btn.textContent = i;
      btn.addEventListener('click', () => {
        currentPage = i;
        loadStories();
        scrollToStories();
      });
      container.appendChild(btn);
    }

    // Next button
    const nextBtn = document.createElement('button');
    nextBtn.className = 'pagination__btn';
    nextBtn.textContent = '→';
    nextBtn.disabled = page >= totalPages;
    nextBtn.addEventListener('click', () => {
      if (currentPage < totalPages) { currentPage++; loadStories(); scrollToStories(); }
    });
    container.appendChild(nextBtn);
  }

  function scrollToStories() {
    const el = document.getElementById('stories');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ── Event Bindings ──
  document.addEventListener('DOMContentLoaded', () => {
    // Sort select
    const sortSelect = document.getElementById('sortSelect');
    if (sortSelect) {
      sortSelect.addEventListener('change', () => {
        currentSort = sortSelect.value;
        currentPage = 1;
        loadStories();
      });
    }

    // Feed Toggle
    const feedToggle = document.getElementById('feedToggle');
    if (feedToggle) {
      feedToggle.addEventListener('click', () => {
        if (currentFeed === 'all') {
          currentFeed = 'following';
          feedToggle.classList.add('active');
        } else {
          currentFeed = 'all';
          feedToggle.classList.remove('active');
        }
        currentPage = 1;
        loadStories();
      });
    }

    // Search input (debounced)
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
      searchInput.addEventListener('input', debounce(() => {
        currentSearch = searchInput.value.trim();
        currentPage = 1;
        loadStories();
      }, 400));
    }

    // Hero Slideshow
    function initHeroSlideshow() {
      const slides = document.querySelectorAll('#hero .slideshow-slide');
      if (slides.length <= 1) return;

      let activeIndex = 0;
      setInterval(() => {
        slides[activeIndex].classList.remove('active');
        activeIndex = (activeIndex + 1) % slides.length;
        slides[activeIndex].classList.add('active');
      }, 5000);
    }

    async function loadHomeBooks() {
      const booksGrid = document.getElementById('homeBooksGrid');
      if (!booksGrid) return;
      try {
        const data = await api('/api/books?limit=4&sort=newest');
        booksGrid.innerHTML = '';
        if (!data.books || data.books.length === 0) {
          booksGrid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 24px;">No books available yet.</div>';
          return;
        }
        data.books.forEach(book => {
          const card = document.createElement('div');
          card.className = 'card card--hover';
          card.style.cursor = 'pointer';
          card.onclick = () => window.location.href = `/books?id=${book.id}`;
          card.innerHTML = `
            <img src="${book.cover_image_url || '/images/default-cover.svg'}" style="width: 100%; height: 220px; object-fit: cover; border-radius: 8px; margin-bottom: 12px;">
            <div style="font-weight: 700; font-size: 1rem; color: var(--text-primary); margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(book.title)}</div>
            <div style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 8px;">By ${escapeHtml(book.author || 'Unknown')}</div>
            <span class="filter-chip" style="font-size: 0.75rem; text-transform: uppercase;">${escapeHtml(book.channel_type || 'education')}</span>
          `;
          booksGrid.appendChild(card);
        });
      } catch (err) {
        console.error('Failed to load home books:', err);
      }
    }

    // Load initial data
    loadCategories();
    loadStories();
    loadHomeBooks();
    initHeroSlideshow();
  });
})();
