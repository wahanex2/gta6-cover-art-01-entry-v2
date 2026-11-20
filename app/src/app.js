// app.js — editor wiring for Vice Light Studio.
// State lives in one object; every control mutates it and repaints the
// preview canvas at the chosen export resolution.
import { PHOTOS, GRADES, FINISHES, LAYOUTS, DEFAULT_STATE, EXPORT_SIZES, paintCover } from './painter.js';

const state = structuredClone(DEFAULT_STATE);
let images = new Map();
let selected = 0;
let canvas = null;
let ctx = null;
let drag = null;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function currentSize() {
  return EXPORT_SIZES[state.size] || EXPORT_SIZES.square;
}

function repaint() {
  const { w, h } = currentSize();
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  paintCover(ctx, w, h, state, images);
  $('#sizeLabel').textContent = `${w} × ${h} — ${LAYOUTS[state.layout].label} / ${GRADES[state.grade].label}`;
}

function loadImages() {
  return Promise.all(
    PHOTOS.map(
      (p) =>
        new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            images.set(p.id, img);
            resolve();
          };
          img.onerror = () => resolve();
          img.src = p.src;
        }),
    ),
  );
}

function buildLayoutButtons() {
  const box = $('#layoutBox');
  box.innerHTML = '';
  Object.entries(LAYOUTS).forEach(([id, def]) => {
    const b = document.createElement('button');
    b.className = 'chip' + (state.layout === id ? ' active' : '');
    b.textContent = def.label;
    b.addEventListener('click', () => {
      state.layout = id;
      selected = 0;
      syncControls();
      repaint();
    });
    box.appendChild(b);
  });
}

function buildGradeSwatches() {
  const box = $('#gradeBox');
  box.innerHTML = '';
  Object.entries(GRADES).forEach(([id, def]) => {
    const b = document.createElement('button');
    b.className = 'swatch' + (state.grade === id ? ' active' : '');
    b.style.background = `linear-gradient(135deg, ${def.sky[0]}, ${def.sky[1]} 55%, ${def.sky[2]})`;
    b.title = def.label;
    b.innerHTML = `<span>${def.label}</span>`;
    b.addEventListener('click', () => {
      state.grade = id;
      syncControls();
      repaint();
    });
    box.appendChild(b);
  });
}

function buildFinishButtons() {
  const box = $('#finishBox');
  box.innerHTML = '';
  Object.entries(FINISHES).forEach(([id, label]) => {
    const b = document.createElement('button');
    b.className = 'chip' + (state.finish === id ? ' active' : '');
    b.textContent = label;
    b.addEventListener('click', () => {
      state.finish = id;
      syncControls();
      repaint();
    });
    box.appendChild(b);
  });
}

function buildPhotoGrid() {
  const box = $('#photoGrid');
  box.innerHTML = '';
  PHOTOS.forEach((p) => {
    const d = document.createElement('div');
    d.className = 'thumb';
    d.title = p.label;
    const img = document.createElement('img');
    img.src = p.src;
    img.alt = p.label;
    d.appendChild(img);
    const tag = document.createElement('span');
    tag.textContent = p.label;
    d.appendChild(tag);
    d.addEventListener('click', () => {
      state.slots[selected] = p.id;
      state.zooms[selected] = 1;
      state.pans[selected] = [0, 0];
      repaint();
    });
    box.appendChild(d);
  });
}

function buildSlotRow() {
  const box = $('#slotRow');
  box.innerHTML = '';
  const layout = LAYOUTS[state.layout];
  for (let i = 0; i < layout.slots; i++) {
    const b = document.createElement('button');
    b.className = 'slot' + (selected === i ? ' active' : '');
    const photo = PHOTOS.find((p) => p.id === state.slots[i]);
    b.textContent = `Panel ${i + 1} · ${photo ? photo.label : '—'}`;
    b.addEventListener('click', () => {
      selected = i;
      syncControls();
    });
    box.appendChild(b);
  }
}

function syncControls() {
  buildLayoutButtons();
  buildGradeSwatches();
  buildFinishButtons();
  buildSlotRow();
  $('#titleInput').value = state.title;
  $('#taglineInput').value = state.tagline;
  $('#pillInput').value = state.pill;
  $('#zoomRange').value = state.zooms[selected] || 1;
}

function bindInputs() {
  $('#titleInput').addEventListener('input', (e) => {
    state.title = e.target.value.toUpperCase();
    repaint();
  });
  $('#taglineInput').addEventListener('input', (e) => {
    state.tagline = e.target.value;
    repaint();
  });
  $('#pillInput').addEventListener('input', (e) => {
    state.pill = e.target.value.toUpperCase();
    repaint();
  });
  $('#zoomRange').addEventListener('input', (e) => {
    state.zooms[selected] = parseFloat(e.target.value);
    repaint();
  });
  $('#shuffleBtn').addEventListener('click', () => {
    const pool = PHOTOS.map((p) => p.id);
    const layout = LAYOUTS[state.layout];
    const picked = [];
    while (picked.length < layout.slots) {
      const id = pool[Math.floor(Math.random() * pool.length)];
      if (!picked.includes(id)) picked.push(id);
    }
    state.slots = picked.concat(state.slots.slice(layout.slots));
    repaint();
  });
  $('#fillBtn').addEventListener('click', () => {
    const layout = LAYOUTS[state.layout];
    const id = state.slots[selected];
    state.slots = state.slots.map((_, i) => (i < layout.slots ? id : state.slots[i]));
    repaint();
  });
  $$('#sizeBox .chip').forEach((b) => {
    b.addEventListener('click', () => {
      state.size = b.dataset.size;
      $$('#sizeBox .chip').forEach((x) => x.classList.toggle('active', x === b));
      repaint();
    });
  });
  $('#downloadBtn').addEventListener('click', () => {
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `vice-light-${state.size}-${state.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, 'image/png');
  });
}

function bindCanvas() {
  canvas.addEventListener('pointerdown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
    const layout = LAYOUTS[state.layout];
    const panels = layout.panels(canvas.width, canvas.height, Math.max(4, Math.round(canvas.width * 0.005)));
    for (let i = 0; i < panels.length; i++) {
      const r = panels[i];
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
        selected = i;
        drag = { x, y, pan: [...(state.pans[i] || [0, 0])] };
        syncControls();
        canvas.setPointerCapture(e.pointerId);
        break;
      }
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
    const dx = ((x - drag.x) / canvas.width) * 2;
    const dy = ((y - drag.y) / canvas.height) * 2;
    state.pans[selected] = [
      Math.max(-1, Math.min(1, drag.pan[0] + dx)),
      Math.max(-1, Math.min(1, drag.pan[1] + dy)),
    ];
    repaint();
  });
  canvas.addEventListener('pointerup', () => {
    drag = null;
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const z = state.zooms[selected] || 1;
    state.zooms[selected] = Math.max(1, Math.min(2.4, z + (e.deltaY < 0 ? 0.08 : -0.08)));
    $('#zoomRange').value = state.zooms[selected];
    repaint();
  }, { passive: false });
}

async function init() {
  canvas = $('#cover');
  ctx = canvas.getContext('2d');
  if (window.__shotPreset) {
    Object.assign(state, window.__shotPreset);
  }
  buildPhotoGrid();
  bindInputs();
  bindCanvas();
  await loadImages();
  await document.fonts.ready;
  syncControls();
  repaint();
  window.__viceReady = true;
  window.__shotReady = true;
}

init();
