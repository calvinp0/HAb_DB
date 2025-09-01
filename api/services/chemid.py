from typing import Optional, List
import re
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


def _safe_smiles_no_h(smiles: Optional[str]) -> Optional[str]:
    if not smiles:
        return None
    try:
        return smiles_without_explicit_h(smiles)
    except Exception:
        # worst case, just return the original
        return smiles
