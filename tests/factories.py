# tests/factories.py
from db.models import Species, SpeciesName, Conformer, LevelOfTheory, WellFeatures


def make_species(session, *, smiles=None, inchikey=None, charge=0, spin=1):
    sp = Species(
        smiles=smiles, inchikey=inchikey, charge=charge, spin_multiplicity=spin
    )
    session.add(sp)
    session.flush()
    return sp


def add_name(
    session, species, name, kind="synonym", lang="en", is_primary=False, source="manual"
):
    sn = SpeciesName(
        species_id=species.species_id,
        name=name,
        kind=kind,
        lang=lang,
        is_primary=is_primary,
        source=source,
    )
    session.add(sn)
    session.flush()
    return sn


def make_lot(
    session, *, lot_string="wb97x-d/def2-tzvp", method="wb97x-d", basis="def2-tzvp"
):
    lot = LevelOfTheory(lot_string=lot_string, method=method, basis=basis)
    session.add(lot)
    session.flush()
    return lot


def add_conformer(
    session, species, lot, *, is_ts=False, well_label="well", well_rank=1, rep=True
):
    c = Conformer(
        species_id=species.species_id,
        lot_id=lot.lot_id,
        is_ts=is_ts,
        well_label=well_label,
        well_rank=well_rank,
        is_well_representative=rep,
    )
    session.add(c)
    session.flush()
    return c


def add_well_features(
    session, conformer, *, G298=None, H298=None, E_elec=None, ZPE=None
):
    wf = WellFeatures(
        conformer_id=conformer.conformer_id,
        lot_id=conformer.lot_id,
        G298=G298,
        H298=H298,
        E_elec=E_elec,
        ZPE=ZPE,
    )
    session.add(wf)
    session.flush()
    return wf
