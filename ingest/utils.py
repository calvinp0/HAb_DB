from collections import Counter
import json
import math
from typing import Optional, List, Dict
from rdkit import Chem

R_J_MOLK = 8.31446261815324
CAL_TO_J_PER_MOLK = 4.184
HARTREE_TO_KJ_MOL = 2625.49962
CAL_TO_KJ_MOL = 4.184
J_TO_KJ_MOL = 0.001
T_TOL = 0.10  # treat Tmin/Tmax within 0.10 K as the same segment
COEF_TOL = 1e-6  # abs tolerance per coefficient when judging "effectively equal"


SOURCE_PRIORITY_POLY = {
    # lower number = preferred; tune as you like
    "arkane_polynomial": 0,
    "rmg": 1,
    "arrhenius_csv": 5,
}


# at top of file (near other helpers)
def _norm_unit(u: Optional[str]) -> Optional[str]:
    if not u:
        return None
    s = u.strip().lower()
    s = s.replace(" ", "")
    s = s.replace("\\", "/").replace("·", "*").replace("⋅", "*")
    # J/(mol*K) → J/mol/K ; kcal/(mol*K) → kcal/mol/K ; etc.
    s = s.replace("/(mol*k)", "/mol*k").replace("*", "/")
    aliases = {
        "j/(mol*k)": "j/mol/k",
        "j/mol/k": "j/mol/k",
        "jmol^-1k^-1": "j/mol/k",
        "jmol-1k-1": "j/mol/k",
        "kj/(mol*k)": "kj/mol/k",
        "kj/mol/k": "kj/mol/k",
        "cal/(mol*k)": "cal/mol/k",
        "cal/mol/k": "cal/mol/k",
        "kcal/(mol*k)": "kcal/mol/k",
        "kcal/mol/k": "kcal/mol/k",
        "kj/mol": "kj/mol",
        "kcal/mol": "kcal/mol",
        "j/mol": "j/mol",
        "hartree": "hartree",
        "eh": "hartree",
    }
    return aliases.get(s, s)


def _H_to_kJmol(val: Optional[float], units: Optional[str]) -> Optional[float]:
    if val is None:
        return None
    u = _norm_unit(units)
    if u == "kj/mol":
        return val
    if u == "kcal/mol":
        return val * CAL_TO_KJ_MOL
    if u == "j/mol":
        return val * J_TO_KJ_MOL
    if u == "hartree":
        return val * HARTREE_TO_KJ_MOL
    return None


def _S_to_kJmolK(val: Optional[float], units: Optional[str]) -> Optional[float]:
    if val is None:
        return None
    u = _norm_unit(units)
    if u == "kj/mol/k":
        return val
    if u == "j/mol/k":
        return val / 1000.0
    if u == "cal/mol/k":
        return val * CAL_TO_KJ_MOL / 1000.0
    if u == "kcal/mol/k":
        return val * CAL_TO_KJ_MOL
    return None


def _as_list_of_floats(x) -> Optional[list[float]]:
    if x is None:
        return None
    if isinstance(x, str):
        x = x.strip()
        if not x:
            return None
        try:
            x = json.loads(x)
        except Exception:
            return None
    if isinstance(x, (list, tuple)):
        out = []
        for v in x:
            try:
                out.append(float(v))
            except Exception:
                return None
        return out
    return None


def _cp_unit_scale_to_J_per_molK(unit_str: Optional[str]) -> Optional[float]:
    """
    Return multiplicative factor to convert given Cp units to J/(mol*K).
    """
    if not unit_str:
        return None
    u = unit_str.strip().lower().replace(" ", "")
    if u in {"j/(mol*k)", "j/mol/k", "jmol-1k-1"}:
        return 1.0
    if u in {"kj/(mol*k)", "kj/mol/k"}:
        return 1000.0
    if u in {"cal/(mol*k)", "cal/mol/k"}:
        return 4.184
    if u in {"kcal/(mol*k)", "kcal/mol/k"}:
        return 4184.0
    # unknown
    return None


