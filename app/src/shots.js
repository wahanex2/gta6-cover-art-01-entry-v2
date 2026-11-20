// shots.js — deterministic shot presets for screenshots.
// Loaded as a classic script BEFORE the module editor, so the preset is
// in place before the first paint. Reads ?shot=1..4 from the URL.
(function () {
  var params = new URLSearchParams(window.location.search);
  var shot = params.get('shot');
  if (!shot) return;
  var SHOTS = {
    1: {
      bare: true, size: 'square', layout: 'vice-grid', grade: 'vice-sunset',
      finish: 'none', title: 'GOLDEN COAST', tagline: 'Every sunset is a getaway',
      pill: 'LEONIDA',
      slots: ['hero-car', 'woman-red', 'neon-hotel', 'surfer', 'street-night', 'palm-beach'],
    },
    2: {
      bare: false, size: 'square', layout: 'vice-grid', grade: 'vice-sunset',
      finish: 'none', title: 'GOLDEN COAST', tagline: 'Every sunset is a getaway',
      pill: 'LEONIDA',
      slots: ['hero-car', 'woman-red', 'neon-hotel', 'surfer', 'street-night', 'palm-beach'],
    },
    3: {
      bare: true, size: 'portrait', layout: 'hero-strips', grade: 'golden-hour',
      finish: 'none', title: 'PALM HEIST', tagline: 'Steal the sunset',
      pill: 'LEONIDA',
      slots: ['hero-car', 'oceandrive', 'woman-turquoise', 'man-beard', 'beach-sunset'],
    },
    4: {
      bare: true, size: 'wide', layout: 'diagonal', grade: 'midnight',
      finish: 'none', title: 'NEON TIDE', tagline: 'The city never sleeps',
      pill: 'LEONIDA',
      slots: ['street-night', 'neon-hotel', 'woman-red'],
    },
  };
  var preset = SHOTS[shot];
  if (!preset) return;
  window.__shotPreset = preset;
  if (preset.bare) document.documentElement.classList.add('bare');
})();
