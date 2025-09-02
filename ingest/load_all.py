from __future__ import annotations

import argparse
import ast
import csv
import math
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

from sqlalchemy import select, func, update
from sqlalchemy.orm import Session
from sqlalchemy.dialects.postgresql import insert as pg_insert
from db.engine import session_scope, exec_sql
from db.models import (
    IngestBatch,
    ReactionParticipant,
    Reaction,
    Species,
    Conformer,
    ConformerAtom,
    AtomRoleMap,
    GeomDistance,
    GeomAngle,
    GeomDihedral,
    RateModel,
    LevelOfTheory,
    TSFeatures,
    WellFeatures,
    NASAPolynomial,
    CPCurve,
)
from db.utils import geom_hash
from ingest.sdf_reader import iter_triplets
from rdkit import Chem
from rdkit.Chem import Descriptors
from ingest.utils import (
    _composition_and_heavy_atoms,
    _extract_nasa_polynomials_with_rmse,
    _extract_cp_curve,
    _to_J_per_molK,
    map_triplet_key_atoms,
    _H_to_kJmol,
    _S_to_kJmolK,
)

ROLE_MAP = {"r1h": "R1H", "r2h": "R2H", "ts": "TS"}
FRAME_MAP = {"R1H": "ref_d_hydrogen", "R2H": "ref_a_hydrogen", "TS": "none"}
HARTREE_TO_KJ_MOL = 2625.49962
CAL_TO_KJ_MOL = 4.184
J_TO_KJ_MOL = 0.001
REQUIRED_ROLES = ("R1H", "R2H", "TS")
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


def _parse_bool(v) -> Optional[bool]:
    if v is None:
        return None
    s = str(v).strip().lower()
    if s in {"1", "true", "t", "yes", "y"}:
        return True
    if s in {"0", "false", "f", "no", "n"}:
        return False
    return None


def _parse_float_or_none(v) -> Optional[float]:
    try:
        return float(v) if v is not None and str(v).strip() != "" else None
    except Exception:
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


def reaction_fully_loaded(session, reaction_name: str) -> bool:
    rxn = session.scalar(
        select(Reaction).where(Reaction.reaction_name == reaction_name)
    )
    if not rxn:
        return False
    roles = set(
        session.scalars(
            select(ReactionParticipant.role).where(
                ReactionParticipant.reaction_id == rxn.reaction_id
            )
        )
    )
    if not all(r in roles for r in REQUIRED_ROLES):
        return False
    # ensure each participant’s conformer has atoms already
    parts = session.scalars(
        select(ReactionParticipant).where(
            ReactionParticipant.reaction_id == rxn.reaction_id
        )
    ).all()
    by_role = {p.role.upper(): p for p in parts}
    for r in REQUIRED_ROLES:
        p = by_role.get(r)
        if not p:
            return False
        n_atoms = (
            session.scalar(
                select(func.count())
                .select_from(ConformerAtom)
                .where(ConformerAtom.conformer_id == p.conformer_id)
            )
            or 0
        )
        if n_atoms == 0:
            return False
    return True


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


def _first(props: dict, *keys):
    for k in keys:
        if k in props and str(props[k]).strip() != "":
            return props[k]
    return None


def _extract_ts_fields(props: dict) -> dict:
    def first(*keys):
        for k in keys:
            if k in props and str(props[k]).strip() != "":
                return props[k]
        return None

    # Imaginary frequency: prefer explicit ts_imag_freq, else frequency_value
    imag = first("ts_imag_freq_cm1", "imag_freq_cm1", "frequency_value")
    units = (props.get("frequency_units") or "").strip().lower()
    imag_val = _parse_float_or_none(imag)
    if imag_val is not None and "freq" in (props.get("frequency_units") or "").lower():
        if units not in {"cm^-1", "cm-1", "1/cm"}:
            imag_val = None

    return {
        "imag_freq_cm1": imag_val,
        # other fields left for future, may be None
        "irc_verified": _parse_bool(first("irc_verified", "irc_ok", "irc")),
        "E_TS": _parse_float_or_none(
            first("E0_value", "E0_kJmol")
        ),  # optional absolute TS energy
    }


