// painter.js — renders a Vice City style cover poster onto a 2D canvas.
// All geometry is derived from the canvas size; every decorative random
// element comes from a seeded generator so the same state always paints
// the same pixels.

export const PHOTOS = [
  { id: 'hero-car', src: 'photos/hero-car.jpg', label: 'Dusk chase', focus: [0.5, 0.55] },
  { id: 'woman-red', src: 'photos/woman-red.jpg', label: 'Red smile', focus: [0.5, 0.28] },
  { id: 'woman-turquoise', src: 'photos/woman-turquoise.jpg', label: 'Turquoise', focus: [0.5, 0.25] },
  { id: 'man-beard', src: 'photos/man-beard.jpg', label: 'Night lead', focus: [0.5, 0.30] },
  { id: 'surfer', src: 'photos/surfer.jpg', label: 'Wave barrel', focus: [0.45, 0.5] },
  { id: 'beach-sunset', src: 'photos/beach-sunset.jpg', label: 'Beach sunset', focus: [0.5, 0.45] },
  { id: 'palm-beach', src: 'photos/palm-beach.jpg', label: 'Palm beach', focus: [0.35, 0.45] },
  { id: 'street-night', src: 'photos/street-night.jpg', label: 'Wet street', focus: [0.5, 0.55] },
  { id: 'neon-hotel', src: 'photos/neon-hotel.jpg', label: 'Neon sign', focus: [0.5, 0.45] },
  { id: 'oceandrive', src: 'photos/oceandrive.jpg', label: 'Ocean Drive', focus: [0.5, 0.5] },
];

export const GRADES = {
  'vice-sunset': {
    label: 'Vice Sunset',
    filter: 'saturate(1.45) contrast(1.10) brightness(1.04) sepia(0.14)',
    sky: ['#ff5e8a', '#ff8a3d', '#8a2be2'],
    tint: 'rgba(255, 96, 48, 0.12)',
  },
  'neon-miami': {
    label: 'Neon Miami',
    filter: 'saturate(1.55) contrast(1.12) brightness(1.00) hue-rotate(-14deg)',
    sky: ['#ff2e88', '#b537f2', '#2de2ff'],
    tint: 'rgba(255, 46, 136, 0.10)',
  },
  'golden-hour': {
    label: 'Golden Hour',
    filter: 'saturate(1.25) contrast(1.06) brightness(1.08) sepia(0.28)',
    sky: ['#ffb347', '#ff7e2d', '#c94b7c'],
    tint: 'rgba(255, 170, 40, 0.10)',
  },
  'midnight': {
    label: 'Midnight Synthwave',
    filter: 'saturate(1.45) contrast(1.16) brightness(0.92) hue-rotate(16deg)',
    sky: ['#2de2ff', '#7b2ff7', '#ff2e88'],
    tint: 'rgba(80, 40, 255, 0.12)',
  },
};

export const FINISHES = {
  none: 'None',
  halftone: 'Halftone print',
  posterize: 'Posterize',
};

