import re
import os
import httpx
import fitz  # PyMuPDF
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


class ExtractRequest(BaseModel):
    pdf_url: str
    zone_code: str
    page_hint: Optional[int] = None  # Page indiquee par l'IGN (#page=XX)


class ExtractResponse(BaseModel):
    zone_text: str
    general_text: str
    total_pages: int
    zone_pages: list[int]
    general_pages: list[int]
    full_text_length: int
    zone_text_length: int
    general_text_length: int


def is_toc_line(line: str) -> bool:
    """Detecte si une ligne est une entree de sommaire (contient des pointilles ou dots + numero)."""
    # "ZONE UY ............................................ 69"
    # "Zone UY                                              69"
    stripped = line.strip()
    if re.search(r'\.{3,}', stripped):
        return True
    if re.search(r'\s{5,}\d{1,3}\s*$', stripped):
        return True
    return False


def is_toc_page(text: str) -> bool:
    """Detecte si une page est un sommaire (beaucoup de lignes avec pointilles)."""
    lines = text.strip().split('\n')
    if not lines:
        return False
    toc_lines = sum(1 for l in lines if is_toc_line(l))
    return toc_lines > len(lines) * 0.3  # Plus de 30% de lignes TOC


def find_zone_section(pages_text: list[str], zone_code: str, page_hint: int = 0) -> tuple[str, list[int]]:
    """Trouve et extrait la section du reglement correspondant a la zone cible."""
    zone_upper = zone_code.upper().strip()

    # Patterns pour detecter le debut d'une section de zone (titre, pas sommaire)
    zone_start_patterns = [
        re.compile(rf'DISPOSITIONS\s+APPLICABLES\s+.*\bZONE\s+{re.escape(zone_upper)}\b', re.IGNORECASE),
        re.compile(rf'\b(?:CHAPITRE|TITRE|SECTION)\b[^\.]*\b{re.escape(zone_upper)}\b', re.IGNORECASE),
        re.compile(rf'^\s*(?:ZONE|SOUS[\s-]?ZONE)\s+{re.escape(zone_upper)}\s*$', re.IGNORECASE | re.MULTILINE),
        re.compile(rf'\b(?:ZONE|SOUS[\s-]?ZONE)\s+{re.escape(zone_upper)}\b', re.IGNORECASE),
    ]

    # Pattern pour detecter le debut d'une AUTRE zone (= fin de notre section)
    other_zone_pattern = re.compile(
        r'\b(?:ZONE|SOUS[\s-]?ZONE)\s+([A-Z]{1,4}[a-z]?(?:\d{0,2}[a-z]?)?)\b'
        r'|\bDISPOSITIONS\s+APPLICABLES\s+.*\bZONE\s+([A-Z]{1,4}[a-z]?(?:\d{0,2}[a-z]?)?)\b',
        re.IGNORECASE
    )

    # Si on a un indice de page (de l'IGN), commencer la recherche la
    # page_hint est 1-indexed dans le PDF, on convertit en 0-indexed
    search_start = max(0, page_hint - 3) if page_hint > 0 else 0

    # Trouver la page de debut
    start_page = -1
    for page_idx in range(search_start, len(pages_text)):
        text = pages_text[page_idx]
        # Ignorer les pages de sommaire
        if is_toc_page(text):
            continue
        for pattern in zone_start_patterns:
            match = pattern.search(text)
            if match:
                # Verifier que ce n'est pas une ligne de sommaire
                line_start = text.rfind('\n', 0, match.start()) + 1
                line_end = text.find('\n', match.end())
                if line_end == -1:
                    line_end = len(text)
                line = text[line_start:line_end]
                if not is_toc_line(line):
                    start_page = page_idx
                    break
        if start_page >= 0:
            break

    if start_page < 0 and page_hint > 0:
        # Si pas trouve avec les patterns, utiliser le hint directement
        start_page = max(0, page_hint - 1)  # 1-indexed to 0-indexed

    if start_page < 0:
        # Dernier recours : chercher toute mention (hors TOC)
        for page_idx, text in enumerate(pages_text):
            if is_toc_page(text):
                continue
            if re.search(rf'\b{re.escape(zone_upper)}\b', text, re.IGNORECASE):
                start_page = page_idx
                break

    if start_page < 0:
        # Zone pas trouvee - renvoyer tout le texte
        all_text = "\n\n".join(pages_text)
        return all_text, list(range(len(pages_text)))

    # Patterns pour detecter le TITRE d'une nouvelle zone (pas une simple reference)
    new_zone_title_patterns = [
        # "Zone UA" ou "ZONE 1AU" seul sur une ligne (titre de section)
        re.compile(r'^\s*(?:ZONE|SOUS[\s-]?ZONE)\s+([A-Z0-9]{1,5}[a-z]?)\s*$', re.IGNORECASE | re.MULTILINE),
        # "ARTICLE 1 – ZONE UA" ou "ARTICLE 2 – ZONE 1AU"
        re.compile(r'ARTICLE\s+\d+\s*[\-–—]\s*ZONE\s+([A-Z0-9]{1,5}[a-z]?)\b', re.IGNORECASE),
        # "DISPOSITIONS APPLICABLES A LA ZONE UA"
        re.compile(r'DISPOSITIONS\s+APPLICABLES\s+.*\bZONE\s+([A-Z0-9]{1,5}[a-z]?)\b', re.IGNORECASE),
        # "Zones à urbaniser" / "Zones agricoles" / "Zones naturelles" (changement de categorie)
        re.compile(r'^\s*Zones?\s+(?:à\s+urbaniser|agricole|naturelle|urbaine)', re.IGNORECASE | re.MULTILINE),
    ]

    # Trouver la page de fin (debut de la zone suivante)
    end_page = len(pages_text)
    for page_idx in range(start_page + 1, len(pages_text)):
        text = pages_text[page_idx]
        if is_toc_page(text):
            continue
        for pattern in new_zone_title_patterns:
            for match in pattern.finditer(text):
                found_zone = (match.group(1) if match.lastindex and match.group(1) else "").upper().strip()
                # Ignorer les mots-cles parasites et les codes trop courts (1 lettre = reference)
                if found_zone in ('ZONE', 'SOUS', 'LA', 'DE', 'DU', 'ET', 'A', 'N', 'U', ''):
                    # Sauf pour le pattern "Zones a urbaniser" qui n'a pas de groupe
                    if not (found_zone == '' and 'urbaniser' in match.group(0).lower()):
                        continue
                # Si c'est une zone DIFFERENTE de la notre, c'est la fin
                if found_zone != zone_upper:
                    # Verifier que ce n'est pas une ligne de sommaire
                    line_start = text.rfind('\n', 0, match.start()) + 1
                    line_end = text.find('\n', match.end())
                    if line_end == -1:
                        line_end = len(text)
                    line = text[line_start:line_end].strip()
                    if not is_toc_line(line):
                        end_page = page_idx
                        break
            if end_page < len(pages_text):
                break
        if end_page < len(pages_text):
            break

    # Extraire le texte de la section
    zone_pages = list(range(start_page, end_page))
    zone_text = "\n\n".join(pages_text[start_page:end_page])
    return zone_text, zone_pages


