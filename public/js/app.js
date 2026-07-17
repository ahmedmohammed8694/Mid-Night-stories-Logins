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
  const token = localStorage.getItem('token');
  if (token) {
    defaultHeaders['Authorization'] = `Bearer ${token}`;
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
  const card = document.createElement('div');
  card.className = 'card story-card scroll-animate';
  card.style.cursor = 'pointer';

  card.addEventListener('click', (e) => {
    if (!e.target.closest('a') && !e.target.closest('button')) {
      window.location.href = getStoryUrl(story.id);
    }
  });

  let imageHtml = '';
  if (story.image_url) {
    imageHtml = `<img class="story-card__image" src="${escapeHtml(story.image_url)}" alt="" loading="lazy">`;
  }

  const categoryHtml = story.category_name
    ? `<span class="story-card__category" data-category="${escapeHtml(story.category_slug || '')}">${escapeHtml(story.category_name)}</span>`
    : '';

  const title = story.title || 'Untitled Story';
  const preview = story.body_preview || (story.content || story.body || '').substring(0, 200);

  const authorName = story.author_name || 'Anonymous';
  const targetId = story.author_user_id || story.user_id;
  const authorHtml = targetId
    ? `<span style="font-size:0.85rem; opacity:0.8; margin-bottom:8px; display:inline-block; position:relative; z-index:5;">👤 By <a href="/profile.html?id=${encodeURIComponent(targetId)}" style="color:var(--page-accent); text-decoration:none; font-weight:600;" onclick="event.stopPropagation();">${authorName}</a></span>`
    : `<span style="font-size:0.85rem; opacity:0.8; margin-bottom:8px; display:inline-block;">👤 By Anonymous</span>`;

  card.innerHTML = `
    ${imageHtml}
    ${categoryHtml}
    <h3 class="story-card__title">${escapeHtml(title)}</h3>
    ${authorHtml}
    <p class="story-card__excerpt">${escapeHtml(preview)}</p>
    <div class="story-card__footer">
      <div class="story-card__meta">
        <button class="story-card__meta-item btn-like ${story.is_liked ? 'liked' : ''}" data-id="${story.id}" style="background:none; border:none; cursor:pointer; color:inherit; font:inherit; display:flex; align-items:center; gap:5px;">
          ${story.is_liked ? '💖' : '🤍'} <span class="like-count">${formatNumber(story.likes_count || story.like_count || 0)}</span>
        </button>
        <span class="story-card__meta-item">💬 ${formatNumber(story.comment_count || 0)}</span>
      </div>
      <span class="story-card__time">${formatDate(story.created_at)}</span>
    </div>
  `;

  // Bind Like Button event
  setTimeout(() => {
    const likeBtn = card.querySelector('.btn-like');
    if (likeBtn) {
      likeBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        if (!localStorage.getItem('token')) {
          showToast('Please login to like stories.', 'warning');
          return;
        }
        try {
          const res = await api(`/api/stories/${story.id}/like`, { method: 'POST' });
          const countSpan = likeBtn.querySelector('.like-count');
          countSpan.textContent = formatNumber(res.likes_count);
          if (res.liked) {
            likeBtn.classList.add('liked');
            likeBtn.innerHTML = `💖 <span class="like-count">${formatNumber(res.likes_count)}</span>`;
          } else {
            likeBtn.classList.remove('liked');
            likeBtn.innerHTML = `🤍 <span class="like-count">${formatNumber(res.likes_count)}</span>`;
          }
        } catch (err) {
          showToast('Failed to update like.', 'error');
        }
      });
    }
  }, 0);

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

