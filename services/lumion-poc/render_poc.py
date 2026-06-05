#!/usr/bin/env python3
"""
POC — Amélioration IA de rendus Lumion pour Batipro / Gan Pontarlier.

Prend une image source (rendu Lumion brut), applique les 4 choix de presets
(heure, intensité lumineuse, ambiance, végétation) et produit DEUX livrables
distincts via Gemini image-edit :
  1. rendu photoréaliste haut de gamme (géométrie strictement conservée)
  2. esquisse architecte couleur (trait + aquarelle légère)

Objectif : tester la fidélité géométrique réelle avant l'intégration applicative.
Usage :
  GEMINI_API_KEY=xxx python3 render_poc.py <image.jpg> \
      --heure "tombée du jour" --intensite moyenne --ambiance chaleureuse \
      --vegetation "paysagisme haut de gamme" --localisation "Pontarlier (25, Doubs)"
"""

import argparse
import base64
import json
import os
import sys
import urllib.request
import urllib.error

# Modèles image testés dans l'ordre (le premier qui répond une image gagne).
MODELS = [
    "gemini-3-pro-image-preview",   # Nano Banana Pro — meilleure fidélité + 2K/4K
    "gemini-2.5-flash-image",       # Nano Banana — fallback stable, ~0,04 $/img
]
ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

# ── Contraintes communes : le verrou géométrique ──────────────────────────
GEOMETRY_LOCK = """RÈGLE ABSOLUE — FIDÉLITÉ GÉOMÉTRIQUE :
L'image fournie est la référence géométrique UNIQUE. Tu dois reproduire à
l'identique, sans aucune modification : les volumes, proportions, hauteurs,
alignements, toutes les ouvertures (fenêtres/portes), les menuiseries, les
matériaux et bardages (bardage bois ajouré, panneaux pierre claire, bardage
métallique noir nervuré), les acrotères, le vitrage, le logo "gan ASSURANCES"
à sa position exacte, le stationnement, les clôtures, accès et véhicules.
Aucune ouverture ne doit être déplacée, ajoutée ou supprimée. Aucun élément
architectural inventé. Tu n'améliores QUE : l'ambiance lumineuse, le rendu
des matériaux, la végétation et la qualité paysagère.
Cadrage et point de vue identiques à la source. Image plein cadre, sans
cartouche, titre, logo d'agence, légende ni montage."""

VEGETATION_RULES = """VÉGÉTATION : cohérente avec un climat continental/montagnard
(Pontarlier, Haut-Doubs, ~800 m). AUTORISÉ : graminées rustiques (miscanthus,
calamagrostis, carex), lavandes rustiques, sauges vivaces, hortensias,
cornouillers, amélanchiers, bouleaux, érables champêtres, pins de montagne,
épicéas. INTERDIT : palmiers, oliviers, lauriers roses, agaves, plantes
méditerranéennes. Aménagement élégant, contemporain, sobre, pérenne, comme
conçu par un architecte paysagiste."""


def build_photoreal_prompt(p):
    return f"""Produis UN SEUL rendu photoréaliste architectural haut de gamme à
partir de cette image, qualité photographie d'architecture professionnelle / rendu concours.

{GEOMETRY_LOCK}

AMBIANCE DEMANDÉE :
- Heure : {p.heure}
- Intensité lumière intérieure : {p.intensite} (éclairage chaud réaliste de bureaux
  occupés, bien visible et glow chaleureux dans TOUS les vitrages ; éclairage d'entrée
  venant du plafond/auvent ; éclairage paysager discret au sol dans les massifs plantés
  (uplights doux rasant les graminées le long de la façade) ; AUCUN éclairage dans le
  bitume ni dans les surfaces béton/pierre ; aucun spot inventé au premier plan)
- Ciel et contraste : ciel dramatique riche (dégradé coucher de soleil / heure bleue),
  contraste marqué, rendu premium moody d'agence d'architecture haut de gamme
- Tonalité générale : {p.ambiance}
- Localisation : {p.localisation}

{VEGETATION_RULES}
Niveau de végétalisation : {p.vegetation}.

La fidélité architecturale prime sur l'esthétique. Sortie : une image unique, plein cadre."""


