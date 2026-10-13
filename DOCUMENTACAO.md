# Contador de grãos de soja com placa e gêmeo digital

**Autor:** Criz Renê Zanovello · **Desenvolvimento:** com Claude (Claude Code) · **Período:** 01 a 12/10/2026
**App:** https://renecriz-lang.github.io/contador-graos-soja/ · **Código:** github.com/renecriz-lang/contador-graos-soja

Este documento registra o problema, as decisões, o funcionamento, os testes e os próximos passos do
contador. Serve para apresentar o trabalho e para retomar o desenvolvimento depois. Na próxima conversa,
basta pedir ao Claude para ler este arquivo.

---

## 1. O problema

A contagem de grãos é a etapa que vem antes da pesagem na determinação do **peso de mil grãos (PMS)**
(padrão RAS: 8 repetições de 100 grãos). Contar à mão é lento e cansativo. Por ser uma contagem para
pesquisa agrícola, o requisito principal é a **precisão**. Um número errado que parece certo é pior do
que um número com aviso de dúvida.

## 2. Linha do tempo das decisões

| Data | O que aconteceu | Por quê |
|---|---|---|
| 01/10 | **MVP 1:** app de celular (PWA) que fotografa grãos soltos numa bandeja e conta as manchas por cor, separando grãos encostados pela área e por k-means. | Primeira tentativa, sem nenhum hardware. |
| 01/10 | Resultado ruim: com grãos encostados os números divergiam (260 a 525 na mesma foto), e o app ficou **lento**. | Grão encostado é o problema clássico da contagem por imagem. |
| 12/10 | Ideia de olhar por dentro um app comercial (Seed Counter, Plolabs) com a ferramenta REA. **Decisão:** estudar a ideia é legítimo; copiar o código ou o modelo, não (o app é público no GitHub). O caminho ficou em segundo plano. | Questão de propriedade intelectual. E a placa tornou isso desnecessário. |
| 12/10 | **Mudança de estratégia (ideia do Criz):** placa impressa em 3D com **furos (1 grão por furo)** e **marcadores ArUco**. O app deixa de procurar grãos e passa a responder, furo por furo, "tem grão aqui?". | Transforma um problema difícil (separar grãos encostados) num fácil (ocupado ou vazio, em posição conhecida). |
| 12/10 | **Gêmeo digital (ideia do Criz):** a placa é desenhada dentro do programa, em milímetros, a partir do STL. Os marcadores dizem onde a placa está na foto, inclusive inclinada. | Precisão: o app sabe exatamente onde tem furo e onde não tem. |
| 12/10 | **Negativo (ideia do Criz):** conferir se "o preto está preto". Fora dos furos, a placa só pode ser preta, ou branca onde o desenho dos marcadores manda. Qualquer coisa diferente é grão extra por cima. | Pega grão sobrando que a contagem por furo não vê. |
| 12/10 | Grão extra vira **alerta**, não "+1 automático". | Dois grãos colados podem virar uma mancha só, e somar sozinho daria um número errado com cara de certo. |
| 12/10 | **Grão duplo dentro do furo:** por enquanto fica a cargo do operador. Testamos o formato da mancha e **não separou** duplo de simples. | Ver a seção 8. Solução física em teste: placa mais rasa. |
| 12/10 | Protótipo validado em Python/OpenCV e depois reescrito em JavaScript puro para o celular. Primeiro teste no celular real: os furos saíram certos, mas houve alarmes falsos. Corrigido (seção 7). | — |
| 12/10 | **Captura: "achou os marcadores, tira a foto e conta"** (pedido do Criz). | Prático: ninguém fica segurando o celular firme esperando. |

## 3. A placa de teste

Arquivo `peca_com_ArUcoreduzido.STL` (fica fora do GitHub, que é público). Os valores abaixo foram
tirados do STL pelo script `prototipo/stl_para_geometria.py`.

