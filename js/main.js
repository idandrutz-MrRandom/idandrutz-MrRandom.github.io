(() => {
  const root = document.documentElement;
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;

  /* =====================================================================
     THEME ENGINE  (independent of GSAP)
     t = 0 -> nature, t = 1 -> cyber. Driven by scroll through #bridge.
     Sets --t and the palette variables; fades the cyber video layer in.
     ===================================================================== */
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, t) => a.map((v, i) => Math.round(lerp(v, b[i], t)));
  const PAL = {
    accent:  [hex('#b5d19a'), hex('#2ff3ff')],
    accent2: [hex('#f0cf8e'), hex('#ff3df2')],
    bg:      [hex('#0b120d'), hex('#07060f')],
  };
  const cyberLayer = $('#cyberLayer');
  const overlay = $('#bgOverlay');
  const bridge = $('#bridge');
  const progressBar = $('#progress');
  let particleColors = [PAL.accent[0], PAL.accent2[0]];
  let start = 0, end = 1, cur = 0, last = -1;
  let bTop = 0, bSpan = 1, p = 0, lastP = -1;

  const measure = () => {
    const y0 = bridge.getBoundingClientRect().top + scrollY;
    start = y0 - innerHeight * .55;
    end = Math.max(start + 1, y0 + bridge.offsetHeight - innerHeight);
    bTop = y0; bSpan = Math.max(1, bridge.offsetHeight - innerHeight);
  };

  const apply = t => {
    const a = mix(PAL.accent[0], PAL.accent[1], t);
    const b = mix(PAL.accent2[0], PAL.accent2[1], t);
    const bg = mix(PAL.bg[0], PAL.bg[1], t);
    const s = root.style;
    s.setProperty('--t', t.toFixed(4));
    s.setProperty('--accent', `rgb(${a})`);
    s.setProperty('--accent2', `rgb(${b})`);
    s.setProperty('--bg', `rgb(${bg})`);
    s.setProperty('--bg-rgb', bg.join(', '));
    cyberLayer.style.opacity = t;
    overlay.style.opacity = lerp(.3, .62, t);
    particleColors = [a, b];
  };

  const smooth = x => x * x * (3 - 2 * x);
  let prevY = scrollY, velocity = 0;

  /* ---------- Particles: warm drifting motes -> falling data streaks ---------- */
  const cv = $('#fx');
  const ctx = cv.getContext('2d');
  let W = 0, H = 0, dpr = 1, parts = [];
  const sizeCanvas = () => {
    dpr = Math.min(devicePixelRatio || 1, 2);
    W = cv.width = innerWidth * dpr; H = cv.height = innerHeight * dpr;
    const n = Math.round(clamp(innerWidth / 16, 28, 90));
    parts = Array.from({ length: n }, () => ({
      x: Math.random() * W, y: Math.random() * H,
      s: (1 + Math.random() * 2.6) * dpr, v: .3 + Math.random() * .8,
      ph: Math.random() * 6.28, c: Math.random() < .72 ? 0 : 1,
    }));
  };
  const drawParticles = time => {
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    const drift = 1 + Math.min(Math.abs(velocity) * .04, 6);
    for (const p of parts) {
      const vy = lerp(-p.v * .35, p.v * 2.4 * drift, cur);
      p.y += vy * dpr;
      p.x += Math.sin(time * .0006 + p.ph) * .35 * (1 - cur) * dpr;
      if (p.y < -40) p.y = H + 20; else if (p.y > H + 40) p.y = -30;
      const rx = p.s * lerp(1, .38, cur);
      const ry = p.s * lerp(1, 9, cur);
      const [r, g, b] = particleColors[p.c];
      ctx.fillStyle = `rgba(${r},${g},${b},${lerp(.12, .05, cur)})`;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, rx * 3.2, ry * lerp(3.2, 1.6, cur), 0, 0, 6.283); ctx.fill();
      ctx.fillStyle = `rgba(${r},${g},${b},${lerp(.55, .8, cur)})`;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, rx, ry, 0, 0, 6.283); ctx.fill();
    }
  };

  /* ---------- Marquee: reverses with scroll direction, speeds up with velocity ---------- */
  const track = $('#marqueeTrack');
  let mx = 0, dir = -1, skew = 0;
  const stepMarquee = () => {
    const half = track.scrollWidth / 2;
    const speed = .7 + Math.min(Math.abs(velocity) * .35, 22);
    if (velocity > .4) dir = -1; else if (velocity < -.4) dir = 1;
    mx += dir * speed;
    if (mx <= -half) mx += half; else if (mx > 0) mx -= half;
    skew = lerp(skew, clamp(-velocity * .12, -9, 9), .1);
    track.style.transform = `translate3d(${mx}px,0,0) skewX(${skew}deg)`;
  };

  /* ---------- Master loop ---------- */
  const frame = time => {
    velocity = lerp(velocity, scrollY - prevY, .2); prevY = scrollY;
    const target = smooth(clamp((scrollY - start) / (end - start), 0, 1));
    cur = reduced ? target : lerp(cur, target, .09);
    if (Math.abs(cur - last) > .0004) { apply(cur); last = cur; }
    p = lerp(p, clamp((scrollY - bTop) / bSpan, 0, 1), reduced ? 1 : .1);
    if (Math.abs(p - lastP) > .0003) { bridge.style.setProperty('--p', p.toFixed(4)); lastP = p; }
    const max = document.documentElement.scrollHeight - innerHeight;
    progressBar.style.transform = `scaleX(${max > 0 ? clamp(scrollY / max, 0, 1) : 0})`;
    if (!document.hidden && !reduced) { drawParticles(time); stepMarquee(); }
    requestAnimationFrame(frame);
  };
  measure(); apply(0); sizeCanvas();
  addEventListener('resize', () => { measure(); sizeCanvas(); });
  addEventListener('load', measure);
  requestAnimationFrame(frame);

  /* ---------- Videos: fade each in once playable; fallbacks stay underneath ---------- */
  $$('.bg__video').forEach(v => {
    const ready = () => v.classList.add('is-ready');
    if (v.readyState >= 3) ready();
    v.addEventListener('canplay', ready, { once: true });
    // error fires on the <source>, not the <video>
    $$('source', v).forEach(s => s.addEventListener('error', () => {
      if (!$$('source', v).some(x => x !== s && !x.dataset.failed)) v.remove();
      s.dataset.failed = '1';
    }));
    v.play?.().catch(() => {});
  });

  /* ---------- Nav ---------- */
  const nav = $('#nav');
  const onScroll = () => nav.classList.toggle('is-scrolled', scrollY > 40);
  addEventListener('scroll', onScroll, { passive: true }); onScroll();

  const links = $$('.nav__links a');
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      const id = e.target.dataset.nav || e.target.id;
      links.forEach(l => l.classList.toggle('is-active', l.getAttribute('href') === '#' + id));
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  $$('#about, .bento, #projects, #contact, .play').forEach(el => io.observe(el));

  /* ---------- Copy Discord handle ---------- */
  $$('.js-copy').forEach(btn => {
    btn.addEventListener('click', () => {
      navigator.clipboard.writeText('idan4k').then(() => {
        const status = $('.copied', btn);
        if (!status) return;
        status.hidden = false;
        setTimeout(() => { status.hidden = true; }, 2000);
      }).catch(err => console.error('Could not copy Discord handle: ', err));
    });
  });

  /* ---------- Cursor ring ---------- */
  if (finePointer) {
    const ring = $('#cursor');
    let x = innerWidth / 2, y = innerHeight / 2, cx = x, cy = y;
    addEventListener('mousemove', e => { x = e.clientX; y = e.clientY; }, { passive: true });
    document.addEventListener('mouseover', e => ring.classList.toggle('is-hover', !!e.target.closest('a, button, .card')));
    (function loop() {
      cx = lerp(cx, x, .2); cy = lerp(cy, y, .2);
      ring.style.transform = `translate(${cx}px, ${cy}px)`;
      requestAnimationFrame(loop);
    })();
  }

  /* ---------- Card spotlight + tilt ---------- */
  const cards = $$('.card');
  $$('.card, .spot').forEach(card => {
    const tilts = card.classList.contains('card');
    card.addEventListener('pointermove', e => {
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
      card.style.setProperty('--mx', `${px * 100}%`);
      card.style.setProperty('--my', `${py * 100}%`);
      if (tilts && !reduced && finePointer) {
        card.style.setProperty('--rx', `${((.5 - py) * 7).toFixed(2)}deg`);
        card.style.setProperty('--ry', `${((px - .5) * 9).toFixed(2)}deg`);
      }
    });
    card.addEventListener('pointerleave', () => { card.style.setProperty('--rx', '0deg'); card.style.setProperty('--ry', '0deg'); });
  });

  /* ---------- Project filter (with FLIP re-layout when GSAP is available) ---------- */
  const tabs = $$('.filters button');
  const bar = $('#filtersBar');
  const moveBar = () => {
    const a = $('.filters button.is-active');
    bar.style.left = a.offsetLeft + 'px'; bar.style.width = a.offsetWidth + 'px';
  };
  moveBar(); addEventListener('resize', moveBar);
  document.fonts?.ready.then(moveBar);

  let filterTimer;
  tabs.forEach(tab => tab.addEventListener('click', () => {
    const cat = tab.dataset.filter;
    tabs.forEach(t => t.classList.toggle('is-active', t === tab));
    moveBar();
    clearTimeout(filterTimer);
    const matches = c => cat === 'all' || c.dataset.category === cat;
    cards.forEach(c => { if (!matches(c)) c.classList.add('is-fading'); });
    filterTimer = setTimeout(() => {
      const before = new Map(cards.filter(c => !c.classList.contains('is-hidden')).map(c => [c, c.getBoundingClientRect()]));
      cards.forEach(c => c.classList.toggle('is-hidden', !matches(c)));
      cards.forEach(c => { if (matches(c)) requestAnimationFrame(() => c.classList.remove('is-fading')); });
      if (window.gsap) {
        cards.filter(c => before.has(c) && matches(c)).forEach(c => {
          const a = before.get(c), b = c.getBoundingClientRect();
          gsap.from(c, { x: a.left - b.left, y: a.top - b.top, duration: .8, ease: 'expo.out', clearProps: 'transform' });
        });
      }
      window.ScrollTrigger && ScrollTrigger.refresh();
    }, 230);
  }));

  /* =====================================================================
     GSAP layer: intro, reveals, word scrub, smooth scroll, magnetic buttons
     ===================================================================== */
  if (!window.gsap || !window.ScrollTrigger || reduced) {
    root.classList.remove('js');
    $('.preloader')?.remove();
    return;
  }
  gsap.registerPlugin(ScrollTrigger);

  /* Smooth scroll (Lenis) wired into ScrollTrigger; falls back to native */
  let lenis = null;
  if (window.Lenis) {
    lenis = new Lenis({ lerp: .085, wheelMultiplier: .95 });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(t => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
    $$('a[href^="#"]').forEach(a => a.addEventListener('click', e => {
      const target = $(a.getAttribute('href'));
      if (!target) return;
      e.preventDefault();
      lenis.scrollTo(target, { offset: a.getAttribute('href') === '#about' ? 0 : -70, duration: 1.6 });
    }));
  }

  /* Split text */
  const nameIn = $('.hero__name .mask__in');
  nameIn.innerHTML = [...nameIn.textContent].map(c => c === ' ' ? ' ' : `<span class="ch">${c}</span>`).join('');
  gsap.set(nameIn, { y: 0 });
  gsap.set('.ch', { yPercent: 115, rotate: 7, opacity: 0 });

  const bt = $('#bridgeText');
  bt.innerHTML = bt.textContent.trim().split(/\s+/).map(w => `<span class="w">${w}</span>`).join(' ');
  const words = $$('.w', bt);
  // the words that name what I build get the accent treatment
  const idx = re => words.findIndex(w => re.test(w.textContent));
  const gi = idx(/^gameplay/i), mi = idx(/^mechanics/i), ti = idx(/^tool/i);
  [gi, gi + 1, mi, ti, ti + 1].forEach(i => words[i]?.classList.add('key'));

  /* Intro */
  gsap.timeline({ defaults: { ease: 'expo.out' } })
    .from('.preloader span', { opacity: 0, y: 20, duration: 1.1 })
    .to('.preloader span', { opacity: 0, y: -14, duration: .7, ease: 'power2.in' }, '+=.3')
    .to('.preloader', { opacity: 0, duration: .9, ease: 'power1.inOut' }, '<+.2')
    .from('.bg__nature', { scale: 1.18, duration: 3 }, '<')
    .from('.nav', { opacity: 0, y: -18, duration: 1 }, '<+.3')
    .to('.ch', { yPercent: 0, rotate: 0, opacity: 1, duration: 1.3, stagger: .045 }, '<+.1')
    .to('.hero .rv', { opacity: 1, y: 0, duration: 1.1, stagger: .11, onComplete() { $$('.hero .rv').forEach(el => { el.classList.add('in'); el.style.removeProperty('opacity'); el.style.removeProperty('transform'); }); } }, '<+.45')
    .set('.preloader', { display: 'none' });

  /* Hero drifts away as you scroll */
  gsap.to('.hero__in', {
    yPercent: -10, opacity: .15, ease: 'none',
    scrollTrigger: { trigger: '.hero', start: 'center top', end: 'bottom top', scrub: true }
  });

  /* Bridge: words light up while the world changes behind them; the matching phase highlights */
  const STAG = .12, total = (words.length - 1) * STAG + 1;
  const phaseAt = [gi, mi, ti].map(i => i * STAG);
  const phases = $$('#phases li');
  let phaseNow = -2;
  gsap.to(words, {
    opacity: 1, stagger: STAG, ease: 'none',
    scrollTrigger: {
      trigger: '#bridge', start: 'top 45%', end: 'bottom 120%', scrub: .6,
      onUpdate: self => {
        const at = self.progress * total;
        let now = -1;
        phaseAt.forEach((t, i) => { if (at >= t) now = i; });
        if (now !== phaseNow) { phaseNow = now; phases.forEach((li, i) => li.classList.toggle('is-on', i === now)); }
      }
    }
  });

  /* Sections rise into view */
  ScrollTrigger.batch('.sc', {
    start: 'top 90%', once: true,
    onEnter: els => gsap.to(els, {
      opacity: 1, y: 0, duration: 1.1, stagger: .12, ease: 'expo.out',
      // hand control back to CSS so hover, tilt and filter transitions work
      onComplete: () => els.forEach(el => { el.classList.add('in'); el.style.removeProperty('opacity'); el.style.removeProperty('transform'); })
    })
  });

  /* Counters tick up once when they scroll into view */
  $$('[data-count]').forEach(el => {
    const target = +el.dataset.count, o = { v: 0 };
    el.textContent = '0';
    ScrollTrigger.create({
      trigger: el, start: 'top 92%', once: true,
      onEnter: () => gsap.to(o, { v: target, duration: 1.8, ease: 'power3.out', onUpdate: () => { el.textContent = Math.round(o.v); } })
    });
  });

  /* Footer wordmark slides in */
  gsap.from('.footer__big', { yPercent: 40, opacity: 0, ease: 'none', scrollTrigger: { trigger: '.footer', start: 'top 100%', end: 'top 55%', scrub: true } });

  /* Magnetic buttons */
  if (finePointer) {
    $$('.magnetic').forEach(el => {
      const qx = gsap.quickTo(el, 'x', { duration: .5, ease: 'power3' });
      const qy = gsap.quickTo(el, 'y', { duration: .5, ease: 'power3' });
      el.addEventListener('mousemove', e => {
        const r = el.getBoundingClientRect();
        qx((e.clientX - r.left - r.width / 2) * .28);
        qy((e.clientY - r.top - r.height / 2) * .38);
      });
      el.addEventListener('mouseleave', () => { qx(0); qy(0); });
    });
  }

  addEventListener('load', () => { ScrollTrigger.refresh(); measure(); });
})();