// ── Auth UI Management & Global Layout ──
function initAuthLayout() {
  const header = document.querySelector('header.header');
  if (!header) return;

  const token = localStorage.getItem('token');
  const user = JSON.parse(localStorage.getItem('user') || 'null');
  const path = window.location.pathname;

  let authSection = '';
  if (token && user) {
    const avatarChar = user.full_name ? user.full_name.charAt(0).toUpperCase() : '👤';
    const profilePicHtml = user.profile_pic 
      ? `<img src="${user.profile_pic}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">` 
      : avatarChar;

    authSection = `
      <div class="header__avatar-container" style="position: relative; cursor: pointer; display: flex; align-items: center; gap: 8px;">
        <span class="header__username" style="font-weight: 500; font-size: 0.9rem; color: inherit; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(user.full_name || '')}</span>
        <div class="header__avatar" id="avatarBtn" style="width: 38px; height: 38px; border-radius: 50%; background: var(--primary, #5c6ac4); color: white; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 1.1rem; overflow: hidden; border: 2px solid rgba(255,255,255,0.1);">
          ${profilePicHtml}
        </div>
        <div class="header__dropdown" id="avatarDropdown" style="display: none; position: absolute; right: 0; top: 48px; background: #1a1a1a; border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; width: 180px; z-index: 1000; box-shadow: 0 4px 16px rgba(0,0,0,0.6); padding: 6px 0;">
          <a href="/profile.html" style="display: block; padding: 10px 16px; color: #fff; text-decoration: none; font-size: 0.9rem; transition: background 0.2s;">My Profile</a>
          <a href="/chat.html" style="display: block; padding: 10px 16px; color: #fff; text-decoration: none; font-size: 0.9rem; transition: background 0.2s;">Chats</a>
          <a href="/profile.html?edit=true" style="display: block; padding: 10px 16px; color: #fff; text-decoration: none; font-size: 0.9rem; transition: background 0.2s;">Update Profile</a>
          <button id="logoutBtn" style="display: block; width: 100%; text-align: left; background: none; border: none; padding: 10px 16px; color: #ff5e5e; font-size: 0.9rem; cursor: pointer; font-family: inherit; transition: background 0.2s;">Logout</button>
        </div>
      </div>
    `;
  } else {
    authSection = `
      <a href="/login.html" class="btn btn--secondary btn--sm guest-only">Login</a>
      <a href="/signup.html" class="btn btn--primary btn--sm guest-only">Sign Up</a>
    `;
  }

  header.innerHTML = `
    <div class="header__inner" style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
      <a href="/" class="header__logo" style="display: flex; align-items: center; gap: 8px; text-decoration: none; color: inherit;">
        <div class="header__logo-icon" style="width: 28px; height: 28px;">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" style="fill: currentColor; width: 100%; height: 100%;">
            <path d="M60 20c0 22-18 40-40 40-2 0-5 0-7-.5 7 13.5 21 22.5 37 22.5 24.8 0 45-20.2 45-45 0-16-8.5-30-22-37 .5 2 .5 5 .5 7z"/>
          </svg>
        </div>
        <span class="header__logo-text" style="font-weight: bold; font-size: 1.15rem; letter-spacing: 0.5px;">Midnight Stories</span>
      </a>
      <nav class="header__nav" style="display: flex; gap: 24px; align-items: center; margin-left: auto; margin-right: 24px;">
        <a href="/" class="nav-link ${path === '/' || path === '/index.html' ? 'active' : ''}">Browse</a>
        <a href="/submit.html" class="nav-link ${path === '/submit.html' ? 'active' : ''}">Share Story</a>
        <a href="/profile.html" class="nav-link ${path === '/profile.html' ? 'active' : ''}">Find User</a>
        ${token ? `<a href="/chat.html" class="nav-link ${path === '/chat.html' ? 'active' : ''}">Chats</a>` : ''}
        <a href="/resources.html" class="nav-link ${path === '/resources.html' ? 'active' : ''}">Resources</a>
        <a href="/about.html" class="nav-link ${path === '/about.html' ? 'active' : ''}">About</a>
      </nav>
      <div class="header__actions" style="display: flex; align-items: center; gap: 16px;">
        <button class="theme-toggle" id="themeToggle" style="background: none; border: none; font-size: 1.1rem; cursor: pointer;" aria-label="Toggle theme">🌙</button>
        ${authSection}
        <button class="mobile-menu-toggle" id="mobileMenuBtn" aria-label="Open menu" style="display: none;">☰</button>
      </div>
    </div>
  `;

  // Dropdown Toggle
  const avatarBtn = document.getElementById('avatarBtn');
  const avatarDropdown = document.getElementById('avatarDropdown');
  if (avatarBtn && avatarDropdown) {
    avatarBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      avatarDropdown.style.display = avatarDropdown.style.display === 'none' ? 'block' : 'none';
    });
    document.addEventListener('click', () => {
      avatarDropdown.style.display = 'none';
    });
  }

  // Bind Logout
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/';
    });
  }

  // Bind Theme Toggle in dynamically loaded DOM
  const themeToggle = document.getElementById('themeToggle');
  if (themeToggle) {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    themeToggle.textContent = currentTheme === 'dark' ? '☀️' : '🌙';
    themeToggle.addEventListener('click', toggleTheme);
  }
}

// ── Initialize Shared Components ──
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initAuthLayout();
  initCrisisBanner();
  initMobileNav();
  initScrollObserver();
  init3DStyle();

  // Load community stats (only fires if the stats bar is on the page)
  loadCommunityStats();
});