def build_sketch_prompt(p):
    return f"""Produis UNE SEULE esquisse architecturale couleur à partir de cette image :
croquis d'architecte professionnel dessiné à la main, encre noire fine + aquarelle
légère, style carnet d'architecte haut de gamme.

{GEOMETRY_LOCK}

Même géométrie, même cadrage, mêmes ouvertures, mêmes proportions que la source.
Style de trait : trait d'architecte LÂCHE et vivant, lignes d'encre qui DÉBORDENT
légèrement des angles et se prolongent au-delà des coins, lavis d'aquarelle
transparents et légers, bords de l'image qui s'estompent vers le blanc (effet
vignette carnet de croquis, papier visible aux marges), ciel suggéré en quelques
traits légers. Caractère « croquis pris sur le vif », pas un trait propre et figé.
Le rendu doit donner l'impression d'avoir été dessiné à la main par un architecte
puis mis en couleur à l'aquarelle légère. Végétation cohérente : {p.vegetation}.
Localisation : {p.localisation}.
Sortie : une image unique, plein cadre, sans cartouche ni légende."""


def call_gemini(model, api_key, prompt, image_b64, mime):
    body = {
        "contents": [{
            "parts": [
                {"inline_data": {"mime_type": mime, "data": image_b64}},
                {"text": prompt},
            ]
        }],
        "generationConfig": {
            "responseModalities": ["IMAGE"],
            "imageConfig": {"aspectRatio": "16:9"},
        },
    }
    url = ENDPOINT.format(model=model) + f"?key={api_key}"
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=180) as resp:
        data = json.loads(resp.read())
    for cand in data.get("candidates", []):
        for part in cand.get("content", {}).get("parts", []):
            inline = part.get("inlineData") or part.get("inline_data")
            if inline and inline.get("data"):
                return base64.b64decode(inline["data"])
    raise RuntimeError("Pas d'image dans la réponse : " + json.dumps(data)[:500])


def generate(label, prompt, api_key, image_b64, mime, out_path):
    last_err = None
    for model in MODELS:
        try:
            print(f"  → {label} via {model} …", flush=True)
            img = call_gemini(model, api_key, prompt, image_b64, mime)
            with open(out_path, "wb") as f:
                f.write(img)
            print(f"  ✓ {label} : {out_path} ({len(img)//1024} Ko, modèle {model})")
            return True
        except urllib.error.HTTPError as e:
            last_err = f"{model} → HTTP {e.code}: {e.read().decode()[:300]}"
            print(f"  ✗ {last_err}")
        except Exception as e:
            last_err = f"{model} → {e}"
            print(f"  ✗ {last_err}")
    print(f"  ✗✗ {label} échoué. Dernière erreur : {last_err}")
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("--heure", default="tombée du jour")
    ap.add_argument("--intensite", default="moyenne")
    ap.add_argument("--ambiance", default="chaleureuse")
    ap.add_argument("--vegetation", default="paysagisme haut de gamme")
    ap.add_argument("--localisation", default="Pontarlier (25, Doubs), climat continental/montagnard")
    ap.add_argument("--outdir", default=None)
    args = ap.parse_args()

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        sys.exit("GEMINI_API_KEY manquant (export GEMINI_API_KEY=...)")

    src = args.image
    mime = "image/jpeg" if src.lower().endswith((".jpg", ".jpeg")) else "image/png"
    with open(src, "rb") as f:
        image_b64 = base64.b64encode(f.read()).decode()

    outdir = args.outdir or os.path.join(os.path.dirname(os.path.abspath(src)), "poc-renders")
    os.makedirs(outdir, exist_ok=True)
    base = os.path.splitext(os.path.basename(src))[0]

    print(f"Source : {src}")
    print(f"Presets : heure={args.heure} | intensité={args.intensite} | "
          f"ambiance={args.ambiance} | végétation={args.vegetation}")
    print(f"Sortie : {outdir}\n")

    generate("Livrable 1 — photoréaliste", build_photoreal_prompt(args), api_key,
             image_b64, mime, os.path.join(outdir, f"{base}_1_photoreal.png"))
    generate("Livrable 2 — esquisse aquarelle", build_sketch_prompt(args), api_key,
             image_b64, mime, os.path.join(outdir, f"{base}_2_esquisse.png"))


if __name__ == "__main__":
    main()
