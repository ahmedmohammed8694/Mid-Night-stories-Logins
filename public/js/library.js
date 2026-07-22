// public/js/library.js — Client-side logic for the public Book Library

(function () {
  let currentPage = 1;
  const limit = 12;
  let activeView = 'grid'; // 'grid' or 'list'
  let token = localStorage.getItem('token');

  // URL routing parameters
  const urlParams = new URLSearchParams(window.location.search);
  const channel = urlParams.get('channel') || 'education';
  const presetCategory = urlParams.get('category') || 'all';

  // Highlight active menu in header
  function highlightHeaderNav() {
    if (channel === 'education') {
      const edEl = document.getElementById('navEdBooks');
      if (edEl) edEl.classList.add('active');
    } else if (channel === 'naval') {
      const navEl = document.getElementById('navNavalBooks');
      if (navEl) navEl.classList.add('active');
    }
  }

  // Update Hero text based on channel
  function updateHeroText() {
    const heroTitle = document.querySelector('.hero__title');
    const heroSubtitle = document.querySelector('.hero__subtitle');
    if (heroTitle && heroSubtitle) {
      if (channel === 'naval') {
        heroTitle.textContent = 'Naval Library';
        heroSubtitle.textContent = 'Explore naval history, maritime tactics, nautical studies, and ship design.';
      } else {
        heroTitle.textContent = 'Educational Library';
        heroSubtitle.textContent = 'Find reference books, research papers, computer science materials, and study guides.';
      }
    }
  }

  // DOM Elements
  const booksGrid = document.getElementById('booksGrid');
  const libEmptyState = document.getElementById('libEmptyState');
  const libPagination = document.getElementById('libPagination');
  const totalBooksCount = document.getElementById('totalBooksCount');
  const displayedBooksCount = document.getElementById('displayedBooksCount');
  const libSearchInput = document.getElementById('libSearchInput');
  const libSortSelect = document.getElementById('libSortSelect');
  const shelfSelect = document.getElementById('shelfSelect');
  const libCategoryFilters = document.getElementById('libCategoryFilters');
  const viewToggleBtn = document.getElementById('viewToggleBtn');
  const shelfFilterSection = document.getElementById('shelfFilterSection');

  // Check login and customize UI
  function checkUserLogin() {
    token = localStorage.getItem('token');
    if (token) {
      document.querySelectorAll('.auth-only').forEach(el => el.style.display = '');
      document.querySelectorAll('.guest-only').forEach(el => el.style.display = 'none');
      if (shelfFilterSection) shelfFilterSection.style.display = 'block';
    } else {
      document.querySelectorAll('.auth-only').forEach(el => el.style.display = 'none');
      document.querySelectorAll('.guest-only').forEach(el => el.style.display = '');
      if (shelfFilterSection) shelfFilterSection.style.display = 'none';
    }
    highlightHeaderNav();
    updateHeroText();
  }

  // Load and render category filters
  async function loadCategoryFilters() {
    try {
      const categories = await api(`/api/categories?channel=${channel}`);
      libCategoryFilters.innerHTML = `
        <label class="checkbox-label" style="margin-bottom: 8px;">
          <input type="radio" name="lib_category" class="category-radio" value="all" ${presetCategory === 'all' ? 'checked' : ''} style="cursor:pointer;">
          <span>All Categories</span>
        </label>
      `;
      
      categories.forEach(cat => {
        const label = document.createElement('label');
        label.className = 'checkbox-label';
        label.style.marginBottom = '6px';
        label.innerHTML = `
          <input type="radio" name="lib_category" class="category-radio" value="${cat.slug}" ${presetCategory === cat.slug ? 'checked' : ''} style="cursor:pointer;">
          <span>${escapeHtml(cat.name)}</span>
        `;
        libCategoryFilters.appendChild(label);
      });

      // Bind events to radio buttons
      document.querySelectorAll('.category-radio').forEach(radio => {
        radio.addEventListener('change', () => {
          currentPage = 1;
          loadBooks();
        });
      });
    } catch (err) {
      libCategoryFilters.innerHTML = `<p style="color:var(--accent-rose);">Failed to load genres.</p>`;
    }
  }

  // Fetch books from server
  async function loadBooks() {
    // Show skeletons
    booksGrid.innerHTML = `
      <div class="card skeleton skeleton--card"></div>
      <div class="card skeleton skeleton--card"></div>
      <div class="card skeleton skeleton--card"></div>
    `;
    libPagination.innerHTML = '';
    libEmptyState.classList.add('hidden');

    const search = libSearchInput.value.trim();
    const sort = libSortSelect.value;
    const shelf = token && shelfSelect ? shelfSelect.value : '';
    
    // Selected category
    const selectedCatEl = document.querySelector('.category-radio:checked');
    const category = selectedCatEl ? selectedCatEl.value : 'all';

    // Parse languages
    const activeLanguages = Array.from(document.querySelectorAll('.lang-filter:checked')).map(cb => cb.value);

    // Build URL query params
    const params = new URLSearchParams({
      page: currentPage,
      limit,
      sort
    });

    if (channel) params.append('channel', channel);
    if (category && category !== 'all') params.append('category', category);
    if (search) params.append('search', search);
    if (shelf) params.append('shelf', shelf);

    try {
      const data = await api(`/api/books?${params.toString()}`);
      
      // Client-side language filtering (as SQLite SQL contains generic languages)
      let filteredBooks = data.books || [];
      if (activeLanguages.length > 0) {
        filteredBooks = filteredBooks.filter(book => {
          const lang = book.language ? book.language.toLowerCase() : 'en';
          if (activeLanguages.includes('other')) {
            // Include other languages not explicitly checked
            return activeLanguages.includes(lang) || !['en', 'es', 'fr', 'de', 'ar'].includes(lang);
          }
          return activeLanguages.includes(lang);
        });
      }

      // Filter by type too
      const activeTypes = Array.from(document.querySelectorAll('.type-filter:checked')).map(cb => cb.value);
      if (activeTypes.length > 0) {
        filteredBooks = filteredBooks.filter(book => activeTypes.includes(book.file_type));
      }

      totalBooksCount.textContent = data.total;
      displayedBooksCount.textContent = filteredBooks.length;
      booksGrid.innerHTML = '';

      if (filteredBooks.length > 0) {
        libEmptyState.classList.add('hidden');
        filteredBooks.forEach(book => {
          booksGrid.appendChild(createBookCard(book));
        });
        renderPagination(data.totalPages);
      } else {
        libEmptyState.classList.remove('hidden');
      }
    } catch (err) {
      booksGrid.innerHTML = `<div style="grid-column: 1/-1; text-align:center; padding:40px; color:var(--accent-rose);">Error loading library: ${escapeHtml(err.message)}</div>`;
    }
  }

  // Create single Book Card element
  function createBookCard(book) {
    const card = document.createElement('div');
    card.className = `book-card ${activeView === 'list' ? 'list-view' : ''}`;
    
    // Progress calculation
    let progressHtml = '';
    let readButtonText = '📖 Read Now';
    
    if (book.progress && book.progress.percent_complete > 0) {
      const percent = Math.round(book.progress.percent_complete);
      readButtonText = `🔄 Resume (${percent}%)`;
      progressHtml = `
        <div class="book-card__progress-container" title="${percent}% read">
          <div class="book-card__progress-bar" style="width: ${percent}%;"></div>
        </div>
      `;
    }

    // Shelf status options (Auth Only)
    let shelfSelectorHtml = '';
    if (token) {
      const currentShelf = book.shelf_status || '';
      shelfSelectorHtml = `
        <div style="margin-top: 12px; display: flex; gap: 8px; width: 100%;">
          <select class="shelf-status-select" data-book-id="${book.id}" style="flex-grow:1; height: 32px; font-size: 0.8rem; background: var(--bg-secondary); border: 1px solid var(--border-card); border-radius: var(--radius-sm); color: var(--text-secondary); cursor: pointer;">
            <option value="" ${currentShelf === '' ? 'selected' : ''}>📁 Add to Shelf</option>
            <option value="currently_reading" ${currentShelf === 'currently_reading' ? 'selected' : ''}>📖 Reading</option>
            <option value="want_to_read" ${currentShelf === 'want_to_read' ? 'selected' : ''}>⏳ Want to Read</option>
            <option value="finished" ${currentShelf === 'finished' ? 'selected' : ''}>✅ Finished</option>
            <option value="remove" style="color:var(--accent-rose);">❌ Remove from Shelf</option>
          </select>
        </div>
      `;
    }

    const typeBadgeColor = book.file_type === 'epub' ? 'var(--page-accent)' : 'var(--accent-amber)';

    card.innerHTML = `
      <div class="book-card__cover-wrapper" onclick="location.href='/reader.html?bookId=${book.id}'">
        <img class="book-card__cover" src="${book.cover_image_url || '/images/default-cover.png'}" alt="${escapeHtml(book.title)} cover" loading="lazy">
        <span class="book-card__badge" style="background: ${typeBadgeColor};">${book.file_type.toUpperCase()}</span>
      </div>
      <div class="book-card__details" style="display: flex; flex-direction: column; flex-grow: 1;">
        <h3 class="book-card__title" onclick="location.href='/reader.html?bookId=${book.id}'">${escapeHtml(book.title)}</h3>
        <p class="book-card__author">By ${escapeHtml(book.author)}</p>
        
        ${book.description ? `<p style="font-size: 0.85rem; color: var(--text-tertiary); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.5; margin-bottom: 12px;">${escapeHtml(book.description)}</p>` : ''}
        
        <div style="margin-top: auto;">
          <button class="btn btn--primary btn--sm" style="width: 100%; display: flex; align-items: center; justify-content: center;" onclick="location.href='/reader.html?bookId=${book.id}'">${readButtonText}</button>
          ${progressHtml}
          ${shelfSelectorHtml}
        </div>
      </div>
    `;

    // Bind event to shelf select
    const select = card.querySelector('.shelf-status-select');
    if (select) {
      select.addEventListener('change', async (e) => {
        const val = e.target.value;
        const bookId = e.target.dataset.bookId;
        const status = val === 'remove' ? null : val;
        
        try {
          await api(`/api/books/${bookId}/shelf`, {
            method: 'POST',
            body: JSON.stringify({ shelf_status: status })
          });
          showToast(status ? `Moved book to shelf: ${status}` : 'Book removed from shelf', 'success');
          loadBooks();
        } catch (err) {
          showToast(err.message, 'error');
          e.target.value = book.shelf_status || '';
        }
      });
    }

    return card;
  }

  // Render pagination controls
  function renderPagination(totalPages) {
    if (totalPages <= 1) return;

    libPagination.innerHTML = '';
    
    // Prev button
    const prevBtn = document.createElement('button');
    prevBtn.className = 'pagination-btn';
    prevBtn.innerHTML = '←';
    prevBtn.disabled = currentPage === 1;
    prevBtn.addEventListener('click', () => {
      currentPage--;
      loadBooks();
    });
    libPagination.appendChild(prevBtn);

    // Page indicator
    const info = document.createElement('span');
    info.className = 'pagination-info';
    info.textContent = `Page ${currentPage} of ${totalPages}`;
    libPagination.appendChild(info);

    // Next button
    const nextBtn = document.createElement('button');
    nextBtn.className = 'pagination-btn';
    nextBtn.innerHTML = '→';
    nextBtn.disabled = currentPage === totalPages;
    nextBtn.addEventListener('click', () => {
      currentPage++;
      loadBooks();
    });
    libPagination.appendChild(nextBtn);
  }

  // View Toggle (Grid / List)
  function toggleView() {
    const booksContainer = document.getElementById('booksContainer');
    if (activeView === 'grid') {
      activeView = 'list';
      booksContainer.classList.add('list-view');
      viewToggleBtn.textContent = '🎛️ Grid View';
    } else {
      activeView = 'grid';
      booksContainer.classList.remove('list-view');
      viewToggleBtn.textContent = '🎛️ List View';
    }
    loadBooks();
  }

  // Event Listeners
  document.addEventListener('DOMContentLoaded', () => {
    checkUserLogin();
    loadCategoryFilters();
    loadBooks();

    // Instant Search
    let searchTimeout;
    libSearchInput.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        currentPage = 1;
        loadBooks();
      }, 400);
    });

    // Sorting
    libSortSelect.addEventListener('change', () => {
      currentPage = 1;
      loadBooks();
    });

    // Shelf Filter
    if (shelfSelect) {
      shelfSelect.addEventListener('change', () => {
        currentPage = 1;
        loadBooks();
      });
    }

    // Languages & File type checkboxes
    document.querySelectorAll('.lang-filter, .type-filter').forEach(cb => {
      cb.addEventListener('change', () => {
        currentPage = 1;
        loadBooks();
      });
    });

    // View toggle
    viewToggleBtn.addEventListener('click', toggleView);

    // Watch login changes or tokens
    window.addEventListener('storage', (e) => {
      if (e.key === 'token') {
        checkUserLogin();
        loadBooks();
      }
    });
  });
})();
