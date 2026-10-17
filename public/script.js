/* DOSTER — script.js : 사이트의 "움직임". 사진을 바꿀 때는 수정할 필요 없습니다. */
(function () {
  'use strict';
  window.dosterReady = true;

  var doc = document, root = doc.documentElement, body = doc.body;
  var reduceMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
  var desktopMQ = window.matchMedia('(min-width: 900px)');
  var reduceMotion = reduceMQ.matches;
  // CSS가 스크롤 연동(첫 화면·큰 사진 확대)을 직접 처리하는 브라우저에서는 JS가 하지 않음
  var cssScroll = !!(window.CSS && CSS.supports && CSS.supports('animation-timeline: scroll()'));
  var viewList = null;                           // 사진 뷰어 목록 캐시

  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function easeInOut(t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

  /* 1. 사진 파일이 없으면 그 자리에 파일 이름 상자 표시 */
  function showMissing(img) {
    if (!img || !img.parentNode || img.getAttribute('data-missing')) return;
    if (!img.getAttribute('src') || img.closest('#viewer') || img.classList.contains('img-guard')) return;   // 뷰어의 빈 이미지는 '사진 없음'이 아님
    if (img.hasAttribute('data-optional')) { img.remove(); viewList = null; return; }   // 네거티브(-nt)가 없으면 상자 없이 생략
    img.setAttribute('data-missing', '1');
    var file = img.getAttribute('src') || '(no file)';
    var box = doc.createElement('div');
    box.className = 'img-missing';
    box.setAttribute('role', 'img');
    box.setAttribute('aria-label', img.getAttribute('alt') || file);
    var w = img.getAttribute('width'), h = img.getAttribute('height');
    if (w && h) box.style.aspectRatio = w + ' / ' + h;
    var name = doc.createElement('span'); name.textContent = file;
    var note = doc.createElement('small'); note.textContent = '사진 파일을 찾을 수 없습니다 — images 폴더와 파일 이름을 확인하세요';
    box.appendChild(name); box.appendChild(note);
    var frame = img.closest('.reveal-img');
    if (frame) frame.classList.add('is-in');
    img.replaceWith(box);
    viewList = null;
  }
  window.dosterShowMissing = showMissing;
  (window.__dosterMissing || []).forEach(showMissing);
  window.__dosterMissing = [];

  /* 2. 스크롤하면 나타나기 */
  var revealEls = doc.querySelectorAll('.reveal, .reveal-img');
  function revealAll() { revealEls.forEach(function (el) { el.classList.add('is-in'); }); }
  if (reduceMotion || !('IntersectionObserver' in window)) {
    revealAll();
  } else {
    var revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('is-in'); revealObserver.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.01 });
    revealEls.forEach(function (el) { revealObserver.observe(el); });
  }

  /* 3. 밝은/어두운 전시실 전환 + 전시실 이름 */
  var wayfinder = doc.getElementById('wayfinder');
  if ('IntersectionObserver' in window) {
    var themeObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        body.setAttribute('data-theme', en.target.getAttribute('data-theme'));
        if (!wayfinder) return;
        var room = en.target.getAttribute('data-room');
        if (room) { wayfinder.textContent = 'Room ' + room; wayfinder.classList.add('is-visible'); }
        else wayfinder.classList.remove('is-visible');
      });
    }, { rootMargin: '-50% 0px -50% 0px', threshold: 0 });
    doc.querySelectorAll('main > section[data-theme]').forEach(function (s) { themeObserver.observe(s); });
  }

  /* 4. 상단 메뉴 · 모바일 메뉴 */
  var header = doc.getElementById('site-header');
  var hero = doc.querySelector('.hero');
  var menu = doc.getElementById('menu');
  var menuToggle = doc.querySelector('.menu-toggle');
  var menuOpen = false, lastY = window.scrollY;
  var metrics = { heroH: 0, headerH: 64 };       // 매 프레임 읽지 않고 필요할 때만 측정
  function measure() {
    metrics.heroH = hero ? hero.offsetHeight : 0;
    metrics.headerH = header ? header.offsetHeight : 64;
  }

  function updateHeader(y) {
    if (!header) return;
    var heroEnd = metrics.heroH - metrics.headerH;
    header.classList.toggle('is-top', y < heroEnd);
    if (menuOpen) { header.classList.remove('is-hidden'); lastY = y; return; }
    var d = y - lastY;
    if (d > 6 && y > 240) header.classList.add('is-hidden');
    else if (d < -6) header.classList.remove('is-hidden');
    lastY = y;
  }
  if (header) header.addEventListener('focusin', function () { header.classList.remove('is-hidden'); });

  function setMenu(open) {
    if (!menu || !menuToggle) return;
    menuOpen = open;
    menuToggle.setAttribute('aria-expanded', String(open));
    body.classList.toggle('menu-open', open);
    if (open) {
      menu.hidden = false;
      requestAnimationFrame(function () { menu.classList.add('is-open'); });
      var first = menu.querySelector('a'); if (first) first.focus();
    } else {
      menu.classList.remove('is-open');
      menu.hidden = true;
    }
  }
  if (menu && menuToggle) {
    menuToggle.addEventListener('click', function () { setMenu(!menuOpen); });
    menu.addEventListener('click', function (e) { if (e.target.closest('a')) setMenu(false); });
    doc.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && menuOpen) { setMenu(false); menuToggle.focus(); }
    });
  }

  /* 5. 스크롤에 맞춘 효과 */
  var heroImg = doc.querySelector('.hero-img');
  var heroContent = doc.getElementById('hero-content');
  var zoomFrames = Array.prototype.slice.call(doc.querySelectorAll('.zoom-on-scroll'));
  var hscrolls = Array.prototype.slice.call(doc.querySelectorAll('[data-hscroll]')).map(function (el) {
    return { el: el, track: el.querySelector('.hscroll-track'), dist: 0 };
  });
  var expands = Array.prototype.slice.call(doc.querySelectorAll('[data-expand]')).map(function (el) {
    var fig = el.closest('figure');
    return { el: el, frame: el.querySelector('.expand-frame'), sticky: el.querySelector('.expand-sticky'), label: fig && fig.querySelector('figcaption') };
  });
  var negFrames = Array.prototype.slice.call(doc.querySelectorAll('.negative-fade')).map(function (el) {
    return { el: el, img: el.querySelector('img[data-negative]'), zoom: el.querySelector('.pano-zoom') };
  });
  var pinned = false;

  function heroFx(y, vh) {                       // 첫 화면: 사진은 천천히, 글자는 서서히 사라짐 (CSS 미지원 브라우저용)
    if (cssScroll || !heroImg || !hero) return;
    var h = metrics.heroH || vh;
    if (y > h) return;
    var p = y / h;
    heroImg.style.transform = 'translate3d(0,' + (y * 0.28).toFixed(1) + 'px,0) scale(' + (1 + p * 0.05).toFixed(4) + ')';
    if (heroContent) {
      heroContent.style.opacity = clamp(1 - p * 1.6, 0, 1).toFixed(3);
      heroContent.style.transform = 'translate3d(0,' + (y * -0.08).toFixed(1) + 'px,0)';
    }
  }
  function zoomFx(frame, vh) {                   // 화면 가득 사진: 지나가며 아주 살짝 확대 (CSS 미지원 브라우저용)
    var r = frame.getBoundingClientRect();
    if (r.bottom < -50 || r.top > vh + 50) return;
    var img = frame.querySelector('img'); if (!img) return;
    var p = clamp((vh - r.top) / (vh + r.height), 0, 1);
    img.style.transform = 'scale(' + (1 + p * 0.1).toFixed(4) + ')';
  }
  function negFx(o, vh) {                        // 파노라마: 고정된 동안 네거티브 → 현상본 + 천천히 확대 (CSS 미지원 브라우저용, CSS와 같은 구간)
    var r = o.el.getBoundingClientRect();
    if (r.bottom < -50 || r.top > vh + 50) return;
    var total = r.height - vh;
    var p = total > 0 ? clamp(-r.top / total, 0, 1) : 1;                  // 고정 구간 진행도
    var cp = clamp((vh - r.top) / (vh + r.height), 0, 1);                  // 지나가는 전체 진행도
    if (o.img) o.img.style.opacity = (1 - clamp((p - 0.10) / 0.55, 0, 1)).toFixed(3);
    if (o.zoom) o.zoom.style.transform = 'scale(' + (1 + cp * 0.1).toFixed(4) + ')';
  }
  function measureE(o) {                         // 휴대폰: 작은 사진 아래 빈 공간만큼 캡션을 끌어올려 사진에 붙임
    if (!o.label || !o.sticky || !o.frame) return;
    if (desktopMQ.matches || reduceMotion) { o.label.style.marginTop = ''; return; }
    var gap = (o.sticky.offsetHeight - o.frame.offsetHeight) / 2;
    o.label.style.marginTop = gap > 18 ? (18 - gap).toFixed(0) + 'px' : '';
  }
  function measureH(o) {                         // 가로 시퀀스 길이 계산
    if (!o.track) return;
    if (!pinned) {                               // 휴대폰: 바뀐 게 있을 때만 되돌림 (주소창 resize마다 레이아웃 안 건드림)
      if (o.measured) { o.el.style.height = ''; o.track.style.transform = ''; o.measured = false; }
      return;
    }
    o.dist = Math.max(0, o.track.offsetWidth - window.innerWidth);
    o.el.style.height = (o.dist + window.innerHeight) + 'px';
    o.measured = true;
  }
  function hFx(o, vh) {                          // 세로 스크롤 → 가로 이동
    if (!pinned || !o.visible || !o.track || o.dist <= 0) return;
    var r = o.el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > vh) return;
    var p = clamp(-r.top / o.dist, 0, 1);
    o.track.style.transform = 'translate3d(' + (-p * o.dist).toFixed(1) + 'px,0,0)';
  }
  function expandFx(o, vh) {                     // 작은 액자 → 화면 전체
    if (!o.visible || !o.frame || !o.el.classList.contains('is-active')) return;
    var r = o.el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > vh) return;
    var total = r.height - vh;
    var p = total > 0 ? clamp(-r.top / (total * 0.8), 0, 1) : 1;
    var start = desktopMQ.matches ? 0.42 : 0.62;
    o.frame.style.transform = 'scale(' + (start + (1 - start) * easeInOut(p)).toFixed(4) + ')';
  }

  var ticking = false;
  function update() {
    ticking = false;
    var y = window.scrollY, vh = window.innerHeight;
    updateHeader(y);
    if (reduceMotion) return;
    heroFx(y, vh);
    if (!cssScroll) { zoomFrames.forEach(function (f) { zoomFx(f, vh); }); negFrames.forEach(function (o) { negFx(o, vh); }); }
    hscrolls.forEach(function (o) { hFx(o, vh); });
    expands.forEach(function (o) { expandFx(o, vh); });
  }
  function requestUpdate() { if (!ticking) { ticking = true; requestAnimationFrame(update); } }

  // 화면 근처에 있는 가로 시퀀스 · 확대 액자만 계산
  var fxItems = hscrolls.concat(expands);
  fxItems.forEach(function (o) { o.visible = !('IntersectionObserver' in window); });
  if ('IntersectionObserver' in window) {
    var fxObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { en.target.__fx.visible = en.isIntersecting; });
      requestUpdate();
    });
    fxItems.forEach(function (o) { o.el.__fx = o; fxObserver.observe(o.el); });
  }

  function applyMode() {
    measure();
    pinned = !reduceMotion && desktopMQ.matches;
    hscrolls.forEach(function (o) { o.el.classList.toggle('is-pinned', pinned); measureH(o); });
    expands.forEach(function (o) {
      o.el.classList.toggle('is-active', !reduceMotion);
      if (reduceMotion && o.frame) o.frame.style.transform = '';
    });
    if (reduceMotion) {
      if (heroImg) heroImg.style.transform = '';
      if (heroContent) { heroContent.style.opacity = ''; heroContent.style.transform = ''; }
      zoomFrames.forEach(function (f) { var i = f.querySelector('img'); if (i) i.style.transform = ''; });
      negFrames.forEach(function (o) { if (o.img) o.img.style.opacity = ''; if (o.zoom) o.zoom.style.transform = ''; });
      revealAll();
    }
    expands.forEach(measureE);
    if (menuOpen && desktopMQ.matches) setMenu(false);
    requestUpdate();
  }

  // 가로 시퀀스 사진은 가까워지면 미리 불러오기
  if ('IntersectionObserver' in window) {
    var preload = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        en.target.querySelectorAll('img[loading="lazy"]').forEach(function (img) { img.loading = 'eager'; });
        preload.unobserve(en.target);
      });
    }, { rootMargin: '150% 0px' });
    hscrolls.forEach(function (o) { preload.observe(o.el); });
  }
  hscrolls.forEach(function (o) {
    if (!o.track) return;
    o.track.querySelectorAll('img').forEach(function (img) {
      img.addEventListener('load', function () { measureH(o); requestUpdate(); });
    });
  });

  expands.forEach(function (o) {
    var img = o.frame && o.frame.querySelector('img');
    if (img) img.addEventListener('load', function () { measureE(o); });
  });

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { measure(); hscrolls.forEach(measureH); expands.forEach(measureE); requestUpdate(); }, 120);
  });
  window.addEventListener('scroll', requestUpdate, { passive: true });
  window.addEventListener('load', function () { measure(); hscrolls.forEach(measureH); expands.forEach(measureE); requestUpdate(); });
  function onMQChange() { reduceMotion = reduceMQ.matches; applyMode(); }
  if (reduceMQ.addEventListener) {
    reduceMQ.addEventListener('change', onMQChange);
    desktopMQ.addEventListener('change', onMQChange);
  }
  applyMode();

  /* 6. 사진 크게 보기 (Enter 열기 · ← → 이동 · Esc 닫기 · 휴대폰은 좌우로 밀기) */
  /* 사진 보호: 사진 위에 보이지 않는 막(워터마크가 들어간 저해상도 사본)을 덮음.
     우클릭 저장·복사·드래그를 하면 원본 대신 이 사본이 저장됨. 사본은 images/guard/ 에 같은 이름으로 있음 */
  function guardSrc(img) {
    var full = img.getAttribute('src') || '', s = full.split('?')[0], q = full.slice(s.length);   // ?v=… (친구 서버의 버전 표시)는 그대로 이어 붙임
    return s.indexOf('images/') === 0 && s.indexOf('images/guard/') !== 0 ? 'images/guard/' + s.slice(7) + q : null;
  }
  function makeGuard(src) {
    var g = doc.createElement('img');
    g.className = 'img-guard'; g.alt = ''; g.setAttribute('aria-hidden', 'true');
    g.decoding = 'async';
    if (src) { g.loading = 'lazy'; g.src = src; }
    return g;
  }
  function guardAll() {
    Array.prototype.forEach.call(doc.querySelectorAll('main img'), function (img) {
      if (img.hasAttribute('data-negative') || img.classList.contains('img-guard')) return;
      var src = guardSrc(img), pa = img.parentNode;
      if (!src || !pa || pa.querySelector(':scope > .img-guard')) return;
      img.setAttribute('draggable', 'false');
      var g = makeGuard(src); g.__img = img;
      if (img.hasAttribute('data-viewable')) g.style.cursor = 'zoom-in';
      if (getComputedStyle(pa).position === 'static') pa.style.position = 'relative';
      pa.appendChild(g);
    });
  }

  var viewer = doc.getElementById('viewer');
  if (viewer && typeof viewer.showModal === 'function') {
    var vImg = viewer.querySelector('.viewer-img');
    vImg.setAttribute('draggable', 'false');
    var vCap = viewer.querySelector('.viewer-caption');
    var vCount = viewer.querySelector('.viewer-count');
    var current = 0, opener = null, savedY = 0;
    var vGuard = makeGuard();                      // 뷰어의 큰 사진 위 보호막 (사진 크기·위치에 맞춤)
    vImg.parentNode.appendChild(vGuard);
    var vHint = doc.createElement('span');         // 사진에 마우스를 올리면 뜨는 안내
    vHint.className = 'viewer-hint'; vHint.setAttribute('aria-hidden', 'true');
    vHint.innerHTML = 'Click to look closer <span class="arrow">→</span>';
    vImg.parentNode.appendChild(vHint);
    var zoomed = false;
    var peekPrev = doc.createElement('img'), peekNext = doc.createElement('img');   // 양옆 사진 미리보기
    [peekPrev, peekNext].forEach(function (pk, k) {
      pk.className = 'viewer-peek ' + (k ? 'viewer-peek--next' : 'viewer-peek--prev');
      pk.alt = ''; pk.setAttribute('aria-hidden', 'true'); pk.setAttribute('draggable', 'false'); pk.decoding = 'async';
      viewer.appendChild(pk);
    });
    var noPeek = window.matchMedia('(max-width: 899px), (pointer: coarse) and (max-height: 520px)');   // style.css와 같은 조건: 휴대폰은 미리보기 없음
    function updatePeeks(list) {
      var n = list.length; if (n < 2 || noPeek.matches) { peekPrev.removeAttribute('src'); peekNext.removeAttribute('src'); return; }
      [[peekPrev, list[(current - 1 + n) % n]], [peekNext, list[(current + 1) % n]]].forEach(function (pair) {
        var src = pair[1].currentSrc || pair[1].src;
        if (pair[0].getAttribute('src') === src) return;
        pair[0].src = src;
        if (viewer.open && animOK()) pair[0].animate([{ opacity: 0 }, {}], { duration: 600, easing: 'ease-out' });
      });
    }
    function contentRect() {                       // 상자 안에서 실제 사진이 그려진 영역 (여백 제외, 뷰어 기준 좌표)
      var x = vImg.offsetLeft, y = vImg.offsetTop, w = vImg.offsetWidth, h = vImg.offsetHeight;
      var nw = vImg.naturalWidth, nh = vImg.naturalHeight;
      if (zoomed || !nw || !nh) return { x: x, y: y, w: w, h: h };
      var k = Math.min(w / nw, h / nh), cw = nw * k, ch = nh * k;
      return { x: x + (w - cw) / 2, y: y + (h - ch) / 2, w: cw, h: ch };
    }
    function placeVGuard() {                       // 보호막·안내를 '사진이 있는 부분'에만 맞춤
      var r = contentRect(), st = vGuard.style;
      st.left = r.x + 'px'; st.top = r.y + 'px';
      st.setProperty('width', r.w + 'px', 'important');
      st.setProperty('height', r.h + 'px', 'important');
      vHint.style.left = (r.x + r.w / 2) + 'px';
      vHint.style.top = (r.y + r.h - 54) + 'px';
    }
    vImg.addEventListener('load', placeVGuard);
    window.addEventListener('resize', function () { if (viewer.open) placeVGuard(); });

    function viewables() {                       // 매번 DOM을 뒤지지 않고 캐시 (사진이 없어 교체되면 다시 만듦)
      if (!viewList) viewList = Array.prototype.slice.call(doc.querySelectorAll('.room img'))
        .filter(function (img) { return !img.closest('a') && !img.hasAttribute('data-negative'); });
      return viewList;
    }
    function captionParts(img) {
      var fig = img.closest('figure'), cap = fig && fig.querySelector('figcaption');
      if (!cap) return [];
      return Array.prototype.map.call(cap.children, function (c) { return c.textContent.trim(); }).filter(Boolean);
    }
    function renderCaption(img) {                  // 제목은 한 줄, 정보는 항목이 중간에 끊기지 않게
      var parts = captionParts(img);
      vCap.textContent = '';
      if (!parts.length) return;
      var t = doc.createElement('span'); t.className = 'vc-title'; t.textContent = parts[0]; vCap.appendChild(t);
      var rest = parts.slice(1);
      rest.forEach(function (txt, k) {             // 구분점(·)은 앞 항목에 붙여서 줄 맨 앞에 오지 않게
        var it = doc.createElement('span'); it.className = 'vc-item'; it.textContent = txt;
        if (k < rest.length - 1) { var sep = doc.createElement('span'); sep.className = 'vc-sep'; sep.setAttribute('aria-hidden', 'true'); sep.textContent = '·'; it.appendChild(sep); }
        vCap.appendChild(it); vCap.appendChild(doc.createTextNode(' '));
      });
    }
    /* 뷰어 움직임: 투명도·이동만 써서 부드럽게 (무거운 3D·필터 없음) */
    var EASE = 'cubic-bezier(.22, .61, .36, 1)';
    function animOK() { return !reduceMotion && typeof vImg.animate === 'function'; }
    var ghost = null, closing = false, closeTimer = null, outAnim = null;
    function dropGhost() { if (ghost) { ghost.remove(); ghost = null; } }
    function ready(im, cb) {                        // 새 사진을 미리 풀어 둔(decode) 뒤에 보여줌 → 버벅임·빈 화면 없음
      var done = false;
      function go() { if (!done) { done = true; cb(); } }
      if (im.decode) im.decode().then(go, go);
      else if (im.complete) go();
      else im.addEventListener('load', go, { once: true });
      setTimeout(go, 700);                          // 너무 오래 걸리면 그냥 진행
    }
    function setPhoto(img) {
      var list = viewables();
      vImg.src = img.src;                           // 크게 보기는 항상 원본 (폰 화면용 작은 사본 아님)
      vImg.alt = img.alt || '';
      var gs = guardSrc(img);
      if (gs) vGuard.src = gs; else vGuard.removeAttribute('src');
      renderCaption(img);
      updatePeeks(list);
      vCount.textContent = String(current + 1).padStart(2, '0') + ' / ' + String(list.length).padStart(2, '0');
    }
    var decoded = [];                              // 미리 받아서 '압축까지 풀어 둔' 사진 (넘기는 순간 버벅이지 않게)
    function predecode(src) {
      if (!src || decoded.some(function (d) { return d.src === src; })) return;
      var pre = new Image(); pre.decoding = 'async'; pre.src = src;
      if (pre.decode) pre.decode().catch(function () {});
      decoded.push({ src: src, im: pre }); if (decoded.length > 6) decoded.shift();
    }
    function preload(list) {                       // 양옆 사진을 미리 받아 둠
      [current - 1, current + 1, current + 2].forEach(function (k) {
        var im = list[(k + list.length) % list.length];
        if (im) predecode(im.src);
      });
    }
    function show(i, dir, fromX) {                 // dir: 1 다음, -1 이전 / fromX: 손가락으로 끌던 위치
      var list = viewables(); if (!list.length) return;
      current = (i + list.length) % list.length;
      var img = list[current];
      setLifted(null);
      dropGhost();
      if (!dir || !animOK() || !viewer.open || !vImg.getAttribute('src')) {
        vImg.style.transform = ''; vImg.style.opacity = '';
        setPhoto(img); preload(list); return;
      }
      var x0 = fromX || 0, o0 = parseFloat(vImg.style.opacity || '1');
      var g = vImg.cloneNode(false);               // 지금 사진을 잠깐 위에 남겨 두고, 새 사진이 준비되면 교차
      g.className = 'viewer-ghost'; g.alt = ''; g.setAttribute('aria-hidden', 'true');
      g.removeAttribute('style');
      var st = g.style;
      st.left = vImg.offsetLeft + 'px'; st.top = vImg.offsetTop + 'px';
      st.width = vImg.offsetWidth + 'px'; st.height = vImg.offsetHeight + 'px';
      st.transform = 'translateX(' + x0 + 'px)'; st.opacity = String(o0);
      vImg.parentNode.insertBefore(g, vGuard);
      ghost = g;
      vImg.style.transform = ''; vImg.style.opacity = '0';
      setPhoto(img);
      var D = 48 * dir;
      settle(700);
      ready(vImg, function () {
        if (ghost !== g) return;                    // 그 사이 또 넘겼으면 이번 건 건너뜀
        g.animate([
          { transform: 'translateX(' + x0 + 'px)', opacity: o0 },
          { transform: 'translateX(' + (x0 - D) + 'px)', opacity: 0 }
        ], { duration: 380, easing: EASE, fill: 'forwards' }).onfinish = function () {
          g.remove(); if (ghost === g) ghost = null;
        };
        vImg.style.opacity = '';
        vImg.animate([{ transform: 'translateX(' + D + 'px)', opacity: 0 }, { transform: 'none', opacity: 1 }],
          { duration: 560, easing: EASE });
        vCap.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 420, easing: 'ease-out' });
      });
      preload(list);
    }
    var lifted = null;                             // 뷰어로 '들어 올린' 페이지 속 사진 (그동안 제자리는 비워 둠)
    function setLifted(im) {
      if (lifted && lifted !== im) lifted.style.visibility = '';
      lifted = im || null;
      if (lifted) lifted.style.visibility = 'hidden';
    }
    function pageRect(im) {                        // 페이지 속 사진이 실제로 보이는 영역 (액자 밖으로 잘린 부분 제외)
      if (!im || !im.isConnected) return null;
      var r = im.getBoundingClientRect(), f = im.parentNode.getBoundingClientRect();
      var x = Math.max(r.left, f.left), y = Math.max(r.top, f.top);
      var w = Math.min(r.right, f.right) - x, h = Math.min(r.bottom, f.bottom) - y;
      if (w < 8 || h < 8 || y > window.innerHeight || y + h < 0 || x > window.innerWidth || x + w < 0) return null;
      return { x: x, y: y, w: w, h: h };
    }
    function transformTo(o) {                      // 뷰어 사진(여백 제외 부분)을 o 자리에 겹쳐 보이게 하는 변환
      var c = contentRect(), fr = fig.getBoundingClientRect();
      var b = { left: fr.left + vImg.offsetLeft, top: fr.top + vImg.offsetTop };   // 확대 효과(scale)와 무관한 상자 위치
      var cx = fr.left + c.x, cy = fr.top + c.y; if (!c.w) return null;
      var s = o.w / c.w;
      return 'translate(' + (o.x - b.left - (cx - b.left) * s) + 'px,' + (o.y - b.top - (cy - b.top) * s) + 'px) scale(' + s + ')';
    }
    function open(img) {
      var i = viewables().indexOf(img); if (i < 0) return;
      clearTimeout(closeTimer); closing = false; viewer.classList.remove('is-closing');
      if (outAnim) { outAnim.cancel(); outAnim = null; }
      opener = img; current = i; dropGhost();
      vImg.style.transform = '';
      if (animOK()) vImg.style.opacity = '0';
      setPhoto(img);
      savedY = window.scrollY;                     // 닫을 때 이 위치로 돌아옴 (iOS가 포커스 복원하며 화면을 옮기는 문제 방지)
      root.classList.add('viewer-open');
      if (doc.activeElement && doc.activeElement !== body && doc.activeElement.blur) doc.activeElement.blur();   // 닫을 때 브라우저가 터치한 사진으로 '스크롤 이동'하지 않게
      viewer.showModal();
      viewer.querySelector('.viewer-close').focus({ preventScroll: true });
      if (animOK()) settle(900);
      if (animOK()) ready(vImg, function () {      // 페이지 속 그 사진이 제자리에서 떠올라 가운데로 커지며 이동 (배경은 서서히 어두워짐)
        if (!viewer.open || closing) return;
        vImg.style.opacity = '';
        var o = pageRect(img), from = o && vImg.naturalWidth ? transformTo(o) : null;
        if (from) {
          setLifted(img);
          vImg.animate([{ transformOrigin: '0 0', transform: from }, { transformOrigin: '0 0', transform: 'none' }],
            { duration: 640, easing: EASE });
        } else {
          vImg.animate([{ opacity: 0, transform: 'scale(.96)' }, { opacity: 1, transform: 'none' }],
            { duration: 640, easing: EASE });
        }
      });
      setTimeout(function () { if (viewer.open) preload(viewables()); }, 800);
    }
    /* 확대해서 둘러보기 */
    var fig = vImg.parentNode, drag = null, dragMoved = false;
    function flip(from, to) {                      // from 위치·크기에서 지금 자리로 부드럽게 이동
      if (!animOK()) return;
      var s = from.w / to.w;
      vImg.animate([
        { transformOrigin: '0 0', transform: 'translate(' + (from.x - to.x) + 'px,' + (from.y - to.y) + 'px) scale(' + s + ')' },
        { transformOrigin: '0 0', transform: 'none' }
      ], { duration: 560, easing: EASE });
    }
    function enterZoom(cx, cy) {
      var nw = vImg.naturalWidth, nh = vImg.naturalHeight; if (!nw || !nh) return;
      var before = vImg.getBoundingClientRect(), c = contentRect(), fr = fig.getBoundingClientRect();
      var from = { x: fr.left + c.x, y: fr.top + c.y, w: c.w, h: c.h };
      var fx = (cx - from.x) / from.w, fy = (cy - from.y) / from.h;
      var vw = window.innerWidth, vh = window.innerHeight;
      var cover = Math.max(vw / nw, vh / nh), fit = c.w / nw;
      var z = Math.max(cover, Math.min(fit * 2.2, 1));   // 화면을 꽉 채우고, 디테일이 보이게 조금 더 크게 (원본보다 크게는 안 함)
      zoomed = true; viewer.classList.add('is-zoomed'); viewer.classList.remove('is-hover');
      vImg.style.width = Math.round(nw * z) + 'px'; vImg.style.height = Math.round(nh * z) + 'px';
      fig.scrollLeft = fx * nw * z - cx; fig.scrollTop = fy * nh * z - cy;   // 누른 곳이 손가락·마우스 아래에 오게
      placeVGuard();
      var r = vImg.getBoundingClientRect();
      flip(from, { x: r.left, y: r.top, w: r.width, h: r.height });
    }
    function exitZoom() {
      if (!zoomed) return;
      var z = vImg.getBoundingClientRect();
      zoomed = false; viewer.classList.remove('is-zoomed', 'is-dragging');
      vImg.style.width = ''; vImg.style.height = '';
      fig.scrollLeft = 0; fig.scrollTop = 0;
      placeVGuard();
      var c = contentRect(), fr = fig.getBoundingClientRect(), b = vImg.getBoundingClientRect();
      if (!animOK() || !c.w) return;
      var s = z.width / c.w;                          // 상자 속 사진 부분이 확대돼 있던 자리에서 시작
      var tx = z.left - b.left - (fr.left + c.x - b.left) * s, ty = z.top - b.top - (fr.top + c.y - b.top) * s;
      vImg.animate([
        { transformOrigin: '0 0', transform: 'translate(' + tx + 'px,' + ty + 'px) scale(' + s + ')' },
        { transformOrigin: '0 0', transform: 'none' }
      ], { duration: 520, easing: EASE });
    }
    vGuard.addEventListener('click', function (e) {
      if (dragMoved) { dragMoved = false; return; }   // 끌어서 둘러본 경우는 클릭으로 치지 않음
      if (zoomed) exitZoom(); else enterZoom(e.clientX, e.clientY);
    });
    var settling = 0;                               // 사진이 움직이는 동안은 마우스 올림 효과를 미룸
    function settle(ms) {
      settling++; viewer.classList.remove('is-hover');
      setTimeout(function () {
        settling--;
        if (!settling && viewer.open && !zoomed && !closing && vGuard.matches(':hover')) viewer.classList.add('is-hover');
      }, ms);
    }
    vGuard.addEventListener('mouseenter', function () { if (!zoomed && !settling && !closing) viewer.classList.add('is-hover'); });
    vGuard.addEventListener('mouseleave', function () { viewer.classList.remove('is-hover'); });
    fig.addEventListener('pointerdown', function (e) {   // 컴퓨터: 확대된 사진을 마우스로 끌어서 둘러보기
      dragMoved = false;
      if (!zoomed || e.pointerType !== 'mouse' || e.button !== 0) return;
      e.preventDefault();                          // 글자 선택·이미지 끌어놓기 대신 둘러보기
      drag = { x: e.clientX, y: e.clientY, l: fig.scrollLeft, t: fig.scrollTop };
    });
    fig.addEventListener('dragstart', function (e) { if (zoomed) e.preventDefault(); });
    window.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!dragMoved && Math.abs(dx) + Math.abs(dy) > 5) { dragMoved = true; viewer.classList.add('is-dragging'); }
      if (dragMoved) { fig.scrollLeft = drag.l - dx; fig.scrollTop = drag.t - dy; }
    });
    window.addEventListener('pointerup', function () { if (drag) { drag = null; viewer.classList.remove('is-dragging'); } });
    fig.addEventListener('wheel', function (e) {   // 가로로만 넘치는 사진은 휠을 가로 이동으로
      if (!zoomed || e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      if (fig.scrollHeight <= fig.clientHeight + 1 && fig.scrollWidth > fig.clientWidth) { fig.scrollLeft += e.deltaY; e.preventDefault(); }
    }, { passive: false });

    function close() {                             // 사진이 살짝 작아지며 서서히 사라진 뒤 닫힘
      if (!viewer.open || closing) return;
      if (!animOK()) { viewer.close(); return; }
      closing = true;
      dropGhost();
      viewer.classList.remove('is-hover');
      viewer.classList.add('is-closing');
      var target = viewables()[current], o = !zoomed && vImg.naturalWidth ? pageRect(target) : null, to = o ? transformTo(o) : null;
      if (to) {                                     // 지금 보던 사진이 페이지 속 제자리로 돌아가며 내려앉음
        setLifted(target);
        outAnim = vImg.animate([{ transformOrigin: '0 0', transform: 'none' }, { transformOrigin: '0 0', transform: to }],
          { duration: 520, easing: 'cubic-bezier(.32, .0, .2, 1)', fill: 'forwards' });
      } else {                                      // 페이지에 안 보이는 사진이면 살짝 작아지며 사라짐
        outAnim = vImg.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.97)' }],
          { duration: 420, easing: 'cubic-bezier(.4, 0, .6, 1)', fill: 'forwards' });
      }
      closeTimer = setTimeout(function () { viewer.close(); }, to ? 540 : 440);
    }
    function blockPage(e) {                        // 확대해서 둘러볼 때(사진 영역 안)만 스크롤 허용
      if (zoomed && fig.contains(e.target)) return;
      if (e.cancelable) e.preventDefault();
    }
    viewer.addEventListener('wheel', blockPage, { passive: false });
    viewer.addEventListener('touchmove', blockPage, { passive: false });
    viewer.addEventListener('keydown', function (e) {
      if (!zoomed && ['PageDown', 'PageUp', 'Home', 'End', 'ArrowUp', 'ArrowDown'].indexOf(e.key) > -1) e.preventDefault();
      if (!zoomed && e.key === ' ' && !(e.target.closest && e.target.closest('button'))) e.preventDefault();
    });
    viewer.addEventListener('cancel', function (e) { e.preventDefault(); if (zoomed) exitZoom(); else close(); });   // Esc: 확대 중이면 먼저 돌아가고, 아니면 서서히 닫힘

    viewer.addEventListener('close', function () {
      root.classList.remove('viewer-open');
      vImg.removeAttribute('src');
      vGuard.removeAttribute('src');
      dropGhost();
      clearTimeout(closeTimer); closing = false; viewer.classList.remove('is-closing');
      if (outAnim) { outAnim.cancel(); outAnim = null; }
      vImg.style.transform = ''; vImg.style.opacity = '';
      zoomed = false; viewer.classList.remove('is-zoomed', 'is-hover', 'is-dragging');
      setLifted(null);
      vImg.style.width = ''; vImg.style.height = ''; fig.scrollLeft = 0; fig.scrollTop = 0;
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
      restoreScroll();
      requestAnimationFrame(restoreScroll);
      var rt = [setTimeout(restoreScroll, 80), setTimeout(restoreScroll, 200)];
      function userMoved() {                       // 사용자가 바로 스크롤하면 위치 되돌리기는 멈춤
        rt.forEach(clearTimeout);
        ['wheel', 'touchstart', 'keydown', 'pointerdown'].forEach(function (t) { window.removeEventListener(t, userMoved, true); });
      }
      ['wheel', 'touchstart', 'keydown', 'pointerdown'].forEach(function (t) { window.addEventListener(t, userMoved, { capture: true, passive: true }); });
      setTimeout(userMoved, 250);
    });
    function restoreScroll() {                     // 부드러운 스크롤 없이 원래 자리로 즉시 복귀 → 확대 사진도 그대로
      if (Math.abs(window.scrollY - savedY) < 2) return;
      root.style.scrollBehavior = 'auto';
      window.scrollTo(0, savedY);
      root.style.scrollBehavior = '';
      requestUpdate();
    }
    viewables().forEach(function (img) {
      img.setAttribute('data-viewable', '');
      img.setAttribute('tabindex', '0');
      img.setAttribute('role', 'button');
      img.setAttribute('aria-label', 'View larger: ' + (img.alt || 'photograph'));
    });
    doc.addEventListener('click', function (e) {
      var t = e.target && e.target.__img ? e.target.__img : e.target;   // 보호막을 눌렀으면 그 아래 사진
      var img = t.closest && t.closest('img[data-viewable]');
      if (img) open(img);
    });
    doc.addEventListener('keydown', function (e) {
      var t = e.target;
      if (t && t.matches && t.matches('img[data-viewable]') && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(t); }
    });
    viewer.querySelector('.viewer-close').addEventListener('click', close);
    viewer.querySelector('.viewer-prev').addEventListener('click', function () { if (!zoomed) show(current - 1, -1); });
    viewer.querySelector('.viewer-next').addEventListener('click', function () { if (!zoomed) show(current + 1, 1); });
    viewer.addEventListener('click', function (e) {
      if (zoomed) return;
      if (e.target === viewer || e.target.classList.contains('viewer-figure')) close();
    });
    viewer.addEventListener('keydown', function (e) {
      if (zoomed) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); show(current + 1, 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); show(current - 1, -1); }
    });
    var touchX = null, dragX = 0;                  // 휴대폰: 사진이 손가락을 따라오다가 넘어감
    viewer.addEventListener('touchstart', function (e) {
      touchX = e.touches.length === 1 ? e.touches[0].clientX : null; dragX = 0;
    }, { passive: true });
    viewer.addEventListener('touchmove', function (e) {
      if (touchX === null || closing || zoomed || !animOK()) return;
      if (e.touches.length !== 1) { touchX = null; return; }
      dragX = (e.touches[0].clientX - touchX) * 0.55;
      vImg.style.transform = 'translateX(' + dragX.toFixed(1) + 'px)';
      vImg.style.opacity = String(1 - Math.min(Math.abs(dragX) / 520, 0.35));
      if (noPeek.matches) return;
      viewer.classList.add('is-dragging-peek');
      var pk = dragX < 0 ? peekNext : peekPrev, other = dragX < 0 ? peekPrev : peekNext, edge = window.innerWidth < 900 ? 10 : 46;
      pk.style.transform = 'translate(calc(' + (dragX < 0 ? '100% - ' : '-100% + ') + (edge + Math.abs(dragX) * 1.4).toFixed(1) + 'px), -50%)';
      pk.style.opacity = String(Math.min(0.3 + Math.abs(dragX) / 300, 0.8));
      other.style.transform = ''; other.style.opacity = '';
    }, { passive: true });
    viewer.addEventListener('touchend', function (e) {
      if (touchX === null) return;
      if (zoomed) { touchX = null; return; }        // 확대 중에는 손가락으로 둘러보기만
      var dx = e.changedTouches[0].clientX - touchX, from = dragX;
      touchX = null; dragX = 0;
      viewer.classList.remove('is-dragging-peek');
      [peekPrev, peekNext].forEach(function (pk) { pk.style.transform = ''; pk.style.opacity = ''; });
      if (Math.abs(dx) > 50) { var d = dx < 0 ? 1 : -1; show(current + d, d, from); return; }
      if (from) {                                   // 조금만 끌었으면 제자리로 부드럽게 돌아옴
        var o = parseFloat(vImg.style.opacity || '1');
        vImg.style.transform = ''; vImg.style.opacity = '';
        vImg.animate([{ transform: 'translateX(' + from + 'px)', opacity: o }, { transform: 'none', opacity: 1 }],
          { duration: 280, easing: EASE });
      }
    }, { passive: true });
  }

  guardAll();                                    // 페이지의 모든 사진에 보호막
  // 보호막이 아닌 진짜 사진은 끌어서 저장·우클릭 저장이 안 되게 (사진이 움직이는 애니메이션 도중에도)
  function isOriginal(t) { return t && t.tagName === 'IMG' && !t.classList.contains('img-guard'); }
  doc.addEventListener('dragstart', function (e) { if (isOriginal(e.target)) e.preventDefault(); }, true);
  doc.addEventListener('contextmenu', function (e) { if (isOriginal(e.target)) e.preventDefault(); }, true);

  /* 메뉴 이동 (Exhibition · About · Contact · 맨 위로): 길게 굴러 내려가지 않고,
     화면이 목적지 색으로 살짝 덮였다가 → 한 번에 이동 → 서서히 걷힘 */
  var veil = doc.createElement('div');
  veil.className = 'page-veil'; veil.setAttribute('aria-hidden', 'true');
  body.appendChild(veil);
  function jumpY(t) {
    if (t.id === 'top') return 0;
    var y = t.getBoundingClientRect().top + window.scrollY;
    if (t.querySelector('.vseq-aside')) {          // Portrait처럼 제목이 옆에 따라오는 방: 첫 사진이 아래로 잘리면 사진 전체가 보일 만큼만 더 내려감
      var img = t.querySelector('.vseq-list img:not(.img-guard)');
      if (img) {
        var r = img.parentNode.getBoundingClientRect(), vh = window.innerHeight;
        var top = r.top + window.scrollY - y, bottom = r.bottom + window.scrollY - y;   // 방 맨 위 기준 사진 위치
        var need = bottom + 24 - vh, room = top - (metrics.headerH || 64) - 16;      // 아래 여백 24px, 위는 메뉴바에 안 가리게
        if (need > 0) y += Math.max(0, Math.min(need, room));
      }
    }
    return Math.round(y);
  }
  function jumpNow(y) {
    root.style.scrollBehavior = 'auto';
    window.scrollTo(0, y);
    root.style.scrollBehavior = '';
  }
  function jumpTo(t) {
    if (reduceMotion) { jumpNow(jumpY(t)); return; }
    var dark = (t.getAttribute('data-theme') || (t.closest('[data-theme]') || body).getAttribute('data-theme')) !== 'light';
    veil.style.backgroundColor = getComputedStyle(root).getPropertyValue(dark ? '--dark-bg' : '--light-bg') || '#0a0a0a';
    veil.classList.remove('is-out'); veil.classList.add('is-on');
    setTimeout(function () {
      jumpNow(jumpY(t));
      // 사진이 늦게 불러와지며 위쪽 높이가 바뀌어도 정확히 목적지에 서도록 몇 번 다시 맞춤
      requestAnimationFrame(function () { jumpNow(jumpY(t)); });
      setTimeout(function () { jumpNow(jumpY(t)); veil.classList.add('is-out'); veil.classList.remove('is-on'); }, 120);
      setTimeout(function () { var y = jumpY(t); if (Math.abs(y - window.scrollY) > 2) jumpNow(y); }, 700);
    }, 360);
  }
  doc.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey) return;
    if (!a.closest('.site-header, #menu, .site-footer, .room-index')) return;     // 위 메뉴·휴대폰 메뉴·방 목록·맨 아래 '처음으로'
    var t = doc.getElementById(a.getAttribute('href').slice(1)); if (!t) return;
    e.preventDefault();
    if (menuOpen) setMenu(false);
    jumpTo(t);
  });

  /* 7. 첫 화면 SCROLL 안내: 15초 동안 아무 움직임이 없으면 서서히 나타남 */
  var cue = doc.querySelector('.scroll-cue');
  if (cue) {
    var CUE_DELAY = 15000, lastMove = Date.now(), cueTimer = null;
    var cueEvents = ['pointermove', 'pointerdown', 'wheel', 'keydown', 'touchstart', 'scroll'];
    var cueActive = function () { lastMove = Date.now(); };
    var cueCheck = function () {
      var idle = Date.now() - lastMove;
      if (idle < CUE_DELAY || window.scrollY > 40) { cueTimer = setTimeout(cueCheck, Math.max(1000, CUE_DELAY - idle)); return; }
      cue.classList.add('is-visible');
      cueEvents.forEach(function (ev) { window.removeEventListener(ev, cueActive); });
    };
    cueEvents.forEach(function (ev) { window.addEventListener(ev, cueActive, { passive: true }); });
    cueTimer = setTimeout(cueCheck, CUE_DELAY);
  }

  /* 8. 푸터 연도 자동 */
  var year = doc.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());

})();