def _compute_rmse_nasa7(
    coeffs: list[float], Ts: list[float], Cp_obs_J_per_molK: list[float]
) -> Optional[float]:
    """
    NASA7 Cp/R = a1 + a2*T + a3*T^2 + a4*T^3 + a5*T^4
    Return RMSE in J/(mol*K).
    """
    if len(coeffs) != 7 or not Ts or not Cp_obs_J_per_molK:
        return None
    a1, a2, a3, a4, a5, _, _ = coeffs
    if len(Ts) != len(Cp_obs_J_per_molK):
        return None
    sq = 0.0
    n = 0
    for T, cp in zip(Ts, Cp_obs_J_per_molK):
        cp_model = R_J_MOLK * (
            a1 + a2 * T + a3 * T * T + a4 * T * T * T + a5 * T * T * T * T
        )
        diff = cp_model - cp
        sq += diff * diff
        n += 1
    if n == 0:
        return None
    return math.sqrt(sq / n)


def _extract_nasa_polynomials_with_rmse(props: dict) -> list[dict]:
    """
    Returns a list of dicts:
      { form, Tmin_K, Tmax_K, coeffs[7], source, fit_rmse }
    fit_rmse may be None if we can't compute it.
    """
    # 1) parse polynomials
    polys_raw = props.get("polynomials")
    if not polys_raw:
        return []
    if isinstance(polys_raw, str):
        try:
            polys = json.loads(polys_raw)
        except Exception:
            polys = []
    elif isinstance(polys_raw, list):
        polys = polys_raw
    else:
        polys = []

    # 2) parse Cp(T) data (optional)
    T_list = _as_list_of_floats(props.get("T_list"))
    Cp_list = _as_list_of_floats(props.get("Cp_T_value_list"))
    cp_units = (props.get("Cp_T_units") or "").strip()
    scale = _cp_unit_scale_to_J_per_molK(cp_units)
    if T_list and Cp_list and scale is not None and len(T_list) == len(Cp_list):
        Cp_list_J = [c * scale for c in Cp_list]
        cp_data_available = True
    else:
        Cp_list_J = None
        cp_data_available = False

    out: list[dict] = []
    for p in polys:
        klass = (p.get("class") or "").strip()
        coeffs = p.get("coeffs") or []
        if not (klass.lower().startswith("nasa") and len(coeffs) == 7):
            continue
        try:
            Tmin = float(p.get("Tmin_value"))
            Tmax = float(p.get("Tmax_value"))
        except Exception:
            continue

        fit_rmse = None
        if cp_data_available:
            # Use only temperatures within this segment's validity window.
            Ts_seg = [T for T in T_list if T >= Tmin - 1e-9 and T <= Tmax + 1e-9]
            if Ts_seg:
                # map Ts_seg back to matching Cp values (same indices in original lists)
                Ts_idxs = [
                    i
                    for i, T in enumerate(T_list)
                    if T >= Tmin - 1e-9 and T <= Tmax + 1e-9
                ]
                Cp_seg = [Cp_list_J[i] for i in Ts_idxs]
                fit_rmse = _compute_rmse_nasa7(
                    [float(x) for x in coeffs], Ts_seg, Cp_seg
                )

        out.append(
            {
                "form": "NASA7",
                "Tmin_K": Tmin,
                "Tmax_K": Tmax,
                "coeffs": [float(x) for x in coeffs],
                "source": "arkane_polynomial",
                "fit_rmse": fit_rmse,
            }
        )
    return out


### CP CURVE


def _cp_unit_scale_to_J_per_molK(unit_str: Optional[str]) -> Optional[float]:
    if not unit_str:
        return None
    u = unit_str.strip().lower().replace(" ", "")
    if u in {"j/(mol*k)", "j/mol/k", "jmol-1k-1"}:
        return 1.0
    if u in {"kj/(mol*k)", "kj/mol/k"}:
        return 1000.0
    if u in {"cal/(mol*k)", "cal/mol/k"}:
        return 4.184
    if u in {"kcal/(mol*k)", "kcal/mol/k"}:
        return 4184.0
    return None


