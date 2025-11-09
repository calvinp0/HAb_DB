# api/routers/species.py
from typing import List, Optional, Literal
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, aliased
from rdkit import Chem

from api.deps import get_db
from db.models import Species, SpeciesName, ExternalIdentifier, Conformer, TSFeatures
from api.schemas.species import (
    SpeciesOut,
    SpeciesDetailOut,
    SpeciesNameOut,
    ExternalIdOut,
)
from api.services.chemid import (
    canonical_smiles,
    canonical_smiles_no_stereo,
    validate_inchikey,
    inchikey_from_smiles,
    rd_inchi,
    looks_like_inchikey,
    looks_like_inchi,
    smiles_without_explicit_h,
)
from api.routers.utils import elem_counts_from_smiles, includes_elements
from sqlalchemy import exists, and_, or_, func

KCAL_TO_KJ = 4.184

router = APIRouter(prefix="/species", tags=["species"])


def _pick_attr(model_or_alias, *candidates: str):
    """Return the first present InstrumentedAttribute from candidates, else None."""
    for name in candidates:
        if hasattr(model_or_alias, name):
            return getattr(model_or_alias, name)
    return None


def _safe_inchikey_from_smiles(can: str) -> Optional[str]:
    try:
        return inchikey_from_smiles(can)
    except Exception:
        return None


def _inchikey_connectivity_block(ik: Optional[str]) -> Optional[str]:
    if not ik:
        return None
    return ik.split("-")[0]


def apply_ts_filter(
    qry,
    ts_only: bool | None,
    include_ts: bool | None,
    require_imag: bool | None = None,
    de_min_kcal: float | None = None,
    de_max_kcal: float | None = None,
):
    """
    Constrain to species for which a matching TS conformer exists.
    - ts_only=True   -> keep only species with a matching TS conformer
    - include_ts=False -> exclude any species that has a TS conformer
    - Extra filters (imag freq / ΔE window) are applied only when ts_only or include_ts is truthy.
    """
    cf = aliased(Conformer)

    # Base predicates (must have at least one TS conformer)
    conds = [cf.species_id == Species.species_id]

    # boolean column for TS
    is_ts_col = _pick_attr(cf, "is_ts", "isTransitionState", "is_ts_flag")
    if is_ts_col is not None:
        conds.append(is_ts_col.is_(True))

    # ΔE window (kcal -> kJ) if we can find an energy column
    e_ts_col = _pick_attr(
        cf,
        "e_ts",  # common
        "E_TS",  # unlikely on ORM, but try
        "delta_e_ts_kj",  # other plausible names
        "e_ts_kj",
        "e_ts_kj_mol",
    )
    if e_ts_col is not None:
        if de_min_kcal is not None:
            conds.append(e_ts_col >= de_min_kcal * KCAL_TO_KJ)
        if de_max_kcal is not None:
            conds.append(e_ts_col <= de_max_kcal * KCAL_TO_KJ)

    # ≥1 imaginary frequency via TSFeatures if available
    if require_imag:
        try:
            tf = aliased(TSFeatures)  # or TsFeatures depending on your import
            tf_fk = _pick_attr(tf, "conformer_id", "conformerId", "conf_id")
            imag_col = _pick_attr(
                tf,
                "imag_count",
                "n_imag",
                "num_imag",
                "n_imaginary",
                "n_imag_freq",
                "imaginary_count",
            )
            if tf_fk is not None and imag_col is not None:
                conds.append(
                    tf_fk == _pick_attr(cf, "conformer_id", "id", "conformerId")
                )
                conds.append(imag_col > 0)
            else:
                # Fall back to a column on Conformer if it exists
                cf_imag_col = _pick_attr(cf, "n_imag", "imag_count", "num_imag")
                if cf_imag_col is not None:
                    conds.append(cf_imag_col > 0)
        except Exception:
            # If TSFeatures model/columns aren’t present, silently ignore the imag filter
            pass

    ts_exists = exists().where(and_(*conds))

    if ts_only:
        return qry.filter(ts_exists)
    if include_ts is False:
        return qry.filter(~ts_exists)
    if include_ts:
        # TS tab asked to include TS, so enforce the (possibly extra) TS conditions
        return qry.filter(ts_exists)
    return qry


def _heavy_atoms_for_species(sp: Species) -> Optional[int]:
    """Return heavy-atom count from cached props or RDKit; None if unknown."""
    try:
        if sp.props:
            ha = sp.props.get("heavy_atoms")
            if isinstance(ha, int):
                return ha
        if sp.smiles:
            mol = Chem.MolFromSmiles(sp.smiles)
            return int(mol.GetNumHeavyAtoms()) if mol else None
    except Exception:
        pass
    return None


