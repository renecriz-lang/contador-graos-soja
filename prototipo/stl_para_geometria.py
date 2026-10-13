# Gera a geometria da placa (placas/<nome>.json) a partir do STL.
# Uso: python prototipo/stl_para_geometria.py peca.STL placas/placa-nova.json --ids 0 1 2 3
#
# Como acha as coisas no STL (binario, em mm, eixo Z pra cima, placa deitada no plano XY):
#  - furos: faces horizontais do FUNDO de cada furo (o nivel Z com mais pecas redondas iguais)
#  - marcadores: quadrados do rebaixo da moldura branca (pecas quadradas de 15 a 40 mm)
#  - o eixo Y e invertido (no app, y cresce pra baixo, como na foto)
# Os IDs dos marcadores vao na ordem de leitura (de cima pra baixo, da esquerda pra direita).
# CONFIRA os IDs com uma foto (prototipo/grade.py desenha a grade por cima) antes de usar.
import argparse, json, struct, numpy as np

def ler_stl(arq):
    b = open(arq, "rb").read()
    n = struct.unpack("<I", b[80:84])[0]
    if 84 + n * 50 != len(b):
        raise SystemExit("STL nao e binario (exporte como binario).")
    t = np.frombuffer(b[84:84 + n * 50], dtype=np.dtype([("n", "<f4", 3), ("v", "<f4", (3, 3)), ("x", "<u2")]))
    return t["v"].astype(float)

def pecas(T):
    """Agrupa triangulos que compartilham vertice; devolve (min_xy, max_xy) de cada grupo."""
    P = np.round(T[:, :, :2], 3); n = len(T); pai = list(range(n))
    def raiz(i):
        while pai[i] != i: pai[i] = pai[pai[i]]; i = pai[i]
        return i
    visto = {}
    for i in range(n):
        for v in map(tuple, P[i]):
            if v in visto: pai[raiz(i)] = raiz(visto[v])
            else: visto[v] = i
    g = {}
    for i in range(n): g.setdefault(raiz(i), []).append(i)
    return [(P[ix].reshape(-1, 2).min(0), P[ix].reshape(-1, 2).max(0)) for ix in g.values()]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("stl"); ap.add_argument("saida")
    ap.add_argument("--ids", type=int, nargs="+", help="IDs dos marcadores em ordem de leitura")
    ap.add_argument("--lado", type=float, default=None, help="lado do marcador preto em mm (padrao: moldura - 6)")
    ap.add_argument("--nome", default=None)
    a = ap.parse_args()
    T = ler_stl(a.stl)
    V = T.reshape(-1, 3); x0, y0, z0 = V.min(0); x1, y1, z1 = V.max(0)
    larg, alt = x1 - x0, y1 - y0
    horiz = lambda z: np.all(np.abs(T[:, :, 2] - z) < 1e-3, axis=1)
    niveis = sorted(set(np.round(V[:, 2], 3)))
    furos, marc = [], []
    for z in niveis:
        if z in (z0, z1): continue
        for mn, mx in pecas(T[horiz(z)]):
            d = mx - mn; c = (mn + mx) / 2
            if abs(d[0] - d[1]) < 0.05 and 3 < d[0] < 15: furos.append((z, c[0], c[1], d.mean()))
            elif abs(d[0] - d[1]) < 0.05 and 15 <= d[0] <= 40: marc.append((z, c[0], c[1], d.mean()))
    # nivel dos furos = o que tem mais furos
    zf = max(set(f[0] for f in furos), key=lambda z: sum(f[0] == z for f in furos))
    furos = [f for f in furos if f[0] == zf]
    # placa: y pra baixo
    furos = sorted(((round(fx - x0, 3), round(y1 - fy, 3), round(d, 3)) for _, fx, fy, d in furos), key=lambda f: (round(f[1], 1), f[0]))
    marc = sorted(((round(mx_ - x0, 3), round(y1 - my_, 3), round(d, 3)) for _, mx_, my_, d in marc), key=lambda m: (round(m[1], 1), m[0]))
    ids = a.ids or list(range(len(marc)))
    if len(ids) != len(marc):
        raise SystemExit(f"Achei {len(marc)} marcadores, mas vieram {len(ids)} IDs.")
    G = {
        "nome": a.nome or f"Placa {len(furos)} furos ({a.stl.split('/')[-1].split(chr(92))[-1]})",
        "unidade": "mm", "largura": round(larg, 3), "altura": round(alt, 3), "dicionario": "DICT_4X4_50",
        "marcadores": [{"id": i, "centro": [m[0], m[1]], "lado": a.lado or round(m[2] - 6, 3)} for i, m in zip(ids, marc)],
        "furos": [{"n": k + 1, "x": f[0], "y": f[1], "d": f[2]} for k, f in enumerate(furos)],
    }
    json.dump(G, open(a.saida, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"{a.saida}: placa {larg:.1f} x {alt:.1f} mm, {len(furos)} furos (fundo z={zf}), {len(marc)} marcadores {ids}")

if __name__ == "__main__":
    main()
