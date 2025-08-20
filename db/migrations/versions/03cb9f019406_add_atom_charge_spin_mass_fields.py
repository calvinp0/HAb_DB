"""add atom charge/spin/mass fields

Revision ID: 03cb9f019406
Revises: ac9ac0c5202c
Create Date: 2025-08-20 15:49:57.770106

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "03cb9f019406"
down_revision: Union[str, Sequence[str], None] = "ac9ac0c5202c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("atom", sa.Column("q_mull", sa.Float(), nullable=True))
    op.add_column("atom", sa.Column("q_apt", sa.Float(), nullable=True))
    op.add_column("atom", sa.Column("spin", sa.Integer(), nullable=True))
    op.add_column("atom", sa.Column("Z", sa.Integer(), nullable=True))
    op.add_column("atom", sa.Column("mass", sa.Float(), nullable=True))
    op.add_column("atom", sa.Column("f_mag", sa.Float(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("atom", "f_mag")
    op.drop_column("atom", "mass")
    op.drop_column("atom", "Z")
    op.drop_column("atom", "spin")
    op.drop_column("atom", "q_apt")
    op.drop_column("atom", "q_mull")
