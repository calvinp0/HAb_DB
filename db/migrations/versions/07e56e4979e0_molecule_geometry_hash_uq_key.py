"""molecule geometry_hash + uq key

Revision ID: 07e56e4979e0
Revises: 03cb9f019406
Create Date: 2025-08-20 23:53:43.160098

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '07e56e4979e0'
down_revision: Union[str, Sequence[str], None] = '03cb9f019406'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('molecule', sa.Column('geometry_hash', sa.String(), nullable=True))

    # Safer drops (won't error if missing)
    op.execute('DROP INDEX IF EXISTS idx_molecule_mfp2_gist')
    op.execute('DROP INDEX IF EXISTS idx_molecule_mol_gist')

    op.create_index(op.f('ix_molecule_geometry_hash'), 'molecule', ['geometry_hash'], unique=False)
    op.drop_constraint(op.f('uq_molecule_reaction_role'), 'molecule', type_='unique')
    op.create_unique_constraint('uq_mol_rxn_role_geom', 'molecule', ['reaction_id', 'role', 'geometry_hash'])



def downgrade() -> None:
    op.drop_constraint('uq_mol_rxn_role_geom', 'molecule', type_='unique')
    op.create_unique_constraint(op.f('uq_molecule_reaction_role'), 'molecule', ['reaction_id', 'role'])

    # Recreate the GiST indexes explicitly
    op.execute('CREATE INDEX IF NOT EXISTS idx_molecule_mol_gist ON molecule USING GIST (mol)')
    op.execute('CREATE INDEX IF NOT EXISTS idx_molecule_mfp2_gist ON molecule USING GIST (morganbv_fp(mol, 2))')

    op.drop_index(op.f('ix_molecule_geometry_hash'), table_name='molecule')
    op.drop_column('molecule', 'geometry_hash')
