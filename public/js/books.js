// public/js/books.js — Client-side logic for the public Book Library
(function () {
  let currentPage = 1;
  const limit = 12;
  let activeView = 'grid'; // 'grid' or 'list'
  let token = localStorage.getItem('token');

  // URL routing parameters
  const urlParams = new URLSearchParams(window.location.search);
  let channel = urlParams.get('channel') || '';
  const presetCategory = urlParams.get('category') || 'all';

  // Support legacy routing format `/books?category=education` and `/books?category=naval`
  if (presetCategory === 'education' || presetCategory === 'naval') {
    channel = presetCategory;
  }

  // Highlight active menu in header
  function highlightHeaderNav() {
    const navBooks = document.getElementById('navBooks');
    if (navBooks) navBooks.classList.add('active');
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
  }

  // Load and render category filters
  async function loadCategoryFilters() {
    try {
      const url = channel ? `/api/categories?channel=${channel}` : '/api/categories';
      const categories = await api(url);
      libCategoryFilters.innerHTML = `
        <label class="checkbox-label" style="margin-bottom: 8px;">
          <input type="radio" name="lib_category" class="category-radio" value="all" checked style="cursor:pointer;">
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

    if (channel && channel !== 'all') params.append('channel', channel);
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

        // Auto open modal if ?id= or ?bookId= is in URL
        const autoBookId = urlParams.get('id') || urlParams.get('bookId');
        if (autoBookId) {
          const matched = filteredBooks.find(b => b.id == autoBookId);
          if (matched) {
            openBookModal(matched);
          } else {
            api(`/api/books/${autoBookId}`).then(b => {
              if (b && b.id) openBookModal(b);
            }).catch(() => {});
          }
        }
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
    let readButtonText = '📖 Read Details';
    
    if (book.progress && book.progress.percent_complete > 0) {
      const percent = Math.round(book.progress.percent_complete);
      readButtonText = `🔄 Resume Details (${percent}%)`;
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
      <div class="book-card__cover-wrapper class-cover-trigger">
        <img class="book-card__cover" src="${book.cover_image_url || '/images/default-cover.png'}" alt="${escapeHtml(book.title)} cover" loading="lazy">
        <span class="book-card__badge" style="background: ${typeBadgeColor};">${book.file_type.toUpperCase()}</span>
      </div>
      <div class="book-card__details" style="display: flex; flex-direction: column; flex-grow: 1;">
        <h3 class="book-card__title class-title-trigger">${escapeHtml(book.title)}</h3>
        <p class="book-card__author">By ${escapeHtml(book.author)}</p>
        
        ${book.description ? `<p style="font-size: 0.85rem; color: var(--text-tertiary); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.5; margin-bottom: 12px;">${escapeHtml(book.description)}</p>` : ''}
        
        <div style="margin-top: auto; display: flex; gap: 8px; flex-wrap: wrap;">
          <button class="btn btn--secondary btn--sm class-details-btn" style="flex: 1; min-width: 100px; display: flex; align-items: center; justify-content: center;">ℹ️ Details</button>
          <button class="btn btn--primary btn--sm class-direct-read-btn" style="flex: 1; min-width: 100px; display: flex; align-items: center; justify-content: center;">${readButtonText}</button>
        </div>
        ${progressHtml}
        ${shelfSelectorHtml}
      </div>
    `;

    // Bind event to details triggers
    card.querySelectorAll('.class-cover-trigger, .class-title-trigger, .class-details-btn').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        openBookModal(book);
      });
    });

    // Bind event to direct read button
    const directReadBtn = card.querySelector('.class-direct-read-btn');
    if (directReadBtn) {
      directReadBtn.addEventListener('click', (e) => {
        e.preventDefault();
        window.location.href = `/reader.html?bookId=${book.id}`;
      });
    }

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

  // Book Detail Modal functions
  let previewPages = [];
  let currentPreviewPage = 0;

  function openBookModal(book) {
    const modal = document.getElementById('bookDetailModal');
    
    // Fill main contents
    document.getElementById('modalBookCover').src = book.cover_image_url || '/images/default-cover.png';
    document.getElementById('modalBookTitle').textContent = book.title;
    document.getElementById('modalBookAuthor').textContent = `By ${book.author}`;
    document.getElementById('modalBookCategory').textContent = book.category_name || book.channel_type.toUpperCase();
    document.getElementById('modalBookDescription').textContent = book.description || 'No synopsis available for this book.';
    
    // Reset Accordion TOC
    const tocTrigger = document.getElementById('modalTocTrigger');
    const tocContent = document.getElementById('modalTocContent');
    const tocArrow = document.getElementById('modalTocArrow');
    tocContent.style.display = 'none';
    tocArrow.textContent = '▼';

    // Populate TOC dynamically
    const tocList = document.getElementById('modalTocList');
    tocList.innerHTML = `
      <li>Chapter 1: Introduction to ${escapeHtml(book.title)}</li>
      <li>Chapter 2: Essential Guidelines & Background</li>
      <li>Chapter 3: Deep Technical Insight & Systems Analysis</li>
      <li>Chapter 4: Implementation Methodology</li>
      <li>Chapter 5: Concluding Remarks & Next Steps</li>
    `;

    // Connect CTAs
    const readBtn = document.getElementById('modalBtnRead');
    readBtn.onclick = () => {
      window.location.href = `/reader.html?bookId=${book.id}`;
    };

    const downloadBtn = document.getElementById('modalBtnDownload');
    if (book.file_url) {
      downloadBtn.href = book.file_url;
      downloadBtn.style.display = '';
    } else {
      downloadBtn.style.display = 'none';
    }

    // Prepare Excerpt/Preview pages
    previewPages = [
      `Welcome to this official preview of <strong>"${escapeHtml(book.title)}"</strong> by <strong>${escapeHtml(book.author)}</strong>.<br><br>The content of this preview is curated to give you an overview of the key concepts and literary quality of this work. Read through the pages to determine if this book matches your professional or personal interest.`,
      `<h3>Chapter 1: The Core Thesis</h3><br>Every story starts with a spark of truth. In the field of ${escapeHtml(book.category_name || 'studies')}, this holds especially true. The following pages delve into the core tenets of our topic, analyzing why understanding this subject is crucial in contemporary environments. As we observe the changes surrounding us, the need for deep, structured references becomes paramount.`,
      `<h3>Chapter 2: Implementation Details</h3><br>When executing designs of this scale, precision is the deciding factor between success and system failure. Over the next sections, we outline a detailed methodology for catalog organization and secure user access workflows. This concludes our short preview excerpt. We hope you enjoyed this sample. To access the entire text and continue, click "Read Full Book".`
    ];

    currentPreviewPage = 0;
    document.getElementById('previewBookTitle').textContent = book.title;

    // Reset view to Main content
    document.getElementById('bookModalMainContent').classList.remove('hidden');
    document.getElementById('bookModalPreviewContent').classList.add('hidden');

    modal.classList.remove('hidden');
  }

  function updatePreviewPage() {
    const textContent = document.getElementById('previewTextContent');
    const indicator = document.getElementById('previewPageIndicator');
    const prevBtn = document.getElementById('btnPrevPreviewPage');
    const nextBtn = document.getElementById('btnNextPreviewPage');

    textContent.innerHTML = previewPages[currentPreviewPage];
    indicator.textContent = `Page ${currentPreviewPage + 1} of ${previewPages.length}`;

    prevBtn.disabled = currentPreviewPage === 0;
    nextBtn.disabled = currentPreviewPage === previewPages.length - 1;
  }

  // Setup Event Listeners for Modal
  document.addEventListener('DOMContentLoaded', () => {
    checkUserLogin();

    // Setup channel radio buttons
    document.querySelectorAll('.channel-radio').forEach(radio => {
      // Set checked radio based on initial channel value
      if (radio.value === (channel || 'all')) {
        radio.checked = true;
      }

      radio.addEventListener('change', () => {
        channel = radio.value;
        currentPage = 1;
        loadCategoryFilters().then(() => {
          loadBooks();
        });
      });
    });

    loadCategoryFilters().then(() => {
      loadBooks();
    });

    // Close modal triggers
    const modal = document.getElementById('bookDetailModal');
    const closeBtn = document.getElementById('closeBookModalBtn');
    const closePreviewBtn = document.getElementById('closePreviewBtn');

    const closeModal = () => {
      modal.classList.add('hidden');
    };

    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    // Accordion TOC trigger
    const tocTrigger = document.getElementById('modalTocTrigger');
    const tocContent = document.getElementById('modalTocContent');
    const tocArrow = document.getElementById('modalTocArrow');
    if (tocTrigger) {
      tocTrigger.addEventListener('click', () => {
        if (tocContent.style.display === 'none') {
          tocContent.style.display = 'block';
          tocArrow.textContent = '▲';
        } else {
          tocContent.style.display = 'none';
          tocArrow.textContent = '▼';
        }
      });
    }

    // Preview Mode toggle buttons
    const btnPreview = document.getElementById('modalBtnPreview');
    const mainContent = document.getElementById('bookModalMainContent');
    const previewContent = document.getElementById('bookModalPreviewContent');

    if (btnPreview) {
      btnPreview.addEventListener('click', () => {
        mainContent.classList.add('hidden');
        previewContent.classList.remove('hidden');
        updatePreviewPage();
      });
    }

    if (closePreviewBtn) {
      closePreviewBtn.addEventListener('click', () => {
        previewContent.classList.add('hidden');
        mainContent.classList.remove('hidden');
      });
    }

    // Preview page controls
    const prevPageBtn = document.getElementById('btnPrevPreviewPage');
    const nextPageBtn = document.getElementById('btnNextPreviewPage');

    if (prevPageBtn) {
      prevPageBtn.addEventListener('click', () => {
        if (currentPreviewPage > 0) {
          currentPreviewPage--;
          updatePreviewPage();
        }
      });
    }

    if (nextPageBtn) {
      nextPageBtn.addEventListener('click', () => {
        if (currentPreviewPage < previewPages.length - 1) {
          currentPreviewPage++;
          updatePreviewPage();
        }
      });
    }

    // Search input (debounced)
    if (libSearchInput) {
      libSearchInput.addEventListener('input', debounce(() => {
        currentPage = 1;
        loadBooks();
      }, 400));
    }

    // Sort select
    if (libSortSelect) {
      libSortSelect.addEventListener('change', () => {
        currentPage = 1;
        loadBooks();
      });
    }

    // Shelf select
    if (shelfSelect) {
      shelfSelect.addEventListener('change', () => {
        currentPage = 1;
        loadBooks();
      });
    }

    // View toggle button
    if (viewToggleBtn) {
      viewToggleBtn.addEventListener('click', toggleView);
    }

    // Bind instant change listeners on languages, file types, and channel radios
    document.querySelectorAll('.lang-filter, .type-filter, .channel-radio').forEach(el => {
      el.addEventListener('change', () => {
        if (el.classList.contains('channel-radio')) {
          channel = el.value === 'all' ? '' : el.value;
          loadCategoryFilters();
        }
        currentPage = 1;
        loadBooks();
      });
    });

    // Apply Filters button
    const btnApply = document.getElementById('btnApplyBookFilters');
    if (btnApply) {
      btnApply.addEventListener('click', () => {
        currentPage = 1;
        loadBooks();
      });
    }

    // Reset Filters button
    const btnReset = document.getElementById('btnResetBookFilters');
    if (btnReset) {
      btnReset.addEventListener('click', () => {
        document.querySelectorAll('.lang-filter').forEach(cb => cb.checked = (cb.value === 'en'));
        document.querySelectorAll('.type-filter').forEach(cb => cb.checked = true);
        
        const allCatRadio = document.querySelector('.category-radio[value="all"]');
        if (allCatRadio) allCatRadio.checked = true;

        const allChanRadio = document.querySelector('.channel-radio[value="all"]');
        if (allChanRadio) allChanRadio.checked = true;
        channel = '';

        if (libSearchInput) libSearchInput.value = '';
        if (libSortSelect) libSortSelect.value = 'newest';
        if (shelfSelect) shelfSelect.value = '';

        currentPage = 1;
        loadBooks();
      });
    }
  });

  // Render pagination controls
  function renderPagination(totalPages) {
    if (totalPages <= 1) return;

    libPagination.innerHTML = '';
    
    const prevBtn = document.createElement('button');
    prevBtn.className = 'pagination-btn';
    prevBtn.innerHTML = '←';
    prevBtn.disabled = currentPage === 1;
    prevBtn.addEventListener('click', () => {
      currentPage--;
      loadBooks();
    });
    libPagination.appendChild(prevBtn);

    const info = document.createElement('span');
    info.className = 'pagination-info';
    info.textContent = `Page ${currentPage} of ${totalPages}`;
    libPagination.appendChild(info);

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
    const booksGrid = document.getElementById('booksGrid');
    if (activeView === 'grid') {
      activeView = 'list';
      booksGrid.classList.add('list-view');
      viewToggleBtn.textContent = '🎛️ Grid View';
    } else {
      activeView = 'grid';
      booksGrid.classList.remove('list-view');
      viewToggleBtn.textContent = '🎛️ List View';
    }
    currentPage = 1;
    loadBooks();
  }
})();
