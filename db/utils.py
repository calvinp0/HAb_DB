import hashlib


def geom_hash(rmol, places: int = 6) -> str:
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
