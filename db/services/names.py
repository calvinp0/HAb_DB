from sqlalchemy import select
from sqlalchemy.orm import Session
from typing import Iterable, Tuple
import time

from db.services.cactus import cactus_name_by_identifier
from db.services.opsin import opsin_iupac_from_smiles
from db.services.pubchem import pubchem_by_inchikey
import unicodedata
from db.models import Species, SpeciesName, ExternalIdentifier, ExternalDB, NameSource

import re

CAS_RE = re.compile(r"^\d{2,7}-\d{2}-\d$")
CODEY_RE = re.compile(r"^[A-Za-z]\d{3,}$")
MAX_PUBCHEM_SYNS = 5
MAX_CACTUS_SYNS = 5
SOURCE_PRIORITY = {
    "user": 0,
    "rmg": 5,
    "pubchem": 10,
    "cactus": 20,
    "opsin": 30,
    "other": 40,
}


def _keep_synonym(s: str) -> bool:
    # drop registry numbers and codes; keep human names
    if CAS_RE.match(s):
        return False
    if CODEY_RE.match(s):
        return False
    if len(s) <= 2:
        return False
    if s.upper() == s and len(s) > 20:
        return False
    return True


def _normalize_name(s: str) -> str:
    # NFKC + strip + collapse whitespace + casefold (stronger than lower)
    s = unicodedata.normalize("NFKC", s).strip()
    s = " ".join(s.split())
    return s.casefold()


def _classify_kind(name: str) -> str:
    # keep it simple; upgrade later if you want registry-number filtering
    return (
        "iupac"
        if any(k in name.lower() for k in ("acid", "oxide", "methane", "ethane"))
        else "synonym"
    )


def _add_name_row(
    db: Session,
    species_id: int,
    name: str,
    source: NameSource,
    kind: str,
    rank: int,
    meta: dict | None = None,
) -> None:
    sn = SpeciesName(
        species_id=species_id,
        name=name,
        kind=kind,
        source=source,
        is_primary=False,
        rank=rank,
        lang="en",
    )
    # optional columns
    if hasattr(SpeciesName, "curated"):
        sn.curated = False
    if hasattr(SpeciesName, "source_priority"):
        sn.source_priority = SOURCE_PRIORITY.get(source.value, 50)
    # your renamed JSONB column:
    if hasattr(SpeciesName, "meta_data"):
        sn.meta_data = meta or {}
    db.add(sn)


from sqlalchemy.dialects.postgresql import insert as pg_insert


def _bulk_insert_names(db: Session, rows: list[dict]) -> int:
    if not rows:
        return 0
    table = SpeciesName.__table__
    stmt = pg_insert(table).values(rows)
    # your constraint name is "uq_species_name" (from your error)
    stmt = stmt.on_conflict_do_nothing(constraint="uq_species_name")
    res = db.execute(stmt)
    # rowcount may be None on some drivers; coalesce to 0
    return int(res.rowcount or 0)


