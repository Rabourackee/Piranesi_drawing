'use strict';
/* UI: sketch input, tools, view modes, parameters, progressive etching and export. */
(() => {
  const W = 800, H = 1060, S = 2;
  const PLATE = { x: 36, y: 36, w: W - 72, h: H - 108 };
  const $ = s => document.querySelector(s);
  const qs = new URLSearchParams(location.search);

  const frame = $('#frame'), etchCv = $('#etch'), sk = $('#sketch');
  etchCv.width = W * S; etchCv.height = H * S;
  const ectx = etchCv.getContext('2d');
  const ink = document.createElement('canvas');
  ink.width = W * S; ink.height = H * S;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  sk.width = Math.round(W * dpr); sk.height = Math.round(H * dpr);
  const sctx = sk.getContext('2d');

  const state = {
    strokes: [],
    tool: 'auto',
    z: 1,
    vp: G.P(W * 0.5, H * 0.57),
    seed: +qs.get('seed') || 1 + Math.floor(Math.random() * 99999),
    view: 'sketch',
    params: { depth: 1, imagination: 0.75, darkness: 0.7, density: 1, fog: 0.5, wear: 0.55, hand: 0.7, sketch: 0.7, age: 0.35, brush: 34, plants: 1, people: 1 },
  };

  const TOOLS = [
    ['auto', 'Auto', 'A', '<path d="M4 20l9-9M13 11l5-7 2 2-7 5M4 20l2-5 3 3z"/>'],
    ['pier', 'Pier', '1', '<rect x="8" y="3" width="8" height="18"/><path d="M6 21h12M6 3h12M8 9h8M8 15h8"/>'],
    ['arch', 'Arch', '2', '<path d="M4 21V11a8 8 0 0 1 16 0v10M8 21v-9a4 4 0 0 1 8 0v9"/>'],
    ['beam', 'Bridge', '3', '<path d="M2 12h20v4H2zM3 12V7h18v5M7 7v5M11 7v5M15 7v5M19 7v5"/>'],
    ['stair', 'Stair', '4', '<path d="M3 21h4v-4h4v-4h4V9h4V5h2"/>'],
    ['chain', 'Chain', '5', '<ellipse cx="7" cy="9" rx="4" ry="2.5"/><path d="M11 11l2 1"/><ellipse cx="17" cy="13" rx="4" ry="2.5"/>'],
    ['hang', 'Lantern', '6', '<path d="M12 2v8M9 10h6l-1 7h-4zM12 17v3"/>'],
    ['window', 'Window', '7', '<rect x="5" y="4" width="14" height="16"/><path d="M9 4v16M13 4v16M5 10h14M5 15h14"/>'],
    ['figure', 'Figure', '8', '<circle cx="12" cy="5" r="2"/><path d="M12 7l-3 7h6zM10 14l-1 7M14 14l1 7M13 9l5-4"/>'],
    ['rope', 'Rope', '9', '<path d="M3 6c4 0 4 12 9 12s5-12 9-12"/>'],
    ['shade', 'Shadow', 'S', '<path d="M4 20c3-1 4-5 8-9s7-6 8-7c-1 2-2 6-6 10s-8 6-10 6z" fill="currentColor" fill-opacity=".35"/>'],
    ['light', 'Light', 'L', '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>'],
    ['erase', 'Erase', 'E', '<path d="M4 16l9-9 6 6-7 7H7zM9 20h11"/>'],
    ['vp', 'Vantage', 'V', '<circle cx="12" cy="12" r="2"/><path d="M12 12L2 3M12 12L22 3M12 12L2 21M12 12L22 21M1 12h22"/>'],
  ];
  const KIND = {
    pier: ['pier', '#8a5527'], arch: ['arch', '#8a2f2a'], beam: ['bridge', '#2e5f86'], stair: ['stair', '#3e7039'],
    chain: ['chain', '#5d4a86'], hang: ['lantern', '#5d4a86'], window: ['window', '#8a6d1f'], figure: ['figure', '#333'], rope: ['rope', '#6d5a37'],
  };
  const SLIDERS = [
    ['depth', 'Depth of vaults', 0.3, 2.2, 0.05],
    ['imagination', 'Imagination', 0, 1, 0.05],
    ['darkness', 'Darkness', 0, 1, 0.05],
    ['density', 'Line density', 0.6, 1.6, 0.05],
    ['fog', 'Atmosphere', 0, 1, 0.05],
    ['wear', 'Ruin & wear', 0, 1, 0.05],
    ['hand', 'Hand tremor', 0, 1.5, 0.05],
    ['sketch', 'Sketchiness', 0, 1, 0.05],
    ['age', 'Age of paper', 0, 1, 0.05],
    ['brush', 'Shadow brush', 10, 90, 1],
  ];

  /* ---------- UI construction ---------- */
  const toolBox = $('#tools');
  for (const [id, label, key, svg] of TOOLS) {
    const b = document.createElement('button');
    b.className = 'tool' + (id === state.tool ? ' on' : '');
    b.dataset.tool = id;
    b.title = `${label} (${key})`;
    b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${svg}</svg><span>${label}</span><kbd>${key}</kbd>`;
    b.onclick = () => setTool(id);
    toolBox.appendChild(b);
  }
  function setTool(id) {
    state.tool = id;
    toolBox.querySelectorAll('.tool').forEach(b => b.classList.toggle('on', b.dataset.tool === id));
    sk.style.cursor = id === 'vp' ? 'move' : id === 'erase' ? 'cell' : 'crosshair';
  }
  $('#layers').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    state.z = +b.dataset.z;
    $('#layers').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  });
  $('#views').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setView(b.dataset.view); });

  const sliderBox = $('#sliders');
  for (const [key, label, min, max, step] of SLIDERS) {
    const d = document.createElement('div');
    d.className = 'slider';
    d.innerHTML = `<label for="s_${key}">${label} <span id="v_${key}"></span></label><input id="s_${key}" type="range" min="${min}" max="${max}" step="${step}" value="${state.params[key]}">`;
    sliderBox.appendChild(d);
    const inp = d.querySelector('input'), out = d.querySelector('span');
    const show = () => { out.textContent = key === 'brush' ? `${inp.value}px` : (+inp.value).toFixed(2); };
    show();
    inp.addEventListener('input', () => { state.params[key] = +inp.value; show(); });
    inp.addEventListener('change', () => { if (key !== 'brush' && etched) etch(false); });
  }

  /* ---------- plants and people ---------- */
  // each toggle appears twice: in the full panel and in the minimal bar
  const toggles = { plants: [$('#btnPlants'), $('#qPlants')], people: [$('#btnPeople'), $('#qPeople')] };
  const showToggles = () => {
    for (const [k, bs] of Object.entries(toggles)) for (const b of bs) { b.classList.toggle('on', !!state.params[k]); b.setAttribute('aria-pressed', String(!!state.params[k])); }
  };
  const flip = k => { state.params[k] = state.params[k] ? 0 : 1; showToggles(); if (etched) etch(false); };
  for (const [k, bs] of Object.entries(toggles)) for (const b of bs) b.onclick = () => flip(k);

  /* ---------- minimal or full interface ---------- */
  const setMinimal = on => {
    document.body.classList.toggle('minimal', on);
    $('#btnUI').setAttribute('aria-expanded', String(!on));
    $('#btnUI').title = on ? 'Show all tools and settings' : 'Hide the tools and settings';
    $('#btnUI').setAttribute('aria-label', $('#btnUI').title);
    try { localStorage.setItem('carceri.ui', on ? 'minimal' : 'full'); } catch (e) { /* storage unavailable */ }
  };
  $('#btnUI').onclick = () => setMinimal(!document.body.classList.contains('minimal'));
  {
    let saved = null;
    try { saved = localStorage.getItem('carceri.ui'); } catch (e) { /* storage unavailable */ }
    const want = qs.get('ui') || saved;
    if (want === 'full') setMinimal(false);
  }

  /* ---------- views ---------- */
  function setView(v) {
    state.view = v;
    frame.dataset.view = v;
    $('#views').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
    if (v !== 'sketch' && !etched) etch($('#chkAnim').checked);
    drawSketch();
  }

  /* ---------- sketch layer ---------- */
  let current = null, dragVP = false, erasing = false, raf = 0;
  const requestDraw = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; drawSketch(); }); };

  function strokePath(c, pts) {
    c.beginPath();
    c.moveTo(pts[0].x, pts[0].y);
    if (pts.length === 1) { c.lineTo(pts[0].x + 0.1, pts[0].y); return; }
    for (let i = 1; i < pts.length - 1; i++) {
      const m = G.lerp(pts[i], pts[i + 1], 0.5);
      c.quadraticCurveTo(pts[i].x, pts[i].y, m.x, m.y);
    }
    const l = pts[pts.length - 1];
    c.lineTo(l.x, l.y);
  }

  function drawSketch() {
    const c = sctx, v = state.view;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    const alpha = v === 'sketch' ? 1 : v === 'overlay' ? 0.6 : 0;
    if (v === 'sketch') {
      c.fillStyle = '#f3ede0';
      c.fillRect(0, 0, W, H);
      c.strokeStyle = 'rgba(80,60,40,.35)';
      c.lineWidth = 1;
      c.strokeRect(PLATE.x, PLATE.y, PLATE.w, PLATE.h);
    }
    if (alpha > 0) {
      // perspective guides
      const vp = state.vp;
      c.save();
      c.globalAlpha = alpha;
      c.strokeStyle = 'rgba(150,80,40,.28)';
      c.setLineDash([4, 6]);
      c.beginPath();
      c.moveTo(PLATE.x, vp.y); c.lineTo(PLATE.x + PLATE.w, vp.y);
      for (const [x, y] of [[PLATE.x, PLATE.y], [PLATE.x + PLATE.w, PLATE.y], [PLATE.x, PLATE.y + PLATE.h], [PLATE.x + PLATE.w, PLATE.y + PLATE.h]]) { c.moveTo(vp.x, vp.y); c.lineTo(x, y); }
      c.stroke();
      c.setLineDash([]);
      c.strokeStyle = 'rgba(150,60,30,.8)';
      c.lineWidth = 1.4;
      c.beginPath(); c.arc(vp.x, vp.y, 6, 0, Math.PI * 2); c.moveTo(vp.x - 11, vp.y); c.lineTo(vp.x + 11, vp.y); c.moveTo(vp.x, vp.y - 11); c.lineTo(vp.x, vp.y + 11); c.stroke();
      c.restore();
    }
    const list = alpha > 0 ? state.strokes : [];
    c.lineCap = 'round';
    c.lineJoin = 'round';
    for (const s of list) {
      c.save();
      c.globalAlpha = alpha;
      if (s.kind === 'shade' || s.kind === 'light') {
        c.strokeStyle = s.kind === 'shade' ? 'rgba(60,45,35,.22)' : 'rgba(255,236,170,.55)';
        c.lineWidth = s.r * 2;
        strokePath(c, s.pts);
        c.stroke();
      } else {
        c.strokeStyle = s.z > 2 ? 'rgba(52,62,74,.45)' : s.z > 1 ? 'rgba(52,62,74,.7)' : 'rgba(42,50,60,.95)';
        c.lineWidth = s.z > 2 ? 1.2 : s.z > 1 ? 1.7 : 2.3;
        strokePath(c, s.pts);
        c.stroke();
        const k = KIND[s.kind];
        if (k) {
          const bb = G.bbox(s.pts);
          c.font = 'italic 13px "Cormorant Garamond", Georgia, serif';
          c.fillStyle = k[1];
          c.fillText(k[0] + (s.z > 2 ? ' · far' : s.z > 1 ? ' · mid' : ''), bb.x0 + 4, Math.max(14, bb.y0 - 5));
        }
      }
      c.restore();
    }
    if (current) {
      c.strokeStyle = current.tool === 'shade' ? 'rgba(60,45,35,.25)' : current.tool === 'light' ? 'rgba(255,236,170,.6)' : 'rgba(42,50,60,.95)';
      c.lineWidth = current.tool === 'shade' || current.tool === 'light' ? current.r * 2 : 2.3;
      strokePath(c, current.pts);
      c.stroke();
    }
  }

  function toLocal(e) {
    const b = sk.getBoundingClientRect();
    return G.P(((e.clientX - b.left) / b.width) * W, ((e.clientY - b.top) / b.height) * H);
  }
  const clampVP = p => G.P(G.clamp(p.x, PLATE.x + 20, PLATE.x + PLATE.w - 20), G.clamp(p.y, PLATE.y + 40, PLATE.y + PLATE.h - 60));

  function eraseAt(p) {
    const n = state.strokes.length;
    state.strokes = state.strokes.filter(s => !s.pts.some(q => G.dist(q, p) < Math.max(12, (s.r || 0) * 0.6)));
    if (state.strokes.length !== n) { requestDraw(); scheduleLive(); }
  }

  sk.addEventListener('pointerdown', e => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    sk.setPointerCapture(e.pointerId);
    const p = toLocal(e);
    clearTimeout(liveTimer);
    if (state.view === 'etch') setView('overlay');
    if (state.tool === 'vp') { dragVP = true; state.vp = clampVP(p); requestDraw(); return; }
    if (state.tool === 'erase') { erasing = true; eraseAt(p); return; }
    current = { pts: [p], tool: state.tool, z: state.z, r: state.params.brush };
    requestDraw();
  });
  sk.addEventListener('pointermove', e => {
    if (!current && !dragVP && !erasing) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of evs.length ? evs : [e]) {
      const p = toLocal(ev);
      if (dragVP) state.vp = clampVP(p);
      else if (erasing) eraseAt(p);
      else if (current && G.dist(p, current.pts[current.pts.length - 1]) > 1.5) current.pts.push(p);
    }
    requestDraw();
  });
  const end = () => {
    if (dragVP) { dragVP = false; scheduleLive(); }
    erasing = false;
    if (!current) return;
    const s = current;
    current = null;
    const t = s.tool;
    s.kind = t === 'auto' ? Interp.classify(s.pts) : t;
    state.strokes.push({ pts: s.pts, kind: s.kind, z: s.z, r: s.r });
    const k = KIND[s.kind];
    setStatus(k ? `Read as ${k[0]}${t === 'auto' ? '' : ' (forced)'}.` : s.kind === 'shade' ? 'Shadow laid.' : 'Light lifted.');
    requestDraw();
    scheduleLive();
  };
  sk.addEventListener('pointerup', end);
  sk.addEventListener('pointercancel', end);

  /* ---------- etching ---------- */
  let paper = null, paperKey = '', etched = false, job = 0, liveTimer = 0, numeral = '';
  const prog = $('#progress span');
  const setStatus = t => { $('#status').textContent = t; $('#qstatus').textContent = t; };

  function scheduleLive() {
    clearTimeout(liveTimer);
    if (!$('#chkLive').checked) return;
    liveTimer = setTimeout(() => etch(false), 700);
  }
  function ensurePaper() {
    const key = state.seed + ':' + state.params.age;
    if (key !== paperKey) { paper = Paper.make(W, H, S, PLATE, state.seed, state.params.age); paperKey = key; }
  }
  const canBlur = typeof ectx.filter === 'string';
  function composite(final) {
    ectx.globalCompositeOperation = 'source-over';
    ectx.globalAlpha = 1;
    ectx.drawImage(paper, 0, 0);
    ectx.globalCompositeOperation = 'multiply';
    if (final && canBlur) {
      // a whisper of ink spread into the paper fibres
      ectx.filter = 'blur(1.1px)';
      ectx.globalAlpha = 0.3;
      ectx.drawImage(ink, 0, 0);
      ectx.filter = 'none';
      ectx.globalAlpha = 1;
    }
    ectx.drawImage(ink, 0, 0);
    ectx.globalCompositeOperation = 'source-over';
  }
  function etch(animate) {
    if (job) { cancelAnimationFrame(job); job = 0; }
    clearTimeout(liveTimer);
    // the prison grows only out of what is drawn: an empty sketch etches nothing
    if (!state.strokes.some(s => s.kind !== 'shade' && s.kind !== 'light')) {
      etched = false;
      setView('sketch');
      setStatus('Nothing to etch yet: draw a pier, an arch, a stair or a bridge first.');
      return;
    }
    const t0 = performance.now();
    ensurePaper();
    const out = Engine.compose({ strokes: state.strokes, vp: state.vp, seed: state.seed, params: state.params, plate: PLATE, W, H });
    const ops = out.ops;
    numeral = out.numeral;
    ink.width = ink.width;
    const ictx = ink.getContext('2d');
    ictx.setTransform(S, 0, 0, S, 0, 0);
    ictx.fillStyle = '#fff';
    ictx.fillRect(0, 0, W, H);
    ictx.lineCap = 'round';
    ictx.lineJoin = 'round';
    etched = true;
    if (state.view === 'sketch') setView('etch');
    const nStrokes = state.strokes.filter(s => s.kind !== 'shade' && s.kind !== 'light').length;
    const done = () => {
      prog.style.width = '0';
      setStatus(`Tav. ${numeral} · seed ${state.seed} · ${nStrokes} strokes · ${ops.length.toLocaleString()} burin cuts · ${Math.round(performance.now() - t0)} ms`);
    };
    if (!animate) { Plate.play(ictx, ops, 0, ops.length); composite(true); done(); return; }
    let i = 0;
    const per = Math.max(250, Math.ceil(ops.length / 150));
    setStatus('Etching…');
    const step = () => {
      const e = Math.min(ops.length, i + per);
      Plate.play(ictx, ops, i, e);
      i = e;
      composite(i >= ops.length);
      prog.style.width = `${(100 * i) / ops.length}%`;
      if (i < ops.length) job = requestAnimationFrame(step);
      else { job = 0; done(); }
    };
    job = requestAnimationFrame(step);
  }

  /* ---------- buttons & keys ---------- */
  $('#btnEtch').onclick = () => etch($('#chkAnim').checked);
  $('#qEtch').onclick = () => etch($('#chkAnim').checked);
  $('#btnReimagine').onclick = () => { state.seed = 1 + Math.floor(Math.random() * 99999); etch($('#chkAnim').checked); };
  $('#btnExample').onclick = () => loadExample(true);
  $('#btnUndo').onclick = undo;
  $('#btnClear').onclick = () => { state.strokes = []; drawSketch(); setView('sketch'); setStatus('Plate cleared.'); };
  $('#btnSave').onclick = () => {
    if (!etched) etch(false);
    etchCv.toBlob(b => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = `carceri-tav-${numeral}-seed${state.seed}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
  };
  function undo() { state.strokes.pop(); drawSketch(); scheduleLive(); }
  function loadExample(animate, which) {
    state.strokes = which === 2 || which === true ? Example.minimal() : which === 3 ? Example.variety() : which === 4 ? Example.pillars() : which === 5 ? Example.distance() : which === 6 ? Example.random(+(qs.get('sk') || 1)) : Example.strokes();
    state.vp = G.P(Example.vp.x, Example.vp.y);
    drawSketch();
    etch(animate && $('#chkAnim').checked);
  }
  const KEYS = { a: 'auto', 1: 'pier', 2: 'arch', 3: 'beam', 4: 'stair', 5: 'chain', 6: 'hang', 7: 'window', 8: 'figure', 9: 'rope', s: 'shade', l: 'light', e: 'erase', v: 'vp' };
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); undo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (k === 'enter') etch($('#chkAnim').checked);
    else if (k === 'r') $('#btnReimagine').onclick();
    else if (k === 'p') flip('plants');
    else if (k === 'o') flip('people');
    else if (KEYS[k]) setTool(KEYS[k]);
  });

  /* ---------- boot ---------- */
  frame.dataset.view = state.view;
  if (qs.has('full')) document.body.classList.add('full');
  drawSketch();
  for (const k of Object.keys(state.params)) if (qs.has(k)) state.params[k] = +qs.get(k);
  showToggles();
  const boot = () => {
    if (qs.has('demo')) {
      const v = qs.get('view');
      if (qs.get('demo') === '0') { state.strokes = []; etch(false); }
      else loadExample(!qs.has('noanim'), +qs.get('demo'));
      if (qs.has('vpx')) { state.vp = G.P(+qs.get('vpx'), +qs.get('vpy')); drawSketch(); etch(false); }
      if (v) setView(v);
    }
  };
  if (qs.has('bench')) boot(); // synchronous run, used to time the engine headlessly
  else (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(boot, boot);
  window.addEventListener('error', e => { setStatus('Error: ' + e.message); document.title = 'ERR ' + e.message; });
  window.__carceri = { state, etch };
})();
