const fs = require('fs');
const p = 'C:/Users/Laptop/Desktop/sih/frontend/src/index.css';
let s = fs.readFileSync(p, 'utf8');
if (s.indexOf('Explicit switch in Settings') >= 0) {
  console.log('has');
  process.exit(0);
}
const old = "@media (prefers-reduced-motion: reduce) {\n  *, *::before, *::after {\n    animation-duration: 0.001ms !important;\n    animation-iteration-count: 1 !important;\n    transition-duration: 0.001ms !important;\n    scroll-behavior: auto !important;\n  }\n  .ambient-orb,\n  .spotlight {\n    display: none;\n  }\n}";
const neu = old + "\n\n/* Explicit switch in Settings → Appearance. Mirrors the system preference. */\n[data-reduced-motion=\"true\"] *,\n[data-reduced-motion=\"true\"] *::before,\n[data-reduced-motion=\"true\"] *::after {\n  animation-duration: 0.001ms !important;\n  animation-iteration-count: 1 !important;\n  transition-duration: 0.001ms !important;\n  scroll-behavior: auto !important;\n}\n[data-reduced-motion=\"true\"] .ambient-orb,\n[data-reduced-motion=\"true\"] .spotlight,\n[data-reduced-motion=\"true\"] .stat-orb::before {\n  display: none;\n}\n[data-reduced-motion=\"true\"] .tilt-card:hover,\n[data-reduced-motion=\"true\"] .icon-tile:hover,\n[data-reduced-motion=\"true\"] .card-interactive:hover {\n  transform: none;\n}\n[data-reduced-motion=\"true\"] .cube3d {\n  animation: none;\n}\n[data-reduced-motion=\"true\"] .dropzone,\n[data-reduced-motion=\"true\"] .dropzone-active {\n  transform: none;\n}\n";
if (s.indexOf(old) >= 0) {
  s = s.split(old).join(neu);
  fs.writeFileSync(p, s);
  console.log('done');
} else {
  console.log('miss');
}