def _T_unit_to_K_scale(unit_str: Optional[str]) -> Optional[float]:
    # Almost always K; included for completeness
    if not unit_str:
        return 1.0
    u = unit_str.strip().lower()
    if u in {"k", "kelvin"}:
        return 1.0
    # If someone ever gave °C, you’d need an affine transform, not a scale.
    # We bail out to avoid silently doing the wrong thing.
    return None


def _extract_cp_curve(props: dict) -> Optional[List[dict]]:
    """Return a normalized Cp(T) curve or None.
    Schema: {"T_K":[...], "Cp_J_per_molK":[...], "source": "...", "raw_units": "..."}"""
    Ts = _as_list_of_floats(props.get("T_list"))
    Cps = _as_list_of_floats(props.get("Cp_T_value_list"))
    uCp = (props.get("Cp_T_units") or "").strip()
    uT = (props.get("T_units") or "").strip()

    if not Ts or not Cps or len(Ts) != len(Cps):
        return None

    s_cp = _cp_unit_scale_to_J_per_molK(uCp)
    s_T = _T_unit_to_K_scale(uT)
    if s_cp is None or s_T is None:
        return None  # unknown units, skip to be safe

    T_K = [t * s_T for t in Ts]
    Cp_J = [c * s_cp for c in Cps]

    # Optional extras if present (already normalized elsewhere)
    cp0 = props.get("Cp0_value")
    cpinf = props.get("CpInf_value")

    return [
        {
            "T_K": T_K,
            "Cp_J_per_molK": Cp_J,
            "source": "sdf_props",
            "raw_units": {"Cp_T_units": uCp, "T_units": uT},
            "Cp0_raw": cp0,
            "CpInf_raw": cpinf,
        }
    ]


def _to_J_per_molK(value: Optional[float], units: Optional[str]) -> Optional[float]:
    if value is None:
        return None
    u = (units or "").strip().lower()
    if not u or u in {"j/(mol*k)", "j/mol/k", "jmol^-1k^-1"}:
        return value
    if u in {"cal/(mol*k)", "cal/mol/k", "calmol^-1k^-1"}:
        return value * CAL_TO_J_PER_MOLK
    # add more if needed
    return None


# ingest/utils.py
from typing import Optional, Dict
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy import select
from db.models import ParticipantAtomRole, AtomMapToTS


def _coerce_mol_properties(mp_any) -> dict:
    """
    Accepts either:
      - dict like {"0":{"label":"*3",...}, ...}
      - JSON string of the same dict
      - None / "unknown"
    Returns a dict (possibly empty) in the first form.
    """
    if isinstance(mp_any, dict):
        return mp_any
    if isinstance(mp_any, str):
        s = mp_any.strip()
        if not s or s.lower() == "unknown":
            return {}
        try:
            return json.loads(s)
        except Exception:
            return {}
    return {}


def find_ts_star(ts_props, star_label: str):
    # ts_props may be dict, JSON string, or None
    if isinstance(ts_props, str):
        try:
            import json

            ts_props = json.loads(ts_props)
        except Exception:
            try:
                import ast

                ts_props = ast.literal_eval(ts_props)
            except Exception:
                ts_props = None
    if not isinstance(ts_props, dict):
        return None
    mp = ts_props.get("mol_properties") if "mol_properties" in ts_props else ts_props
    if not isinstance(mp, dict):
        return None
    for k, v in mp.items():
        # tolerate "unknown" / None / stringly-typed k
        if isinstance(v, dict) and str(v.get("label", "")).strip() == star_label:
            try:
                return int(k)
            except Exception:
                continue
    return None


def first_atom_idx_with_role(
    session, participant_id: Optional[int], role_name: str
) -> Optional[int]:
    if not participant_id or not role_name:
        return None
    q = (
        select(ParticipantAtomRole.atom_idx)
        .where(
            ParticipantAtomRole.participant_id == participant_id,
            ParticipantAtomRole.role == role_name,
        )
        .order_by(ParticipantAtomRole.atom_idx)
    )
    return session.scalars(q).first()