def _extract_well_fields(props: dict) -> dict:
    """Normalize well energetics to canonical units; compute G298 if missing."""

    # --- Explicit electronic energy (preferred if present) ---
    E_elec_units_raw = _first(props, "E_elec_units", "E_electronic_units")
    E_elec_explicit = _H_to_kJmol(
        _parse_float_or_none(_first(props, "E_elec", "E_electronic")),
        E_elec_units_raw,
    )

    if E_elec_explicit is None:
        E_elec_kj = _parse_float_or_none(
            _first(props, "E_elec_kJmol", "E_elec_kJ/mol", "E_electronic_kJmol")
        )
        if E_elec_kj is not None:
            E_elec_explicit = E_elec_kj
            E_elec_units_raw = "kJ/mol"

    # --- E0 (total 0 K internal energy = E_elec + ZPE) ---
    E0_units_raw = _first(props, "E0_units", "E_units")
    E0 = None
    E0_kj = _parse_float_or_none(
        _first(props, "E0_kJmol", "E0_kJ/mol", "E0_kJ_per_mol")
    )
    if E0_kj is not None:
        E0 = E0_kj
    else:
        E0_val = _parse_float_or_none(_first(props, "E0_value", "E0", "E_value"))
        if E0_val is not None:
            E0 = _H_to_kJmol(E0_val, E0_units_raw)

    # --- H298 ---
    H298_units_raw = _first(props, "H298_units", "enthalpy_units")
    H298 = None
    H298_kj = _parse_float_or_none(_first(props, "H298_kJmol", "H298_kJ/mol"))
    if H298_kj is not None:
        H298 = H298_kj
    else:
        H298_val = _parse_float_or_none(
            _first(props, "H298_value", "enthalpy_298", "H_298")
        )
        if H298_val is not None:
            H298 = _H_to_kJmol(H298_val, H298_units_raw)

    # --- G298 ---
    G298_units_raw = _first(props, "G298_units", "gibbs_units")
    G298 = None
    G298_kj = _parse_float_or_none(_first(props, "G298_kJmol", "G298_kJ/mol"))
    if G298_kj is not None:
        G298 = G298_kj
    else:
        G298_val = _parse_float_or_none(
            _first(props, "G298_value", "gibbs_298", "G_298")
        )
        if G298_val is not None:
            G298 = _H_to_kJmol(G298_val, G298_units_raw)

    # --- ZPE ---
    ZPE_units_raw = _first(props, "ZPE_units", "zpe_units")
    ZPE = None
    ZPE_kj = _parse_float_or_none(_first(props, "ZPE_kJmol", "ZPE_kJ/mol"))
    if ZPE_kj is not None:
        ZPE = ZPE_kj
    else:
        ZPE_val = _parse_float_or_none(
            _first(props, "ZPE", "zero_point_energy", "zero_point_kJ_mol")
        )
        if ZPE_val is not None:
            ZPE = _H_to_kJmol(ZPE_val, ZPE_units_raw)

    # --- S298 (to kJ/mol/K) ---
    S298_units_raw = _first(props, "S298_units", "entropy_units")
    S298 = None
    S298_kjmolK = _parse_float_or_none(
        _first(props, "S298_kJmol", "S298_kJ/mol")
    )  # rare, already kJ/mol
    if S298_kjmolK is not None:
        S298 = S298_kjmolK
    else:
        S298_val = _parse_float_or_none(
            _first(props, "S298", "entropy_298", "S_298", "S298_value")
        )
        if S298_val is not None:
            S298 = _S_to_kJmolK(S298_val, S298_units_raw)

    # --- Decide E_elec ---
    if E_elec_explicit is not None:
        E_elec = E_elec_explicit
        E_elec_source = "explicit"
    elif (E0 is not None) and (ZPE is not None):
        E_elec = E0 - ZPE
        E_elec_source = "inferred_from_E0_minus_ZPE"
    else:
        E_elec = None
        E_elec_source = None

    # --- G298 fallback from H and S ---
    if G298 is None and (H298 is not None) and (S298 is not None):
        G298 = H298 - 298.15 * S298
        G298_source = "backend"
        G_calc_T_K = 298.15
    else:
        G298_source = "user" if G298 is not None else None
        G_calc_T_K = None

    # --- Optional consistency note ---
    consistency_warning = None
    if (E0 is not None) and (E_elec is not None) and (ZPE is not None):
        if abs((E_elec + ZPE) - E0) > 0.5:  # kJ/mol tolerance
            consistency_warning = "E0 != E_elec + ZPE beyond 0.5 kJ/mol"

    meta = {
        "E0_kJ_mol": E0,
        "E0_units_raw": E0_units_raw,
        "E_elec_source": E_elec_source,
        "H298_units_raw": H298_units_raw,
        "G298_units_raw": G298_units_raw,
        "ZPE_units_raw": ZPE_units_raw,
        "S298_units_raw": S298_units_raw,
    }
    if G298_source:
        meta["G298_source"] = G298_source
    if G_calc_T_K is not None:
        meta["G_calc_T_K"] = G_calc_T_K
    if consistency_warning:
        meta["consistency_warning"] = consistency_warning

    return {
        "E0": E0,
        "E0_units": "kJ/mol" if E0 is not None else None,
        "E_elec": E_elec,
        "E_elec_units": "kJ/mol" if E_elec is not None else None,
        "ZPE": ZPE,
        "ZPE_units": "kJ/mol" if ZPE is not None else None,
        "H298": H298,
        "H298_units": "kJ/mol" if H298 is not None else None,
        "S298": S298,
        "S298_units": "kJ/mol/K" if S298 is not None else None,
        "G298": G298,
        "G298_units": "kJ/mol" if G298 is not None else None,
        "meta": meta,
    }


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


