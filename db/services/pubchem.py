import requests
from typing import Optional
from db.services.http import get, DEFAULT_TIMEOUT
from functools import lru_cache

PUBCHEM_BASE = "https://pubchem.ncbi.nlm.nih.gov/rest/pug"


@lru_cache(maxsize=10000)
def pubchem_by_inchikey(inchikey: str) -> dict | None:
    # Synonyms (often includes common names & IUPAC)
    syn_url = f"{PUBCHEM_BASE}/compound/inchikey/{inchikey}/synonyms/JSON"
    props_url = f"{PUBCHEM_BASE}/compound/inchikey/{inchikey}/property/IUPACName,IsomericSMILES/JSON"
    try:
        syn = get(syn_url, timeout=DEFAULT_TIMEOUT)
        syn.raise_for_status()
        props = get(props_url, timeout=DEFAULT_TIMEOUT)
        props.raise_for_status()
        out = {"synonyms": [], "iupac": None, "cid": None}
        js_syn = syn.json()
        if js_syn.get("InformationList", {}).get("Information"):
            info = js_syn["InformationList"]["Information"][0]
            out["synonyms"] = info.get("Synonym", [])
            out["cid"] = info.get("CID")
        js_props = props.json()
        recs = js_props.get("PropertyTable", {}).get("Properties", [])
        if recs:
            out["iupac"] = recs[0].get("IUPACName")
        return out
    except Exception:
        return None
