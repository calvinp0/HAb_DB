from __future__ import annotations
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload, aliased
from sqlalchemy import and_, or_, exists


from api.deps import get_db
from db.models import (
    Reaction,
    ReactionParticipant,
    Conformer,
    Species,
    LevelOfTheory,
    RateModel,
    SpeciesName,
)
from api.schemas.reactions import ReactionSummaryOut, RxnSideOut
from api.routers.species import looks_like_inchikey  # reuse helper
from api.services.chemid import (
    canonical_smiles,
    inchikey_from_smiles,
    smiles_without_explicit_h,
)
from sqlalchemy.sql import func


router = APIRouter(prefix="/reactions", tags=["reactions"])

MOL_ROLE_REACTANT = "R1H"
MOL_ROLE_PRODUCT = "R2H"
MOL_ROLE_TS = "TS"


def _species_ids_from_query(db: Session, q: str) -> list[int]:
    q = q.strip()
    if not q:
        return []

    # InChIKey
    if looks_like_inchikey(q):
        return [
            sid
            for (sid,) in db.query(Species.species_id)
            .filter(Species.inchikey == q)
            .all()
        ]

    # SMILES → inchikey preferred, else smiles
    try:
        can = canonical_smiles(q)
        try:
            ik = inchikey_from_smiles(can)
        except Exception:
            ik = None

        if ik:
            ids = [
                sid
                for (sid,) in db.query(Species.species_id)
                .filter(Species.inchikey == ik)
                .all()
            ]
            if ids:
                return ids

        ids = [
            sid
            for (sid,) in db.query(Species.species_id)
            .filter(Species.smiles == can)
            .all()
        ]
        if ids:
            return ids
    except Exception:
        pass

    # Name contains
    return [
        sid
        for (sid,) in (
            db.query(SpeciesName.species_id)
            .filter(SpeciesName.name.ilike(f"%{q}%"))
            .distinct(SpeciesName.species_id)
            .all()
        )
    ]


@router.get("/search", response_model=List[ReactionSummaryOut])
def search_reactions(
    db: Session = Depends(get_db),
    reactant_q: Optional[str] = Query(
        None, description="Reactant SMILES/name/InChIKey"
    ),
    product_q: Optional[str] = Query(None, description="Product SMILES/name/InChIKey"),
    family: Optional[str] = Query(None, description="Reaction family"),
    limit: int = Query(
        100, ge=1, le=1000, description="Max number of results to return"
    ),
    offset: int = Query(0, ge=0, description="Offset for pagination"),
):
    if not reactant_q and not product_q:
        return []

    reactant_ids: List[int] = (
        _species_ids_from_query(db, reactant_q) if reactant_q else []
    )
    product_ids: List[int] = _species_ids_from_query(db, product_q) if product_q else []

    # Base Query
    rq = db.query(Reaction)

    if family:
        rq = rq.filter(Reaction.family == family)

    # Built EXISTS subqueries to enforce sides
    if reactant_ids:
        rp_r = aliased(ReactionParticipant)
        conf_r = aliased(Conformer)
        cond_r = exists().where(
            and_(
                rp_r.reaction_id == Reaction.reaction_id,
                rp_r.role == MOL_ROLE_REACTANT,
                rp_r.conformer_id == conf_r.conformer_id,
                conf_r.species_id.in_(reactant_ids),
            )
        )
        rq = rq.filter(cond_r)

    if product_ids:
        rp_p = aliased(ReactionParticipant)
        conf_p = aliased(Conformer)
        cond_p = exists().where(
            and_(
                rp_p.reaction_id == Reaction.reaction_id,
                rp_p.role == MOL_ROLE_PRODUCT,
                rp_p.conformer_id == conf_p.conformer_id,
                conf_p.species_id.in_(product_ids),
            )
        )
        rq = rq.filter(cond_p)

    # Eager load (definition: eager load is when related entities are loaded at the same time as the main entity) participants -> conformer -> species/lot
    rq = (
        rq.options(
            joinedload(Reaction.participants)
            .joinedload(ReactionParticipant.conformer)
            .joinedload(Conformer.species),
            joinedload(Reaction.participants)
            .joinedload(ReactionParticipant.conformer)
            .joinedload(Conformer.geom_lot),
        )
        .order_by(Reaction.reaction_id.asc())
        .offset(offset)
        .limit(limit)
    )

    rows = rq.all()

    kcounts = dict(
        db.query(RateModel.reaction_id, func.count(RateModel.rate_model_id))
        .group_by(RateModel.reaction_id)
        .all()
    )

    out: list[ReactionSummaryOut] = []

    for rxn in rows:
        parts: list[RxnSideOut] = []

        for p in rxn.participants:
            sp = p.conformer.species if p.conformer else None
            lot = p.conformer.geom_lot if p.conformer else None

            if (p.conformer and p.conformer.is_ts) or (p.role == MOL_ROLE_TS):
                ui_role = "ts"
            elif p.role == MOL_ROLE_REACTANT:
                ui_role = "reactant"
            elif p.role == MOL_ROLE_PRODUCT:
                ui_role = "product"
            else:
                ui_role = "reactant"

            parts.append(
                RxnSideOut(
                    role=ui_role,
                    conformer_id=p.conformer_id,
                    species_id=sp.species_id if sp else -1,
                    smiles=(sp.smiles if sp else None),
                    smiles_no_h=(smiles_without_explicit_h(sp.smiles) if sp else None),
                    lot=(
                        {
                            "lot_string": lot.lot_string,
                            "method": lot.method,
                            "basis": lot.basis,
                            "solvent": lot.solvent,
                        }
                        if lot
                        else None
                    ),
                    is_ts=(bool(p.conformer.is_ts) if p.conformer else None),
                )
            )

        order = {"reactant": 0, "product": 1, "ts": 2}
        parts.sort(key=lambda x: order.get(x.role, 99))

        out.append(
            ReactionSummaryOut(
                reaction_id=rxn.reaction_id,
                family=rxn.family,
                reaction_name=getattr(rxn, "reaction_name", None),
                participants=parts,
                ksets_count=int(kcounts.get(rxn.reaction_id, 0)),
            )
        )

    return out