# unit helpers (prefer per-row units; fallback to CLI flag for legacy files)
def _angle_deg(
    val: Optional[float], units: Optional[str], csv_angles_are_deg: bool
) -> Optional[float]:
    if val is None:
        return None
    u = (units or "").strip().lower()
    if u in {"deg", "degree", "degrees"}:
        return val
    if u in {"rad", "radian", "radians"}:
        return val * 180.0 / math.pi
    # fallback to flag if units missing
    return val if csv_angles_are_deg else (val * 180.0 / math.pi)


def _radius_ang(val: Optional[float], units: Optional[str]) -> Optional[float]:
    if val is None:
        return None
    u = (units or "").strip().lower()
    if u in {"a", "ang", "angstrom", "ångström", "angstroms"}:
        return val
    if u in {"nm"}:
        return val * 10.0
    if u in {"pm"}:
        return val * 0.01
    # assume Å if missing
    return val


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


# -------------------------- Upsert ------------------------------
def upsert_nasa_polynomial(session, conformer_id: int, poly: dict):
    tbl = NASAPolynomial.__table__
    a1, a2, a3, a4, a5, a6, a7 = poly["coeffs"]
    stmt = (
        pg_insert(tbl)
        .values(
            conformer_id=conformer_id,
            form=poly["form"],
            Tmin_K=poly["Tmin_K"],
            Tmax_K=poly["Tmax_K"],
            a1=a1,
            a2=a2,
            a3=a3,
            a4=a4,
            a5=a5,
            a6=a6,
            a7=a7,
            source=poly.get("source"),
            fit_rmse=poly.get("fit_rmse"),
        )
        .on_conflict_do_update(
            index_elements=["conformer_id", "Tmin_K", "Tmax_K", "form"],
            set_={
                "a1": a1,
                "a2": a2,
                "a3": a3,
                "a4": a4,
                "a5": a5,
                "a6": a6,
                "a7": a7,
                "source": poly.get("source"),
                "fit_rmse": poly.get("fit_rmse"),
                "updated_at": func.now(),
            },
        )
    )
    session.execute(stmt)


def upsert_species(
    session,
    smiles: str | None,
    inchikey: str | None,
    charge: int | None,
    spin_mult: int | None,
    mw: float | None,
    props: dict | None,
    elements_json: dict | None = None,
    heavy_atoms: int | None = None,
):
    # choose a stable identity key; inchikey if present, else (smiles, charge, spin_mult)
    q = (
        select(Species).where(Species.inchikey == inchikey)
        if inchikey
        else select(Species).where(
            Species.smiles == smiles,
            Species.charge == charge,
            Species.spin_multiplicity == spin_mult,
        )
    )
    sp = session.scalar(q)
    if sp:
        # best-effort enrich (only set when we have a non-None value)
        enrich = dict(
            smiles=smiles,
            mw=mw,
            props=props,
            elements_json=elements_json,
            heavy_atoms=heavy_atoms,
        )
        for k, v in enrich.items():
            if v is not None:
                setattr(sp, k, v)
        return sp.species_id

    sp = Species(
        smiles=smiles,
        inchikey=inchikey,
        charge=charge,
        spin_multiplicity=spin_mult,
        mw=mw,
        props=props,
        elements_json=elements_json,
        heavy_atoms=heavy_atoms,
    )
    session.add(sp)
    session.flush()
    return sp.species_id


