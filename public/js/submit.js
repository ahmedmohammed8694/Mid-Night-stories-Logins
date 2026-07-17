// submit.js — Story submission form: PII detection, crisis language check, file upload, form submission

(function () {
  let selectedFile = null;
  let crisisAcknowledged = false;

  // ── Load Categories ──
  async function loadCategories() {
    try {
      const categories = await api('/api/categories');
      const select = document.getElementById('storyCategory');
      if (!select) return;

      categories.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat.id;
        option.textContent = cat.name;
        select.appendChild(option);
      });
    } catch (err) {
      console.error('Failed to load categories:', err);
    }
  }

  // ── Character & Word Counter ──
  function updateCounters() {
    const body = document.getElementById('storyBody');
    const charCount = document.getElementById('charCount');
    const wordCount = document.getElementById('wordCount');
    if (!body) return;

    const text = body.value;
    const chars = text.length;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;

    if (charCount) {
      charCount.textContent = `${chars} character${chars !== 1 ? 's' : ''} ${chars < 50 ? `(${50 - chars} more needed)` : '✓'}`;
      charCount.style.color = chars < 50 ? 'var(--accent-warm)' : 'var(--accent-emerald)';
    }
    if (wordCount) {
      wordCount.textContent = `${words} word${words !== 1 ? 's' : ''}`;
    }
  }

  // ── Live PII Check ──
  const checkPII = debounce(async () => {
    const body = document.getElementById('storyBody');
    const title = document.getElementById('storyTitle');
    const piiWarning = document.getElementById('piiWarning');
    const piiDetails = document.getElementById('piiDetails');
    if (!body || !piiWarning) return;

    const text = (title?.value || '') + ' ' + body.value;
    if (text.trim().length < 10) {
      piiWarning.classList.add('hidden');
      return;
    }

    try {
      const data = await api('/api/moderate/text', {
        method: 'POST',
        body: JSON.stringify({ text })
      });

      if (data.pii && data.pii.length > 0) {
        const types = data.pii.map(p => `${p.type} (${p.count} found)`).join(', ');
        piiDetails.innerHTML = `<strong>Detected:</strong> ${escapeHtml(types)}. For your safety, consider removing personal information before submitting.`;
        piiWarning.classList.remove('hidden');
      } else {
        piiWarning.classList.add('hidden');
      }

      // Crisis language check (show modal if detected and not already acknowledged)
      if (data.crisis && data.crisis.isCrisis && !crisisAcknowledged) {
        document.getElementById('crisisModal').classList.add('active');
      }
    } catch (err) {
      // Silently fail — don't block the user
      console.error('PII check failed:', err);
    }
  }, 1000);

  // ── File Upload ──
  function initFileUpload() {
    const dropzone = document.getElementById('fileDropzone');
    const fileInput = document.getElementById('fileInput');
    const preview = document.getElementById('filePreview');
    const previewImage = document.getElementById('previewImage');
    const fileName = document.getElementById('fileName');
    const fileSize = document.getElementById('fileSize');
    const removeBtn = document.getElementById('removeFile');

    if (!dropzone || !fileInput) return;

    dropzone.addEventListener('click', () => fileInput.click());

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });

    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('dragover');
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      const files = e.dataTransfer.files;
      if (files.length > 0) handleFile(files[0]);
    });

    fileInput.addEventListener('change', () => {
      if (fileInput.files.length > 0) handleFile(fileInput.files[0]);
    });

    if (removeBtn) {
      removeBtn.addEventListener('click', () => {
        selectedFile = null;
        fileInput.value = '';
        preview.classList.add('hidden');
        dropzone.style.display = '';
      });
    }

    function handleFile(file) {
      const allowed = ['image/jpeg', 'image/png', 'image/webp'];
      if (!allowed.includes(file.type)) {
        showToast('Only JPG, PNG, and WebP images are allowed.', 'warning');
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        showToast('File must be under 5MB.', 'warning');
        return;
      }

      selectedFile = file;
      const reader = new FileReader();
      reader.onload = (e) => {
        if (previewImage) previewImage.src = e.target.result;
      };
      reader.readAsDataURL(file);

      if (fileName) fileName.textContent = file.name;
      if (fileSize) fileSize.textContent = `${(file.size / 1024).toFixed(1)} KB`;
      if (preview) preview.classList.remove('hidden');
      dropzone.style.display = 'none';
    }
  }

  // ── Form Submission ──
  async function handleSubmit(e) {
    e.preventDefault();

    const body = document.getElementById('storyBody').value.trim();
    const title = document.getElementById('storyTitle').value.trim();
    const categoryId = document.getElementById('storyCategory').value;
    const ageConfirm = document.getElementById('ageConfirm').checked;

    // Validation
    if (body.length < 50) {
      showToast('Your story must be at least 50 characters long.', 'warning');
      return;
    }

    if (!ageConfirm) {
      showToast('Please confirm you are 18 or older.', 'warning');
      return;
    }

    const submitBtn = document.getElementById('submitBtn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';

    try {
      const formData = new FormData();
      if (title) formData.append('title', title);
      formData.append('body', body);
      if (categoryId) formData.append('category_id', categoryId);
      formData.append('age_confirmed', 'true');
      if (selectedFile) formData.append('image', selectedFile);

      const res = await fetch('/api/stories', {
        method: 'POST',
        body: formData
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Submission failed.');
      }

      // Show success
      document.getElementById('storyForm').classList.add('hidden');
      document.getElementById('successCard').classList.remove('hidden');
      document.getElementById('successMessage').textContent = data.message;
      document.getElementById('submitterToken').textContent = data.submitterToken;

      // Show crisis resources if detected
      if (data.crisisDetected) {
        document.getElementById('crisisModal').classList.add('active');
      }

      showToast('Story submitted successfully!', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = '✍️ Submit Your Story';
    }
  }

  // ── Event Bindings ──
  document.addEventListener('DOMContentLoaded', () => {
    loadCategories();
    initFileUpload();

    const storyBody = document.getElementById('storyBody');
    const storyTitle = document.getElementById('storyTitle');
    if (storyBody) {
      storyBody.addEventListener('input', () => {
        updateCounters();
        checkPII();
      });
    }
    if (storyTitle) {
      storyTitle.addEventListener('input', checkPII);
    }

    const storyForm = document.getElementById('storyForm');
    if (storyForm) storyForm.addEventListener('submit', handleSubmit);

    // Crisis modal buttons
    const crisisModalContinue = document.getElementById('crisisModalContinue');
    const crisisModalClose = document.getElementById('crisisModalClose');
    const crisisModal = document.getElementById('crisisModal');

    if (crisisModalContinue) {
      crisisModalContinue.addEventListener('click', () => {
        crisisAcknowledged = true;
        crisisModal.classList.remove('active');
      });
    }

    if (crisisModalClose) {
      crisisModalClose.addEventListener('click', () => {
        crisisModal.classList.remove('active');
      });
    }

    if (crisisModal) {
      crisisModal.addEventListener('click', (e) => {
        if (e.target === crisisModal) crisisModal.classList.remove('active');
      });
    }
  });
})();
