"""Gera models/ctd-int8.onnx a partir do comic-text-detector original.

O modelo original (≈95 MB) tem três saídas; o Quadro só usa a de caixas (`blk`).
Este script recorta o grafo nessa saída (≈29 MB) e quantiza os pesos para int8 (≈8 MB).

Uso:
  pip install onnx onnxruntime
  curl -L -o /tmp/ctd.onnx https://github.com/zyddnys/manga-image-translator/releases/download/beta-0.3/comictextdetector.pt.onnx
  python tools/exportar-modelo.py /tmp/ctd.onnx models/ctd-int8.onnx
"""
import sys, tempfile, os
import onnx.utils
from onnxruntime.quantization import quantize_dynamic, QuantType

src, dst = sys.argv[1], sys.argv[2]
with tempfile.TemporaryDirectory() as d:
    blk = os.path.join(d, "blk.onnx")
    onnx.utils.extract_model(src, blk, ["images"], ["blk"])
    quantize_dynamic(blk, dst, weight_type=QuantType.QUInt8)
print(dst, round(os.path.getsize(dst) / 1e6, 1), "MB")
