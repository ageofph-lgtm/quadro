# Quadro — leitor de HQ

Leitor de HQs em PDF feito para tablet, pensado para o Surface em modo tablet. Também funciona no celular (Android e iPhone). É uma PWA: roda no navegador e pode ser instalada como app pelo Edge.

## O que faz

- **Virada de página realista:** arraste o canto e a folha dobra com sombra. A capa vira como capa dura.
- **Página dupla automática:** em paisagem mostra duas páginas, em retrato uma só.
- **Páginas duplas da HQ:** os splashes de duas páginas são cortados em metades que se reencaixam lado a lado em paisagem.
- **Zoom em balão (IA):** um modelo detecta os balões e textos de cada página, direto no aparelho, sem servidor.
  - Toque num balão para ampliá-lo com destaque. O recorte é renderizado em alta resolução, então o texto sai nítido.
  - Use ‹ › (ou toque nas laterais, swipe ou setas do teclado) para ir de balão em balão. No fim da página, ele vira sozinho e continua.
  - O botão ▶ começa a leitura balão por balão.
  - A detecção roda em segundo plano e fica guardada. A segunda leitura é instantânea.
- **Zoom livre:** duplo toque ou pinça.
- **Biblioteca:**
  - capas geradas automaticamente;
  - "Continuar lendo" e progresso salvo por HQ;
  - arrastar e soltar PDFs.
- **Instalado como app, também dá para:**
  - escolher a **pasta** das HQs, que é lida direto, com subpastas;
  - ler **offline**;
  - **"Abrir com → Quadro"** nos PDFs do Windows.

## Gestos

| Onde | Gesto | Ação |
|---|---|---|
| Página | toque na borda direita / esquerda | próxima / anterior |
| Página | arrastar o canto, swipe | virar com animação |
| Página | toque num balão | zoom no balão |
| Página | toque no centro | mostra/esconde o menu |
| Página | duplo toque, pinça, Ctrl+roda | zoom livre |
| Zoom no balão | toque à direita / esquerda, swipe, ‹ › | próximo / anterior balão |
| Zoom no balão | toque no centro | fecha |

## Instalar no Surface

1. Abra o site publicado no GitHub Pages pelo **Edge**.
2. Escolha **Instalar Quadro**: no menu ⋯ → Apps, ou no ícone de instalar na barra de endereço.
3. No app, toque em **Escolher pasta** e aponte para a pasta das HQs.

## Desenvolvimento

```sh
npm ci
npm run build       # gera dist/
npm run serve       # http://localhost:8765
npm run sample      # gera tests/amostra.pdf (HQ sintética)
npm test            # testes de ponta a ponta com Playwright (com o serve rodando)
```

Estrutura:

- `src/app.js`: biblioteca, leitor, zoom e balões.
- `src/detector.worker.js`: IA num Web Worker, com onnxruntime-web.
- `src/sw.js`: cache offline.
- `models/ctd-int8.onnx`: modelo de detecção (8 MB). Para regerar, use `tools/exportar-modelo.py`.

O deploy é automático. Cada push no `main` publica no GitHub Pages pelo workflow `.github/workflows/pages.yml`.

## Créditos e licenças

- [pdf.js](https://github.com/mozilla/pdf.js) (Apache-2.0). Usa o build *legacy*, que traz polyfills para Safari e Chrome de celular.
- [StPageFlip](https://github.com/Nodlik/StPageFlip) (MIT)
- [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) (MIT)
- **Modelo de balões:** [comic-text-detector](https://github.com/dmMaze/comic-text-detector), pesos de [manga-image-translator](https://github.com/zyddnys/manga-image-translator), licença **GPL-3.0**. Aqui ele foi recortado só na saída de caixas e quantizado para int8. Uso pessoal sem restrição. Distribuir o app junto com o modelo implica seguir a GPL-3.0.
