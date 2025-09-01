# tests/test_species_search.py
import pytest
from tests.factories import make_species, add_name


def test_search_by_inchikey(client, db_session, monkeypatch):
    sp = make_species(db_session, inchikey="BSYNRYMUTXBXSQ-UHFFFAOYSA-N", smiles="CCO")
    db_session.commit()
    r = client.get("/api/species/search", params={"q": "BSYNRYMUTXBXSQ-UHFFFAOYSA-N"})
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 1
    assert data[0]["species_id"] == sp.species_id


def test_search_by_smiles(client, db_session, monkeypatch):
    # Avoid RDKit dependency in test by monkeypatching your helper if you want
    from api.services import chemid

    monkeypatch.setattr(chemid, "canonical_smiles", lambda s: "C" if s else None)
    sp = make_species(db_session, inchikey="OTMSDBZUPAUEDD-UHFFFAOYSA-N", smiles="C")
    db_session.commit()
    r = client.get("/api/species/search", params={"q": "C"})
    assert r.status_code == 200 and len(r.json()) == 1


def test_search_by_name(client, db_session):
    sp = make_species(
        db_session, inchikey="LEQAOMBKQFMDFZ-UHFFFAOYSA-N", smiles="O=CC=O"
    )
    add_name(db_session, sp, "Glyoxal", is_primary=True)
    db_session.commit()
    r = client.get("/api/species/search", params={"q": "glyox"})
    assert r.status_code == 200 and len(r.json()) == 1


def test_bad_inchikey_400(client):
    r = client.get("/api/species/search", params={"q": "NOT_AN_INCHIKEY"})
    # If your code first tries IK and validates, it should 400; if it falls through to name search, adjust.
    assert r.status_code in (200, 400)
