from typing import Literal, Optional
from pydantic import BaseModel


class NASA7Out(BaseModel):
    form: Literal["NASA7"]
    Tmin_K: float
    Tmax_K: float
    coeffs: tuple[float, float, float, float, float, float, float]
    fit_rmse: float | None = None
    source: str | None = None
