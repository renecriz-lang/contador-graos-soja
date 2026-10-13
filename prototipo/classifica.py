# Prototipo (PC): encaixa a placa, retifica (vista de cima, em mm) e confere a foto contra o gemeo digital.
# 1) Furos: nota = fracao de pixels "claros" dentro do furo, com o claro medido em relacao ao preto da
#    placa e ao branco dos marcadores da PROPRIA foto (aguenta foto clara ou escura).
# 2) Negativo: fora dos furos, cada ponto da placa tem cor esperada (preto, ou branco nas molduras e nos
#    quadradinhos dos ArUco). Mancha que foge do esperado = grao (ou sujeira) em cima da placa.
import os, sys, time, cv2, numpy as np
from grade import G, encaixar, mm_para_px, circulo_px

S = 10                # px por mm na imagem retificada
RAIO_ANALISE = 0.8    # fracao do raio do furo analisada (evita a parede do furo)
CLARO = 0.6           # pixel e "claro" acima de 60% do caminho preto -> branco
OCUPADO, VAZIO = 0.20, 0.12   # nota >= OCUPADO: ocupado; <= VAZIO: vazio; entre: duvidoso
FOLGA_FURO = 0.3      # mm em volta do furo que o negativo ignora (erro de encaixe)
FOLGA_BORDA_BRANCO = 0.6   # mm de cada lado da divisa preto/branco dos marcadores que nao se avalia
BORDA_PLACA = 0.8     # mm da borda externa da placa ignorados
AREA_ANOMALIA = 8.0   # mm2: mancha menor que isso e brilho/sujeira, ignorada (flash gera ate ~6)
CREME = 10            # quanto o b* (amarelado) pode passar do branco das molduras antes de virar "creme"

W, A = int(G["largura"] * S), int(G["altura"] * S)
yy, xx = np.mgrid[:A, :W]

def disco(x, y, r):
    return (xx - x*S)**2 + (yy - y*S)**2 <= (r*S)**2

def quadrado(cx, cy, meio):
    return (abs(xx - cx*S) <= meio*S) & (abs(yy - cy*S) <= meio*S)

def mapa_esperado():
    """1 = branco esperado, 0 = preto esperado, -1 = furo (avaliado a parte)."""
    D = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
    esp = np.zeros(xx.shape, np.int8)
    for m in G["marcadores"]:
        cx, cy = m["centro"]; h = m["lado"] / 2; cel = m["lado"] / 6
        esp[quadrado(cx, cy, h + 3) & ~quadrado(cx, cy, h)] = 1        # moldura branca
        bits = D.getBitsFromByteList(D.bytesList[m["id"]:m["id"] + 1], 4)
        for r in range(4):
            for c in range(4):
                if bits[r, c]:
                    x0, y0 = cx - h + cel * (c + 1), cy - h + cel * (r + 1)
                    esp[(xx >= x0*S) & (xx < (x0 + cel)*S) & (yy >= y0*S) & (yy < (y0 + cel)*S)] = 1
    for f in G["furos"]:
        esp[disco(f["x"], f["y"], f["d"]/2 + FOLGA_FURO)] = -1
    return esp

# mascaras fixas da placa (calculadas uma vez)
ESP = mapa_esperado()
k = int(2 * FOLGA_BORDA_BRANCO * S) | 1
_bw = (ESP == 1).astype(np.uint8)
DIVISA = (cv2.dilate(_bw, np.ones((k, k), np.uint8)) - cv2.erode(_bw, np.ones((k, k), np.uint8))) > 0
DENTRO = (xx > BORDA_PLACA*S) & (xx < W - BORDA_PLACA*S) & (yy > BORDA_PLACA*S) & (yy < A - BORDA_PLACA*S)
PRETO_ESP = (ESP == 0) & ~DIVISA & DENTRO
BRANCO_ESP = (ESP == 1) & ~DIVISA & DENTRO
ANALISE = [disco(f["x"], f["y"], RAIO_ANALISE * f["d"]/2) for f in G["furos"]]
DIST_FURO = np.stack([np.hypot(xx - f["x"]*S, yy - f["y"]*S) for f in G["furos"]])