def upsert_conformer(
    session: Session,
    species_id: int,
    lot_id: int,
    mol_rdkit_smiles: str,
    geometry_hash: str,
    well_label: str | None,
    is_ts: bool,
):
    tbl = Conformer.__table__

    # 1) Try insert; if conflict, do nothing.
    ins = (
        pg_insert(tbl)
        .values(
            species_id=species_id,
            lot_id=lot_id,
            geometry_hash=geometry_hash,
            well_label=well_label,
            is_ts=is_ts,
            mol=func.mol_from_smiles(mol_rdkit_smiles),
        )
        .on_conflict_do_nothing(constraint="uq_conformer_geom")
        .returning(tbl.c.conformer_id)
    )
    res = session.execute(ins).first()

    if res:
        # Fresh insert
        return res[0], False  # (conformer_id, merged=False)

    # 2) Conflict path → update the existing row and fetch its id
    upd = (
        update(tbl)
        .where(
            tbl.c.species_id == species_id,
            tbl.c.geometry_hash == geometry_hash,
            tbl.c.lot_id == lot_id,
        )
        .values(
            well_label=well_label,
            is_ts=is_ts,
            mol=func.mol_from_smiles(mol_rdkit_smiles),
            updated_at=func.now(),
        )
        .returning(tbl.c.conformer_id)
    )
    res2 = session.execute(upd).first()
    if not res2:
        # extremely unlikely; safety fallback to select
        sel = select(tbl.c.conformer_id).where(
            tbl.c.species_id == species_id,
            tbl.c.geometry_hash == geometry_hash,
            tbl.c.lot_id == lot_id,
        )
        res2 = session.execute(sel).first()
    return (res2[0] if res2 else None), True
    return result.conformer_id, result.geometry_hash


def upsert_ts_features(session, conformer_id: int, lot_id: int, fields: dict):
    tbl = TSFeatures.__table__
    ins = pg_insert(tbl).values(
        conformer_id=conformer_id,
        lot_id=lot_id,
        imag_freq_cm1=fields.get("imag_freq_cm1"),
        irc_verified=fields.get("irc_verified"),
        E_TS=fields.get("E_TS"),
    )
    stmt = ins.on_conflict_do_update(
        index_elements=[tbl.c.conformer_id, tbl.c.lot_id],  # <= key change
        set_={
            "imag_freq_cm1": ins.excluded.imag_freq_cm1,
            "irc_verified": ins.excluded.irc_verified,
            "E_TS": ins.excluded.E_TS,
            "updated_at": func.now(),
        },
    )
    session.execute(stmt)


def ensure_atom_role(session, atom_id: int | None, role: str) -> None:
    """Insert (atom_id, role) into atom_role_map if missing."""
    if not atom_id or not role:
        return
    tbl = AtomRoleMap.__table__
    stmt = (
        pg_insert(tbl)
        .values(atom_id=atom_id, role=role)
        .on_conflict_do_nothing(index_elements=[tbl.c.atom_id, tbl.c.role])
    )
    session.execute(stmt)


def upsert_cp_curve(session, conformer_id: int, curve: dict):
    tbl = CPCurve.__table__  # ORM model wrapping the table above
    stmt = (
        pg_insert(tbl)
        .values(
            conformer_id=conformer_id,
            T_K=curve["T_K"],
            Cp_J_per_molK=curve["Cp_J_per_molK"],
            source=curve.get("source"),
            raw_units=curve.get("raw_units"),
        )
        .on_conflict_do_update(
            index_elements=[tbl.c.conformer_id],
            set_={
                "T_K": curve["T_K"],
                "Cp_J_per_molK": curve["Cp_J_per_molK"],
                "source": curve.get("source"),
                "raw_units": curve.get("raw_units"),
                "updated_at": func.now(),
            },
        )
    )
    session.execute(stmt)