// A deterministic 32-bit LCG (Numerical Recipes constants).
export function seeded(seed) {
  let s = seed >>> 0;
  return function next() {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Layouts return panel rects in pixels. The photo grid occupies the top
// 78% of the cover; the title band takes the bottom 22%.
export const LAYOUTS = {
  'vice-grid': {
    label: 'Vice Grid',
    slots: 6,
    panels(W, H, g) {
      const gh = H * 0.78;
      const heroW = W * 0.58;
      return [
        { x: g, y: g, w: heroW - g * 1.5, h: gh * 0.667 - g * 1.5 },
        { x: heroW + g / 2, y: g, w: W - heroW - g * 1.5, h: gh * 0.333 - g * 1.5 },
        { x: heroW + g / 2, y: gh * 0.333 + g / 2, w: W - heroW - g * 1.5, h: gh * 0.333 - g * 1.5 },
        { x: g, y: gh * 0.667 + g / 2, w: W / 3 - g * 1.5, h: gh * 0.333 - g * 1.5 },
        { x: W / 3 + g / 2, y: gh * 0.667 + g / 2, w: W / 3 - g, h: gh * 0.333 - g * 1.5 },
        { x: (2 * W) / 3 + g / 2, y: gh * 0.667 + g / 2, w: W / 3 - g * 1.5, h: gh * 0.333 - g * 1.5 },
      ];
    },
  },
  'classic-3x3': {
    label: 'Classic 3x3',
    slots: 9,
    panels(W, H, g) {
      const gh = H * 0.78;
      const out = [];
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          out.push({
            x: (W * c) / 3 + (c === 0 ? g : g / 2),
            y: (gh * r) / 3 + (r === 0 ? g : g / 2),
            w: W / 3 - (c === 2 ? g * 1.5 : g),
            h: gh / 3 - (r === 2 ? g * 1.5 : g),
          });
        }
      }
      return out;
    },
  },
  'hero-strips': {
    label: 'Hero + Strips',
    slots: 5,
    panels(W, H, g) {
      const gh = H * 0.78;
      const out = [{ x: g, y: g, w: W - g * 2, h: gh * 0.667 - g * 1.5 }];
      for (let i = 0; i < 4; i++) {
        out.push({
          x: (W * i) / 4 + (i === 0 ? g : g / 2),
          y: gh * 0.667 + g / 2,
          w: W / 4 - (i === 3 ? g * 1.5 : g),
          h: gh * 0.333 - g * 1.5,
        });
      }
      return out;
    },
  },
  'diagonal': {
    label: 'Diagonal Split',
    slots: 3,
    panels(W, H, g) {
      const gh = H * 0.78;
      const cut = W * 0.60;
      return [
        {
          x: g, y: g, w: cut - g, h: gh - g * 2,
          clip: [[g, g], [cut - g, g], [cut - W * 0.10 - g, gh - g], [g, gh - g]],
        },
        { x: cut + g / 2, y: g, w: W - cut - g * 1.5, h: gh * 0.5 - g * 1.5 },
        { x: cut + g / 2, y: gh * 0.5 + g / 2, w: W - cut - g * 1.5, h: gh * 0.5 - g * 1.5 },
      ];
    },
  },
};

export const DEFAULT_STATE = {
  layout: 'vice-grid',
  grade: 'vice-sunset',
  finish: 'none',
  title: 'GOLDEN COAST',
  tagline: 'Every sunset is a getaway',
  pill: 'LEONIDA',
  size: 'square',
  slots: ['hero-car', 'woman-red', 'neon-hotel', 'surfer', 'street-night', 'palm-beach', 'oceandrive', 'man-beard', 'beach-sunset'],
  zooms: [1, 1, 1, 1, 1, 1, 1, 1, 1],
  pans: [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]],
};

export const EXPORT_SIZES = {
  square: { w: 1080, h: 1080, label: '1080 × 1080' },
  portrait: { w: 1080, h: 1350, label: '1080 × 1350' },
  wide: { w: 1920, h: 1080, label: '1920 × 1080' },
};

function drawPhoto(ctx, img, r, zoom, pan, focus) {
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const s = Math.max(r.w / iw, r.h / ih) * zoom;
  const vw = r.w / s;
  const vh = r.h / s;
  const slackX = Math.max(0, iw - vw);
  const slackY = Math.max(0, ih - vh);
  // The visible window is centred on the photo's focus point when one is
  // given (a face stays in frame in a wide panel), then shifted by pan.
  let sx = focus ? focus[0] * iw - vw / 2 : (iw - vw) / 2;
  let sy = focus ? focus[1] * ih - vh / 2 : (ih - vh) / 2;
  sx += (pan[0] || 0) * (slackX / 2);
  sy += (pan[1] || 0) * (slackY / 2);
  sx = Math.max(0, Math.min(slackX, sx));
  sy = Math.max(0, Math.min(slackY, sy));
  ctx.drawImage(img, sx, sy, vw, vh, r.x, r.y, r.w, r.h);
}

