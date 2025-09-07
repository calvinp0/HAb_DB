from pydantic import BaseModel, ConfigDict
from typing import List, Optional


class CPCurveOut(BaseModel):
    T_K: list[float]
    Cp_J_per_molK: list[float]
    raw_units: dict | None = None
    Cp0_raw: float | None = None
    CpInf_raw: float | None = None
    source: str | None = None
