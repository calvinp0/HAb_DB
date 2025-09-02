# api/routers/conformers.py
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import and_
from typing import Optional

from api.deps import get_db
from db.models import (
    Conformer,
    Species,
    LevelOfTheory,
    WellFeatures,
    TSFeatures,
    LevelOfTheory,
    ConformerAtom,
    SpeciesName,
)
from api.schemas.conformers import ConformerRow, LevelOfTheoryOut, ConformerDetailOut
from api.services.chemid import _safe_smiles_no_h

species_scoped = APIRouter(prefix="/species", tags=["conformers"])


def pick_energy(is_ts: bool, wf: WellFeatures | None, tf: TSFeatures | None):
    """
    Returns (label, value) in kJ/mol when available.
    Order for wells: G298 > H298 > (E_elec + ZPE) > E_elec
    For TS: prefer E_TS if present, else fall back to well logic.
    """
    if is_ts and tf and tf.E_TS is not None:
        return "E_TS", float(tf.E_TS)
    if wf:
        if wf.G298 is not None:
            return "G298", float(wf.G298)
        if wf.H298 is not None:
            return "H298", float(wf.H298)
        if wf.E_elec is not None and wf.ZPE is not None:
            return "E0", float(wf.E_elec + wf.ZPE)
        if wf.E_elec is not None:
            return "E_elec", float(wf.E_elec)
    return None, None


def _atoms_to_xyz(rows) -> str:
    """Build XYZ text from conformer_atom rows ordered by atom_idx."""
    Z2SYM = {
        1: "H",
        6: "C",
        7: "N",
        8: "O",
        9: "F",
        15: "P",
        16: "S",
        17: "Cl",
        35: "Br",
        53: "I",
    }
    lines = []
    for r in rows:
        sym = Z2SYM.get(r.atomic_num) or str(r.atomic_num)
        x, y, z = r.xyz or [None, None, None]
        lines.append(f"{sym} {x:.6f} {y:.6f} {z:.6f}")
    return (
        f"{len(rows)}\nconformer {rows[0].conformer_id if rows else ''}\n"
        + "\n".join(lines)
    )


