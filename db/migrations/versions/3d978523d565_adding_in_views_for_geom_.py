"""Adding in views for geom_*

Revision ID: 3d978523d565
Revises: a8ea0e3d7599
Create Date: 2025-08-26 09:22:54.757691

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "3d978523d565"
down_revision: Union[str, Sequence[str], None] = "a8ea0e3d7599"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # NOTE: if your table is named 'conformer_atom', replace 'conformer_atom' with 'conformer_atom' below.
    op.execute(
        """
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
    """
    )

    op.execute(
        """
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
    """
    )

    op.execute(
        """
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
    """
    )

    op.execute(
        """
    CREATE OR REPLACE VIEW v_NULL_energy AS
    SELECT
      conf.conformer_id,
      r.reaction_name
    FROM conformer conf
    LEFT JOIN reaction_participant rp ON rp.conformer_id = conf.conformer_id
    LEFT JOIN reactions r ON r.reaction_id = rp.reaction_id
    LEFT JOIN well_features wf ON wf.conformer_id = conf.conformer_id
    WHERE wf."E_elec" ISNULL
    """
    )


def downgrade() -> None:
    op.execute("DROP VIEW IF EXISTS v_geom_dihedral;")
    op.execute("DROP VIEW IF EXISTS v_geom_angle;")
    op.execute("DROP VIEW IF EXISTS v_geom_distance;")
    op.execute("DROP VIEW IF EXISTS v_NULL_energy;")
