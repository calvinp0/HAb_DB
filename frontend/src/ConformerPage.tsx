import * as React from "react";
import { useParams, Link, useLocation } from "react-router-dom";
import { Beaker, Loader2 } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import ConformerViewer3D from "@/ConformerViewer3D";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import { capitalizeWords, cn } from "@/lib/utils";
import { ThemeModeToggle } from "@/components/ThemeModeToggle";
import CpCurveViewer, { CPCurve, NASA7 } from "@/CpNasaViewer";

const API_BASE = new URL(
  import.meta.env.VITE_API_BASE ?? "/api/",
  window.location.origin,
);

const BASE = import.meta.env.BASE_URL || "/";

const VIEWER_THEMES = ["jmol", "gaussview", "chemcraft"] as const;
type ViewerTheme = (typeof VIEWER_THEMES)[number];
const isViewerTheme = (value: string): value is ViewerTheme =>
  VIEWER_THEMES.includes(value as ViewerTheme);

const VIEWER_STYLES = ["ballstick", "line", "spacefill"] as const;
type ViewerStyle = (typeof VIEWER_STYLES)[number];
const isViewerStyle = (value: string): value is ViewerStyle =>
  VIEWER_STYLES.includes(value as ViewerStyle);

const LABEL_MODES = ["elem", "index", "elem+index"] as const;
type LabelModeOption = (typeof LABEL_MODES)[number];
const isLabelModeOption = (value: string): value is LabelModeOption =>
  LABEL_MODES.includes(value as LabelModeOption);

const DETAIL_ENERGY_KEYS = ["G298", "H298", "E0", "E_elec", "ZPE", "E_TS"] as const;
type DetailEnergyKey = (typeof DETAIL_ENERGY_KEYS)[number];
type EnergyOption = { key: string; label: string; value: number };

type ApiErrorBody = { detail?: string };
const isApiErrorBody = (value: unknown): value is ApiErrorBody =>
  typeof value === "object" &&
  value !== null &&
  "detail" in value &&
  typeof (value as { detail?: unknown }).detail === "string";
const getErrorDetail = (body: unknown, fallback: string) =>
  isApiErrorBody(body) && body.detail ? body.detail : fallback;

type ReactionNavState = { fromReactionId?: number };

