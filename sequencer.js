/**
 * DR-25840 — Drum Sequencer mit Multi-Kit-Support
 * Kits: Acoustic (Pearl), LinnDrum (LM-2), Modern (User-Samples)
 */

(function () {
  'use strict';

  const STEPS_PER_BAR = 16;
  const SLOTS = ['A', 'B', 'C', 'D'];
  const DEFAULT_VELOCITY = 1.0;
  const MIN_VELOCITY = 0.1;
  const DRAG_PIXELS_FOR_FULL_RANGE = 80;
  const DRAG_THRESHOLD_PX = 3;

  const KITS = {
    acoustic: {
      label: 'Acoustic',
      base: 'https://oramics.github.io/sampled/DRUMS/pearl-master-studio/samples/',
      files: {
        cr: 'crash-01.wav', ri: 'ride-01.wav',
        oh: 'hihat-open.wav', hh: 'hihat-closed.wav', ph: 'hihat-closed.wav',
        th: 'tom-01.wav', tm: 'tom-02.wav', tl: 'tom-03.wav',
        sn: 'snare-01.wav', kd: 'kick-01.wav'
      }
    },
    linndrum: {
      label: 'LinnDrum',
      base: 'https://oramics.github.io/sampled/DM/LM-2/samples/',
      files: {
        cr: 'crash.wav', ri: 'ride.wav',
        oh: 'hihat-open.wav', hh: 'hihat-closed.wav', ph: 'hihat-closed.wav',
        th: 'tom-h.wav', tm: 'tom-m.wav', tl: 'tom-l.wav',
        sn: 'snare-m.wav', kd: 'kick.wav'
      }
    },
    modern: {
      label: 'Modern',
      base: 'samples/modern/',
      files: {
        cr: 'crash_perc.wav',
        ri: 'ride_clap.wav',
        oh: 'open_hihat.wav',
        hh: 'closed_hihat.wav',
        ph: 'Shakers_15.wav',
        // hi und mid tom getauscht
        th: 'mid_tom.wav',
        tm: 'hitom.wav',
        tl: 'low_tom.wav',
        sn: 'snare.wav',
        kd: 'Kick.wav'
      },
      localRim: 'samples/modern/rim.wav',
      gainOverrides: { cr: 0.5 },
      labelOverrides: {
        cr: 'Perc',
        ri: 'Clap',
        ph: 'Shaker'
      },
      // Kit-spezifische Mutex-Paare im Grid (gegenseitig ausschließend auf gleichem Step)
      gridMutex: [
        ['cr', 'kd']  // Perc und Kick gegenseitig ausschließend
      ],
      // Kit-spezifisches Audio-Choke beim Abspielen:
      // Wenn 'kd' kommt, wird laufender 'cr' abgewürgt
      audioChoke: {
        cr: ['kd']  // 'cr' wird gechoked von 'kd'
      }
    }
  };

  const RIM_CLICK_SAMPLE = 'rimshot.wav';
  const HIHAT_IDS = ['hh', 'oh', 'ph'];
  const CHOKES_OPEN = ['hh', 'ph'];

  const TRACKS = [
    { id: 'cr', label: 'Crash',      group: 'cymbal' },
    { id: 'ri', label: 'Ride',       group: 'cymbal' },
    { id: 'oh', label: 'Open HH',    group: 'hihat'  },
    { id: 'hh', label: 'Closed HH',  group: 'hihat'  },
    { id: 'ph', label: 'Pedal HH',   group: 'hihat'  },
    { id: 'th', label: 'Tom hi',     group: 'tom'    },
    { id: 'tm', label: 'Tom mid',    group: 'tom'    },
    { id: 'tl', label: 'Tom lo',     group: 'tom'    },
    { id: 'rs', label: 'Rim-Click',  group: 'drum'   },
    { id: 'sn', label: 'Snare',      group: 'drum'   },
    { id: 'kd', label: 'Kick',       group: 'drum'   }
  ];

  const DRUM_GAIN = {
    kd: 1.15, sn: 1.05, rs: 1.00,
    hh: 0.80, oh: 0.90, ph: 0.30,
    th: 1.00, tm: 1.00, tl: 1.00,
    ri: 0.80, cr: 1.00
  };

  function getEffectiveGain(drumId) {
    const kit = KITS[state.currentKit];
    if (kit && kit.gainOverrides && typeof kit.gainOverrides[drumId] === 'number') {
      return kit.gainOverrides[drumId];
    }
    return DRUM_GAIN[drumId] || 1.0;
  }

  function getTrackLabel(trackId) {
    const kit = KITS[state.currentKit];
    if (kit && kit.labelOverrides && kit.labelOverrides[trackId]) {
      return kit.labelOverrides[trackId];
    }
    const track = TRACKS.find(t => t.id === trackId);
    return track ? track.label : trackId;
  }

  function steps(...positions) {
    const arr = new Array(STEPS_PER_BAR).fill(0);
    positions.forEach(p => { if (p >= 1 && p <= 16) arr[p - 1] = DEFAULT_VELOCITY; });
    return arr;
  }

  const DEFAULT_PATTERN_A = {
    bars: 1,
    data: {
      cr: steps(), ri: steps(), oh: steps(),
      hh: steps(1, 3, 5, 7, 9, 11, 13, 15),
      ph: steps(), th: steps(), tm: steps(), tl: steps(),
      rs: steps(),
      sn: steps(5, 13),
      kd: steps(1, 9)
    }
  };

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
    barClipboard: null,
    currentKit: 'acoustic'
  };

  SLOTS.forEach(slot => {
    state.patterns[slot] = { bars: 1, data: emptyPattern(1) };
  });
  state.patterns.A = {
    bars: DEFAULT_PATTERN_A.bars,
    data: (() => {
      const d = {};
      TRACKS.forEach(t => {
        d[t.id] = DEFAULT_PATTERN_A.data[t.id]
          ? DEFAULT_PATTERN_A.data[t.id].slice()
          : emptyRow(DEFAULT_PATTERN_A.bars * STEPS_PER_BAR);
      });
      return d;
    })()
  };

  const currentSlot = () => state.patterns[state.currentSlot];
  const currentData = () => currentSlot().data;
  const currentBars = () => currentSlot().bars;
  const globalStep  = (bar, sib) => bar * STEPS_PER_BAR + sib;

  const audio = {
    ctx: null, masterGain: null, buffers: {},
    loadingKit: null, loadedKit: null,
    openHHActive: null,
    // Generischer Tracker für aktive Sources, die gechoked werden können
    activeSources: {}  // trackId -> { source, gainNode }
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

  function loadKit(kitId) {
    if (audio.loadingKit === kitId || audio.loadedKit === kitId) {
      return audio.loadingKit ? audio._kitPromise : Promise.resolve();
    }
    ensureCtx();
    const kit = KITS[kitId];
    if (!kit) return Promise.resolve();
    audio.loadingKit = kitId;
    audio.buffers = {};
    setStatus(`Lade Kit: ${kit.label}…`);

    const urlMap = {};
    Object.keys(kit.files).forEach(trackId => {
      const url = kit.base + kit.files[trackId];
      if (!urlMap[url]) urlMap[url] = [];
      urlMap[url].push(trackId);
    });

    const promises = Object.keys(urlMap).map(url =>
      loadSampleBuffer(url)
        .then(buf => { urlMap[url].forEach(id => { audio.buffers[id] = buf; }); })
        .catch(err => { console.warn('Sample fail', url, err); })
    );

    const rimUrl = kit.localRim || RIM_CLICK_SAMPLE;
    promises.push(
      loadSampleBuffer(rimUrl)
        .then(buf => { audio.buffers.rs = buf; })
        .catch(err => {
          console.warn('Rim-Click fail, fallback to snare', err);
          if (audio.buffers.sn) audio.buffers.rs = audio.buffers.sn;
        })
    );

    audio._kitPromise = Promise.all(promises).then(() => {
      const loaded = Object.keys(audio.buffers).length;
      if (loaded >= 6) {
        setStatus(`Kit "${kit.label}" geladen (${loaded}/${TRACKS.length} Samples).`, 'success');
      } else {
        setStatus(`Kit "${kit.label}" unvollständig (${loaded} Samples).`, 'error');
      }
      audio.loadedKit = kitId;
      audio.loadingKit = null;
    }).catch(err => {
      setStatus(`Kit-Ladefehler: ${err.message}`, 'error');
      audio.loadingKit = null;
    });

    return audio._kitPromise;
  }

  function ensureAudioReady() {
    ensureCtx();
    if (audio.loadedKit !== state.currentKit && audio.loadingKit !== state.currentKit) {
      loadKit(state.currentKit);
    }
  }

  function chokeOpenHH(when) {
    if (!audio.openHHActive) return;
    const { source, gainNode } = audio.openHHActive;
    const stopAt = when || audio.ctx.currentTime;
    const fadeMs = 0.005;
    try {
      gainNode.gain.cancelScheduledValues(stopAt);
      gainNode.gain.setValueAtTime(gainNode.gain.value, stopAt);
      gainNode.gain.linearRampToValueAtTime(0, stopAt + fadeMs);
      source.stop(stopAt + fadeMs + 0.001);
    } catch (e) {}
    audio.openHHActive = null;
  }

  // Generischer Choker für beliebige aktive Sources
  function chokeActiveSource(trackId, when) {
    const active = audio.activeSources[trackId];
    if (!active) return;
    const stopAt = when || audio.ctx.currentTime;
    const fadeMs = 0.005;
    try {
      active.gainNode.gain.cancelScheduledValues(stopAt);
      active.gainNode.gain.setValueAtTime(active.gainNode.gain.value, stopAt);
      active.gainNode.gain.linearRampToValueAtTime(0, stopAt + fadeMs);
      active.source.stop(stopAt + fadeMs + 0.001);
    } catch (e) {}
    audio.activeSources[trackId] = null;
  }

  // Prüft welche Sources der gerade getriggerte Sound abwürgen soll
  function applyAudioChoke(triggeredId, when) {
    // Open-HH-Choke (bestehende Logik)
    if (CHOKES_OPEN.indexOf(triggeredId) !== -1) {
      chokeOpenHH(when);
    }
    // Kit-spezifische Choke-Regeln
    const kit = KITS[state.currentKit];
    if (!kit || !kit.audioChoke) return;
    // Für jede Regel: "trackX wird von [listIds] gechoked"
    // Wenn triggeredId in der Liste, würge trackX ab
    Object.keys(kit.audioChoke).forEach(victimId => {
      const choppers = kit.audioChoke[victimId];
      if (choppers.indexOf(triggeredId) !== -1) {
        chokeActiveSource(victimId, when);
      }
    });
  }

  function playSample(id, when, velocity) {
    if (!audio.buffers[id]) return;
    const playAt = when || audio.ctx.currentTime;

    // Choke-Regeln anwenden (sowohl Open-HH-Logik als auch Kit-spezifisch)
    applyAudioChoke(id, playAt);

    const src = audio.ctx.createBufferSource();
    src.buffer = audio.buffers[id];
    const g = audio.ctx.createGain();
    const drumGain = getEffectiveGain(id);
    const v = (typeof velocity === 'number') ? velocity : 1.0;
    g.gain.value = v * drumGain;

    if (id === 'hh' || id === 'oh' || id === 'ph') {
      const highpass = audio.ctx.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = 380;
      highpass.Q.value = 0.7;

      if (id === 'ph') {
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
    src.start(playAt);

    // Open-HH speziell tracken (für Auto-Choke bei nächster HiHat)
    if (id === 'oh') {
      audio.openHHActive = { source: src, gainNode: g, stopTime: playAt + (src.buffer.duration || 1.0) };
      src.onended = () => {
        if (audio.openHHActive && audio.openHHActive.source === src) {
          audio.openHHActive = null;
        }
      };
    }

    // Generisches Tracking: wenn dieser Sound im Choke-Verzeichnis als Opfer steht, merken
    const kit = KITS[state.currentKit];
    if (kit && kit.audioChoke && kit.audioChoke[id]) {
      audio.activeSources[id] = { source: src, gainNode: g };
      src.onended = ((existingHandler) => () => {
        if (existingHandler) existingHandler();
        if (audio.activeSources[id] && audio.activeSources[id].source === src) {
          audio.activeSources[id] = null;
        }
      })(src.onended);
    }
  }

  const el = {
    grid: document.getElementById('grid'),
    patternTabs: document.getElementById('patternTabs'),
    lengthTabs: document.getElementById('lengthTabs'),
    barTabs: document.getElementById('barTabs'),
    kitTabs: document.getElementById('kitTabs'),
    status: document.getElementById('loadStatus'),
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

  function updateCellVelocityBar(cellEl, velocity) {
    const bar = cellEl.querySelector('.velocity-bar');
    if (!bar) return;
    const pct = Math.max(0, Math.min(1, velocity)) * 100;
    bar.style.height = pct + '%';
  }

  function refreshTrackLabels() {
    TRACKS.forEach(track => {
      const lbl = el.grid.querySelector(`.row-label[data-track="${track.id}"] .row-label-name`);
      if (lbl) lbl.textContent = getTrackLabel(track.id);
    });
  }

  function buildGrid() {
    el.grid.innerHTML = '';
    TRACKS.forEach(track => {
      const lbl = document.createElement('div');
      lbl.className = 'row-label';
      lbl.dataset.track = track.id;
      const preview = document.createElement('button');
      preview.type = 'button';
      preview.className = 'preview-btn';
      preview.textContent = '♪';
      preview.title = 'Vorhören';
      preview.addEventListener('click', e => {
        e.stopPropagation();
        ensureAudioReady();
        (audio._kitPromise || Promise.resolve()).then(() => playSample(track.id));
      });
      const name = document.createElement('span');
      name.className = 'row-label-name';
      name.textContent = getTrackLabel(track.id);
      lbl.appendChild(preview);
      lbl.appendChild(name);
      el.grid.appendChild(lbl);
      for (let sib = 0; sib < STEPS_PER_BAR; sib++) {
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'cell' + (sib % 4 === 0 ? ' beat-start' : '');
        cell.dataset.track = track.id;
        cell.dataset.sib = String(sib);
        const velBar = document.createElement('span');
        velBar.className = 'velocity-bar';
        cell.appendChild(velBar);
        attachCellInteractions(cell, track.id, sib);
        el.grid.appendChild(cell);
      }
    });
  }

  // Generisches Grid-Mutex: bei aktiviertem trackId auf gleichem Step werden alle
  // Partner aus mutex-Paaren des aktuellen Kits entfernt
  function applyKitGridMutex(data, trackId, gStep) {
    const kit = KITS[state.currentKit];
    if (!kit || !kit.gridMutex) return;
    kit.gridMutex.forEach(pair => {
      if (pair.indexOf(trackId) === -1) return;
      pair.forEach(otherId => {
        if (otherId === trackId) return;
        if (data[otherId][gStep]) {
          data[otherId][gStep] = 0;
          const sib = gStep % STEPS_PER_BAR;
          const bar = Math.floor(gStep / STEPS_PER_BAR);
          if (bar === state.currentBar) {
            const otherCell = el.grid.querySelector(`.cell[data-track="${otherId}"][data-sib="${sib}"]`);
            if (otherCell) {
              otherCell.classList.remove('on');
              updateCellVelocityBar(otherCell, 0);
            }
          }
        }
      });
    });
  }

  function applyHihatMutex(data, trackId, gStep) {
    if (HIHAT_IDS.indexOf(trackId) === -1) return;
    HIHAT_IDS.forEach(otherId => {
      if (otherId !== trackId && data[otherId][gStep]) {
        data[otherId][gStep] = 0;
        const sib = gStep % STEPS_PER_BAR;
        const bar = Math.floor(gStep / STEPS_PER_BAR);
        if (bar === state.currentBar) {
          const otherCell = el.grid.querySelector(`.cell[data-track="${otherId}"][data-sib="${sib}"]`);
          if (otherCell) {
            otherCell.classList.remove('on');
            updateCellVelocityBar(otherCell, 0);
          }
        }
      }
    });
  }

  function applyAllMutex(data, trackId, gStep) {
    applyHihatMutex(data, trackId, gStep);
    applyKitGridMutex(data, trackId, gStep);
  }

  function attachCellInteractions(cell, trackId, sib) {
    let dragState = null;

    cell.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      e.preventDefault();

      const data = currentData();
      const gStep = globalStep(state.currentBar, sib);
      const wasActive = data[trackId][gStep] > 0;

      dragState = {
        startY: e.clientY,
        startVelocity: wasActive ? data[trackId][gStep] : DEFAULT_VELOCITY,
        wasActive: wasActive,
        didDrag: false,
        gStep: gStep
      };

      window.addEventListener('mousemove', onDragMove);
      window.addEventListener('mouseup', onDragEnd);
    });

    function onDragMove(e) {
      if (!dragState) return;
      const dy = dragState.startY - e.clientY;
      if (!dragState.didDrag && Math.abs(dy) >= DRAG_THRESHOLD_PX) {
        dragState.didDrag = true;

        if (!dragState.wasActive) {
          const data = currentData();
          applyAllMutex(data, trackId, dragState.gStep);
          data[trackId][dragState.gStep] = dragState.startVelocity;
          cell.classList.add('on');
          updateCellVelocityBar(cell, dragState.startVelocity);
        }
        cell.classList.add('dragging');
      }

      if (dragState.didDrag) {
        const delta = dy / DRAG_PIXELS_FOR_FULL_RANGE;
        let newVel = dragState.startVelocity + delta;
        newVel = Math.max(MIN_VELOCITY, Math.min(1.0, newVel));
        const data = currentData();
        data[trackId][dragState.gStep] = newVel;
        updateCellVelocityBar(cell, newVel);
      }
    }

    function onDragEnd(e) {
      window.removeEventListener('mousemove', onDragMove);
      window.removeEventListener('mouseup', onDragEnd);

      if (!dragState) return;

      const data = currentData();

      if (dragState.didDrag) {
        cell.classList.remove('dragging');
        renderPreviewNotation();
      } else {
        if (dragState.wasActive) {
          data[trackId][dragState.gStep] = 0;
          cell.classList.remove('on');
          updateCellVelocityBar(cell, 0);
        } else {
          applyAllMutex(data, trackId, dragState.gStep);
          data[trackId][dragState.gStep] = DEFAULT_VELOCITY;
          cell.classList.add('on');
          updateCellVelocityBar(cell, DEFAULT_VELOCITY);
          ensureAudioReady();
          (audio._kitPromise || Promise.resolve()).then(() => playSample(trackId, undefined, DEFAULT_VELOCITY));
        }
        renderPreviewNotation();
      }

      dragState = null;
    }
  }

  function refreshGrid() {
    const data = currentData();
    TRACKS.forEach(track => {
      for (let sib = 0; sib < STEPS_PER_BAR; sib++) {
        const gStep = globalStep(state.currentBar, sib);
        const cell = el.grid.querySelector(`.cell[data-track="${track.id}"][data-sib="${sib}"]`);
        if (!cell) continue;
        const v = data[track.id][gStep];
        cell.classList.toggle('on', v > 0);
        updateCellVelocityBar(cell, v);
      }
    });
  }

  function barHasContent(slot, bar) {
    const p = state.patterns[slot];
    const off = bar * STEPS_PER_BAR;
    for (const t of TRACKS) {
      const row = p.data[t.id];
      for (let s = 0; s < STEPS_PER_BAR; s++) if (row[off + s] > 0) return true;
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
    el.kitTabs.innerHTML = '';
    Object.keys(KITS).forEach(kitId => {
      const isActive = kitId === state.currentKit;
      const tab = makeTab(KITS[kitId].label, isActive, null, () => {
        if (state.currentKit === kitId) return;
        state.currentKit = kitId;
        rebuildTabs();
        refreshTrackLabels();
        loadKit(kitId);
      });
      el.kitTabs.appendChild(tab);
    });
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
    setStatus(`Takt ${state.currentBar + 1} von Pattern ${state.currentSlot} kopiert.`, 'success');
  });

  el.pasteBarBtn.addEventListener('click', () => {
    if (!state.barClipboard) return;
    const d = currentData();
    const off = state.currentBar * STEPS_PER_BAR;
    Object.keys(state.barClipboard).forEach(k => {
      if (!d[k]) return;
      for (let i = 0; i < STEPS_PER_BAR; i++) d[k][off + i] = state.barClipboard[k][i];
    });
    setStatus(`Eingefügt in Takt ${state.currentBar + 1} von Pattern ${state.currentSlot}.`, 'success');
    refreshGrid();
    rebuildTabs();
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
        const v = d[t.id][state.currentStep];
        if (v > 0) playSample(t.id, nextStepTime, v);
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
      el.playBtn.innerHTML = '▶ PLAY';
      el.grid.querySelectorAll('.cell.playing').forEach(c => c.classList.remove('playing'));
      chokeOpenHH();
      rebuildTabs();
      return;
    }
    ensureAudioReady();
    (audio._kitPromise || Promise.resolve()).then(() => {
      nextStepTime = audio.ctx.currentTime + 0.05;
      state.currentStep = -1;
      state.chainPlayingSlot = state.currentSlot;
      state.playing = true;
      el.playBtn.innerHTML = '■ STOP';
      schedulerInterval = setInterval(scheduler, 25);
      rebuildTabs();
    });
  }
  el.playBtn.addEventListener('click', togglePlay);

  const VF_MAP = {
    cr: { key: 'a/5/x2', voice: 'up' },
    ri: { key: 'f/5/x2', voice: 'up' },
    hh: { key: 'g/5/x2', voice: 'up' },
    oh: { key: 'g/5/x2', voice: 'up', open: true },
    ph: { key: 'd/4/x2', voice: 'down' },
    th: { key: 'e/5',   voice: 'up' },
    tm: { key: 'd/5',   voice: 'up' },
    tl: { key: 'a/4',   voice: 'down' },
    rs: { key: 'c/5/x2', voice: 'up' },
    sn: { key: 'c/5',   voice: 'up' },
    kd: { key: 'f/4',   voice: 'down' }
  };

  function renderPatternVex(container, pattern, opts) {
    opts = opts || {};
    if (typeof Vex === 'undefined') {
      container.innerHTML = '<div style="color:#888; font-size:12px;">Notations-Library wird geladen…</div>';
      return;
    }
    const VF = Vex.Flow;
    container.innerHTML = '';

    const bars = pattern.bars;
    const barWidth = opts.barWidth || 480;
    const leftPad = 70;
    const rightPad = 20;
    const width = leftPad + bars * barWidth + rightPad;
    const height = opts.height || 220;

    const div = document.createElement('div');
    container.appendChild(div);

    const renderer = new VF.Renderer(div, VF.Renderer.Backends.SVG);
    renderer.resize(width, height);
    const ctx = renderer.getContext();
    ctx.setFont('Arial', 10);

    const staveTop = opts.label ? 60 : 40;

    for (let barIdx = 0; barIdx < bars; barIdx++) {
      const x = (barIdx === 0) ? 10 : leftPad + barIdx * barWidth - 10;
      const w = (barIdx === 0) ? leftPad + barWidth - 20 : barWidth;
      const stave = new VF.Stave(x, staveTop, w);
      if (barIdx === 0) {
        stave.addClef('percussion').addTimeSignature('4/4');
      }
      if (barIdx === bars - 1) {
        stave.setEndBarType(VF.Barline.type.END);
      }
      stave.setContext(ctx).draw();

      ctx.save();
      ctx.setFont('Arial', 9);
      ctx.fillText('Takt ' + (barIdx + 1), x + 4, staveTop - 6);
      ctx.restore();

      const barOffset = barIdx * STEPS_PER_BAR;
      const upperNotes = [];
      const lowerNotes = [];
      const upperRestFlags = [];
      const lowerRestFlags = [];

      for (let sib = 0; sib < STEPS_PER_BAR; sib++) {
        const gStep = barOffset + sib;
        const upperKeys = [];
        const lowerKeys = [];
        let upperHasOpen = false;

        TRACKS.forEach(t => {
          if (!(pattern.data[t.id][gStep] > 0)) return;
          const m = VF_MAP[t.id];
          if (!m) return;
          if (m.voice === 'up') {
            upperKeys.push(m.key);
            if (m.open) upperHasOpen = true;
          } else {
            lowerKeys.push(m.key);
          }
        });

        if (upperKeys.length === 0) {
          upperNotes.push(new VF.StaveNote({ keys: ['b/4'], duration: '16r' }));
          upperRestFlags.push(true);
        } else {
          const note = new VF.StaveNote({
            keys: upperKeys, duration: '16', stem_direction: VF.Stem.UP
          });
          if (upperHasOpen) {
            try {
              note.addModifier(new VF.Articulation('a@a').setPosition(VF.Modifier.Position.ABOVE), 0);
            } catch(e) {}
          }
          upperNotes.push(note);
          upperRestFlags.push(false);
        }

        if (lowerKeys.length === 0) {
          lowerNotes.push(new VF.StaveNote({ keys: ['d/4'], duration: '16r' }));
          lowerRestFlags.push(true);
        } else {
          lowerNotes.push(new VF.StaveNote({
            keys: lowerKeys, duration: '16', stem_direction: VF.Stem.DOWN
          }));
          lowerRestFlags.push(false);
        }
      }

      const upperBeams = [];
      const lowerBeams = [];
      for (let g = 0; g < 4; g++) {
        const startIdx = g * 4;
        const ugroup = upperNotes.slice(startIdx, startIdx + 4).filter(n => !n.isRest());
        if (ugroup.length >= 2) upperBeams.push(new VF.Beam(ugroup));
        const lgroup = lowerNotes.slice(startIdx, startIdx + 4).filter(n => !n.isRest());
        if (lgroup.length >= 2) lowerBeams.push(new VF.Beam(lgroup));
      }

      const voice1 = new VF.Voice({ num_beats: 4, beat_value: 4 }).setStrict(false).addTickables(upperNotes);
      const voice2 = new VF.Voice({ num_beats: 4, beat_value: 4 }).setStrict(false).addTickables(lowerNotes);

      const formatter = new VF.Formatter();
      formatter.joinVoices([voice1, voice2]).format([voice1, voice2], w - 50);

      upperNotes.forEach((note, i) => {
        if (upperRestFlags[i]) {
          note.setStyle({ fillStyle: 'rgba(0,0,0,0)', strokeStyle: 'rgba(0,0,0,0)' });
        }
      });
      lowerNotes.forEach((note, i) => {
        if (lowerRestFlags[i]) {
          note.setStyle({ fillStyle: 'rgba(0,0,0,0)', strokeStyle: 'rgba(0,0,0,0)' });
        }
      });

      voice1.draw(ctx, stave);
      voice2.draw(ctx, stave);
      upperBeams.forEach(b => b.setContext(ctx).draw());
      lowerBeams.forEach(b => b.setContext(ctx).draw());
    }

    if (opts.label) {
      ctx.save();
      ctx.setFont('Arial', 12, 'bold');
      ctx.fillText(opts.label, 10, 22);
      ctx.restore();
    }
  }

  function renderPreviewNotation() {
    if (!el.notationPreview) return;
    renderPatternVex(el.notationPreview, state.patterns[state.currentSlot], {
      label: `Pattern ${state.currentSlot} · ${state.patterns[state.currentSlot].bars} ${state.patterns[state.currentSlot].bars === 1 ? 'Takt' : 'Takte'}`,
      barWidth: 460,
      height: 200
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
      setStatus('Notations-Library noch nicht geladen.', 'error');
      return;
    }
    const jsPDFCtor = getJsPDF();
    const svg2pdfFn = getSvg2Pdf();
    if (!jsPDFCtor || !svg2pdfFn) {
      setStatus('PDF-Libraries noch nicht geladen. Bitte Seite neu laden.', 'error');
      return;
    }
    setStatus('Erstelle Notenblatt…');

    const slotsToExport = SLOTS.filter(slot => slotHasContent(slot));
    if (slotsToExport.length === 0) {
      setStatus('Keine Patterns mit Inhalt vorhanden.', 'error');
      return;
    }

    const pdf = new jsPDFCtor({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = 210, pageH = 297, margin = 15;

    pdf.setFontSize(18);
    pdf.setFont('helvetica', 'bold');
    pdf.text('DR-25840', margin, margin + 6);
    pdf.setFontSize(9);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(100);
    const date = new Date().toLocaleDateString('de-DE');
    const bpmVal = el.bpm.value;
    const kitLabel = KITS[state.currentKit].label;
    pdf.text(`Notenblatt · ${date} · ${bpmVal} BPM · Kit: ${kitLabel}`, margin, margin + 12);
    pdf.setTextColor(0);

    pdf.setFontSize(9);
    pdf.setFont('helvetica', 'italic');
    pdf.text('Perkussions-Schlüssel, 4/4. x-Köpfe = Becken/HiHat/Rim-Click, ovale Köpfe = Trommeln.', margin, margin + 18);
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

      renderPatternVex(tempDiv, pattern, { barWidth: 460, height: 180 });

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
    [
      'Crash / Ride / Hi-Hat: x-Notenkopf über dem System',
      'Open Hi-Hat: x-Notenkopf mit kleinem Kreis "o" darüber',
      'Pedal Hi-Hat: x-Notenkopf unter dem System',
      'Rim-Click: x-Notenkopf auf der Snare-Position',
      'Toms: ovale Notenköpfe',
      'Snare: ovaler Notenkopf im mittleren Zwischenraum',
      'Kick: ovaler Notenkopf unter dem System, Hals nach unten'
    ].forEach(l => { pdf.text('• ' + l, margin, yPos); yPos += 4.5; });

    pdf.save(`trackofaktor-${date.replace(/\./g, '-')}.pdf`);
    setStatus('Notenblatt als PDF gespeichert.', 'success');
  }

  el.exportPdfBtn.addEventListener('click', exportPDF);

  buildGrid();
  refreshGrid();
  rebuildTabs();

  function tryInitialRender(attempts) {
    if (typeof Vex !== 'undefined') {
      renderPreviewNotation();
    } else if (attempts < 40) {
      setTimeout(() => tryInitialRender(attempts + 1), 100);
    }
  }
  tryInitialRender(0);
})();