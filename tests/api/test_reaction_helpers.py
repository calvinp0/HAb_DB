from api.routers.reactions import _species_ids_from_query
from tests.factories import make_species, add_name


def test_species_ids_from_query_handles_inchikey_and_smiles(db_session):
    sp = make_species(
        db_session,
        smiles="C",
        inchikey="TTTTTTTTUUUUUU-VVVVVVVVVV-W",
    )
    db_session.commit()

    ids_by_ik = _species_ids_from_query(
        db_session, "TTTTTTTTUUUUUU-VVVVVVVVVV-W"
    )
    assert ids_by_ik == [sp.species_id]

    ids_by_smiles = _species_ids_from_query(db_session, "[CH3][H]")
    assert ids_by_smiles == [sp.species_id]


def test_species_ids_from_query_supports_fuzzy_and_names(db_session):
    sp_fuzzy = make_species(
        db_session,
        smiles="COCC",
        inchikey="YYYYYYYYZZZZZZ-AAAAAAAAAA-B",
    )
    sp_named = make_species(
        db_session,
        smiles="NN",
        inchikey="CCCCCCCCDDDDDD-EEEEEEEEEE-F",
    )
    add_name(db_session, sp_named, "Cool Radical", is_primary=True)
    db_session.commit()

    ids_fuzzy = _species_ids_from_query(db_session, "CO", allow_fuzzy=True)
    assert sp_fuzzy.species_id in ids_fuzzy

    ids_name = _species_ids_from_query(db_session, "cool")
    assert sp_named.species_id in ids_name
