import hashlib
from typing import Optional, Tuple
import math, sys, time
from shutil import get_terminal_size


def geom_hash(rmol, places: int = 12) -> str:
    conf = rmol.GetConformer()
    coords = []
    for i in range(rmol.GetNumAtoms()):
        atom = rmol.GetAtomWithIdx(i)
        p = conf.GetAtomPosition(i)
        coords.extend(
            [
                atom.GetAtomicNum(),
                round(p.x, places),
                round(p.y, places),
                round(p.z, places),
            ]
        )
    s = ",".join(map(str, coords))
    return hashlib.sha1(s.encode(), usedforsecurity=False).hexdigest()


def _H_to_kJmol(H: Optional[float], units: Optional[str]) -> Optional[float]:
    if H is None or units is None:
        return None
    u = units.strip().lower()
    if u in ("kj/mol", "kjmol", "kj mol-1"):
        return H
    if u in ("kcal/mol", "kcal mol-1", "kcalmol"):
        return H * 4.184
    if u in ("hartree", "eh"):
        return H * 2625.499638
    # add more if you expect eV/mol, etc.
    return None


def _S_to_kJmolK(S: Optional[float], units: Optional[str]) -> Optional[float]:
    if S is None or units is None:
        return None
    u = units.strip().lower()
    if u in ("kj/mol/k", "kj mol-1 k-1"):
        return S
    if u in ("j/mol/k", "j mol-1 k-1"):
        return S / 1000.0
    if u in ("cal/mol/k", "cal mol-1 k-1"):
        return (S * 4.184) / 1000.0
    return None


def compute_G_from_HS(
    H_value: Optional[float],
    H_units: Optional[str],
    S_value: Optional[float],
    S_units: Optional[str],
    T: float = 298.15,
) -> Optional[float]:
    """Returns G(T) in kJ/mol if H and S are present & convertible; else None."""
    H_kj = _H_to_kJmol(H_value, H_units)
    S_kjK = _S_to_kJmolK(S_value, S_units)
    if H_kj is None or S_kjK is None:
        return None
    return H_kj - T * S_kjK


def _human_time(s: float) -> str:
    m, sec = divmod(int(max(0, s)), 60)
    h, m = divmod(m, 60)
    return f"{h:02d}:{m:02d}:{sec:02d}"


def _progress_line(done: int, total: int, start_ts: float, extra: str = "") -> str:
    elapsed = max(1e-6, time.monotonic() - start_ts)
    rate_sp_s = done / elapsed
    rate_sp_m = rate_sp_s * 60.0
    remaining = max(0, total - done)
    eta_s = remaining / rate_sp_s if rate_sp_s > 0 else float("inf")
    termw = max(40, get_terminal_size((100, 20)).columns)
    bar_w = min(30, max(10, termw - 70))
    filled = int(bar_w * (done / total)) if total else 0
    bar = "█" * filled + "─" * (bar_w - filled)
    pct = (done / total * 100.0) if total else 0.0
    base = f"[{bar}] {done}/{total} ({pct:5.1f}%) | {rate_sp_m:5.1f} sp/min | ETA {_human_time(eta_s)}"
    if extra:
        base += f" | {extra}"
    return base
