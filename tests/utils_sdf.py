from pathlib import Path
from typing import List, Iterable
from rdkit import Chem


def read_mols(sdf_path: Path) -> List[Chem.Mol]:
    suppl = Chem.SDMolSupplier(str(sdf_path), sanitize=True, removeHs=False)
    mols = [m for m in suppl if m is not None]
    if not mols:
        raise ValueError(f"No molecules parsed from {sdf_path}")
    return mols


def write_mols(sdf_path: Path, mols: Iterable[Chem.Mol]) -> Path:
    w = Chem.SDWriter(str(sdf_path))
    # Ensure props are saved; RDKit writes all string props by default.
    for m in mols:
        w.write(m)
    w.close()
    return sdf_path


def set_prop(m: Chem.Mol, key: str, value: str) -> None:
    # RDKit SDF props are strings
    m.SetProp(key, value)


def del_prop(m: Chem.Mol, key: str) -> None:
    if m.HasProp(key):
        m.ClearProp(key)
