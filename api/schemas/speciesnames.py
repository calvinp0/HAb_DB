from pydantic import BaseModel, ConfigDict
from typing import List, Optional


class SpeciesNameOut(BaseModel):
    name: str
    kind: str
    lang: Optional[str] = "en"
    source: str  # enum -> string
    is_primary: bool
    rank: int
    curated: bool
    source_priority: int