def find_general_provisions(pages_text: list[str]) -> tuple[str, list[int]]:
    """Trouve et extrait les dispositions generales / reglement commun du PLU.

    Ces sections contiennent les regles communes a toutes les zones :
    hauteur, stationnement, espaces verts, emprise au sol, etc.
    """
    # Patterns pour trouver le debut des dispositions generales
    general_start_patterns = [
        re.compile(r'R[eè]glement\s+de\s+zone\s+applicable\s+[àa]\s+l.ensemble', re.IGNORECASE),
        re.compile(r'Partie\s+4[.\s]*R[eè]glement\s+de\s+zone', re.IGNORECASE),
        re.compile(r'DISPOSITIONS\s+G[EÉ]N[EÉ]RALES\s+APPLICABLES\s+[AÀ]\s+TOUTES\s+LES\s+ZONES', re.IGNORECASE),
        re.compile(r'DISPOSITIONS\s+COMMUNES\s+[AÀ]\s+TOUTES\s+LES\s+ZONES', re.IGNORECASE),
        re.compile(r'R[EÈ]GLES\s+COMMUNES\s+[AÀ]\s+TOUTES\s+LES\s+ZONES', re.IGNORECASE),
        re.compile(r'TITRE\s+[IV0-9]+[.\s\-:]+DISPOSITIONS\s+G[EÉ]N[EÉ]RALES', re.IGNORECASE),
        re.compile(r'TITRE\s+[IV0-9]+[.\s\-:]+DISPOSITIONS\s+COMMUNES', re.IGNORECASE),
        re.compile(r'TITRE\s+[IV0-9]+[.\s\-:]+R[EÈ]GLES\s+COMMUNES', re.IGNORECASE),
        re.compile(r'(?:CHAPITRE|PARTIE)\s+[IV0-9]+[.\s\-:]+DISPOSITIONS\s+G[EÉ]N[EÉ]RALES', re.IGNORECASE),
    ]

    # Patterns pour trouver la fin (debut des zones specifiques)
    zones_start_patterns = [
        re.compile(r'DISPOSITIONS\s+APPLICABLES\s+AUX\s+ZONES', re.IGNORECASE),
        re.compile(r'Partie\s+5[.\s]', re.IGNORECASE),
        re.compile(r'TITRE\s+[IV0-9]+[.\s\-:]+DISPOSITIONS\s+APPLICABLES\s+AUX\s+ZONES\s+U', re.IGNORECASE),
        re.compile(r'^\s*ZONE\s+U[A-Z]?\s*$', re.IGNORECASE | re.MULTILINE),
    ]

    start_page = -1
    for page_idx, text in enumerate(pages_text):
        if is_toc_page(text):
            continue
        for pattern in general_start_patterns:
            match = pattern.search(text)
            if match:
                line_start = text.rfind('\n', 0, match.start()) + 1
                line_end = text.find('\n', match.end())
                if line_end == -1:
                    line_end = len(text)
                line = text[line_start:line_end]
                if not is_toc_line(line):
                    start_page = page_idx
                    break
        if start_page >= 0:
            break

    if start_page < 0:
        return "", []

    # Trouver la fin des dispositions generales
    end_page = min(start_page + 40, len(pages_text))  # Max 40 pages de dispositions generales
    for page_idx in range(start_page + 2, len(pages_text)):
        text = pages_text[page_idx]
        if is_toc_page(text):
            continue
        for pattern in zones_start_patterns:
            match = pattern.search(text)
            if match:
                line_start = text.rfind('\n', 0, match.start()) + 1
                line_end = text.find('\n', match.end())
                if line_end == -1:
                    line_end = len(text)
                line = text[line_start:line_end]
                if not is_toc_line(line):
                    end_page = page_idx
                    break
        if end_page < min(start_page + 40, len(pages_text)):
            break

    pages = list(range(start_page, end_page))
    text = "\n\n".join(pages_text[start_page:end_page])
    return text, pages


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/extract", response_model=ExtractResponse)
async def extract_zone(req: ExtractRequest):
    # Nettoyer l'URL (enlever #page=XX)
    pdf_url = req.pdf_url.split('#')[0]
    page_hint = req.page_hint or 0

    # Extraire page_hint depuis l'URL si present
    if '#page=' in req.pdf_url and not req.page_hint:
        try:
            page_hint = int(req.pdf_url.split('#page=')[1])
        except (ValueError, IndexError):
            pass

    # Telecharger le PDF
    try:
        async with httpx.AsyncClient(timeout=180.0) as client:
            resp = await client.get(pdf_url)
            resp.raise_for_status()
            pdf_bytes = resp.content
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Erreur telechargement PDF: {e}")

    # Extraire le texte page par page avec PyMuPDF
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        pages_text = []
        for page in doc:
            pages_text.append(page.get_text())
        total_pages = len(pages_text)
        doc.close()
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Erreur lecture PDF: {e}")

    # Trouver la section de la zone + dispositions generales
    zone_text, zone_pages = find_zone_section(pages_text, req.zone_code, page_hint)
    general_text, general_pages = find_general_provisions(pages_text)

    # Limiter la taille (Gemini a une limite de tokens)
    max_chars = 400_000  # ~100K tokens
    if len(zone_text) > max_chars:
        zone_text = zone_text[:max_chars] + "\n\n[... texte tronque ...]"
    remaining = max_chars - len(zone_text)
    if len(general_text) > remaining:
        general_text = general_text[:remaining] + "\n\n[... texte tronque ...]"

    return ExtractResponse(
        zone_text=zone_text,
        general_text=general_text,
        total_pages=total_pages,
        zone_pages=[p + 1 for p in zone_pages],
        general_pages=[p + 1 for p in general_pages],
        full_text_length=sum(len(t) for t in pages_text),
        zone_text_length=len(zone_text),
        general_text_length=len(general_text),
    )
