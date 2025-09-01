# services/cactus.py
from __future__ import annotations
from typing import Optional, List
from urllib.parse import quote
import requests
from db.services.http import get, DEFAULT_TIMEOUT
from functools import lru_cache

CACTUS_BASE_URL = "https://cactus.nci.nih.gov/chemical/structure"


def cactus_resolver(
    identifier: str, representation: str, timeout: tuple[float, float] | None = None
) -> Optional[str]:
    safe_id = quote(identifier, safe="")
    url = f"{CACTUS_BASE_URL}/{safe_id}/{representation}"
    try:
        r = get(url, timeout=timeout or DEFAULT_TIMEOUT)
    except requests.RequestException:
        # SSL/EOF/connection resets → treat as miss
        return None

    body = (r.text or "").strip()
    # Known oddity: 500 with a 404 page → treat as miss
    if r.status_code == 404 or "Page not found (404)" in body:
        return None
    if r.status_code >= 500:
        return None
    if r.status_code != 200:
        return None
    return body


@lru_cache(maxsize=10000)
def cactus_name_by_identifier(identifier: str) -> List[str]:
    try:
        names = cactus_resolver(identifier, "names") or ""
        out = [ln.strip() for ln in names.splitlines() if ln.strip()]
        iupac = cactus_resolver(identifier, "iupac_name")
        if iupac and iupac not in out:
            out = [iupac] + out
        # de-dup preserving order
        seen, dedup = set(), []
        for n in out:
            k = n.lower()
            if k in seen:
                continue
            seen.add(k)
            dedup.append(n)
        return dedup
    except Exception:
        # absolutely never propagate
        return []
