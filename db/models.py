from __future__ import annotations

from typing import List, Optional

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    CheckConstraint,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from .mixins import TimeStampMixin
from .types import AtomRole, FeatureFrame, KinDirection, Mol, MolRole


class Base(DeclarativeBase):
    """Base class for all database models."""

    pass


# Provenance & Core Tables


class IngestBatch(TimeStampMixin, Base):
    __tablename__ = "ingest_batch"

    batch_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    source_label: Mapped[str] = mapped_column(String, nullable=False)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    reactions: Mapped[List[Reaction]] = relationship("reactions", back_populates="batch")


class Reaction(TimeStampMixin, Base):
    __tablename__ = "reactions"

    reaction_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    batch_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("ingest_batch.batch_id"), nullable=True
    )
    reaction_name: Mapped[Optional[str]] = mapped_column(String, unique=True)
    family: Mapped[Optional[str]] = mapped_column(String, nullable=False)
    meta_data: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)

    batch: Mapped[Optional[IngestBatch]] = relationship(
        "IngestBatch", back_populates="reactions"
    )
    molecules: Mapped[List[Molecule]] = relationship(back_populates="reactions", cascade="all, delete-orphan")  # type: ignore[name-defined]
    kinetics_sets: Mapped[List[KineticsSet]] = relationship(back_populates="reactions", cascade="all, delete-orphan")  # type: ignore[name-defined]

    def __repr__(self):
        return f"<Reaction(reaction_id={self.reaction_id}, reaction_name={self.reaction_name}, family={self.family})>"


