# tests/test_conformers.py
from tests.factories import make_species, make_lot, add_conformer, add_well_features


def test_conformers_all_vs_rep(client, db_session):
    sp = make_species(db_session, smiles="C", inchikey="OTMSDBZUPAUEDD-UHFFFAOYSA-N")
    lot = make_lot(db_session, lot_string="b3lyp/6-31g*")
    c1 = add_conformer(db_session, sp, lot, well_label="well", well_rank=1, rep=True)
    c2 = add_conformer(db_session, sp, lot, well_label="iso1", well_rank=2, rep=False)
    add_well_features(db_session, c1, G298=-10.0)
    add_well_features(db_session, c2, H298=-9.0)
    db_session.commit()

    r = client.get(f"/api/species/{sp.species_id}/conformers")
    assert r.status_code == 200
    assert len(r.json()) == 2

    r = client.get(
        f"/api/species/{sp.species_id}/conformers", params={"representative_only": True}
    )
    assert r.status_code == 200
    assert len(r.json()) == 1
    row = r.json()[0]
    assert row["lot"]["lot_string"] == "b3lyp/6-31g*"
    assert row["energy_label"] in ("G298", "H298", "E0", "E_elec")
    assert isinstance(row["energy_value"], (int, float))


def test_conformers_best_only(client, db_session):
    sp = make_species(db_session, smiles="CC", inchikey="LFQSCWFLJHTTHZ-UHFFFAOYSA-N")
    lot = make_lot(db_session, lot_string="wb97x-d/def2-tzvp")
    c1 = add_conformer(db_session, sp, lot, well_label="well", well_rank=1, rep=True)
    c2 = add_conformer(db_session, sp, lot, well_label="iso1", well_rank=2, rep=True)
    add_well_features(db_session, c1, H298=-12.0)
    add_well_features(db_session, c2, H298=-11.0)
    db_session.commit()

    r = client.get(
        f"/api/species/{sp.species_id}/conformers",
        params={"best_only": True, "is_ts": False},
    )
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 1
    assert data[0]["well_rank"] == 1
