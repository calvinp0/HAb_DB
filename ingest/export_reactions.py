"""Export reactions into per-reaction bundles for sharing."""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional

from rdkit import Chem
from sqlalchemy import select, text
from sqlalchemy.orm import Session, selectinload

from db.engine import session_scope
from db.models import (
    Conformer,
    LevelOfTheory,
    RateModel,
    Reaction,
    ReactionParticipant,
    Species,
    TSFeatures,
    WellFeatures,
)

ROLE_ORDER = ["R1H", "R2H", "TS", "R1", "R2"]
ROLES_WITH_ATOM_MAP = {"R1H", "R2H", "TS"}


def _slugify(name: str | None) -> str:
    if not name:
        return "reaction"
    slug = re.sub(r"[^0-9A-Za-z]+", "-", name).strip("-")
    return slug or "reaction"


def _serialize_lot(lot: LevelOfTheory | None) -> dict:
    if not lot:
        return {}
    return {
        "lot_id": lot.lot_id,
        "method": lot.method,
        "basis": lot.basis,
        "solvent": lot.solvent,
        "lot_string": lot.lot_string,
    }


def _serialize_well_features(wf: WellFeatures | None) -> dict:
    if not wf:
        return {}
    return {
        "E0": wf.E0,
        "E0_units": wf.E0_units,
        "E_elec": wf.E_elec,
        "E_elec_units": wf.E_elec_units,
        "ZPE": wf.ZPE,
        "ZPE_units": wf.ZPE_units,
        "H298": wf.H298,
        "H298_units": wf.H298_units,
        "G298": wf.G298,
        "G298_units": wf.G298_units,
        "S298": wf.S298,
        "S298_units": wf.S298_units,
        "G298_source": wf.G298_source,
        "G_calc_T_K": wf.G_calc_T_K,
        "meta": wf.meta,
    }


def _serialize_ts_features(tsf: TSFeatures | None) -> dict:
    if not tsf:
        return {}
    return {
        "imag_freq_cm1": tsf.imag_freq_cm1,
        "irc_verified": tsf.irc_verified,
        "E_TS": tsf.E_TS,
    }


def _serialize_rate_model(rm: RateModel) -> dict:
    return {
        "rate_model_id": rm.rate_model_id,
        "direction": rm.direction,
        "model": rm.model,
        "A": rm.A,
        "n": rm.n,
        "Ea_kJ_mol": rm.Ea_kJ_mol,
        "Tmin_K": rm.Tmin_K,
        "Tmax_K": rm.Tmax_K,
        "source": rm.source,
        "reference": rm.reference,
        "computed_from": rm.computed_from,
        "dA_factor": rm.dA_factor,
        "dn_abs": rm.dn_abs,
        "dEa_kJ_mol": rm.dEa_kJ_mol,
        "meta": rm.meta,
    }


def _ts_atom_map(participants: List[ReactionParticipant]) -> Dict[str, Dict[int, int]]:
    # role -> participant
    by_role = {rp.role.upper(): rp for rp in participants if rp.conformer}
    ts_part = by_role.get("TS")
    if not ts_part:
        return {}

    # Build atom_idx lookup per conformer
    idx_by_atom_id: Dict[int, int] = {}
    conf_idx_maps: Dict[int, Dict[int, int]] = {}  # conformer_id -> {atom_id: atom_idx}
    for rp in participants:
        conf = rp.conformer
        if not conf:
            continue
        m = {}
        for a in getattr(conf, "atoms", []):
            if a.atom_id is not None and a.atom_idx is not None:
                m[a.atom_id] = a.atom_idx
        conf_idx_maps[conf.conformer_id] = m

    mapping: Dict[str, Dict[int, int]] = {}

    for rp in participants:
        conf = rp.conformer
        if not conf:
            continue
        # For each participant, gather its mappings
        for row in getattr(rp, "atom_maps", []):  # attached via relationship
            ts_idx = conf_idx_maps.get(ts_part.conformer_id, {}).get(row.ts_atom_id)
            src_idx = conf_idx_maps.get(conf.conformer_id, {}).get(row.src_atom_id)
            if ts_idx is None or src_idx is None:
                continue
            role = rp.role.upper()
            mapping.setdefault(role, {})[src_idx] = ts_idx

    return mapping