def upsert_atom_map_row(
    session,
    ts_atom_id: Optional[int],
    src_atom_id: Optional[int],
    participant_id: Optional[int],
) -> None:
    """Insert one mapping row between a TS atom and a source atom belonging to a participant."""
    if not (ts_atom_id and src_atom_id and participant_id):
        return

    tbl = AtomMapToTS.__table__
    stmt = (
        pg_insert(tbl)
        .values(
            ts_atom_id=ts_atom_id,
            src_atom_id=src_atom_id,
            participant_id=participant_id,
        )
        .on_conflict_do_nothing()
    )
    session.execute(stmt)

# def find_ts_star(ts_props: dict, label: str) -> Optional[int]:
#     """Return TS atom_idx (int) whose label matches '*0','*1',..."""
#     for k, v in ts_props.items():
#         try:
#             idx = int(k)
#         except Exception:
#             continue
#         if str(v.get("label", "")).strip() == label:
#             return idx
#     return None

def find_neighbor_non_H(mol, atom_idx, exclude_idx=None):
    a = mol.GetAtomWithIdx(atom_idx)
    for nb in a.GetNeighbors():
        i = nb.GetIdx()
        if nb.GetAtomicNum() != 1 and i != exclude_idx:
            return i
    return None




def _neighbor_candidates_matching_Z(mol, center_idx, target_Z, exclude_idxs=None):
    if mol is None or center_idx is None or target_Z is None:
        return []
    if exclude_idxs is None:
        exclude_idxs = set()
    else:
        exclude_idxs = set(exclude_idxs)

    a = mol.GetAtomWithIdx(center_idx)
    cands = []
    for nb in a.GetNeighbors():
        i = nb.GetIdx()
        if i in exclude_idxs:
            continue
        if nb.GetAtomicNum() == target_Z:
            cands.append(i)
    return cands


