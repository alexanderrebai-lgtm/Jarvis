"""
Voix locale de Jarvis : Chatterbox multilingue (Resemble AI, licence MIT),
sur la carte graphique du PC. Petit serveur HTTP local (127.0.0.1 seulement) :
  GET  /etat  -> {"pret": true, "appareil": "cuda"}
  POST /dire  {"texte": "...", "reference": "C:/...wav", "expressivite": 0.5} -> audio WAV
"""

import argparse
import io
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

parser = argparse.ArgumentParser()
parser.add_argument("--port", type=int, default=8897)
parser.add_argument("--jeton", default="")
args = parser.parse_args()

import torch  # noqa: E402
import torchaudio  # noqa: E402

try:
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS
except ImportError:  # selon la version du paquet
    from chatterbox import ChatterboxMultilingualTTS

device = "cuda" if torch.cuda.is_available() else "cpu"
model = ChatterboxMultilingualTTS.from_pretrained(device=device)
lock = threading.Lock()
print(json.dumps({"pret": True, "appareil": device}), flush=True)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _ok_token(self):
        return not args.jeton or self.headers.get("x-jeton") == args.jeton

    def do_GET(self):
        if self.path != "/etat" or not self._ok_token():
            self.send_response(404)
            self.end_headers()
            return
        body = json.dumps({"pret": True, "appareil": device}).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path != "/dire" or not self._ok_token():
            self.send_response(404)
            self.end_headers()
            return
        try:
            data = json.loads(self.rfile.read(int(self.headers.get("content-length", "0"))) or b"{}")
            texte = str(data.get("texte", "")).strip()[:1500]
            if not texte:
                raise ValueError("texte vide")
            options = {"language_id": "fr", "exaggeration": float(data.get("expressivite", 0.5)), "cfg_weight": 0.5}
            reference = data.get("reference")
            if reference and os.path.isfile(reference):
                options["audio_prompt_path"] = reference
            with lock, torch.inference_mode():
                wav = model.generate(texte, **options)
            buffer = io.BytesIO()
            torchaudio.save(buffer, wav.cpu(), model.sr, format="wav")
            body = buffer.getvalue()
            self.send_response(200)
            self.send_header("content-type", "audio/wav")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except Exception as error:  # noqa: BLE001
            body = json.dumps({"erreur": str(error)}).encode()
            self.send_response(500)
            self.send_header("content-type", "application/json")
            self.end_headers()
            self.wfile.write(body)


ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()