def _mol_props(
    session: Session,
    reaction: Reaction,
    role: str,
    rp: ReactionParticipant,
    ts_atom_map: Optional[Dict[str, Dict[int, int]]] = None,
) -> Dict[str, str]:
    conf = rp.conformer
    species = conf.species
    lot = conf.geom_lot
    wf = conf.well_features
    tsf = conf.ts_features
    props: Dict[str, str] = {
        "reaction_name": reaction.reaction_name or "",
        "reaction_id": str(reaction.reaction_id),
        "role": role,
        "conformer_id": str(conf.conformer_id),
        "species_id": str(conf.species_id),
        "lot_method": lot.method if lot else "",
        "lot_basis": lot.basis or "",
        "lot_solvent": lot.solvent or "",
        "lot_string": lot.lot_string if lot else "",
        "well_label": conf.well_label or "",
        "well_rank": str(conf.well_rank) if conf.well_rank is not None else "",
        "is_ts": str(conf.is_ts),
    }
    if species and species.smiles:
        props["smiles"] = species.smiles
    if wf:
        for key, val in _serialize_well_features(wf).items():
            if val is None:
                continue
            props[f"well_{key}"] = json.dumps(val) if isinstance(val, dict) else str(val)
    if tsf:
        for key, val in _serialize_ts_features(tsf).items():
            if val is None:
                continue
            props[f"ts_{key}"] = str(val)
    upper_role = role.upper()
    if upper_role in ROLES_WITH_ATOM_MAP:
        amap = {ar.atom_idx: ar.role for ar in getattr(rp, "atom_roles", [])}
        if amap:
            props["atom_role_map"] = json.dumps(amap)
    if upper_role == "TS":
        star_labels: Dict[int, str] = {}
        participants_by_role = {
            participant.role.upper(): participant for participant in reaction.participants
        }

        def _map_label(source_role: str, atom_role: str, label: str):
            participant = participants_by_role.get(source_role)
            if not participant or not ts_atom_map:
                return
            src_map = ts_atom_map.get(source_role, {})
            for atom_role_entry in getattr(participant, "atom_roles", []):
                if atom_role_entry.role != atom_role:
                    continue
                ts_idx = src_map.get(atom_role_entry.atom_idx)
                if ts_idx is not None:
                    star_labels[ts_idx] = label
                    break

        _map_label("R1H", "donor", "*1")
        _map_label("R1H", "d_hydrogen", "*2")
        _map_label("R2H", "a_hydrogen", "*2")
        _map_label("R2H", "acceptor", "*3")

        if star_labels:
            props["mol_properties"] = json.dumps(
                {str(idx): {"label": lab} for idx, lab in star_labels.items()}
            )

        if ts_atom_map:
            serializable_map = {
                role_name: {str(src_idx): ts_idx for src_idx, ts_idx in mapping.items()}
                for role_name, mapping in ts_atom_map.items()
            }
            props["ts_atom_map"] = json.dumps(serializable_map)
    return props


def _fetch_molblock(session: Session, conformer_id: int) -> str | None:
    row = session.execute(
        text("SELECT mol_raw_ctab FROM conformer WHERE conformer_id = :cid"),
        {"cid": conformer_id},
    ).first()
    if row and row[0]:
        return row[0]
    # fallback: still return mol_to_ctab if mol_raw_ctab is missing
    row2 = session.execute(
        text("SELECT mol_to_ctab(mol, TRUE, TRUE) FROM conformer WHERE conformer_id = :cid"),
        {"cid": conformer_id},
    ).first()
    return row2[0] if row2 and row2[0] else None


def _write_sdf(
    folder: Path,
    reaction: Reaction,
    ordered_participants: List[ReactionParticipant],
    session: Session,
):
    sdf_path = folder / "participants.sdf"
    writer = Chem.SDWriter(str(sdf_path))
    ts_mapping = _ts_atom_map(ordered_participants)
    try:
        for rp in ordered_participants:
            conf = rp.conformer
            if conf is None:
                continue
            molblock = _fetch_molblock(session, conf.conformer_id)
            mol = (
                Chem.MolFromMolBlock(molblock, sanitize=False, removeHs=False)
                if molblock
                else None
            )
            if mol is None:
                continue
            mol.UpdatePropertyCache(strict=False)

            props = _mol_props(session, reaction, rp.role, rp, ts_mapping)
            for key, value in props.items():
                mol.SetProp(key, value)
            writer.write(mol)
    finally:
        writer.close()


