/* Contador de grãos — gêmeo digital da placa.
   Recebe uma foto (RGBA), acha os ArUco, encaixa a geometria da placa (mm -> pixel), olha cada furo
   (ocupado / vazio / duvidoso) e confere o "negativo": fora dos furos tudo tem que ser preto, ou branco
   onde o desenho dos marcadores manda. O que foge disso vira alerta de grão extra.
   Roda no navegador (window.Placa) e no Node (module.exports), pra testar com as fotos no PC.
   Mesma lógica do protótipo em Python (prototipo/classifica.py). */
(function (root) {
  'use strict';
  const AR = root.AR || require('./vendor/js-aruco2/aruco').AR;
  if (!AR.DICTIONARIES.ARUCO_4X4_1000) require('./vendor/js-aruco2/aruco_4x4_1000');

  const CFG = {
    S: 8,                    // px por mm na vista de cima (gêmeo digital)
    RAIO_ANALISE: 0.8,       // fração do raio do furo analisada (evita a parede)
    CLARO: 0.6,              // pixel "claro" acima de 60% do caminho preto -> branco
    OCUPADO: 0.20,           // nota >= isso: ocupado
    VAZIO: 0.12,             // nota <= isso: vazio; entre os dois: duvidoso
    FOLGA_FURO: 0.4,         // mm em volta do furo que o negativo não avalia (erro de encaixe)
    FOLGA_DIVISA: 0.6,       // mm de cada lado da divisa preto/branco dos marcadores
    BORDA_PLACA: 0.8,        // mm da borda externa ignorados
    AREA_ANOMALIA: 8,        // mm²: mancha menor que isso é brilho/sujeira
    ESPESSURA_MIN: 0.5,      // mm: mancha mais fina que isso (linha de desalinhamento) não é grão
    CREME: 10,               // quanto o b* pode passar do branco das molduras antes de virar "creme"
    ESCURO_NO_BRANCO: 0.45,  // no branco esperado, abaixo disso = algo por cima
  };

  // ---------------- marcadores ----------------
  const detector = new AR.Detector({ dictionaryName: 'ARUCO_4X4_1000' });

  // reduz RGBA pela média de blocos (rápido e sem serrilhado)
  function reduzir(rgba, w, h, larg) {
    if (larg >= w) return { data: rgba, width: w, height: h, k: 1 };
    const k = w / larg, W = larg, H = Math.round(h / k), out = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      const y0 = Math.floor(y * k), y1 = Math.max(y0 + 1, Math.floor((y + 1) * k));
      for (let x = 0; x < W; x++) {
        const x0 = Math.floor(x * k), x1 = Math.max(x0 + 1, Math.floor((x + 1) * k));
        let r = 0, g = 0, b = 0, n = 0;
        for (let yy = y0; yy < y1; yy++) for (let xx = x0, p = (yy * w + x0) * 4; xx < x1; xx++, p += 4) { r += rgba[p]; g += rgba[p + 1]; b += rgba[p + 2]; n++; }
        const q = (y * W + x) * 4; out[q] = r / n; out[q + 1] = g / n; out[q + 2] = b / n; out[q + 3] = 255;
      }
    }
    return { data: out, width: W, height: H, k };
  }

  function cinza(rgba, w, h) {
    const g = new Float32Array(w * h);
    for (let i = 0, p = 0; i < g.length; i++, p += 4) g[i] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
    return g;
  }

  // refino subpixel do canto (mesma ideia do cornerSubPix do OpenCV): o canto é o ponto onde
  // os gradientes da vizinhança são perpendiculares ao vetor até ele
  function refinarCanto(g, w, h, cx, cy, raio) {
    let x = cx, y = cy;
    for (let it = 0; it < 12; it++) {
      let a = 0, b = 0, c = 0, bx = 0, by = 0;
      const xi = Math.round(x), yi = Math.round(y);
      for (let dy = -raio; dy <= raio; dy++) for (let dx = -raio; dx <= raio; dx++) {
        const px = xi + dx, py = yi + dy;
        if (px < 1 || py < 1 || px >= w - 1 || py >= h - 1) continue;
        const i = py * w + px, gx = (g[i + 1] - g[i - 1]) / 2, gy = (g[i + w] - g[i - w]) / 2;
        const wgt = Math.exp(-(dx * dx + dy * dy) / (raio * raio));
        const gxx = gx * gx * wgt, gxy = gx * gy * wgt, gyy = gy * gy * wgt;
        a += gxx; b += gxy; c += gyy; bx += gxx * px + gxy * py; by += gxy * px + gyy * py;
      }
      const det = a * c - b * b;
      if (Math.abs(det) < 1e-6) break;
      const nx = (c * bx - b * by) / det, ny = (a * by - b * bx) / det;
      if (Math.hypot(nx - cx, ny - cy) > raio) break;     // fugiu demais: mantém o anterior
      const mv = Math.hypot(nx - x, ny - y); x = nx; y = ny;
      if (mv < 0.02) break;
    }
    return { x, y };
  }

  /* Acha os marcadores da placa. Roda em várias escalas (o detector JS é sensível ao tamanho) e
     fica, pra cada ID, com a escala mais fina. idsValidos: só aceita esses IDs (evita ID fantasma). */
  function detectarMarcadores(rgba, w, h, idsValidos, opc) {
    opc = opc || {};
    const escalas = opc.escalas || [320, 400, 480, 560, 640, 800];
    const achados = {};
    for (const larg of escalas) {
      const r = reduzir(rgba, w, h, Math.min(larg, w));
      let ms; try { ms = detector.detect(r); } catch (e) { ms = []; }
      for (const m of ms) {
        if (!idsValidos.has(m.id)) continue;
        const cantos = m.corners.map(c => ({ x: (c.x + 0.5) * r.k - 0.5, y: (c.y + 0.5) * r.k - 0.5 }));
        if (!achados[m.id] || r.k <= achados[m.id].k) achados[m.id] = { id: m.id, cantos, k: r.k };
      }
    }
    const lista = Object.values(achados);
    if (opc.refinar !== false && lista.length) {
      const g = cinza(rgba, w, h);
      for (const m of lista) {
        const lado = Math.hypot(m.cantos[1].x - m.cantos[0].x, m.cantos[1].y - m.cantos[0].y);
        const raio = Math.max(3, Math.min(8, Math.round(lado / 25)));
        m.cantos = m.cantos.map(c => refinarCanto(g, w, h, c.x, c.y, raio));
      }
    }
    return lista;
  }

  // ---------------- homografia (mm -> px) ----------------
  function normalizar(pts) {
    let mx = 0, my = 0; for (const p of pts) { mx += p[0]; my += p[1]; } mx /= pts.length; my /= pts.length;
    let d = 0; for (const p of pts) d += Math.hypot(p[0] - mx, p[1] - my); d /= pts.length;
    const s = Math.SQRT2 / (d || 1);
    return { T: [s, 0, -s * mx, 0, s, -s * my, 0, 0, 1], pts: pts.map(p => [s * (p[0] - mx), s * (p[1] - my)]) };
  }
  function mul3(A, B) {
    const C = new Array(9).fill(0);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) C[i * 3 + j] += A[i * 3 + k] * B[k * 3 + j];
    return C;
  }
  function inv3(m) {
    const [a, b, c, d, e, f, g, h, i] = m, A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
    const det = a * A + b * B + c * C;
    return [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map(v => v / det);
  }
  function resolver(M, v) {          // eliminação de Gauss com pivô
    const n = v.length, A = M.map((r, i) => r.concat([v[i]]));
    for (let c = 0; c < n; c++) {
      let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      [A[c], A[p]] = [A[p], A[c]];
      for (let r = c + 1; r < n; r++) { const f = A[r][c] / A[c][c]; for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k]; }
    }
    const x = new Array(n);
    for (let r = n - 1; r >= 0; r--) { let s = A[r][n]; for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k]; x[r] = s / A[r][r]; }
    return x;
  }
  function homografia(src, dst) {    // mínimos quadrados com h33 = 1, pontos normalizados
    const ns = normalizar(src), nd = normalizar(dst);
    const AtA = Array.from({ length: 8 }, () => new Array(8).fill(0)), Atb = new Array(8).fill(0);
    for (let i = 0; i < src.length; i++) {
      const [x, y] = ns.pts[i], [u, v] = nd.pts[i];
      for (const [row, b] of [[[x, y, 1, 0, 0, 0, -u * x, -u * y], u], [[0, 0, 0, x, y, 1, -v * x, -v * y], v]]) {
        for (let r = 0; r < 8; r++) { Atb[r] += row[r] * b; for (let c = 0; c < 8; c++) AtA[r][c] += row[r] * row[c]; }
      }
    }
    const h = resolver(AtA, Atb).concat([1]);
    const H = mul3(inv3(nd.T), mul3(h, ns.T));
    return H.map(v => v / H[8]);
  }
  function aplicar(H, x, y) {
    const w = H[6] * x + H[7] * y + H[8];
    return { x: (H[0] * x + H[1] * y + H[2]) / w, y: (H[3] * x + H[4] * y + H[5]) / w };
  }
  function cantosMm(m) {
    const [cx, cy] = m.centro, h = m.lado / 2;
    return [[cx - h, cy - h], [cx + h, cy - h], [cx + h, cy + h], [cx - h, cy + h]];
  }

  /* Encaixa a placa: homografia com todos os cantos; se algum canto destoa (canto lascado na
     impressão, tinta borrada), tira ele e refaz — enquanto sobrarem pelo menos 8 cantos. */
  function encaixar(geo, marcadores) {
    const porId = new Map(geo.marcadores.map(m => [m.id, m]));
    const usados = marcadores.filter(m => porId.has(m.id));
    if (usados.length < 2) return null;
    let pts = [];
    for (const m of usados) cantosMm(porId.get(m.id)).forEach((p, i) => pts.push({ id: m.id, mm: p, px: [m.cantos[i].x, m.cantos[i].y] }));
    const lado = usados.reduce((s, m) => s + Math.hypot(m.cantos[1].x - m.cantos[0].x, m.cantos[1].y - m.cantos[0].y), 0) / usados.length;
    const limite = Math.max(1.5, lado * 0.012);
    let H, erros;
    for (;;) {
      H = homografia(pts.map(p => p.mm), pts.map(p => p.px));
      erros = pts.map(p => { const q = aplicar(H, p.mm[0], p.mm[1]); return Math.hypot(q.x - p.px[0], q.y - p.px[1]); });
      const pior = erros.indexOf(Math.max(...erros));
      if (pts.length > 8 && erros[pior] > limite) { pts = pts.filter((_, i) => i !== pior); continue; }
      break;
    }
    const a = aplicar(H, 0, 0), b = aplicar(H, 10, 0);
    return {
      H, ids: [...new Set(usados.map(m => m.id))].sort(), cantosUsados: pts.length, cantosDescartados: usados.length * 4 - pts.length,
      erroMedio: erros.reduce((s, e) => s + e, 0) / erros.length, erroMax: Math.max(...erros),
      pxPorMm: Math.hypot(b.x - a.x, b.y - a.y) / 10,
    };
  }

  // ---------------- gêmeo digital (máscaras fixas, em mm * S) ----------------
  function bitsDoMarcador(id) {
    const [b1, b2] = AR.DICTIONARIES.ARUCO_4X4_1000.codeList[id], v = (b1 << 8) | b2, bits = [];
    for (let r = 0; r < 4; r++) { bits.push([]); for (let c = 0; c < 4; c++) bits[r].push((v >> (15 - (r * 4 + c))) & 1); }
    return bits;
  }

  // integral pra saber, num quadrado k×k, quantos pixels estão ligados
  function integral(mask, W, A) {
    const I = new Int32Array((W + 1) * (A + 1));
    for (let y = 0; y < A; y++) { let s = 0; for (let x = 0; x < W; x++) { s += mask[y * W + x]; I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + s; } }
    return I;
  }
  function somaJanela(I, W, A, x, y, r) {
    const x0 = Math.max(0, x - r), y0 = Math.max(0, y - r), x1 = Math.min(W, x + r + 1), y1 = Math.min(A, y + r + 1);
    return { s: I[y1 * (W + 1) + x1] - I[y0 * (W + 1) + x1] - I[y1 * (W + 1) + x0] + I[y0 * (W + 1) + x0], n: (x1 - x0) * (y1 - y0) };
  }

  function criarModelo(geo, cfg) {
    cfg = Object.assign({}, CFG, cfg || {});
    const S = cfg.S, W = Math.round(geo.largura * S), A = Math.round(geo.altura * S), N = W * A;
    const esp = new Int8Array(N);                     // 0 preto esperado, 1 branco esperado, -1 furo
    for (const m of geo.marcadores) {
      const [cx, cy] = m.centro, h = m.lado / 2, cel = m.lado / 6, bits = bitsDoMarcador(m.id);
      const mold = m.moldura != null ? m.moldura : 3;
      for (let y = Math.floor((cy - h - mold) * S); y < Math.ceil((cy + h + mold) * S); y++) {
        for (let x = Math.floor((cx - h - mold) * S); x < Math.ceil((cx + h + mold) * S); x++) {
          if (x < 0 || y < 0 || x >= W || y >= A) continue;
          const u = (x + 0.5) / S - (cx - h), v = (y + 0.5) / S - (cy - h);
          if (u < 0 || v < 0 || u >= m.lado || v >= m.lado) { esp[y * W + x] = 1; continue; }
          const c = Math.floor(u / cel), r = Math.floor(v / cel);
          esp[y * W + x] = (c >= 1 && c <= 4 && r >= 1 && r <= 4 && bits[r - 1][c - 1]) ? 1 : 0;
        }
      }
    }
    const furoDe = new Int16Array(N).fill(-1);          // índice do furo que cobre o pixel (análise)
    const furos = geo.furos.map((f, i) => {
      const rA = cfg.RAIO_ANALISE * f.d / 2, rF = f.d / 2 + cfg.FOLGA_FURO, idx = [];
      for (let y = Math.floor((f.y - rF) * S); y <= Math.ceil((f.y + rF) * S); y++) for (let x = Math.floor((f.x - rF) * S); x <= Math.ceil((f.x + rF) * S); x++) {
        if (x < 0 || y < 0 || x >= W || y >= A) continue;
        const d = Math.hypot((x + 0.5) / S - f.x, (y + 0.5) / S - f.y);
        if (d <= rF) esp[y * W + x] = -1;
        if (d <= rA) idx.push(y * W + x);
      }
      return { n: f.n, x: f.x, y: f.y, d: f.d, idx: Int32Array.from(idx) };
    });
    // divisa preto/branco: não avalia (o encaixe tem ~1 px de erro e a tinta borra)
    const branco = new Uint8Array(N); for (let i = 0; i < N; i++) branco[i] = esp[i] === 1 ? 1 : 0;
    const I = integral(branco, W, A), r = Math.round(cfg.FOLGA_DIVISA * S), borda = cfg.BORDA_PLACA * S;
    const tipo = new Uint8Array(N);                     // 0 ignora, 1 preto esperado, 2 branco esperado
    for (let y = 0; y < A; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (esp[i] < 0 || x < borda || y < borda || x >= W - borda || y >= A - borda) continue;
      const j = somaJanela(I, W, A, x, y, r);
      if (j.s === 0) tipo[i] = 1; else if (j.s === j.n) tipo[i] = 2;
    }
    return { geo, cfg, S, W, A, furos, tipo, ids: new Set(geo.marcadores.map(m => m.id)) };
  }

  // ---------------- análise da foto ----------------
  const LIN = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const c = i / 255; LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  const fLab = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;

  function mediana(arr) { const a = Float32Array.from(arr).sort(); return a.length ? a[a.length >> 1] : 0; }

  /* Monta a vista de cima e analisa. Devolve furos (nota/estado), anomalias (grão extra por cima)
     e a vista de cima (RGBA) pra mostrar na tela. */
  function analisar(rgba, w, h, modelo, enc) {
    const { S, W, A, cfg, tipo } = modelo, N = W * A;
    const L = new Float32Array(N), B = new Float32Array(N), vista = new Uint8ClampedArray(N * 4);
    const H = enc.H;
    for (let y = 0; y < A; y++) for (let x = 0; x < W; x++) {
      const p = aplicar(H, (x + 0.5) / S, (y + 0.5) / S), px = Math.round(p.x), py = Math.round(p.y), i = y * W + x;
      if (px < 0 || py < 0 || px >= w || py >= h) continue;
      const q = (py * w + px) * 4, r = LIN[rgba[q]], g = LIN[rgba[q + 1]], b = LIN[rgba[q + 2]];
      const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b, Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.089;
      const fy = fLab(Y);
      L[i] = 116 * fy - 16; B[i] = 200 * (fy - fLab(Z));
      vista[i * 4] = rgba[q]; vista[i * 4 + 1] = rgba[q + 1]; vista[i * 4 + 2] = rgba[q + 2]; vista[i * 4 + 3] = 255;
    }
    const lp = [], lb = [], bb = [];
    for (let i = 0; i < N; i += 3) { if (tipo[i] === 1) lp.push(L[i]); else if (tipo[i] === 2) { lb.push(L[i]); bb.push(B[i]); } }
    const preto = mediana(lp), branco = mediana(lb), bBranco = mediana(bb), faixa = Math.max(branco - preto, 1);
    const n = i => (L[i] - preto) / faixa;

    const furos = modelo.furos.map(f => {
      let c = 0; for (const i of f.idx) if (n(i) > cfg.CLARO) c++;
      const nota = c / f.idx.length;
      return { n: f.n, nota, estado: nota >= cfg.OCUPADO ? 'ocupado' : nota <= cfg.VAZIO ? 'vazio' : 'duvidoso' };
    });

    // negativo: o que não está da cor que o gêmeo digital manda
    let an = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      if (tipo[i] === 1) an[i] = n(i) > cfg.CLARO ? 1 : 0;
      else if (tipo[i] === 2) an[i] = (B[i] - bBranco > cfg.CREME || n(i) < cfg.ESCURO_NO_BRANCO) ? 1 : 0;
    }
    an = abrir(an, W, A);
    const dist = distancia(an, W, A), anomalias = [];
    for (const c of componentes(an, W, A, dist)) {
      const area = c.n / (S * S);
      if (area < cfg.AREA_ANOMALIA || c.dmax / S < cfg.ESPESSURA_MIN) continue;
      const cx = c.sx / c.n / S, cy = c.sy / c.n / S;
      let perto = null, dmin = Infinity;
      for (const f of modelo.furos) { const d = Math.hypot(f.x - cx, f.y - cy); if (d < dmin) { dmin = d; perto = f.n; } }
      anomalias.push({ x: cx, y: cy, area, pertoDoFuro: perto });
    }
    for (let i = 0; i < N; i++) if (an[i]) { vista[i * 4] = 255; vista[i * 4 + 1] = 0; vista[i * 4 + 2] = 0; }
    return { furos, anomalias, vista, W, A, preto, branco };
  }

  function abrir(m, W, A) {        // erosão 3x3 seguida de dilatação 3x3 (tira pontinhos)
    const e = new Uint8Array(m.length), d = new Uint8Array(m.length);
    for (let y = 1; y < A - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      e[i] = m[i] & m[i - 1] & m[i + 1] & m[i - W] & m[i + W] & m[i - W - 1] & m[i - W + 1] & m[i + W - 1] & m[i + W + 1];
    }
    for (let y = 1; y < A - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      d[i] = e[i] | e[i - 1] | e[i + 1] | e[i - W] | e[i + W] | e[i - W - 1] | e[i - W + 1] | e[i + W - 1] | e[i + W + 1];
    }
    return d;
  }

  // distância (aprox., em px) de cada pixel ligado até o pixel desligado mais perto (chanfro 3-4)
  function distancia(m, W, A) {
    const d = new Float32Array(m.length);
    for (let i = 0; i < m.length; i++) d[i] = m[i] ? 1e9 : 0;
    const v = (x, y) => (x < 0 || y < 0 || x >= W || y >= A) ? 0 : d[y * W + x];
    for (let y = 0; y < A; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (d[i]) d[i] = Math.min(d[i], v(x - 1, y) + 3, v(x, y - 1) + 3, v(x - 1, y - 1) + 4, v(x + 1, y - 1) + 4); }
    for (let y = A - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) { const i = y * W + x; if (d[i]) d[i] = Math.min(d[i], v(x + 1, y) + 3, v(x, y + 1) + 3, v(x + 1, y + 1) + 4, v(x - 1, y + 1) + 4); }
    for (let i = 0; i < d.length; i++) d[i] /= 3;
    return d;
  }

  function componentes(m, W, A, dist) {
    const vis = new Uint8Array(m.length), out = [], pilha = [];
    for (let s = 0; s < m.length; s++) {
      if (!m[s] || vis[s]) continue;
      let n = 0, sx = 0, sy = 0, dmax = 0; vis[s] = 1; pilha.push(s);
      while (pilha.length) {
        const i = pilha.pop(), x = i % W, y = (i / W) | 0; n++; sx += x + 0.5; sy += y + 0.5;
        if (dist && dist[i] > dmax) dmax = dist[i];
        if (x > 0 && m[i - 1] && !vis[i - 1]) { vis[i - 1] = 1; pilha.push(i - 1); }
        if (x < W - 1 && m[i + 1] && !vis[i + 1]) { vis[i + 1] = 1; pilha.push(i + 1); }
        if (y > 0 && m[i - W] && !vis[i - W]) { vis[i - W] = 1; pilha.push(i - W); }
        if (y < A - 1 && m[i + W] && !vis[i + W]) { vis[i + W] = 1; pilha.push(i + W); }
      }
      out.push({ n, sx, sy, dmax });
    }
    return out;
  }

  // nitidez: média do |laplaciano| (pra comparar quadros da mesma cena)
  function nitidez(rgba, w, h) {
    const g = cinza(rgba, w, h); let s = 0, n = 0;
    for (let y = 1; y < h - 1; y += 2) for (let x = 1; x < w - 1; x += 2) {
      const i = y * w + x; s += Math.abs(4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w]); n++;
    }
    return s / n;
  }

  /* Tudo de uma vez: foto -> resultado. */
  function contar(rgba, w, h, modelo, opc) {
    const t0 = Date.now();
    const marcadores = detectarMarcadores(rgba, w, h, modelo.ids, opc);
    const enc = encaixar(modelo.geo, marcadores);
    if (!enc || enc.ids.length < 3) return { ok: false, marcadores, motivo: 'Não achei pelo menos 3 marcadores da placa.' };
    const r = analisar(rgba, w, h, modelo, enc);
    return Object.assign({ ok: true, marcadores, enc, ms: Date.now() - t0 }, r);
  }

  const api = { CFG, reduzir, detectarMarcadores, encaixar, criarModelo, analisar, contar, aplicar, nitidez, inv3, bitsDoMarcador };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Placa = api;
})(typeof self !== 'undefined' ? self : this);
