from __future__ import annotations

from sqlalchemy import select, exists, and_

from sqlalchemy.orm import Session
from db.models import (
    Conformer,
    WellFeatures,
    Reaction,
    ReactionParticipant,
    Species,
    ConformerAtom,
    SpeciesName,
)
from db.engine import session_scope
from db.utils import compute_G_from_HS
from ingest.utils import map_triplet_key_atoms
import unicodedata
from typing import Iterable

ENERGY_TOL = 1e-4  # kJ/mol


def _energy_key(wf: WellFeatures) -> tuple:
    # Choose the first available metric
    if wf.G298 is not None:
        return ("G298", wf.G298)
    if wf.H298 is not None:
        return ("H298", wf.H298)
    if wf.E_elec is not None and wf.ZPE is not None:
        return ("E0", wf.E_elec + wf.ZPE)
    if wf.E_elec is not None:
        return ("E_elec", wf.E_elec)
    return (None, None)


def _ascii_clean(s: str | None) -> str | None:
    if s is None:
        return None
    # NFC normalize then drop non-ASCII
    return unicodedata.normalize("NFC", s).encode("ascii", "ignore").decode()


def relabel_conformers_for_species_lot(session: Session, species_id: int, lot_id: int):
    rows = session.execute(
        select(Conformer, WellFeatures)
        .join(
            WellFeatures,
            WellFeatures.conformer_id == Conformer.conformer_id,
            isouter=True,
        )
        .where(Conformer.species_id == species_id, Conformer.lot_id == lot_id)
    ).all()

    with_energy, no_energy = [], []
    for c, wf in rows:
        if wf is None:
            no_energy.append((c, None))
            continue
        metric, val = _energy_key(wf)
        if metric is None or val is None:
            no_energy.append((c, wf))
        else:
            with_energy.append((c, wf, metric, float(val)))

    if not with_energy:
        for c, _ in no_energy:
            c.well_label = c.well_label or "unknown"
        return

    # Sort deterministically: energy, then geometry_hash, then id
    with_energy.sort(key=lambda t: (t[3], t[0].geometry_hash or "", t[0].conformer_id))

    # Bucket by ENERGY_TOL
    buckets: list[list[tuple[Conformer, float]]] = []
    for c, wf, metric, val in with_energy:
        if not buckets:
            buckets.append([(c, val)])
        else:
            ref_val = buckets[-1][0][1]
            if abs(val - ref_val) <= ENERGY_TOL:
                buckets[-1].append((c, val))
            else:
                buckets.append([(c, val)])

    # Assign ranks, labels, and representative per bucket
    for rank, bucket in enumerate(buckets, start=1):
        base = "well" if rank == 1 else f"iso{rank-1}"
        base = _ascii_clean(base)

        rep_conf = bucket[0][0]
        if hasattr(rep_conf, "is_well_representative"):
            rep_conf.is_well_representative = True

        for j, (c, _) in enumerate(bucket, start=1):
            label = base if len(bucket) == 1 else f"{base}_{chr(96 + j)}"
            c.well_rank = rank
            c.well_label = _ascii_clean(label)
            if hasattr(c, "is_well_representative") and c is not rep_conf:
                c.is_well_representative = False

    # Handle no-energy conformers: CLEAN existing, fallback to 'unknown'
    for c, _ in no_energy:
        c.well_label = _ascii_clean(c.well_label) or "unknown"


def relabel_all():
    with session_scope() as s:
        rows = s.execute(
            select(Conformer.species_id, Conformer.lot_id).distinct()
        ).all()
        for sid, lid in rows:
            relabel_conformers_for_species_lot(s, species_id=sid, lot_id=lid)
        try:
            s.commit()
        except UnicodeEncodeError:
            for obj in list(s.identity_map.values()):
                if isinstance(obj, Conformer):
                    wl = obj.well_label
                    if wl and any(ord(ch) > 127 for ch in wl):
                        print(
                            f"Non-ASCII well_label on conformer {obj.conformer_id}: {wl!r}"
                        )
            raise


