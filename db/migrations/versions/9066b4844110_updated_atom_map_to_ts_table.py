"""updated atom map to ts table

Revision ID: 9066b4844110
Revises: b82f7f1d9e2d
Create Date: 2025-11-08 20:39:07.203195

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9066b4844110'
down_revision: Union[str, Sequence[str], None] = 'b82f7f1d9e2d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema: redefine atom_map_to_ts with proper foreign keys."""
    op.execute("DROP TABLE IF EXISTS atom_map_to_ts CASCADE")

    op.create_table(
        "atom_map_to_ts",
        sa.Column(
            "ts_atom_id",
            sa.BigInteger(),
            sa.ForeignKey("conformer_atom.atom_id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "src_atom_id",
            sa.BigInteger(),
            sa.ForeignKey("conformer_atom.atom_id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "participant_id",
            sa.BigInteger(),
            sa.ForeignKey("reaction_participant.participant_id", ondelete="CASCADE"),
            primary_key=True,
        ),
        # No timestamps here – inherited from TimeStampMixin at the ORM layer
    )

    
def downgrade() -> None:
    """Downgrade schema: drop atom_map_to_ts."""
    op.drop_table("atom_map_to_ts")