@species_scoped.get("/{species_id}/conformers", response_model=list[ConformerRow])
def list_species_conformers(
    species_id: int,
    db: Session = Depends(get_db),
    lot_id: Optional[int] = Query(None),
    is_ts: Optional[bool] = Query(None),
    representative_only: bool = Query(
        False, description="One per well (representatives)"
    ),
    well_rank: Optional[int] = Query(None, ge=1),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    if not db.get(Species, species_id):
        raise HTTPException(404, "Species not found")

    q = (
        db.query(Conformer, LevelOfTheory, WellFeatures, TSFeatures)
        .join(LevelOfTheory, Conformer.lot_id == LevelOfTheory.lot_id)
        .outerjoin(WellFeatures, WellFeatures.conformer_id == Conformer.conformer_id)
        .outerjoin(
            TSFeatures,
            and_(
                TSFeatures.conformer_id == Conformer.conformer_id,
                TSFeatures.lot_id == Conformer.lot_id,
            ),
        )
        .filter(Conformer.species_id == species_id)
    )
    if lot_id is not None:
        q = q.filter(Conformer.lot_id == lot_id)
    if is_ts is not None:
        q = q.filter(Conformer.is_ts.is_(is_ts))
    if representative_only:
        q = q.filter(Conformer.is_well_representative.is_(True))
    if well_rank is not None:
        q = q.filter(Conformer.well_rank == well_rank)

    q = (
        q.order_by(
            Conformer.is_ts.desc(),
            Conformer.well_rank.asc().nulls_last(),
            Conformer.conformer_id.asc(),
        )
        .offset(offset)
        .limit(limit)
    )

    rows = q.all()

    out: list[ConformerRow] = []
    for c, lot, wf, tf in rows:
        e0 = (
            float(wf.E_elec + wf.ZPE)
            if (wf and wf.E_elec is not None and wf.ZPE is not None)
            else None
        )
        out.append(
            ConformerRow.model_validate(
                {
                    "conformer_id": c.conformer_id,  # <-- add
                    "species_id": c.species_id,  # <-- add
                    "lot": LevelOfTheoryOut.model_validate(lot) if lot else None,
                    "is_ts": bool(c.is_ts),
                    "is_well_representative": bool(c.is_well_representative),
                    "well_label": c.well_label,
                    "well_rank": c.well_rank,
                    "G298": getattr(wf, "G298", None) if wf else None,
                    "H298": getattr(wf, "H298", None) if wf else None,
                    "E_elec": getattr(wf, "E_elec", None) if wf else None,
                    "ZPE": getattr(wf, "ZPE", None) if wf else None,
                    "E0": e0,
                    "E_TS": getattr(tf, "E_TS", None) if tf else None,
                }
            )
        )
    return out


conformer_detail = APIRouter(prefix="/conformers", tags=["conformers"])


@conformer_detail.get("/{conformer_id}", response_model=ConformerDetailOut)
def get_conformer(conformer_id: int, db: Session = Depends(get_db)):
    conformer = db.get(Conformer, conformer_id)
    if not conformer:
        raise HTTPException(404, "Conformer not found")
    lot = db.get(LevelOfTheory, conformer.lot_id)
    species = db.get(Species, conformer.species_id)
    wf = (
        db.query(WellFeatures).filter(WellFeatures.conformer_id == conformer_id).first()
    )
    tf = (
        db.query(TSFeatures)
        .filter(
            TSFeatures.conformer_id == conformer_id,
            TSFeatures.lot_id == conformer.lot_id,
        )
        .first()
    )
    e0 = None
    if wf and wf.E_elec is not None and wf.ZPE is not None:
        e0 = float(wf.E_elec + wf.ZPE)
    label, value = pick_energy(bool(conformer.is_ts), wf, tf)

    # Build XYZ
    geom_xyz = None
    if not getattr(conformer, "geom_xyz", None):
        atoms = (
            db.query(ConformerAtom)
            .filter(ConformerAtom.conformer_id == conformer_id)
            .order_by(ConformerAtom.atom_idx.asc())
            .all()
        )
        if atoms:
            geom_xyz = _atoms_to_xyz(atoms)

    names = _fetch_species_names(db, conformer.species_id)
    display_name = None
    if names:
        primary = next((n for n in names if n["is_primary"]), None)
        display_name = (primary or names[0])["name"]

    return ConformerDetailOut.model_validate(
        {
            "conformer_id": conformer.conformer_id,
            "species_id": conformer.species_id,
            "smiles": getattr(species, "smiles", None) if species else None,
            "smiles_no_h": (
                _safe_smiles_no_h(getattr(species, "smiles", None)) if species else None
            ),
            "lot": LevelOfTheoryOut.model_validate(lot) if lot else None,
            "is_ts": bool(conformer.is_ts),
            "is_well_representative": bool(conformer.is_well_representative),
            "well_label": conformer.well_label,
            "well_rank": conformer.well_rank,
            "G298": getattr(wf, "G298", None) if wf else None,
            "H298": getattr(wf, "H298", None) if wf else None,
            "E_elec": getattr(wf, "E_elec", None) if wf else None,
            "ZPE": getattr(wf, "ZPE", None) if wf else None,
            "E0": e0,
            "E_TS": getattr(tf, "E_TS", None) if tf else None,
            "energy_label": label,
            "energy_value": value,
            "geom_xyz": getattr(conformer, "geom_xyz", None) or geom_xyz,
            "n_imag": getattr(tf, "n_imag", None) if tf else None,
            "imag_freqs": getattr(tf, "imag_freqs", []) if tf else [],
            "frequencies": getattr(tf, "frequencies", []) if tf else [],
            "props": None,
            "display_name": display_name,
            "names": names,
        }
    )


def _fetch_species_names(db: Session, species_id: int) -> list[dict]:
    # order: primary → curated → source_priority asc → rank asc → name asc
    rows = (
        db.query(
            SpeciesName.name,
            SpeciesName.kind,
            SpeciesName.lang,
            SpeciesName.source,
            SpeciesName.is_primary,
            SpeciesName.rank,
            SpeciesName.curated,
            SpeciesName.source_priority,
        )
        .filter(SpeciesName.species_id == species_id)
        .order_by(
            SpeciesName.is_primary.desc(),
            SpeciesName.curated.desc(),
            SpeciesName.source_priority.asc(),
            SpeciesName.rank.asc(),
            SpeciesName.name.asc(),
        )
        .all()
    )
    out = []
    for r in rows:
        src = r.source.name if hasattr(r.source, "name") else str(r.source)
        out.append(
            dict(
                name=r.name,
                kind=r.kind,
                lang=r.lang,
                source=src,
                is_primary=bool(r.is_primary),
                rank=int(r.rank),
                curated=bool(r.curated),
                source_priority=int(r.source_priority),
            )
        )
    return out