def backfill_atom_maps(dry_run: bool = False) -> None:
    """
    Iterate all reactions that have R1H, R2H, and TS participants.
    For each, reconstruct conformer/atom mapping and call map_triplet_key_atoms().
    """
    with session_scope() as session:
        q = select(Reaction).order_by(Reaction.reaction_id)
        reactions = session.scalars(q).all()
        print(f"Found {len(reactions)} reactions")

        updated = 0
        for rxn in reactions:
            # gather conformers by role
            conf_id_by_role: dict[str, int] = {}
            idx2id_by_role: dict[str, dict[int, int]] = {}

            parts = session.scalars(
                select(ReactionParticipant).where(
                    ReactionParticipant.reaction_id == rxn.reaction_id
                )
            ).all()
            for p in parts:
                role = p.role.upper()
                conf = session.get(Conformer, p.conformer_id)
                if not conf:
                    continue
                conf_id_by_role[role] = conf.conformer_id

                # build index: atom_idx -> atom_id
                idx2id: dict[int, int] = {}
                atoms = session.scalars(
                    select(ConformerAtom).where(
                        ConformerAtom.conformer_id == conf.conformer_id
                    )
                ).all()
                for a in atoms:
                    idx2id[a.atom_idx] = a.atom_id
                idx2id_by_role[role] = idx2id

            if not all(r in conf_id_by_role for r in ("R1H", "R2H", "TS")):
                continue  # skip incomplete triplets

            # get TS props from Species.props JSON
            ts_conf = session.get(Conformer, conf_id_by_role["TS"])
            ts_species = session.get(Species, ts_conf.species_id) if ts_conf else None
            ts_props = ts_species.props if ts_species else {}

            if not ts_props:
                continue

            if not dry_run:
                map_triplet_key_atoms(
                    session,
                    conf_id_by_role=conf_id_by_role,
                    idx2id_by_role=idx2id_by_role,
                    ts_props=ts_props,
                )
                updated += 1
            else:
                print(f"[DRY RUN] Would map atoms for rxn {rxn.reaction_name}")

        if not dry_run:
            session.commit()
            print(f"Backfilled atom maps for {updated} reactions")
        else:
            print(f"Dry run finished: {updated} reactions eligible")


def backfill_missing_G298(
    T: float = 298.15, prefer_user: bool = True, write_meta: bool = True
) -> int:
    """
    Compute G298 from H298 and S298 where G298 is missing or (optionally) where units are wrong.
    Returns number of rows updated.
    """
    updated = 0
    with session_scope() as session:
        # fetch rows that either have G298 missing or G298_units not set to kJ/mol
        q = select(WellFeatures).where(
            (WellFeatures.G298.is_(None))
            | (WellFeatures.G298_units.is_(None))
            | (WellFeatures.G298_units != "kJ/mol")
        )
        rows = session.scalars(q).all()

        for wf in rows:
            # if user already provided a numeric G298 with some units and you want to keep it, skip
            if prefer_user and wf.G298 is not None and wf.G298_units:
                # normalize to kJ/mol if we can
                if wf.G298_units.lower() == "kcal/mol":
                    wf.G298 = wf.G298 * 4.184
                    wf.G298_units = "kJ/mol"
                    # provenance stays as user since value came from user
                    if hasattr(wf, "G298_source") and not wf.G298_source:
                        wf.G298_source = "user"
                    if write_meta:
                        wf.meta = (wf.meta or {}) | {
                            "G298_source": wf.meta.get("G298_source", "user")
                        }
                    updated += 1
                continue

            # Try compute from H and S
            G = compute_G_from_HS(wf.H298, wf.H298_units, wf.S298, wf.S298_units, T=T)
            if G is None:
                continue

            wf.G298 = float(G)
            wf.G298_units = "kJ/mol"

            # provenance
            if hasattr(wf, "G298_source"):
                wf.G298_source = "backend"
            if hasattr(wf, "G_calc_T_K"):
                wf.G_calc_T_K = T
            if write_meta:
                wf.meta = (wf.meta or {}) | {"G298_source": "backend", "G_calc_T_K": T}

            updated += 1

        if updated:
            session.commit()
    return updated


def iter_species(
    db: Session,
    only_missing: bool,
    only_missing_primary: bool,
    start_id: int | None,
    limit: int | None,
) -> Iterable[Species]:
    q = select(Species)
    if start_id:
        q = q.where(Species.species_id >= start_id)
    if only_missing:
        # no names at all
        q = q.where(~exists().where(SpeciesName.species_id == Species.species_id))
    if only_missing_primary:
        # has names but none marked primary
        q = q.where(exists().where(SpeciesName.species_id == Species.species_id)).where(
            ~exists().where(
                and_(
                    SpeciesName.species_id == Species.species_id,
                    SpeciesName.is_primary.is_(True),
                )
            )
        )
    q = q.order_by(Species.species_id.asc())
    if limit:
        q = q.limit(limit)
    for sp in db.execute(q).scalars():
        yield sp


def main():
    import argparse

    p = argparse.ArgumentParser(description="Database maintenance tasks")
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Perform a dry run without making changes",
    )
    args = p.parse_args()
    relabel_all()
    backfill_atom_maps(dry_run=args.dry_run)
    g298_n = backfill_missing_G298(T=298.15, prefer_user=True, write_meta=True)
    print(f"Backfilled G298 for {g298_n} conformers")


if __name__ == "__main__":
    main()
