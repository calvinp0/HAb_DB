"""add mol_raw_ctab to conformer

Revision ID: 90e4acc1db74
Revises: c3d8c6bb3d45
Create Date: 2025-11-08 17:08:38.126158

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '90e4acc1db74'
down_revision: Union[str, Sequence[str], None] = 'c3d8c6bb3d45'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'conformer',
        sa.Column('mol_raw_ctab', sa.Text(), nullable=True),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column(
        'conformer',
        'mol_raw_ctab',
    )
