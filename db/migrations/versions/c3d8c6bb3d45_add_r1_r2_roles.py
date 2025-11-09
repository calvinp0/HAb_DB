"""Add R1/R2 mol roles

Revision ID: c3d8c6bb3d45
Revises: 71adc75ecb79
Create Date: 2025-10-21 14:00:00.000000

"""

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "c3d8c6bb3d45"
down_revision: Union[str, Sequence[str], None] = "71adc75ecb79"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema by adding R1/R2 to mol_role enum."""
    op.execute("ALTER TYPE mol_role ADD VALUE IF NOT EXISTS 'R1';")
    op.execute("ALTER TYPE mol_role ADD VALUE IF NOT EXISTS 'R2';")


def downgrade() -> None:
    """Downgrade schema by removing R1/R2 from mol_role enum."""
    op.execute("ALTER TYPE mol_role RENAME TO mol_role_old;")
    op.execute("CREATE TYPE mol_role AS ENUM ('R1H', 'R2H', 'TS');")
    op.execute("DELETE FROM reaction_participant WHERE role IN ('R1', 'R2');")
    op.execute(
        "ALTER TABLE reaction_participant "
        "ALTER COLUMN role TYPE mol_role USING role::text::mol_role"
    )
    op.execute("DROP TYPE mol_role_old;")
