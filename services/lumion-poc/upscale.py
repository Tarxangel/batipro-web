#!/usr/bin/env python3
"""
Upscale de l'image finale validée (workflow : itérer en 1K, upscaler la bonne).

Re-feed l'image validée à Nano Banana Pro en demandant une montée en résolution
+ netteté SANS rien redessiner (cadrage, géométrie, couleurs identiques).
Sort en 2K ou 4K pour l'impression A3.

Usage :
  GEMINI_API_KEY=xxx python3 upscale.py <image_validee.png> --size 4K
"""

import argparse
import base64
import json
import os
import sys
import urllib.request
import urllib.error

MODEL = "gemini-3-pro-image-preview"
ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

PROMPT = """Augmente la résolution et la netteté de cette image pour une impression
A3 haute définition. RÈGLE ABSOLUE : ne change strictement RIEN au contenu —
cadrage identique, géométrie identique, mêmes couleurs, mêmes matériaux, mêmes
ouvertures, mêmes véhicules, mêmes personnages, même végétation, même ambiance
lumineuse. Tu n'augmentes QUE la finesse des détails et la netteté (textures,
feuillages, reflets). Aucun ajout, aucune suppression, aucun recadrage.
Image unique plein cadre, sans cartouche ni légende."""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("--size", default="4K", choices=["2K", "4K"])
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        sys.exit("GEMINI_API_KEY manquant")

    mime = "image/png" if args.image.lower().endswith(".png") else "image/jpeg"
    with open(args.image, "rb") as f:
        img_b64 = base64.b64encode(f.read()).decode()

    body = {
        "contents": [{"parts": [
            {"inline_data": {"mime_type": mime, "data": img_b64}},
            {"text": PROMPT},
        ]}],
        "generationConfig": {
            "responseModalities": ["IMAGE"],
            "imageConfig": {"aspectRatio": "16:9", "imageSize": args.size},
        },
    }
    url = ENDPOINT.format(model=MODEL) + f"?key={api_key}"
    req = urllib.request.Request(url, data=json.dumps(body).encode(),
                                headers={"Content-Type": "application/json"})
    print(f"Upscale {args.size} de {args.image} via {MODEL} …", flush=True)
    try:
        with urllib.request.urlopen(req, timeout=240) as resp:
            data = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        sys.exit(f"HTTP {e.code}: {e.read().decode()[:400]}")

    out = args.out or os.path.splitext(args.image)[0] + f"_{args.size}.png"
    for cand in data.get("candidates", []):
        for part in cand.get("content", {}).get("parts", []):
            inline = part.get("inlineData") or part.get("inline_data")
            if inline and inline.get("data"):
                with open(out, "wb") as f:
                    f.write(base64.b64decode(inline["data"]))
                print(f"✓ {out} ({len(base64.b64decode(inline['data']))//1024} Ko)")
                return
    sys.exit("Pas d'image dans la réponse : " + json.dumps(data)[:400])


if __name__ == "__main__":
    main()
