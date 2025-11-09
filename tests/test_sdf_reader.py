# tests/test_sdf_reader.py
from pathlib import Path

import pytest
from rdkit import Chem

from ingest.sdf_reader import iter_triplets
from tests.utils_sdf import read_mols, write_mols, set_prop, del_prop


def _augment_with_r1_r2(r1h, r2h):
    r1 = Chem.Mol(r1h)
    r1.SetProp("type", "R1")
    r2 = Chem.Mol(r2h)
    r2.SetProp("type", "R2")
    return r1, r2


def test_order_independent_when_types_present(tmp_path: Path):
    src = Path(__file__).parent / "sample.sdf"
    r1h, r2h, ts = read_mols(src)  # parse valid SDF
    r1, r2 = _augment_with_r1_r2(r1h, r2h)
    # Keep <type> props; just reorder molecules
    dst = write_mols(tmp_path / "case.sdf", [ts, r1h, r2, r1, r2h])
    trips = list(iter_triplets(dst, strict_roles=True, sanitize=True))
    assert len(trips) == 1
    assert set(trips[0].records.keys()) == {"R1H", "R2H", "TS", "R1", "R2"}


def test_missing_type_in_strict_mode_errors(tmp_path: Path):
    src = Path(__file__).parent / "sample.sdf"
    r1h, r2h, ts = read_mols(src)
    r1, r2 = _augment_with_r1_r2(r1h, r2h)
    del_prop(r2h, "type")  # remove the role marker safely
    dst = write_mols(tmp_path / "case.sdf", [r1h, r2h, ts, r1, r2])
    with pytest.raises(ValueError):
        list(iter_triplets(dst, strict_roles=True, sanitize=True))


def test_fallback_to_position_when_not_strict(tmp_path: Path):
    src = Path(__file__).parent / "sample.sdf"
    r1h, r2h, ts = read_mols(src)
    r1, r2 = _augment_with_r1_r2(r1h, r2h)
    for m in (r1h, r2h, ts):
        del_prop(m, "type")  # no explicit roles
    for m in (r1, r2):
        del_prop(m, "type")
    # positional R1H,R2H,TS,R1,R2
    dst = write_mols(tmp_path / "case.sdf", [r1h, r2h, ts, r1, r2])
    trips = list(iter_triplets(dst, strict_roles=False, sanitize=True))
    assert len(trips) == 1
    assert set(trips[0].records.keys()) == {"R1H", "R2H", "TS", "R1", "R2"}


def test_duplicate_role_detected(tmp_path: Path):
    src = Path(__file__).parent / "sample.sdf"
    r1h, r2h, ts = read_mols(src)
    r1, r2 = _augment_with_r1_r2(r1h, r2h)
    set_prop(r2h, "type", "r1h")  # make a duplicate role
    dst = write_mols(tmp_path / "case.sdf", [r1h, r2h, ts, r1, r2])
    with pytest.raises(ValueError):
        list(iter_triplets(dst, strict_roles=True, sanitize=True))


def test_incomplete_triplet_errors(tmp_path: Path):
    src = Path(__file__).parent / "sample.sdf"
    r1h, r2h, ts = read_mols(src)
    r1, _ = _augment_with_r1_r2(r1h, r2h)
    dst = write_mols(tmp_path / "case.sdf", [r1h, r2h, r1])  # missing TS and R2
    with pytest.raises(ValueError):
        list(iter_triplets(dst, strict_roles=True, sanitize=True))