function stripExplicitHydrogens(smiles?: string | null) {
  if (!smiles) return null;
  let s = smiles.replace(/\[\s*H(?:[+-]?\d*)?\s*]/gi, "");
  s = s
    .replace(/\.+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .replace(/\s+/g, "")
    .replace(/\.\+/g, "+")
    .replace(/\+\./g, "+")
    .trim();
  return s || null;
}

type SpeciesNameOut = {
  name: string;
  kind: string;
  lang?: string | null;
  source: string;
  is_primary: boolean;
  rank: number;
  curated: boolean;
  source_priority: number;
};

type Detail = {
  conformer_id: number;
  species_id: number;
  smiles?: string | null;
  smiles_no_h?: string | null;
  lot?: {
    lot_string: string;
    method: string;
    basis?: string | null;
    solvent?: string | null;
  };
  is_ts: boolean;
  is_well_representative: boolean;
  well_label?: string | null;
  well_rank?: number | null;
  G298?: number | null;
  H298?: number | null;
  E0?: number | null;
  E_elec?: number | null;
  ZPE?: number | null;
  E_TS?: number | null;
  energy_label?: string | null;
  energy_value?: number | null;
  geom_xyz?: string | null;
  n_imag?: number | null;
  imag_freqs?: number[];
  frequencies?: number[];
  props?: Record<string, unknown> | null;
  display_name?: string | null;
  names?: SpeciesNameOut[];
};

type ThermoResponse = {
  curve?: CPCurve | null;
  polynomials?: NASA7[];
};

type AdjacencyResponse = {
  adjacency: string;
};

function BackLink() {
  return (
    <Link
      to={BASE}
      className="text-sm underline underline-offset-2 cursor-pointer"
      title="Back to search"
    >
      ← Back to search
    </Link>
  );
}

const formatMethod = (s?: string | null) => {
  if (!s) return "—";
  const m = s.trim();
  const map: Record<string, string> = {
    b3lyp: "B3LYP",
    "m06-2x": "M06-2X",
    "ccsd(t)": "CCSD(T)",
    mp2: "MP2",
    hf: "HF",
    wb97xd: "wB97X-D",
    "wb97x-d": "wB97X-D",
    wb97x: "wB97X",
    "b97-d3": "B97-D3",
    def2tzvp: "def2-TZVP",
  };
  const key = m.toLowerCase();
  if (map[key]) return map[key];
  // Default: uppercase letters, keep digits and symbols
  return m.replace(/[a-z]/g, (c) => c.toUpperCase());
};

/** Atomic Symbol to Atomic Number */
const Z_FROM_SYMBOL: Record<string, number> = {
  H: 1,
  He: 2,
  Li: 3,
  Be: 4,
  B: 5,
  C: 6,
  N: 7,
  O: 8,
  F: 9,
  Ne: 10,
  Na: 11,
  Mg: 12,
  Al: 13,
  Si: 14,
  P: 15,
  S: 16,
  Cl: 17,
  Ar: 18,
  K: 19,
  Ca: 20,
  Sc: 21,
  Ti: 22,
  V: 23,
  Cr: 24,
  Mn: 25,
  Fe: 26,
  Co: 27,
  Ni: 28,
  Cu: 29,
  Zn: 30,
  Ga: 31,
  Ge: 32,
  As: 33,
  Se: 34,
  Br: 35,
  Kr: 36,
  Rb: 37,
  Sr: 38,
  Y: 39,
  Zr: 40,
  Nb: 41,
  Mo: 42,
  Tc: 43,
  Ru: 44,
  Rh: 45,
  Pd: 46,
  Ag: 47,
  Cd: 48,
  In: 49,
  Sn: 50,
  Sb: 51,
  Te: 52,
  I: 53,
  Xe: 54,
  Cs: 55,
  Ba: 56,
  La: 57,
  Ce: 58,
  Pr: 59,
  Nd: 60,
  Pm: 61,
  Sm: 62,
  Eu: 63,
  Gd: 64,
  Tb: 65,
  Dy: 66,
  Ho: 67,
  Er: 68,
  Tm: 69,
  Yb: 70,
  Lu: 71,
  Hf: 72,
  Ta: 73,
  W: 74,
  Re: 75,
  Os: 76,
  Ir: 77,
  Pt: 78,
  Au: 79,
  Hg: 80,
  Tl: 81,
  Pb: 82,
  Bi: 83,
  Po: 84,
  At: 85,
  Rn: 86,
  Fr: 87,
  Ra: 88,
  Ac: 89,
  Th: 90,
  Pa: 91,
  U: 92,
  Np: 93,
  Pu: 94,
  Am: 95,
  Cm: 96,
  Bk: 97,
  Cf: 98,
  Es: 99,
  Fm: 100,
  Md: 101,
  No: 102,
  Lr: 103,
  Rf: 104,
  Db: 105,
  Sg: 106,
  Bh: 107,
  Hs: 108,
  Mt: 109,
  Ds: 110,
  Rg: 111,
  Cn: 112,
  Nh: 113,
  Fl: 114,
  Mc: 115,
  Lv: 116,
  Ts: 117,
  Og: 118,
};

const getZ = (sym: string) => Z_FROM_SYMBOL[sym] ?? 0;

const formatXYZ = (xyz: string, decimals = 6, atomCol: "sym" | "z" = "sym") => {
  if (!xyz) return { text: "", hasHeader: false, count: 0 };

  const lines = xyz.replace(/\r/g, "").trim().split("\n");
  const maybeN = parseInt(lines[0]?.trim() ?? "", 10);
  const hasHeader = Number.isFinite(maybeN) && lines.length >= maybeN + 2;
  const coordLines = hasHeader ? lines.slice(2) : lines;

  const entries = coordLines
    .map((ln) => {
      const p = ln.trim().split(/\s+/);
      const sym = p[0],
        x = Number(p[1]),
        y = Number(p[2]),
        z = Number(p[3]);
      return sym &&
        Number.isFinite(x) &&
        Number.isFinite(y) &&
        Number.isFinite(z)
        ? { sym, x, y, z }
        : null;
    })
    .filter(Boolean) as { sym: string; x: number; y: number; z: number }[];

  if (!entries.length) return { text: xyz, hasHeader: false, count: 0 };

  // fixed width helpers
  const col = (n: number) => n.toFixed(decimals).padStart(12, " ");

  // 🔑 make the atom field exactly 2 chars in BOTH modes
  const atomField = (sym: string) =>
    String(atomCol === "z" ? getZ(sym) : sym).padEnd(2, " "); // no extra spaces

  const rows = entries.map(
    ({ sym, x, y, z }) => `${atomField(sym)}${col(x)}${col(y)}${col(z)}`,
  );

  return { text: rows.join("\n"), hasHeader, count: entries.length };
};

const Dot: React.FC<{ on?: boolean }> = ({ on }) => (
  <span
    aria-hidden
    className={`inline-block h-2.5 w-2.5 rounded-full ${on ? "bg-emerald-500" : "bg-slate-300"}`}
  />
);

const InfoRow: React.FC<{
  label: React.ReactNode;
  children: React.ReactNode;
  alignTop?: boolean;
  labelClassName?: string;
}> = ({ label, children, alignTop = false, labelClassName }) => (
  <div
    className={cn(
      "flex gap-3",
      alignTop ? "items-start" : "items-center",
      "w-full",
    )}
  >
    <span
      className={cn(
        "text-slate-500 w-28 shrink-0 whitespace-nowrap text-sm",
        labelClassName,
      )}
    >
      {label}
    </span>
    <div className="flex-1">{children}</div>
  </div>
);

export default function ConformerPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = React.useState<Detail | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [explicitH, setExplicitH] = React.useState(false);
  const [tab, setTab] = React.useState("overview");
  const [theme, setTheme] = React.useState<ViewerTheme>("jmol");
  const [showZ, setShowZ] = React.useState(false);
  const canonicalSmiles = React.useMemo(() => {
    if (!data) return null;
    const noH = data.smiles_no_h?.trim();
    if (noH) return noH;
    const stripped = stripExplicitHydrogens(data.smiles);
    if (stripped) return stripped;
    return data.smiles?.trim() ?? null;
  }, [data]);
  const smilesDisplay = React.useMemo(() => {
    const noH = data?.smiles_no_h ?? null;
    const full = data?.smiles ?? null;
    return explicitH ? (full ?? noH ?? "—") : (noH ?? full ?? "—");
  }, [data?.smiles, data?.smiles_no_h, explicitH]);
  const [thermo, setThermo] = React.useState<{
    curve: CPCurve | null;
    polynomials: NASA7[];
  }>({
    curve: null,
    polynomials: [],
  });

  // Pretty-print XYZ once and memoize
  const prettySym = React.useMemo(
    () => formatXYZ(data?.geom_xyz ?? "", 6, "sym"),
    [data?.geom_xyz],
  );
  const prettyZ = React.useMemo(
    () => formatXYZ(data?.geom_xyz ?? "", 6, "z"),
    [data?.geom_xyz],
  );
  const displayXYZ = showZ ? prettyZ.text : prettySym.text;
  const [style, setStyle] = React.useState<ViewerStyle>("ballstick");
  const [spin, setSpin] = React.useState(false);
  const [showLabels, setShowLabels] = React.useState(true);
  const [labelMode, setLabelMode] =
    React.useState<LabelModeOption>("elem+index");
  const [labelHydrogens, setLabelHydrogens] = React.useState(false);
  const [adjacency, setAdjacency] = React.useState<string | null>(null);
  const [adjacencyError, setAdjacencyError] = React.useState<string | null>(null);
  const [adjacencyLoading, setAdjacencyLoading] = React.useState(false);
  const labelsTemporarilyDisabled = style === "line";
  const controlsDisabled = !showLabels || labelsTemporarilyDisabled;
  const [energyDecimals, setEnergyDecimals] = React.useState<number>(6);
  const keyEnergyOptions = React.useMemo<EnergyOption[]>(() => {
    if (!data) return [];
    const baseOptions = DETAIL_ENERGY_KEYS.map((key) => {
      const raw = data[key as keyof Detail];
      return Number.isFinite(raw as number)
        ? { key, label: key, value: raw as number }
        : null;
    }).filter(Boolean) as EnergyOption[];
    if (
      data.energy_label &&
      typeof data.energy_value === "number" &&
      !DETAIL_ENERGY_KEYS.includes(
        data.energy_label as DetailEnergyKey,
      )
    ) {
      baseOptions.unshift({
        key: data.energy_label,
        label: data.energy_label,
        value: data.energy_value,
      });
    }
    return baseOptions;
  }, [data]);
  const [keyEnergyKey, setKeyEnergyKey] = React.useState<string | null>(
    () => keyEnergyOptions[0]?.key ?? null,
  );
  React.useEffect(() => {
    if (!keyEnergyOptions.length) {
      if (keyEnergyKey !== null) setKeyEnergyKey(null);
      return;
    }
    if (!keyEnergyKey || !keyEnergyOptions.some((opt) => opt.key === keyEnergyKey)) {
      setKeyEnergyKey(keyEnergyOptions[0].key);
    }
  }, [keyEnergyOptions, keyEnergyKey]);
  const selectedKeyEnergy = keyEnergyOptions.find(
    (opt) => opt.key === keyEnergyKey,
  );
  const indexGutter = React.useMemo(() => {
    const n = (showZ ? prettyZ.count : prettySym.count) ?? 0;
    return n
      ? Array.from({ length: n }, (_, i) =>
          String(i + 1).padStart(3, " "),
        ).join("\n")
      : "";
  }, [showZ, prettySym.count, prettyZ.count]);

  const loc = useLocation();
  const reactionState = (loc.state as ReactionNavState | null) ?? null;
  const qs = new URLSearchParams(window.location.search);
  const fromReactionId =
    reactionState?.fromReactionId ??
    (qs.get("rid") ? Number(qs.get("rid")) : undefined);

  React.useEffect(() => {
    setAdjacency(null);
    setAdjacencyError(null);
    setAdjacencyLoading(false);
  }, [data?.conformer_id]);

  React.useEffect(() => {
    (async () => {
      try {
        const url = new URL(`conformers/${id}/thermo`, API_BASE).toString();
        const res = await fetch(url, {
          headers: { Accept: "application/json" },
        });
        const body: ThermoResponse = await res
          .json()
          .catch(() => ({}) as ThermoResponse);
        if (!res.ok) throw new Error(getErrorDetail(body, res.statusText));
        setThermo({
          curve: body.curve ?? null,
          polynomials: body.polynomials ?? [],
        });
      } catch {
        setThermo({ curve: null, polynomials: [] });
      }
    })();
  }, [id]);

  const fetchAdjacency = React.useCallback(async () => {
    if (!data || data.is_ts) {
      setAdjacencyError("Adjacency lists are only available for non-TS conformers");
      return;
    }
    setAdjacencyError(null);
    setAdjacencyLoading(true);
    try {
      const url = new URL(
        `conformers/${data.conformer_id}/adjacency`,
        API_BASE,
      ).toString();
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      const body = (await res.json().catch(() => ({}))) as
        | AdjacencyResponse
        | ApiErrorBody;
      if (!res.ok) {
        throw new Error(getErrorDetail(body, res.statusText));
      }
      if ("adjacency" in body && typeof body.adjacency === "string") {
        setAdjacency(body.adjacency);
        setAdjacencyError(null);
      } else {
        setAdjacency(null);
        setAdjacencyError("Adjacency data unavailable for this conformer.");
      }
    } catch (err: unknown) {
      setAdjacency(null);
      setAdjacencyError(
        err instanceof Error
          ? err.message
          : "Unable to fetch adjacency list",
      );
    } finally {
      setAdjacencyLoading(false);
    }
  }, [data]);

  React.useEffect(() => {
    (async () => {
      try {
        const url = new URL(`conformers/${id}`, API_BASE).toString();
        const res = await fetch(url, {
          headers: { Accept: "application/json" },
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(getErrorDetail(body, res.statusText));
        setData(body as Detail);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [id]);

  if (error) return <div className="p-6 text-rose-600">Error: {error}</div>;
  if (!data) return <div className="p-6">Loading…</div>;
  const headerTitle =
    capitalizeWords(data.display_name) ||
    data.well_label ||
    canonicalSmiles ||
    `Conformer ${data.conformer_id}`;

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">
            {headerTitle}
          </h1>
          <div className="text-slate-500 text-sm">
            {data.is_ts ? "TS · " : ""}
            Conformer #{data.conformer_id} · Species #{data.species_id}
            {data.lot?.lot_string ? ` · ${data.lot.lot_string}` : ""}
            {typeof data.well_rank === "number"
              ? ` · rank ${data.well_rank}`
              : ""}
          </div>
        </div>

        <div className="flex flex-col items-end gap-2 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
            <ThemeModeToggle condensed />
          </div>
          {fromReactionId ? (
            <Link
              to={`/reactions/${fromReactionId}`}
              className="text-sm underline underline-offset-2 cursor-pointer"
              title="Back to reaction"
            >
              ← Back to reaction
            </Link>
          ) : (
            <BackLink />
          )}
        </div>
      </div>

      {/* Tabs wrapper */}
      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-3 md:grid-cols-6 md:max-w-none">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="energies">Energies</TabsTrigger>
          <TabsTrigger value="spectra">Spectra</TabsTrigger>
          <TabsTrigger value="geometry">Geometry</TabsTrigger>
          <TabsTrigger value="viewer3d">3D</TabsTrigger>
          <TabsTrigger value="thermo">Thermo</TabsTrigger>
        </TabsList>

        {/* Overview: LoT + a compact energy snapshot */}
        <TabsContent
          value="overview"
          className="mt-4 data-[state=inactive]:hidden"
        >
          <div className="grid md:grid-cols-2 gap-6">
            {/* Information */}
            <Card className="h-full">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-slate-500">
                    <Beaker className="h-4 w-4" />
                    <CardTitle className="text-base">Information</CardTitle>
                  </div>
                </div>
              </CardHeader>

              {/* Put all rows/sections in CardContent */}
              <CardContent className="space-y-6">
                {/* SMILES */}
                <InfoRow
                  label="SMILES"
                  labelClassName="text-sm font-semibold text-slate-700"
                  alignTop
                >
                  <div className="grid grid-cols-[1fr_auto] gap-3 w-full">
                    <div className="min-w-0">
                      {/* reserve ~2 lines to avoid jitter */}
                      <div className="min-h-[2.25rem]">
                        <code className="block font-mono text-sm break-all">
                          {smilesDisplay}
                        </code>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-500 self-start whitespace-nowrap">
                      <span>Explicit H</span>
                      <Switch
                        checked={explicitH}
                        onCheckedChange={setExplicitH}
                      />
                    </div>
                  </div>
                </InfoRow>
                <div className="border-t border-slate-200 my-3" />
                {/* Level of theory */}
                <section>
                  <div className="text-sm font-semibold text-slate-700 mb-2">
                    Level of theory
                  </div>
                  <div className="grid grid-cols-1 gap-2 text-sm">
                    <InfoRow label="Method">
                      <span>{formatMethod(data.lot?.method)}</span>
                    </InfoRow>
                    <InfoRow label="Basis">
                      <span>{formatMethod(data.lot?.basis ?? "—")}</span>
                    </InfoRow>
                    <InfoRow label="Solvent">
                      <span>{data.lot?.solvent ?? "—"}</span>
                    </InfoRow>
                  </div>
                </section>
                <div className="border-t border-slate-200 my-3" />
                {/* Attributes */}
                <section>
                  <div className="text-sm font-semibold text-slate-700 mb-2">
                    Attributes
                  </div>
                  <div className="space-y-2">
                    <InfoRow label="TS">
                      <span className="inline-flex items-center gap-2 text-sm text-foreground">
                        <Dot on={data.is_ts} />
                        <span className="text-foreground">
                          {data.is_ts ? "Yes" : "No"}
                        </span>
                      </span>
                    </InfoRow>
                    <InfoRow label="Representative">
                      <span className="inline-flex items-center gap-2 text-sm text-foreground">
                        <Dot on={data.is_well_representative} />
                        <span className="text-foreground">
                          {data.is_well_representative ? "Yes" : "No"}
                        </span>
                      </span>
                    </InfoRow>
                    <InfoRow label="Well">
                      <span className="text-sm text-foreground">
                        {data.well_label ?? "—"}
                        {typeof data.well_rank === "number" ? (
                          <span className="text-sm text-foreground/80">
                            {" "}
                            · rank {data.well_rank}
                          </span>
                        ) : null}
                      </span>
                    </InfoRow>
                  </div>
                </section>

                {/* Names */}
                {data.names?.length ? (
                  <section className="pt-4 border-t border-slate-200">
                    <div className="text-sm font-semibold text-slate-700 mb-3">
                      Names
                    </div>

                    <InfoRow label="Preferred">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{data.display_name}</span>
                        {(() => {
                          const n = data.names!.find(
                            (n) => n.name === data.display_name,
                          );
                          if (!n) return null;
                          const tags = [
                            n.is_primary ? "primary" : null,
                            n.curated ? "curated" : null,
                            n.lang ? n.lang : null,
                            n.source?.toLowerCase(),
                          ].filter(Boolean);
                          return tags.length ? (
                            <span className="text-xs text-slate-500">
                              ({tags.join(" · ")})
                            </span>
                          ) : null;
                        })()}
                      </div>
                    </InfoRow>

                    {data.names.filter((n) => n.name !== data.display_name)
                      .length > 0 && (
                      <div className="mt-2">
                        <InfoRow label="Synonyms">
                          <div className="mt-1 flex flex-wrap gap-2">
                            {data.names
                              .filter((n) => n.name !== data.display_name)
                              .slice(0, 12)
                              .map((n, i) => (
                                <span
                                  key={`${n.name}-${i}`}
                                  className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700 border border-slate-200"
                                  title={`${n.kind}${n.lang ? ` · ${n.lang}` : ""}${n.curated ? " · curated" : ""}${n.source ? ` · ${n.source}` : ""}`}
                                >
                                  {n.name}
                                </span>
                              ))}
                            {data.names.length > 13 && (
                              <span className="text-xs text-slate-500">
                                +{data.names.length - 13} more
                              </span>
                            )}
                          </div>
                        </InfoRow>
                      </div>
                    )}
                  </section>
                ) : null}
              </CardContent>
            </Card>

            {/* Key energy only */}
            <Card className="h-full">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">Key energy</CardTitle>
                    <CardDescription>selected metric</CardDescription>
                  </div>
                  {keyEnergyOptions.length > 0 && (
                    <Select
                      value={keyEnergyKey ?? undefined}
                      onValueChange={(value) => setKeyEnergyKey(value)}
                    >
                      <SelectTrigger className="h-8 w-36">
                        <SelectValue placeholder="Metric" />
                      </SelectTrigger>
                      <SelectContent>
                        {keyEnergyOptions.map((option) => (
                          <SelectItem key={option.key} value={option.key}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {selectedKeyEnergy ? (
                  <InfoRow label={selectedKeyEnergy.label}>
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono tabular-nums text-right inline-block w-[18ch] text-base">
                        {Number(selectedKeyEnergy.value).toExponential(4)}
                      </span>
                      <span className="text-slate-500 text-sm">kJ/mol</span>
                    </div>
                  </InfoRow>
                ) : (
                  <div className="text-sm text-slate-500">
                    No key energy available.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Full Energies tab (same table—kept separate so you can expand later) */}
        <TabsContent
          value="energies"
          className="mt-4 data-[state=inactive]:hidden"
        >
          <Card>
            <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle className="text-base">Energies (kJ/mol)</CardTitle>
                <CardDescription>
                  All reported values for this conformer
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">Precision</span>
                <Select
                  value={String(energyDecimals)}
                  onValueChange={(v) => setEnergyDecimals(Number(v))}
                >
                  <SelectTrigger className="h-8 w-28">
                    <SelectValue placeholder="Decimals" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="2">2 decimals</SelectItem>
                    <SelectItem value="3">3 decimals</SelectItem>
                    <SelectItem value="4">4 decimals</SelectItem>
                    <SelectItem value="5">5 decimals</SelectItem>
                    <SelectItem value="6">6 decimals</SelectItem>
                    <SelectItem value="7">7 decimals</SelectItem>
                    <SelectItem value="8">8 decimals</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="text-sm">
                <tbody>
                  {DETAIL_ENERGY_KEYS.map((k) => {
                    const value = data[k];
                    const formatted = Number.isFinite(value as number)
                      ? Number(value).toExponential(energyDecimals)
                      : "—";
                    return (
                      <tr key={k}>
                        <td className="pr-6 py-1 text-slate-600 w-24">{k}</td>
                        <td className="py-1">
                          <span className="font-mono tabular-nums text-right inline-block w-[18ch]">
                            {formatted}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Spectra tab */}
        <TabsContent
          value="spectra"
          className="mt-4 data-[state=inactive]:hidden"
        >
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Spectra</CardTitle>
              <CardDescription>Frequencies & imaginary modes</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-sm">
                Imaginary count:{" "}
                {typeof data.n_imag === "number" ? data.n_imag : "—"}
              </div>
              {!!(data.imag_freqs && data.imag_freqs.length) && (
                <div className="text-sm">
                  Imag: {data.imag_freqs.join(", ")}
                </div>
              )}
              {!!(data.frequencies && data.frequencies.length) && (
                <div className="text-sm">
                  All: {data.frequencies.join(", ")}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Geometry tab */}
        <TabsContent
          value="geometry"
          className="mt-4 data-[state=inactive]:hidden"
        >
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base">Geometry (XYZ)</CardTitle>
                <CardDescription>raw coordinates</CardDescription>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span>Z numbers</span>
                  <Switch checked={showZ} onCheckedChange={setShowZ} />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    displayXYZ && navigator.clipboard?.writeText(displayXYZ)
                  }
                  disabled={!displayXYZ}
                >
                  Copy
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    if (!data.geom_xyz) return;
                    // keep download as original element XYZ (change to displayXYZ.text if you want Z there too)
                    const blob = new Blob([data.geom_xyz], {
                      type: "text/plain;charset=utf-8",
                    });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `conformer_${data.conformer_id}.xyz`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  disabled={!data.geom_xyz}
                >
                  Download
                </Button>
              </div>
            </CardHeader>

            <CardContent>
              {displayXYZ ? (
                <div className="flex gap-4 items-start">
                  <pre
                    className="text-xs whitespace-pre leading-5 font-mono text-slate-400 select-none pr-3 border-r border-slate-200"
                    aria-hidden="true"
                  >
                    {indexGutter}
                  </pre>
                  <pre className="text-xs whitespace-pre leading-5 font-mono tabular-nums flex-1 m-0">
                    {displayXYZ}
                  </pre>
                </div>
              ) : (
                <div className="text-sm text-slate-500">
                  No geometry available.
                </div>
              )}
            </CardContent>
          </Card>
          {!data?.is_ts && (
            <Card className="mt-4">
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base">RMG adjacency list</CardTitle>
                  <CardDescription>fetched from rmg.mit.edu</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={fetchAdjacency}
                    disabled={adjacencyLoading}
                  >
                    {adjacencyLoading ? (
                      <span className="flex items-center gap-1">
                        <Loader2 className="h-3 w-3 animate-spin" /> Fetching
                      </span>
                    ) : (
                      "Fetch"
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => adjacency && navigator.clipboard?.writeText(adjacency)}
                    disabled={!adjacency}
                  >
                    Copy
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {adjacencyError && (
                  <div className="text-sm text-red-600 mb-2">{adjacencyError}</div>
                )}
                {adjacency ? (
                  <pre className="text-xs whitespace-pre leading-5 font-mono tabular-nums">
                    {adjacency}
                  </pre>
                ) : (
                  <p className="text-sm text-slate-500">
                    Click fetch to retrieve the RMG adjacency list for this conformer.
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/** 3D */}
        <TabsContent
          value="viewer3d"
          className="mt-4 data-[state=inactive]:hidden"
          forceMount
        >
          <Card>
            <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle className="text-base">3D viewer</CardTitle>
                <CardDescription>interactive model</CardDescription>
              </div>

              {/* simple controls */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">Theme</span>
                <Select
                  value={theme}
                  onValueChange={(v) => {
                    if (isViewerTheme(v)) setTheme(v);
                  }}
                >
                  <SelectTrigger className="h-8 w-32">
                    <SelectValue placeholder="Theme" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="jmol">Jmol (default)</SelectItem>
                    <SelectItem value="gaussview">GaussView</SelectItem>
                    <SelectItem value="chemcraft">Chemcraft</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span>Spin</span>
                  <Switch checked={spin} onCheckedChange={setSpin} />
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">Style</span>
                  <Select
                    value={style}
                    onValueChange={(v) => {
                      if (isViewerStyle(v)) setStyle(v);
                    }}
                  >
                    <SelectTrigger className="h-8 w-32">
                      <SelectValue placeholder="Style" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ballstick">
                        Ball &amp; Stick
                      </SelectItem>
                      <SelectItem value="spacefill">Spacefill</SelectItem>
                      <SelectItem value="line">Line</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Labels toggle is always visible */}
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span>Labels</span>
                  <Switch
                    checked={showLabels}
                    onCheckedChange={setShowLabels}
                  />
                </div>

                {/* Keep these visible; disable when off or in line style */}
                <div
                  className={`flex items-center gap-2 ${controlsDisabled ? "opacity-50" : ""}`}
                  title={
                    labelsTemporarilyDisabled
                      ? "Labels are hidden in Line style"
                      : undefined
                  }
                >
                  <span className="text-xs text-slate-500">Label</span>
                  <Select
                    value={labelMode}
                    onValueChange={(v) => {
                      if (isLabelModeOption(v)) setLabelMode(v);
                    }}
                  >
                    <SelectTrigger
                      className="h-8 w-32"
                      disabled={controlsDisabled}
                    >
                      <SelectValue placeholder="Label" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="elem">Atom</SelectItem>
                      <SelectItem value="index">Index</SelectItem>
                      <SelectItem value="elem+index">Atom+Index</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div
                  className={`flex items-center gap-2 text-xs ${controlsDisabled ? "opacity-50 text-slate-400" : "text-slate-500"}`}
                >
                  <span>H labels</span>
                  <Switch
                    checked={labelHydrogens}
                    onCheckedChange={setLabelHydrogens}
                    disabled={controlsDisabled}
                  />
                </div>
              </div>
            </CardHeader>

            <CardContent className="relative">
              <ConformerViewer3D
                xyz={data.geom_xyz ?? ""}
                style={style}
                spin={spin}
                height={440}
                active={tab === "viewer3d"} // <— important
                theme={theme}
                labelMode={!showLabels || style === "line" ? "none" : labelMode}
                labelHydrogens={labelHydrogens}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Thermo */}
        <TabsContent
          value="thermo"
          className="mt-4 data-[state=inactive]:hidden"
        >
          <CpCurveViewer
            speciesLabel={data.display_name ?? `Conformer ${data.conformer_id}`}
            lotString={data.lot?.lot_string ?? undefined}
            curve={thermo.curve}
            polynomials={thermo.polynomials}
            active={tab === "thermo"}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
