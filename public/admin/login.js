// public/admin/login.js — PM admin PIN login (M9-A)
// Vanilla JS, no framework. Posts to /api/admin/auth/login.
// On success, redirects to /admin/ (dashboard served as static asset).
// On 401, clears PIN and shows "PIN 错误" toast.
// On 429, shows lockout banner.
// On other failure, shows sticky error banner.

const API = '';  // same origin
const MAX_LEN = 8;
const MIN_LEN = 4;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// ---------- State ----------
const state = {
  pin: '',
  locked: false,
};

// ---------- DOM refs ----------
const els = {
  dots: $$('#login-dots .login-dot'),
  keys: $$('#login-pad .login-key[data-digit]'),
  back: $('#login-back'),
  submit: $('#login-submit'),
  locked: $('#login-locked'),
  errorBanner: $('#error-banner'),
  errorText: $('#error-banner-text'),
  errorRetry: $('#error-banner-retry'),
  toast: $('#toast'),
};

// ---------- Toast ----------
let toastTimer = null;
function toast(msg, kind = 'info') {
  const el = els.toast;
  el.textContent = msg;
  el.className = 'toast ' + (kind === 'error' ? 'error' : kind === 'success' ? 'success' : '') + ' show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

// ---------- Error banner ----------
function showError(msg, retry) {
  els.errorText.textContent = msg;
  els.errorBanner.hidden = false;
  if (retry) {
    els.errorRetry.hidden = false;
    els.errorRetry.onclick = () => { els.errorBanner.hidden = true; retry(); };
  } else {
    els.errorRetry.hidden = true;
  }
}
function clearError() { els.errorBanner.hidden = true; }

// ---------- Render ----------
function renderDots() {
  els.dots.forEach((d, i) => {
    d.classList.remove('filled', 'error');
    if (i < state.pin.length) d.classList.add('filled');
  });
}
function setPadEnabled(enabled) {
  els.keys.forEach((k) => { k.disabled = !enabled; });
  els.back.disabled = !enabled;
  els.submit.disabled = !enabled || state.pin.length < MIN_LEN;
  els.locked.hidden = enabled;
}

function flashDotsError() {
  els.dots.forEach((d) => d.classList.add('error'));
  setTimeout(renderDots, 400);
}

// ---------- API ----------
async function login() {
  if (state.pin.length < MIN_LEN || state.pin.length > MAX_LEN) return;
  if (state.locked) return;

  clearError();
  setPadEnabled(false);

  try {
    const r = await fetch(API + '/api/admin/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: state.pin }),
    });

    // Try to parse JSON; tolerate empty body
    const text = await r.text();
    const data = text ? safeJson(text) : null;

    if (r.ok) {
      // 200 → success, redirect to dashboard
      window.location.href = '/admin/';
      return;
    }

    const code = data?.error?.code || ('HTTP_' + r.status);

    if (r.status === 429 || code === 'TOO_MANY_ATTEMPTS') {
      // Lockout: surface banner, disable pad, optionally use Retry-After header
      const retryAfter = r.headers.get('Retry-After');
      if (retryAfter && /^\d+$/.test(retryAfter)) {
        const mins = Math.ceil(Number(retryAfter) / 60);
        els.locked.innerHTML = '<strong>已锁定</strong><br>请 ' + mins + ' 分钟后再试。';
      }
      state.locked = true;
      setPadEnabled(false);
      toast('尝试过多，已锁定', 'error');
      return;
    }

    if (r.status === 401 || code === 'INVALID_PIN') {
      // Wrong PIN: clear and shake dots
      state.pin = '';
      renderDots();
      flashDotsError();
      setPadEnabled(true);
      toast('PIN 错误，重试', 'error');
      return;
    }

    // Other 4xx/5xx → show banner with retry
    showError('登录失败：' + code, () => login());
    setPadEnabled(true);
  } catch (e) {
    // Network error
    showError('网络错误：' + (e?.message || '未知'), () => login());
    setPadEnabled(true);
  }
}

function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }

// ---------- Handlers ----------
function onDigit(d) {
  if (state.locked) return;
  if (state.pin.length >= MAX_LEN) return;
  clearError();
  state.pin += String(d);
  renderDots();
  els.submit.disabled = state.pin.length < MIN_LEN;
  // No auto-submit: user must tap ✓ (or press Enter) to login.
  // Previous "auto-submit at 4 digits" caused wrong submissions for 5-8 digit PINs.
}
function onBackspace() {
  if (state.locked) return;
  if (state.pin.length === 0) return;
  clearError();
  state.pin = state.pin.slice(0, -1);
  renderDots();
  els.submit.disabled = state.pin.length < MIN_LEN;
}
function onClear() {
  if (state.locked) return;
  state.pin = '';
  renderDots();
  els.submit.disabled = true;
  clearError();
}

// ---------- Bind ----------
function bind() {
  els.keys.forEach((k) => {
    k.addEventListener('click', () => onDigit(k.dataset.digit));
  });
  els.back.addEventListener('click', onBackspace);
  els.submit.addEventListener('click', login);

  // Keyboard support (desktop / hardware keyboard on iPad)
  document.addEventListener('keydown', (e) => {
    if (/^[0-9]$/.test(e.key)) {
      onDigit(e.key);
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      onBackspace();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      login();
    } else if (e.key === 'Escape') {
      onClear();
    }
  });

  // Long-press backspace = clear
  let backTimer = null;
  els.back.addEventListener('pointerdown', () => {
    backTimer = setTimeout(() => { onClear(); backTimer = null; }, 600);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => {
    els.back.addEventListener(ev, () => {
      if (backTimer) { clearTimeout(backTimer); backTimer = null; }
    });
  });
}

// ---------- Boot ----------
function boot() {
  bind();
  renderDots();
  els.submit.disabled = true;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
