"""Adding in views for geom_*

Revision ID: a1cc08abc5bb
Revises: 6a9bdaedf26e
Create Date: 2025-08-25 23:19:46.583741

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1cc08abc5bb'
down_revision: Union[str, Sequence[str], None] = '6a9bdaedf26e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # NOTE: if your table is named 'conformer_atom', replace 'conformer_atom' with 'conformer_atom' below.
    op.execute("""
    CREATE OR REPLACE VIEW v_geom_distance AS
    SELECT
      gd.geom_id,
      gd.conformer_id,
      gd.frame,
      a1.atom_idx AS a1_idx,
      a2.atom_idx AS a2_idx,
      gd.value_ang,
      gd.units,
      gd.feature_ver
    FROM geom_distance gd
    JOIN conformer_atom a1 ON a1.atom_id = gd.a1_id
    JOIN conformer_atom a2 ON a2.atom_id = gd.a2_id;
    """)

    op.execute("""
    CREATE OR REPLACE VIEW v_geom_angle AS
    SELECT
      ga.geom_id,
      ga.conformer_id,
      ga.frame,
      a1.atom_idx AS a1_idx,
      a2.atom_idx AS a2_idx,
      a3.atom_idx AS a3_idx,
      ga.value_deg,
      ga.units,
      ga.feature_ver
    FROM geom_angle ga
    JOIN conformer_atom a1 ON a1.atom_id = ga.a1_id
    JOIN conformer_atom a2 ON a2.atom_id = ga.a2_id
    JOIN conformer_atom a3 ON a3.atom_id = ga.a3_id;
    """)

    op.execute("""
    CREATE OR REPLACE VIEW v_geom_dihedral AS
    SELECT
      gdih.geom_id,
      gdih.conformer_id,
      gdih.frame,
      a1.atom_idx AS a1_idx,
      a2.atom_idx AS a2_idx,
      a3.atom_idx AS a3_idx,
      a4.atom_idx AS a4_idx,
      gdih.value_deg,
      gdih.units,
      gdih.feature_ver
    FROM geom_dihedral gdih
    JOIN conformer_atom a1 ON a1.atom_id = gdih.a1_id
    JOIN conformer_atom a2 ON a2.atom_id = gdih.a2_id
    JOIN conformer_atom a3 ON a3.atom_id = gdih.a3_id
    JOIN conformer_atom a4 ON a4.atom_id = gdih.a4_id;
    """)

def downgrade() -> None:
    op.execute("DROP VIEW IF EXISTS v_geom_dihedral;")
    op.execute("DROP VIEW IF EXISTS v_geom_angle;")
    op.execute("DROP VIEW IF EXISTS v_geom_distance;")