"""
SDF Reader utilities for SDF reaction files
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterator, Optional, Dict, List, Tuple, Literal, Sequence, Set
import json
import ast

from rdkit import Chem

Role = Literal["R1H", "R2H", "TS", "R1", "R2"]
ALL_ROLES: Tuple[Role, ...] = ("R1H", "R2H", "TS", "R1", "R2")


@dataclass
class MolRecord:
    role: Role
    molblock: str
    props: Dict[str, str]
    record_index: int  # 0 based within the source file
    reaction_name: Optional[str] = None  # Optional name for the reaction, if available
    mol_properties: Optional[Dict[str, Any]] = (
        None  # Additional properties of the molecule, if available
    )
    electro_map: Optional[Dict[str, Any]] = None  # Optional electrostatic map data


@dataclass
class ReactionTriplet:
    source_file: str
    records: Dict[Role, MolRecord]
    reaction_name: Optional[str] = None

    @property
    def molblocks(self) -> Dict[Role, str]:
        return {role: record.molblock for role, record in self.records.items()}

    @property
    def props(self) -> Dict[Role, Dict[str, str]]:
        return {role: record.props for role, record in self.records.items()}


def _extract_props(mol: Chem.Mol) -> Dict[str, str]:
    """Extract properties from an RDKit Mol object."""
    props_raw = mol.GetPropsAsDict(includePrivate=True, includeComputed=True)
    out: Dict[str, str] = {}
    for k, v in props_raw.items():
        if k != "mol":
            out[str(k)] = str(v)
    return out


def _jsonish_or_none(s: str | None):
    """Parse a JSON-ish string into a Python object, or return None.

    Treat '', 'unknown', 'null' (any case) as None.
    First try json.loads; if that fails, fall back to ast.literal_eval for
    legacy dict/list strings. Return None on any failure.
    """
    if s is None:
        return None
    t = s.strip()
    if not t or t.lower() in {"unknown", "null"}:
        return None
    try:
        return json.loads(t)
    except Exception:
        try:
            return ast.literal_eval(t)
        except Exception:
            return None


def _detect_role(
    props: Dict[str, str], idx_in_group: int, order_hint: Sequence[Role]
) -> Role:
    # Prefer explicit data field. Common keys: ROLE, role, MolRole, mol_role, type
    for key in ("ROLE", "role", "MolRole", "mol_role", "type"):
        val = props.get(key)
        if not val:
            continue
        v = val.strip().upper()  # 'r1h' -> 'R1H'
        if v in ALL_ROLES:
            return v  # type: ignore[return-value]
    # Fallback to position-based mapping
    return order_hint[idx_in_group % len(order_hint)]


def _to_molblock(mol: Chem.Mol) -> str:
    # Keep coordinates as-is; no kekulization here.
    return Chem.MolToMolBlock(mol)


def iter_triplets(
    sdf_path: str | Path,
    *,
    sanitize: bool = True,
    strict_roles: bool = True,
    order_hint: Sequence[Role] = ALL_ROLES,
) -> Iterator[ReactionTriplet]:
    """Yield ReactionTriplet from an SDF expected to contain grouped records.

    Parameters
    ----------
    sdf_path : str | Path
        Path to the SDF file.
    sanitize : bool
        If True, RDKit sanitizes molecules during load. Set False to accept
        raw inputs and postpone cleanup to a standardization step.
    strict_roles : bool
        If True, every record must carry an explicit ROLE data field with
        one of the known roles. If False, fallback to position-based mapping
        using `order_hint` for any missing ROLE.
    order_hint : tuple
        Expected order for grouped records when ROLE is absent. Defaults to
        (R1H, R2H, TS, R1, R2).

    Yields
    ------
    ReactionTriplet
        A dict-like structure keyed by role for each molecule record in the group.

    Raises
    ------
    ValueError
        If the file ends with an incomplete triplet or roles collide.
    """
    sdf_path = str(sdf_path)
    supplier = Chem.SDMolSupplier(sdf_path, sanitize=sanitize, removeHs=False)
    if supplier is None:
        raise ValueError(f"Cannot open SDF: {sdf_path}")

    order_hint = tuple(order_hint)
    if any(r not in ALL_ROLES for r in order_hint):
        raise ValueError(
            f"order_hint may only contain known roles {ALL_ROLES}, got {order_hint}"
        )
    expected_roles: Set[Role] = set(order_hint)
    required_roles: Set[Role] = {"R1H", "R2H", "TS"}

    buffer: Dict[Role, MolRecord] = {}
    records_in_group = 0
    triplet_reaction_name: Optional[str] = None
    for i, mol in enumerate(supplier):
        if mol is None:
            raise ValueError(f"Invalid molecule at record {i} in {sdf_path}")

        props = _extract_props(mol)

        # Determine role
        if strict_roles:
            role_str = (
                props.get("type")
                or props.get("ROLE")
                or props.get("role")
                or props.get("MolRole")
                or props.get("mol_role")
            )
            role_str = (role_str or "").strip().upper()
            if role_str not in ALL_ROLES:
                raise ValueError("Record missing explicit role/type in strict mode")
            role: Role = role_str  # type: ignore[assignment]
        else:
            pos_in_group = records_in_group % len(order_hint)
            role = _detect_role(props, pos_in_group, order_hint)

        rxn_name = (
            props.get("reaction") or props.get("REACTION") or ""
        ).strip() or None

        mp_raw = props.get("mol_properties") or props.get("MOL_PROPERTIES")
        em_raw = props.get("electro_map") or props.get("ELECTRO_MAP")

        mp = _jsonish_or_none(mp_raw)
        em = _jsonish_or_none(em_raw)

        # if you want to guarantee dicts instead of None:
        mp = mp if isinstance(mp, dict) else {}
        em = em if isinstance(em, dict) else {}
        if rxn_name:
            if triplet_reaction_name is None:
                triplet_reaction_name = rxn_name
            elif triplet_reaction_name != rxn_name:
                raise ValueError(
                    f"Records at approx index {i-2} and {i} have different reaction names: "
                    f"{triplet_reaction_name} vs {rxn_name}"
                )

        rec = MolRecord(
            role=role,
            molblock=_to_molblock(mol),
            props=props,
            record_index=i,
            reaction_name=rxn_name,
            mol_properties=mp,
            electro_map=em,
        )

        # Starting a new record group before flushing the previous one indicates
        # that we're missing at least one required role.
        if role in buffer:
            missing_required = required_roles - set(buffer)
            if missing_required:
                raise ValueError(
                    f"Triplet starting near record {i} missing required roles: {missing_required}"
                )
            yield ReactionTriplet(
                source_file=str(Path(sdf_path).resolve()),
                reaction_name=triplet_reaction_name,
                records=dict(buffer),
            )
            buffer.clear()
            triplet_reaction_name = None
            records_in_group = 0

        buffer[role] = rec
        records_in_group += 1

        if len(buffer) == len(expected_roles):
            missing = required_roles - set(buffer)
            if missing:
                raise ValueError(
                    f"Triplet at approx records [{i-(len(order_hint)-1)},{i}] missing required roles: {missing}"
                )
            yield ReactionTriplet(
                source_file=str(Path(sdf_path).resolve()),
                reaction_name=triplet_reaction_name,
                records=dict(buffer),
            )
            buffer.clear()
            triplet_reaction_name = None
            records_in_group = 0
    if buffer:
        # Incomplete triplet at EOF
        roles = ", ".join(sorted(buffer.keys()))
        raise ValueError(
            f"File ended with incomplete triplet containing roles: {roles}. Add the missing records or fix ROLE fields."
        )


def peek_first_triplet(
    sdf_path: str | Path,
    **kwargs,
) -> ReactionTriplet:
    """Load and return only the first ReactionTriplet (useful for tests)."""
    for t in iter_triplets(sdf_path, **kwargs):
        return t
    raise ValueError("No records found in SDF")