def classificar(im):
    H, diag = encaixar(im)
    if H is None:
        return None, diag
    R = cv2.warpPerspective(im, np.linalg.inv(H @ np.diag([1/S, 1/S, 1])), (W, A))
    lab = cv2.cvtColor(R, cv2.COLOR_BGR2LAB).astype(np.float32)
    L, B = lab[..., 0], lab[..., 2] - 128
    preto, branco = np.median(L[PRETO_ESP]), np.median(L[BRANCO_ESP])
    n = (L - preto) / max(branco - preto, 1)
    claro = n > CLARO
    furos = []
    for f, m in zip(G["furos"], ANALISE):
        nota = float(claro[m].mean())
        estado = "ocupado" if nota >= OCUPADO else "vazio" if nota <= VAZIO else "duvidoso"
        furos.append({"n": f["n"], "nota": nota, "estado": estado})
    # negativo: o que nao esta da cor que o gemeo digital manda
    b_branco = np.median(B[BRANCO_ESP])
    anom = (PRETO_ESP & claro) | (BRANCO_ESP & ((B - b_branco > CREME) | (n < 0.45)))
    anom = cv2.morphologyEx(anom.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    nb, rot, st, cen = cv2.connectedComponentsWithStats(anom)
    sobre = []
    for i in range(1, nb):
        area = st[i, cv2.CC_STAT_AREA] / S**2
        if area < AREA_ANOMALIA:
            continue
        px = rot == i
        perto = int(np.argmin(DIST_FURO[:, px].mean(axis=1))) + 1
        sobre.append({"x": cen[i][0] / S, "y": cen[i][1] / S, "area": float(area), "perto_do_furo": perto})
    diag.update(preto=float(preto), branco=float(branco), H=H, sobre=sobre, retificada=R, anomalia=anom)
    return furos, diag

COR = {"ocupado": (60, 200, 60), "vazio": (255, 170, 40), "duvidoso": (0, 220, 255)}

if __name__ == "__main__":
    for arq in sys.argv[1:]:
        im = cv2.imread(arq)
        t = time.perf_counter(); furos, d = classificar(im); ms = (time.perf_counter() - t) * 1000
        if furos is None:
            print(f"{arq}: marcadores insuficientes {d['marcadores']}"); continue
        cont = {k: sum(f["estado"] == k for f in furos) for k in COR}
        sobre = ", ".join(f"{s['area']:.0f}mm2 perto do {s['perto_do_furo']}" for s in d["sobre"]) or "nada"
        print(f"{os.path.basename(arq)}: {cont}  em cima da placa: {sobre}  marcadores {d['marcadores']}  {ms:.0f} ms")
        out = im.copy()
        for f, g in zip(furos, G["furos"]):
            pc = circulo_px(d["H"], g["x"], g["y"], g["d"]/2).astype(int)
            cv2.polylines(out, [pc], True, COR[f["estado"]], 4)
            c = mm_para_px(d["H"], [[g["x"], g["y"] - g["d"]/2 - 2]])[0].astype(int)
            cv2.putText(out, str(f["n"]), (c[0] - 12, c[1] + 8), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 0, 255), 2)
        for s in d["sobre"]:
            p = mm_para_px(d["H"], [[s["x"], s["y"]]])[0].astype(int)
            cv2.circle(out, tuple(p), 40, (0, 0, 255), 4)
        txt = f"{cont['ocupado']} ocupados  {cont['vazio']} vazios  {cont['duvidoso']} duvidosos  {len(d['sobre'])} em cima"
        cv2.putText(out, txt, (30, 60), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (255, 255, 255), 3)
        # vista de cima (gemeo digital) com o negativo em vermelho
        R = d["retificada"].copy(); R[d["anomalia"] > 0] = (0, 0, 255)
        pasta = os.path.join(os.path.dirname(arq) or ".", "resultado"); os.makedirs(pasta, exist_ok=True)
        base = os.path.join(pasta, os.path.basename(arq).rsplit(".", 1)[0])
        cv2.imwrite(base + " - classificada.jpg", out)
        cv2.imwrite(base + " - vista de cima.jpg", R)
