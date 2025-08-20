from __future__ import annotations

import argparse
import ast
import csv
import math
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

from sqlalchemy import select, func
from sqlalchemy.orm import Session
from sqlalchemy.dialects.postgresql import insert as pg_insert
from db.engine import session_scope, exec_sql
from db.models import (
    IngestBatch,
    Reaction,
    Molecule,
    Atom,
    AtomRoleMap,
    GeomDistance,
    GeomAngle,
    GeomDihedral,
    KineticsSet,
)
from db.utils import geom_hash
from ingest.sdf_reader import iter_triplets
from rdkit import Chem
from rdkit.Chem import Descriptors

ROLE_MAP = {"r1h": "R1H", "r2h": "R2H", "ts": "TS"}
FRAME_MAP = {"R1H": "ref_d_hydrogen", "R2H": "ref_a_hydrogen", "TS": "none"}

# -------------------------- CSV helpers --------------------------


def _flt(s: Optional[str]) -> Optional[float]:
    if s is None:
        return None
    ss = str(s).strip()
    if not ss or ss.lower() == "null":
        return None
    try:
        return float(ss)
    except Exception:
        return None


def _int(s: Optional[str]) -> Optional[int]:
    f = _flt(s)
    return None if f is None else int(round(f))


def _parse_path(s: Optional[str]) -> Optional[Sequence[int]]:
    if s is None or not str(s).strip():
        return None
    try:
        v = ast.literal_eval(s)
        if isinstance(v, (list, tuple)) and all(isinstance(x, (int, float)) for x in v):
            return [int(x) for x in v]
    except Exception:
        return None
    return None


