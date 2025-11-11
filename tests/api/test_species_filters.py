from tests.factories import make_species


def test_elements_filter_requires_all(client, db_session):
    sp_combo = make_species(
        db_session,
        smiles="C=O",
        inchikey="AAAAAAAABBBBBB-CCCCCCCCCC-D",
    )
    sp_combo.elements_json = {"Xx": 1, "Yy": 2}
    sp_combo.heavy_atoms = 3

    sp_partial = make_species(
        db_session,
        smiles="CC",
        inchikey="EEEEEEEEFFFFFF-GGGGGGGGGG-H",
    )
    sp_partial.elements_json = {"Xx": 2}
    sp_partial.heavy_atoms = 2

    db_session.commit()

    resp = client.get(
        "/api/species/search",
        params={
            "elements": "Xx,Yy",
            "elem_mode": "all",
            "limit": 10,
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    ids = [row["species_id"] for row in data]
    assert ids == [sp_combo.species_id]


def test_elements_any_with_heavy_atom_limit(client, db_session):
    sp_c = make_species(
        db_session,
        smiles="C",
        inchikey="IIIIIIIIJJJJJJ-KKKKKKKKKK-L",
    )
    sp_c.elements_json = {"Qa": 1}
    sp_c.heavy_atoms = 1

    sp_n = make_species(
        db_session,
        smiles="N",
        inchikey="MMMMMMMNNNNNNN-OOOOOOOOOO-P",
    )
    sp_n.elements_json = {"Qb": 1}
    sp_n.heavy_atoms = 1

    sp_heavy = make_species(
        db_session,
        smiles="CN",
        inchikey="QQQQQQQQRRRRRR-SSSSSSSSSS-T",
    )
    sp_heavy.elements_json = {"Qa": 1, "Qb": 1}
    sp_heavy.heavy_atoms = 2

    db_session.commit()

    resp = client.get(
        "/api/species/search",
        params={
            "elements": "Qa,Qb",
            "elem_mode": "any",
            "max_heavy_atoms": 1,
            "limit": 10,
        },
    )
    assert resp.status_code == 200
    ids = {row["species_id"] for row in resp.json()}
    assert ids == {sp_c.species_id, sp_n.species_id}
