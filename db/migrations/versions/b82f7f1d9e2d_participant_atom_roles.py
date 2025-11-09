"""participant-scoped atom roles

Revision ID: b82f7f1d9e2d
Revises: 90e4acc1db74
Create Date: 2025-11-10 12:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "b82f7f1d9e2d"
down_revision: Union[str, Sequence[str], None] = "90e4acc1db74"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema: move atom-role mappings to reaction participants."""
    op.create_table(
        "participant_atom_role",
        sa.Column("participant_id", sa.BigInteger(), nullable=False),
        sa.Column("atom_idx", sa.Integer(), nullable=False),
        sa.Column("role", sa.Enum(name="atom_role"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["participant_id"],
            ["reaction_participant.participant_id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("participant_id", "atom_idx", "role"),
    )

    op.execute(
        """
        INSERT INTO participant_atom_role (participant_id, atom_idx, role, created_at, updated_at)
        SELECT rp.participant_id, ca.atom_idx, arm.role, arm.created_at, arm.updated_at
        FROM atom_role_map arm
        JOIN conformer_atom ca ON ca.atom_id = arm.atom_id
        JOIN reaction_participant rp ON rp.conformer_id = ca.conformer_id
        ON CONFLICT DO NOTHING
        """
    )

    op.drop_table("atom_role_map")


def downgrade() -> None:
    """Downgrade schema: move mappings back to conformer-level table."""
    op.create_table(
        "atom_role_map",
        sa.Column("atom_id", sa.BigInteger(), nullable=False),
        sa.Column("role", sa.Enum(name="atom_role"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["atom_id"], ["conformer_atom.atom_id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("atom_id", "role"),
    )

    op.execute(
        """
        INSERT INTO atom_role_map (atom_id, role, created_at, updated_at)
        SELECT ca.atom_id, par.role, par.created_at, par.updated_at
        FROM participant_atom_role par
        JOIN reaction_participant rp ON rp.participant_id = par.participant_id
        JOIN conformer_atom ca
            ON ca.conformer_id = rp.conformer_id
           AND ca.atom_idx = par.atom_idx
        ON CONFLICT DO NOTHING
        """
    )

    op.drop_table("participant_atom_role")
