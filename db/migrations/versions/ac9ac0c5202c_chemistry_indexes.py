"""chemistry indexes

Revision ID: ac9ac0c5202c
Revises: 97739ec3adf1
Create Date: 2025-08-20 14:24:08.809448

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'ac9ac0c5202c'
down_revision: Union[str, Sequence[str], None] = '97739ec3adf1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute("""
    CREATE INDEX IF NOT EXISTS idx_molecule_mol_gist
    ON molecule USING gist (mol);
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_molecule_mfp2_gist
        ON molecule USING gist (morganbv_fp(mol, 2));
    """)

def downgrade() -> None:
    """Downgrade schema."""
    pass
