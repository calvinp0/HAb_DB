from pydantic import BaseModel, ConfigDict
from typing import List, Optional
from api.schemas.leveloftheory import LevelOfTheoryOut


class ConformerRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    conformer_id: int
    species_id: int
    # what you want to SHOW
    lot: LevelOfTheoryOut
    energy_label: Optional[str] = None  # 'G298' | 'H298' | 'E0' | 'E_elec'
    energy_value: Optional[float] = None  # assume kJ/mol (see note below)
    is_ts: bool
    well_label: Optional[str] = None
    well_rank: Optional[int] = None
    is_well_representative: bool
    G298: Optional[float] = None
    H298: Optional[float] = None
    E_elec: Optional[float] = None
    ZPE: Optional[float] = None
    E0: Optional[float] = None  # computed convenience
    E_TS: Optional[float] = None  # from TSFeatures when is_ts=True


class ConformerDetailOut(ConformerRow):
    # extend with whatever you have available
    smiles: Optional[str] = None
    smiles_no_h: Optional[str] = None
    geom_xyz: Optional[str] = None
    n_imag: Optional[int] = None
    imag_freqs: List[float] = []
    frequencies: List[float] = []
    props: Optional[dict] = None
