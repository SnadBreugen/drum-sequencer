/**
 * toenchen Trackofaktor
 * Drum Sequencer mit Notenblatt-Export
 */

(function () {
  'use strict';

  const STEPS_PER_BAR = 16;
  const SLOTS = ['A', 'B', 'C', 'D'];
  const SAMPLE_BASE = 'https://oramics.github.io/sampled/DRUMS/pearl-master-studio/samples/';

  const TRACKS = [
    { id: 'cr', label: 'Crash',      group: 'cymbal', sample: 'crash-01.wav' },
    { id: 'ri', label: 'Ride',       group: 'cymbal', sample: 'ride-01.wav' },
    { id: 'oh', label: 'Open HH',    group: 'hihat',  sample: 'hihat-open.wav' },
    { id: 'hh', label: 'Closed HH',  group: 'hihat',  sample: 'hihat-closed.wav' },
    { id: 'ph', label: 'Pedal HH',   group: 'hihat',  sample: 'hihat-closed.wav' },
    { id: 'th', label: 'Tom hi',     group: 'tom',    sample: 'tom-01.wav' },
    { id: 'tm', label: 'Tom mid',    group: 'tom',    sample: 'tom-02.wav' },
    { id: 'tl', label: 'Tom lo',     group: 'tom',    sample: 'tom-03.wav' },
    { id: 'sn', label: 'Snare',      group: 'drum',   sample: 'snare-01.wav' },
    { id: 'kd', label: 'Kick',       group: 'drum',   sample: 'kick-01.wav' }
  ];

  const DRUM_GAIN = {
    kd: 1.15,
    sn: 1.05,
    hh: 0.80,
    oh: 0.90,
    ph: 0.30,
    th: 1.00,
    tm: 1.00,
    tl: 1.00,
    ri: 0.80,
    cr: 1.00
  };

  const HIHAT_IDS = ['hh', 'oh', 'ph'];
  const TOM_IDS   = ['th', 'tm', 'tl'];

  const WARNING_PAIRS = [
    { ids: ['hh', 'ri'], msg: 'Hi-Hat + Ride auf Schlag %step%: selten, aber möglich.' },
    { ids: ['oh', 'ri'], msg: 'Open HH + Ride auf Schlag %step%: selten, aber möglich.' },
    { ids: ['cr', 'ri'], msg: 'Crash + Ride auf Schlag %step%: beide Hände am Becken.' },
    { ids: ['hh', 'cr'], msg: 'Hi-Hat + Crash auf Schlag %step%: schneller Hand-Wechsel nötig.' },
    { ids: ['oh', 'cr'], msg: 'Open HH + Crash auf Schlag %step%: schneller Hand-Wechsel nötig.' }
  ];

  function applyStep(data, trackId, globalStep, value) {
    data[trackId][globalStep] = value;
    if (!value) return [];
    const removed = [];
    if (HIHAT_IDS.includes(trackId)) {
      for (const other of HIHAT_IDS) {
        if (other !== trackId && data[other][globalStep]) {
          data[other][globalStep] = 0;
          removed.push(other);
        }
      }
    }
    if (TOM_IDS.includes(trackId)) {
      const activeToms = TOM_IDS.filter(id => data[id][globalStep]);
      if (activeToms.length > 2) {
        const toRemove = activeToms.find(id => id !== trackId);
        if (toRemove) {
          data[toRemove][globalStep] = 0;
          removed.push(toRemove);
        }
      }
    }
    return removed;
  }

  function findWarnings(data, totalSteps) {
    const warnings = [];
    for (let s = 0; s < totalSteps; s++) {
      for (const pair of WARNING_PAIRS) {
        if (data[pair.ids[0]][s] && data[pair.ids[1]][s]) {
          warnings.push({
            step: s,
            ids: pair.ids,
            msg: pair.msg.replace('%step%', String(s + 1))
          });
        }
      }
    }
    return warnings;
  }

  function emptyRow(len) { return new Array(len).fill(0); }
  function emptyPattern(bars) {
    const len = bars * STEPS_PER_BAR;
    const p = {};
    TRACKS.forEach(t => { p[t.id] = emptyRow(len); });
    return p;
  }

  const state = {
    patterns: {},
    currentSlot: 'A',
    currentBar: 0,
    playing: false,
    currentStep: -1,
    chainMode: false,
    chainPlayingSlot: 'A',
    barClipboard: null
  };

  SLOTS.forEach(slot => {
    state.patterns[slot] = { bars: 1, data: emptyPattern(1) };
  });

  const currentSlot = () => state.patterns[state.currentSlot];
  const currentData = () => currentSlot().data;
  const currentBars = () => currentSlot().bars;
  const globalStep  = (bar, sib) => bar * STEPS_PER_BAR + sib;

  const audio = {
    ctx: null,
    masterGain: null,
    buffers: {},
    usingSamples: false,
    loading: false,
    loadPromise: null
  };

  function ensureCtx() {
    if (!audio.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      audio.ctx = new AC();
      audio.masterGain = audio.ctx.createGain();
      audio.masterGain.gain.value = 1.0;
      audio.masterGain.connect(audio.ctx.destination);
    }
    if (audio.ctx.state === 'suspended') audio.ctx.resume();
    return audio.ctx;
  }

  function loadSampleBuffer(url) {
    return fetch(url)
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
      .then(buf => new Promise((res, rej) => audio.ctx.decodeAudioData(buf, res, rej)));
  }

  function loadAllSamples() {
    if (audio.loadPromise) return audio.loadPromise;
    ensureCtx();
    audio.loading = true;
    setStatus('Lade akustische Drum-Samples…');

    const uniqueSamples = {};
    TRACKS.forEach(t => {
      if (!uniqueSamples[t.sample]) uniqueSamples[t.sample] = [];
      uniqueSamples[t.sample].push(t.id);
    });

    audio.loadPromise = Promise.all(Object.keys(uniqueSamples).map(sampleFile =>
      loadSampleBuffer(SAMPLE_BASE + sampleFile)
        .then(buf => {
          uniqueSamples[sampleFile].forEach(id => { audio.buffers[id] = buf; });
        })
        .catch(err => { console.warn('Sample fail', sampleFile, err); })
    )).then(() => {
      const loaded = Object.keys(audio.buffers).length;
      if (loaded >= 7) {
        audio.usingSamples = true;
        setStatus(`Echtes Drum-Kit geladen (${loaded}/${TRACKS.length} Samples).`, 'success');
      } else {
        buildSynthBuffers();
        setStatus('Samples nicht erreichbar — nutze Synth-Fallback.', 'error');
      }
      audio.loading = false;
    }).catch(() => {
      buildSynthBuffers();
      setStatus('Samples nicht erreichbar — nutze Synth-Fallback.', 'error');
      audio.loading = false;
    });

    return audio.loadPromise;
  }

  function makeBuffer(seconds, fillFn) {
    const sr = audio.ctx.sampleRate;
    const len = Math.floor(sr * seconds);
    const buf = audio.ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = fillFn(i / sr, i, sr);
    return buf;
  }
  function highpassInPlace(data, cutoff, sr) {
    const rc = 1 / (2 * Math.PI * cutoff);
    const dt = 1 / sr;
    const alpha = rc / (rc + dt);
    let prev = data[0], outPrev = data[0];
    for (let i = 1; i < data.length; i++) {
      const out = alpha * (outPrev + data[i] - prev);
      prev = data[i]; outPrev = out;
      data[i] = out;
    }
  }
  function buildSynthBuffers() {
    audio.buffers.kd = makeBuffer(0.5, t => {
      const phase = 2*Math.PI*(45*t + (105/35)*(1 - Math.exp(-t*35)));
      const body  = Math.sin(phase) * Math.exp(-t*4.5);
      const click = (Math.random()*2-1) * Math.exp(-t*500) * 0.5;
      return (body + click) * 0.95;
    });
    const sn = makeBuffer(0.3, t => {
      const noise = (Math.random()*2-1) * Math.exp(-t*22);
      const tone  = Math.sin(2*Math.PI*200*t) * Math.exp(-t*30) * 0.4;
      const tone2 = Math.sin(2*Math.PI*330*t) * Math.exp(-t*35) * 0.3;
      return (noise*0.8 + tone + tone2) * 0.85;
    });
    highpassInPlace(sn.getChannelData(0), 180, audio.ctx.sampleRate);
    audio.buffers.sn = sn;
    const mkHat = (mode) => {
      let dur, decay, bright;
      if (mode==='closed') { dur=0.08; decay=35; bright=1; }
      else if (mode==='open') { dur=0.4; decay=8; bright=1; }
      else { dur=0.12; decay=20; bright=0.7; }
      const b = makeBuffer(dur, t => {
        const fs=[8000,10500,13000,7200,9400]; let s=0;
        for (const f of fs) s += Math.sin(2*Math.PI*f*t)>0?1:-1;
        s /= fs.length;
        const n = Math.random()*2-1;
        return (s*0.3+n*0.7)*Math.exp(-t*decay)*0.45*bright;
      });
      highpassInPlace(b.getChannelData(0), mode==='pedal'?4500:6000, audio.ctx.sampleRate);
      return b;
    };
    audio.buffers.hh = mkHat('closed');
    audio.buffers.oh = mkHat('open');
    audio.buffers.ph = mkHat('pedal');
    const mkTom = (pitch) => makeBuffer(0.45, t => {
      const f = pitch*(1 + 0.5*Math.exp(-t*20));
      const body = Math.sin(2*Math.PI*f*t) * Math.exp(-t*6);
      const noise = (Math.random()*2-1) * Math.exp(-t*80) * 0.15;
      return (body + noise) * 0.9;
    });
    audio.buffers.th = mkTom(220);
    audio.buffers.tm = mkTom(160);
    audio.buffers.tl = mkTom(110);
    const mkCym = (isRide) => {
      const dur = isRide?1.2:1.6, decay = isRide?3:1.8;
      const b = makeBuffer(dur, t => {
        const fs=[3200,4100,5800,7200,9100,11000,13500]; let s=0;
        for (let k=0; k<fs.length; k++) {
          const fr = fs[k]*(1 + 0.002*Math.sin(t*7.3*(k+1)));
          s += Math.sin(2*Math.PI*fr*t)>0?1:-1;
        }
        s /= fs.length;
        const n = Math.random()*2-1;
        const mix = isRide ? (s*0.6+n*0.4) : (s*0.4+n*0.6);
        return mix * Math.exp(-t*decay) * 0.4;
      });
      highpassInPlace(b.getChannelData(0), isRide?2500:2000, audio.ctx.sampleRate);
      return b;
    };
    audio.buffers.ri = mkCym(true);
    audio.buffers.cr = mkCym(false);
  }

  function ensureAudioReady() {
    ensureCtx();
    if (Object.keys(audio.buffers).length === 0 && !audio.loading) {
      loadAllSamples();
    }
  }

  function playSample(id, when, gain) {
    if (!audio.buffers[id]) return;
    const src = audio.ctx.createBufferSource();
    src.buffer = audio.buffers[id];
    const g = audio.ctx.createGain();
    const drumGain = DRUM_GAIN[id] || 1.0;
    g.gain.value = (gain || 1.0) * drumGain;

    // Hi-Hats: Hochpass bei 380 Hz entfernt das tiefe Rumpeln im Sample
    if (id === 'hh' || id === 'oh' || id === 'ph') {
      const highpass = audio.ctx.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = 380;
      highpass.Q.value = 0.7;

      if (id === 'ph') {
        // Pedal-HH: zusätzlich Lowpass bei 4500 Hz für dumpferen Fuß-Charakter
        // (aber nicht zu dumpf — muss noch Biss haben)
        const lowpass = audio.ctx.createBiquadFilter();
        lowpass.type = 'lowpass';
        lowpass.frequency.value = 4500;
        lowpass.Q.value = 0.7;
        src.connect(highpass).connect(lowpass).connect(g).connect(audio.masterGain);
      } else {
        src.connect(highpass).connect(g).connect(audio.masterGain);
      }
    } else {
      src.connect(g).connect(audio.masterGain);
    }
    src.start(when || audio.ctx.currentTime);
  }

  const el = {
    grid: document.getElementById('grid'),
    patternTabs: document.getElementById('patternTabs'),
    lengthTabs: document.getElementById('lengthTabs'),
    barTabs: document.getElementById('barTabs'),
    status: document.getElementById('loadStatus'),
    warningBox: document.getElementById('warningBox'),
    playBtn: document.getElementById('playBtn'),
    clearBtn: document.getElementById('clearBtn'),
    bpm: document.getElementById('bpm'),
    bpmOut: document.getElementById('bpmOut'),
    copyBarBtn: document.getElementById('copyBarBtn'),
    pasteBarBtn: document.getElementById('pasteBarBtn'),
    chainMode: document.getElementById('chainMode'),
    exportPdfBtn: document.getElementById('exportPdfBtn'),
    notationPreview: document.getElementById('notationPreview')
  };

  function setStatus(msg, level) {
    el.status.textContent = msg;
    el.status.className = 'status' + (level ? ' ' + level : '');
  }

  function buildGrid() {
    el.grid.innerHTML = '';
    TRACKS.forEach(track => {
      const lbl = document.createElement('div');
      lbl.className = 'row-label';
      if (track.group === 'hihat') lbl.classList.add('hihat-group');
      const preview = document.createElement('button');
      preview.type = 'button';
      preview.className = 'preview-btn';
      preview.textContent = '♪';
      preview.title = 'Vorhören';
      preview.addEventListener('click', e => {
        e.stopPropagation();
        ensureAudioReady();
        (audio.loadPromise || Promise.resolve()).then(() => playSample(track.id));
      });
      const name = document.createElement('span');
      name.textContent = track.label;
      lbl.appendChild(preview);
      lbl.appendChild(name);
      el.grid.appendChild(lbl);
      for (let sib = 0; sib < STEPS_PER_BAR; sib++) {
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'cell' + (sib % 4 === 0 ? ' beat-start' : '');
        cell.dataset.track = track.id;
        cell.dataset.sib = String(sib);
        cell.addEventListener('click', () => handleCellClick(track.id, sib, cell));
        el.grid.appendChild(cell);
      }
    });
  }

  function handleCellClick(trackId, sib, cellEl) {
    const data = currentData();
    const gStep = globalStep(state.currentBar, sib);
    const wasOn = data[trackId][gStep];
    const newVal = wasOn ? 0 : 1;
    const removed = applyStep(data, trackId, gStep, newVal);
    if (newVal) {
      cellEl.classList.add('on');
      ensureAudioReady();
      (audio.loadPromise || Promise.resolve()).then(() => playSample(trackId));
    } else {
      cellEl.classList.remove('on');
    }
    removed.forEach(id => {
      const other = el.grid.querySelector(`.cell[data-track="${id}"][data-sib="${sib}"]`);
      if (other) other.classList.remove('on');
    });
    if (removed.length > 0) {
      const names = removed.map(id => TRACKS.find(t => t.id === id).label).join(', ');
      setStatus(`Automatisch deaktiviert: ${names} (Regel-Konflikt).`);
    }
    refreshWarnings();
    renderPreviewNotation();
  }

  function refreshGrid() {
    const data = currentData();
    TRACKS.forEach(track => {
      for (let sib = 0; sib < STEPS_PER_BAR; sib++) {
        const gStep = globalStep(state.currentBar, sib);
        const cell = el.grid.querySelector(`.cell[data-track="${track.id}"][data-sib="${sib}"]`);
        if (!cell) continue;
        cell.classList.toggle('on', Boolean(data[track.id][gStep]));
      }
    });
    applyConflictHighlights();
  }

  function applyConflictHighlights() {
    el.grid.querySelectorAll('.cell.conflict').forEach(c => c.classList.remove('conflict'));
    const data = currentData();
    const totalSteps = currentBars() * STEPS_PER_BAR;
    const warnings = findWarnings(data, totalSteps);
    warnings.forEach(w => {
      const barOfStep = Math.floor(w.step / STEPS_PER_BAR);
      if (barOfStep !== state.currentBar) return;
      const sib = w.step % STEPS_PER_BAR;
      w.ids.forEach(id => {
        const cell = el.grid.querySelector(`.cell[data-track="${id}"][data-sib="${sib}"]`);
        if (cell) cell.classList.add('conflict');
      });
    });
  }

  function refreshWarnings() {
    const data = currentData();
    const totalSteps = currentBars() * STEPS_PER_BAR;
    const warnings = findWarnings(data, totalSteps);
    if (warnings.length === 0) {
      el.warningBox.hidden = true;
      el.warningBox.style.display = 'none';
      applyConflictHighlights();
      return;
    }
    el.warningBox.hidden = false;
    el.warningBox.style.display = 'block';
    el.warningBox.innerHTML =
      `<strong>${warnings.length} Hinweis${warnings.length > 1 ? 'e' : ''}:</strong> ` +
      warnings.slice(0, 3).map(w => w.msg).join(' ') +
      (warnings.length > 3 ? ` (und ${warnings.length - 3} weitere…)` : '');
    applyConflictHighlights();
  }

  function barHasContent(slot, bar) {
    const p = state.patterns[slot];
    const off = bar * STEPS_PER_BAR;
    for (const t of TRACKS) {
      const row = p.data[t.id];
      for (let s = 0; s < STEPS_PER_BAR; s++) if (row[off + s]) return true;
    }
    return false;
  }
  function slotHasContent(slot) {
    for (let b = 0; b < state.patterns[slot].bars; b++) {
      if (barHasContent(slot, b)) return true;
    }
    return false;
  }

  function makeTab(text, isActive, opts, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mini-tab';
    if (isActive) btn.classList.add('active');
    if (opts && opts.hasContent) btn.classList.add('has-content');
    if (opts && opts.playing) btn.classList.add('playing-indicator');
    btn.textContent = text;
    btn.addEventListener('click', onClick);
    return btn;
  }

  function rebuildTabs() {
    el.patternTabs.innerHTML = '';
    SLOTS.forEach(slot => {
      const isActive = slot === state.currentSlot;
      const tab = makeTab(slot, isActive, {
        hasContent: slotHasContent(slot) && !isActive,
        playing: state.playing && state.chainMode && slot === state.chainPlayingSlot
      }, () => {
        state.currentSlot = slot;
        if (state.currentBar >= currentBars()) state.currentBar = 0;
        rebuildTabs();
        refreshGrid();
        refreshWarnings();
        renderPreviewNotation();
      });
      el.patternTabs.appendChild(tab);
    });
    el.lengthTabs.innerHTML = '';
    [1, 2, 3, 4].forEach(n => {
      const tab = makeTab(String(n), currentBars() === n, null, () => changeLength(n));
      el.lengthTabs.appendChild(tab);
    });
    el.barTabs.innerHTML = '';
    for (let b = 0; b < currentBars(); b++) {
      const isActive = b === state.currentBar;
      const tab = makeTab(String(b + 1), isActive, {
        hasContent: barHasContent(state.currentSlot, b) && !isActive
      }, () => {
        state.currentBar = b;
        rebuildTabs();
        refreshGrid();
      });
      el.barTabs.appendChild(tab);
    }
  }

  function changeLength(newBars) {
    const oldBars = currentBars();
    if (newBars === oldBars) return;
    const oldData = currentData();
    const newData = emptyPattern(newBars);
    const copyLen = Math.min(oldBars, newBars) * STEPS_PER_BAR;
    Object.keys(oldData).forEach(k => {
      for (let i = 0; i < copyLen; i++) newData[k][i] = oldData[k][i];
    });
    state.patterns[state.currentSlot].bars = newBars;
    state.patterns[state.currentSlot].data = newData;
    if (state.currentBar >= newBars) state.currentBar = newBars - 1;
    rebuildTabs();
    refreshGrid();
    refreshWarnings();
    renderPreviewNotation();
  }

  el.copyBarBtn.addEventListener('click', () => {
    const d = currentData();
    const off = state.currentBar * STEPS_PER_BAR;
    const clip = {};
    Object.keys(d).forEach(k => {
      clip[k] = d[k].slice(off, off + STEPS_PER_BAR);
    });
    state.barClipboard = clip;
    el.pasteBarBtn.disabled = false;
    setStatus(`Takt ${state.currentBar + 1} von Pattern ${state.currentSlot} in Zwischenablage kopiert.`, 'success');
  });

  el.pasteBarBtn.addEventListener('click', () => {
    if (!state.barClipboard) return;
    const d = currentData();
    const off = state.currentBar * STEPS_PER_BAR;
    Object.keys(state.barClipboard).forEach(k => {
      for (let i = 0; i < STEPS_PER_BAR; i++) d[k][off + i] = state.barClipboard[k][i];
    });
    setStatus(`Zwischenablage eingefügt in Takt ${state.currentBar + 1} von Pattern ${state.currentSlot}.`, 'success');
    refreshGrid();
    rebuildTabs();
    refreshWarnings();
    renderPreviewNotation();
  });

  el.clearBtn.addEventListener('click', () => {
    const d = currentData();
    const off = state.currentBar * STEPS_PER_BAR;
    Object.keys(d).forEach(k => {
      for (let i = 0; i < STEPS_PER_BAR; i++) d[k][off + i] = 0;
    });
    refreshGrid();
    rebuildTabs();
    refreshWarnings();
    renderPreviewNotation();
  });

  el.bpm.addEventListener('input', e => { el.bpmOut.textContent = e.target.value; });
  el.chainMode.addEventListener('change', e => { state.chainMode = e.target.checked; });

  let schedulerInterval = null;
  let nextStepTime = 0;

  function scheduler() {
    const now = audio.ctx.currentTime;
    while (nextStepTime < now + 0.1) {
      const slotPlaying = state.chainMode ? state.chainPlayingSlot : state.currentSlot;
      const p = state.patterns[slotPlaying];
      const totalSteps = p.bars * STEPS_PER_BAR;
      state.currentStep = (state.currentStep + 1) % totalSteps;
      const d = p.data;
      TRACKS.forEach(t => {
        if (d[t.id][state.currentStep]) playSample(t.id, nextStepTime, 1.0);
      });
      const drawAt = nextStepTime;
      const playingSlot = slotPlaying;
      const playingBar = Math.floor(state.currentStep / STEPS_PER_BAR);
      const playingSib = state.currentStep % STEPS_PER_BAR;
      setTimeout(() => {
        el.grid.querySelectorAll('.cell.playing').forEach(c => c.classList.remove('playing'));
        if (playingSlot === state.currentSlot && playingBar === state.currentBar) {
          el.grid.querySelectorAll(`.cell[data-sib="${playingSib}"]`)
            .forEach(c => c.classList.add('playing'));
        }
      }, Math.max(0, (drawAt - audio.ctx.currentTime) * 1000));
      const bpm = Number(el.bpm.value);
      const sixteenthSec = 60 / bpm / 4;
      nextStepTime += sixteenthSec;
      if (state.chainMode && state.currentStep === totalSteps - 1) {
        const i = SLOTS.indexOf(state.chainPlayingSlot);
        state.chainPlayingSlot = SLOTS[(i + 1) % SLOTS.length];
        state.currentStep = -1;
        setTimeout(rebuildTabs, 0);
      }
    }
  }

  function togglePlay() {
    if (state.playing) {
      state.playing = false;
      if (schedulerInterval) { clearInterval(schedulerInterval); schedulerInterval = null; }
      state.currentStep = -1;
      el.playBtn.textContent = 'Play';
      el.grid.querySelectorAll('.cell.playing').forEach(c => c.classList.remove('playing'));
      rebuildTabs();
      return;
    }
    ensureAudioReady();
    (audio.loadPromise || Promise.resolve()).then(() => {
      nextStepTime = audio.ctx.currentTime + 0.05;
      state.currentStep = -1;
      state.chainPlayingSlot = state.currentSlot;
      state.playing = true;
      el.playBtn.textContent = 'Stop';
      schedulerInterval = setInterval(scheduler, 25);
      rebuildTabs();
    });
  }
  el.playBtn.addEventListener('click', togglePlay);

  // VexFlow Notation
  const VF_MAP = {
    cr: { key: 'a/5',  notehead: 'x', voice: 'up' },
    ri: { key: 'f/5',  notehead: 'x', voice: 'up' },
    hh: { key: 'g/5',  notehead: 'x', voice: 'up' },
    oh: { key: 'g/5',  notehead: 'x', voice: 'up', open: true },
    ph: { key: 'd/4',  notehead: 'x', voice: 'down' },
    th: { key: 'e/5',  notehead: 'n', voice: 'up' },
    tm: { key: 'd/5',  notehead: 'n', voice: 'up' },
    tl: { key: 'a/4',  notehead: 'n', voice: 'down' },
    sn: { key: 'c/5',  notehead: 'n', voice: 'up' },
    kd: { key: 'f/4',  notehead: 'n', voice: 'down' }
  };

  function buildStaveNote(keys, noteheads, duration, stemDir, VF, openKeys) {
    const note = new VF.StaveNote({
      keys: keys,
      duration: duration,
      stem_direction: stemDir
    });
    for (let i = 0; i < keys.length; i++) {
      if (noteheads[i] === 'x') {
        try {
          note.note_heads[i].note_type = 'x';
          if (note.note_heads[i].glyph) {
            note.note_heads[i].glyph.code_head = 'v3e';
            note.note_heads[i].glyph.code = 'v3e';
          }
        } catch(e) {}
      }
    }
    if (openKeys && openKeys.length) {
      for (let i = 0; i < keys.length; i++) {
        if (openKeys.includes(keys[i])) {
          try {
            note.addModifier(new VF.Articulation('a+').setPosition(VF.Modifier.Position.ABOVE), i);
          } catch(e) {}
        }
      }
    }
    return note;
  }

  function renderPatternVex(container, pattern, opts) {
    opts = opts || {};
    if (typeof Vex === 'undefined') {
      container.innerHTML = '<div style="color:var(--text-faint); font-size:12px;">Notations-Library wird geladen…</div>';
      return;
    }
    const VF = Vex.Flow;
    container.innerHTML = '';

    const bars = pattern.bars;
    const barWidth = opts.barWidth || 280;
    const leftPad = 60;
    const rightPad = 20;
    const width = leftPad + bars * barWidth + rightPad;
    const height = opts.height || 180;

    const div = document.createElement('div');
    container.appendChild(div);

    const renderer = new VF.Renderer(div, VF.Renderer.Backends.SVG);
    renderer.resize(width, height);
    const ctx = renderer.getContext();
    ctx.setFont('Arial', 10);

    for (let barIdx = 0; barIdx < bars; barIdx++) {
      const x = (barIdx === 0) ? 10 : leftPad + barIdx * barWidth - 10;
      const w = (barIdx === 0) ? leftPad + barWidth - 20 : barWidth;
      const stave = new VF.Stave(x, 30, w);
      if (barIdx === 0) {
        stave.addClef('percussion').addTimeSignature('4/4');
      }
      if (barIdx === bars - 1) {
        stave.setEndBarType(VF.Barline.type.END);
      }
      stave.setContext(ctx).draw();

      ctx.save();
      ctx.setFont('Arial', 9);
      ctx.fillText('Takt ' + (barIdx + 1), x + 4, 24);
      ctx.restore();

      const barOffset = barIdx * STEPS_PER_BAR;
      const upperNotes = [];
      const lowerNotes = [];

      for (let sib = 0; sib < STEPS_PER_BAR; sib++) {
        const gStep = barOffset + sib;
        const upperKeys = [];
        const lowerKeys = [];
        const upperHeads = [];
        const lowerHeads = [];
        const upperOpen = [];
        const lowerOpen = [];

        TRACKS.forEach(t => {
          if (!pattern.data[t.id][gStep]) return;
          const m = VF_MAP[t.id];
          if (!m) return;
          if (m.voice === 'up') {
            upperKeys.push(m.key);
            upperHeads.push(m.notehead);
            if (m.open) upperOpen.push(m.key);
          } else {
            lowerKeys.push(m.key);
            lowerHeads.push(m.notehead);
            if (m.open) lowerOpen.push(m.key);
          }
        });

        if (upperKeys.length === 0) {
          upperNotes.push(new VF.StaveNote({ keys: ['b/4'], duration: '16r' }));
        } else {
          upperNotes.push(buildStaveNote(upperKeys, upperHeads, '16', VF.Stem.UP, VF, upperOpen));
        }
        if (lowerKeys.length === 0) {
          lowerNotes.push(new VF.StaveNote({ keys: ['d/4'], duration: '16r' }));
        } else {
          lowerNotes.push(buildStaveNote(lowerKeys, lowerHeads, '16', VF.Stem.DOWN, VF, lowerOpen));
        }
      }

      const upperBeams = [];
      const lowerBeams = [];
      for (let g = 0; g < 4; g++) {
        const startIdx = g * 4;
        const group = upperNotes.slice(startIdx, startIdx + 4).filter(n => !n.isRest());
        if (group.length >= 2) upperBeams.push(new VF.Beam(group));
        const lgroup = lowerNotes.slice(startIdx, startIdx + 4).filter(n => !n.isRest());
        if (lgroup.length >= 2) lowerBeams.push(new VF.Beam(lgroup));
      }

      const voice1 = new VF.Voice({ num_beats: 4, beat_value: 4 }).setStrict(false).addTickables(upperNotes);
      const voice2 = new VF.Voice({ num_beats: 4, beat_value: 4 }).setStrict(false).addTickables(lowerNotes);

      const formatter = new VF.Formatter();
      formatter.joinVoices([voice1, voice2]).format([voice1, voice2], w - 40);

      voice1.draw(ctx, stave);
      voice2.draw(ctx, stave);
      upperBeams.forEach(b => b.setContext(ctx).draw());
      lowerBeams.forEach(b => b.setContext(ctx).draw());
    }

    if (opts.label) {
      ctx.save();
      ctx.setFont('Arial', 12, 'bold');
      ctx.fillText(opts.label, 10, 18);
      ctx.restore();
    }
  }

  function renderPreviewNotation() {
    if (!el.notationPreview) return;
    renderPatternVex(el.notationPreview, state.patterns[state.currentSlot], {
      label: `Pattern ${state.currentSlot} · ${state.patterns[state.currentSlot].bars} ${state.patterns[state.currentSlot].bars === 1 ? 'Takt' : 'Takte'}`,
      barWidth: 240,
      height: 170
    });
  }

  function getJsPDF() {
    if (window.jspdf && window.jspdf.jsPDF) return window.jspdf.jsPDF;
    if (window.jsPDF) return window.jsPDF;
    return null;
  }
  function getSvg2Pdf() {
    if (window.svg2pdf && window.svg2pdf.svg2pdf) return window.svg2pdf.svg2pdf;
    if (window.svg2pdf) return window.svg2pdf;
    return null;
  }

  async function exportPDF() {
    if (typeof Vex === 'undefined') {
      setStatus('Notations-Library noch nicht geladen, bitte kurz warten.', 'error');
      return;
    }
    const jsPDFCtor = getJsPDF();
    const svg2pdfFn = getSvg2Pdf();
    if (!jsPDFCtor || !svg2pdfFn) {
      setStatus('PDF-Libraries noch nicht geladen. Bitte Seite neu laden oder kurz warten.', 'error');
      return;
    }
    setStatus('Erstelle Notenblatt…');

    const slotsToExport = SLOTS.filter(slot => slotHasContent(slot));
    if (slotsToExport.length === 0) {
      setStatus('Keine Patterns mit Inhalt vorhanden.', 'error');
      return;
    }

    const pdf = new jsPDFCtor({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = 210;
    const pageH = 297;
    const margin = 15;

    pdf.setFontSize(18);
    pdf.setFont('helvetica', 'bold');
    pdf.text('toenchen Trackofaktor', margin, margin + 6);
    pdf.setFontSize(9);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(100);
    const date = new Date().toLocaleDateString('de-DE');
    const bpmVal = el.bpm.value;
    pdf.text(`Notenblatt · ${date} · ${bpmVal} BPM`, margin, margin + 12);
    pdf.setTextColor(0);

    pdf.setFontSize(9);
    pdf.setFont('helvetica', 'italic');
    pdf.text('Perkussions-Schlüssel, 4/4. x-Köpfe = Becken/HiHat, ovale Köpfe = Trommeln.', margin, margin + 18);
    pdf.setFont('helvetica', 'normal');

    let yPos = margin + 26;

    for (let idx = 0; idx < slotsToExport.length; idx++) {
      const slot = slotsToExport[idx];
      const pattern = state.patterns[slot];

      pdf.setFontSize(13);
      pdf.setFont('helvetica', 'bold');
      pdf.text(`Pattern ${slot}  (${pattern.bars} ${pattern.bars === 1 ? 'Takt' : 'Takte'})`, margin, yPos);
      yPos += 4;
      pdf.setFont('helvetica', 'normal');

      const tempDiv = document.createElement('div');
      tempDiv.style.position = 'absolute';
      tempDiv.style.left = '-9999px';
      tempDiv.style.top = '0';
      document.body.appendChild(tempDiv);

      renderPatternVex(tempDiv, pattern, { barWidth: 260, height: 160 });

      const svg = tempDiv.querySelector('svg');
      if (svg) {
        const svgW = parseFloat(svg.getAttribute('width'));
        const svgH = parseFloat(svg.getAttribute('height'));
        const availableW = pageW - 2 * margin;
        const scale = Math.min(availableW / svgW, 1);
        const pdfW = svgW * scale;
        const pdfH = svgH * scale;

        if (yPos + pdfH > pageH - margin) {
          pdf.addPage();
          yPos = margin;
          pdf.setFontSize(13);
          pdf.setFont('helvetica', 'bold');
          pdf.text(`Pattern ${slot}  (${pattern.bars} ${pattern.bars === 1 ? 'Takt' : 'Takte'})`, margin, yPos);
          yPos += 4;
          pdf.setFont('helvetica', 'normal');
        }

        try {
          await svg2pdfFn(svg, pdf, { x: margin, y: yPos, width: pdfW, height: pdfH });
        } catch(err) {
          console.error('svg2pdf fail', err);
        }
        yPos += pdfH + 8;
      }

      document.body.removeChild(tempDiv);
    }

    if (yPos > pageH - 40) { pdf.addPage(); yPos = margin; }
    else { yPos += 4; }
    pdf.setDrawColor(200);
    pdf.line(margin, yPos, pageW - margin, yPos);
    yPos += 5;
    pdf.setFontSize(9);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Legende:', margin, yPos);
    yPos += 5;
    pdf.setFont('helvetica', 'normal');
    const legendLines = [
      'Crash / Ride / Hi-Hat: x-Notenkopf über dem System',
      'Open Hi-Hat: x-Notenkopf mit "+"-Artikulation',
      'Pedal Hi-Hat: x-Notenkopf unter dem System',
      'Toms: ovale Notenköpfe, hoch nach oben sortiert',
      'Snare: ovaler Notenkopf im mittleren Zwischenraum',
      'Kick: ovaler Notenkopf unter dem System, Hals nach unten'
    ];
    legendLines.forEach(l => { pdf.text('• ' + l, margin, yPos); yPos += 4.5; });

    yPos += 4;
    pdf.setFontSize(8);
    pdf.setTextColor(150);
    pdf.text('Mit Liebe gemacht im Boenchen Schmackofaktur.', margin, yPos);
    pdf.setTextColor(0);

    pdf.save(`trackofaktor-${date.replace(/\./g, '-')}.pdf`);
    setStatus('Notenblatt als PDF gespeichert.', 'success');
  }

  el.exportPdfBtn.addEventListener('click', exportPDF);

  buildGrid();
  refreshGrid();
  rebuildTabs();
  refreshWarnings();

  function tryInitialRender(attempts) {
    if (typeof Vex !== 'undefined') {
      renderPreviewNotation();
    } else if (attempts < 40) {
      setTimeout(() => tryInitialRender(attempts + 1), 100);
    }
  }
  tryInitialRender(0);
})();