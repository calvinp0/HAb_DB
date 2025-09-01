# api/routers/utils.py
from collections import Counter
from typing import Dict, Iterable


# very lightweight parser: pulls element symbols out of a SMILES string
# (good enough for filtering; your DB can use something richer later)
def elem_counts_from_smiles(smiles: str) -> Dict[str, int]:
    if not smiles:
        return {}
    out: Counter[str] = Counter()
    i = 0
    s = smiles
    while i < len(s):
        ch = s[i]
        # bracketed atoms like [Fe], [NH4+]
        if ch == "[":
            j = s.find("]", i + 1)
            if j == -1:
                break
            token = s[i + 1 : j]
            # first capital letter + optional lowercase
            el = ""
            for k, c in enumerate(token):
                if c.isalpha():
                    el += c
                    # grab next lowercase if present
                    if k + 1 < len(token) and token[k + 1].islower():
                        el += token[k + 1]
                    break
            if el:
                out[el.capitalize()] += 1
            i = j + 1
            continue
        # bare elements: B, Br, C, Cl, N, O, P, S, F, I, Si, ...
        if ch.isalpha():
            el = ch
            if i + 1 < len(s) and s[i + 1].islower():
                el += s[i + 1]
                i += 1
            out[el.capitalize()] += 1
        i += 1
    # remove hydrogens for “heavy atom” purposes if you want
    return dict(out)


def includes_elements(counts: Dict[str, int], wanted: Iterable[str], mode: str) -> bool:
    W = [w.capitalize() for w in wanted]
    if mode == "any":
        return any(counts.get(w, 0) > 0 for w in W)
    # "all"
    return all(counts.get(w, 0) > 0 for w in W)
