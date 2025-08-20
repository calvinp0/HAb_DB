from sqlalchemy import Enum
from sqlalchemy.types import UserDefinedType


class Mol(UserDefinedType):
    """SQLAlchemy mapping for the PostgreSQL RDKit 'mol' type.


    Usage: Column(Mol, nullable=False)
    """

    def get_col_spec(self) -> str:  # type: ignore[override]
        return "mol"

    # Optional: bind/result processors if you want to serialize/deserialize
    # molblocks in Python space. In most cases you'll insert via SQL functions
    # like mol_from_ctab()/mol_from_smiles() on the DB side.


MolRole = Enum("R1H", "R2H", "TS", name="mol_role", create_constraint=True)

AtomRole = Enum(
    "donor",
    "acceptor",
    "d_hydrogen",
    "a_hydrogen",
    "none",
    name="atom_role",
    create_constraint=True,
)

FeatureFrame = Enum(
    "ref_d_hydrogen",
    "ref_a_hydrogen",
    "none",
    name="feature_frame",
    create_constraint=True,
)

KinDirection = Enum("forward", "reverse", name="kin_direction", create_constraint=True)