| Item | Valor |
|---|---|
| Tamanho | 70 × 91 × 6 mm |
| Furos | 24 (4 fileiras de 6, intercaladas), Ø 8,5 mm, 5 mm de profundidade (fundo em z = 1 mm) |
| Espaçamento | 10,5 mm entre centros; fileiras a 9,09 mm; deslocamento de 5,25 mm |
| Marcadores | ArUco `DICT_4X4_50`, IDs 0 (sup. esq.), 1 (sup. dir.), 2 (inf. esq.), 3 (inf. dir.) |
| Marcador | 18 mm (quadrado preto com borda) + moldura branca de 3 mm (24 mm no total); rebaixo de 1,5 mm para a pintura |
| Acabamento | Plástico preto; partes brancas pintadas (teste com cola branca, depois tinta) |
| Geometria no app | `placas/placa-24.json` (furos numerados 1 a 24, linha por linha, de cima para baixo) |

## 4. Como o app funciona

```
câmera ──► acha os ArUco ──► encaixa o gêmeo digital ──► vista de cima ──► furo a furo ──► resultado
              (vídeo)          (homografia mm → px)        (6 px/mm)       + negativo       + alertas
```

1. **Acha os marcadores.** Biblioteca js-aruco2 (JavaScript puro, licença MIT, cerca de 60 KB, contra
   os 9 MB do OpenCV.js; leve para a internet do sítio). Procura em vários tamanhos de imagem, porque
   o detector é sensível à escala. Só aceita os IDs da placa, o que evita marcador "fantasma".
2. **Refina os cantos** abaixo de 1 pixel (mesma ideia do `cornerSubPix` do OpenCV). Fica a menos de
   0,5 px do OpenCV.
3. **Encaixa o gêmeo digital:** calcula a homografia (a conta que leva milímetros da placa para pixels
   da foto e corrige a inclinação) com os 16 cantos dos 4 marcadores. Canto que destoa (canto lascado
   na impressão, tinta borrada) é descartado e a conta é refeita. Funciona com 3 marcadores.
4. **Autoconferência:** o branco dos marcadores tem que cair no branco da foto (pelo menos 93%). Se não
   bater, o app procura os marcadores de novo na foto inteira; na câmera, tira outra foto sozinho (até 2 vezes).
5. **Vista de cima:** a placa é redesenhada "reta", como se a câmera estivesse perfeitamente por cima,
   a 6 px/mm. É o "ver gêmeo digital" na tela de resultado.
6. **Furo a furo:** nota = fração de pixels **claros** dentro do furo (num círculo de 80% do raio, para
   não pegar a parede). "Claro" é medido em relação ao **preto da própria placa** e ao **branco dos
   próprios marcadores** naquela foto, então a régua se ajusta à luz de cada foto.
   - nota ≥ 0,20: **ocupado** (verde)
   - nota ≤ 0,12: **vazio** (azul)
   - entre as duas: **duvidoso** (amarelo), e o operador decide
7. **Negativo:** fora dos furos, compara cada ponto com o que o gêmeo manda (preto, ou branco nas
   molduras e nos quadradinhos de cada marcador, lidos do próprio código ArUco). Conta como alerta a
   mancha que foge do esperado com área ≥ 8 mm² e espessura ≥ 0,5 mm (linha fina de desalinhamento não conta).
   Folgas: 0,4 mm em volta do furo, 0,6 mm na divisa preto/branco, 0,8 mm na borda da placa.

### Uso no celular

1. **"Contar com a câmera"**: os furos aparecem desenhados sobre a placa ao vivo.
2. Achou 3 ou 4 marcadores: **tira a foto e conta**, com apito.
   - Dois apitos agudos: tudo certo.
   - Apito grave: possível grão extra.
   - Apito de erro: não achou a placa.
3. Resultado: número de grãos (furos ocupados), foto com os furos coloridos e círculos vermelhos nos
   grãos extras. **Tocar num furo** troca ocupado ↔ vazio (o furo corrigido fica tracejado), e tem "Desfazer".
4. Grão extra: **"Tirei o excesso — contar de novo"** (reconta na hora) ou **"Não tem grão extra"**.
5. **"Salvar e nova contagem"** só libera sem furo amarelo e com o alerta resolvido. Depois de salvar,
   o app espera a placa sair de vista (troca de amostra) para não contar a mesma placa duas vezes.
6. As contagens salvas aparecem na tela inicial com total, hora, número de correções e se houve alerta.
7. Também aceita **foto da galeria**. Funciona **sem internet** depois da primeira abertura.

## 5. Resultados dos testes

