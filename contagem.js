/* Contagem de grãos de soja — algoritmo puro (sem OpenCV), roda no celular e no Node.
 *
 * Ideia geral:
 *  1. Cada pixel ganha uma "nota de grão":
 *       modo "claro" (grão sobre fundo branco)   -> quanto o pixel é amarelado (b* do Lab)
 *       modo "led"   (painel aceso por baixo)    -> quanto o pixel é escuro (silhueta)
 *  2. Otsu escolhe sozinho o corte grão x fundo; "ajuste" desloca esse corte.
 *  3. Limpa ruído, tapa furos e separa as manchas (componentes conectados).
 *  4. Mede o tamanho de UM grão pelas manchas redondas e isoladas.
 *  5. Cada mancha vale round(área / área de 1 grão) grãos; k-means espalha
 *     os marcadores dentro dela pra cada grão ganhar seu círculo.
 */
(function (root) {
  'use strict';

  // ---------- nota de grão por pixel ----------
  function srgbLin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  const LIN = new Float32Array(256); for (let i = 0; i < 256; i++) LIN[i] = srgbLin(i);
  const fLab = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

  function notaDeGrao(rgba, w, h, modo) {
    const n = w * h, out = new Uint8Array(n);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
      if (modo === 'led') {
        out[i] = 255 - ((r * 77 + g * 150 + b * 29) >> 8);
      } else {
        const R = LIN[r], G = LIN[g], B = LIN[b];
        const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
        const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.089;
        const bStar = 200 * (fLab(Y) - fLab(Z));      // amarelo = positivo
        out[i] = Math.max(0, Math.min(255, Math.round(bStar * 3 + 64)));
      }
    }
    return out;
  }

  function otsu(v) {
    const hist = new Float64Array(256);
    for (let i = 0; i < v.length; i++) hist[v[i]]++;
    let total = v.length, sum = 0;
    for (let t = 0; t < 256; t++) sum += t * hist[t];
    let sumB = 0, wB = 0, best = 0, tBest = 128;
    for (let t = 0; t < 256; t++) {
      wB += hist[t]; if (!wB) continue;
      const wF = total - wB; if (!wF) break;
      sumB += t * hist[t];
      const mB = sumB / wB, mF = (sum - sumB) / wF, s = wB * wF * (mB - mF) * (mB - mF);
      if (s > best) { best = s; tBest = t; }
    }
    return tBest;
  }

  // ---------- morfologia simples (quadrado 3x3) ----------
  function erode(m, w, h) {
    const o = new Uint8Array(m.length);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      o[i] = m[i] & m[i - 1] & m[i + 1] & m[i - w] & m[i + w] & m[i - w - 1] & m[i - w + 1] & m[i + w - 1] & m[i + w + 1];
    }
    return o;
  }
  function dilate(m, w, h) {
    const o = new Uint8Array(m.length);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      o[i] = m[i] | m[i - 1] | m[i + 1] | m[i - w] | m[i + w] | m[i - w - 1] | m[i - w + 1] | m[i + w - 1] | m[i + w + 1];
    }
    return o;
  }

  // tapa furos: tudo que é fundo e NÃO alcança a borda vira grão
  function tapaFuros(m, w, h) {
    const fora = new Uint8Array(m.length), fila = new Int32Array(m.length);
    let a = 0, b = 0;
    const push = i => { if (!m[i] && !fora[i]) { fora[i] = 1; fila[b++] = i; } };
    for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    while (a < b) {
      const i = fila[a++], x = i % w;
      if (x > 0) push(i - 1); if (x < w - 1) push(i + 1);
      if (i >= w) push(i - w); if (i < m.length - w) push(i + w);
    }
    for (let i = 0; i < m.length; i++) if (!fora[i]) m[i] = 1;
    return m;
  }

  // ---------- manchas (componentes conectados, vizinhança 8) ----------
  function manchas(m, w, h) {
    const lab = new Int32Array(m.length), fila = new Int32Array(m.length), lista = [];
    let id = 0;
    for (let s = 0; s < m.length; s++) {
      if (!m[s] || lab[s]) continue;
      id++; let a = 0, b = 0; fila[b++] = s; lab[s] = id;
      let minX = w, maxX = 0, minY = h, maxY = 0, borda = false;
      while (a < b) {
        const i = fila[a++], x = i % w, y = (i / w) | 0;
        if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) borda = true;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (m[j] && !lab[j]) { lab[j] = id; fila[b++] = j; }
        }
      }
      lista.push({ id, px: fila.slice(0, b), area: b, minX, maxX, minY, maxY, borda });
    }
    return lista;
  }

  // ---------- tamanho de 1 grão ----------
  function areaDeUmGrao(lista) {
    const areas = lista.map(c => c.area).filter(a => a >= 30).sort((a, b) => a - b);
    if (!areas.length) return 0;
    const isolados = lista.filter(c => {
      const bw = c.maxX - c.minX + 1, bh = c.maxY - c.minY + 1;
      const asp = Math.max(bw, bh) / Math.min(bw, bh), fill = c.area / (bw * bh);
      return c.area >= 30 && asp < 1.3 && fill > 0.7 && !c.borda;
    }).map(c => c.area).sort((a, b) => a - b);
    const med = a => a[a.length >> 1];
    if (isolados.length >= 5) {
      // corta os extremos (fragmento / dois grãos colados que passaram no filtro)
      const m0 = med(isolados);
      const ok = isolados.filter(a => a > 0.5 * m0 && a < 1.5 * m0);
      return med(ok.length ? ok : isolados);
    }
    return med(areas);
  }

  // ---------- k-means dentro de uma mancha (marca cada grão) ----------
  function rng(seed) { return () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296); }
  function kmeans(px, w, k, rand) {
    const n = px.length, X = new Float32Array(n), Y = new Float32Array(n);
    for (let i = 0; i < n; i++) { X[i] = px[i] % w; Y[i] = (px[i] / w) | 0; }
    const cx = [], cy = [], d2 = new Float64Array(n).fill(Infinity);
    let j = (rand() * n) | 0; cx.push(X[j]); cy.push(Y[j]);
    while (cx.length < k) {   // k-means++: próximo centro longe dos anteriores
      let tot = 0; const c = cx.length - 1;
      for (let i = 0; i < n; i++) {
        const dx = X[i] - cx[c], dy = Y[i] - cy[c], d = dx * dx + dy * dy;
        if (d < d2[i]) d2[i] = d; tot += d2[i];
      }
      let r = rand() * tot; j = 0;
      while (j < n - 1 && (r -= d2[j]) > 0) j++;
      cx.push(X[j]); cy.push(Y[j]);
    }
    const sx = new Float64Array(k), sy = new Float64Array(k), sn = new Int32Array(k);
    for (let it = 0; it < 12; it++) {
      sx.fill(0); sy.fill(0); sn.fill(0);
      for (let i = 0; i < n; i++) {
        let best = 0, bd = Infinity;
        for (let c = 0; c < k; c++) { const dx = X[i] - cx[c], dy = Y[i] - cy[c], d = dx * dx + dy * dy; if (d < bd) { bd = d; best = c; } }
        sx[best] += X[i]; sy[best] += Y[i]; sn[best]++;
      }
      for (let c = 0; c < k; c++) if (sn[c]) { cx[c] = sx[c] / sn[c]; cy[c] = sy[c] / sn[c]; }
    }
    return cx.map((x, c) => ({ x, y: cy[c] }));
  }

  // ---------- nitidez (variância do Laplaciano) ----------
  function nitidez(rgba, w, h) {
    const g = new Float32Array(w * h);
    for (let i = 0, p = 0; i < g.length; i++, p += 4) g[i] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
    let s = 0, s2 = 0, n = 0;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x, L = g[i - 1] + g[i + 1] + g[i - w] + g[i + w] - 4 * g[i];
      s += L; s2 += L * L; n++;
    }
    const m = s / n; return s2 / n - m * m;
  }

  // ---------- função principal ----------
  // rgba: Uint8ClampedArray (w*h*4). opcoes: { modo: 'claro'|'led', ajuste: -40..40 }
  function contarGraos(rgba, w, h, opcoes) {
    const modo = (opcoes && opcoes.modo) || 'claro', ajuste = (opcoes && opcoes.ajuste) || 0;
    const nota = notaDeGrao(rgba, w, h, modo);
    const corte = Math.max(1, Math.min(254, otsu(nota) + ajuste));
    let m = new Uint8Array(w * h);
    for (let i = 0; i < m.length; i++) m[i] = nota[i] > corte ? 1 : 0;
    m = dilate(erode(m, w, h), w, h);          // abertura: tira poeira/ruído fino
    tapaFuros(m, w, h);
    const lista = manchas(m, w, h);
    const A1 = areaDeUmGrao(lista);
    const avisos = [], graos = [];
    if (!A1) return { graos, raio: 0, A1: 0, mascara: m, corte, avisos: ['Nenhum grão encontrado.'] };
    const raio = Math.sqrt(A1 / Math.PI), rand = rng(42);
    let descartadas = 0, aglomerados = 0;
    for (const c of lista) {
      if (c.area < 0.3 * A1) continue;                          // farelo
      // não é grão: mancha grande colada na borda do recorte (borda da bandeja, sombra) ou absurda
      if ((c.borda && c.area > 6 * A1) || c.area > 300 * A1) { descartadas++; continue; }
      const k = Math.max(1, Math.round(c.area / A1));
      if (k === 1) {
        let sx = 0, sy = 0; for (const i of c.px) { sx += i % w; sy += (i / w) | 0; }
        graos.push({ x: sx / c.area, y: sy / c.area });
      } else { aglomerados += k; graos.push(...kmeans(c.px, w, k, rand)); }
    }
    if (raio < 9) avisos.push('Grãos pequenos na foto: aproxime o celular.');
    if (descartadas) avisos.push('Alguma região grande foi ignorada (sombra ou borda?).');
    if (graos.length && aglomerados / graos.length > 0.35) avisos.push('Muitos grãos encostados: espalhe mais pra contagem ficar segura.');
    return { graos, raio, A1, mascara: m, corte, avisos };
  }

  const api = { contarGraos, nitidez };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Contagem = api;
})(this);
