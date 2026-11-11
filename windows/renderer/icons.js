'use strict';
// Line icons in the Stalow design (same shapes as the design canvas), drawn as SVG.
const ICON_PATHS = {
  home: ['M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z'],
  search: ['circle:11,11,7', 'm20 20-3.5-3.5'],
  artist: ['circle:12,8,4', 'M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6'],
  queue: ['M4 6h16M4 12h16M4 18h10'],
  settings: ['circle:12,12,3', 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'],
  play: ['fill:M7 4v16l13-8z'],
  pause: ['fill:M6 5h4v14H6zM14 5h4v14h-4z'],
  prev: ['fill:M6 5h2v14H6zM20 5v14L9 12z'],
  next: ['fill:M16 5h2v14h-2zM4 5v14l11-7z'],
  shuffle: ['M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5'],
  repeat: ['M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3'],
  radio: ['circle:12,12,2', 'M16.2 7.8a6 6 0 0 1 0 8.4M7.8 16.2a6 6 0 0 1 0-8.4M19 5a10 10 0 0 1 0 14M5 19A10 10 0 0 1 5 5'],
  volume: ['M11 5 6 9H3v6h3l5 4z', 'M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13'],
  shield: ['M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6z', 'm9 12 2 2 4-4'],
  palette: ['M12 3a9 9 0 1 0 0 18c1.2 0 2-.8 2-2 0-.6-.2-1-.5-1.4-.3-.4-.5-.8-.5-1.3 0-1.1.9-1.9 2-1.9H17a4 4 0 0 0 4-4c0-4.2-4-7.4-9-7.4z', 'circle:7.5,11.5,1', 'circle:10.5,7.5,1', 'circle:15,8.5,1'],
  audio: ['M9 18V5l12-2v13', 'circle:6,18,3', 'circle:18,16,3'],
  lyrics: ['M4 6h16M4 10h12M4 14h16M4 18h9'],
  content: ['M4 4h16v16H4z', 'M9 4v16M4 9h5M4 15h5'],
  privacy: ['M5 11h14v10H5z', 'M8 11V7a4 4 0 0 1 8 0v4'],
  storage: ['M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z', 'M4 7v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7', 'M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3'],
  backup: ['M12 3v12', 'm7 10 5 5 5-5', 'M5 21h14'],
  account: ['circle:12,8,4', 'M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6'],
  about: ['circle:12,12,9', 'M12 11v6', 'M12 7.5v.5'],
  up: ['m6 15 6-6 6 6'],
  down: ['m6 9 6 6 6-6'],
  back: ['M15 5 8 12l7 7'],
  chevron: ['m9 6 6 6-6 6'],
  close: ['M6 6l12 12M18 6 6 18'],
};

/** An SVG icon element (stroke icons; "fill:" paths are filled, "circle:cx,cy,r" draws a circle). */
function icon(name) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  for (const p of ICON_PATHS[name] || []) {
    let node;
    if (p.startsWith('circle:')) {
      const [cx, cy, r] = p.slice(7).split(',');
      node = document.createElementNS(NS, 'circle');
      node.setAttribute('cx', cx); node.setAttribute('cy', cy); node.setAttribute('r', r);
    } else {
      node = document.createElementNS(NS, 'path');
      const filled = p.startsWith('fill:');
      node.setAttribute('d', filled ? p.slice(5) : p);
      if (filled) { node.setAttribute('fill', 'currentColor'); node.setAttribute('stroke', 'none'); }
    }
    svg.append(node);
  }
  return svg;
}
