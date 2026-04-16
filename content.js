(function () {
  'use strict';

  const PROCESSED = 'data-bb-heatmap';
  const SRCS_ATTR = 'data-bb-hm-srcs';

  // ==========================================================================
  // Image loading
  // ==========================================================================

  async function fetchImageData(url) {
    const resp = await fetch(url, { credentials: 'include' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const blob = await resp.blob();
    const bitmap = await createImageBitmap(blob);
    const displayUrl = URL.createObjectURL(blob);
    return { bitmap, displayUrl };
  }

  // ==========================================================================
  // Diff computation
  // ==========================================================================

  function computeDiff(bBitmap, aBitmap) {
    const w = Math.max(bBitmap.width, aBitmap.width);
    const h = Math.max(bBitmap.height, aBitmap.height);

    const bCanvas = document.createElement('canvas');
    bCanvas.width = w;
    bCanvas.height = h;
    const bCtx = bCanvas.getContext('2d');
    bCtx.drawImage(bBitmap, 0, 0);
    const bD = bCtx.getImageData(0, 0, w, h).data;

    const aCanvas = document.createElement('canvas');
    aCanvas.width = w;
    aCanvas.height = h;
    const aCtx = aCanvas.getContext('2d');
    aCtx.drawImage(aBitmap, 0, 0);
    const aD = aCtx.getImageData(0, 0, w, h).data;

    const total = w * h;
    const diffs = new Float32Array(total);
    let changed = 0;

    for (let i = 0; i < total; i++) {
      const p = i * 4;
      const d =
        (Math.abs(bD[p] - aD[p]) +
          Math.abs(bD[p + 1] - aD[p + 1]) +
          Math.abs(bD[p + 2] - aD[p + 2]) +
          Math.abs(bD[p + 3] - aD[p + 3])) /
        4;
      diffs[i] = d;
      if (d > 2) changed++;
    }

    return {
      width: w,
      height: h,
      diffs,
      afterPixels: aD,
      changed,
      total,
      pct: ((changed / total) * 100).toFixed(2),
    };
  }

  function heatColor(v) {
    if (v < 0.25) {
      const t = v / 0.25;
      return [0, (t * 255) | 0, 255];
    }
    if (v < 0.5) {
      const t = (v - 0.25) / 0.25;
      return [0, 255, ((1 - t) * 255) | 0];
    }
    if (v < 0.75) {
      const t = (v - 0.5) / 0.25;
      return [(t * 255) | 0, 255, 0];
    }
    const t = (v - 0.75) / 0.25;
    return [255, ((1 - t) * 255) | 0, 0];
  }

  function renderHeatmap(diff) {
    const c = document.createElement('canvas');
    c.width = diff.width;
    c.height = diff.height;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(diff.width, diff.height);
    const d = img.data;

    for (let i = 0; i < diff.diffs.length; i++) {
      const v = diff.diffs[i];
      const p = i * 4;
      if (v <= 2) {
        d[p + 3] = 0;
        continue;
      }
      const n = Math.min(v / 80, 1);
      const [r, g, b] = heatColor(n);
      d[p] = r;
      d[p + 1] = g;
      d[p + 2] = b;
      d[p + 3] = (60 + n * 195) | 0;
    }

    ctx.putImageData(img, 0, 0);
    return c;
  }

  function renderDiffOnly(diff) {
    const c = document.createElement('canvas');
    c.width = diff.width;
    c.height = diff.height;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(diff.width, diff.height);
    const d = img.data;
    const ap = diff.afterPixels;

    for (let i = 0; i < diff.diffs.length; i++) {
      const v = diff.diffs[i];
      const p = i * 4;
      if (v <= 4) {
        d[p] = ap[p];
        d[p + 1] = ap[p + 1];
        d[p + 2] = ap[p + 2];
        d[p + 3] = 30;
      } else {
        const a = Math.min(v / 40, 1);
        d[p] = ap[p];
        d[p + 1] = ap[p + 1];
        d[p + 2] = ap[p + 2];
        d[p + 3] = (100 + a * 155) | 0;
      }
    }

    ctx.putImageData(img, 0, 0);
    return c;
  }

  // ==========================================================================
  // UI helpers
  // ==========================================================================

  function el(tag, cls, attrs) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (k === 'text') e.textContent = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
        else e.setAttribute(k, v);
      }
    }
    return e;
  }

  // ==========================================================================
  // Toolbar
  // ==========================================================================

  function buildToolbar(onSwitch) {
    const bar = el('div', 'bb-hm-toolbar');

    const modes = [
      { id: 'normal', label: 'Normal' },
      { id: 'heatmap', label: 'Heatmap' },
      { id: 'diff', label: 'Diff Only' },
      { id: 'slider', label: 'Slider' },
    ];

    let active = 'normal';
    const btns = {};

    for (const m of modes) {
      const b = el('button', 'bb-hm-btn' + (m.id === 'normal' ? ' active' : ''), {
        text: m.label,
        type: 'button',
      });
      b.addEventListener('click', () => {
        if (active === m.id) return;
        btns[active].classList.remove('active');
        active = m.id;
        b.classList.add('active');
        onSwitch(m.id);
      });
      btns[m.id] = b;
      bar.appendChild(b);
    }

    return bar;
  }

  // ==========================================================================
  // Stats bar
  // ==========================================================================

  function buildStats(diff) {
    const s = el('div', 'bb-hm-stats');

    const info = el('span', 'bb-hm-stats__item', {
      text:
        'Changed: ' +
        diff.changed.toLocaleString() +
        ' / ' +
        diff.total.toLocaleString() +
        ' pixels',
    });
    s.appendChild(info);

    const pct = el('span', 'bb-hm-stats__pct', { text: diff.pct + '%' });
    s.appendChild(pct);

    return s;
  }

  // ==========================================================================
  // Slider view
  // ==========================================================================

  function buildSlider(bUrl, aUrl, w, h) {
    const wrap = el('div', 'bb-hm-slider', {
      style: { maxWidth: w + 'px', aspectRatio: w + '/' + h },
    });

    // After image (full background)
    const aImg = el('img', 'bb-hm-slider__img', { src: aUrl, draggable: 'false' });
    wrap.appendChild(aImg);
    const aLabel = el('span', 'bb-hm-slider__label bb-hm-slider__label--after', {
      text: 'After',
    });
    wrap.appendChild(aLabel);

    // Before image (clipped)
    const bWrap = el('div', 'bb-hm-slider__before');
    const bImg = el('img', 'bb-hm-slider__img', { src: bUrl, draggable: 'false' });
    bWrap.appendChild(bImg);
    const bLabel = el('span', 'bb-hm-slider__label bb-hm-slider__label--before', {
      text: 'Before',
    });
    bWrap.appendChild(bLabel);
    wrap.appendChild(bWrap);

    // Handle
    const handle = el('div', 'bb-hm-slider__handle');
    const grip = el('div', 'bb-hm-slider__grip');
    grip.textContent = '\u25C2 \u25B8';
    handle.appendChild(grip);
    wrap.appendChild(handle);

    // Position state
    let pos = 50;
    const update = () => {
      bWrap.style.clipPath = 'inset(0 ' + (100 - pos) + '% 0 0)';
      handle.style.left = pos + '%';
    };
    update();

    // Drag logic
    let dragging = false;

    function onStart(e) {
      e.preventDefault();
      dragging = true;
      wrap.classList.add('bb-hm-slider--active');
    }

    function onMove(e) {
      if (!dragging) return;
      const rect = wrap.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      pos = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
      update();
    }

    function onEnd() {
      if (!dragging) return;
      dragging = false;
      wrap.classList.remove('bb-hm-slider--active');
    }

    handle.addEventListener('mousedown', onStart);
    handle.addEventListener('touchstart', onStart, { passive: false });
    wrap.addEventListener('mousedown', (e) => {
      if (handle.contains(e.target)) return;
      onStart(e);
      onMove(e);
    });
    document.addEventListener('mousemove', onMove);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('mouseup', onEnd);
    document.addEventListener('touchend', onEnd);

    return wrap;
  }

  // ==========================================================================
  // Heatmap view
  // ==========================================================================

  function buildHeatmapView(aUrl, hmCanvas, w, h) {
    const wrap = el('div', 'bb-hm-view', { style: { maxWidth: w + 'px' } });

    const base = el('img', 'bb-hm-view__base', { src: aUrl, draggable: 'false' });
    wrap.appendChild(base);

    const overlay = document.createElement('canvas');
    overlay.className = 'bb-hm-view__overlay';
    overlay.width = hmCanvas.width;
    overlay.height = hmCanvas.height;
    overlay.getContext('2d').drawImage(hmCanvas, 0, 0);
    overlay.style.opacity = '0.7';
    wrap.appendChild(overlay);

    // Opacity control
    const ctrl = el('div', 'bb-hm-controls');
    const lbl = el('span', 'bb-hm-controls__text', { text: 'Overlay opacity' });
    ctrl.appendChild(lbl);
    const range = el('input', 'bb-hm-controls__range');
    range.type = 'range';
    range.min = '0';
    range.max = '100';
    range.value = '70';
    range.addEventListener('input', () => {
      overlay.style.opacity = String(range.value / 100);
    });
    ctrl.appendChild(range);
    wrap.appendChild(ctrl);

    // Color legend
    const legend = el('div', 'bb-hm-legend');
    const lo = el('span', 'bb-hm-legend__label', { text: 'Low diff' });
    const bar = el('div', 'bb-hm-legend__bar');
    const hi = el('span', 'bb-hm-legend__label', { text: 'High diff' });
    legend.appendChild(lo);
    legend.appendChild(bar);
    legend.appendChild(hi);
    wrap.appendChild(legend);

    return wrap;
  }

  // ==========================================================================
  // Diff-only view
  // ==========================================================================

  function buildDiffView(dCanvas, w) {
    const wrap = el('div', 'bb-hm-view bb-hm-view--dark', {
      style: { maxWidth: w + 'px' },
    });
    const c = document.createElement('canvas');
    c.className = 'bb-hm-view__base';
    c.width = dCanvas.width;
    c.height = dCanvas.height;
    c.getContext('2d').drawImage(dCanvas, 0, 0);
    wrap.appendChild(c);
    return wrap;
  }

  // ==========================================================================
  // Main: detect and enhance image diff pairs
  // ==========================================================================

  function isValidPair(container) {
    const diffs = container.querySelectorAll('[data-testid="image-diff"]');
    if (diffs.length !== 2) return null;
    const bImg = diffs[0].querySelector('img');
    const aImg = diffs[1].querySelector('img');
    if (!bImg || !aImg) return null;
    const parent = diffs[0].parentElement;
    if (parent !== diffs[1].parentElement) return null;
    return { parent, before: diffs[0], after: diffs[1], srcs: bImg.src + '\n' + aImg.src };
  }

  function removeInjection(container) {
    // Restore visibility of the image pair wrapper (hidden when in heatmap/slider/diff mode)
    for (const child of container.children) {
      if (child.classList.contains('bb-hm-toolbar') || child.classList.contains('bb-hm-container')) continue;
      if (child.style.display === 'none') child.style.display = '';
    }
    container.querySelectorAll('.bb-hm-toolbar, .bb-hm-container').forEach(e => e.remove());
    container.removeAttribute(PROCESSED);
    container.removeAttribute(SRCS_ATTR);
  }

  function cleanup() {
    const processed = document.querySelectorAll(
      '[data-qa="bk-file__content"][' + PROCESSED + ']'
    );
    for (const container of processed) {
      const pair = isValidPair(container);

      if (!pair) {
        // No longer a valid before/after pair (navigated to added/deleted file)
        removeInjection(container);
        continue;
      }

      // Check if images changed (navigated to a different file with before/after)
      const stored = container.getAttribute(SRCS_ATTR);
      if (stored !== pair.srcs) {
        removeInjection(container);
      }
    }
  }

  function scan() {
    cleanup();

    const containers = document.querySelectorAll('[data-qa="bk-file__content"]');

    for (const container of containers) {
      if (container.hasAttribute(PROCESSED)) continue;

      const pair = isValidPair(container);
      container.setAttribute(PROCESSED, '1');
      if (!pair) continue;

      container.setAttribute(SRCS_ATTR, pair.srcs);
      enhance(container, pair.parent, pair.before, pair.after);
    }
  }

  async function enhance(target, originalParent, beforeEl, afterEl) {
    const bImgEl = beforeEl.querySelector('img');
    const aImgEl = afterEl.querySelector('img');
    if (!bImgEl || !aImgEl) return;

    const bSrc = bImgEl.src;
    const aSrc = aImgEl.src;

    let loaded = false;
    const views = {};

    const container = el('div', 'bb-hm-container');
    container.style.display = 'none';

    const loading = el('div', 'bb-hm-loading', { text: 'Generating heatmap\u2026' });
    container.appendChild(loading);

    async function switchMode(mode) {
      if (mode === 'normal') {
        originalParent.style.display = '';
        container.style.display = 'none';
        return;
      }

      originalParent.style.display = 'none';
      container.style.display = '';

      if (!loaded) {
        loading.style.display = '';
        try {
          const [bData, aData] = await Promise.all([
            fetchImageData(bSrc),
            fetchImageData(aSrc),
          ]);

          const diff = computeDiff(bData.bitmap, aData.bitmap);
          const hm = renderHeatmap(diff);
          const df = renderDiffOnly(diff);

          views.stats = buildStats(diff);
          views.slider = buildSlider(bData.displayUrl, aData.displayUrl, diff.width, diff.height);
          views.heatmap = buildHeatmapView(aData.displayUrl, hm, diff.width, diff.height);
          views.diff = buildDiffView(df, diff.width);

          container.appendChild(views.stats);
          container.appendChild(views.slider);
          container.appendChild(views.heatmap);
          container.appendChild(views.diff);

          loaded = true;
          loading.style.display = 'none';
        } catch (err) {
          loading.textContent = 'Error loading images: ' + err.message;
          console.error('[BB Heatmap]', err);
          return;
        }
      }

      views.slider.style.display = mode === 'slider' ? '' : 'none';
      views.heatmap.style.display = mode === 'heatmap' ? '' : 'none';
      views.diff.style.display = mode === 'diff' ? '' : 'none';
    }

    const toolbar = buildToolbar(switchMode);
    originalParent.before(toolbar);
    originalParent.after(container);
  }

  // ==========================================================================
  // Initialization with MutationObserver for SPA navigation
  // ==========================================================================

  function init() {
    scan();

    let timer;
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(scan, 300);
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
