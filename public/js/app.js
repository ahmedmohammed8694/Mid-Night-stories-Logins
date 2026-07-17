// app.js — Shared utilities for Anonymous Life Stories Platform

// ── Theme Management ──
function initTheme() {
  const saved = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  updateThemeIcon(saved);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  updateThemeIcon(next);
}

function updateThemeIcon(theme) {
  const btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
}

// ── Toast Notifications ──
function showToast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.innerHTML = `<span>${icons[type] || ''}</span> ${escapeHtml(message)}`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ── API Helper ──
async function api(url, options = {}) {
  const defaultHeaders = { 'Content-Type': 'application/json' };
  const adminToken = sessionStorage.getItem('adminToken');
  if (adminToken) {
    defaultHeaders['X-Admin-Token'] = adminToken;
  }

  try {
    const res = await fetch(url, {
      headers: { ...defaultHeaders, ...options.headers },
      ...options
    });

    const data = await res.json();

    if (!res.ok) {
      const err = new Error(data.error || data.message || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }

    return data;
  } catch (err) {
    if (err.message === 'Failed to fetch') {
      throw new Error('Network error — please check your connection.');
    }
    throw err;
  }
}

// ── Utility Functions ──
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatDate(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now - date;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatNumber(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return String(num);
}

function getStoryUrl(storyId) {
  return `/story?id=${storyId}`;
}

function debounce(fn, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// ── Crisis Banner ──
function initCrisisBanner() {
  const banner = document.getElementById('crisisBanner');
  const closeBtn = document.getElementById('crisisBannerClose');

  if (!banner || !closeBtn) return;

  const dismissed = sessionStorage.getItem('crisisBannerDismissed');
  if (dismissed) {
    banner.classList.add('hidden');
  }

  closeBtn.addEventListener('click', () => {
    banner.classList.add('hidden');
    sessionStorage.setItem('crisisBannerDismissed', 'true');
  });
}

// ── Mobile Navigation ──
function initMobileNav() {
  const menuBtn = document.getElementById('mobileMenuBtn');
  const nav = document.getElementById('mobileNav');
  const closeBtn = document.getElementById('mobileNavClose');

  if (!menuBtn || !nav) return;

  menuBtn.addEventListener('click', () => {
    nav.classList.add('open');
    document.body.style.overflow = 'hidden';
  });

  const closeNav = () => {
    nav.classList.remove('open');
    document.body.style.overflow = '';
  };

  if (closeBtn) closeBtn.addEventListener('click', closeNav);
  nav.addEventListener('click', (e) => {
    if (e.target === nav || e.target.classList.contains('nav-link')) closeNav();
  });
}

// ── Generate Story Card HTML ──
function createStoryCard(story) {
  const card = document.createElement('a');
  card.href = getStoryUrl(story.id);
  card.className = 'card story-card scroll-animate';

  let imageHtml = '';
  if (story.image_url) {
    imageHtml = `<img class="story-card__image" src="${escapeHtml(story.image_url)}" alt="" loading="lazy">`;
  }

  const categoryHtml = story.category_name
    ? `<span class="story-card__category" data-category="${escapeHtml(story.category_slug || '')}">${escapeHtml(story.category_name)}</span>`
    : '';

  const title = story.title || 'Untitled Story';
  const preview = story.body_preview || story.body.substring(0, 200);

  card.innerHTML = `
    ${imageHtml}
    ${categoryHtml}
    <h3 class="story-card__title">${escapeHtml(title)}</h3>
    <p class="story-card__excerpt">${escapeHtml(preview)}</p>
    <div class="story-card__footer">
      <div class="story-card__meta">
        <span class="story-card__meta-item">❤️ ${formatNumber(story.like_count || 0)}</span>
        <span class="story-card__meta-item">💬 ${formatNumber(story.comment_count || 0)}</span>
      </div>
      <span class="story-card__time">${formatDate(story.created_at)}</span>
    </div>
  `;

  if (scrollObserver) {
    scrollObserver.observe(card);
  }

  return card;
}

// ── Scroll Animations Observer ──
let scrollObserver;
function initScrollObserver() {
  if (typeof IntersectionObserver === 'undefined') return;
  if (scrollObserver) scrollObserver.disconnect();

  scrollObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('animated');
        scrollObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.05, rootMargin: '0px 0px -30px 0px' });

  document.querySelectorAll('.scroll-animate').forEach(el => {
    scrollObserver.observe(el);
  });
}

// ── 3D Hover Style Toggle ──
function init3DStyle() {
  const toggleBtn = document.getElementById('toggle3D');
  if (!toggleBtn) return;

  const is3D = localStorage.getItem('theme3DActive') === 'true';
  if (is3D) {
    document.body.classList.add('theme-3d');
    document.body.classList.add('theme-3d-active');
    toggleBtn.classList.add('active');
    toggleBtn.textContent = '✦ Flat';
  } else {
    document.body.classList.remove('theme-3d');
    document.body.classList.remove('theme-3d-active');
    toggleBtn.classList.remove('active');
    toggleBtn.textContent = '✦ 3D';
  }

  toggleBtn.addEventListener('click', () => {
    const now3D = !document.body.classList.contains('theme-3d');
    if (now3D) {
      document.body.classList.add('theme-3d');
      document.body.classList.add('theme-3d-active');
      localStorage.setItem('theme3DActive', 'true');
      toggleBtn.classList.add('active');
      toggleBtn.textContent = '✦ Flat';
      if (typeof showToast === 'function') showToast('3D Hover Tilt enabled', 'success');
    } else {
      document.body.classList.remove('theme-3d');
      document.body.classList.remove('theme-3d-active');
      localStorage.setItem('theme3DActive', 'false');
      toggleBtn.classList.remove('active');
      toggleBtn.textContent = '✦ 3D';
      if (typeof showToast === 'function') showToast('3D Hover Tilt disabled', 'success');
    }
  });
}

// ── Community Stats: Visitor Tracking + Animated Counters ──

/**
 * Animate a number counting up from 0 to target.
 * Uses requestAnimationFrame for smooth 60fps animation.
 */
function animateCounter(id, target, duration = 1400) {
  const el = document.getElementById(id);
  if (!el) return;
  if (target === 0) { el.textContent = '0'; return; }

  const startTime = performance.now();
  const startVal  = 0;

  function format(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
    return Math.floor(n).toLocaleString();
  }

  function step(now) {
    const elapsed  = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    // Ease-out cubic
    const eased    = 1 - Math.pow(1 - progress, 3);
    const current  = startVal + (target - startVal) * eased;
    el.textContent = format(current);
    if (progress < 1) requestAnimationFrame(step);
    else el.textContent = format(target);
  }
  requestAnimationFrame(step);
}

/**
 * Load public stats and populate the community stats bar.
 * Tracks unique visitor on first visit (localStorage flag).
 */
async function loadCommunityStats() {
  const statsEl = document.getElementById('communityStats');
  if (!statsEl) return; // Only runs on pages with the stats bar

  // ── Track unique visitor ──
  const VISIT_KEY = 'ms_visited_v1';
  if (!localStorage.getItem(VISIT_KEY)) {
    localStorage.setItem(VISIT_KEY, '1');
    fetch('/api/stats/visit', { method: 'POST' }).catch(() => {});
  }

  // ── Fetch & display stats ──
  try {
    const res  = await fetch('/api/stats/public');
    if (!res.ok) return;
    const data = await res.json();

    animateCounter('statVisitors', data.totalVisitors);
    animateCounter('statLikes',    data.totalLikes,   1200);
    animateCounter('statStories',  data.totalStories,  900);
    animateCounter('statComments', data.totalComments, 1100);
  } catch (_) {
    // Silently fail — stats bar is non-critical
  }
}

// ── Initialize Shared Components ──
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initCrisisBanner();
  initMobileNav();
  initScrollObserver();
  init3DStyle();

  const themeToggle = document.getElementById('themeToggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', toggleTheme);
  }

  // Load community stats (only fires if the stats bar is on the page)
  loadCommunityStats();
});


