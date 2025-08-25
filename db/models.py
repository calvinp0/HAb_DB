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

    reactions: Mapped[List[Reaction]] = relationship(
        lambda: Reaction, back_populates="batch"
    )


class Reaction(TimeStampMixin, Base):
    __tablename__ = "reactions"
    reaction_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    batch_id: Mapped[Optional[int]] = mapped_column(ForeignKey("ingest_batch.batch_id"))
    reaction_name: Mapped[Optional[str]] = mapped_column(String, unique=True)
    family: Mapped[str] = mapped_column(String, nullable=False)
    meta_data: Mapped[Optional[dict]] = mapped_column(JSONB)

    batch: Mapped[Optional["IngestBatch"]] = relationship(back_populates="reactions")
    participants: Mapped[List["ReactionParticipant"]] = relationship(
        back_populates="reaction", cascade="all, delete-orphan"
    )
    rate_models: Mapped[List["RateModel"]] = relationship(
        back_populates="reaction", cascade="all, delete-orphan"
    )

    def __repr__(self):
        return f"<Reaction(reaction_id={self.reaction_id}, reaction_name={self.reaction_name}, family={self.family})>"


class Species(TimeStampMixin, Base):
    __tablename__ = "species"

    species_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)

    # Chemical Fields
    smiles: Mapped[Optional[str]] = mapped_column(String)
    inchikey: Mapped[Optional[str]] = mapped_column(String)
    charge: Mapped[Optional[int]] = mapped_column(Integer)
    spin_multiplicity: Mapped[Optional[int]] = mapped_column(Integer)
    mw: Mapped[Optional[float]] = mapped_column(Float)
    props: Mapped[Optional[dict]] = mapped_column(JSONB)

    __table_args__ = (
        UniqueConstraint(
            "inchikey", "charge", "spin_multiplicity", name="uq_species_identity"
        ),
        Index("ix_species_inchikey", "inchikey"),
    )

    conformers: Mapped[List["Conformer"]] = relationship(
        back_populates="species", cascade="all, delete-orphan"
    )

    def __repr__(self):
        return f"<Species(species_id={self.species_id}, inchi={self.inchi}, smiles={self.smiles})>"


class Conformer(TimeStampMixin, Base):
    __tablename__ = "conformer"
    conformer_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    species_id: Mapped[int] = mapped_column(
        ForeignKey("species.species_id", ondelete="CASCADE"), index=True, nullable=False
    )
    lot_id: Mapped[int] = mapped_column(
        ForeignKey("level_of_theory.lot_id", ondelete="RESTRICT"),
        index=True,
        nullable=False,
    )
    geometry_hash: Mapped[str] = mapped_column(String, index=True)
    well_label: Mapped[Optional[str]] = mapped_column(String)
    is_ts: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # store a canonical RDKit mol (rdkit type column)
    mol: Mapped[object] = mapped_column(Mol, nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "species_id", "geometry_hash", "lot_id", name="uq_conformer_geom"
        ),
        Index("ix_conformer_well", "well_label"),
    )

    species: Mapped["Species"] = relationship(back_populates="conformers")
    geom_lot: Mapped["LevelOfTheory"] = relationship()

    atoms: Mapped[List["ConformerAtom"]] = relationship(
        back_populates="conformer", cascade="all, delete-orphan"
    )
    distances: Mapped[List["GeomDistance"]] = relationship(
        back_populates="conformer", cascade="all, delete-orphan"
    )
    angles: Mapped[List["GeomAngle"]] = relationship(
        back_populates="conformer", cascade="all, delete-orphan"
    )
    dihedrals: Mapped[List["GeomDihedral"]] = relationship(
        back_populates="conformer", cascade="all, delete-orphan"
    )

    well_features: Mapped[Optional["WellFeatures"]] = relationship(
        lambda: WellFeatures,
        back_populates="conformer",
        uselist=False,
        cascade="all, delete-orphan",
    )

    ts_features: Mapped[Optional["TSFeatures"]] = relationship(
        lambda: TSFeatures,
        back_populates="conformer",
        uselist=False,
        cascade="all, delete-orphan",
    )