def _write_metadata(folder: Path, reaction: Reaction, ordered_participants: List[ReactionParticipant]):
    data = {
        "reaction_id": reaction.reaction_id,
        "reaction_name": reaction.reaction_name,
        "family": reaction.family,
        "batch": {
            "batch_id": getattr(reaction, "batch_id", None),
            "source_label": getattr(getattr(reaction, "batch", None), "source_label", None),
        },
        "participants": [],
        "rate_models": [_serialize_rate_model(rm) for rm in getattr(reaction, "rate_models", [])],
    }

    part_payload = []
    for rp in ordered_participants:
        conf = rp.conformer
        species = conf.species if conf else None
        payload = {
            "role": rp.role,
            "conformer_id": conf.conformer_id if conf else None,
            "species": {
                "species_id": species.species_id if species else None,
                "smiles": species.smiles if species else None,
                "inchikey": species.inchikey if species else None,
            },
            "lot": _serialize_lot(conf.geom_lot if conf else None),
            "well_features": _serialize_well_features(conf.well_features if conf else None),
            "ts_features": _serialize_ts_features(conf.ts_features if conf else None),
        }
        part_payload.append(payload)
    data["participants"] = part_payload

    meta_path = folder / "reaction.json"
    meta_path.write_text(json.dumps(data, indent=2, sort_keys=True))


def export_reactions(output_dir: Path, reaction_ids: Iterable[int] | None = None):
    output_dir.mkdir(parents=True, exist_ok=True)
    exported_at = datetime.now(timezone.utc)
    timestamp_slug = exported_at.strftime("%Y%m%dT%H%M%SZ")
    index: List[dict] = []

    with session_scope() as session:
        stmt = (
            select(Reaction)
            .options(
                selectinload(Reaction.participants)
                .selectinload(ReactionParticipant.conformer)
                .selectinload(Conformer.species),
                selectinload(Reaction.participants)
                .selectinload(ReactionParticipant.conformer)
                .selectinload(Conformer.geom_lot),
                selectinload(Reaction.participants)
                .selectinload(ReactionParticipant.conformer)
                .selectinload(Conformer.well_features),
                selectinload(Reaction.participants)
                .selectinload(ReactionParticipant.conformer)
                .selectinload(Conformer.ts_features),
                selectinload(Reaction.participants)
                .selectinload(ReactionParticipant.conformer)
                .selectinload(Conformer.atoms),
                selectinload(Reaction.participants).selectinload(
                    ReactionParticipant.atom_roles
                ),
                selectinload(Reaction.participants).selectinload(
                    ReactionParticipant.atom_maps
                ),
                selectinload(Reaction.rate_models),
            )
            .order_by(Reaction.reaction_id)
        )
        if reaction_ids:
            stmt = stmt.where(Reaction.reaction_id.in_(list(reaction_ids)))

        reactions = session.scalars(stmt).all()

        for reaction in reactions:
            slug = _slugify(reaction.reaction_name) or f"rxn-{reaction.reaction_id}"
            folder = output_dir / f"{reaction.reaction_id:05d}_{slug}"
            folder.mkdir(parents=True, exist_ok=True)

            participant_by_role = {rp.role.upper(): rp for rp in reaction.participants}
            ordered = [participant_by_role[r] for r in ROLE_ORDER if r in participant_by_role]

            _write_sdf(folder, reaction, ordered, session)
            _write_metadata(folder, reaction, ordered)

            index.append(
                {
                    "reaction_id": reaction.reaction_id,
                    "reaction_name": reaction.reaction_name,
                    "family": reaction.family,
                    "path": folder.name,
                    "files": {
                        "participants": "participants.sdf",
                        "metadata": "reaction.json",
                    },
                    "has_kinetics": bool(reaction.rate_models),
                }
            )

    manifest = {
        "exported_at": exported_at.isoformat(),
        "reaction_count": len(index),
        "roles": ROLE_ORDER,
        "index": index,
    }
    manifest_path = output_dir / f"manifest_{timestamp_slug}.json"
    manifest_path.write_text(json.dumps(manifest, indent=2))


def main():
    parser = argparse.ArgumentParser(description="Export reactions into shareable bundles")
    parser.add_argument("--out", type=Path, required=True, help="Destination directory for export")
    parser.add_argument(
        "--reaction-id",
        type=int,
        nargs="*",
        help="Optional subset of reaction IDs to export (default: all)",
    )
    args = parser.parse_args()

    export_reactions(args.out, args.reaction_id)


if __name__ == "__main__":
    main()
