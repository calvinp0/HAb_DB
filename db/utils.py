import hashlib


def geom_hash(rmol, places: int = 3) -> str:
    conf = rmol.GetConformer()
    coords = []
    for i in range(rmol.GetNumAtoms()):
        p = conf.GetAtomPosition(i)
        coords.extend([round(p.x, places), round(p.y, places), round(p.z, places)])
    return hashlib.sha1(
        (",".join(map(str, coords))).encode(), usedforsecurity=False
    ).hexdigest()