**Fotos estáticas** (protótipo em Python e app em JavaScript dão o mesmo resultado):

| Conjunto | Situação real | Resultado |
|---|---|---|
| Fotos 1 e 2 (com flash) | 18 grãos, 6 furos vazios | 18 / 6 nas duas ✔ |
| Placa vazia | 24 vazios | 24 vazios ✔ (nota máx. 0,02) |
| Placa cheia, mesa limpa | 24 + duplo no furo 18 | 24 ✔; duplo não detectado (esperado) |
| Placa cheia + grãos extras | 24 + grãos sobre a placa, solto e sobre a moldura | 24 ✔; alertas perto dos furos 2, 17, 21 e 24 ✔ |
| Placa cheia, cena do pote | 24 + grãos por cima (12 e 15) + duplo no 19 | 24 ✔; alertas no 12 e no 15 ✔ (numa das fotos só o 15) |

- **Separação ocupado × vazio:** furo vazio nunca passou de 0,09 de nota; grão (inclusive em pé, fundo
  no furo) ficou ≥ 0,24. A folga é grande.
- **Encaixe:** erro médio de cerca de 1 px; os 4 marcadores achados em 9 de 10 fotos.
- **Tempo:** cerca de 0,2 s por foto no PC. No Chrome com o processador 6 vezes mais lento (simulando
  um celular comum): **1,6 s de abrir a câmera até o número**.
- **Celular real (teste do Criz, 12/10, prints em `Testes/Teste app 1/`):** ocupado/vazio certos em
  todas as fotos. Depois da correção da seção 7, o Criz confirmou: "tá funcionando certinho".

## 6. Limitações conhecidas

- **1 furo ocupado = 1 grão.** Grão duplo dentro do furo não é detectado (ver seção 8).
- **Grão extra quase todo dentro do círculo de um furo cheio** pode escapar do negativo (cena do pote,
  furo 12 numa das fotos: só 4 mm² ficavam visíveis).
- **Grão fora da placa é ignorado** (de propósito).
- **Flash** cria reflexos no plástico preto. Use luz ambiente, sem sol direto.
- A homografia corrige o plano da placa, não a altura do grão: grão alto com câmera inclinada "vaza" um
  pouco do círculo, e as folgas absorvem isso.
- Validado com **soja de cor creme sobre placa preta**. Grão escuro (soja preta, por exemplo) exigiria
  inverter o contraste (placa clara).

## 7. Problemas encontrados e como foram resolvidos

| Problema | Causa | Solução |
|---|---|---|
| Detector JS não achava nada na foto cheia | Janela de limiar minúscula + textura da impressão 3D | Rodar em várias escalas reduzidas e juntar |
| Grade levemente torta | Canto lascado no marcador ID0 (impressão) | Descartar o **canto** ruim, não o marcador inteiro |
| Linhas vermelhas falsas na moldura | Marcador não achado, encaixe 0,5 mm torto ali | Mais escalas + filtro de espessura (≥ 0,5 mm) |
| Celular mostrava o app antigo | Cópia offline (service worker) abria antes da versão nova | "Rede primeiro": a cópia só é usada sem internet |
| Demorava para tirar a foto | Exigia vários quadros firmes e nítidos seguidos | Dispara assim que acha os marcadores |
| Faixas vermelhas e alertas falsos no celular | A foto usava os cantos do **quadro anterior** do vídeo; se o celular mexeu, o gêmeo encaixava deslocado | Procura os marcadores de novo na própria foto + autoconferência do encaixe |
| Com grão em cima, só dava para descartar | Faltava ação no alerta, e "descartar" exigia tirar a placa de vista | Botão "Tirei o excesso — contar de novo" e reconta imediata |

## 8. Grão duplo: o que já se sabe

- Exemplos com gabarito (confirmados pelo Criz): furo 18 nas fotos 20.48.38, 20.48.39, 20.48.39 (1) e
  20.48.39 (2); furo 19 nas fotos 20.48.40, 20.48.40 (1) e 20.48.40 (2), na pasta `Fotos Soja plaquinha/`.
- Testado e **não funcionou**: área, solidez e elipse da mancha clara (duplo e simples se misturam).
- Pista parcial: um anel em volta do furo fica mais claro quando o grão de cima transborda, mas o
  duplo inteiro dentro do furo não aparece.
