from pydantic import BaseModel, ConfigDict
from typing import Optional


class LevelOfTheoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    lot_string: str
    method: str
    basis: Optional[str] = None
    solvent: Optional[str] = None
