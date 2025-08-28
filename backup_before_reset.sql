--
-- PostgreSQL database dump
--

-- Dumped from database version 17.5 (Debian 17.5-1)
-- Dumped by pg_dump version 17.5 (Debian 17.5-1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'SQL_ASCII';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: chem
--

-- *not* creating schema, since initdb creates it


ALTER SCHEMA public OWNER TO chem;

--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: chem
--

COMMENT ON SCHEMA public IS '';


--
-- Name: rdkit; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS rdkit WITH SCHEMA public;


--
-- Name: EXTENSION rdkit; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION rdkit IS 'Cheminformatics functionality for PostgreSQL.';


--
-- Name: atom_role; Type: TYPE; Schema: public; Owner: chem
--

CREATE TYPE public.atom_role AS ENUM (
    'donor',
    'acceptor',
    'd_hydrogen',
    'a_hydrogen',
    'none'
);


ALTER TYPE public.atom_role OWNER TO chem;

--
-- Name: feature_frame; Type: TYPE; Schema: public; Owner: chem
--

CREATE TYPE public.feature_frame AS ENUM (
    'ref_d_hydrogen',
    'ref_a_hydrogen',
    'none'
);


ALTER TYPE public.feature_frame OWNER TO chem;

--
-- Name: kin_direction; Type: TYPE; Schema: public; Owner: chem
--

CREATE TYPE public.kin_direction AS ENUM (
    'forward',
    'reverse'
);


ALTER TYPE public.kin_direction OWNER TO chem;

--
-- Name: mol_role; Type: TYPE; Schema: public; Owner: chem
--

CREATE TYPE public.mol_role AS ENUM (
    'R1H',
    'R2H',
    'TS'
);


ALTER TYPE public.mol_role OWNER TO chem;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: alembic_version; Type: TABLE; Schema: public; Owner: chem
--

CREATE TABLE public.alembic_version (
    version_num character varying(32) NOT NULL
);


ALTER TABLE public.alembic_version OWNER TO chem;

--
-- Name: atom; Type: TABLE; Schema: public; Owner: chem
--

CREATE TABLE public.atom (
    atom_id bigint NOT NULL,
    molecule_id bigint NOT NULL,
    atom_idx integer NOT NULL,
    atomic_num integer NOT NULL,
    formal_charge integer,
    is_aromatic boolean,
    xyz json,
    q_mull double precision,
    q_apt double precision,
    spin integer,
    "Z" integer,
    mass double precision,
    f_mag double precision
);


ALTER TABLE public.atom OWNER TO chem;

--
-- Name: atom_atom_id_seq; Type: SEQUENCE; Schema: public; Owner: chem
--

CREATE SEQUENCE public.atom_atom_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.atom_atom_id_seq OWNER TO chem;

--
-- Name: atom_atom_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: chem
--

ALTER SEQUENCE public.atom_atom_id_seq OWNED BY public.atom.atom_id;


--
-- Name: atom_map_to_ts; Type: TABLE; Schema: public; Owner: chem
--

CREATE TABLE public.atom_map_to_ts (
    reaction_id bigint NOT NULL,
    from_role public.mol_role NOT NULL,
    from_atom_id bigint NOT NULL,
    ts_atom_id bigint NOT NULL,
    CONSTRAINT ck_atommap_fromrole CHECK ((from_role = ANY (ARRAY['R1H'::public.mol_role, 'R2H'::public.mol_role])))
);


ALTER TABLE public.atom_map_to_ts OWNER TO chem;

--
-- Name: atom_role_map; Type: TABLE; Schema: public; Owner: chem
--

CREATE TABLE public.atom_role_map (
    atom_id bigint NOT NULL,
    role public.atom_role NOT NULL
);


ALTER TABLE public.atom_role_map OWNER TO chem;

--
-- Name: geom_angle; Type: TABLE; Schema: public; Owner: chem
--

CREATE TABLE public.geom_angle (
    geom_id bigint NOT NULL,
    molecule_id bigint NOT NULL,
    frame public.feature_frame NOT NULL,
    a1_id bigint NOT NULL,
    a2_id bigint NOT NULL,
    a3_id bigint NOT NULL,
    value_deg double precision NOT NULL,
    measure_name character varying NOT NULL,
    feature_ver character varying
);


ALTER TABLE public.geom_angle OWNER TO chem;

--
-- Name: geom_angle_geom_id_seq; Type: SEQUENCE; Schema: public; Owner: chem
--

CREATE SEQUENCE public.geom_angle_geom_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.geom_angle_geom_id_seq OWNER TO chem;

--
-- Name: geom_angle_geom_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: chem
--

ALTER SEQUENCE public.geom_angle_geom_id_seq OWNED BY public.geom_angle.geom_id;


--
-- Name: geom_dihedral; Type: TABLE; Schema: public; Owner: chem
--

CREATE TABLE public.geom_dihedral (
    geom_id bigint NOT NULL,
    molecule_id bigint NOT NULL,
    frame public.feature_frame NOT NULL,
    a1_id bigint NOT NULL,
    a2_id bigint NOT NULL,
    a3_id bigint NOT NULL,
    a4_id bigint NOT NULL,
    value_deg double precision NOT NULL,
    measure_name character varying NOT NULL,
    feature_ver character varying
);


ALTER TABLE public.geom_dihedral OWNER TO chem;

--
-- Name: geom_dihedral_geom_id_seq; Type: SEQUENCE; Schema: public; Owner: chem
--

CREATE SEQUENCE public.geom_dihedral_geom_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.geom_dihedral_geom_id_seq OWNER TO chem;

--
-- Name: geom_dihedral_geom_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: chem
--

ALTER SEQUENCE public.geom_dihedral_geom_id_seq OWNED BY public.geom_dihedral.geom_id;


--
-- Name: geom_distance; Type: TABLE; Schema: public; Owner: chem
--

CREATE TABLE public.geom_distance (
    geom_id bigint NOT NULL,
    molecule_id bigint NOT NULL,
    frame public.feature_frame NOT NULL,
    a1_id bigint NOT NULL,
    a2_id bigint NOT NULL,
    value_ang double precision NOT NULL,
    measure_name character varying NOT NULL,
    feature_ver character varying
);


ALTER TABLE public.geom_distance OWNER TO chem;

--
-- Name: geom_distance_geom_id_seq; Type: SEQUENCE; Schema: public; Owner: chem
--

CREATE SEQUENCE public.geom_distance_geom_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.geom_distance_geom_id_seq OWNER TO chem;

--
-- Name: geom_distance_geom_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: chem
--

ALTER SEQUENCE public.geom_distance_geom_id_seq OWNED BY public.geom_distance.geom_id;


--
-- Name: ingest_batch; Type: TABLE; Schema: public; Owner: chem
--

CREATE TABLE public.ingest_batch (
    batch_id bigint NOT NULL,
    source_label character varying NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.ingest_batch OWNER TO chem;

--
-- Name: ingest_batch_batch_id_seq; Type: SEQUENCE; Schema: public; Owner: chem
--

CREATE SEQUENCE public.ingest_batch_batch_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.ingest_batch_batch_id_seq OWNER TO chem;

--
-- Name: ingest_batch_batch_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: chem
--

ALTER SEQUENCE public.ingest_batch_batch_id_seq OWNED BY public.ingest_batch.batch_id;


--
-- Name: kinetics_set; Type: TABLE; Schema: public; Owner: chem
--

CREATE TABLE public.kinetics_set (
    kin_set_id bigint NOT NULL,
    reaction_id bigint NOT NULL,
    direction public.kin_direction NOT NULL,
    model character varying NOT NULL,
    "A" double precision NOT NULL,
    n double precision,
    "Ea_kJ_mol" double precision NOT NULL,
    "Tmin_K" double precision NOT NULL,
    "Tmax_K" double precision NOT NULL,
    source character varying,
    reference character varying,
    computed_from character varying,
    "dA_factor" double precision,
    dn_abs double precision,
    "dEa_kJ_mol" double precision,
    meta jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.kinetics_set OWNER TO chem;

--
-- Name: kinetics_set_kin_set_id_seq; Type: SEQUENCE; Schema: public; Owner: chem
--

CREATE SEQUENCE public.kinetics_set_kin_set_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.kinetics_set_kin_set_id_seq OWNER TO chem;

--
-- Name: kinetics_set_kin_set_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: chem
--

ALTER SEQUENCE public.kinetics_set_kin_set_id_seq OWNED BY public.kinetics_set.kin_set_id;


--
-- Name: level_of_theory; Type: TABLE; Schema: public; Owner: chem
--

CREATE TABLE public.level_of_theory (
    lot_id bigint NOT NULL,
    method character varying NOT NULL,
    basis character varying,
    solvent character varying,
    lot_string character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.level_of_theory OWNER TO chem;

--
-- Name: level_of_theory_lot_id_seq; Type: SEQUENCE; Schema: public; Owner: chem
--

CREATE SEQUENCE public.level_of_theory_lot_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.level_of_theory_lot_id_seq OWNER TO chem;

--
-- Name: level_of_theory_lot_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: chem
--

ALTER SEQUENCE public.level_of_theory_lot_id_seq OWNED BY public.level_of_theory.lot_id;


--
-- Name: molecule; Type: TABLE; Schema: public; Owner: chem
--

CREATE TABLE public.molecule (
    molecule_id bigint NOT NULL,
    reaction_id bigint NOT NULL,
    role public.mol_role NOT NULL,
    mol public.mol NOT NULL,
    smiles character varying,
    inchikey character varying,
    charge double precision,
    spin_mult integer,
    mw double precision,
    props jsonb,
    source_file character varying,
    record_index integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    geometry_hash character varying,
    lot_id bigint NOT NULL
);


ALTER TABLE public.molecule OWNER TO chem;

--
-- Name: molecule_molecule_id_seq; Type: SEQUENCE; Schema: public; Owner: chem
--

CREATE SEQUENCE public.molecule_molecule_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.molecule_molecule_id_seq OWNER TO chem;

--
-- Name: molecule_molecule_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: chem
--

ALTER SEQUENCE public.molecule_molecule_id_seq OWNED BY public.molecule.molecule_id;


--
-- Name: reactions; Type: TABLE; Schema: public; Owner: chem
--

CREATE TABLE public.reactions (
    reaction_id bigint NOT NULL,
    batch_id bigint,
    reaction_name character varying,
    family character varying NOT NULL,
    meta_data jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.reactions OWNER TO chem;

--
-- Name: reactions_reaction_id_seq; Type: SEQUENCE; Schema: public; Owner: chem
--

CREATE SEQUENCE public.reactions_reaction_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.reactions_reaction_id_seq OWNER TO chem;

--
-- Name: reactions_reaction_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: chem
--

ALTER SEQUENCE public.reactions_reaction_id_seq OWNED BY public.reactions.reaction_id;


--
-- Name: ts_features; Type: TABLE; Schema: public; Owner: chem
--

CREATE TABLE public.ts_features (
    molecule_id bigint NOT NULL,
    imag_freq_cm1 double precision,
    irc_verified boolean,
    "E_TS" double precision,
    "E_R1H" double precision,
    "E_R2H" double precision,
    "delta_E_dagger" double precision,
    lot_id bigint NOT NULL
);


ALTER TABLE public.ts_features OWNER TO chem;

--
-- Name: atom atom_id; Type: DEFAULT; Schema: public; Owner: chem
--

ALTER TABLE ONLY public.atom ALTER COLUMN atom_id SET DEFAULT nextval('public.atom_atom_id_seq'::regclass);


--
-- Name: geom_angle geom_id; Type: DEFAULT; Schema: public; Owner: chem
--

ALTER TABLE ONLY public.geom_angle ALTER COLUMN geom_id SET DEFAULT nextval('public.geom_angle_geom_id_seq'::regclass);


--
-- Name: geom_dihedral geom_id; Type: DEFAULT; Schema: public; Owner: chem
--

ALTER TABLE ONLY public.geom_dihedral ALTER COLUMN geom_id SET DEFAULT nextval('public.geom_dihedral_geom_id_seq'::regclass);


--
-- Name: geom_distance geom_id; Type: DEFAULT; Schema: public; Owner: chem
--

ALTER TABLE ONLY public.geom_distance ALTER COLUMN geom_id SET DEFAULT nextval('public.geom_distance_geom_id_seq'::regclass);


--
-- Name: ingest_batch batch_id; Type: DEFAULT; Schema: public; Owner: chem
--

ALTER TABLE ONLY public.ingest_batch ALTER COLUMN batch_id SET DEFAULT nextval('public.ingest_batch_batch_id_seq'::regclass);


--
-- Name: kinetics_set kin_set_id; Type: DEFAULT; Schema: public; Owner: chem
--

ALTER TABLE ONLY public.kinetics_set ALTER COLUMN kin_set_id SET DEFAULT nextval('public.kinetics_set_kin_set_id_seq'::regclass);


--
-- Name: level_of_theory lot_id; Type: DEFAULT; Schema: public; Owner: chem
--

ALTER TABLE ONLY public.level_of_theory ALTER COLUMN lot_id SET DEFAULT nextval('public.level_of_theory_lot_id_seq'::regclass);


--
-- Name: molecule molecule_id; Type: DEFAULT; Schema: public; Owner: chem
--

ALTER TABLE ONLY public.molecule ALTER COLUMN molecule_id SET DEFAULT nextval('public.molecule_molecule_id_seq'::regclass);


--
-- Name: reactions reaction_id; Type: DEFAULT; Schema: public; Owner: chem
--

ALTER TABLE ONLY public.reactions ALTER COLUMN reaction_id SET DEFAULT nextval('public.reactions_reaction_id_seq'::regclass);


--
-- Data for Name: alembic_version; Type: TABLE DATA; Schema: public; Owner: chem
--

COPY public.alembic_version (version_num) FROM stdin;
9937fade1dc1
\.


--
-- Data for Name: atom; Type: TABLE DATA; Schema: public; Owner: chem
--

COPY public.atom (atom_id, molecule_id, atom_idx, atomic_num, formal_charge, is_aromatic, xyz, q_mull, q_apt, spin, "Z", mass, f_mag) FROM stdin;
12	3	0	7	0	f	[0.2264, -0.7425, 1.4864]	\N	\N	\N	\N	\N	\N
13	3	1	6	0	t	[0.0664, -0.0028, 0.5037]	\N	\N	\N	\N	\N	\N
14	3	2	8	0	t	[0.1865, 1.3608, 0.5207]	\N	\N	\N	\N	\N	\N
15	3	3	7	0	t	[-0.0641, 1.8099, -0.7517]	\N	\N	\N	\N	\N	\N
16	3	4	7	0	t	[-0.3128, 0.8733, -1.4952]	\N	\N	\N	\N	\N	\N
17	3	5	8	0	t	[-0.2548, -0.3138, -0.7937]	\N	\N	\N	\N	\N	\N
18	3	6	7	0	f	[-0.1466, -3.0163, 0.6977]	\N	\N	\N	\N	\N	\N
19	3	7	1	0	f	[0.0784, -1.9554, 1.29]	\N	\N	\N	\N	\N	\N
20	3	8	1	0	f	[-1.0724, -2.9425, 0.2769]	\N	\N	\N	\N	\N	\N
21	3	9	1	0	f	[0.5077, -3.0773, -0.0819]	\N	\N	\N	\N	\N	\N
1	1	0	7	0	f	[0.0006, -0.0009, 0.2762]	-0.643315	-0.534061	0	7	14.003074	0.1389367577003638
2	1	1	1	0	f	[-0.4188, 0.8439, -0.0883]	0.227405	0.173249	0	1	1.007825	0.008131906112819796
3	1	2	1	0	f	[-0.5215, -0.784, -0.0936]	0.207883	0.180568	0	1	1.007825	0.12436894739827885
4	1	3	1	0	f	[0.9397, -0.059, -0.0943]	0.208027	0.180244	0	1	1.007825	0.124345018623684
5	2	0	7	0	f	[1.6064, -0.4313, 0.1905]	-0.362566	-0.735198	0	7	14.003074	0.002674982723026263
6	2	1	6	0	t	[0.3982, -0.1725, 0.0701]	0.280858	1.087316	0	6	12	0.005574711094985461
7	2	2	8	0	t	[-0.6051, -1.0481, 0.3497]	-0.122666	-0.503876	0	8	15.9949146	0.006240923230375455
8	2	3	7	0	t	[-1.7906, -0.4044, 0.0958]	0.053832	0.219308	0	7	14.003074	0.0012265758746257812
9	2	4	7	0	t	[-1.5819, 0.7348, -0.2956]	0.045524	0.206995	0	7	14.003074	0.0019298124143276205
10	2	5	8	0	t	[-0.2229, 0.9708, -0.3436]	-0.148786	-0.529366	0	8	15.9949146	0.003682303402019312
11	2	6	1	0	f	[2.1958, 0.3506, -0.0669]	0.253804	0.25482	0	1	1.007825	0.01016825589328932
\.


--
-- Data for Name: atom_map_to_ts; Type: TABLE DATA; Schema: public; Owner: chem
--

COPY public.atom_map_to_ts (reaction_id, from_role, from_atom_id, ts_atom_id) FROM stdin;
\.


--
-- Data for Name: atom_role_map; Type: TABLE DATA; Schema: public; Owner: chem
--

COPY public.atom_role_map (atom_id, role) FROM stdin;
1	donor
2	d_hydrogen
5	acceptor
11	a_hydrogen
\.


--
-- Data for Name: geom_angle; Type: TABLE DATA; Schema: public; Owner: chem
--

COPY public.geom_angle (geom_id, molecule_id, frame, a1_id, a2_id, a3_id, value_deg, measure_name, feature_ver) FROM stdin;
1	1	ref_d_hydrogen	2	1	3	107.51452958677247	csv_angle	csv_v1
2	1	ref_d_hydrogen	2	1	4	107.51674516330156	csv_angle	csv_v1
3	2	ref_a_hydrogen	5	6	7	124.95042692652923	csv_angle	csv_v1
4	2	ref_a_hydrogen	5	6	10	130.09742936563381	csv_angle	csv_v1
\.


--
-- Data for Name: geom_dihedral; Type: TABLE DATA; Schema: public; Owner: chem
--

COPY public.geom_dihedral (geom_id, molecule_id, frame, a1_id, a2_id, a3_id, a4_id, value_deg, measure_name, feature_ver) FROM stdin;
1	2	ref_a_hydrogen	5	6	7	8	-179.9968684283729	csv_dihedral	csv_v1
2	2	ref_a_hydrogen	5	6	10	9	179.99803123209463	csv_dihedral	csv_v1
\.


--
-- Data for Name: geom_distance; Type: TABLE DATA; Schema: public; Owner: chem
--

COPY public.geom_distance (geom_id, molecule_id, frame, a1_id, a2_id, value_ang, measure_name, feature_ver) FROM stdin;
1	1	ref_d_hydrogen	2	1	1.0196078707032423	csv_radius	csv_v1
2	2	ref_a_hydrogen	5	6	1.2403448633343872	csv_radius	csv_v1
3	2	ref_a_hydrogen	5	11	1.0399528883560063	csv_radius	csv_v1
\.


--
-- Data for Name: ingest_batch; Type: TABLE DATA; Schema: public; Owner: chem
--

COPY public.ingest_batch (batch_id, source_label, notes, created_at, updated_at) FROM stdin;
1	batch-aug20	SDF: /home/calvin/code/chemprop_phd_customised/habnet/data/processed/sdf_data_correct_lbl_map/kfir_rxn_2.sdf	2025-08-23 22:14:12.204912+00	2025-08-23 22:14:12.204912+00
\.


--
-- Data for Name: kinetics_set; Type: TABLE DATA; Schema: public; Owner: chem
--

COPY public.kinetics_set (kin_set_id, reaction_id, direction, model, "A", n, "Ea_kJ_mol", "Tmin_K", "Tmax_K", source, reference, computed_from, "dA_factor", dn_abs, "dEa_kJ_mol", meta, created_at, updated_at) FROM stdin;
1	1	reverse	TST	78.7977	3.15404	14.6845	300	3000	arrhenius_csv	\N	\N	1.15104	0.0183216	0.104776	{"T0": "1.0 K", "A_units": "cm^3/(mol*s)", "Ea_units": "kJ/mol", "label_raw": "k_rev (TST)", "source_comment": "Fitted to 50 data points; dA = *|/ 1.15104, dn = +|- 0.0183216, dEa = +|- 0.104776 kJ/mol"}	2025-08-23 22:14:12.204912+00	2025-08-23 22:14:12.204912+00
2	1	reverse	TST+T	0.0848958	3.97309	2.82196	300	3000	arrhenius_csv	\N	\N	1.24737	0.0287904	0.164645	{"T0": "1.0 K", "A_units": "cm^3/(mol*s)", "Ea_units": "kJ/mol", "label_raw": "k_rev (TST+T)", "source_comment": "Fitted to 50 data points; dA = *|/ 1.24737, dn = +|- 0.0287904, dEa = +|- 0.164645 kJ/mol"}	2025-08-23 22:14:12.204912+00	2025-08-23 22:14:12.204912+00
3	1	forward	TST+T	0.0188454	4.25624	10.0245	300	3000	arrhenius_csv	\N	\N	1.30452	0.0346253	0.198013	{"T0": "1.0 K", "A_units": "cm^3/(mol*s)", "Ea_units": "kJ/mol", "label_raw": "k_for (TST+T)", "source_comment": "Fitted to 50 data points; dA = *|/ 1.30452, dn = +|- 0.0346253, dEa = +|- 0.198013 kJ/mol"}	2025-08-23 22:14:12.204912+00	2025-08-23 22:14:12.204912+00
\.


--
-- Data for Name: level_of_theory; Type: TABLE DATA; Schema: public; Owner: chem
--

COPY public.level_of_theory (lot_id, method, basis, solvent, lot_string, created_at, updated_at) FROM stdin;
1	wb97xd	def2tzvp	\N	wb97xd/def2tzvp	2025-08-23 22:14:12.204912+00	2025-08-23 22:14:12.204912+00
\.


--
-- Data for Name: molecule; Type: TABLE DATA; Schema: public; Owner: chem
--

COPY public.molecule (molecule_id, reaction_id, role, mol, smiles, inchikey, charge, spin_mult, mw, props, source_file, record_index, created_at, updated_at, geometry_hash, lot_id) FROM stdin;
1	1	R1H	N	[H]N([H])[H]	QGZKDVFQNNGYKY-UHFFFAOYSA-N	0	1	17.031	{"type": "r1h", "_Name": "", "numArom": "0", "reaction": "kfir_rxn_2", "lot_basis": "def2tzvp", "lot_method": "wb97xd", "electro_map": "{\\"1\\": {\\"R\\": null, \\"A\\": null, \\"D\\": null}, \\"0\\": {\\"R\\": 1.011220654744216, \\"A\\": null, \\"D\\": null}, \\"2\\": {\\"R\\": 1.011220654744216, \\"A\\": 107.51937340550197, \\"D\\": null}, \\"3\\": {\\"R\\": 1.631189516195832, \\"A\\": 60.000025759821504, \\"D\\": 321.96985732834503}}", "_MolFileInfo": "     RDKit          3D", "mol_properties": "{\\"0\\": {\\"label\\": \\"donator\\", \\"atom_type\\": \\"N3s\\"}, \\"1\\": {\\"label\\": \\"d_hydrogen\\", \\"atom_type\\": \\"H0\\"}}", "_StereochemDone": "1", "__computedProps": "<rdkit.rdBase._vectNSt7__cxx1112basic_stringIcSt11char_traitsIcESaIcEEE object at 0x7f9dc5a791c0>", "level_of_theory": "wb97xd/def2tzvp", "_MolFileComments": "", "_MolFileChiralFlag": "0"}	kfir_rxn_2	0	2025-08-23 22:14:12.204912+00	2025-08-23 22:14:12.204912+00	e70537fa9753d0d0a5a2fd49bc51ed8585a5018c	1
2	1	R2H	N=c1onno1	[H]N=c1onno1	GPHHUUCTYAIWRU-UHFFFAOYSA-N	0	1	87.038	{"type": "r2h", "_Name": "", "numArom": "1", "reaction": "kfir_rxn_2", "lot_basis": "def2tzvp", "lot_method": "wb97xd", "electro_map": "{\\"6\\": {\\"R\\": null, \\"A\\": null, \\"D\\": null}, \\"0\\": {\\"R\\": 1.0124416051908913, \\"A\\": null, \\"D\\": null}, \\"1\\": {\\"R\\": 1.241490534423313, \\"A\\": 112.3883852499786, \\"D\\": null}, \\"2\\": {\\"R\\": 1.3606983627285936, \\"A\\": 154.21045604003945, \\"D\\": 8.120280601986813e-05}, \\"5\\": {\\"R\\": 2.168546032727258, \\"A\\": 37.36824222024975, \\"D\\": 179.99997160640987}, \\"3\\": {\\"R\\": 2.131184050582797, \\"A\\": 37.222419354333, \\"D\\": 179.99996247278753}, \\"4\\": {\\"R\\": 1.222444851183304, \\"A\\": 37.5440299229899, \\"D\\": 179.99994617161977}}", "_MolFileInfo": "     RDKit          3D", "mol_properties": "{\\"0\\": {\\"label\\": \\"acceptor\\", \\"atom_type\\": \\"N3d\\"}, \\"6\\": {\\"label\\": \\"a_hydrogen\\", \\"atom_type\\": \\"H0\\"}}", "_StereochemDone": "1", "__computedProps": "<rdkit.rdBase._vectNSt7__cxx1112basic_stringIcSt11char_traitsIcESaIcEEE object at 0x7f9dc5a791c0>", "level_of_theory": "wb97xd/def2tzvp", "_MolFileComments": "", "_MolFileChiralFlag": "0"}	kfir_rxn_2	1	2025-08-23 22:14:12.204912+00	2025-08-23 22:14:12.204912+00	87eb075092356bc292cf0be7f17fd14786b7544b	1
3	1	TS	N.[N]=c1onno1 |^1:1|	[H]N([H])[H].[N]=c1onno1	HJOKGRVGJWVDSY-UHFFFAOYSA-N	0	2	103.06099999999999	{"type": "ts", "_Name": "", "numArom": "1", "reaction": "kfir_rxn_2", "lot_basis": "def2tzvp", "lot_method": "wb97xd", "_MolFileInfo": "     RDKit          3D", "mol_properties": "{\\"0\\": {\\"label\\": \\"*3\\", \\"atom_type\\": \\"N3d\\"}, \\"1\\": {\\"label\\": \\"*4\\", \\"atom_type\\": \\"Cd\\"}, \\"6\\": {\\"label\\": \\"*1\\", \\"atom_type\\": \\"N3s\\"}, \\"7\\": {\\"label\\": \\"*2\\", \\"atom_type\\": \\"H0\\"}, \\"8\\": {\\"label\\": \\"*0\\", \\"atom_type\\": \\"H0\\"}}", "_StereochemDone": "1", "__computedProps": "<rdkit.rdBase._vectNSt7__cxx1112basic_stringIcSt11char_traitsIcESaIcEEE object at 0x7f9dc5a791c0>", "level_of_theory": "wb97xd/def2tzvp", "_MolFileComments": "", "_MolFileChiralFlag": "0"}	kfir_rxn_2	2	2025-08-23 22:14:12.204912+00	2025-08-23 22:14:12.204912+00	a3af1c479a48fbf605393f69b46c0a3ff1586ed6	1
\.


--
-- Data for Name: reactions; Type: TABLE DATA; Schema: public; Owner: chem
--

COPY public.reactions (reaction_id, batch_id, reaction_name, family, meta_data, created_at, updated_at) FROM stdin;
1	1	kfir_rxn_2	H_abstraction	\N	2025-08-23 22:14:12.204912+00	2025-08-23 22:14:12.204912+00
\.


--
-- Data for Name: ts_features; Type: TABLE DATA; Schema: public; Owner: chem
--

COPY public.ts_features (molecule_id, imag_freq_cm1, irc_verified, "E_TS", "E_R1H", "E_R2H", "delta_E_dagger", lot_id) FROM stdin;
\.


--
-- Name: atom_atom_id_seq; Type: SEQUENCE SET; Schema: public; Owner: chem
--

SELECT pg_catalog.setval('public.atom_atom_id_seq', 21, true);


--
-- Name: geom_angle_geom_id_seq; Type: SEQUENCE SET; Schema: public; Owner: chem
--

SELECT pg_catalog.setval('public.geom_angle_geom_id_seq', 4, true);


--
-- Name: geom_dihedral_geom_id_seq; Type: SEQUENCE SET; Schema: public; Owner: chem
--

SELECT pg_catalog.setval('public.geom_dihedral_geom_id_seq', 2, true);


--
-- Name: geom_distance_geom_id_seq; Type: SEQUENCE SET; Schema: public; Owner: chem
--

SELECT pg_catalog.setval('public.geom_distance_geom_id_seq', 3, true);


--
-- Name: ingest_batch_batch_id_seq; Type: SEQUENCE SET; Schema: public; Owner: chem
--

SELECT pg_catalog.setval('public.ingest_batch_batch_id_seq', 1, true);


--
-- Name: kinetics_set_kin_set_id_seq; Type: SEQUENCE SET; Schema: public; Owner: chem
--

SELECT pg_catalog.setval('public.kinetics_set_kin_set_id_seq', 3, true);


--
-- Name: level_of_theory_lot_id_seq; Type: SEQUENCE SET; Schema: public; Owner: chem
--

SELECT pg_catalog.setval('public.level_of_theory_lot_id_seq', 1, true);


--
-- Name: molecule_molecule_id_seq; Type: SEQUENCE SET; Schema: public; Owner: chem
--

SELECT pg_catalog.setval('public.molecule_molecule_id_seq', 3, true);


--
-- Name: reactions_reaction_id_seq; Type: SEQUENCE SET; Schema: public; Owner: chem
--

SELECT pg_catalog.setval('public.reactions_reaction_id_seq', 1, true);


--
-- Name: alembic_version alembic_version_pkc; Type: CONSTRAINT; Schema: public; Owner: chem
--

ALTER TABLE ONLY public.alembic_version
    ADD CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num);


--
-- Name: atom_map_to_ts atom_map_to_ts_pkey; Type: CONSTRAINT; Schema: public; Owner: chem
--

ALTER TABLE ONLY public.atom_map_to_ts
    ADD CONSTRAINT atom_map_to_ts_pkey PRIMARY KEY (reaction_id, from_role, from_atom_id);


--
-- Name: atom atom_pkey; Type: CONSTRAINT; Schema: public; Owner: chem
--

ALTER TABLE ONLY public.atom
    ADD CONSTRAINT atom_pkey PRIMARY KEY (atom_id);


--
-- Name: atom_role_map atom_role_map_pkey; Type: CONSTRAINT; Schema: public; Owner: chem
--

ALTER TABLE ONLY public.atom_role_map
    ADD CONSTRAINT atom_role_map_pkey PRIMARY KEY (atom_id, role);


--
-- Name: geom_angle geom_angle_pkey; Type: CONSTRAINT; Schema: public; Owner: chem
--

ALTER TABLE ONLY public.geom_angle
    ADD CONSTRAINT geom_angle_pkey PRIMARY KEY (geom_id);


--
-- Name: geom_dihedral geom_dihedral_pkey; Type: CONSTRAINT; Schema: public; Owner: chem
--

ALTER TABLE ONLY public.geom_dihedral
    ADD CONSTRAINT geom_dihedral_pkey PRIMARY KEY (geom_id);


--
-- Name: geom_distance geom_distance_pkey; Type: CONSTRAINT; Schema: public; Owner: chem
--

ALTER TABLE ONLY public.geom_distance
    ADD CONSTRAINT geom_distance_pkey PRIMARY KEY (geom_id);


--
-- Name: ingest_batch ingest_batch_pkey; Type: CONSTRAINT; Schema: public; Owner: chem
--

ALTER TABLE ONLY public.ingest_batch
    ADD CONSTRAINT ingest_batch_pkey PRIMARY KEY (batch_id);


--
-- Name: kinetics_set kinetics_set_pkey; Type: CONSTRAINT; Schema: public; Owner: chem
--

ALTER TABLE ONLY public.kinetics_set
    ADD CONSTRAINT kinetics_set_pkey PRIMARY KEY (kin_set_id);


--
-- Name: level_of_theory level_of_theory_pkey; Type: CONSTRAINT; Schema: public; Owner: chem
--

ALTER TABLE ONLY public.level_of_theory
    ADD CONSTRAINT level_of_theory_pkey PRIMARY KEY (lot_id);


--
-- Name: molecule molecule_pkey; Type: CONSTRAINT; Schema: public; Owner: chem
--

ALTER TABLE ONLY public.molecule
    ADD CONSTRAINT molecule_pkey PRIMARY KEY (molecule_id);


--
-- Name: reactions reactions_pkey; Type: CONSTRAINT; Schema: public; Owner: chem
--

ALTER TABLE ONLY public.reactions
    ADD CONSTRAINT reactions_pkey PRIMARY KEY (reaction_id);


--
-- Name: reactions reactions_reaction_name_key; Type: CONSTRAINT; Schema: public; Owner: chem
--

ALTER TABLE ONLY public.reactions
    ADD CONSTRAINT reactions_reaction_name_key UNIQUE (reaction_name);


--
-- Name: ts_features ts_features_pkey; Type: CONSTRAINT; Schema: public; Owner: chem
--

ALTER TABLE ONLY public.ts_features
    ADD CONSTRAINT ts_features_pkey PRIMARY KEY (molecule_id);


--
-- Name: atom uq_atom_mol_idx; Type: CONSTRAINT; Schema: public; Owner: chem
--

ALTER TABLE ONLY public.atom
    ADD CONSTRAINT uq_atom_mol_idx UNIQUE (molecule_id, atom_idx);


--
-- Name: kinetics_set uq_kset_identity; Type: CONSTRAINT; Schema: public; Owner: chem
--

ALTER TABLE ONLY public.kinetics_set
    ADD CONSTRAINT uq_kset_identity UNIQUE (reaction_id, direction, source, reference, "Tmin_K", "Tmax_K");


--
-- Name: level_of_theory uq_lot_method_basis_solvent; Type: CONSTRAINT; Schema: public; Owner: chem
--

ALTER TABLE ONLY public.level_of_theory
    ADD CONSTRAINT uq_lot_method_basis_solvent UNIQUE (method, basis, solvent);


--
-- Name: molecule uq_mol_rxn_role_geom; Type: CONSTRAINT; Schema: public; Owner: chem
--

ALTER TABLE ONLY public.molecule
    ADD CONSTRAINT uq_mol_rxn_role_geom UNIQUE (reaction_id, role, geometry_hash);


--
-- Name: idx_atom_molecule; Type: INDEX; Schema: public; Owner: chem
--

CREATE INDEX idx_atom_molecule ON public.atom USING btree (molecule_id);


--
-- Name: idx_atommap_reaction_role; Type: INDEX; Schema: public; Owner: chem
--

CREATE INDEX idx_atommap_reaction_role ON public.atom_map_to_ts USING btree (reaction_id, from_role);


--
-- Name: idx_gang_measure_val; Type: INDEX; Schema: public; Owner: chem
--

CREATE INDEX idx_gang_measure_val ON public.geom_angle USING btree (measure_name, value_deg);


--
-- Name: idx_gang_molecule; Type: INDEX; Schema: public; Owner: chem
--

CREATE INDEX idx_gang_molecule ON public.geom_angle USING btree (molecule_id);


--
-- Name: idx_gdih_measure_val; Type: INDEX; Schema: public; Owner: chem
--

CREATE INDEX idx_gdih_measure_val ON public.geom_dihedral USING btree (measure_name, value_deg);


--
-- Name: idx_gdih_molecule; Type: INDEX; Schema: public; Owner: chem
--

CREATE INDEX idx_gdih_molecule ON public.geom_dihedral USING btree (molecule_id);


--
-- Name: idx_gdist_measure_val; Type: INDEX; Schema: public; Owner: chem
--

CREATE INDEX idx_gdist_measure_val ON public.geom_distance USING btree (measure_name, value_ang);


--
-- Name: idx_gdist_molecule; Type: INDEX; Schema: public; Owner: chem
--

CREATE INDEX idx_gdist_molecule ON public.geom_distance USING btree (molecule_id);


--
-- Name: idx_kset_T; Type: INDEX; Schema: public; Owner: chem
--

CREATE INDEX "idx_kset_T" ON public.kinetics_set USING btree ("Tmin_K", "Tmax_K");


--
-- Name: idx_kset_reaction_dir; Type: INDEX; Schema: public; Owner: chem
--

CREATE INDEX idx_kset_reaction_dir ON public.kinetics_set USING btree (reaction_id, direction);


--
-- Name: idx_lot_method_basis; Type: INDEX; Schema: public; Owner: chem
--

CREATE INDEX idx_lot_method_basis ON public.level_of_theory USING btree (method, basis);


--
-- Name: idx_molecule_charge; Type: INDEX; Schema: public; Owner: chem
--

CREATE INDEX idx_molecule_charge ON public.molecule USING btree (charge);


--
-- Name: idx_molecule_spinmult; Type: INDEX; Schema: public; Owner: chem
--

CREATE INDEX idx_molecule_spinmult ON public.molecule USING btree (spin_mult);


--
-- Name: ix_molecule_geometry_hash; Type: INDEX; Schema: public; Owner: chem
--

CREATE INDEX ix_molecule_geometry_hash ON public.molecule USING btree (geometry_hash);


--
-- Name: ix_molecule_lot_id; Type: INDEX; Schema: public; Owner: chem
--

CREATE INDEX ix_molecule_lot_id ON public.molecule USING btree (lot_id);


--
-- Name: ix_molecule_mw; Type: INDEX; Schema: public; Owner: chem
--

CREATE INDEX ix_molecule_mw ON public.molecule USING btree (mw);


--
-- Name: ix_molecule_role; Type: INDEX; Schema: public; Owner: chem
--

CREATE INDEX ix_molecule_role ON public.molecule USING btree (role);


--
-- Name: atom_map_to_ts atom_map_to_ts_from_atom_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: chem
--

ALTER TABLE ONLY public.atom_map_to_ts
    ADD CONSTRAINT atom_map_to_ts_from_atom_id_fkey FOREIGN KEY (from_atom_id) REFERENCES public.atom(atom_id) ON DELETE CASCADE;


--
-- Name: atom_map_to_ts atom_map_to_ts_reaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: chem
--

ALTER TABLE ONLY public.atom_map_to_ts
    ADD CONSTRAINT atom_map_to_ts_reaction_id_fkey FOREIGN KEY (reaction_id) REFERENCES public.reactions(reaction_id) ON DELETE CASCADE;


--
-- Name: atom_map_to_ts atom_map_to_ts_ts_atom_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: chem
--

ALTER TABLE ONLY public.atom_map_to_ts
    ADD CONSTRAINT atom_map_to_ts_ts_atom_id_fkey FOREIGN KEY (ts_atom_id) REFERENCES public.atom(atom_id) ON DELETE CASCADE;


--
-- Name: atom atom_molecule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: chem
--

ALTER TABLE ONLY public.atom
    ADD CONSTRAINT atom_molecule_id_fkey FOREIGN KEY (molecule_id) REFERENCES public.molecule(molecule_id) ON DELETE CASCADE;


--
-- Name: atom_role_map atom_role_map_atom_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: chem
--

ALTER TABLE ONLY public.atom_role_map
    ADD CONSTRAINT atom_role_map_atom_id_fkey FOREIGN KEY (atom_id) REFERENCES public.atom(atom_id) ON DELETE CASCADE;


--
-- Name: geom_angle geom_angle_a1_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: chem
--

ALTER TABLE ONLY public.geom_angle
    ADD CONSTRAINT geom_angle_a1_id_fkey FOREIGN KEY (a1_id) REFERENCES public.atom(atom_id) ON DELETE CASCADE;


--
-- Name: geom_angle geom_angle_a2_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: chem
--

ALTER TABLE ONLY public.geom_angle
    ADD CONSTRAINT geom_angle_a2_id_fkey FOREIGN KEY (a2_id) REFERENCES public.atom(atom_id) ON DELETE CASCADE;


--
-- Name: geom_angle geom_angle_a3_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: chem
--

ALTER TABLE ONLY public.geom_angle
    ADD CONSTRAINT geom_angle_a3_id_fkey FOREIGN KEY (a3_id) REFERENCES public.atom(atom_id) ON DELETE CASCADE;


--
-- Name: geom_angle geom_angle_molecule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: chem
--

ALTER TABLE ONLY public.geom_angle
    ADD CONSTRAINT geom_angle_molecule_id_fkey FOREIGN KEY (molecule_id) REFERENCES public.molecule(molecule_id) ON DELETE CASCADE;


--
-- Name: geom_dihedral geom_dihedral_a1_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: chem
--

ALTER TABLE ONLY public.geom_dihedral
    ADD CONSTRAINT geom_dihedral_a1_id_fkey FOREIGN KEY (a1_id) REFERENCES public.atom(atom_id) ON DELETE CASCADE;


--
-- Name: geom_dihedral geom_dihedral_a2_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: chem
--

ALTER TABLE ONLY public.geom_dihedral
    ADD CONSTRAINT geom_dihedral_a2_id_fkey FOREIGN KEY (a2_id) REFERENCES public.atom(atom_id) ON DELETE CASCADE;


--
-- Name: geom_dihedral geom_dihedral_a3_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: chem
--

ALTER TABLE ONLY public.geom_dihedral
    ADD CONSTRAINT geom_dihedral_a3_id_fkey FOREIGN KEY (a3_id) REFERENCES public.atom(atom_id) ON DELETE CASCADE;


--
-- Name: geom_dihedral geom_dihedral_a4_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: chem
--

ALTER TABLE ONLY public.geom_dihedral
    ADD CONSTRAINT geom_dihedral_a4_id_fkey FOREIGN KEY (a4_id) REFERENCES public.atom(atom_id) ON DELETE CASCADE;


--
-- Name: geom_dihedral geom_dihedral_molecule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: chem
--

ALTER TABLE ONLY public.geom_dihedral
    ADD CONSTRAINT geom_dihedral_molecule_id_fkey FOREIGN KEY (molecule_id) REFERENCES public.molecule(molecule_id) ON DELETE CASCADE;


--
-- Name: geom_distance geom_distance_a1_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: chem
--

ALTER TABLE ONLY public.geom_distance
    ADD CONSTRAINT geom_distance_a1_id_fkey FOREIGN KEY (a1_id) REFERENCES public.atom(atom_id) ON DELETE CASCADE;


--
-- Name: geom_distance geom_distance_a2_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: chem
--

ALTER TABLE ONLY public.geom_distance
    ADD CONSTRAINT geom_distance_a2_id_fkey FOREIGN KEY (a2_id) REFERENCES public.atom(atom_id) ON DELETE CASCADE;


--
-- Name: geom_distance geom_distance_molecule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: chem
--

ALTER TABLE ONLY public.geom_distance
    ADD CONSTRAINT geom_distance_molecule_id_fkey FOREIGN KEY (molecule_id) REFERENCES public.molecule(molecule_id) ON DELETE CASCADE;


--
-- Name: kinetics_set kinetics_set_reaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: chem
--

ALTER TABLE ONLY public.kinetics_set
    ADD CONSTRAINT kinetics_set_reaction_id_fkey FOREIGN KEY (reaction_id) REFERENCES public.reactions(reaction_id) ON DELETE CASCADE;


--
-- Name: molecule molecule_lot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: chem
--

ALTER TABLE ONLY public.molecule
    ADD CONSTRAINT molecule_lot_id_fkey FOREIGN KEY (lot_id) REFERENCES public.level_of_theory(lot_id) ON DELETE RESTRICT;


--
-- Name: molecule molecule_reaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: chem
--

ALTER TABLE ONLY public.molecule
    ADD CONSTRAINT molecule_reaction_id_fkey FOREIGN KEY (reaction_id) REFERENCES public.reactions(reaction_id) ON DELETE CASCADE;


--
-- Name: reactions reactions_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: chem
--

ALTER TABLE ONLY public.reactions
    ADD CONSTRAINT reactions_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.ingest_batch(batch_id);


--
-- Name: ts_features ts_features_lot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: chem
--

ALTER TABLE ONLY public.ts_features
    ADD CONSTRAINT ts_features_lot_id_fkey FOREIGN KEY (lot_id) REFERENCES public.level_of_theory(lot_id);


--
-- Name: ts_features ts_features_molecule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: chem
--

ALTER TABLE ONLY public.ts_features
    ADD CONSTRAINT ts_features_molecule_id_fkey FOREIGN KEY (molecule_id) REFERENCES public.molecule(molecule_id) ON DELETE CASCADE;


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: chem
--

REVOKE USAGE ON SCHEMA public FROM PUBLIC;


--
-- PostgreSQL database dump complete
--