def upsert_well_features(session: Session, conformer_id: int, fields: dict) -> None:
    tbl = WellFeatures.__table__
    pk_col = getattr(tbl.c, "conformer_id", None)
    vals = {
        (pk_col.key): conformer_id,
        # NEW
        "E0": fields.get("E0"),
        "E0_units": fields.get("E0_units"),
        # Existing
        "E_elec": fields.get("E_elec"),
        "E_elec_units": fields.get("E_elec_units"),
        "ZPE": fields.get("ZPE"),
        "ZPE_units": fields.get("ZPE_units"),
        "H298": fields.get("H298"),
        "H298_units": fields.get("H298_units"),
        "G298": fields.get("G298"),
        "G298_units": fields.get("G298_units"),
        "S298": fields.get("S298"),
        "S298_units": fields.get("S298_units"),
        "meta": fields.get("meta"),
    }
    stmt = (
        pg_insert(tbl)
        .values(**vals)
        .on_conflict_do_update(
            index_elements=[pk_col],
            set_={
                "E0": vals["E0"],
                "E0_units": vals["E0_units"],
                "E_elec": vals["E_elec"],
                "ZPE": vals["ZPE"],
                "H298": vals["H298"],
                "G298": vals["G298"],
                "S298": vals["S298"],
                "S298_units": vals["S298_units"],
                "meta": vals["meta"],
                "updated_at": func.now(),
            },
        )
    )
    session.execute(stmt)


