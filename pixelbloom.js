/* Pixel Bloom : une fleur passée sous un flou très fort, puis découpée par des blocs alignés sur une grille
   où l'image redevient presque nette, se décale d'une ligne ou s'étire vers le bas. Un grain fin unifie le tout.

   Chaque <canvas data-bloom> est dessiné à sa taille réelle. Attributs :
     data-palette   lavande | rose | bleu
     data-graine    entier : change la fleur et la disposition des blocs
     data-zoom      largeur de la fleur rapportée à celle du canevas (défaut 1.15)
     data-remonte   part de la hauteur de la fleur décalée vers le haut (défaut 0)
     data-grille    hauteur (0–1) où commencent les blocs (défaut 0.3)
     data-colonnes  nombre de colonnes de la grille (défaut 48)
     data-anime     les blocs se rebattent lentement tant que le canevas est visible
   Les calques flous sont calculés une fois ; seuls les blocs et le grain sont redessinés. */
(function pixelBloom() {
  const SW = 900, SH = 1100; /* taille de la fleur source */
  const S = 0.5;             /* échelle de travail des calques flous */

  /* Pétales dans la palette du site ; tiges et feuilles en gris bleuté pour ne pas introduire de vert. */
  const PALETTES = {
    lavande: { petal: '#B29AF0', light: '#ECE4FE', core: '#6A48D8', bud: '#9C86EC', stem: '#8F92C8', leaf: '#A7AADA', leafDark: '#5D619E', fond: ['#F1ECFD', '#FBE9F2'] },
    rose:    { petal: '#EE9DBF', light: '#FCE3EE', core: '#C9507F', bud: '#E37FA9', stem: '#9C93C9', leaf: '#B6ACDE', leafDark: '#6F67A6', fond: ['#FDEFF5', '#EEE8FC'] },
    bleu:    { petal: '#5A3BFF', light: '#B0A2FF', core: '#2A00A8', bud: '#E7A3C0', stem: '#7C80C2', leaf: '#9599D6', leafDark: '#474C94', fond: ['#EAE6FD', '#F9E4EE'] },
  };

  /* ---------- outils */
  function mulberry(a) {
    return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  const toile = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
  const lisse = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  const FILTRE_OK = (() => { const x = toile(2, 2).getContext('2d'); if (!('filter' in x)) return false;
    x.filter = 'blur(2px)'; return x.filter === 'blur(2px)'; })();

  /* Flou gaussien via ctx.filter ; repli (Safari ancien) : sous-échantillonnage puis agrandissement lissé. */
  function flouter(src, r) {
    const out = toile(src.width, src.height), x = out.getContext('2d');
    if (r <= 0) { x.drawImage(src, 0, 0); return out; }
    if (FILTRE_OK) { x.filter = `blur(${r}px)`; x.drawImage(src, 0, 0); return out; }
    const f = Math.max(1, r / 2.5);
    const pt = toile(src.width / f, src.height / f), px = pt.getContext('2d');
    px.imageSmoothingQuality = 'high'; px.drawImage(src, 0, 0, pt.width, pt.height);
    x.imageSmoothingQuality = 'high'; x.drawImage(pt, 0, 0, out.width, out.height);
    return out;
  }

  /* ---------- fleur procédurale (vue de profil : une corolle ouverte et quelques boutons) */
  function petale(x, len, wid, tip = 1.05) {
    x.beginPath(); x.moveTo(0, 0);
    x.bezierCurveTo(len * .2, -wid * .9, len * tip, -wid * .9, len, 0);
    x.bezierCurveTo(len * tip, wid * .9, len * .2, wid * .9, 0, 0); x.closePath();
  }
  function feuille(x, px, py, a, len, wid, pal) {
    x.save(); x.translate(px, py); x.rotate(a);
    const g = x.createLinearGradient(0, 0, len, 0); g.addColorStop(0, pal.leafDark); g.addColorStop(1, pal.leaf);
    x.fillStyle = g; x.beginPath(); x.moveTo(0, 0);
    x.bezierCurveTo(len * .3, -wid, len * .7, -wid * .7, len, 0);
    x.bezierCurveTo(len * .7, wid * .7, len * .3, wid, 0, 0); x.fill(); x.restore();
  }
  function corolle(x, h, pal, rng) {
    x.save(); x.translate(h.x, h.y); x.rotate((rng() - .5) * .4);
    const n = 5 + Math.floor(rng() * 3), ouverture = Math.PI * (.85 + rng() * .15);
    const ordre = [...Array(n).keys()].sort(() => rng() - .5);
    for (const i of ordre) {
      const a = -Math.PI / 2 - ouverture / 2 + ouverture * (i + .5) / n + (rng() - .5) * .25;
      const len = h.r * (.85 + rng() * .4) * (1 - Math.abs(Math.cos(a)) * .15), wid = len * (.38 + rng() * .14);
      x.save(); x.rotate(a);
      const g = x.createLinearGradient(0, 0, len, 0);
      g.addColorStop(0, pal.core); g.addColorStop(.35, pal.petal); g.addColorStop(.85, pal.light); g.addColorStop(1, pal.petal);
      x.fillStyle = g; petale(x, len, wid, 1.15); x.fill(); x.restore();
    }
    for (let i = 0; i < 3; i++) feuille(x, 0, h.r * .1, Math.PI / 2 + (i - 1) * .7, h.r * .45, h.r * .15, pal);
    x.restore();
  }
  function bouton(x, h, pal, rng) {
    x.save(); x.translate(h.x, h.y); x.rotate((rng() - .5) * .6);
    for (let i = 0; i < 3; i++) {
      x.save(); x.rotate(-Math.PI / 2 + (i - 1) * .32);
      const g = x.createLinearGradient(0, 0, h.r * 1.5, 0); g.addColorStop(0, pal.core); g.addColorStop(1, i === 1 ? pal.light : pal.bud);
      x.fillStyle = g; petale(x, h.r * (1.3 + rng() * .3), h.r * .45, .9); x.fill(); x.restore();
    }
    for (let i = 0; i < 3; i++) feuille(x, 0, h.r * .35, -Math.PI / 2 + (i - 1) * .55, h.r * 1.05, h.r * .28, pal);
    x.restore();
  }
  function plante(pal, graine) {
    const c = toile(SW, SH), x = c.getContext('2d'), rng = mulberry(graine);
    const pied = { x: SW * (.44 + rng() * .1), y: SH * 1.04 };
    const tetes = [
      { x: SW * (.6 + (rng() - .5) * .12), y: SH * (.33 + (rng() - .5) * .06), r: SW * .26, ouverte: true },
      { x: SW * (.24 + (rng() - .5) * .08), y: SH * (.57 + (rng() - .5) * .06), r: SW * .15 },
      { x: SW * (.3 + (rng() - .5) * .08), y: SH * (.25 + (rng() - .5) * .05), r: SW * .085 },
    ];
    if (rng() < .65) tetes.push({ x: SW * (.8 + (rng() - .5) * .08), y: SH * (.52 + (rng() - .5) * .08), r: SW * .1 });
    x.lineCap = 'round';
    tetes.forEach((h, i) => {
      const cp = { x: (pied.x + h.x) / 2 + (rng() - .5) * SW * .25, y: (pied.y + h.y) / 2 + SH * .05 };
      const fin = { x: h.x, y: h.y + h.r * .4 };
      x.strokeStyle = pal.stem; x.lineWidth = SW * .008 + h.r * .05;
      x.beginPath(); x.moveTo(pied.x, pied.y); x.quadraticCurveTo(cp.x, cp.y, fin.x, fin.y); x.stroke();
      const n = 1 + Math.floor(rng() * 2);
      for (let k = 0; k < n; k++) {
        const t = .3 + rng() * .4, u = 1 - t;
        const px = u * u * pied.x + 2 * u * t * cp.x + t * t * fin.x, py = u * u * pied.y + 2 * u * t * cp.y + t * t * fin.y;
        const tx = 2 * u * (cp.x - pied.x) + 2 * t * (fin.x - cp.x), ty = 2 * u * (cp.y - pied.y) + 2 * t * (fin.y - cp.y);
        const cote = (k + i) % 2 ? 1 : -1, len = SW * (.12 + rng() * .1);
        feuille(x, px, py, Math.atan2(ty, tx) + cote * (.55 + rng() * .5), len, len * .27, pal);
      }
    });
    tetes.forEach(h => h.ouverte ? corolle(x, h, pal, rng) : bouton(x, h, pal, rng));
    return c;
  }

  /* ---------- carte d'encre : où l'image floue a de la couleur (les blocs n'apparaissent que là) */
  function carteEncre(c) {
    return { w: c.width, h: c.height, d: c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data };
  }
  function encre(m, x, y) {
    const ix = Math.min(m.w - 1, Math.max(0, Math.round(x * S))), iy = Math.min(m.h - 1, Math.max(0, Math.round(y * S)));
    const i = (iy * m.w + ix) * 4, r = m.d[i], g = m.d[i + 1], b = m.d[i + 2], a = m.d[i + 3] / 255;
    const chroma = (Math.max(r, g, b) - Math.min(r, g, b)) / 255, sombre = 1 - (r * .3 + g * .59 + b * .11) / 255;
    return a * Math.min(1, chroma * 1.5 + sombre * .5);
  }
  /* Champ aléatoire lisse : regroupe les blocs en grappes au lieu de les semer uniformément. */
  function grappes(rng, nx, ny) {
    const g = Array.from({ length: (nx + 1) * (ny + 1) }, () => rng());
    return (u, v) => {
      const x = Math.min(nx - 1e-6, Math.max(0, u * nx)), y = Math.min(ny - 1e-6, Math.max(0, v * ny));
      const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
      const a = g[j * (nx + 1) + i], b = g[j * (nx + 1) + i + 1], c = g[(j + 1) * (nx + 1) + i], d = g[(j + 1) * (nx + 1) + i + 1];
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
    };
  }
  function blocs(x, e, rng) {
    const champ = grappes(rng, 4, 5), reg = { x: 0, y: e.haut, w: e.W, h: e.H - e.haut };
    const cols = Math.ceil(reg.w / e.uw), rows = Math.ceil(reg.h / e.rh);
    for (let r = 0; r < rows; r++) {
      let c = 0;
      while (c < cols) {
        const cx = reg.x + (c + .5) * e.uw, cy = reg.y + (r + .5) * e.rh;
        const p = .7 * lisse(.22, .6, encre(e.encre, cx, cy)) * lisse(.3, .7, champ((cx - reg.x) / reg.w, (cy - reg.y) / reg.h));
        if (rng() < p) {
          const len = Math.min(cols - c, 1 + Math.floor(Math.pow(rng(), 2) * 8));
          const bx = reg.x + c * e.uw, by = reg.y + r * e.rh, bw = len * e.uw, bh = e.rh, m = rng();
          if (m < .25) {        /* une ligne de pixels étirée sur tout le bloc */
            const sy = by + rng() * bh * .6;
            x.drawImage(e.net, bx * S, sy * S, bw * S, 1, bx, by, bw, bh);
          } else if (m < .4) {  /* décalé d'une ligne */
            const dy = (rng() < .5 ? -1 : 1) * bh;
            x.drawImage(e.net, bx * S, (by + dy) * S, bw * S, bh * S, bx, by, bw, bh);
          } else {              /* même endroit, beaucoup moins flou */
            x.drawImage(e.net, bx * S, by * S, bw * S, bh * S, bx, by, bw, bh);
          }
          c += len + (rng() < .45 ? 0 : 1 + Math.floor(rng() * 2));
        } else c++;
      }
    }
  }
  function texGrain(W, H) {
    const c = toile(W, H), x = c.getContext('2d'), d = x.createImageData(c.width, c.height), r = mulberry(99);
    for (let i = 0; i < d.data.length; i += 4) {
      const v = 128 + (r() - .5) * 255 * (r() < .985 ? .55 : 1.4);
      d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255;
    }
    x.putImageData(d, 0, 0); return c;
  }

  /* ---------- préparation (coûteuse, une fois par taille) puis dessin (léger, à chaque rebattage) */
  function preparer(cv) {
    const dpr = Math.min(2, devicePixelRatio || 1);
    const W = Math.round(cv.clientWidth * dpr), H = Math.round(cv.clientHeight * dpr);
    if (!W || !H) return null;
    cv.width = W; cv.height = H;
    const d = cv.dataset, pal = PALETTES[d.palette] || PALETTES.lavande, graine = +d.graine || 1;
    const rng = mulberry(graine * 31 + 5);
    const z = W * (+d.zoom || 1.15) / SW, dw = SW * z, dh = SH * z;
    const ox = (W - dw) / 2 + (rng() - .5) * W * .1, oy = H * .1 - dh * (+d.remonte || 0);
    const brut = toile(W * S, H * S);
    brut.getContext('2d').drawImage(plante(pal, graine), ox * S, oy * S, dw * S, dh * S);
    const flou = W * .024;
    const net = flouter(brut, Math.max(1.5, flou * S * .22));
    return {
      W, H, pal, graine, net,
      flou: flouter(brut, flou * S), encre: carteEncre(net), grain: texGrain(W, H),
      haut: H * (d.grille !== undefined ? +d.grille : .3), uw: W / (+d.colonnes || 48), rh: W * .075,
    };
  }
  function dessiner(cv, e, tirage) {
    const x = cv.getContext('2d');
    const fond = x.createLinearGradient(0, 0, e.W, e.H);
    fond.addColorStop(0, e.pal.fond[0]); fond.addColorStop(1, e.pal.fond[1]);
    x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1;
    x.fillStyle = fond; x.fillRect(0, 0, e.W, e.H);
    x.drawImage(e.flou, 0, 0, e.W, e.H);
    x.fillStyle = 'rgba(252, 250, 255, .12)'; x.fillRect(0, 0, e.W, e.H); /* voile : le flou reste aérien, comme un verre dépoli */
    blocs(x, e, mulberry(e.graine * 7 + tirage));
    x.globalCompositeOperation = 'overlay'; x.globalAlpha = .22; x.drawImage(e.grain, 0, 0);
    x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1;
  }

  /* ---------- branchement */
  const calme = matchMedia('(prefers-reduced-motion: reduce)');
  document.querySelectorAll('canvas[data-bloom]').forEach(cv => {
    let etat = null, tirage = 0, largeur = 0, minuteur = 0, visible = false;
    const maj = () => { etat = preparer(cv); if (etat) dessiner(cv, etat, tirage); };
    const rebattre = () => { if (!etat) return; tirage++; dessiner(cv, etat, tirage); };

    new ResizeObserver(([e]) => {
      const w = Math.round(e.contentRect.width);
      if (w === largeur) return;
      largeur = w; clearTimeout(minuteur); minuteur = setTimeout(maj, etat ? 150 : 0);
    }).observe(cv);

    /* Survol d'une carte : les blocs se rebattent. */
    const carte = cv.closest('[data-bloom-survol]');
    if (carte) carte.addEventListener('pointerenter', rebattre);

    /* Animation lente, seulement quand le canevas est à l'écran. */
    if ('anime' in cv.dataset && !calme.matches) {
      new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(cv);
      setInterval(() => { if (visible && !document.hidden) rebattre(); }, 1600);
    }
  });
})();
