from sqlalchemy import func, select
from db.engine import session_scope
from db.models import WellFeatures


def debug_g298_candidates():
    with session_scope() as s:
        total = s.scalar(select(func.count()).select_from(WellFeatures))
        hs_ready = s.scalar(
            select(func.count()).where(
                WellFeatures.H298.isnot(None), WellFeatures.S298.isnot(None)
            )
        )
        g_missing = s.scalar(select(func.count()).where(WellFeatures.G298.is_(None)))
        h_units = s.execute(select(WellFeatures.H298_units).distinct()).all()
        s_units = s.execute(select(WellFeatures.S298_units).distinct()).all()
        print("WellFeatures rows:", total)
        print("H&S present:", hs_ready)
        print("G298 missing:", g_missing)
        print("Distinct H units:", [u[0] for u in h_units])
        print("Distinct S units:", [u[0] for u in s_units])


# call it:
# debug_g298_candidates()

if __name__ == "__main__":
    debug_g298_candidates()
