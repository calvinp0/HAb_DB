# api/schemas/reactions.py
from __future__ import annotations
from pydantic import BaseModel
from typing import List, Optional
from api.schemas.conformers import LevelOfTheoryOut


class RxnSideOut(BaseModel):
    role: str  # "reactant" | "product" | "ts"
    conformer_id: Optional[int] = None
    species_id: int
    smiles: Optional[str] = None
    smiles_no_h: Optional[str] = None
    lot: Optional[LevelOfTheoryOut] = None
    is_ts: Optional[bool] = None


class ReactionSummaryOut(BaseModel):
    reaction_id: int
    family: str
    reaction_name: Optional[str] = None
    participants: List[RxnSideOut]
    ksets_count: int