- **Solução física em teste:** furo mais raso (3 a 3,5 mm em vez de 5 mm). O segundo grão fica alto e
  sai ao passar a mão; se sobrar, aparece no negativo.
- Futuro possível: um modelo treinado com fotos de furos com 1 e com 2 grãos.

## 9. Arquivos do projeto

| Arquivo | O que é |
|---|---|
| `index.html` | O app (telas, câmera, captura automática, resultado, correção por toque, sons, contagens salvas) |
| `placa.js` | O núcleo: marcadores, encaixe, vista de cima, furos, negativo e autoconferência. Roda no celular e no PC (Node) |
| `placas/placa-24.json` | Geometria da placa de teste (gêmeo digital) |
| `vendor/js-aruco2/` | Biblioteca de ArUco (MIT); o dicionário teve o caminho do `require` ajustado |
| `sw.js`, `manifest.webmanifest`, `icon*` | Funcionamento offline e instalação (PWA) |
| `prototipo/grade.py` | Python/OpenCV: desenha a grade do gêmeo sobre fotos (conferir geometria e IDs) |
| `prototipo/classifica.py` | Python/OpenCV: protótipo da classificação e do negativo (gera "classificada" e "vista de cima") |
| `prototipo/testar-js.js` | Roda o `placa.js` nas fotos de teste no PC (`node prototipo/testar-js.js`) |
| `prototipo/stl_para_geometria.py` | Gera o `.json` da placa a partir do STL |
| `Fotos Soja plaquinha/`, `ArcUco soja 1/2.jpeg`, `Testes/` | Fotos e prints de teste (fora do GitHub) |

## 10. Como mexer depois

- **Nova placa (por exemplo, a de 200+ furos):**
  1. `python prototipo/stl_para_geometria.py placa.STL placas/placa-200.json --ids 0 1 2 3 ...`
  2. Conferir com uma foto: em `prototipo/grade.py`, trocar o arquivo da placa e rodar
     `python prototipo/grade.py foto.jpeg`.
  3. No `index.html`, apontar `ARQ_PLACA` para o novo arquivo (ou implementar a escolha automática pelos
     IDs, ver seção 11) e acrescentá-lo em `sw.js`.
- **Ajustar limiares:** tudo fica no objeto `CFG` do `placa.js` (cortes de ocupado/vazio, área e
  espessura do alerta, folgas, autoconferência).
- **Testar antes de publicar:** `node prototipo/testar-js.js` (precisa do `sharp`, emprestado do app
  "Dose de N"). Os resultados devem continuar iguais aos da seção 5.
- **Publicar:** commit + push no GitHub (o GitHub Pages atualiza em cerca de 1 minuto). **Sempre**
  trocar a versão em `sw.js` (`contador-soja-vN`). Para forçar no celular, abrir o link com `?v=N`.

## 11. Próximos passos

1. Pintar os marcadores com tinta de verdade (hoje com cola branca) e refazer o teste.
2. Testar a **placa mais rasa** contra o grão duplo.
3. **Placa final de 200+ furos**, maior, com os mesmos princípios. Talvez **várias placas com marcadores
   próprios**: o app reconheceria qual placa é pelos IDs dos marcadores e carregaria a geometria certa.
4. Placa grande: conferir resolução (pelo menos 5 px/mm na foto), talvez mais marcadores no meio da
   placa (o plástico pode empenar) e o tempo de análise no celular.
5. Exportar as contagens (CSV) e ligar com a pesagem para fechar o cálculo do PMS.
6. Grão duplo: se a placa rasa não resolver, juntar fotos com gabarito e avaliar um modelo treinado.

## 12. Lições que ficaram

- Mudar o **problema** (placa com furos) rendeu mais do que refinar o algoritmo antigo.
- Validar primeiro em protótipo (Python), com fotos reais e gabarito, e só depois portar para o celular.
- Alerta em vez de "correção automática" quando a precisão importa.
- Ao reaproveitar dado de outro momento (quadro anterior do vídeo), conferir contra a foto real.
- Em app offline (PWA), a cópia guardada tem que buscar a versão nova primeiro, senão o celular fica preso na versão velha.