class Molecule(TimeStampMixin, Base):
    __tablename__ = "molecule"

    molecule_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    reaction_id: Mapped[int] = mapped_column(
        ForeignKey("reactions.reaction_id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[str] = mapped_column(MolRole, nullable=False)

    mol: Mapped[object] = mapped_column(Mol, nullable=False)
    smiles: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    inchikey: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    charge: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    spin_mult: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    mw: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    props: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    source_file: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    record_index: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    __table_args__ = (
        UniqueConstraint("reaction_id", "role", name="uq_molecule_reaction_role"),
        Index("ix_molecule_role", "role"),
        Index("ix_molecule_mw", "mw"),
        Index("idx_molecule_charge", "charge"),
        Index("idx_molecule_spinmult", "spin_mult"),
    )
    reaction: Mapped[Reaction] = relationship("reactions", back_populates="molecules")
    atoms: Mapped[List[Atom]] = relationship(back_populates="molecule", cascade="all, delete-orphan")  # type: ignore[name-defined]
    ts_features: Mapped[Optional[TSFeatures]] = relationship(back_populates="molecule", uselist=False, cascade="all, delete-orphan")  # type: ignore[name-defined]


class Atom(Base):
    __tablename__ = "atom"

    atom_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    molecule_id: Mapped[int] = mapped_column(
        ForeignKey("molecule.molecule_id", ondelete="CASCADE"), nullable=False
    )
    atom_idx: Mapped[int] = mapped_column(Integer, nullable=False)  # 0-based
    atomic_num: Mapped[int] = mapped_column(Integer, nullable=False)
    formal_charge: Mapped[Optional[int]] = mapped_column(Integer)
    is_aromatic: Mapped[Optional[bool]] = mapped_column(Boolean)
    xyz: Mapped[Optional[List[float]]] = mapped_column(
        JSON
    )  # store as JSON [x,y,z] if used

    __table_args__ = (
        UniqueConstraint("molecule_id", "atom_idx", name="uq_atom_mol_idx"),
        Index("idx_atom_molecule", "molecule_id"),
    )

    molecule: Mapped[Molecule] = relationship(back_populates="atoms")  # type: ignore[name-defined]
    roles: Mapped[List[AtomRoleMap]] = relationship(back_populates="atom", cascade="all, delete-orphan")  # type: ignore[name-defined]


class AtomRoleMap(Base):
    __tablename__ = "atom_role_map"

    atom_id: Mapped[int] = mapped_column(
        ForeignKey("atom.atom_id", ondelete="CASCADE"), primary_key=True
    )
    role: Mapped[str] = mapped_column(AtomRole, primary_key=True)

    atom: Mapped[Atom] = relationship(back_populates="roles")  # type: ignore[name-defined]


class AtomMapToTS(Base):
    __tablename__ = "atom_map_to_ts"

    reaction_id: Mapped[int] = mapped_column(
        ForeignKey("reactions.reaction_id", ondelete="CASCADE"), primary_key=True
    )
    from_role: Mapped[str] = mapped_column(MolRole, primary_key=True)
    from_atom_id: Mapped[int] = mapped_column(
        ForeignKey("atom.atom_id", ondelete="CASCADE"), primary_key=True
    )  # noqa: E731
    ts_atom_id: Mapped[int] = mapped_column(
        ForeignKey("atom.atom_id", ondelete="CASCADE"), nullable=False
    )

    __table_args__ = (
        CheckConstraint("from_role in ('R1H','R2H')", name="ck_atommap_fromrole"),
        Index("idx_atommap_reaction_role", "reaction_id", "from_role"),
    )


class GeomDistance(Base):
    __tablename__ = "geom_distance"

    geom_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    molecule_id: Mapped[int] = mapped_column(
        ForeignKey("molecule.molecule_id", ondelete="CASCADE"), nullable=False
    )
    frame: Mapped[str] = mapped_column(FeatureFrame, nullable=False, default="none")
    a1_id: Mapped[int] = mapped_column(
        ForeignKey("atom.atom_id", ondelete="CASCADE"), nullable=False
    )
    a2_id: Mapped[int] = mapped_column(
        ForeignKey("atom.atom_id", ondelete="CASCADE"), nullable=False
    )
    value_ang: Mapped[float] = mapped_column(Float, nullable=False)
    measure_name: Mapped[str] = mapped_column(
        String, nullable=False
    )  # e.g., 'r_DH','r_HA','r_DA'
    feature_ver: Mapped[Optional[str]] = mapped_column(String)

    __table_args__ = (
        Index("idx_gdist_measure_val", "measure_name", "value_ang"),
        Index("idx_gdist_molecule", "molecule_id"),
    )


class GeomAngle(Base):
    __tablename__ = "geom_angle"

    geom_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    molecule_id: Mapped[int] = mapped_column(
        ForeignKey("molecule.molecule_id", ondelete="CASCADE"), nullable=False
    )
    frame: Mapped[str] = mapped_column(FeatureFrame, nullable=False, default="none")
    a1_id: Mapped[int] = mapped_column(
        ForeignKey("atom.atom_id", ondelete="CASCADE"), nullable=False
    )
    a2_id: Mapped[int] = mapped_column(
        ForeignKey("atom.atom_id", ondelete="CASCADE"), nullable=False
    )
    a3_id: Mapped[int] = mapped_column(
        ForeignKey("atom.atom_id", ondelete="CASCADE"), nullable=False
    )
    value_deg: Mapped[float] = mapped_column(Float, nullable=False)
    measure_name: Mapped[str] = mapped_column(
        String, nullable=False
    )  # e.g., 'angle_DHA'
    feature_ver: Mapped[Optional[str]] = mapped_column(String)

    __table_args__ = (
        Index("idx_gang_measure_val", "measure_name", "value_deg"),
        Index("idx_gang_molecule", "molecule_id"),
    )


class GeomDihedral(Base):
    __tablename__ = "geom_dihedral"

    geom_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    molecule_id: Mapped[int] = mapped_column(
        ForeignKey("molecule.molecule_id", ondelete="CASCADE"), nullable=False
    )
    frame: Mapped[str] = mapped_column(FeatureFrame, nullable=False, default="none")
    a1_id: Mapped[int] = mapped_column(
        ForeignKey("atom.atom_id", ondelete="CASCADE"), nullable=False
    )
    a2_id: Mapped[int] = mapped_column(
        ForeignKey("atom.atom_id", ondelete="CASCADE"), nullable=False
    )
    a3_id: Mapped[int] = mapped_column(
        ForeignKey("atom.atom_id", ondelete="CASCADE"), nullable=False
    )
    a4_id: Mapped[int] = mapped_column(
        ForeignKey("atom.atom_id", ondelete="CASCADE"), nullable=False
    )
    value_deg: Mapped[float] = mapped_column(Float, nullable=False)
    measure_name: Mapped[str] = mapped_column(
        String, nullable=False
    )  # e.g., 'phi1','phi2'
    feature_ver: Mapped[Optional[str]] = mapped_column(String)

    __table_args__ = (
        Index("idx_gdih_measure_val", "measure_name", "value_deg"),
        Index("idx_gdih_molecule", "molecule_id"),
    )


class TSFeatures(Base):
    __tablename__ = "ts_features"

    molecule_id: Mapped[int] = mapped_column(
        ForeignKey("molecule.molecule_id", ondelete="CASCADE"), primary_key=True
    )
    imag_freq_cm1: Mapped[Optional[float]] = mapped_column(Float)
    irc_verified: Mapped[Optional[bool]] = mapped_column(Boolean)
    level_of_theory: Mapped[Optional[str]] = mapped_column(String)
    E_TS: Mapped[Optional[float]] = mapped_column(Float)
    E_R1H: Mapped[Optional[float]] = mapped_column(Float)
    E_R2H: Mapped[Optional[float]] = mapped_column(Float)
    delta_E_dagger: Mapped[Optional[float]] = mapped_column(Float)

    molecule: Mapped[Molecule] = relationship(back_populates="ts_features")  # type: ignore[name-defined]


class KineticsSet(TimeStampMixin, Base):
    __tablename__ = "kinetics_set"

    kin_set_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    reaction_id: Mapped[int] = mapped_column(
        ForeignKey("reactions.reaction_id", ondelete="CASCADE"), nullable=False
    )
    direction: Mapped[str] = mapped_column(KinDirection, nullable=False)
    model: Mapped[str] = mapped_column(
        String, nullable=False, default="ModifiedArrhenius"
    )

    A: Mapped[float] = mapped_column(Float, nullable=False)
    n: Mapped[Optional[float]] = mapped_column(Float)
    Ea_kJ_mol: Mapped[float] = mapped_column(Float, nullable=False)
    Tmin_K: Mapped[float] = mapped_column(Float, nullable=False)
    Tmax_K: Mapped[float] = mapped_column(Float, nullable=False)

    source: Mapped[Optional[str]] = mapped_column(String)
    reference: Mapped[Optional[str]] = mapped_column(String)
    computed_from: Mapped[Optional[str]] = mapped_column(String)

    dA_factor: Mapped[Optional[float]] = mapped_column(Float)
    dn_abs: Mapped[Optional[float]] = mapped_column(Float)
    dEa_kJ_mol: Mapped[Optional[float]] = mapped_column(Float)
    meta: Mapped[Optional[dict]] = mapped_column(JSONB)

    __table_args__ = (
        UniqueConstraint(
            "reaction_id",
            "direction",
            "source",
            "reference",
            "Tmin_K",
            "Tmax_K",
            name="uq_kset_identity",
        ),
        Index("idx_kset_reaction_dir", "reaction_id", "direction"),
        Index("idx_kset_T", "Tmin_K", "Tmax_K"),
    )

    reaction: Mapped[Reaction] = relationship(back_populates="kinetics_sets")  # type: ignore[name-defined]