def _index_csv(csv_path: Path) -> Dict[str, Dict[str, Dict[int, dict]]]:
    """Index CSV by reaction → role (R1H/R2H/TS) → focus_atom_idx → row dict."""
    idx: Dict[str, Dict[str, Dict[int, dict]]] = {}
    with csv_path.open("r", encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            rxn_id = (row.get("rxn_id") or "").strip()
            mt = (row.get("mol_type") or "").strip().lower()
            if not rxn_id or mt not in ROLE_MAP:
                continue
            role = ROLE_MAP[mt]
            ai = _int(row.get("focus_atom_idx"))
            if ai is None:
                continue
            idx.setdefault(rxn_id, {}).setdefault(role, {})[ai] = row
    return idx


# ------------------------- Kinetics CSV --------------------------
def _parse_float(s):
    if s is None:
        return None
    ss = str(s).strip()
    if not ss:
        return None
    try:
        return float(ss)
    except Exception as e:
        print(f"Failed to parse float from '{s}': {e}")
        return None


def _parse_temp_K(s):
    # Accepts "300.0 K" or "300" or "300K"
    if s is None:
        return None
    ss = str(s).strip().lower().replace(" ", "")
    if ss.endswith("k"):
        ss = ss[:-1]
    try:
        return float(ss)
    except Exception as e:
        print(f"Failed to parse temperature from '{s}': {e}")
        return None


def _direction_and_model(label: str):
    """
    e.g. "k_rev (TST)" -> ("reverse", "TST"); "k_for (TST+T)" -> ("forward", "TST+T")
    """
    lab = (label or "").strip().lower()
    direction = (
        "forward"
        if lab.startswith("k_for")
        else "reverse" if lab.startswith("k_rev") else "unknown"
    )
    model = None
    if "(" in label and ")" in label:
        model = label[label.find("(") + 1 : label.rfind(")")].strip() or None
    if not model:
        model = "unknown"
    return direction, model


def _index_kinetics_csv_rmg(csv_path: Path) -> Dict[str, list[dict]]:
    """
    Index byu reaction_name (reaction_label) -> list of normalized rows matching KineticSet.
    Input columns expect:
        reaction_label, label, A, A_units, n, Ea, Ea_units, T0, Tmin, Tmax, dA, dn, dEa, source_comment
    """
    idx: dict[str, list[dict]] = {}
    with csv_path.open("r", encoding="utf-8", newline="") as fh:
        r = csv.DictReader(fh)
        for row in r:
            rxn = (row.get("reaction_label") or "").strip()
            if not rxn:
                continue

            direction, model = _direction_and_model(row.get("label"))
            if direction == "unknown":
                print(f"Skipping kinetics row with unknown direction: {row}")
                continue

            A = _parse_float(row.get("A"))
            n = _parse_float(row.get("n"))
            Ea = _parse_float(row.get("Ea"))
            Tmin = _parse_temp_K(row.get("Tmin"))
            Tmax = _parse_temp_K(row.get("Tmax"))
            T0 = _parse_temp_K(row.get("T0"))

            dA = _parse_float(row.get("dA"))
            dn = _parse_float(row.get("dn"))
            dEa = _parse_float(row.get("dEa"))

            meta = {
                "A_units": row.get("A_units", "").strip(),
                "Ea_units": row.get("Ea_units", "").strip(),
                "T0": row.get("T0", "").strip(),
                "label_raw": row.get("label", "").strip(),
                "source_comment": row.get("source_comment", "").strip(),
            }

            norm = {
                "direction": direction,
                "model": model or "ModifiedArrhenius",
                "A": A,
                "n": n,
                "Ea_kJ_mol": Ea,
                "Tmin_K": Tmin,
                "Tmax_K": Tmax,
                "source": "arrhenius_csv",
                "reference": None,
                "computed_from": None,
                "dA_factor": dA,
                "dn_abs": dn,
                "dEa_kJ_mol": dEa,
                "meta": meta,
            }
            idx.setdefault(rxn, []).append(norm)
    return idx


def _merge_kinetics(session: Session, reaction_id: int, row: dict):
    # match the UniqueConstraint on kinetics_set
    q = select(KineticsSet).where(
        KineticsSet.reaction_id == reaction_id,
        KineticsSet.direction == row["direction"],
        KineticsSet.source == row.get("source"),
        KineticsSet.reference == row.get("reference"),
        KineticsSet.Tmin_K == row.get("Tmin_K"),
        KineticsSet.Tmax_K == row.get("Tmax_K"),
    )
    existing = session.scalar(q)
    if existing:
        # update in-place (best-effort)
        for k in (
            "model",
            "A",
            "n",
            "Ea_kJ_mol",
            "computed_from",
            "dA_factor",
            "dn_abs",
            "dEa_kJ_mol",
            "meta",
        ):
            v = row.get(k)
            if v is not None:
                setattr(existing, k, v)
        return existing

    ks = KineticsSet(
        reaction_id=reaction_id,
        direction=row["direction"],
        model=row.get("model") or "ModifiedArrhenius",
        A=row["A"],
        n=row.get("n"),
        Ea_kJ_mol=row["Ea_kJ_mol"],
        Tmin_K=row["Tmin_K"],
        Tmax_K=row["Tmax_K"],
        source=row.get("source"),
        reference=row.get("reference"),
        computed_from=row.get("computed_from"),
        dA_factor=row.get("dA_factor"),
        dn_abs=row.get("dn_abs"),
        dEa_kJ_mol=row.get("dEa_kJ_mol"),
        meta=row.get("meta"),
    )
    session.add(ks)
    return ks


# -------------------------- role labels --------------------------


def _norm_label(lbl: str) -> str:
    return {"donator": "donor"}.get(lbl.lower(), lbl.lower())


def _mol_properties_to_roles(mp: Dict[str, dict]) -> Dict[int, str]:
    out: Dict[int, str] = {}
    for k, v in mp.items():
        try:
            i = int(k)
        except Exception:
            continue
        lab = _norm_label(str(v.get("label", "")))
        if lab:
            out[i] = lab
    return out


def _ensure_rdkit():
    # no-op if already installed
    try:
        exec_sql("CREATE EXTENSION IF NOT EXISTS rdkit;")
    except Exception:
        # If you don’t have SUPERUSER, leave it manual:
        # docker compose exec db psql -U chem -d hab_db -c "CREATE EXTENSION rdkit;"
        pass


def enrich_molecule(mol, mol_record, reaction):
    """Create a Molecule ORM row with RDKit-enriched props."""
    return Molecule(
        reaction=reaction,
        role=mol_record.role,
        mol=Chem.MolToSmiles(mol),
        smiles=Chem.MolToSmiles(mol),
        inchikey=Chem.MolToInchiKey(mol),
        charge=Chem.GetFormalCharge(mol),
        spin_mult=Chem.Descriptors.NumRadicalElectrons(mol) + 1,
        mw=Descriptors.MolWt(mol),
        props=mol_record.props,
        source_file=mol_record.reaction_name,
        record_index=mol_record.record_index,
    )


# -------------------------- Upsert ------------------------------
def upsert_molecule(
    session,
    reaction_id: int,
    role: str,
    smiles: str,
    inchikey: str,
    charge: int,
    spin_mult: int,
    mw: float,
    props: dict,
    source_file: str | None,
    record_index: int | None,
    ghash: str | None,
):
    """
    UPSERT into molecule on (reaction_id, role) and return molecule_id.
    Assumes Molecule.mol is RDKit 'mol' type; create from SMILES.
    """
    tbl = Molecule.__table__
    stmt = (
        pg_insert(Molecule.__table__)
        .values(
            reaction_id=reaction_id,
            role=role,
            record_index=record_index,
            mol=func.mol_from_smiles(smiles),
            smiles=smiles,
            inchikey=inchikey,
            charge=charge,
            spin_mult=spin_mult,
            mw=mw,
            props=props,
            source_file=source_file,
            geometry_hash=ghash,
        )
        # conflict target must match the UNIQUE constraint:
        .on_conflict_do_update(
            index_elements=["reaction_id", "role", "geometry_hash"],
            set_={
                "mol": func.mol_from_smiles(smiles),
                "smiles": smiles,
                "inchikey": inchikey,
                "charge": charge,
                "spin_mult": spin_mult,
                "mw": mw,
                "props": props,
                "source_file": source_file,
                "record_index": record_index,
                "updated_at": func.now(),
                "geometry_hash": ghash,
            },
        )
        .returning(Molecule.__table__.c.molecule_id)
    )
    return session.scalar(stmt)


# -------------------------- core load ----------------------------


def load_all(
    sdf_path: Path,
    source_label: str,
    csv_path: Optional[Path] = None,
    mirror_geom_from_csv: bool = False,
    csv_angles_are_deg: bool = False,
    strict_roles: bool = True,
    sanitize: bool = True,
    kinetics_csv: Optional[Path] = None,
    reuse_batch: bool = False,
    dry_run: bool = False,
) -> None:
    stats = {
        "reactions_seen": 0,
        "molecules_upserted": 0,
        "atoms_inserted": 0,
        "kinetics_rows": 0,
        "csv_atoms_matched": 0,
        "csv_atoms_missing": 0,
    }
    csv_index = _index_csv(csv_path) if csv_path else {}
    kin_index = _index_kinetics_csv_rmg(kinetics_csv) if kinetics_csv else {}
    _ensure_rdkit()

    with session_scope() as session:
        if not dry_run:
            if reuse_batch:
                batch = session.scalar(
                    select(IngestBatch).where(IngestBatch.source_label == source_label)
                )
                if not batch:
                    batch = IngestBatch(
                        source_label=source_label, notes=f"SDF: {sdf_path}"
                    )
                    session.add(batch)
                    session.flush()
            else:
                batch = IngestBatch(source_label=source_label, notes=f"SDF: {sdf_path}")
                session.add(batch)
                session.flush()
        else:
            batch = None

        for trip in iter_triplets(
            sdf_path, strict_roles=strict_roles, sanitize=sanitize
        ):
            rxn_name = trip.reaction_name or "unnamed_rxn"

            if not dry_run:
                reaction = session.scalar(
                    select(Reaction).where(Reaction.reaction_name == rxn_name)
                )
                if not reaction:
                    reaction = Reaction(
                        reaction_name=rxn_name,
                        family="H_abstraction",
                        batch_id=(batch.batch_id if batch else None),
                    )
                    session.add(reaction)
                    session.flush()
            else:
                # simulate a minimal object with id = None
                class _R:
                    pass

                reaction = _R()
                reaction.reaction_id = -1  # sentinel

            role_to_idx2id: Dict[str, Dict[int, int]] = {}
            stats["reactions_seen"] += 1
            # Insert Molecules + Atoms (XYZ)
            for role, rec in trip.records.items():
                rmol = Chem.MolFromMolBlock(
                    rec.molblock, sanitize=sanitize, removeHs=False
                )
                if rmol is None:
                    raise ValueError(
                        f"Bad molblock at record {rec.record_index} in {sdf_path}: {rec.molblock[:100]}..."
                    )
                smiles = Chem.MolToSmiles(rmol)
                inchikey = Chem.MolToInchiKey(rmol)
                charge = Chem.GetFormalCharge(rmol)
                spin_mult = Descriptors.NumRadicalElectrons(rmol) + 1
                mw = Descriptors.MolWt(rmol)
                ghash = geom_hash(rmol)
                if not dry_run:
                    molecule_id = upsert_molecule(
                        session,
                        reaction_id=reaction.reaction_id,
                        role=rec.role,
                        smiles=smiles,
                        inchikey=inchikey,
                        charge=charge,
                        spin_mult=spin_mult,
                        mw=mw,
                        props=rec.props,
                        source_file=rec.reaction_name,
                        record_index=rec.record_index,
                        ghash=ghash,
                    )
                    stats["molecules_upserted"] += 1
                else:
                    molecule_id = -1  # simulate

                # RDKit for coordinates

                conf = rmol.GetConformer()
                idx2id: Dict[int, int] = {}
                for i, atom in enumerate(rmol.GetAtoms()):
                    if not dry_run:
                        p = conf.GetAtomPosition(i)
                        a = Atom(
                            molecule_id=molecule_id,
                            atom_idx=i,
                            atomic_num=atom.GetAtomicNum(),
                            formal_charge=atom.GetFormalCharge(),
                            is_aromatic=atom.GetIsAromatic(),
                            xyz=[p.x, p.y, p.z],
                        )
                        session.add(a)
                        session.flush()
                        idx2id[i] = a.atom_id
                        stats["atoms_inserted"] += 1
                    else:
                        idx2id[i] = -1  # simulate
                role_to_idx2id[role] = idx2id

                # AtomRoleMap from mol_properties
                mp = rec.mol_properties or {}
                for i_idx, rname in _mol_properties_to_roles(mp).items():
                    if (
                        rname in {"donor", "acceptor", "d_hydrogen", "a_hydrogen"}
                        and not dry_run
                    ):
                        session.add(AtomRoleMap(atom_id=idx2id.get(i_idx), role=rname))

            for row in kin_index.get(rxn_name, []):
                if not dry_run:
                    try:
                        _merge_kinetics(session, reaction.reaction_id, row)
                        stats["kinetics_rows"] += 1
                    except Exception:
                        pass
                else:
                    stats["kinetics_rows"] += 1  # counted

            # Merge CSV rows for this reaction (if provided)
            if rxn_name in csv_index:
                per_role = csv_index[rxn_name]
                for role, idx2id in role_to_idx2id.items():
                    rows = per_role.get(role, {})
                    for atom_idx in idx2id:
                        if atom_idx in rows:
                            stats["csv_atoms_matched"] += 1
                        else:
                            stats["csv_atoms_missing"] += 1

                    frame = FRAME_MAP[role]
                    for atom_idx, atom_id in idx2id.items():
                        row = rows.get(atom_idx)
                        if not row:
                            continue
                        # Update Atom numeric fields
                        atom = session.get(Atom, atom_id)
                        atom.q_mull = _flt(row.get("q_mull"))
                        atom.q_apt = _flt(row.get("q_apt"))
                        atom.spin = _int(row.get("spin"))
                        atom.Z = _int(row.get("Z"))
                        atom.mass = _flt(row.get("mass"))
                        atom.f_mag = _flt(row.get("f_mag"))

                        if mirror_geom_from_csv and not dry_run:
                            path = _parse_path(row.get("path"))
                            radius = _flt(row.get("radius"))
                            angle_v = _flt(row.get("angle"))
                            dihed_v = _flt(row.get("dihedral"))

                            def _deg(x: Optional[float]) -> Optional[float]:
                                if x is None:
                                    return None
                                return (
                                    x if csv_angles_are_deg else (x * 180.0 / math.pi)
                                )

                            if path and len(path) == 2 and radius is not None:
                                a1 = role_to_idx2id[role].get(path[0])
                                a2 = role_to_idx2id[role].get(path[1])
                                if a1 and a2:
                                    session.add(
                                        GeomDistance(
                                            molecule_id=session.get(
                                                Atom, a1
                                            ).molecule_id,  # same molecule
                                            frame=frame,
                                            a1_id=a1,
                                            a2_id=a2,
                                            value_ang=radius,
                                            measure_name="csv_radius",
                                            feature_ver="csv_v1",
                                        )
                                    )

                            if path and len(path) == 3 and angle_v is not None:
                                a1 = role_to_idx2id[role].get(path[0])
                                a2 = role_to_idx2id[role].get(path[1])
                                a3 = role_to_idx2id[role].get(path[2])
                                if a1 and a2 and a3:
                                    session.add(
                                        GeomAngle(
                                            molecule_id=session.get(
                                                Atom, a1
                                            ).molecule_id,
                                            frame=frame,
                                            a1_id=a1,
                                            a2_id=a2,
                                            a3_id=a3,
                                            value_deg=_deg(angle_v),
                                            measure_name="csv_angle",
                                            feature_ver="csv_v1",
                                        )
                                    )

                            if path and len(path) == 4 and dihed_v is not None:
                                a1 = role_to_idx2id[role].get(path[0])
                                a2 = role_to_idx2id[role].get(path[1])
                                a3 = role_to_idx2id[role].get(path[2])
                                a4 = role_to_idx2id[role].get(path[3])
                                if a1 and a2 and a3 and a4:
                                    session.add(
                                        GeomDihedral(
                                            molecule_id=session.get(
                                                Atom, a1
                                            ).molecule_id,
                                            frame=frame,
                                            a1_id=a1,
                                            a2_id=a2,
                                            a3_id=a3,
                                            a4_id=a4,
                                            value_deg=_deg(dihed_v),
                                            measure_name="csv_dihedral",
                                            feature_ver="csv_v1",
                                        )
                                    )

            # Commit per reaction
            if not dry_run:
                session.commit()
    if dry_run:
        print(
            f"[DRY-RUN] reactions={stats['reactions_seen']}  "
            f"molecules={stats['molecules_upserted']}  atoms={stats['atoms_inserted']}  "
            f"kinetics={stats['kinetics_rows']}  "
            f"csv_matched={stats['csv_atoms_matched']} csv_missing={stats['csv_atoms_missing']}"
        )
    else:
        print(f"Loaded: SDF={sdf_path} ; CSV={'none' if not csv_path else csv_path}")


def main():
    p = argparse.ArgumentParser(
        description="Load SDF triplets (+ optional CSV) into the DB in one pass."
    )
    p.add_argument(
        "--sdf", required=True, type=Path, help="Path to SDF with triplets (R1H,R2H,TS)"
    )
    p.add_argument(
        "--source-label", required=True, help="Provenance label stored in ingest_batch"
    )
    p.add_argument("--csv", type=Path, help="Optional CSV with per-atom features")
    p.add_argument(
        "--mirror-geom-from-csv",
        action="store_true",
        help="Insert CSV path/angle/dihedral into Geom* tables",
    )
    p.add_argument(
        "--csv-angles-are-deg",
        action="store_true",
        help="If set, CSV angle/dihedral are degrees (default radians)",
    )
    p.add_argument(
        "--no-strict-roles",
        dest="strict_roles",
        action="store_false",
        help="Disable strict role enforcement; fall back to position",
        default=True,
    )
    p.add_argument(
        "--no-sanitize",
        dest="sanitize",
        action="store_false",
        help="Disable RDKit sanitization on molblocks when extracting XYZ",
        default=True,
    )
    p.add_argument(
        "--reuse-batch",
        action="store_true",
        help="If set, reuse an existing ingest_batch with the same source_label.",
    )
    p.add_argument(
        "--kinetics-csv",
        type=Path,
        help="Optional CSV with Arrhenius data per reaction/direction",
    )
    p.add_argument(
        "--dry-run", action="store_true", help="Parse & validate only; no DB writes"
    )
    args = p.parse_args()

    load_all(
        sdf_path=args.sdf,
        source_label=args.source_label,
        csv_path=args.csv,
        mirror_geom_from_csv=args.mirror_geom_from_csv,
        csv_angles_are_deg=args.csv_angles_are_deg,
        strict_roles=args.strict_roles,
        sanitize=args.sanitize,
        kinetics_csv=args.kinetics_csv,
        reuse_batch=args.reuse_batch,
        dry_run=args.dry_run,
    )


if __name__ == "__main__":
    main()