def upsert_names_for_species(
    db: Session, species: Species, trace: bool = False, budget_s: float = 45.0
) -> dict:
    """
    Auto-only: gathers names from PubChem, Cactus, then OPSIN.
    - idempotent (skips existing)
    - assigns primary unless a curated primary already exists
    - never demotes curated primary
    Returns a small report dict.
    """
    t0 = time.monotonic()

    def remaining():
        return budget_s - (time.monotonic() - t0)

    def timed(label, func, *a, **k):
        start = time.monotonic()
        out = func(*a, **k)
        if trace:
            dur = time.monotonic() - start
            print(f"[names] {label} took {dur:.2f}s (remain {remaining():.1f}s)")
        if remaining() <= 0:
            raise TimeoutError(f"time budget exceeded after {label}")
        return out

    ident = species.inchikey or species.smiles
    if not ident:
        return {"added": 0, "primary_changed": False, "reason": "no_identifier"}

    new_candidates: list[Tuple[str, NameSource, str, int, dict]] = []
    # shape: (name, source, kind, rank, meta)

    # ----- PubChem first (by InChIKey, else skip PubChem) -----
    pub = None
    pub_syns_kept = []
    if species.inchikey:
        pub = timed("pubchem", pubchem_by_inchikey, species.inchikey)
        if pub:
            if pub.get("iupac"):
                new_candidates.append(
                    (
                        pub["iupac"],
                        NameSource.pubchem,
                        "iupac",
                        0,
                        {"source_note": "pubchem/property"},
                    )
                )
            # filter + cap
            for syn in pub.get("synonyms") or []:
                if _keep_synonym(syn):
                    pub_syns_kept.append(syn)
            for i, syn in enumerate(pub_syns_kept[:MAX_PUBCHEM_SYNS]):
                new_candidates.append(
                    (
                        syn,
                        NameSource.pubchem,
                        "synonym",
                        50 + i,
                        {"source_note": "pubchem/synonyms"},
                    )
                )
            if pub.get("cid"):
                exists = db.execute(
                    select(ExternalIdentifier).where(
                        ExternalIdentifier.species_id == species.species_id,
                        ExternalIdentifier.db == ExternalDB.pubchem,
                    )
                ).scalar_one_or_none()
                if not exists:
                    db.add(
                        ExternalIdentifier(
                            species_id=species.species_id,
                            db=ExternalDB.pubchem,
                            identifier=str(pub["cid"]),
                            meta_data={},
                        )
                    )

    # ----- Cactus second (by InChIKey or SMILES) -----
    # Put IUPAC first if cactus gave one; give it modest priority after PubChem’s
    need_cactus = True
    # If PubChem gave you an IUPAC and some clean synonyms, skip Cactus:
    if (
        any(k == "iupac" for _, _, k, _, _ in new_candidates)
        and len(pub_syns_kept) >= MAX_PUBCHEM_SYNS
    ):
        need_cactus = False

    if need_cactus:
        c_names = timed("cactus/names+iupac", cactus_name_by_identifier, ident)
        # filter + cap
        c_names = [s for s in c_names if _keep_synonym(s)][:MAX_CACTUS_SYNS]
        for i, name in enumerate(c_names):
            kind = "iupac" if i == 0 else "synonym"
            base_rank = 10 if kind == "iupac" else (80 + i)
            new_candidates.append(
                (name, NameSource.cactus, kind, base_rank, {"source_note": "cactus"})
            )

    # ----- OPSIN fallback (SMILES→name) if still no IUPAC anywhere -----
    have_iupac = any(k == "iupac" for _, _, k, _, _ in new_candidates)
    if not have_iupac and species.smiles:
        nm = timed("opsin", opsin_iupac_from_smiles, species.smiles)
        if nm:
            new_candidates.append(
                (nm, NameSource.opsin, "iupac", 25, {"source_note": "opsin"})
            )

    # ----- Dedup against existing (case-insensitive) -----
    existing = {
        _normalize_name(sn.name): sn
        for sn in db.execute(
            select(SpeciesName).where(SpeciesName.species_id == species.species_id)
        ).scalars()
    }

    pending_keys: set[str] = set()
    to_insert: list[dict] = []

    for name, source, kind, rank, meta in new_candidates:
        raw = name.strip()
        if not raw:
            continue
        key = _normalize_name(raw)
        if key in existing or key in pending_keys:
            continue
        row = {
            "species_id": species.species_id,
            "name": raw,
            "kind": kind,
            "source": source,
            "is_primary": False,
            "rank": rank,
            "lang": "en",
        }
        if hasattr(SpeciesName, "curated"):
            row["curated"] = False
        if hasattr(SpeciesName, "source_priority"):
            row["source_priority"] = SOURCE_PRIORITY.get(source.value, 50)
        if hasattr(SpeciesName, "meta_data"):
            row["meta_data"] = meta or {}
        to_insert.append(row)
        pending_keys.add(key)

    added = _bulk_insert_names(db, to_insert)

    # ----- Primary selection logic -----
    rows = list(
        db.execute(
            select(SpeciesName).where(SpeciesName.species_id == species.species_id)
        ).scalars()
    )

    def _src_value(r: SpeciesName) -> str:
        s = getattr(r, "source", None)
        return (
            s.value if hasattr(s, "value") else (str(s) if s is not None else "other")
        )

    def _src_priority(r: SpeciesName) -> int:
        return getattr(r, "source_priority", SOURCE_PRIORITY.get(_src_value(r), 50))

    def score(r: SpeciesName):
        return (
            0 if r.kind == "iupac" else 1,  # prefer IUPAC
            _src_priority(r),  # then source priority
            r.rank,  # then rank
            r.name.casefold(),  # stable tie-break
        )

    curated_primary = next(
        (
            r
            for r in rows
            if getattr(r, "is_primary", False) and getattr(r, "curated", False)
        ),
        None,
    )

    primary_changed = False
    reason = "ok"
    winner = curated_primary

    if not curated_primary:
        current_primary = next(
            (r for r in rows if getattr(r, "is_primary", False)), None
        )
        best = min(rows, key=score) if rows else None
        if best and (current_primary is None or best is not current_primary):
            if current_primary:
                current_primary.is_primary = False
            best.is_primary = True
            primary_changed = True
        winner = best
    else:
        reason = "curated_primary_locked"

    db.flush()

    source_primary = None
    if winner is not None:
        s = getattr(winner, "source", None)
        source_primary = (
            s.value if hasattr(s, "value") else (str(s) if s is not None else None)
        )

    return {
        "added": added,
        "primary_changed": primary_changed,
        "source_primary": source_primary,
        "reason": reason,
    }
