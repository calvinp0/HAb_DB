# tests/test_sdf_reader.py
from pathlib import Path
import pytest
from ingest.sdf_reader import iter_triplets, peek_first_triplet
from tests.utils_sdf import read_mols, write_mols, set_prop, del_prop


def test_order_independent_when_types_present(tmp_path: Path):
    src = Path(__file__).parent / "sample.sdf"
    r1h, r2h, ts = read_mols(src)  # parse valid SDF
    # Keep <type> props; just reorder molecules
    dst = write_mols(tmp_path / "case.sdf", [ts, r1h, r2h])
    trips = list(iter_triplets(dst, strict_roles=True, sanitize=True))
    assert len(trips) == 1
    assert set(trips[0].records.keys()) == {"R1H", "R2H", "TS"}


def test_missing_type_in_strict_mode_errors(tmp_path: Path):
    src = Path(__file__).parent / "sample.sdf"
    r1h, r2h, ts = read_mols(src)
    del_prop(r2h, "type")  # remove the role marker safely
    dst = write_mols(tmp_path / "case.sdf", [r1h, r2h, ts])
    with pytest.raises(ValueError):
        list(iter_triplets(dst, strict_roles=True, sanitize=True))


def test_fallback_to_position_when_not_strict(tmp_path: Path):
    src = Path(__file__).parent / "sample.sdf"
    r1h, r2h, ts = read_mols(src)
    for m in (r1h, r2h, ts):
        del_prop(m, "type")  # no explicit roles
    dst = write_mols(tmp_path / "case.sdf", [r1h, r2h, ts])  # positional R1H,R2H,TS
    trips = list(iter_triplets(dst, strict_roles=False, sanitize=True))
    assert len(trips) == 1
    assert set(trips[0].records.keys()) == {"R1H", "R2H", "TS"}


def test_duplicate_role_detected(tmp_path: Path):
    src = Path(__file__).parent / "sample.sdf"
    r1h, r2h, ts = read_mols(src)
    set_prop(r2h, "type", "r1h")  # make a duplicate role
    dst = write_mols(tmp_path / "case.sdf", [r1h, r2h, ts])
    with pytest.raises(ValueError):
        list(iter_triplets(dst, strict_roles=True, sanitize=True))


def test_incomplete_triplet_errors(tmp_path: Path):
    src = Path(__file__).parent / "sample.sdf"
    r1h, r2h, ts = read_mols(src)
    dst = write_mols(tmp_path / "case.sdf", [r1h, r2h])  # only two
    with pytest.raises(ValueError):
        list(iter_triplets(dst, strict_roles=True, sanitize=True))