function drawPalm(ctx, x, y, s, lean) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.fillStyle = '#14082a';
  // Trunk: a gentle curve leaning the given way.
  ctx.beginPath();
  ctx.moveTo(-5, 0);
  ctx.quadraticCurveTo(-5 + lean * 30, -70, lean * 55, -128);
  ctx.lineTo(lean * 55 + 7, -126);
  ctx.quadraticCurveTo(lean * 30 + 4, -66, 6, 0);
  ctx.closePath();
  ctx.fill();
  // Fronds: seven tapered arcs fanning from the crown.
  const cx = lean * 55, cy = -128;
  for (let i = 0; i < 7; i++) {
    const a = (-165 + i * 27.5) * (Math.PI / 180);
    const len = 62 - Math.abs(i - 3) * 5;
    const ex = cx + Math.cos(a) * len;
    const ey = cy + Math.sin(a) * len * 0.55 + 14;
    const mx = cx + Math.cos(a) * len * 0.55;
    const my = cy + Math.sin(a) * len * 0.28 - 8;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.quadraticCurveTo(mx, my, ex, ey);
    ctx.quadraticCurveTo(mx + 6, my + 10, cx + 4, cy + 3);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawSkyline(ctx, W, bandY, bandH, rnd) {
  const base = bandY + bandH;
  ctx.fillStyle = '#14082a';
  let x = -10;
  while (x < W + 10) {
    const bw = (28 + rnd() * 62) * (W / 1080);
    const bh = bandH * 0.05 + rnd() * bandH * 0.11;
    const by = base - bh;
    ctx.fillRect(x, by, bw, bh);
    // Antenna on a few towers.
    if (rnd() < 0.22) ctx.fillRect(x + bw / 2 - 1, by - bandH * 0.05, 2, bandH * 0.05);
    // Lit windows.
    const cols = Math.max(1, Math.floor(bw / (9 * (W / 1080))));
    const rows = Math.max(1, Math.floor(bh / (13 * (W / 1080))));
    ctx.fillStyle = 'rgba(255, 210, 61, 0.92)';
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        if (rnd() < 0.30) {
          ctx.fillRect(x + 3 + c * 9 * (W / 1080), by + 5 + r * 13 * (W / 1080), 3.4 * (W / 1080), 5 * (W / 1080));
        }
      }
    }
    ctx.fillStyle = '#14082a';
    x += bw + (2 + rnd() * 8) * (W / 1080);
  }
}

function drawStarburst(ctx, cx, cy, r, points, rot, fill, stroke) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const rr = i % 2 === 0 ? r : r * 0.62;
    const a = (i * Math.PI) / points - Math.PI / 2;
    const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = stroke;
  ctx.stroke();
  ctx.restore();
}

