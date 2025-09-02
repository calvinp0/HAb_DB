from db.services.http import get

r = get(
    "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/inchikey/QEZDGOYCPBVGGY-UHFFFAOYSA-N/synonyms/JSON"
)
print(r.status_code, len(r.content))