def _serialize_species_list(rows: list[Species]) -> list[SpeciesOut]:
    out = []
    for sp in rows:
        out.append(
            SpeciesOut.model_validate(
                {
                    "species_id": sp.species_id,
                    "smiles": sp.smiles,
                    "smiles_no_h": (
                        smiles_without_explicit_h(sp.smiles) if sp.smiles else None
                    ),
                    "inchikey": sp.inchikey,
                    "charge": sp.charge,
                    "spin_multiplicity": sp.spin_multiplicity,
                    "mw": sp.mw,
                    "is_ts": bool(sp.props and sp.props.get("type") == "ts"),
                }
            )
        )
    return out


@router.get("/search", response_model=list[SpeciesOut])
def search_species(
    q: Optional[str] = Query(
        None, description="Name or SMILES (InChIKey supported too)"
    ),
    smarts: Optional[str] = Query(
        None, description="SMARTS substructure pattern (mutually exclusive with q/inchi)"
    ),
    inchi: Optional[str] = Query(
        None, description="InChI string to match (mutually exclusive with q/smarts)"
    ),
    db: Session = Depends(get_db),
    include_ts: bool | None = Query(
        None, description="Include transition states (TS) in results"
    ),
    ts_only: bool | None = Query(
        None, description="Only include transition states (TS) in results"
    ),
    # NEW — TS-specific filters (used when ts_only or include_ts is set)
    require_imag: bool | None = Query(
        None, description="TS must have ≥1 imaginary frequency"
    ),
    de_min_kcal: float | None = Query(None, ge=0, description="Min ΔE (kcal/mol)"),
    de_max_kcal: float | None = Query(None, ge=0, description="Max ΔE (kcal/mol)"),
    # Composition filters (used only when q is empty)
    elements: Optional[str] = Query(
        None, description="Comma-separated element symbols, e.g. C,N,S"
    ),
    elem_mode: Literal["all", "any"] = Query("all"),
    max_heavy_atoms: Optional[int] = Query(None, ge=0),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    require_stereo: bool = Query(
        False,
        description="Require stereochemistry to match when searching by SMILES/InChI",
    ),
):
    rows: List[Species] = []

    if q and looks_like_inchi(q):
        if inchi:
            raise HTTPException(
                status_code=400,
                detail="Provide only one of q, smarts, or inchi for structure searches",
            )
        inchi = q.strip()
        q = None

    if sum(bool(x) for x in (q, smarts, inchi)) > 1:
        raise HTTPException(
            status_code=400,
            detail="Provide only one of q, smarts, or inchi for structure searches",
        )

    # SMARTS substructure search
    if smarts:
        pattern = Chem.MolFromSmarts(smarts)
        if not pattern:
            raise HTTPException(status_code=400, detail="Invalid SMARTS pattern")

        qry = db.query(Species).filter(Species.smiles.isnot(None))
        qry = apply_ts_filter(
            qry,
            ts_only=ts_only,
            include_ts=include_ts,
            require_imag=require_imag,
            de_min_kcal=de_min_kcal,
            de_max_kcal=de_max_kcal,
        ).order_by(Species.species_id.asc())

        matches: List[Species] = []
        skipped = 0
        for sp in qry.yield_per(200):
            try:
                mol = Chem.MolFromSmiles(sp.smiles or "")
            except Exception:
                mol = None
            if mol and mol.HasSubstructMatch(pattern):
                if skipped < offset:
                    skipped += 1
                    continue
                matches.append(sp)
                if len(matches) >= limit:
                    break

        return _serialize_species_list(matches)

    # InChI search
    if inchi:
        if rd_inchi is None:
            raise HTTPException(
                status_code=501,
                detail="RDKit InChI support is unavailable on this server",
            )
        try:
            mol = rd_inchi.MolFromInchi(inchi)
            if mol is None:
                raise ValueError("Could not parse InChI")
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Invalid InChI: {exc}")

        can = Chem.MolToSmiles(mol, canonical=True, isomericSmiles=True)
        try:
            inchi_key = rd_inchi.MolToInchiKey(mol)
        except Exception:
            inchi_key = None

        achiral = None
        try:
            achiral = canonical_smiles_no_stereo(can)
        except Exception:
            achiral = None

        filters = []
        if inchi_key:
            block = _inchikey_connectivity_block(inchi_key)
            if require_stereo:
                filters.append(Species.inchikey == inchi_key)
            elif block:
                filters.append(func.substr(Species.inchikey, 1, 14) == block)
        if can:
            filters.append(Species.smiles == can)
        if not require_stereo and achiral and achiral != can:
            filters.append(Species.smiles == achiral)
        if not filters:
            raise HTTPException(
                status_code=400, detail="Unable to derive search keys from InChI"
            )

        qry = db.query(Species).filter(or_(*filters))
        qry = apply_ts_filter(
            qry,
            ts_only=ts_only,
            include_ts=include_ts,
            require_imag=require_imag,
            de_min_kcal=de_min_kcal,
            de_max_kcal=de_max_kcal,
        ).order_by(Species.species_id.asc())
        qry = qry.limit(limit).offset(offset)

        rows = qry.all()
        return _serialize_species_list(rows)

    # ---------- Structure / name search (when q is provided)
    if q and q.strip():
        query = q.strip()

        # (1) InChIKey
        if looks_like_inchikey(query):
            qry = db.query(Species).filter(Species.inchikey == validate_inchikey(query))
            qry = apply_ts_filter(
                qry,
                ts_only=ts_only,
                include_ts=include_ts,
                require_imag=require_imag,
                de_min_kcal=de_min_kcal,
                de_max_kcal=de_max_kcal,
            )
            rows = (
                qry.order_by(Species.species_id.asc()).offset(offset).limit(limit).all()
            )
            return _serialize_species_list(rows)

        # (2) SMILES
        try:
            can = canonical_smiles(query)
            try:
                achiral = canonical_smiles_no_stereo(query)
            except Exception:
                achiral = None
            ik = None
            ik_block = None
            if rd_inchi is not None:
                try:
                    ik = inchikey_from_smiles(can)
                    ik_block = _inchikey_connectivity_block(ik)
                except Exception:
                    ik = None

            filters = []
            if ik:
                if require_stereo:
                    filters.append(Species.inchikey == ik)
                elif ik_block:
                    filters.append(func.substr(Species.inchikey, 1, 14) == ik_block)
            filters.append(Species.smiles == can)
            if not require_stereo and achiral and achiral != can:
                filters.append(Species.smiles == achiral)

            qry = db.query(Species).filter(or_(*filters))
            qry = apply_ts_filter(
                qry,
                ts_only=ts_only,
                include_ts=include_ts,
                require_imag=require_imag,
                de_min_kcal=de_min_kcal,
                de_max_kcal=de_max_kcal,
            )
            rows = (
                qry.order_by(Species.species_id.asc()).offset(offset).limit(limit).all()
            )
            if rows:
                return _serialize_species_list(rows)

        except ValueError:
            pass  # not valid SMILES -> fall through

        # (3) name contains
        qry = (
            db.query(Species)
            .join(Species.names)
            .filter(SpeciesName.name.ilike(f"%{query}%"))
            .distinct(Species.species_id)
        )
        qry = apply_ts_filter(
            qry, ts_only, include_ts, require_imag, de_min_kcal, de_max_kcal
        )
        rows = qry.order_by(Species.species_id.asc()).offset(offset).limit(limit).all()
        return _serialize_species_list(rows)

    # ---------- Composition search (when q is empty)
    qry = db.query(Species)

    # TS filters first (query-level)
    qry = apply_ts_filter(
        qry,
        ts_only=ts_only,
        include_ts=include_ts,
        require_imag=require_imag,
        de_min_kcal=de_min_kcal,
        de_max_kcal=de_max_kcal,
    )

    if max_heavy_atoms is not None:
        qry = qry.filter(
            Species.heavy_atoms.isnot(None),
            Species.heavy_atoms <= max_heavy_atoms,
        )

    # SQL-level elements filter via JSONB key existence

    if elements:
        wanted = [e.strip().capitalize() for e in elements.split(",") if e.strip()]
        if wanted:
            qry = qry.filter(Species.elements_json.isnot(None))
            if elem_mode == "all":
                # ALL keys must exist
                qry = qry.filter(
                    and_(*[Species.elements_json.has_key(w) for w in wanted])
                )
            else:
                # ANY key may exist
                qry = qry.filter(
                    or_(*[Species.elements_json.has_key(w) for w in wanted])
                )

    rows = qry.order_by(Species.species_id.asc()).offset(offset).limit(limit).all()

    return _serialize_species_list(rows)
