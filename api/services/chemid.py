from typing import Optional, List
import re
import time
import requests
from rdkit import Chem

INCHIKEY_RE = re.compile(r"^[A-Z]{14}-[A-Z]{10}-[A-Z]$")


def canonical_smiles(smiles: str) -> str:
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        raise ValueError(f"Invalid SMILES string: {smiles}")

    return Chem.MolToSmiles(mol, canonical=True, isomericSmiles=True)


def validate_inchikey(inchi_key: str) -> str:
    inchi_key = inchi_key.strip().upper()
    if not INCHIKEY_RE.match(inchi_key):
        raise ValueError(f"Invalid InChI Key: {inchi_key}")
    return inchi_key


def smiles_without_explicit_h(smiles: str) -> str | None:
    """Return a hydrogen suppressed canonical smiles (no explicit [H])"""
    if not smiles:
        return None
    mol = Chem.MolFromSmiles(smiles)
    if not mol:
        return None
    mol = Chem.RemoveHs(mol)
    return Chem.MolToSmiles(mol, canonical=True, isomericSmiles=True)


class ServiceUnavailableError(RuntimeError):
    pass


try:
    from rdkit.Chem import inchi as rd_inchi

    def inchikey_from_smiles(smiles: str) -> str:
        mol = Chem.MolFromSmiles(smiles)
        if mol is None:
            raise ValueError(f"Invalid SMILES string: {smiles}")
        return rd_inchi.MolToInchiKey(mol)

except Exception as e:
    rd_inchi = None

    def inchikey_from_smiles(smiles: str) -> None:
        return None


def looks_like_inchikey(s: str) -> bool:
    return bool(INCHIKEY_RE.match(s.strip().upper()))


def looks_like_inchi(s: str) -> bool:
    return s.strip().lower().startswith("inchi=")


def canonical_smiles_no_stereo(smiles: str) -> str:
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        raise ValueError(f"Invalid SMILES string: {smiles}")
    Chem.RemoveStereochemistry(mol)
    return Chem.MolToSmiles(mol, canonical=True, isomericSmiles=True)


def _safe_smiles_no_h(smiles: Optional[str]) -> Optional[str]:
    if not smiles:
        return None
    try:
        return smiles_without_explicit_h(smiles)
    except Exception:
        # worst case, just return the original
        return smiles


def adjlist_from_smiles(
    smiles: str, max_retries: int = 3, timeout: int = 10
) -> Optional[str]:
    """Fetch an RMG adjacency list for the provided SMILES via rmg.mit.edu."""
    if not smiles:
        return None

    url = f"https://rmg.mit.edu/adjacencylist/{smiles}"
    headers = {
        "User-Agent": "HAb-DB/1.0 (adjacency fetch)",
        "Accept": "text/plain",
        "Referer": "https://rmg.mit.edu/molecule_search",
    }
    last_exc: Optional[Exception] = None

    for attempt in range(max_retries):
        try:
            resp = requests.get(url, headers=headers, timeout=timeout)
            if resp.status_code == 200:
                return resp.text
            if resp.status_code in {429, 502, 503, 504}:
                last_exc = RuntimeError(
                    f"RMG service temporarily unavailable (HTTP {resp.status_code})"
                )
            else:
                return None
        except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as e:
            last_exc = e
        except requests.exceptions.RequestException as e:
            last_exc = e

        if attempt < max_retries - 1:
            time.sleep(2**attempt)
        else:
            break

    if last_exc:
        raise ServiceUnavailableError(str(last_exc))
    return None