def map_triplet_key_atoms(
    session,
    idx2id_by_role: Dict[str, Dict[int, int]],
    participant_id_by_role: Dict[str, int],
    ts_props: dict,
    mol_by_role: Optional[Dict[str, Chem.Mol]] = None,
) -> None:
    """Anchor mappings: *1(donor), *2(H), *3(acceptor), plus infer *0/*4 neighbors."""

    mol_by_role = mol_by_role or {}
    ts_mol = mol_by_role.get("TS")
    r1_mol = mol_by_role.get("R1H")
    r2_mol = mol_by_role.get("R2H")

    ts_idx2id = idx2id_by_role.get("TS", {})
    r1_idx_map = idx2id_by_role.get("R1H", {})
    r2_idx_map = idx2id_by_role.get("R2H", {})

    r1_part = participant_id_by_role.get("R1H")
    r2_part = participant_id_by_role.get("R2H")

    # --- TS star indices (by atom_idx) ---
    ts_star1 = find_ts_star(ts_props, "*1")
    ts_star2 = find_ts_star(ts_props, "*2")
    ts_star3 = find_ts_star(ts_props, "*3")
    ts_star0 = find_ts_star(ts_props, "*0")
    ts_star4 = find_ts_star(ts_props, "*4")

    ts_star1_id = ts_idx2id.get(ts_star1) if ts_star1 is not None else None
    ts_star2_id = ts_idx2id.get(ts_star2) if ts_star2 is not None else None
    ts_star3_id = ts_idx2id.get(ts_star3) if ts_star3 is not None else None
    ts_star0_id = ts_idx2id.get(ts_star0) if ts_star0 is not None else None
    ts_star4_id = ts_idx2id.get(ts_star4) if ts_star4 is not None else None

    # --- donor / acceptor / H in reactants (by atom_idx) ---
    r1_donor_idx = first_atom_idx_with_role(session, r1_part, "donor")
    r1_dH_idx = first_atom_idx_with_role(session, r1_part, "d_hydrogen")
    r2_acceptor_idx = first_atom_idx_with_role(session, r2_part, "acceptor")
    r2_aH_idx = first_atom_idx_with_role(session, r2_part, "a_hydrogen")

    # --- reactant atom_ids ---
    r1_donor_id = r1_idx_map.get(r1_donor_idx) if r1_donor_idx is not None else None
    r1_dH_id = r1_idx_map.get(r1_dH_idx) if r1_dH_idx is not None else None
    r2_acceptor_id = (
        r2_idx_map.get(r2_acceptor_idx) if r2_acceptor_idx is not None else None
    )
    r2_aH_id = r2_idx_map.get(r2_aH_idx) if r2_aH_idx is not None else None

    # --- Core anchors: *1, *2, *3 ---
    upsert_atom_map_row(session, ts_atom_id=ts_star1_id, src_atom_id=r1_donor_id, participant_id=r1_part)
    upsert_atom_map_row(session, ts_atom_id=ts_star3_id, src_atom_id=r2_acceptor_id, participant_id=r2_part)

    # migrating H (*2) appears in both R1H and R2H
    upsert_atom_map_row(session, ts_atom_id=ts_star2_id, src_atom_id=r1_dH_id, participant_id=r1_part)
    upsert_atom_map_row(session, ts_atom_id=ts_star2_id, src_atom_id=r2_aH_id, participant_id=r2_part)

    # --- Infer *0 on R1H: neighbor of donor matching TS *0 element ---
    if ts_mol and r1_mol and ts_star0 is not None and ts_star0_id and r1_donor_idx is not None:
        ts0_Z = ts_mol.GetAtomWithIdx(ts_star0).GetAtomicNum()
        # avoid migrating H
        exclude = {r1_dH_idx} if r1_dH_idx is not None else set()
        cands = _neighbor_candidates_matching_Z(r1_mol, r1_donor_idx, ts0_Z, exclude)
        if cands:
            # pick first; if multiple possible, they’re symmetry-equivalent for our purposes
            r1_star0_idx = cands[0]
            r1_star0_id = r1_idx_map.get(r1_star0_idx)
            upsert_atom_map_row(
                session,
                ts_atom_id=ts_star0_id,
                src_atom_id=r1_star0_id,
                participant_id=r1_part,
            )

    # --- Infer *4 on R2H: neighbor of acceptor matching TS *4 element ---
    if ts_mol and r2_mol and ts_star4 is not None and ts_star4_id and r2_acceptor_idx is not None:
        ts4_Z = ts_mol.GetAtomWithIdx(ts_star4).GetAtomicNum()
        exclude = {r2_aH_idx} if r2_aH_idx is not None else set()
        cands = _neighbor_candidates_matching_Z(r2_mol, r2_acceptor_idx, ts4_Z, exclude)
        if cands:
            r2_star4_idx = cands[0]
            r2_star4_id = r2_idx_map.get(r2_star4_idx)
            upsert_atom_map_row(
                session,
                ts_atom_id=ts_star4_id,
                src_atom_id=r2_star4_id,
                participant_id=r2_part,
            )
    
def _composition_and_heavy_atoms(mol: Chem.Mol) -> tuple[dict, int]:
    """
    Return ({'C': nC, 'H': nH, ...}, heavy_atoms_count).
    Heavy atoms are all non-hydrogens (Z > 1).
    """
    symbols = [a.GetSymbol() for a in mol.GetAtoms()]
    counts = dict(Counter(symbols))
    heavy = sum(1 for a in mol.GetAtoms() if a.GetAtomicNum() > 1)
    return counts, heavy


def _src_rank(src: Optional[str]) -> int:
    return SOURCE_PRIORITY_POLY.get((src or "").lower(), 10)


def _coeffs_close(a: tuple[float, ...], b: tuple[float, ...], tol=COEF_TOL) -> bool:
    return all(abs(x - y) <= tol for x, y in zip(a, b))