function fitFont(ctx, text, fontFamily, startSize, maxWidth, weight) {
  let size = startSize;
  while (size > 12) {
    ctx.font = `${weight} ${size}px ${fontFamily}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 2;
  }
  return size;
}

export function paintCover(ctx, W, H, state, images) {
  const grade = GRADES[state.grade] || GRADES['vice-sunset'];
  const layout = LAYOUTS[state.layout] || LAYOUTS['vice-grid'];
  const gap = Math.max(4, Math.round(W * 0.005));
  const seed = hashStr(state.layout + '|' + state.grade + '|' + state.title);
  const rnd = seeded(seed);

  // White gutters, photo grid.
  ctx.save();
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.filter = 'none';

  const panels = layout.panels(W, H, gap);
  panels.forEach((r, i) => {
    const photoId = state.slots[i] || PHOTOS[i % PHOTOS.length].id;
    const photo = PHOTOS.find((p) => p.id === photoId) || PHOTOS[i % PHOTOS.length];
    const img = images.get(photo.id);
    if (!img) return;
    ctx.save();
    ctx.beginPath();
    if (r.clip) {
      ctx.moveTo(r.clip[0][0], r.clip[0][1]);
      for (let k = 1; k < r.clip.length; k++) ctx.lineTo(r.clip[k][0], r.clip[k][1]);
      ctx.closePath();
    } else {
      ctx.rect(r.x, r.y, r.w, r.h);
    }
    ctx.clip();
    ctx.filter = grade.filter;
    drawPhoto(ctx, img, r, state.zooms[i] || 1, state.pans[i] || [0, 0], photo.focus);
    ctx.filter = 'none';
    // Warm unify tint.
    ctx.globalCompositeOperation = 'overlay';
    const tg = ctx.createLinearGradient(r.x, r.y, r.x, r.y + r.h);
    tg.addColorStop(0, grade.tint);
    tg.addColorStop(0.5, 'rgba(255,255,255,0.02)');
    tg.addColorStop(1, 'rgba(20,8,42,0.12)');
    ctx.fillStyle = tg;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.globalCompositeOperation = 'source-over';
    // Vignette.
    const vg = ctx.createRadialGradient(
      r.x + r.w / 2, r.y + r.h / 2, Math.min(r.w, r.h) * 0.42,
      r.x + r.w / 2, r.y + r.h / 2, Math.max(r.w, r.h) * 0.78,
    );
    vg.addColorStop(0, 'rgba(10,4,20,0)');
    vg.addColorStop(1, 'rgba(10,4,20,0.30)');
    ctx.fillStyle = vg;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.restore();
  });

  // ---- Title band ----
  const bandY = H * 0.78;
  const bandH = H * 0.22;
  const sky = ctx.createLinearGradient(0, bandY, 0, bandY + bandH);
  sky.addColorStop(0, grade.sky[0]);
  sky.addColorStop(0.55, grade.sky[1]);
  sky.addColorStop(1, grade.sky[2]);
  ctx.fillStyle = sky;
  ctx.fillRect(0, bandY, W, bandH);

  // Retro sun with horizontal slits (slits are painted with the sky
  // gradient itself, so they read as cut-outs). It sits high so its top
  // arc shows above the title.
  const sunCx = W * 0.5;
  const sunCy = bandY + bandH * 0.26;
  const sunR = bandH * 0.34;
  const sunGrad = ctx.createLinearGradient(0, sunCy - sunR, 0, sunCy + sunR);
  sunGrad.addColorStop(0, '#fff3b0');
  sunGrad.addColorStop(0.55, '#ffb347');
  sunGrad.addColorStop(1, '#ff5e8a');
  ctx.save();
  ctx.beginPath();
  ctx.arc(sunCx, sunCy, sunR, 0, Math.PI * 2);
  ctx.fillStyle = sunGrad;
  ctx.fill();
  ctx.clip();
  ctx.fillStyle = sky;
  let slitY = sunCy + sunR * 0.08;
  let slitH = Math.max(2, bandH * 0.012);
  while (slitY < sunCy + sunR) {
    ctx.fillRect(sunCx - sunR - 2, slitY, sunR * 2 + 4, slitH);
    slitY += slitH + bandH * 0.055;
    slitH *= 1.35;
  }
  ctx.restore();

  // Skyline silhouette + lit windows.
  drawSkyline(ctx, W, bandY, bandH, rnd);

  // Palms at both edges of the band, kept small so they frame the title
  // instead of crossing it.
  drawPalm(ctx, W * 0.03, bandY + bandH, (W / 1080) * 0.62, 1);
  drawPalm(ctx, W * 0.97, bandY + bandH, (W / 1080) * 0.62, -1);

  // Pill badge.
  const pillText = `★ ${state.pill || 'LEONIDA'} ★`;
  const pillSize = fitFont(ctx, pillText, 'Anton, sans-serif', Math.round(H * 0.021), W * 0.5, 400);
  ctx.font = `400 ${pillSize}px Anton, sans-serif`;
  const pillW = ctx.measureText(pillText).width + pillSize * 2.2;
  const pillH = pillSize * 1.9;
  const pillX = (W - pillW) / 2;
  const pillY = bandY + bandH * 0.10;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(pillX, pillY, pillW, pillH, pillH / 2);
  ctx.fillStyle = '#1a0b2e';
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, W * 0.0016);
  ctx.strokeStyle = '#ffd23d';
  ctx.stroke();
  ctx.fillStyle = '#ffd23d';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(pillText, W / 2, pillY + pillH / 2 + pillSize * 0.05);
  ctx.restore();

  // Title: giant condensed gradient type with dark outline.
  const titleSize = fitFont(ctx, state.title, 'Anton, sans-serif', Math.round(H * 0.118), W * 0.92, 400);
  ctx.save();
  ctx.font = `400 ${titleSize}px Anton, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const titleGrad = ctx.createLinearGradient(0, bandY + bandH * 0.26, 0, bandY + bandH * 0.62);
  titleGrad.addColorStop(0, '#ffffff');
  titleGrad.addColorStop(0.6, '#fff6d8');
  titleGrad.addColorStop(1, '#ffd23d');
  ctx.shadowColor = 'rgba(10, 4, 20, 0.5)';
  ctx.shadowBlur = titleSize * 0.10;
  ctx.shadowOffsetY = titleSize * 0.045;
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(3, titleSize * 0.055);
  ctx.strokeStyle = '#1a0b2e';
  const titleY = bandY + bandH * 0.60;
  ctx.strokeText(state.title, W / 2, titleY);
  ctx.fillStyle = titleGrad;
  ctx.fillText(state.title, W / 2, titleY);
  ctx.restore();

  // Tagline in script, in the clear strip above the skyline.
  const tagSize = fitFont(ctx, state.tagline, 'Yellowtail, cursive', Math.round(H * 0.032), W * 0.8, 400);
  ctx.save();
  ctx.font = `400 ${tagSize}px Yellowtail, cursive`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(10, 4, 20, 0.55)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = '#ffd23d';
  ctx.fillText(state.tagline, W / 2, bandY + bandH * 0.82);
  ctx.restore();

  // Starburst "EST. 2026" over the hero's sky, top-left of the cover.
  const sbR = H * 0.042;
  const sbX = W * 0.075;
  const sbY = H * 0.055;
  drawStarburst(ctx, sbX, sbY, sbR, 14, -0.21, '#ffd23d', '#1a0b2e');
  ctx.save();
  ctx.fillStyle = '#1a0b2e';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `400 ${Math.round(sbR * 0.30)}px Anton, sans-serif`;
  ctx.fillText('EST.', sbX, sbY - sbR * 0.16);
  ctx.font = `400 ${Math.round(sbR * 0.34)}px Anton, sans-serif`;
  ctx.fillText('2026', sbX, sbY + sbR * 0.22);
  ctx.restore();

  // Pink NEW dot on the last panel.
  const last = panels[panels.length - 1];
  if (last) {
    const nx = last.x + last.w - H * 0.026;
    const ny = last.y + last.h - H * 0.026;
    ctx.save();
    ctx.beginPath();
    ctx.arc(nx, ny, H * 0.022, 0, Math.PI * 2);
    ctx.fillStyle = '#ff2e88';
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, W * 0.0016);
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `400 ${Math.round(H * 0.0135)}px Anton, sans-serif`;
    ctx.fillText('NEW', nx, ny + 1);
    ctx.restore();
  }

  // ---- Finish + grain (whole cover) ----
  if (state.finish === 'halftone') {
    ctx.save();
    ctx.globalAlpha = 0.10;
    ctx.fillStyle = '#14082a';
    const step = Math.max(5, Math.round(W * 0.006));
    for (let y = step / 2; y < H; y += step) {
      for (let x = step / 2; x < W; x += step) {
        ctx.beginPath();
        ctx.arc(x, y, step * 0.16, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  } else if (state.finish === 'posterize') {
    const img = ctx.getImageData(0, 0, W, H);
    const d = img.data;
    const levels = 5;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = Math.round((d[i] / 255) * (levels - 1)) * (255 / (levels - 1));
      d[i + 1] = Math.round((d[i + 1] / 255) * (levels - 1)) * (255 / (levels - 1));
      d[i + 2] = Math.round((d[i + 2] / 255) * (levels - 1)) * (255 / (levels - 1));
    }
    ctx.putImageData(img, 0, 0);
  }
  // Deterministic grain.
  ctx.save();
  ctx.globalAlpha = 0.05;
  ctx.fillStyle = '#000000';
  const grain = seeded(seed ^ 0x9e3779b9);
  for (let i = 0; i < 1400; i++) {
    ctx.fillRect(grain() * W, grain() * H, 1.4, 1.4);
  }
  ctx.restore();
  ctx.restore();
}
