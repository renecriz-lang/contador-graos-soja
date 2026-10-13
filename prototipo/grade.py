# Prototipo (PC): detecta ArUco, encaixa a geometria da placa (tirada do STL) e desenha os furos.
import cv2, json, sys, numpy as np

G = json.load(open("placas/placa-24.json", encoding="utf-8"))
D = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
P = cv2.aruco.DetectorParameters(); P.errorCorrectionRate = 1.0
P.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_SUBPIX
IDS_PLACA = {m["id"]: m for m in G["marcadores"]}

def cantos_mm(m):
    cx, cy = m["centro"]; h = m["lado"] / 2
    return np.float32([[cx-h, cy-h], [cx+h, cy-h], [cx+h, cy+h], [cx-h, cy+h]])

def mm_para_px(H, pts):
    return cv2.perspectiveTransform(np.float32(pts)[None], H)[0]

def encaixar(im):
    """Acha os marcadores e devolve a homografia mm -> pixel (ou None) + diagnostico."""
    g = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
    c, ids, _ = cv2.aruco.ArucoDetector(D, P).detectMarkers(g)
    ids = [] if ids is None else ids.ravel().tolist()
    achados = [(i, cc[0]) for i, cc in zip(ids, c) if i in IDS_PLACA]
    if len(achados) < 2:
        return None, {"marcadores": [i for i, _ in achados]}
    src = np.float32(np.concatenate([cantos_mm(IDS_PLACA[i]) for i, _ in achados]))
    dst = np.float32(np.concatenate([cc for _, cc in achados]))
    H, ok = cv2.findHomography(src, dst, cv2.RANSAC, 4.0)
    ok = ok.ravel() == 1
    erro = np.linalg.norm(mm_para_px(H, src) - dst, axis=1)[ok]
    pxmm = np.linalg.norm(np.diff(mm_para_px(H, [[0, 0], [10, 0]]), axis=0)) / 10
    return H, {"marcadores": sorted(i for i, _ in achados), "cantos": achados,
               "erro_medio": float(erro.mean()), "erro_max": float(erro.max()),
               "descartados": int((~ok).sum()), "px_mm": float(pxmm)}

def circulo_px(H, x, y, r, n=40):
    ang = np.linspace(0, 2*np.pi, n, endpoint=False)
    return mm_para_px(H, np.stack([x + r*np.cos(ang), y + r*np.sin(ang)], 1))

if __name__ == "__main__":
    for arq in sys.argv[1:]:
        im = cv2.imread(arq)
        H, d = encaixar(im)
        if H is None:
            print(f"{arq}: marcadores insuficientes {d['marcadores']}"); continue
        print(f"{arq}: marcadores {d['marcadores']}  erro medio {d['erro_medio']:.2f} px (max {d['erro_max']:.2f})"
              f"  ~{d['px_mm']:.1f} px/mm  cantos descartados {d['descartados']}")
        out = im.copy()
        borda = mm_para_px(H, [[0, 0], [G['largura'], 0], [G['largura'], G['altura']], [0, G['altura']]])
        cv2.polylines(out, [borda.astype(int)], True, (255, 0, 255), 2)
        for f in G["furos"]:
            cv2.polylines(out, [circulo_px(H, f["x"], f["y"], f["d"]/2).astype(int)], True, (0, 255, 255), 2)
            ctr = mm_para_px(H, [[f["x"], f["y"]]])[0]
            cv2.putText(out, str(f["n"]), (int(ctr[0])-10, int(ctr[1])+6), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 0, 255), 2)
        for i, cc in d["cantos"]:
            cv2.polylines(out, [cc.astype(int)], True, (0, 255, 0), 2)
            cv2.putText(out, f"ID{i}", tuple(cc[0].astype(int) + [0, -8]), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 255, 0), 2)
        cv2.imwrite(arq.rsplit(".", 1)[0] + " - grade.jpg", out)