class WellFeatures(TimeStampMixin, Base):
    __tablename__ = "well_features"
    conformer_id: Mapped[int] = mapped_column(
        ForeignKey("conformer.conformer_id", ondelete="CASCADE"), primary_key=True
    )
    # Lot is already on Structure; no need to repeat unless you want redundancy
    E_elec: Mapped[Optional[float]] = mapped_column(Float)
    ZPE: Mapped[Optional[float]] = mapped_column(Float)
    H298: Mapped[Optional[float]] = mapped_column(Float)
    G298: Mapped[Optional[float]] = mapped_column(Float)
    meta: Mapped[Optional[dict]] = mapped_column(JSONB)
    conformer: Mapped[Conformer] = relationship(
        lambda: Conformer, back_populates="well_features"
    )


class ConformerAtom(Base):
    __tablename__ = "conformer_atom"
    atom_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    conformer_id: Mapped[int] = mapped_column(
        ForeignKey("conformer.conformer_id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    atom_idx: Mapped[int] = mapped_column(Integer, nullable=False)
    atomic_num: Mapped[int] = mapped_column(Integer, nullable=False)
    formal_charge: Mapped[Optional[int]] = mapped_column(Integer)
    is_aromatic: Mapped[Optional[bool]] = mapped_column(Boolean)
    q_mull: Mapped[Optional[float]] = mapped_column(Float)
    q_apt: Mapped[Optional[float]] = mapped_column(Float)
    spin: Mapped[Optional[int]] = mapped_column(Integer)
    Z: Mapped[Optional[int]] = mapped_column(Integer)
    mass: Mapped[Optional[float]] = mapped_column(Float)
    f_mag: Mapped[Optional[float]] = mapped_column(Float)
    xyz: Mapped[Optional[List[float]]] = mapped_column(JSON)

    __table_args__ = (
        UniqueConstraint("conformer_id", "atom_idx", name="uq_conf_atom_idx"),
    )

    conformer: Mapped["Conformer"] = relationship(back_populates="atoms")
    roles: Mapped[List["AtomRoleMap"]] = relationship(
        back_populates="atom", cascade="all, delete-orphan"
    )


class AtomRoleMap(Base):
    __tablename__ = "atom_role_map"
    atom_id: Mapped[int] = mapped_column(
        ForeignKey("conformer_atom.atom_id", ondelete="CASCADE"), primary_key=True
    )
    role: Mapped[str] = mapped_column(AtomRole, primary_key=True)
    atom: Mapped["ConformerAtom"] = relationship(back_populates="roles")


class AtomMapToTS(Base):
    __tablename__ = "atom_map_to_ts"
    ts_conformer_id: Mapped[int] = mapped_column(
        ForeignKey("conformer.conformer_id", ondelete="CASCADE"), primary_key=True
    )
    from_conformer_id: Mapped[int] = mapped_column(
        ForeignKey("conformer.conformer_id", ondelete="CASCADE"), primary_key=True
    )
    from_atom_id: Mapped[int] = mapped_column(
        ForeignKey("conformer_atom.atom_id", ondelete="CASCADE"), primary_key=True
    )
    ts_atom_id: Mapped[int] = mapped_column(
        ForeignKey("conformer_atom.atom_id", ondelete="CASCADE"), nullable=False
    )


class GeomDistance(Base):
    __tablename__ = "geom_distance"
    geom_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    conformer_id: Mapped[int] = mapped_column(
        ForeignKey("conformer.conformer_id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    frame: Mapped[str] = mapped_column(FeatureFrame, nullable=False, default="none")
    a1_id: Mapped[int] = mapped_column(
        ForeignKey("conformer_atom.atom_id", ondelete="CASCADE"), nullable=False
    )
    a2_id: Mapped[int] = mapped_column(
        ForeignKey("conformer_atom.atom_id", ondelete="CASCADE"), nullable=False
    )
    value_ang: Mapped[float] = mapped_column(Float, nullable=False)
    measure_name: Mapped[str] = mapped_column(String, nullable=False)
    units: Mapped[str] = mapped_column(String, nullable=False, default="ang")
    feature_ver: Mapped[Optional[str]] = mapped_column(String)

    __table_args__ = (Index("idx_gdist_measure_val", "measure_name", "value_ang"),)
    conformer: Mapped["Conformer"] = relationship(back_populates="distances")


class GeomAngle(Base):
    __tablename__ = "geom_angle"
    geom_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    conformer_id: Mapped[int] = mapped_column(
        ForeignKey("conformer.conformer_id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    frame: Mapped[str] = mapped_column(FeatureFrame, nullable=False, default="none")
    a1_id: Mapped[int] = mapped_column(
        ForeignKey("conformer_atom.atom_id", ondelete="CASCADE"), nullable=False
    )
    a2_id: Mapped[int] = mapped_column(
        ForeignKey("conformer_atom.atom_id", ondelete="CASCADE"), nullable=False
    )
    a3_id: Mapped[int] = mapped_column(
        ForeignKey("conformer_atom.atom_id", ondelete="CASCADE"), nullable=False
    )
    value_deg: Mapped[float] = mapped_column(Float, nullable=False)
    units: Mapped[str] = mapped_column(String, nullable=False, default="deg")
    measure_name: Mapped[str] = mapped_column(String, nullable=False)
    feature_ver: Mapped[Optional[str]] = mapped_column(String)

    __table_args__ = (Index("idx_gang_measure_val", "measure_name", "value_deg"),)
    conformer: Mapped["Conformer"] = relationship(back_populates="angles")


class GeomDihedral(Base):
    __tablename__ = "geom_dihedral"
    geom_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    conformer_id: Mapped[int] = mapped_column(
        ForeignKey("conformer.conformer_id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    frame: Mapped[str] = mapped_column(FeatureFrame, nullable=False, default="none")
    a1_id: Mapped[int] = mapped_column(
        ForeignKey("conformer_atom.atom_id", ondelete="CASCADE"), nullable=False
    )
    a2_id: Mapped[int] = mapped_column(
        ForeignKey("conformer_atom.atom_id", ondelete="CASCADE"), nullable=False
    )
    a3_id: Mapped[int] = mapped_column(
        ForeignKey("conformer_atom.atom_id", ondelete="CASCADE"), nullable=False
    )
    a4_id: Mapped[int] = mapped_column(
        ForeignKey("conformer_atom.atom_id", ondelete="CASCADE"), nullable=False
    )
    value_deg: Mapped[float] = mapped_column(Float, nullable=False)
    units: Mapped[str] = mapped_column(String, nullable=False)
    measure_name: Mapped[str] = mapped_column(String, nullable=False)
    feature_ver: Mapped[Optional[str]] = mapped_column(String)

    __table_args__ = (Index("idx_gdih_measure_val", "measure_name", "value_deg"),)
    conformer: Mapped["Conformer"] = relationship(back_populates="dihedrals")


class TSFeatures(Base):
    __tablename__ = "ts_features"
    # One row per (TS conformer, LoT) —> allows energies at multiple LoTs
    conformer_id: Mapped[int] = mapped_column(
        ForeignKey("conformer.conformer_id", ondelete="CASCADE"), primary_key=True
    )
    lot_id: Mapped[int] = mapped_column(
        ForeignKey("level_of_theory.lot_id", ondelete="RESTRICT"),
        primary_key=True,
        index=True,
    )
    imag_freq_cm1: Mapped[Optional[float]] = mapped_column(Float)
    irc_verified: Mapped[Optional[bool]] = mapped_column(Boolean)
    E_TS: Mapped[Optional[float]] = mapped_column(Float)
    E_R1H: Mapped[Optional[float]] = mapped_column(Float)
    E_R2H: Mapped[Optional[float]] = mapped_column(Float)
    delta_E_dagger: Mapped[Optional[float]] = mapped_column(Float)

    conformer: Mapped["Conformer"] = relationship(back_populates="ts_features")
    lot: Mapped["LevelOfTheory"] = relationship()


class LevelOfTheory(TimeStampMixin, Base):
    __tablename__ = "level_of_theory"

    lot_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    method: Mapped[str] = mapped_column(String, nullable=False)
    basis: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    solvent: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    lot_string: Mapped[str] = mapped_column(String, nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "method", "basis", "solvent", name="uq_lot_method_basis_solvent"
        ),
        Index("idx_lot_method_basis", "method", "basis"),
    )


class ReactionParticipant(TimeStampMixin, Base):
    __tablename__ = "reaction_participant"
    participant_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    reaction_id: Mapped[int] = mapped_column(
        ForeignKey("reactions.reaction_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    role: Mapped[str] = mapped_column(MolRole, nullable=False)
    conformer_id: Mapped[int] = mapped_column(
        ForeignKey("conformer.conformer_id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    __table_args__ = (UniqueConstraint("reaction_id", "role", name="uq_rxn_role"),)

    reaction: Mapped["Reaction"] = relationship(back_populates="participants")
    conformer: Mapped["Conformer"] = relationship()


class RateModel(TimeStampMixin, Base):
    __tablename__ = "rate_model"

    rate_model_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
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

    reaction: Mapped[Reaction] = relationship(
        lambda: Reaction, back_populates="rate_models"
    )
