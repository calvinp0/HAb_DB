from pydantic import BaseModel, ConfigDict
from typing import Optional

# api/schemas/species.py
from pydantic import BaseModel
from typing import Optional, List


class SpeciesOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    species_id: int
    smiles: Optional[str] = None
    smiles_no_h: Optional[str] = None
    inchikey: Optional[str] = None
    charge: Optional[int] = None
    spin_multiplicity: Optional[int] = None
    mw: Optional[float] = None
    is_ts: bool = False


class SpeciesNameOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    name_id: int
    name: str
    kind: str
    lang: Optional[str] = None
    source: str
    is_primary: bool
    rank: int
    curated: bool


class ExternalIdOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    db: str
    identifier: str
    meta_data: Optional[dict] = None


class SpeciesDetailOut(SpeciesOut):
    props: Optional[dict] = None
    names: List[SpeciesNameOut] = []
    external_ids: List[ExternalIdOut] = []
