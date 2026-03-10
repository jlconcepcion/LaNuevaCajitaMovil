/* ============================================================
   CONFIG
============================================================ */
const CONFIG = {
    churchId: 141,
    apiBase: 'https://tvappbuilder.com/API/V1/embed',
    pageSize: 12,           // ítems por petición API por categoría
    carouselInterval: 6000, // ms
};

/* ============================================================
   STATE
============================================================ */
let allCategories = [];
let activeCatId = 'all';
let currentSort = 'newest';
let searchQuery = '';
let fetchOffset = 0;     // offset actual (para el próximo fetch)
let feedHasMore = false; // ¿quedan más ítems en la API?
let isFetchingMore = false; // bloquea doble-click en "Cargar más"
let hlsInstance = null;

// Carousel state
let carouselSlides = [];
let carouselIndex = 0;
let carouselTimer = null;

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

/** Normaliza barras invertidas escapadas en URLs de la API */
function cleanUrl(url) {
    return url ? url.replace(/\\/g, '/') : '';
}

/* ============================================================
   FETCH
============================================================ */
async function fetchFeed(sort = 'newest', offset = 0) {
    const url = `${CONFIG.apiBase}/feed.php?church=${CONFIG.churchId}` +
        `&limit=${CONFIG.pageSize}&include_live=true&sort=${sort}&offset=${offset}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('API error ' + res.status);
    return res.json();
}

async function fetchSearch(q) {
    const url = `${CONFIG.apiBase}/search.php?church=${CONFIG.churchId}&q=${encodeURIComponent(q)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Search error ' + res.status);
    return res.json();
}

async function fetchEpisodes(seriesId) {
    const url = `${CONFIG.apiBase}/episodes.php?series_id=${seriesId}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Episodes error ' + res.status);
    return res.json();
}

/* ============================================================
   PAGINATION — fusionar página nueva sin duplicados
============================================================ */
/**
 * Fusiona las categorías de una nueva página en allCategories.
 * Actualiza has_more por categoría para saber si hay más.
 * @returns {boolean} true si al menos una categoría tiene has_more = true
 */
function mergeCategories(newCats) {
    let anyHasMore = false;

    for (const newCat of newCats) {
        if (newCat.has_more) anyHasMore = true;

        const existing = allCategories.find(c => c.id === newCat.id);
        if (existing) {
            // Agrega solo los ítems que aún no están
            const seenIds = new Set(existing.content.map(i => i.id));
            for (const item of newCat.content) {
                if (!seenIds.has(item.id)) {
                    existing.content.push(item);
                    seenIds.add(item.id);
                }
            }
            existing.has_more = newCat.has_more;
            existing.total = newCat.total;
        }
    }
    return anyHasMore;
}

/**
 * Comprueba si alguna categoría visible aún tiene más ítems en la API.
 */
function computeFeedHasMore() {
    if (activeCatId === 'all') {
        return allCategories.some(c => c.has_more);
    }
    const cat = allCategories.find(c => c.id === activeCatId);
    return cat ? cat.has_more : false;
}

/* ============================================================
   SPLASH SCREEN
============================================================ */
function hideSplash() {
    const splash = $('splash-screen');
    if (!splash) return;
    // Esperar un mínimo de 1.2 s para que el logo sea visible
    const MIN_DISPLAY = 1200;
    const elapsed = performance.now();
    const delay = Math.max(0, MIN_DISPLAY - elapsed);
    setTimeout(() => splash.classList.add('hidden'), delay);
}

/* ============================================================
   INIT
============================================================ */
async function init() {
    showGridLoading();
    try {
        const data = await fetchFeed(currentSort, 0);

        // Brand color / nombre
        if (data.branding?.brand_color) {
            document.documentElement.style.setProperty('--brand', data.branding.brand_color);
        }
        if (data.branding?.church_name) {
            const logoImg = $('church-name-nav');
            if (logoImg) logoImg.alt = data.branding.church_name;
            document.title = data.branding.church_name;
        }

        allCategories = data.categories || [];
        fetchOffset = CONFIG.pageSize;            // próximo offset
        feedHasMore = allCategories.some(c => c.has_more);

        // Carousel: primer ítem con thumbnail de cada categoría
        carouselSlides = [];
        for (const cat of allCategories) {
            const item = cat.content.find(c => c.thumbnail);
            if (item) carouselSlides.push({ item, catName: cat.name });
        }
        buildCarousel();
        buildTabs();
        renderGrid();

    } catch (e) {
        $('content-grid').innerHTML =
            `<div class="state-msg">⚠️ Error al cargar contenido. Intenta refrescar la página.</div>`;
        console.error(e);
    } finally {
        hideSplash(); // ocultar splash siempre, con o sin error
    }
}

/* ============================================================
   LOAD MORE — paginación real via API
============================================================ */
async function loadMoreFromAPI() {
    if (isFetchingMore || !feedHasMore) return;
    isFetchingMore = true;
    showLoadMoreSpinner(true);

    try {
        const data = await fetchFeed(currentSort, fetchOffset);
        const newCats = data.categories || [];

        mergeCategories(newCats);
        fetchOffset += CONFIG.pageSize;
        feedHasMore = computeFeedHasMore();

        renderGrid();
    } catch (e) {
        console.error('Error cargando más contenido:', e);
    } finally {
        isFetchingMore = false;
        showLoadMoreSpinner(false);
    }
}

function showLoadMoreSpinner(show) {
    const btn = $('load-more-btn');
    if (!btn) return;
    btn.disabled = show;
    btn.textContent = show ? 'Cargando…' : 'Cargar más';
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

        // Dot
        const dot = document.createElement('button');
        dot.className = 'carousel-dot' + (i === 0 ? ' active' : '');
        dot.setAttribute('aria-label', `Slide ${i + 1}: ${item.title}`);
        dot.addEventListener('click', () => goToSlide(i));
        dots.appendChild(dot);

        // Thumb (solo si hay pocos slides)
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
    carouselTimer = setInterval(() => goToSlide(carouselIndex + 1), CONFIG.carouselInterval);
}

function resetProgressBar() {
    const bar = $('carousel-progress');
    bar.style.transition = 'none';
    bar.style.width = '0%';
    bar.offsetWidth; // force reflow
    bar.style.transition = `width ${CONFIG.carouselInterval}ms linear`;
    bar.style.width = '100%';
}

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
            document.querySelectorAll('.tab-btn').forEach(b => {
                b.classList.toggle('active', b === btn);
                b.setAttribute('aria-selected', b === btn);
            });
            feedHasMore = computeFeedHasMore();
            renderGrid();
        });
        container.appendChild(btn);
    });
}

/* ============================================================
   GRID
============================================================ */
function getVisibleItems() {
    if (searchQuery) return [];

    let items = [];
    if (activeCatId === 'all') {
        const seen = new Set();
        for (const cat of allCategories) {
            for (const item of cat.content) {
                if (!seen.has(item.id)) { seen.add(item.id); items.push(item); }
            }
        }
    } else {
        const cat = allCategories.find(c => c.id === activeCatId);
        if (cat) items = [...cat.content];
    }

    if (currentSort === 'a-z') items.sort((a, b) => a.title.localeCompare(b.title));
    else if (currentSort === 'z-a') items.sort((a, b) => b.title.localeCompare(a.title));

    return items;
}

function getCategoryName() {
    if (activeCatId === 'all') return 'Todo el contenido';
    return allCategories.find(c => c.id === activeCatId)?.name ?? 'Contenido';
}

function renderGrid(searchResults) {
    const grid = $('content-grid');
    const heading = $('section-heading');
    const lmWrap = $('load-more-wrap');

    const items = searchResults ?? getVisibleItems();

    // Heading
    if (searchQuery) {
        heading.textContent = searchResults !== undefined
            ? `Resultados para "${searchQuery}" (${items.length})`
            : `Buscando "${searchQuery}"…`;
    } else {
        heading.textContent = getCategoryName();
    }

    if (!items.length) {
        grid.innerHTML = `<div class="state-msg">Sin resultados.</div>`;
        lmWrap.style.display = 'none';
        return;
    }

    grid.innerHTML = items.map(item => cardHTML(item)).join('');

    grid.querySelectorAll('.card').forEach(card => {
        const handler = () => {
            const id = card.dataset.id;
            const item = items.find(i => i.id === id);
            if (item) openModal(item);
        };
        card.addEventListener('click', handler);
        card.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); }
        });
    });

    // "Cargar más" solo si la API tiene más ítems (no para búsqueda)
    if (searchResults !== undefined) {
        lmWrap.style.display = 'none';
    } else {
        lmWrap.style.display = feedHasMore ? 'block' : 'none';
    }
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
   PLAYER (funciones auxiliares compartidas)
============================================================ */
function attachHlsOrNative(videoEl, url) {
    if (Hls.isSupported()) {
        hlsInstance = new Hls();
        hlsInstance.loadSource(url);
        hlsInstance.attachMedia(videoEl);
        hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => videoEl.play().catch(() => { }));
    } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
        videoEl.src = url;
        videoEl.play().catch(() => { });
    } else {
        videoEl.parentElement.innerHTML =
            `<div class="state-msg">Tu navegador no soporta HLS.</div>`;
    }
}

function playInPlayer(container, ep) {
    container.innerHTML = '';
    if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }

    if (ep.embed_url) {
        container.innerHTML = `<iframe src="${ep.embed_url}" allowfullscreen allow="autoplay; encrypted-media; picture-in-picture"></iframe>`;
        return;
    }

    const streamSrc = cleanUrl(ep.stream_url);
    const fileSrc = cleanUrl(ep.file_url);
    const src = streamSrc || fileSrc;

    if (src) {
        const vid = document.createElement('video');
        vid.controls = true; vid.autoplay = true; vid.playsInline = true;
        container.appendChild(vid);
        if (src.includes('.m3u8') || ep.stream_url) {
            attachHlsOrNative(vid, src);
        } else {
            container.innerHTML = `<iframe src="${src}" allowfullscreen allow="autoplay"></iframe>`;
        }
        return;
    }

    container.innerHTML = `
  <div style="display:flex;align-items:center;justify-content:center;background:var(--bg3);position:absolute;inset:0;color:var(--muted);">
    No hay reproductor disponible para este contenido.
  </div>`;
}

/* ============================================================
   MODAL / PLAYER
============================================================ */
function openModal(item) {
    const overlay = $('modal-overlay');
    const player = $('modal-player');
    const epSec = $('episodes-section');

    const titleEl = $('modal-title');
    if (titleEl) titleEl.textContent = item.title || '';

    const descEl = $('modal-title');
    if (descEl) descEl.textContent = item.description || '';

    player.innerHTML = '';
    epSec.style.display = 'none';
    epSec.classList.remove('episodes-open');
    $('episodes-list').innerHTML = '';
    if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }

    if (item.is_series) {
        player.innerHTML = `
  <div style="display:flex;align-items:center;justify-content:center;background:var(--bg3);position:absolute;inset:0;">
    <img src="${item.thumbnail}" alt="${esc(item.title)}" style="max-height:100%;max-width:100%;object-fit:contain;opacity:.4" />
    <span style="position:absolute;color:var(--muted);font-size:.9rem">Selecciona un episodio ↓</span>
  </div>`;
        loadEpisodes(item.id);
    } else {
        playInPlayer(player, item);
    }

    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
}

async function attemptFullscreenAndLandscape(element) {
    try {
        if (element.requestFullscreen) {
            await element.requestFullscreen();
        } else if (element.webkitRequestFullscreen) {
            await element.webkitRequestFullscreen();
        } else if (element.msRequestFullscreen) {
            await element.msRequestFullscreen();
        }
        
        // Attempt to lock orientation to landscape
        if (screen.orientation && screen.orientation.lock) {
            await screen.orientation.lock('landscape').catch(() => {});
        }
    } catch (e) {
        console.warn('Fullscreen/Orientation request failed', e);
    }
}

async function loadEpisodes(seriesId) {
    const epSec = $('episodes-section');
    const epList = $('episodes-list');
    epSec.style.display = 'block';
    epSec.classList.add('episodes-open');
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
       data-title="${esc(ep.title || '')}" data-thumb="${esc(ep.thumbnail || '')}"
       data-desc="${esc(ep.description || '')}">
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
            const handler = () => {
                const ep = {
                    title: el.dataset.title,
                    embed_url: el.dataset.embed,
                    file_url: el.dataset.file,
                    stream_url: el.dataset.stream,
                    thumbnail: el.dataset.thumb,
                };
                const titleEl = $('modal-title');
                if (titleEl) titleEl.textContent = ep.title;

                const descEl = $('modal-desc');
                if (descEl) descEl.textContent = el.dataset.desc || '';
                playInPlayer($('modal-player'), ep);
                $('modal-overlay').scrollTop = 0;
            };
            el.addEventListener('click', handler);
            el.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); }
            });
        });

        epList.querySelector('.ep-item')?.click();

    } catch (e) {
        epList.innerHTML = `<div class="ep-loading">Error al cargar episodios.</div>`;
        console.error(e);
    }
}

function closeModal() {
    $('modal-overlay').classList.remove('open');
    document.body.style.overflow = '';
    
    // Exit fullscreen and unlock orientation if active
    try {
        if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
        } else if (document.webkitFullscreenElement) {
            document.webkitExitFullscreen().catch(() => {});
        }
        if (screen.orientation && screen.orientation.unlock) {
            screen.orientation.unlock();
        }
    } catch (e) {}

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

    if (!searchQuery) {
        feedHasMore = computeFeedHasMore();
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
   SORT (re-fetch desde cero)
============================================================ */
async function onSortChange(sort) {
    currentSort = sort;
    fetchOffset = 0;
    feedHasMore = false;
    showGridLoading();
    try {
        const data = await fetchFeed(sort, 0);
        allCategories = data.categories || [];
        fetchOffset = CONFIG.pageSize;
        feedHasMore = allCategories.some(c => c.has_more);

        buildTabs();
        renderGrid();
    } catch (e) {
        $('content-grid').innerHTML = `<div class="state-msg">Error al cambiar orden.</div>`;
    }
}

/* ============================================================
   EVENTS — dentro de DOMContentLoaded para seguridad
============================================================ */
document.addEventListener('DOMContentLoaded', () => {

    // Carousel arrows
    $('carousel-prev').addEventListener('click', () => { goToSlide(carouselIndex - 1); startCarouselTimer(); });
    $('carousel-next').addEventListener('click', () => { goToSlide(carouselIndex + 1); startCarouselTimer(); });

    // Pausa al hacer hover
    $('hero-carousel').addEventListener('mouseenter', () => {
        clearInterval(carouselTimer);
        $('carousel-progress').style.transition = 'none';
    });
    $('hero-carousel').addEventListener('mouseleave', () => startCarouselTimer());

    // Swipe táctil — touchStartX en scope local
    let touchStartX = 0;
    $('hero-carousel').addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; }, { passive: true });
    $('hero-carousel').addEventListener('touchend', e => {
        const dx = e.changedTouches[0].clientX - touchStartX;
        if (Math.abs(dx) > 40) { goToSlide(carouselIndex + (dx < 0 ? 1 : -1)); startCarouselTimer(); }
    }, { passive: true });

    // Búsqueda, orden y modal
    $('search-input').addEventListener('input', e => doSearch(e.target.value));
    $('sort-select').addEventListener('change', e => onSortChange(e.target.value));
    $('modal-close').addEventListener('click', closeModal);
    $('modal-overlay').addEventListener('click', e => { if (e.target === $('modal-overlay')) closeModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
    
    // Double click to toggle fullscreen on video
    $('modal-player').addEventListener('dblclick', () => {
        if (!document.fullscreenElement && !document.webkitFullscreenElement) {
            attemptFullscreenAndLandscape($('modal-player'));
        } else {
            if (document.exitFullscreen) document.exitFullscreen();
            else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
            if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock();
        }
    });

    // Handle orientation lock when entering or exiting fullscreen
    const handleFullscreenChange = () => {
        if (document.fullscreenElement || document.webkitFullscreenElement) {
            if (window.innerWidth <= 720 && screen.orientation && screen.orientation.lock) {
                screen.orientation.lock('landscape').catch(() => {});
            }
        } else {
            if (screen.orientation && screen.orientation.unlock) {
                screen.orientation.unlock();
            }
        }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

    // Cargar más — paginación real con API
    $('load-more-btn').addEventListener('click', loadMoreFromAPI);

    // START
    init();
});
