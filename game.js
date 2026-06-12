/* ============================================================
   FRUIT RUN — prototype
   A one-tap musical auto-runner. All art is drawn procedurally
   as flat "cut-paper" shapes — no image assets.
   ============================================================ */

(() => {
  'use strict';

  // ---------------------------------------------------------
  //  Palette (the soft cut-paper meadow)
  // ---------------------------------------------------------
  const C = {
    skyTop: '#F7D9C4', skyBot: '#CFE6E2',
    hillFar: '#CBD6CB', hillMid: '#A9C4B5', hillNear: '#8FB29B',
    ground: '#E9DAB6', groundStripe: '#DDCB9F', groundEdge: '#CBB78C',
    foliage: ['#7FA98C', '#6E9DA6', '#9DB8A0'],
    foliageShade: ['#6E977B', '#5E8A93', '#89A48C'],
    trunk: '#C9A98B', trunkShade: '#B8987B',
    fruitRed: '#E07A6B', fruitRedShade: '#C96A5C',
    fruitOrange: '#EBA86B', fruitOrangeShade: '#D8924F',
    mother: '#A0697E', motherBelly: '#C98BA0', motherWing: '#8E5A6E',
    chick: '#C089A0', chickBelly: '#D7A6BC', chickWing: '#AB7790',
    mikey: '#E8915A', mikeyBelly: '#F2AE83', mikeyWing: '#D67C46',
    amber: '#E8A857', leg: '#D9954A',
    rock: '#A6A2AC', rockShade: '#928E9A', rockTop: '#B7B3BD',
    eye: '#4A3A42', ink: '#5A4A52',
  };

  // ---------------------------------------------------------
  //  Canvas / scaling
  // ---------------------------------------------------------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, DPR = 1;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  const groundY = () => H * 0.82;           // top of the grass
  const motherScreenX = () => W * 0.30;     // mother's fixed horizontal anchor

  // ---------------------------------------------------------
  //  Beat clock — the whole scene breathes to one tune (120 BPM)
  // ---------------------------------------------------------
  const BPM = 120;
  const beatLen = 60 / BPM;                  // seconds per beat
  let songTime = 0;
  // phase 0..1 within a beat; bob = gentle sine, flap pulse near beat
  const beatPhase = () => (songTime % beatLen) / beatLen;
  const bob = (off = 0) => Math.sin((songTime / beatLen + off) * Math.PI * 2);

  // ---------------------------------------------------------
  //  Simple procedural music (WebAudio) — festive looping arpeggio
  // ---------------------------------------------------------
  const Music = (() => {
    let actx = null, master = null, on = true, started = false, step = 0, nextTime = 0, timer = null;
    const scale = [0, 2, 4, 7, 9];           // major pentatonic — warm & festive
    const bass = [0, 0, -5, -3];
    function freq(semi) { return 220 * Math.pow(2, semi / 12); }
    function blip(t, f, dur, type, gain) {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type; o.frequency.value = f;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(master);
      o.start(t); o.stop(t + dur + 0.02);
    }
    function schedule() {
      const sixteenth = beatLen / 2;          // eighth notes
      while (nextTime < actx.currentTime + 0.15) {
        const bar = Math.floor(step / 8);
        const inBar = step % 8;
        const note = scale[(step * 2 + (bar % 3)) % scale.length] + (inBar % 4 === 0 ? 12 : 7);
        blip(nextTime, freq(note + 12), 0.18, 'triangle', 0.10);
        if (inBar % 2 === 0) blip(nextTime, freq(note + 24), 0.10, 'sine', 0.05);
        if (inBar % 4 === 0) blip(nextTime, freq(bass[bar % bass.length] - 12), 0.32, 'sawtooth', 0.06);
        nextTime += sixteenth;
        step++;
      }
    }
    return {
      get on() { return on; },
      toggle() { on = !on; if (master) master.gain.value = on ? 0.5 : 0; return on; },
      start() {
        if (started) return;
        try {
          actx = new (window.AudioContext || window.webkitAudioContext)();
          master = actx.createGain();
          master.gain.value = on ? 0.5 : 0;
          master.connect(actx.destination);
          nextTime = actx.currentTime + 0.05;
          timer = setInterval(schedule, 25);
          started = true;
        } catch (e) { /* audio optional */ }
      },
      resume() { if (actx && actx.state === 'suspended') actx.resume(); },
    };
  })();

  // ---------------------------------------------------------
  //  Game state
  // ---------------------------------------------------------
  const RUN_TIME = 90;          // seconds (one "song")
  const SCROLL = 250;           // world px / second
  const GRAVITY = 2100;
  const JUMP_V = -760;
  const FLAP_ACC = -3400;       // while holding (must exceed gravity to climb)
  const MAX_UP = -430;          // cap climb speed
  const STAMINA_MAX = 1.0;
  const STAMINA_DRAIN = 1.35;   // per second of flapping  -> flight doesn't come easy
  const STAMINA_REGEN = 0.55;   // per second on the ground

  let state = 'start';          // start | play | end
  let scroll = 0;               // world distance scrolled (px)
  let timeLeft = RUN_TIME;
  let score = 0;
  let holding = false;
  let lastTap = 0;

  const mother = {
    y: 0, vy: 0, grounded: true,
    stamina: STAMINA_MAX,
    flap: 0,                    // visual wing phase
    invuln: 0,
  };

  // mother's y-history keyed by world distance, so chicks can trail behind
  const trail = [];             // {d, y, flying}
  const TRAIL_MAX = 900;

  let chicks = [];              // {kind:'chick'|'mikey', lag, y, vy, eat, ...}
  const flyoffs = [];           // scattered chicks animating away
  const pops = [];              // fruit-eaten paper pops
  const leaves = [];            // ambient drifting leaves

  // world props (in world-space x). screenX = x - scroll
  let trees = [], rocks = [];
  let nextFeatureX = 0;

  // ---------------------------------------------------------
  //  Spawning — procedural terrain that recycles as it scrolls
  // ---------------------------------------------------------
  function rand(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

  function difficulty() {
    // ramps 0 -> 1 across the run
    return Math.min(1, (RUN_TIME - timeLeft) / RUN_TIME);
  }

  function makeTree(x, isBush) {
    const tones = (Math.random() * C.foliage.length) | 0;
    const r = pick(isBush ? [46, 62, 74] : [54, 70, 88]);
    const trunkH = isBush ? 0 : rand(60, 150);
    const rotating = !isBush && Math.random() < 0.28;
    // fruit arranged identically per radius: ring + centre
    const fruits = [];
    const ringN = r < 60 ? 5 : r < 80 ? 7 : 9;
    const orange = Math.random() < 0.18; // some trees carry an orange fruit
    for (let i = 0; i < ringN; i++) {
      const a = (i / ringN) * Math.PI * 2 - Math.PI / 2;
      fruits.push({
        ox: Math.cos(a) * r * 0.62,
        oy: Math.sin(a) * r * 0.62,
        eaten: false,
        orange: orange && i === 0,
      });
    }
    fruits.push({ ox: 0, oy: 0, eaten: false, orange: false });
    return {
      x, isBush, r, trunkH, rotating,
      spin: rand(0, Math.PI * 2),
      spinDir: Math.random() < 0.5 ? 1 : -1,
      toneA: C.foliage[tones], toneB: C.foliageShade[tones],
      fruits,
    };
  }

  function makeRock(x) {
    const w = rand(38, 64);
    return { x, w, h: w * rand(0.5, 0.72), hit: false };
  }

  function spawnAhead() {
    const edge = scroll + W + 120;
    while (nextFeatureX < edge) {
      const d = difficulty();
      const roll = Math.random();
      if (roll < 0.14 + d * 0.16) {
        rocks.push(makeRock(nextFeatureX));
        nextFeatureX += rand(220, 360) - d * 60;
      } else {
        const isBush = Math.random() < 0.4;
        trees.push(makeTree(nextFeatureX, isBush));
        nextFeatureX += rand(150, 300);
      }
    }
    trees = trees.filter(t => t.x - scroll > -200);
    rocks = rocks.filter(r => r.x - scroll > -120);
  }

  // ---------------------------------------------------------
  //  Reset / start
  // ---------------------------------------------------------
  function reset() {
    scroll = 0; timeLeft = RUN_TIME; score = 0; songTime = 0;
    holding = false;
    mother.y = groundY(); mother.vy = 0; mother.grounded = true;
    mother.stamina = STAMINA_MAX; mother.flap = 0; mother.invuln = 0;
    trail.length = 0; flyoffs.length = 0; pops.length = 0;
    chicks = []; trees = []; rocks = []; leaves.length = 0;
    nextFeatureX = W * 0.9;
    // a couple of starter chicks already in line, plus Mikey to find later
    addChick('chick'); addChick('chick');
    chickSpawnTimer = 4;
    mikeyInWorld = false; mikeyState = 'with';
    spawnAhead();
    for (let i = 0; i < 8; i++) leaves.push(newLeaf(Math.random() * W));
  }

  let chickSpawnTimer = 4;
  let mikeyInWorld = false;
  let mikeyState = 'with';   // with | frenzy | resting
  let mikeyRestX = 0;

  function addChick(kind) {
    const n = chicks.length;
    chicks.push({
      kind,
      lag: 70 + n * 46,        // world-px behind mother
      y: groundY(), vy: 0,
      yOff: rand(-10, 10),     // slightly different inertia -> catches missed fruit
      ease: rand(7, 10),
      flap: rand(0, 6),
    });
  }

  // ---------------------------------------------------------
  //  Input
  // ---------------------------------------------------------
  function press() {
    if (state !== 'play') return;
    Music.resume();
    holding = true;
    lastTap = songTime;
    if (mother.grounded) {
      mother.vy = JUMP_V;
      mother.grounded = false;
    }
  }
  function release() { holding = false; }

  canvas.addEventListener('pointerdown', press);
  window.addEventListener('pointerup', release);
  window.addEventListener('keydown', e => {
    if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); press(); }
  });
  window.addEventListener('keyup', e => {
    if (e.code === 'Space' || e.code === 'ArrowUp') release();
  });

  // ---------------------------------------------------------
  //  Update
  // ---------------------------------------------------------
  function update(dt) {
    songTime += dt;
    if (state !== 'play') return;

    timeLeft -= dt;
    if (timeLeft <= 0) { timeLeft = 0; endRun(true); return; }

    scroll += SCROLL * dt;
    spawnAhead();

    // --- Mother physics ---
    const gY = groundY();
    if (holding && !mother.grounded && mother.stamina > 0) {
      mother.vy += FLAP_ACC * dt;
      if (mother.vy < MAX_UP) mother.vy = MAX_UP;
      mother.stamina = Math.max(0, mother.stamina - STAMINA_DRAIN * dt);
      mother.flap += dt * 26;
    } else {
      mother.flap += dt * (mother.grounded ? 0 : 10);
    }
    mother.vy += GRAVITY * dt;
    mother.y += mother.vy * dt;
    if (mother.y >= gY) {
      mother.y = gY; mother.vy = 0;
      if (!mother.grounded) mother.grounded = true;
      mother.stamina = Math.min(STAMINA_MAX, mother.stamina + STAMINA_REGEN * dt);
    } else {
      mother.grounded = false;
    }
    if (mother.invuln > 0) mother.invuln -= dt;

    // --- record trail ---
    const mWorldX = scroll + motherScreenX();
    trail.push({ d: mWorldX, y: mother.y });
    if (trail.length > TRAIL_MAX) trail.shift();

    // --- chicks accumulate over time ---
    chickSpawnTimer -= dt;
    if (chickSpawnTimer <= 0 && chicks.filter(c => c.kind === 'chick').length < 3) {
      addChick('chick');
      chickSpawnTimer = 9999; // (more arrive via Mikey discovery below)
    }
    // Mikey appears resting in a tree partway through, to be "found"
    if (!mikeyInWorld && timeLeft < RUN_TIME * 0.72) {
      mikeyInWorld = true; mikeyState = 'with'; addChick('mikey');
    }

    updateChicks(dt);
    updateMikey(dt);

    // --- eating: mother + chicks beaks vs fruit ---
    eatPass(mWorldX, mother.y, 30, false);
    for (const c of chicks) {
      const cWorldX = mWorldX - c.lag;
      eatPass(cWorldX, c.y, 24, c.kind === 'mikey');
    }

    // --- rock collisions ---
    handleRocks(mWorldX);

    // --- rotating treetops ---
    for (const t of trees) if (t.rotating) t.spin += t.spinDir * dt * 0.7;

    // --- ambient + effects ---
    for (let i = pops.length - 1; i >= 0; i--) {
      const p = pops[i]; p.t += dt; p.x -= SCROLL * dt;
      if (p.t > 0.5) pops.splice(i, 1);
    }
    for (let i = flyoffs.length - 1; i >= 0; i--) {
      const f = flyoffs[i];
      f.t += dt; f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 120 * dt; f.rot += dt * 4;
      if (f.t > 1.6) flyoffs.splice(i, 1);
    }
    for (const lf of leaves) {
      lf.x -= (SCROLL * 0.4 + lf.drift) * dt;
      lf.y += lf.fall * dt;
      lf.rot += lf.spin * dt;
      if (lf.x < -30 || lf.y > gY) Object.assign(lf, newLeaf(W + rand(0, 200)));
    }
  }

  function eatPass(wx, wy, radius, isMikey) {
    for (const t of trees) {
      const sx = t.x - scroll;
      if (sx < -120 || sx > W + 120) continue;
      const topY = t.isBush ? groundY() - t.r * 0.7 : groundY() - t.trunkH - t.r * 0.5;
      for (const fr of t.fruits) {
        if (fr.eaten) continue;
        const ang = t.rotating ? t.spin : 0;
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const fx = sx + (fr.ox * ca - fr.oy * sa);
        const fy = topY + (fr.ox * sa + fr.oy * ca);
        const fwx = fx + scroll;
        if (Math.abs(fwx - wx) < radius && Math.abs(fy - wy) < radius) {
          fr.eaten = true;
          score += fr.orange ? 3 : 1;
          pops.push({ x: fx, y: fy, t: 0, orange: fr.orange });
          if (fr.orange && isMikey) triggerMikeyFrenzy();
        }
      }
    }
  }

  function handleRocks(mWorldX) {
    if (mother.invuln > 0) return;
    const feet = mother.y;
    for (const r of rocks) {
      if (r.hit) continue;
      const rTop = groundY() - r.h;
      const dx = Math.abs((r.x) - mWorldX);
      if (dx < r.w * 0.5 + 18 && feet > rTop - 6) {
        r.hit = true;
        loseChick();
        break;
      }
    }
  }

  function loseChick() {
    mother.invuln = 1.1;
    if (chicks.length === 0) { endRun(false); return; }
    // scatter the last bird in line
    const c = chicks.pop();
    const cWorldX = scroll + motherScreenX() - c.lag;
    flyoffs.push({
      x: cWorldX - scroll, y: c.y, vx: rand(-40, -120), vy: rand(-260, -360),
      rot: 0, t: 0, kind: c.kind,
    });
    if (c.kind === 'mikey') { mikeyInWorld = false; mikeyState = 'with'; }
  }

  function endRun(survived) {
    state = 'end';
    document.getElementById('hud').classList.add('hidden');
    document.getElementById('final-score').textContent = score;
    document.getElementById('end-title').textContent = survived ? 'Flown south' : 'Run’s end';
    document.getElementById('end-sub').textContent = survived
      ? 'The whole flock made it to warmer climes.'
      : 'The last of the flock scattered — rest now, fly tomorrow.';
    document.getElementById('end').classList.remove('hidden');
  }

  // ---------------------------------------------------------
  //  Chick following
  // ---------------------------------------------------------
  function sampleTrailY(worldX) {
    // find trail y at a given world distance (linear search from end)
    if (trail.length < 2) return mother.y;
    for (let i = trail.length - 1; i > 0; i--) {
      if (trail[i].d <= worldX) {
        const a = trail[i], b = trail[i + 1] || trail[i];
        const span = (b.d - a.d) || 1;
        const t = Math.max(0, Math.min(1, (worldX - a.d) / span));
        return a.y + (b.y - a.y) * t;
      }
    }
    return trail[0].y;
  }

  function updateChicks(dt) {
    const mWorldX = scroll + motherScreenX();
    for (const c of chicks) {
      if (c.kind === 'mikey' && mikeyState !== 'with') continue;
      const targetY = sampleTrailY(mWorldX - c.lag) + c.yOff;
      // spring toward target -> different inertia than mother
      const k = c.ease;
      c.vy += (targetY - c.y) * k * dt * 6;
      c.vy *= 0.86;
      c.y += c.vy * dt;
      const gY = groundY();
      if (c.y > gY) { c.y = gY; if (c.vy > 0) c.vy = 0; }
      c.flap += dt * (Math.abs(c.vy) > 30 ? 16 : 6);
    }
  }

  // ---------------------------------------------------------
  //  Mikey — the little orange one who goes nuts on orange fruit
  // ---------------------------------------------------------
  function getMikey() { return chicks.find(c => c.kind === 'mikey'); }

  function triggerMikeyFrenzy() {
    if (mikeyState !== 'with') return;
    mikeyState = 'frenzy';
    const m = getMikey();
    if (m) m.frenzyT = 0;
  }

  function updateMikey(dt) {
    const m = getMikey();
    if (!m) return;
    const gY = groundY();
    if (mikeyState === 'frenzy') {
      m.frenzyT = (m.frenzyT || 0) + dt;
      // zigzag up and down while racing ahead (his lag shrinks, even goes negative)
      m.lag -= 280 * dt;                       // pull ahead of mother
      m.y = gY - 90 - Math.abs(Math.sin(m.frenzyT * 7)) * 120;
      m.flap += dt * 30;
      // he hoovers up fruit near his position
      eatPass(scroll + motherScreenX() - m.lag, m.y, 40, true);
      if (m.frenzyT > 3.4) {
        // settle into a tree up ahead and wait to be found
        mikeyState = 'resting';
        const ahead = trees.find(t => !t.isBush && t.x - scroll > W * 0.6) || trees[trees.length - 1];
        mikeyRestX = ahead ? ahead.x : scroll + W * 0.9;
        m.restY = ahead ? groundY() - ahead.trunkH - ahead.r * 0.4 : gY - 120;
      }
    } else if (mikeyState === 'resting') {
      // he sits in the tree; when mother catches up he rejoins
      m.lag = (scroll + motherScreenX()) - mikeyRestX;
      m.y = m.restY;
      m.flap += dt * 3;
      if (m.lag <= 80) {                       // mother reached his tree
        mikeyState = 'with';
        m.lag = 70 + chicks.length * 46;
        m.frenzyT = 0;
      }
    }
  }

  // ---------------------------------------------------------
  //  Ambient leaves
  // ---------------------------------------------------------
  function newLeaf(x) {
    return {
      x, y: rand(-40, groundY() * 0.5),
      drift: rand(8, 30), fall: rand(14, 34),
      rot: rand(0, 6), spin: rand(-2, 2),
      size: rand(4, 8), tone: pick([C.coral || C.fruitRed, C.amber, C.foliage[0]]),
    };
  }

  // ===========================================================
  //  RENDER — everything as flat cut-paper shapes
  // ===========================================================
  function draw() {
    // sky (the one gradient)
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, C.skyTop); g.addColorStop(1, C.skyBot);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    drawSun();
    drawHills();
    drawGround();

    // props sorted so nearer (bigger) draw last is unnecessary; draw trees behind birds
    drawTrees();
    drawRocks();
    drawLeaves();

    drawFlyoffs();
    drawBirds();
    drawPops();
  }

  function drawSun() {
    const x = W * 0.78, y = H * 0.2, r = Math.min(W, H) * 0.09;
    ctx.fillStyle = 'rgba(247, 222, 196, 0.6)';
    ctx.beginPath(); ctx.arc(x, y, r * 1.5, 0, 7); ctx.fill();
    ctx.fillStyle = '#FBE9D2';
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  }

  function hillLayer(color, baseY, amp, len, speed, off) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, H);
    const ox = -(scroll * speed % len);
    for (let x = ox - len; x <= W + len; x += 8) {
      const y = baseY + Math.sin((x - ox) / len * Math.PI * 2 + off) * amp
                       + Math.sin((x - ox) / len * Math.PI * 6) * amp * 0.25;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
  }

  function drawHills() {
    const gy = groundY();
    hillLayer(C.hillFar,  gy - 130, 36, 520, 0.06, 0);
    hillLayer(C.hillMid,  gy - 78,  44, 420, 0.13, 1.7);
    hillLayer(C.hillNear, gy - 30,  30, 320, 0.24, 3.1);
  }

  function drawGround() {
    const gy = groundY();
    ctx.fillStyle = C.ground;
    ctx.fillRect(0, gy, W, H - gy);
    // soft top edge
    ctx.fillStyle = C.groundEdge;
    ctx.fillRect(0, gy, W, 4);
    // moving stripes for a sense of speed
    ctx.fillStyle = C.groundStripe;
    const sp = 90, ox = -(scroll % sp);
    for (let x = ox; x < W + sp; x += sp) {
      ctx.beginPath();
      ctx.ellipse(x, gy + 26, 26, 7, 0, 0, 7);
      ctx.fill();
    }
  }

  function shadow(x, y, w) {
    ctx.fillStyle = 'rgba(90, 74, 82, 0.10)';
    ctx.beginPath();
    ctx.ellipse(x, groundY() + 8, w, w * 0.22, 0, 0, 7);
    ctx.fill();
  }

  function drawTrees() {
    const gy = groundY();
    for (const t of trees) {
      const x = t.x - scroll;
      if (x < -140 || x > W + 140) continue;
      shadow(x, gy, t.r * 0.8);
      let topY;
      if (t.isBush) {
        topY = gy - t.r * 0.7;
      } else {
        // trunk slab
        ctx.fillStyle = C.trunkShade;
        ctx.fillRect(x - 7, gy - t.trunkH, 14, t.trunkH);
        ctx.fillStyle = C.trunk;
        ctx.fillRect(x - 7, gy - t.trunkH, 9, t.trunkH);
        topY = gy - t.trunkH - t.r * 0.5;
      }
      // foliage: a darker back disc + lighter front disc (paper layers)
      ctx.fillStyle = t.toneB;
      ctx.beginPath(); ctx.arc(x + 3, topY + 4, t.r, 0, 7); ctx.fill();
      ctx.fillStyle = t.toneA;
      ctx.beginPath(); ctx.arc(x, topY, t.r * 0.94, 0, 7); ctx.fill();

      // fruit
      const ang = t.rotating ? t.spin : 0;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      for (const fr of t.fruits) {
        if (fr.eaten) continue;
        const fx = x + (fr.ox * ca - fr.oy * sa);
        const fy = topY + (fr.ox * sa + fr.oy * ca);
        drawFruit(fx, fy, fr.orange);
      }
    }
  }

  function drawFruit(x, y, orange) {
    const r = 7;
    ctx.fillStyle = orange ? C.fruitOrangeShade : C.fruitRedShade;
    ctx.beginPath(); ctx.arc(x + 1, y + 1, r, 0, 7); ctx.fill();
    ctx.fillStyle = orange ? C.fruitOrange : C.fruitRed;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    // tiny leaf
    ctx.fillStyle = C.foliage[0];
    ctx.beginPath(); ctx.ellipse(x + 2, y - r, 3, 1.6, -0.7, 0, 7); ctx.fill();
  }

  function drawRocks() {
    const gy = groundY();
    for (const r of rocks) {
      const x = r.x - scroll;
      if (x < -120 || x > W + 120) continue;
      shadow(x, gy, r.w * 0.55);
      ctx.fillStyle = C.rockShade;
      ctx.beginPath();
      ctx.moveTo(x - r.w * 0.5, gy);
      ctx.lineTo(x - r.w * 0.32, gy - r.h);
      ctx.lineTo(x + r.w * 0.12, gy - r.h * 0.86);
      ctx.lineTo(x + r.w * 0.5, gy);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = C.rock;
      ctx.beginPath();
      ctx.moveTo(x - r.w * 0.5, gy);
      ctx.lineTo(x - r.w * 0.32, gy - r.h);
      ctx.lineTo(x + r.w * 0.02, gy - r.h * 0.6);
      ctx.lineTo(x + r.w * 0.1, gy);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = C.rockTop;
      ctx.beginPath();
      ctx.ellipse(x - r.w * 0.1, gy - r.h * 0.92, r.w * 0.18, r.w * 0.07, 0.3, 0, 7);
      ctx.fill();
    }
  }

  function drawLeaves() {
    for (const lf of leaves) {
      ctx.save();
      ctx.translate(lf.x, lf.y);
      ctx.rotate(lf.rot);
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = lf.tone;
      ctx.beginPath();
      ctx.ellipse(0, 0, lf.size, lf.size * 0.5, 0, 0, 7);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  // ---- Birds (the plain cut-paper cast) ----
  function drawBird(x, y, s, col, opts) {
    const { body, belly, wing, flap = 0, beat = 0, facing = 1, blink = false } = col;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(facing, 1);

    // ground shadow handled by caller for live birds
    // legs (thin amber), only when near ground
    if (opts && opts.legs) {
      ctx.strokeStyle = C.leg; ctx.lineWidth = 2.4 * s; ctx.lineCap = 'round';
      const stride = Math.sin(scroll / 26) * 4 * s;
      ctx.beginPath();
      ctx.moveTo(-3 * s, 12 * s); ctx.lineTo(-4 * s + stride, 22 * s);
      ctx.moveTo(4 * s, 12 * s); ctx.lineTo(5 * s - stride, 22 * s);
      ctx.stroke();
    }

    // back wing (darker), flapping to the beat
    const wingAng = Math.sin(flap) * 0.5 + beat * 0.25;
    ctx.fillStyle = wing;
    ctx.save();
    ctx.translate(-2 * s, -2 * s);
    ctx.rotate(-0.3 + wingAng);
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(-16 * s, -4 * s); ctx.lineTo(-4 * s, 8 * s);
    ctx.closePath(); ctx.fill();
    ctx.restore();

    // body (teardrop) + head as one silhouette
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(0, 0, 15 * s, 13 * s, 0, 0, 7);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(9 * s, -8 * s, 9 * s, 0, 7);     // head
    ctx.fill();

    // belly (lighter paper layer)
    ctx.fillStyle = belly;
    ctx.beginPath();
    ctx.ellipse(1 * s, 4 * s, 9 * s, 8 * s, 0, 0, 7);
    ctx.fill();

    // beak (triangle, amber)
    ctx.fillStyle = C.amber;
    ctx.beginPath();
    ctx.moveTo(17 * s, -9 * s);
    ctx.lineTo(26 * s, -6 * s);
    ctx.lineTo(17 * s, -3 * s);
    ctx.closePath(); ctx.fill();

    // front wing (body tone, lighter), flaps opposite phase a touch
    ctx.fillStyle = belly;
    ctx.save();
    ctx.translate(0, 0);
    ctx.rotate(-0.15 + wingAng * 0.8);
    ctx.beginPath();
    ctx.moveTo(2 * s, -1 * s); ctx.lineTo(-12 * s, 1 * s); ctx.lineTo(0, 9 * s);
    ctx.closePath(); ctx.fill();
    ctx.restore();

    // eye (single dot)
    ctx.fillStyle = C.eye;
    if (blink) {
      ctx.strokeStyle = C.eye; ctx.lineWidth = 1.6 * s;
      ctx.beginPath(); ctx.moveTo(9 * s, -9 * s); ctx.lineTo(13 * s, -9 * s); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(11 * s, -9 * s, 1.8 * s, 0, 7); ctx.fill();
    }

    ctx.restore();
  }

  function drawBirds() {
    const gy = groundY();
    const beat = Math.max(0, 1 - beatPhase() * 3); // sharp pulse on each beat

    // chicks first (behind mother visually when trailing), Mikey may be ahead
    for (let i = chicks.length - 1; i >= 0; i--) {
      const c = chicks[i];
      if (c.kind === 'mikey' && mikeyState !== 'with') continue;
      const x = motherScreenX() - c.lag;
      if (x < -60 || x > W + 60) continue;
      const onGround = c.y >= gy - 2;
      shadow(x, c.y, 10);
      const col = c.kind === 'mikey'
        ? { body: C.mikey, belly: C.mikeyBelly, wing: C.mikeyWing }
        : { body: C.chick, belly: C.chickBelly, wing: C.chickWing };
      col.flap = c.flap; col.beat = beat;
      col.blink = ((songTime + i) % 4) < 0.12;
      drawBird(x, c.y - 14 * 0.7 + bob(i * 0.3) * 2, 0.7, col, { legs: onGround });
    }

    // Mikey when frenzied/resting (drawn ahead, larger presence)
    const m = getMikey();
    if (m && mikeyState !== 'with') {
      const x = motherScreenX() - m.lag;
      if (x > -60 && x < W + 60) {
        if (mikeyState === 'resting') shadow(x, gy, 8);
        const col = { body: C.mikey, belly: C.mikeyBelly, wing: C.mikeyWing, flap: m.flap, beat };
        drawBird(x, m.y - 10, 0.72, col, { legs: mikeyState === 'resting' && m.y >= gy - 4 });
      }
    }

    // mother (largest, slight flicker when invulnerable)
    const mx = motherScreenX();
    const onGround = mother.grounded;
    shadow(mx, mother.y, 15);
    if (!(mother.invuln > 0 && Math.floor(songTime * 12) % 2 === 0)) {
      const col = {
        body: C.mother, belly: C.motherBelly, wing: C.motherWing,
        flap: mother.flap, beat,
        blink: (songTime % 3.3) < 0.12,
      };
      drawBird(mx, mother.y - 16 + bob() * 2, 1.0, col, { legs: onGround });
    }
  }

  function drawFlyoffs() {
    for (const f of flyoffs) {
      const x = f.x;
      ctx.save();
      ctx.translate(x, f.y);
      ctx.rotate(f.rot);
      ctx.globalAlpha = Math.max(0, 1 - f.t / 1.6);
      const col = f.kind === 'mikey'
        ? { body: C.mikey, belly: C.mikeyBelly, wing: C.mikeyWing }
        : { body: C.chick, belly: C.chickBelly, wing: C.chickWing };
      col.flap = f.t * 30; col.beat = 1;
      drawBird(0, 0, 0.7, col, { legs: false });
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function drawPops() {
    for (const p of pops) {
      const k = p.t / 0.5;
      ctx.save();
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = p.orange ? C.fruitOrange : C.fruitRed;
      const r = 7 + k * 10;
      ctx.beginPath(); ctx.arc(p.x, p.y - k * 14, r, 0, 7); ctx.fill();
      // sparkle bits
      ctx.fillStyle = '#FBEAD9';
      for (let i = 0; i < 4; i++) {
        const a = i / 4 * Math.PI * 2 + p.t * 6;
        ctx.beginPath();
        ctx.arc(p.x + Math.cos(a) * k * 16, p.y - k * 14 + Math.sin(a) * k * 16, 2, 0, 7);
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  // ===========================================================
  //  HUD sync
  // ===========================================================
  const elScore = document.getElementById('score');
  const elTimer = document.getElementById('timer');
  const elDots = document.getElementById('chick-dots');
  const elStam = document.getElementById('stamina-fill');

  function syncHUD() {
    elScore.textContent = score;
    const mm = Math.floor(timeLeft / 60);
    const ss = Math.floor(timeLeft % 60).toString().padStart(2, '0');
    elTimer.textContent = `${mm}:${ss}`;
    elStam.style.width = (mother.stamina / STAMINA_MAX * 100) + '%';

    // chick dots: up to 3 + mikey
    const regular = chicks.filter(c => c.kind === 'chick').length;
    const hasMikey = chicks.some(c => c.kind === 'mikey');
    let html = '';
    for (let i = 0; i < 3; i++) html += `<span class="chick-dot ${i < regular ? '' : 'empty'}"></span>`;
    html += `<span class="chick-dot mikey ${hasMikey ? '' : 'empty'}"></span>`;
    elDots.innerHTML = html;
  }

  // ===========================================================
  //  Loop
  // ===========================================================
  let last = performance.now();
  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05;       // clamp after tab-switches
    update(dt);
    draw();
    if (state === 'play') syncHUD();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ===========================================================
  //  UI wiring
  // ===========================================================
  const startEl = document.getElementById('start');
  const endEl = document.getElementById('end');
  const hudEl = document.getElementById('hud');

  function begin() {
    reset();
    state = 'play';
    Music.start();
    startEl.classList.add('hidden');
    endEl.classList.add('hidden');
    hudEl.classList.remove('hidden');
  }

  document.getElementById('play-btn').addEventListener('click', begin);
  document.getElementById('again-btn').addEventListener('click', begin);
  document.getElementById('sound-btn').addEventListener('click', e => {
    const on = Music.toggle();
    e.target.textContent = 'Music: ' + (on ? 'on' : 'off');
  });

  // draw an idle frame behind the start screen
  reset();
  state = 'start';
})();