def _merge_kinetics(session: Session, reaction_id: int, row: dict):
    q = select(RateModel).where(
        RateModel.reaction_id == reaction_id,
        RateModel.direction == row["direction"],
        RateModel.source == row.get("source"),
        RateModel.reference == row.get("reference"),
        RateModel.Tmin_K == row.get("Tmin_K"),
        RateModel.Tmax_K == row.get("Tmax_K"),
    )
    existing = session.scalar(q)
    if existing:
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

    rm = RateModel(
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
    session.add(rm)
    return rm


def link_participant(session, reaction_id: int, conformer_id: int, role: str):
    tbl = ReactionParticipant.__table__
    stmt = (
        pg_insert(tbl)
        .values(reaction_id=reaction_id, conformer_id=conformer_id, role=role)
        .on_conflict_do_nothing()
    )
    session.execute(stmt)


def get_or_create_lot(
    session, method: str, basis: str | None, solvent: str | None
) -> int:
    lot_string = f"{method}/{basis or ''}".strip("/")
    q = select(LevelOfTheory).where(
        LevelOfTheory.method == method,
        LevelOfTheory.basis == basis,
        LevelOfTheory.solvent == solvent,
    )
    lot = session.scalar(q)
    if lot:
        return lot.lot_id
    lot = LevelOfTheory(
        method=method, basis=basis, solvent=solvent, lot_string=lot_string
    )
    session.add(lot)
    session.flush()
    return lot.lot_id


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
    skip_if_loaded: bool = True,
    dry_run: bool = False,
) -> None:
    stats = {
        "reactions_seen": 0,
        "molecules_upserted": 0,
        "atoms_inserted": 0,
        "kinetics_rows": 0,
        "csv_atoms_matched": 0,
        "csv_atoms_missing": 0,
        "merged_conformers": [],
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
            stats["dropped_conformers"] = []
            rxn_name = trip.reaction_name or "unnamed_rxn"
            if (
                skip_if_loaded
                and not dry_run
                and reaction_fully_loaded(session, rxn_name)
            ):
                print(f"[skip] Reaction '{rxn_name}' already loaded; skipping.")
                continue
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
            conf_id_by_role: Dict[str, int] = {}
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
                lot_method = (rec.props.get("lot_method") or "").strip() or None
                lot_basis = (rec.props.get("lot_basis") or "").strip() or None
                lot_solvent = (rec.props.get("lot_solvent") or "").strip() or None
                elements_json, heavy_atoms = _composition_and_heavy_atoms(rmol)
                if not lot_method:
                    lot_method, lot_basis, lot_solvent = "unknown", None, None
                lot_id = get_or_create_lot(session, lot_method, lot_basis, lot_solvent)
                if not dry_run:
                    is_ts = rec.role.upper() == "TS"
                    species_id = upsert_species(
                        session,
                        smiles=smiles,
                        inchikey=inchikey,
                        charge=charge,
                        spin_mult=spin_mult,
                        mw=mw,
                        props=rec.props,
                        elements_json=elements_json,
                        heavy_atoms=heavy_atoms,
                    )
                    conformer_id, merged = upsert_conformer(
                        session,
                        species_id=species_id,
                        lot_id=lot_id,
                        mol_rdkit_smiles=smiles,
                        geometry_hash=ghash,
                        well_label=rec.props.get("well_label"),
                        is_ts=is_ts,
                    )

                    if merged:
                        stats["merged_conformers"].append(
                            {
                                "reaction": rxn_name,
                                "species_id": species_id,
                                "lot_id": lot_id,
                                "geometry_hash": ghash,
                                "role": rec.role,
                                "is_ts": is_ts,
                            }
                        )
                    atoms_exist = (
                        session.scalar(
                            select(func.count())
                            .select_from(ConformerAtom)
                            .where(ConformerAtom.conformer_id == conformer_id)
                        )
                        > 0
                    )
                    link_participant(
                        session,
                        reaction_id=reaction.reaction_id,
                        conformer_id=conformer_id,
                        role=rec.role,
                    )
                    stats["molecules_upserted"] += 1
                    if is_ts:
                        ts_fields = _extract_ts_fields(rec.props or {})
                        if any(v is not None for v in ts_fields.values()):
                            upsert_ts_features(
                                session,
                                conformer_id=conformer_id,
                                lot_id=lot_id,
                                fields=ts_fields,
                            )
                    else:
                        for poly in (
                            _extract_nasa_polynomials_with_rmse(rec.props or {}) or []
                        ):
                            upsert_nasa_polynomial(
                                session, conformer_id=conformer_id, poly=poly
                            )

                        for curve in _extract_cp_curve(rec.props or {}) or []:
                            upsert_cp_curve(
                                session, conformer_id=conformer_id, curve=curve
                            )

                    # Well Features
                    wf = _extract_well_fields(rec.props or {})
                    upsert_well_features(session, conformer_id=conformer_id, fields=wf)
                    # if any(
                    #     wf.get(k) is not None for k in ("E_elec", "ZPE", "H298", "G298")
                    # ):
                    #     upsert_well_features(
                    #         session, conformer_id=conformer_id, fields=wf
                    #     )

                    conf_id_by_role[role] = conformer_id
                else:
                    molecule_id = -1  # simulate

                # RDKit for coordinates

                atoms_exist = False
                if not dry_run:
                    atoms_exist = (
                        session.scalar(
                            select(func.count())
                            .select_from(ConformerAtom)
                            .where(ConformerAtom.conformer_id == conformer_id)
                        )
                        > 0
                    )

                idx2id: Dict[int, int] = {}

                if dry_run:
                    # simulate mapping for each atom index without DB writes
                    idx2id = {i: -1 for i in range(rmol.GetNumAtoms())}

                else:
                    if not atoms_exist:
                        conf = rmol.GetConformer()
                        for i, atom in enumerate(rmol.GetAtoms()):
                            p = conf.GetAtomPosition(i)
                            a = ConformerAtom(
                                conformer_id=conformer_id,
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
                        # reconstruct idx2id from DB instead of re-inserting
                        for a in session.scalars(
                            select(ConformerAtom).where(
                                ConformerAtom.conformer_id == conformer_id
                            )
                        ):
                            idx2id[a.atom_idx] = a.atom_id

                role_to_idx2id[role] = idx2id
                # AtomRoleMap from mol_properties
                mp = rec.mol_properties or {}
                for i_idx, rname in _mol_properties_to_roles(mp).items():
                    if (
                        rname in {"donor", "acceptor", "d_hydrogen", "a_hydrogen"}
                        and not dry_run
                    ):
                        ensure_atom_role(session, idx2id.get(i_idx), rname)

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
                        atom = session.get(ConformerAtom, atom_id)
                        atom.q_mull = _flt(row.get("q_mull"))
                        atom.q_apt = _flt(row.get("q_apt"))
                        atom.spin = _int(row.get("spin"))
                        atom.Z = _int(row.get("Z"))
                        atom.mass = _flt(row.get("mass"))
                        atom.f_mag = _flt(row.get("f_mag"))

                        if mirror_geom_from_csv and not dry_run:
                            # paths are like "[3, 5]" / "[3, 0, 5]" / "[3, 0, 1, 5]"
                            r_path = _parse_path(row.get("radius_path"))
                            a_path = _parse_path(row.get("angle_path"))
                            d_path = _parse_path(row.get("dihedral_path"))

                            radius = _flt(row.get("radius"))
                            angle_v = _flt(row.get("angle"))
                            dihed_v = _flt(row.get("dihedral"))

                            angle_units = row.get("angle_units")
                            dihed_units = row.get("dihedral_units")
                            radius_units = row.get("radius_units")

                            # distance
                            if r_path and len(r_path) == 2 and radius is not None:
                                a1 = role_to_idx2id[role].get(r_path[0])
                                a2 = role_to_idx2id[role].get(r_path[1])
                                if a1 and a2:
                                    session.add(
                                        GeomDistance(
                                            conformer_id=session.get(
                                                ConformerAtom, a1
                                            ).conformer_id,
                                            frame=FRAME_MAP[role],
                                            a1_id=a1,
                                            a2_id=a2,
                                            value_ang=_radius_ang(radius, radius_units),
                                            units=row.get("radius_units"),
                                            measure_name="csv_radius",
                                            feature_ver="csv_v1",
                                        )
                                    )

                            # angle
                            if a_path and len(a_path) == 3 and angle_v is not None:
                                a1 = role_to_idx2id[role].get(a_path[0])
                                a2 = role_to_idx2id[role].get(a_path[1])
                                a3 = role_to_idx2id[role].get(a_path[2])
                                if a1 and a2 and a3:
                                    session.add(
                                        GeomAngle(
                                            conformer_id=session.get(
                                                ConformerAtom, a1
                                            ).conformer_id,
                                            frame=FRAME_MAP[role],
                                            a1_id=a1,
                                            a2_id=a2,
                                            a3_id=a3,
                                            value_deg=_angle_deg(
                                                angle_v,
                                                angle_units,
                                                csv_angles_are_deg=csv_angles_are_deg,
                                            ),
                                            units=row.get("angle_units"),
                                            measure_name="csv_angle",
                                            feature_ver="csv_v1",
                                        )
                                    )

                            # dihedral
                            if d_path and len(d_path) == 4 and dihed_v is not None:
                                a1 = role_to_idx2id[role].get(d_path[0])
                                a2 = role_to_idx2id[role].get(d_path[1])
                                a3 = role_to_idx2id[role].get(d_path[2])
                                a4 = role_to_idx2id[role].get(d_path[3])
                                if a1 and a2 and a3 and a4:
                                    session.add(
                                        GeomDihedral(
                                            conformer_id=session.get(
                                                ConformerAtom, a1
                                            ).conformer_id,
                                            frame=FRAME_MAP[role],
                                            a1_id=a1,
                                            a2_id=a2,
                                            a3_id=a3,
                                            a4_id=a4,
                                            value_deg=_angle_deg(
                                                dihed_v,
                                                dihed_units,
                                                csv_angles_are_deg=csv_angles_are_deg,
                                            ),
                                            units=row.get("dihedral_units"),
                                            measure_name="csv_dihedral",
                                            feature_ver="csv_v1",
                                        )
                                    )

            if all(r in conf_id_by_role for r in ("R1H", "R2H", "TS")):
                # You can pass either the whole props dict or just mol_properties.
                # If you adopted the robust helpers, both will work.
                ts_props = (
                    trip.records["TS"].mol_properties or trip.records["TS"].props or {}
                )
                map_triplet_key_atoms(
                    session,
                    conf_id_by_role=conf_id_by_role,
                    idx2id_by_role=role_to_idx2id,
                    ts_props=ts_props,
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
        if stats["merged_conformers"]:
            print("\n⚠ Conformers merged (duplicate geometry within species/LoT):")
            for d in stats["merged_conformers"]:
                print(
                    f" - {d['reaction']}  role={d['role']}  species={d['species_id']}  lot={d['lot_id']}  hash={d['geometry_hash']}"
                )
        else:
            print("\nNo conformers were merged.")
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
