import requests
from typing import Optional
from db.services.http import get, DEFAULT_TIMEOUT


def opsin_iupac_from_smiles(smiles: str) -> Optional[str]:
    # OPSIN name generation (best-effort IUPAC/systematic)
    # Note: OPSIN is officially name→structure; the SMILES→name endpoint is heuristic (AMBIGUOUS).
    url = f"https://opsin.ch.cam.ac.uk/opsin/{requests.utils.quote(smiles)}.json"
    try:
        r = get(url, timeout=DEFAULT_TIMEOUT)
        r.raise_for_status()
        js = r.json()
        # Some deployments provide "name", some not for SMILES; fallback to None
        return js.get("name")
    except Exception:
        return None
