// public/js/reader.js — Distraction-free Reader Mode controller using epub.js and pdf.js

(function () {
  const urlParams = new URLSearchParams(window.location.search);
  let bookId = urlParams.get('bookId') || urlParams.get('id') || urlParams.get('book_id');
  let token = localStorage.getItem('token');
  let bookMeta = null;
  let epubBook = null;
  let epubRendition = null;
  let pdfDoc = null;
  let pdfCurrentPage = 1;
  let totalPdfPages = 0;
  let currentProgressPercent = 0;
  let currentPositionCfi = null;
  let saveProgressInterval = null;

  // Customization variables
  let currentTheme = localStorage.getItem('reader_theme') || 'dark';
  let currentFont = localStorage.getItem('reader_font') || 'serif';
  let fontSizePercent = parseInt(localStorage.getItem('reader_font_size')) || 100;
  let pageMargin = localStorage.getItem('reader_margin') || 'medium';
  let layoutStyle = localStorage.getItem('reader_layout') || 'paginated'; // 'paginated' or 'scroll'

  // DOM elements
  const readerFrame = document.getElementById('readerFrame');
  const bookTitle = document.getElementById('bookTitle');
  const nextBtn = document.getElementById('nextPageBtn');
  const prevBtn = document.getElementById('prevPageBtn');
  const comfortPanel = document.getElementById('comfortPanel');
  const comfortToggleBtn = document.getElementById('comfortToggleBtn');
  const sidebarToggleBtn = document.getElementById('sidebarToggleBtn');
  const readerViewport = document.getElementById('readerViewport');
  const readingProgressText = document.getElementById('readingProgressText');
  const progressRange = document.getElementById('progressRange');
  const locationsDisplay = document.getElementById('locationsDisplay');
  const addBookmarkBtn = document.getElementById('addBookmarkBtn');
  const fullscreenToggleBtn = document.getElementById('fullscreenToggleBtn');
  const brightnessSlider = document.getElementById('brightnessSlider');
  const brightnessOverlay = document.getElementById('brightnessOverlay');

  // Highlights state
  let textSelectionRange = null;

  // Init Reader
  async function init() {
    if (!bookId) {
      showToast('No book selected.', 'error');
      setTimeout(() => location.href = '/books', 2000);
      return;
    }

    checkAuthHeaders();
    applyInitialComfortSettings();
    bindComfortControlEvents();
    bindSidebarEvents();

    try {
      // 1. Fetch metadata
      bookMeta = await api(`/api/books/${bookId}`);
      bookTitle.textContent = bookMeta.title;

      // 2. Fetch or retrieve book file Blob (IndexedDB Cache layer)
      const fileBlob = await getOrFetchBookFile();

      // 3. Render Book
      if (bookMeta.file_type === 'pdf') {
        renderPdf(fileBlob);
      } else {
        renderEpub(fileBlob);
      }

      // Load user bookmarks & highlights lists
      loadUserBookmarks();
      loadUserHighlights();

      // Bind global keys & touch events
      document.addEventListener('keydown', handleKeyNavigation);
      bindTouchSwipeGestures();
      bindResizeHandler();

      // Start periodic autosave progress (every 8 seconds)
      saveProgressInterval = setInterval(saveCurrentProgress, 8000);
    } catch (err) {
      console.error(err);
      readerFrame.innerHTML = `<div style="text-align:center; padding: 40px; color:var(--accent-rose);"><h3>Failed to load book</h3><p>${escapeHtml(err.message)}</p></div>`;
    }
  }

  function checkAuthHeaders() {
    token = localStorage.getItem('token');
  }

  function handleKeyNavigation(e) {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;

    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
      e.preventDefault();
      if (epubRendition) epubRendition.next();
      else if (pdfDoc && pdfCurrentPage < totalPdfPages) { pdfCurrentPage++; renderPdfPage(pdfCurrentPage); }
    } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      e.preventDefault();
      if (epubRendition) epubRendition.prev();
      else if (pdfDoc && pdfCurrentPage > 1) { pdfCurrentPage--; renderPdfPage(pdfCurrentPage); }
    }
  }

  // IndexedDB Caching Layer using localForage
  async function getOrFetchBookFile() {
    const cacheKey = `book_file_${bookId}`;
    try {
      const cachedFile = await localforage.getItem(cacheKey);
      if (cachedFile && cachedFile instanceof Blob) {
        showToast('Loaded from offline cache.', 'success');
        return cachedFile;
      }
    } catch (e) {
      console.warn('Cache lookup failed:', e);
    }

    // Fetch from API
    showToast('Fetching book file...', 'info');
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    
    const res = await fetch(`/api/books/${bookId}/file`, { headers });
    if (!res.ok) throw new Error(`Failed to download book: status ${res.status}`);
    
    const fileBlob = await res.blob();

    try {
      await localforage.setItem(cacheKey, fileBlob);
    } catch (e) {
      console.warn('Failed to cache book file:', e);
    }

    return fileBlob;
  }

  // ── EPUB RENDERING (EPUB.JS) ──
  async function renderEpub(blob) {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const arrayBuffer = e.target.result;
      try {
        epubBook = ePub(arrayBuffer);
        
        // Wait for EPUB to be parsed
        await epubBook.opened;

        // Load table of contents
        epubBook.loaded.navigation.then(nav => {
          populateEpubTOC(nav.toc);
        }).catch(() => {});

        // Prepare layout settings (paginated = single-page columns; scrolled-continuous = continuous scroll)
        const flowType = layoutStyle === 'scroll' ? 'scrolled-continuous' : 'paginated';
        epubRendition = epubBook.renderTo("readerFrame", {
          width: "100%",
          height: "100%",
          flow: flowType,
          manager: layoutStyle === 'scroll' ? 'continuous' : 'default',
          spread: "none"
        });

        // Attach wheel & key listeners inside iframe contents
        epubRendition.hooks.content.register((contents) => {
          const doc = contents.document;
          
          let wheelTimer = 0;
          doc.addEventListener('wheel', (e) => {
            const now = Date.now();
            if (now - wheelTimer < 250) return;
            if (e.deltaY > 15 || e.deltaX > 15) {
              wheelTimer = now;
              epubRendition.next();
            } else if (e.deltaY < -15 || e.deltaX < -15) {
              wheelTimer = now;
              epubRendition.prev();
            }
          }, { passive: true });

          doc.addEventListener('keydown', handleKeyNavigation);
        });

        // Load last reading position
        try {
          const savedProgress = await api(`/api/books/${bookId}/progress`);
          if (savedProgress && savedProgress.location_cfi) {
            await epubRendition.display(savedProgress.location_cfi).catch(async () => {
              await epubRendition.display();
            });
            showToast('Resuming last read position...', 'info');
          } else {
            await epubRendition.display();
          }
        } catch (e) {
          await epubRendition.display();
        }

        nextBtn.onclick = () => epubRendition.next();
        prevBtn.onclick = () => epubRendition.prev();

        // Track location and update progress slider
        epubRendition.on("relocated", (location) => {
          currentPositionCfi = location.start.cfi;
          if (epubBook.locations && epubBook.locations.length > 0) {
            currentProgressPercent = epubBook.locations.percentageFromCfi(currentPositionCfi) * 100;
          } else {
            currentProgressPercent = location.start.percentage * 100;
          }
          updateProgressUI(currentProgressPercent, `Location: ${location.start.displayed.page || '—'}`);
        });

        // Selection annotation highlight triggering
        epubRendition.on("selected", (cfiRange, contents) => {
          textSelectionRange = cfiRange;
          showHighlightPicker(cfiRange, contents);
        });

        // Apply initial theme/fonts to rendition
        applyRenditionComfortStyles();
      } catch (err) {
        console.warn('EPUB parsing failed, rendering text view:', err);
        renderTextDocument(arrayBuffer);
      }
    };
    reader.readAsArrayBuffer(blob);
  }

  function renderTextDocument(arrayBuffer) {
    const textDecoder = new TextDecoder('utf-8');
    const text = textDecoder.decode(arrayBuffer);
    const container = document.getElementById('readerFrame');
    
    container.style.overflowY = 'auto';
    container.style.padding = '40px 32px';
    container.style.maxWidth = '900px';
    container.style.margin = '0 auto';
    container.style.lineHeight = '1.8';
    container.style.fontSize = '1.1rem';
    container.style.color = 'var(--text-primary)';
    container.style.background = 'var(--bg-secondary)';
    
    // Parse chapters from text
    const lines = text.split('\n');
    let formattedHtml = '';
    const chapters = [];

    lines.forEach((line, idx) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('CHAPTER') || trimmed.startsWith('SYNOPSIS')) {
        const id = `chap_${chapters.length + 1}`;
        chapters.push({ title: trimmed.replace(/=/g, '').trim(), id });
        formattedHtml += `<h2 id="${id}" style="font-family: 'Fraunces', serif; font-size: 1.4rem; color: var(--page-accent); margin-top: 36px; margin-bottom: 16px; border-bottom: 1px solid var(--border-card); padding-bottom: 8px;">${escapeHtml(trimmed)}</h2>`;
      } else if (trimmed.startsWith('===')) {
        // Skip decorative dividers
      } else if (trimmed.length > 0) {
        formattedHtml += `<p style="margin-bottom: 16px; color: var(--text-primary); line-height: 1.8;">${escapeHtml(trimmed)}</p>`;
      }
    });

    container.innerHTML = `
      <div class="reader-text-document" style="text-align: left;">
        <h1 style="font-family: 'Fraunces', serif; font-size: 2.2rem; margin-bottom: 8px; color: var(--text-primary);">${escapeHtml(bookMeta ? bookMeta.title : 'Book')}</h1>
        <p style="color: var(--text-secondary); margin-bottom: 24px; font-weight: 500; font-size: 1.1rem;">By ${escapeHtml(bookMeta ? bookMeta.author : 'Author')}</p>
        <hr style="border: 0; border-top: 1px solid var(--border-card); margin-bottom: 28px;">
        ${formattedHtml || `<div style="white-space: pre-wrap;">${escapeHtml(text)}</div>`}
      </div>
    `;

    // Populate Sidebar Chapters
    const tocContainer = document.getElementById('tocContainer');
    if (tocContainer) {
      if (chapters.length > 0) {
        tocContainer.innerHTML = chapters.map(ch => `
          <button class="toc-item" data-target="${ch.id}" style="text-align: left; width: 100%; padding: 10px 14px; background: none; border: none; color: var(--text-primary); font-size: 0.95rem; cursor: pointer; border-radius: var(--radius-sm); margin-bottom: 4px;">📖 ${escapeHtml(ch.title)}</button>
        `).join('');
        
        tocContainer.querySelectorAll('.toc-item').forEach(btn => {
          btn.addEventListener('click', () => {
            const targetEl = document.getElementById(btn.dataset.target);
            if (targetEl) targetEl.scrollIntoView({ behavior: 'smooth' });
          });
        });
      } else {
        tocContainer.innerHTML = `
          <button class="toc-item active" style="text-align: left; padding: 8px 12px; background: none; border: none; color: var(--text-primary); font-size: 0.9rem; cursor: pointer;">📖 Full Document</button>
        `;
      }
    }

    // Scroll & next/prev button navigation controls
    nextBtn.onclick = () => {
      container.scrollBy({ top: container.clientHeight * 0.8, behavior: 'smooth' });
    };
    prevBtn.onclick = () => {
      container.scrollBy({ top: -container.clientHeight * 0.8, behavior: 'smooth' });
    };

    container.onscroll = () => {
      const maxScroll = container.scrollHeight - container.clientHeight;
      if (maxScroll > 0) {
        const pct = Math.round((container.scrollTop / maxScroll) * 100);
        updateProgressUI(pct, `Progress: ${pct}%`);
      }
    };

    updateProgressUI(0, 'Progress: 0%');
  }

  function populateEpubTOC(toc) {
    const container = document.getElementById('tocContainer');
    container.innerHTML = '';
    
    if (!toc || toc.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted);">No chapters found.</p>';
      return;
    }

    function renderItems(items, depth = 0) {
      items.forEach(chapter => {
        if (!chapter.label || !chapter.label.trim()) return;
        const link = document.createElement('a');
        link.className = 'toc-item';
        link.style.paddingLeft = `${12 + depth * 16}px`;
        link.textContent = chapter.label.trim();
        link.href = '#';
        link.addEventListener('click', (e) => {
          e.preventDefault();
          if (chapter.href) {
            epubRendition.display(chapter.href).catch(() => epubRendition.display());
          }
          if (window.innerWidth <= 768) {
            readerViewport.classList.remove('sidebar-open');
          }
        });
        container.appendChild(link);

        if (chapter.subitems && chapter.subitems.length > 0) {
          renderItems(chapter.subitems, depth + 1);
        }
      });
    }

    renderItems(toc);
  }

  // ── PDF RENDERING (PDF.JS) ──
  function renderPdf(blob) {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const arrayBuffer = e.target.result;
      
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
      
      try {
        pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        totalPdfPages = pdfDoc.numPages;

        // Load TOC / Outline if exists
        const outline = await pdfDoc.getOutline();
        populatePdfTOC(outline);

        // Resume reading position
        try {
          const savedProgress = await api(`/api/books/${bookId}/progress`);
          if (savedProgress && savedProgress.location_cfi) {
            // PDF cfi stores the page number as a string
            const p = parseInt(savedProgress.location_cfi);
            if (p > 0 && p <= totalPdfPages) pdfCurrentPage = p;
          }
        } catch (e) {}

        renderPdfPage(pdfCurrentPage);
      } catch (err) {
        throw new Error('PDF loading failed: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(blob);

    nextBtn.onclick = () => {
      if (pdfCurrentPage < totalPdfPages) {
        pdfCurrentPage++;
        renderPdfPage(pdfCurrentPage);
        saveCurrentProgress();
      }
    };

    prevBtn.onclick = () => {
      if (pdfCurrentPage > 1) {
        pdfCurrentPage--;
        renderPdfPage(pdfCurrentPage);
        saveCurrentProgress();
      }
    };
  }

  async function renderPdfPage(pageNum) {
    readerFrame.innerHTML = '<canvas id="pdfCanvas" style="max-width:100%; max-height:100%; display:block; margin:0 auto;"></canvas>';
    const canvas = document.getElementById('pdfCanvas');
    const ctx = canvas.getContext('2d');

    const page = await pdfDoc.getPage(pageNum);
    
    // Fit to container width/height
    const viewportWidth = readerFrame.clientWidth;
    const viewportHeight = readerFrame.clientHeight;
    
    let scale = 1.0;
    const initialViewport = page.getViewport({ scale });
    const scaleX = viewportWidth / initialViewport.width;
    const scaleY = viewportHeight / initialViewport.height;
    scale = Math.min(scaleX, scaleY) * 0.95; // 5% padding

    const viewport = page.getViewport({ scale });
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    const renderCtx = {
      canvasContext: ctx,
      viewport: viewport
    };

    await page.render(renderCtx).promise;

    currentPositionCfi = String(pageNum);
    currentProgressPercent = (pageNum / totalPdfPages) * 100;
    updateProgressUI(currentProgressPercent, `Page ${pageNum} of ${totalPdfPages}`);
  }

  function populatePdfTOC(outline) {
    const container = document.getElementById('tocContainer');
    container.innerHTML = '';
    
    if (!outline || outline.length === 0) {
      // Create page jump items as a fallback TOC
      for (let i = 1; i <= Math.min(totalPdfPages, 50); i += 5) {
        const link = document.createElement('a');
        link.className = 'toc-item';
        link.textContent = `Page ${i}`;
        link.href = '#';
        link.addEventListener('click', (e) => {
          e.preventDefault();
          pdfCurrentPage = i;
          renderPdfPage(i);
        });
        container.appendChild(link);
      }
      return;
    }

    outline.forEach(item => {
      const link = document.createElement('a');
      link.className = 'toc-item';
      link.textContent = item.title;
      link.href = '#';
      link.addEventListener('click', async (e) => {
        e.preventDefault();
        // Resolve destination page number
        if (item.dest) {
          const destRef = item.dest[0];
          const pageIndex = await pdfDoc.getPageIndex(destRef);
          pdfCurrentPage = pageIndex + 1;
          renderPdfPage(pdfCurrentPage);
        }
      });
      container.appendChild(link);
    });
  }

  // ── CUSTOMIZATION & VISUAL EFFECTS ──
  function applyInitialComfortSettings() {
    // Theme
    document.body.setAttribute('data-reader-theme', currentTheme);
    document.documentElement.setAttribute('data-theme', currentTheme === 'light' ? 'light' : 'dark');
    
    // Dim slider
    const dimVal = localStorage.getItem('reader_dim') || 0;
    brightnessSlider.value = dimVal;
    brightnessOverlay.style.opacity = dimVal / 100;

    // Display Font Size
    document.getElementById('fontSizeDisplay').textContent = `${fontSizePercent}%`;
  }

  function applyRenditionComfortStyles() {
    if (!epubRendition) return;

    // Set font family, margins, font size
    let fontFamily = 'Georgia, serif';
    if (currentFont === 'sans') fontFamily = 'var(--font-primary), sans-serif';
    if (currentFont === 'dyslexic') fontFamily = 'OpenDyslexic, sans-serif';

    const readerFrame = document.getElementById('readerFrame');
    if (window.innerWidth <= 768) {
      readerFrame.style.padding = '0 16px';
    } else {
      if (pageMargin === 'narrow') readerFrame.style.padding = '0 24px';
      else if (pageMargin === 'wide') readerFrame.style.padding = '0 120px';
      else readerFrame.style.padding = '0 60px';
    }

    const rules = {
      "body": {
        "font-family": `${fontFamily} !important`,
        "font-size": `${fontSizePercent}% !important`,
        "line-height": "1.6 !important"
      },
      "p": {
        "margin-bottom": "1.2em !important"
      }
    };

    epubRendition.themes.default(rules);
    
    const themesConfig = {
      light: { body: { background: "#ffffff !important", color: "#1a1a1a !important" }, "p, div, span, h1, h2, h3, h4, h5, h6, a, li": { color: "#1a1a1a !important" } },
      sepia: { body: { background: "#f4ecd8 !important", color: "#5c4033 !important" }, "p, div, span, h1, h2, h3, h4, h5, h6, a, li": { color: "#5c4033 !important" } },
      dark: { body: { background: "#121218 !important", color: "#e0e0e8 !important" }, "p, div, span, h1, h2, h3, h4, h5, h6, a, li": { color: "#e0e0e8 !important" } },
      dim: { body: { background: "#08080f !important", color: "#8888aa !important" }, "p, div, span, h1, h2, h3, h4, h5, h6, a, li": { color: "#8888aa !important" } }
    };

    Object.keys(themesConfig).forEach(tName => {
      epubRendition.themes.register(tName, themesConfig[tName]);
    });

    epubRendition.themes.select(currentTheme);
  }

  function bindComfortControlEvents() {
    // Toggle Panel
    comfortToggleBtn.onclick = (e) => {
      e.stopPropagation();
      comfortPanel.classList.toggle('open');
    };

    document.addEventListener('click', (e) => {
      if (!comfortPanel.contains(e.target) && e.target !== comfortToggleBtn) {
        comfortPanel.classList.remove('open');
      }
    });

    // Theme select buttons
    document.querySelectorAll('.theme-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentTheme = btn.dataset.themeVal;
        localStorage.setItem('reader_theme', currentTheme);
        
        document.body.setAttribute('data-reader-theme', currentTheme);
        document.documentElement.setAttribute('data-theme', currentTheme === 'light' ? 'light' : 'dark');
        
        applyRenditionComfortStyles();
        if (pdfDoc) renderPdfPage(pdfCurrentPage); // Force re-render PDF
      });
    });

    // Font family buttons
    document.querySelectorAll('[data-font-val]').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('[data-font-val]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFont = btn.dataset.fontVal;
        localStorage.setItem('reader_font', currentFont);
        applyRenditionComfortStyles();
      };
    });

    // Font size controls
    document.getElementById('fontSizeIncBtn').onclick = () => {
      if (fontSizePercent < 200) {
        fontSizePercent += 10;
        localStorage.setItem('reader_font_size', fontSizePercent);
        document.getElementById('fontSizeDisplay').textContent = `${fontSizePercent}%`;
        applyRenditionComfortStyles();
      }
    };

    document.getElementById('fontSizeDecBtn').onclick = () => {
      if (fontSizePercent > 60) {
        fontSizePercent -= 10;
        localStorage.setItem('reader_font_size', fontSizePercent);
        document.getElementById('fontSizeDisplay').textContent = `${fontSizePercent}%`;
        applyRenditionComfortStyles();
      }
    };

    // Dim slider
    brightnessSlider.oninput = (e) => {
      const val = e.target.value;
      localStorage.setItem('reader_dim', val);
      brightnessOverlay.style.opacity = val / 100;
    };

    // Margins select buttons
    document.querySelectorAll('[data-margin-val]').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('[data-margin-val]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        pageMargin = btn.dataset.marginVal;
        localStorage.setItem('reader_margin', pageMargin);
        applyRenditionComfortStyles();
      };
    });

    // Layout buttons (Paginated vs Scroll)
    const layoutPaginatedBtn = document.getElementById('layoutPaginatedBtn');
    const layoutScrollBtn = document.getElementById('layoutScrollBtn');

    layoutPaginatedBtn.onclick = () => {
      if (layoutStyle !== 'paginated') {
        layoutStyle = 'paginated';
        localStorage.setItem('reader_layout', 'paginated');
        layoutPaginatedBtn.classList.add('active');
        layoutScrollBtn.classList.remove('active');
        location.reload(); // Reload needed to reconstruct rendition
      }
    };

    layoutScrollBtn.onclick = () => {
      if (layoutStyle !== 'scroll') {
        layoutStyle = 'scroll';
        localStorage.setItem('reader_layout', 'scroll');
        layoutScrollBtn.classList.add('active');
        layoutPaginatedBtn.classList.remove('active');
        location.reload();
      }
    };

    // Fullscreen Toggle
    fullscreenToggleBtn.onclick = () => {
      const body = document.body;
      body.classList.toggle('fullscreen');
      
      // Attempt browser fullscreen request
      if (body.classList.contains('fullscreen')) {
        if (document.documentElement.requestFullscreen) {
          document.documentElement.requestFullscreen();
        }
      } else {
        if (document.exitFullscreen) {
          document.exitFullscreen();
        }
      }
    };
  }

  // Keyboard navigation
  function handleKeyNavigation(e) {
    if (e.key === 'ArrowRight' || e.key === ' ') {
      e.preventDefault();
      nextBtn.click();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      prevBtn.click();
    }
  }

  // Sidebar Controls
  function bindSidebarEvents() {
    sidebarToggleBtn.onclick = () => {
      readerViewport.classList.toggle('sidebar-open');
    };

    document.querySelectorAll('.sidebar-tab').forEach(tab => {
      tab.onclick = () => {
        document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        // Hide all contents
        ['tab-toc', 'tab-search', 'tab-bookmarks', 'tab-highlights'].forEach(sId => {
          document.getElementById(sId).classList.add('hidden');
        });

        const activeSectionId = `tab-${tab.dataset.tab}`;
        document.getElementById(activeSectionId).classList.remove('hidden');
      };
    });
  }

  function updateProgressUI(percent, locString = '') {
    const rounded = Math.min(100, Math.max(0, Math.round(percent)));
    readingProgressText.textContent = `Progress: ${rounded}%`;
    progressRange.value = rounded;
    if (locString) {
      locationsDisplay.textContent = locString;
    }
  }

  // ── API SAVE / RESTORE PROGRESS ──
  async function saveCurrentProgress() {
    if (!token || !currentPositionCfi) return;
    try {
      await api(`/api/books/${bookId}/progress`, {
        method: 'POST',
        body: JSON.stringify({
          location_cfi: currentPositionCfi,
          percent_complete: currentProgressPercent
        })
      });
    } catch (e) {
      console.warn('Progress save failed:', e);
    }
  }

  // ── BOOKMARKS ──
  async function handleAddBookmark() {
    if (!token) {
      showToast('Please log in to save bookmarks.', 'warning');
      return;
    }
    const locText = locationsDisplay.textContent || 'Current Page';
    let label = prompt('Enter a name for this bookmark:', `Location: ${locText}`);
    if (label === null) return;
    if (!label.trim()) label = `Bookmark (${locText})`;

    try {
      await api(`/api/books/${bookId}/bookmarks`, {
        method: 'POST',
        body: JSON.stringify({
          location_cfi: currentPositionCfi || '1',
          label: label.trim()
        })
      });
      showToast('Bookmark saved successfully!', 'success');
      loadUserBookmarks();
    } catch (e) {
      showToast('Failed to save bookmark.', 'error');
    }
  }

  async function loadUserBookmarks() {
    const listContainer = document.getElementById('bookmarksList');
    if (!token) {
      listContainer.innerHTML = '<div style="padding:20px 10px; text-align:center; color:var(--text-muted); font-size:0.9rem;">🔒 Please <strong>log in</strong> to save and view your personal bookmarks.</div>';
      return;
    }

    try {
      const bookmarks = await api(`/api/books/${bookId}/bookmarks`);
      listContainer.innerHTML = `
        <button class="btn btn--primary btn--sm" id="sidebarAddBookmarkBtn" style="width: 100%; margin-bottom: 16px; display: flex; align-items: center; justify-content: center; gap: 8px; font-weight: 600;">🔖 + Add Bookmark for Current Page</button>
      `;

      const sidebarAddBtn = document.getElementById('sidebarAddBookmarkBtn');
      if (sidebarAddBtn) sidebarAddBtn.onclick = handleAddBookmark;

      if (bookmarks.length === 0) {
        listContainer.insertAdjacentHTML('beforeend', '<div style="padding: 16px 8px; text-align:center; color:var(--text-muted); font-size:0.85rem; line-height:1.5;">No bookmarks saved yet.<br>Click the button above or use 🔖 Bookmark in the top toolbar to mark your position.</div>');
        return;
      }

      bookmarks.forEach(bm => {
        const div = document.createElement('div');
        div.className = 'highlight-item';
        div.style.borderLeftColor = 'var(--accent-emerald)';
        div.innerHTML = `
          <div style="font-weight:600; cursor:pointer;" class="bookmark-jump" data-cfi="${bm.location_cfi}">🔖 ${escapeHtml(bm.label)}</div>
          <div style="font-size:0.75rem; color:var(--text-tertiary); margin-top:4px;">${new Date(bm.created_at).toLocaleDateString()}</div>
          <span class="highlight-item__delete" data-bookmark-id="${bm.id}" title="Remove bookmark">✕</span>
        `;

        div.querySelector('.bookmark-jump').onclick = () => {
          if (pdfDoc) {
            pdfCurrentPage = parseInt(bm.location_cfi);
            renderPdfPage(pdfCurrentPage);
          } else if (epubRendition) {
            epubRendition.display(bm.location_cfi);
          }
        };

        div.querySelector('.highlight-item__delete').onclick = async (e) => {
          e.stopPropagation();
          await api(`/api/books/${bookId}/bookmarks/${bm.id}`, { method: 'DELETE' });
          showToast('Bookmark removed', 'success');
          loadUserBookmarks();
        };

        listContainer.appendChild(div);
      });
    } catch (e) {
      listContainer.innerHTML = '<p style="color:var(--accent-rose);">Failed to load bookmarks.</p>';
    }
  }

  // Add bookmark listener
  addBookmarkBtn.onclick = handleAddBookmark;

  // ── HIGHLIGHTS & NOTES ──
  async function loadUserHighlights() {
    const listContent = document.getElementById('highlightsList');
    if (!token) {
      listContent.innerHTML = '<div style="padding:20px 10px; text-align:center; color:var(--text-muted); font-size:0.9rem;">🔒 Please <strong>log in</strong> to create and save text highlights and notes.</div>';
      return;
    }

    try {
      const highlights = await api(`/api/books/${bookId}/highlights`);
      listContent.innerHTML = `
        <div style="background: var(--bg-secondary); border: 1px solid var(--border-card); border-radius: var(--radius-md); padding: 12px 14px; margin-bottom: 16px; font-size: 0.85rem; color: var(--text-secondary); line-height: 1.5; text-align: left;">
          💡 <strong>How to Highlight & Take Notes:</strong><br>Select any text or sentence inside the book using your mouse or finger. A color picker menu will pop up automatically to save color highlights or personal notes!
        </div>
      `;

      if (highlights.length === 0) {
        listContent.insertAdjacentHTML('beforeend', '<div style="padding: 16px 8px; text-align:center; color:var(--text-muted); font-size:0.85rem; line-height:1.5;">No highlights created yet.<br>Select any text in the book to create your first highlight!</div>');
        return;
      }

      highlights.forEach(hl => {
        const div = document.createElement('div');
        div.className = 'highlight-item';
        
        let borderCol = 'var(--page-accent)';
        if (hl.color === 'green') borderCol = 'var(--accent-emerald)';
        if (hl.color === 'blue') borderCol = 'var(--text-primary)';
        if (hl.color === 'pink') borderCol = 'var(--accent-rose)';

        div.style.borderLeftColor = borderCol;
        div.innerHTML = `
          <div style="font-size:0.85rem; font-style:italic; margin-bottom:6px; cursor:pointer;" class="hl-jump" data-cfi="${hl.location_cfi_start}">Highlighted text section</div>
          ${hl.note_text ? `<div class="highlight-item__note"><strong>Note:</strong> ${escapeHtml(hl.note_text)}</div>` : ''}
          <span class="highlight-item__delete" data-hl-id="${hl.id}">✕</span>
        `;

        div.querySelector('.hl-jump').onclick = () => {
          if (!pdfDoc) {
            epubRendition.display(hl.location_cfi_start);
          }
        };

        div.querySelector('.highlight-item__delete').onclick = async (e) => {
          e.stopPropagation();
          await api(`/api/books/${bookId}/highlights/${hl.id}`, { method: 'DELETE' });
          showToast('Highlight deleted', 'success');
          
          // Remove from EPUB annotation if loaded
          if (epubRendition) {
            epubRendition.annotations.remove(hl.location_cfi_start, "highlight");
          }
          loadUserHighlights();
        };

        listContent.appendChild(div);

        // Apply highlights dynamically to rendition
        if (epubRendition) {
          epubRendition.annotations.add("highlight", hl.location_cfi_start, {}, () => {}, "hl-class", { fill: getColorCode(hl.color) });
        }
      });
    } catch (e) {
      console.warn('Failed to load highlights:', e);
    }
  }

  function getColorCode(colorName) {
    if (colorName === 'green') return 'rgba(187, 247, 208, 0.6)';
    if (colorName === 'blue') return 'rgba(191, 219, 254, 0.6)';
    if (colorName === 'pink') return 'rgba(251, 207, 232, 0.6)';
    return 'rgba(254, 240, 138, 0.6)'; // Yellow default
  }

  // Selection Highlight Picker overlay popup
  function showHighlightPicker(cfiRange, contents) {
    if (!token) return;

    let picker = document.getElementById('activeHighlightPicker');
    if (picker) picker.remove();

    // Create picker HTML
    picker = document.createElement('div');
    picker.id = 'activeHighlightPicker';
    picker.className = 'highlight-picker';
    
    // Absolute position relative to selection bounds
    const selection = contents.window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const iframeRect = readerFrame.getBoundingClientRect();

    picker.style.top = `${rect.top + iframeRect.top - 50}px`;
    picker.style.left = `${rect.left + iframeRect.left + (rect.width/2) - 80}px`;

    picker.innerHTML = `
      <div class="color-dot" data-color="yellow" style="background: #fef08a;"></div>
      <div class="color-dot" data-color="green" style="background: #bbf7d0;"></div>
      <div class="color-dot" data-color="blue" style="background: #bfdbfe;"></div>
      <div class="color-dot" data-color="pink" style="background: #fbcfe8;"></div>
      <button class="btn btn--primary btn--sm" id="btnNoteSave" style="padding: 2px 8px; font-size:11px; height: 24px;">✍️ Note</button>
      <button class="btn btn--secondary btn--sm" id="btnDismissPicker" style="padding: 2px 6px; font-size:11px; height: 24px;">✕</button>
    `;

    document.body.appendChild(picker);

    // Bind color clicks
    picker.querySelectorAll('.color-dot').forEach(dot => {
      dot.onclick = async () => {
        const color = dot.dataset.color;
        await saveHighlight(cfiRange, color);
        picker.remove();
        selection.removeAllRanges();
      };
    });

    // Note button
    picker.querySelector('#btnNoteSave').onclick = async () => {
      const noteText = prompt('Add a personal note to this highlight:');
      if (noteText === null) return;
      
      await saveHighlight(cfiRange, 'yellow', noteText);
      picker.remove();
      selection.removeAllRanges();
    };

    picker.querySelector('#btnDismissPicker').onclick = () => {
      picker.remove();
      selection.removeAllRanges();
    };
  }

  async function saveHighlight(cfiRange, color, noteText = '') {
    try {
      await api(`/api/books/${bookId}/highlights`, {
        method: 'POST',
        body: JSON.stringify({
          location_cfi_start: cfiRange,
          location_cfi_end: cfiRange,
          color,
          note_text: noteText
        })
      });
      showToast('Highlight saved', 'success');
      loadUserHighlights();
    } catch (e) {
      showToast('Failed to save highlight.', 'error');
    }
  }

  // ── FULL TEXT SEARCH INSIDE BOOK ──
  const searchInBookInput = document.getElementById('searchInBookInput');
  const searchInBookBtn = document.getElementById('searchInBookBtn');
  const searchBookResults = document.getElementById('searchBookResults');

  if (searchInBookBtn) {
    searchInBookBtn.onclick = async () => {
      const query = searchInBookInput.value.trim();
      if (!query) return;

      searchBookResults.innerHTML = '<p style="color:var(--text-muted); text-align:center;">Searching text...</p>';

      if (pdfDoc) {
        // PDF search approximation (simply search page by page text content)
        searchPdfContent(query);
      } else if (epubBook) {
        searchEpubContent(query);
      }
    };
  }

  async function searchEpubContent(query) {
    const results = [];
    const searchPromise = epubBook.spine.spineItems.map(async (item) => {
      await item.load(epubBook.load.bind(epubBook));
      const sectionResults = item.find(query);
      item.unload();
      return sectionResults;
    });

    const allResults = await Promise.all(searchPromise);
    allResults.flat().forEach(res => results.push(res));

    searchBookResults.innerHTML = '';
    if (results.length === 0) {
      searchBookResults.innerHTML = '<p style="color:var(--text-muted); text-align:center;">No results found.</p>';
      return;
    }

    results.slice(0, 100).forEach(res => {
      const div = document.createElement('div');
      div.className = 'highlight-item';
      div.innerHTML = `
        <div style="font-size:0.85rem; cursor:pointer;" class="search-jump" data-cfi="${res.cfi}">
          "...${escapeHtml(res.excerpt)}..."
        </div>
      `;
      div.querySelector('.search-jump').onclick = () => {
        epubRendition.display(res.cfi);
        // Highlight in iframe momentarily
        epubRendition.annotations.highlight(res.cfi, {}, () => {}, "search-temp-hl", { fill: "rgba(251,191,36,0.4)" });
      };
      searchBookResults.appendChild(div);
    });
  }

  async function searchPdfContent(query) {
    const matches = [];
    for (let i = 1; i <= totalPdfPages; i++) {
      const page = await pdfDoc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items.map(item => item.str).join(' ');
      
      if (text.toLowerCase().includes(query.toLowerCase())) {
        matches.push({ pageNum: i, excerpt: getPdfExcerpt(text, query) });
      }
    }

    searchBookResults.innerHTML = '';
    if (matches.length === 0) {
      searchBookResults.innerHTML = '<p style="color:var(--text-muted); text-align:center;">No results found.</p>';
      return;
    }

    matches.forEach(m => {
      const div = document.createElement('div');
      div.className = 'highlight-item';
      div.innerHTML = `
        <div style="font-size:0.85rem; cursor:pointer;" class="search-jump" data-page="${m.pageNum}">
          <strong>Page ${m.pageNum}:</strong> "...${escapeHtml(m.excerpt)}..."
        </div>
      `;
      div.querySelector('.search-jump').onclick = () => {
        pdfCurrentPage = m.pageNum;
        renderPdfPage(pdfCurrentPage);
      };
      searchBookResults.appendChild(div);
    });
  }

  function getPdfExcerpt(text, query) {
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    const start = Math.max(0, idx - 40);
    const end = Math.min(text.length, idx + query.length + 40);
    return text.substring(start, end);
  }

  // ── TOUCH GESTURES & RESPONSIVE RESIZING ──
  function bindTouchSwipeGestures() {
    let touchStartX = 0;
    let touchEndX = 0;

    readerViewport.addEventListener('touchstart', (e) => {
      touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });

    readerViewport.addEventListener('touchend', (e) => {
      touchEndX = e.changedTouches[0].screenX;
      const diff = touchEndX - touchStartX;
      if (Math.abs(diff) > 50) {
        if (diff < 0) {
          // Swipe Left -> Next Page
          if (epubRendition) epubRendition.next();
          else if (pdfDoc && pdfCurrentPage < totalPdfPages) { pdfCurrentPage++; renderPdfPage(pdfCurrentPage); }
        } else {
          // Swipe Right -> Prev Page
          if (epubRendition) epubRendition.prev();
          else if (pdfDoc && pdfCurrentPage > 1) { pdfCurrentPage--; renderPdfPage(pdfCurrentPage); }
        }
      }
    }, { passive: true });
  }

  function bindResizeHandler() {
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (epubRendition) {
          epubRendition.resize("100%", "100%");
          applyRenditionComfortStyles();
        }
        if (pdfDoc) {
          renderPdfPage(pdfCurrentPage);
        }
      }, 200);
    });
  }

  // Cleanup on close
  window.onbeforeunload = () => {
    saveCurrentProgress();
  };

  init();
})();
