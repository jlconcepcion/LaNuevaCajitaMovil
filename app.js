/* ============================================================
   CONFIG
============================================================ */
const CHURCH_ID = 141;
const API_BASE = 'https://tvappbuilder.com/API/V1/embed';
const PAGE_SIZE = 12;

/* ============================================================
   STATE
============================================================ */
let allCategories = [];
let activeCatId = 'all';
let currentSort = 'newest';
let searchQuery = '';
let displayedCount = PAGE_SIZE;
let hlsInstance = null;

// Carousel state
let carouselSlides = []; // [{item, catName}]
let carouselIndex = 0;
let carouselTimer = null;
const CAROUSEL_INTERVAL = 6000; // ms

/* ============================================================
   UTILITIES
============================================================ */
const $ = id => document.getElementById(id);

function formatDuration(sec) {
    if (!sec) return '';
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h
        ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
        : `${m}:${String(s).padStart(2, '0')}`;
}

function esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

function debounce(fn, ms) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/* ============================================================
   FETCH
============================================================ */
async function fetchFeed(sort = 'newest') {
    const url = `${API_BASE}/feed.php?church=${CHURCH_ID}&limit=100&include_live=true&sort=${sort}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('API error ' + res.status);
    return res.json();
}

async function fetchSearch(q) {
    const url = `${API_BASE}/search.php?church=${CHURCH_ID}&q=${encodeURIComponent(q)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Search error ' + res.status);
    return res.json();
}

async function fetchEpisodes(seriesId) {
    const url = `${API_BASE}/episodes.php?series_id=${seriesId}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Episodes error ' + res.status);
    return res.json();
}

/* ============================================================
   INIT
============================================================ */
async function init() {
    showGridLoading();
    try {
        const data = await fetchFeed(currentSort);

        // Brand color
        if (data.branding?.brand_color) {
            document.documentElement.style.setProperty('--brand', data.branding.brand_color);
        }
        if (data.branding?.church_name) {
            const logoImg = $('church-name-nav');
            if (logoImg) logoImg.alt = data.branding.church_name;
            document.title = data.branding.church_name;
        }

        allCategories = data.categories || [];

        // Build carousel: most recent item from each category
        carouselSlides = [];
        for (const cat of allCategories) {
            const item = cat.content.find(c => c.thumbnail);
            if (item) carouselSlides.push({ item, catName: cat.name });
        }
        buildCarousel();

        buildTabs();
        renderGrid();

    } catch (e) {
        $('content-grid').innerHTML = `<div class="state-msg">⚠️ Error al cargar contenido. Intenta refrescar la página.</div>`;
        console.error(e);
    }
}

/* ============================================================
   CAROUSEL
============================================================ */
function buildCarousel() {
    if (!carouselSlides.length) return;

    const track = $('carousel-track');
    const dots = $('carousel-dots');
    const thumbs = $('carousel-thumbs');
    track.innerHTML = '';
    dots.innerHTML = '';
    thumbs.innerHTML = '';

    carouselSlides.forEach(({ item, catName }, i) => {
        // ── Slide ──────────────────────────────────────────────
        const slide = document.createElement('div');
        slide.className = 'carousel-slide' + (i === 0 ? ' active' : '');

        const isLive = item.type === 'live_feed';
        const badgeClass = isLive ? 'carousel-cat-badge live-badge' : 'carousel-cat-badge';
        const badgeText = isLive ? 'EN VIVO' : catName;

        slide.innerHTML = `
            <img class="carousel-slide-bg" src="${esc(item.thumbnail)}" alt="" loading="${i === 0 ? 'eager' : 'lazy'}" />
            <div class="carousel-content">
                <span class="${badgeClass}">${esc(badgeText)}</span>
                <h2 class="carousel-title">${esc(item.title)}</h2>
                <p class="carousel-desc">${esc(item.description || '')}</p>
                <button class="carousel-play-btn">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    Ver ahora
                </button>
            </div>`;

        slide.querySelector('.carousel-play-btn').addEventListener('click', () => openModal(item));
        track.appendChild(slide);

        // ── Dot ──────────────────────────────────────────────
        const dot = document.createElement('button');
        dot.className = 'carousel-dot' + (i === 0 ? ' active' : '');
        dot.setAttribute('aria-label', `Slide ${i + 1}: ${item.title}`);
        dot.addEventListener('click', () => goToSlide(i));
        dots.appendChild(dot);

        // ── Thumb ─────────────────────────────────────────────
        if (carouselSlides.length <= 8) {
            const thumb = document.createElement('div');
            thumb.className = 'carousel-thumb' + (i === 0 ? ' active' : '');
            thumb.innerHTML = `<img src="${esc(item.thumbnail)}" alt="${esc(item.title)}" loading="lazy" />`;
            thumb.addEventListener('click', () => goToSlide(i));
            thumbs.appendChild(thumb);
        }
    });

    startCarouselTimer();
}

function goToSlide(idx) {
    const slides = document.querySelectorAll('.carousel-slide');
    const dots = document.querySelectorAll('.carousel-dot');
    const thumbs = document.querySelectorAll('.carousel-thumb');

    slides[carouselIndex]?.classList.remove('active');
    dots[carouselIndex]?.classList.remove('active');
    thumbs[carouselIndex]?.classList.remove('active');

    carouselIndex = (idx + carouselSlides.length) % carouselSlides.length;

    slides[carouselIndex]?.classList.add('active');
    dots[carouselIndex]?.classList.add('active');
    thumbs[carouselIndex]?.classList.add('active');

    $('carousel-track').style.transform = `translateX(-${carouselIndex * 100}%)`;
    resetProgressBar();
}

function startCarouselTimer() {
    clearInterval(carouselTimer);
    resetProgressBar();
    carouselTimer = setInterval(() => goToSlide(carouselIndex + 1), CAROUSEL_INTERVAL);
}

function resetProgressBar() {
    const bar = $('carousel-progress');
    bar.style.transition = 'none';
    bar.style.width = '0%';
    bar.offsetWidth; // force reflow
    bar.style.transition = `width ${CAROUSEL_INTERVAL}ms linear`;
    bar.style.width = '100%';
}

// Arrow controls
$('carousel-prev').addEventListener('click', () => { goToSlide(carouselIndex - 1); startCarouselTimer(); });
$('carousel-next').addEventListener('click', () => { goToSlide(carouselIndex + 1); startCarouselTimer(); });

// Pause on hover
$('hero-carousel').addEventListener('mouseenter', () => {
    clearInterval(carouselTimer);
    const bar = $('carousel-progress');
    bar.style.transition = 'none';
});
$('hero-carousel').addEventListener('mouseleave', () => startCarouselTimer());

// Swipe support (touch)
let touchStartX = 0;
$('hero-carousel').addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; }, { passive: true });
$('hero-carousel').addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 40) { goToSlide(carouselIndex + (dx < 0 ? 1 : -1)); startCarouselTimer(); }
}, { passive: true });

/* ============================================================
   TABS
============================================================ */
function buildTabs() {
    const container = $('category-tabs');
    container.innerHTML = '';

    const ALL = { id: 'all', name: 'Todo' };
    [ALL, ...allCategories].forEach(cat => {
        const btn = document.createElement('button');
        btn.className = 'tab-btn' + (cat.id === activeCatId ? ' active' : '');
        btn.textContent = cat.name;
        btn.setAttribute('role', 'tab');
        btn.setAttribute('aria-selected', cat.id === activeCatId);
        btn.addEventListener('click', () => {
            activeCatId = cat.id;
            displayedCount = PAGE_SIZE;
            document.querySelectorAll('.tab-btn').forEach(b => {
                b.classList.toggle('active', b === btn);
                b.setAttribute('aria-selected', b === btn);
            });
            renderGrid();
        });
        container.appendChild(btn);
    });
}

/* ============================================================
   GRID
============================================================ */
function getVisibleItems() {
    let items = [];

    if (searchQuery) return []; // handled separately

    if (activeCatId === 'all') {
        const seen = new Set();
        for (const cat of allCategories) {
            for (const item of cat.content) {
                if (!seen.has(item.id)) { seen.add(item.id); items.push(item); }
            }
        }
    } else {
        const cat = allCategories.find(c => c.id === activeCatId);
        if (cat) items = cat.content;
    }

    items = [...items];
    if (currentSort === 'a-z') items.sort((a, b) => a.title.localeCompare(b.title));
    else if (currentSort === 'z-a') items.sort((a, b) => b.title.localeCompare(a.title));

    return items;
}

function renderGrid(searchResults) {
    const grid = $('content-grid');
    const heading = $('section-heading');
    const lmWrap = $('load-more-wrap');

    const items = searchResults ?? getVisibleItems();
    const slice = items.slice(0, displayedCount);

    if (searchResults !== undefined) {
        heading.textContent = searchQuery
            ? `Resultados para "${searchQuery}" (${items.length})`
            : activeCatId === 'all' ? 'Todo el contenido'
                : (allCategories.find(c => c.id === activeCatId)?.name ?? 'Contenido');
    } else {
        heading.textContent = activeCatId === 'all' ? 'Todo el contenido'
            : (allCategories.find(c => c.id === activeCatId)?.name ?? 'Contenido');
    }

    if (!items.length) {
        grid.innerHTML = `<div class="state-msg">Sin resultados.</div>`;
        lmWrap.style.display = 'none';
        return;
    }

    grid.innerHTML = slice.map(item => cardHTML(item)).join('');

    grid.querySelectorAll('.card').forEach(card => {
        card.addEventListener('click', () => {
            const id = card.dataset.id;
            const item = items.find(i => i.id === id);
            if (item) openModal(item);
        });
    });

    lmWrap.style.display = displayedCount < items.length ? 'block' : 'none';
}

function cardHTML(item) {
    const isLive = item.type === 'live_feed';
    const isSeries = item.is_series;
    const dur = formatDuration(item.duration);

    let badge = '';
    if (isLive) badge = `<span class="badge badge-live">EN VIVO</span>`;
    if (isSeries) badge = `<span class="badge badge-series">SERIE</span>`;

    const epCount = isSeries && item.episode_count
        ? `<span class="ep-count">${item.episode_count} ep.</span>` : '';

    return `
<article class="card" data-id="${esc(item.id)}" tabindex="0" role="button" aria-label="${esc(item.title)}">
  <div class="card-thumb">
    <img src="${esc(item.thumbnail)}" alt="${esc(item.title)}" loading="lazy"
         onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 640 360%22><rect width=%22640%22 height=%22360%22 fill=%22%231a1a2e%22/><text x=%2250%%25%22 y=%2250%%25%22 fill=%22%238585aa%22 font-size=%2248%22 text-anchor=%22middle%22 dominant-baseline=%22middle%22>📺</text></svg>'" />
    ${badge}${epCount}
    <div class="play-overlay">
      <div class="play-circle">
        <svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
      </div>
    </div>
  </div>
  <div class="card-info">
    <div class="card-title">${esc(item.title)}</div>
    <div class="card-meta">${dur ? dur : (isSeries ? 'Serie' : isLive ? 'En Vivo' : 'Video')}</div>
  </div>
</article>`;
}

function showGridLoading() {
    $('content-grid').innerHTML = `
<div class="state-msg" style="grid-column:1/-1">
  <div class="spinner"></div>
  Cargando contenido…
</div>`;
}

/* ============================================================
   MODAL / PLAYER
============================================================ */
function openModal(item) {
    const overlay = $('modal-overlay');
    const player = $('modal-player');
    const epSec = $('episodes-section');

    $('modal-title').textContent = item.title || '';
    $('modal-desc').textContent = item.description || '';

    player.innerHTML = '';
    epSec.style.display = 'none';
    $('episodes-list').innerHTML = '';
    if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }

    if (item.embed_url) {
        player.innerHTML = `<iframe src="${item.embed_url}" allowfullscreen allow="autoplay; encrypted-media; picture-in-picture"></iframe>`;
    } else if (item.stream_url) {
        const streamUrl = item.stream_url.replace(/\\\\/g, '/');
        const vid = document.createElement('video');
        vid.controls = true; vid.autoplay = true; vid.playsInline = true;
        player.appendChild(vid);

        if (Hls.isSupported()) {
            hlsInstance = new Hls();
            hlsInstance.loadSource(streamUrl);
            hlsInstance.attachMedia(vid);
            hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => vid.play().catch(() => {}));
        } else if (vid.canPlayType('application/vnd.apple.mpegurl')) {
            vid.src = streamUrl;
            vid.play().catch(() => {});
        } else {
            player.innerHTML = `<div class="state-msg">Tu navegador no soporta HLS.</div>`;
        }
    } else if (item.is_series) {
        player.innerHTML = `
  <div style="display:flex;align-items:center;justify-content:center;background:var(--bg3);position:absolute;inset:0;">
    <img src="${item.thumbnail}" alt="${esc(item.title)}" style="max-height:100%;max-width:100%;object-fit:contain;opacity:.4" />
    <span style="position:absolute;color:var(--muted);font-size:.9rem">Selecciona un episodio ↓</span>
  </div>`;
        loadEpisodes(item.id);
    } else if (item.file_url) {
        const cleanUrl = item.file_url.replace(/\\\\/g, '/');
        if (cleanUrl.includes('.m3u8')) {
            const vid = document.createElement('video');
            vid.controls = true; vid.autoplay = true; vid.playsInline = true;
            player.appendChild(vid);
            if (Hls.isSupported()) {
                hlsInstance = new Hls();
                hlsInstance.loadSource(cleanUrl);
                hlsInstance.attachMedia(vid);
                hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => vid.play().catch(() => {}));
            } else if (vid.canPlayType('application/vnd.apple.mpegurl')) {
                vid.src = cleanUrl; vid.play().catch(() => {});
            }
        } else {
            player.innerHTML = `<iframe src="${cleanUrl}" allowfullscreen allow="autoplay"></iframe>`;
        }
    } else {
        player.innerHTML = `
  <div style="display:flex;align-items:center;justify-content:center;background:var(--bg3);position:absolute;inset:0;color:var(--muted);">
    No hay reproductor disponible para este contenido.
  </div>`;
        if (item.is_series) loadEpisodes(item.id);
    }

    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
}

async function loadEpisodes(seriesId) {
    const epSec = $('episodes-section');
    const epList = $('episodes-list');
    epSec.style.display = 'block';
    epList.innerHTML = `<div class="ep-loading"><div class="spinner" style="width:24px;height:24px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:8px"></div>Cargando episodios…</div>`;

    try {
        const data = await fetchEpisodes(seriesId);
        const eps = data.episodes || data.content || [];
        if (!eps.length) {
            epList.innerHTML = `<div class="ep-loading">Sin episodios disponibles.</div>`;
            return;
        }
        epList.innerHTML = eps.map((ep, i) => `
  <div class="ep-item" data-embed="${esc(ep.embed_url || '')}"
       data-file="${esc(ep.file_url || '')}" data-stream="${esc(ep.stream_url || '')}"
       data-title="${esc(ep.title || '')}" data-thumb="${esc(ep.thumbnail || '')}">
    <div class="ep-thumb">
      <img src="${esc(ep.thumbnail || '')}" alt="${esc(ep.title)}" loading="lazy" onerror="this.style.opacity=0" />
    </div>
    <div class="ep-info">
      <div class="ep-num">Ep. ${i + 1}</div>
      <div class="ep-title">${esc(ep.title)}</div>
      <div class="ep-desc">${esc(ep.description || '')}</div>
    </div>
  </div>`).join('');

        epList.querySelectorAll('.ep-item').forEach(el => {
            el.addEventListener('click', () => {
                const ep = {
                    title: el.dataset.title,
                    embed_url: el.dataset.embed,
                    file_url: el.dataset.file,
                    stream_url: el.dataset.stream,
                    thumbnail: el.dataset.thumb,
                    is_series: false,
                };
                $('modal-title').textContent = ep.title;
                const player = $('modal-player');
                player.innerHTML = '';
                if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }

                if (ep.embed_url) {
                    player.innerHTML = `<iframe src="${ep.embed_url}" allowfullscreen allow="autoplay; encrypted-media; picture-in-picture"></iframe>`;
                } else if (ep.file_url) {
                    const cleanUrl = ep.file_url.replace(/\\\\/g, '/');
                    const vid2 = document.createElement('video');
                    vid2.controls = true; vid2.autoplay = true; vid2.playsInline = true;
                    player.appendChild(vid2);
                    if (Hls.isSupported()) {
                        hlsInstance = new Hls();
                        hlsInstance.loadSource(cleanUrl);
                        hlsInstance.attachMedia(vid2);
                        hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => vid2.play().catch(() => {}));
                    } else { vid2.src = cleanUrl; vid2.play().catch(() => {}); }
                }
                $('modal-overlay').scrollTop = 0;
            });
        });

        // Auto-click first episode
        epList.querySelector('.ep-item')?.click();

    } catch (e) {
        epList.innerHTML = `<div class="ep-loading">Error al cargar episodios.</div>`;
        console.error(e);
    }
}

function closeModal() {
    $('modal-overlay').classList.remove('open');
    document.body.style.overflow = '';
    setTimeout(() => {
        $('modal-player').innerHTML = '';
        if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
    }, 300);
}

/* ============================================================
   SEARCH
============================================================ */
const doSearch = debounce(async (q) => {
    searchQuery = q.trim();
    displayedCount = PAGE_SIZE;

    if (!searchQuery) {
        renderGrid();
        return;
    }
    showGridLoading();
    try {
        const data = await fetchSearch(searchQuery);
        const results = data.results || data.content || data.items || [];
        renderGrid(results);
    } catch (e) {
        $('content-grid').innerHTML = `<div class="state-msg">Error en la búsqueda.</div>`;
    }
}, 400);

/* ============================================================
   SORT (re-fetch)
============================================================ */
async function onSortChange(sort) {
    currentSort = sort;
    displayedCount = PAGE_SIZE;
    showGridLoading();
    try {
        const data = await fetchFeed(sort);
        allCategories = data.categories || [];
        buildTabs();
        renderGrid();
    } catch (e) {
        $('content-grid').innerHTML = `<div class="state-msg">Error al cambiar orden.</div>`;
    }
}

/* ============================================================
   EVENTS
============================================================ */
$('search-input').addEventListener('input', e => doSearch(e.target.value));
$('sort-select').addEventListener('change', e => onSortChange(e.target.value));
$('modal-close').addEventListener('click', closeModal);
$('modal-overlay').addEventListener('click', e => { if (e.target === $('modal-overlay')) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
$('load-more-btn').addEventListener('click', () => {
    displayedCount += PAGE_SIZE;
    if (searchQuery) {
        fetchSearch(searchQuery).then(d => renderGrid(d.results || d.content || d.items || []));
    } else {
        renderGrid();
    }
});

/* ============================================================
   START
============================================================ */
init();