@router.get("/{reaction_id}")
def get_reaction_detail(reaction_id: int, db: Session = Depends(get_db)):
    """
    Return one reaction with participants (incl. conformer + LoT) and rate models

    """
    # Eager-load particpants -> conformer -> species/lot and rate models
    rxn = (
        db.query(Reaction)
        .options(
            joinedload(Reaction.participants)
            .joinedload(ReactionParticipant.conformer)
            .joinedload(Conformer.geom_lot),
            joinedload(Reaction.participants)
            .joinedload(ReactionParticipant.conformer)
            .joinedload(Conformer.species),
            joinedload(Reaction.rate_models),
        )
        .filter(Reaction.reaction_id == reaction_id)
        .first()
    )

    if not rxn:
        raise HTTPException(status_code=404, detail=f"Reaction {reaction_id} not found")

    parts = []
    for rp in rxn.participants:
        c = rp.conformer
        if not c:
            # Skip the weird rows without conformers
            continue
        lot = c.geom_lot
        parts.append(
            {
                "role": rp.role,
                "conformer": {
                    "conformer_id": c.conformer_id,
                    "species_id": c.species_id,
                    "is_ts": bool(getattr(c, "is_ts", False)),
                    "well_label": getattr(c, "well_label", None),
                    "well_rank": getattr(c, "well_rank", None),
                    "lot": (
                        {
                            "lot_id": getattr(lot, "lot_id", None),
                            "method": getattr(lot, "method", None),
                            "basis": getattr(lot, "basis", None),
                            "solvent": getattr(lot, "solvent", None),
                            "lot_string": getattr(lot, "lot_string", None),
                        }
                        if lot
                        else None
                    ),
                    "G298": getattr(c, "G298", None),
                    "H298": getattr(c, "H298", None),
                    "E_elec": getattr(c, "E_elec", None),
                    "ZPE": getattr(c, "ZPE", None),
                    "E0": getattr(c, "E0", None),
                    "E_TS": getattr(c, "E_TS", None),
                },
            }
        )
    rms = []
    for rm in getattr(rxn, "rate_models", []):
        rms.append(
            {
                "rate_model_id": rm.rate_model_id,
                "direction": rm.direction,  # "forward" | "reverse"
                "model": rm.model,  # "Arrhenius" | "ModifiedArrhenius"
                "A": rm.A,
                "n": rm.n,
                "Ea_kJ_mol": rm.Ea_kJ_mol,
                "Tmin_K": rm.Tmin_K,
                "Tmax_K": rm.Tmax_K,
                "source": getattr(rm, "source", None),
                "reference": getattr(rm, "reference", None),
            }
        )

    return {
        "reaction_id": rxn.reaction_id,
        "reaction_name": getattr(rxn, "reaction_name", None),
        "family": rxn.family,
        "batch": (
            {
                "batch_id": getattr(rxn, "batch_id", None),
                "source_label": getattr(
                    getattr(rxn, "batch", None), "source_label", None
                ),
            }
            if getattr(rxn, "batch_id", None) is not None
            else None
        ),
        "participants": parts,
        "rate_models": rms,
    }
