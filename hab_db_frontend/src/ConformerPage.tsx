import * as React from "react";
import { useParams, Link } from "react-router-dom";
import { Beaker, CheckCircle2, XCircle, Copy } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
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

const API_BASE = new URL(
  (import.meta as any).env?.VITE_API_BASE ?? "/api/",
  window.location.origin,
);

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
};

const num = (x?: number | null, d = 3) =>
  x == null || !isFinite(Number(x)) ? "—" : Number(x).toFixed(d);

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

// (Dot defined below with shared styling)

const formatXYZ = (xyz: string, decimals = 6) => {
  if (!xyz) return { text: "", hasHeader: false, count: 0 };

  const lines = xyz.replace(/\r/g, "").trim().split("\n");
  // detect classic XYZ header: first line is an integer and we have at least N+2 lines
  const maybeN = parseInt(lines[0]?.trim() ?? "", 10);
  const hasHeader = Number.isFinite(maybeN) && lines.length >= maybeN + 2;
  const coordLines = hasHeader ? lines.slice(2) : lines;

  // parse coordinates
  const entries = coordLines
    .map((ln) => {
      const parts = ln.trim().split(/\s+/);
      const sym = parts[0];
      const x = Number(parts[1]);
      const y = Number(parts[2]);
      const z = Number(parts[3]);
      return sym &&
        Number.isFinite(x) &&
        Number.isFinite(y) &&
        Number.isFinite(z)
        ? { sym, x, y, z }
        : null;
    })
    .filter(Boolean) as { sym: string; x: number; y: number; z: number }[];

  if (!entries.length) return { text: xyz, hasHeader: false, count: 0 };

  // fixed columns: symbol (2), then three right-aligned fields (width 12 incl. sign)
  const col = (n: number) => n.toFixed(decimals).padStart(12, " ");
  const rows = entries.map(
    ({ sym, x, y, z }) => `${sym.padEnd(2, " ")}${col(x)}${col(y)}${col(z)}`,
  );

  return { text: rows.join("\n"), hasHeader, count: entries.length };
};

const Dot: React.FC<{ on?: boolean }> = ({ on }) => (
  <span
    aria-hidden
    className={`inline-block h-2.5 w-2.5 rounded-full ${on ? "bg-emerald-500" : "bg-slate-300"}`}
  />
);

const InfoRow: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <div className="flex items-start gap-3">
    <span className="text-slate-500 w-32 shrink-0 whitespace-nowrap">
      {label}
    </span>
    <div className="flex-1">{children}</div>
  </div>
);

function parseXYZAtoms(xyz?: string | null) {
  if (!xyz) return [] as { idx: number; elem: string }[];
  const lines = xyz.replace(/\r/g, "").trim().split("\n");
  const maybeN = parseInt(lines[0]?.trim() ?? "", 10);
  const hasHeader = Number.isFinite(maybeN) && lines.length >= maybeN + 2;
  const coordLines = hasHeader ? lines.slice(2) : lines;

  const atoms = [] as { idx: number; elem: string }[];
  for (let i = 0; i < coordLines.length; i++) {
    const parts = coordLines[i].trim().split(/\s+/);
    const elem = parts[0];
    const x = Number(parts[1]),
      y = Number(parts[2]),
      z = Number(parts[3]);
    if (
      elem &&
      Number.isFinite(x) &&
      Number.isFinite(y) &&
      Number.isFinite(z)
    ) {
      atoms.push({ idx: i + 1, elem });
    }
  }
  return atoms;
}

export default function ConformerPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = React.useState<Detail | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [explicitH, setExplicitH] = React.useState(false);
  const [tab, setTab] = React.useState("overview");
  const [theme, setTheme] = React.useState<"jmol" | "gaussview">("jmol");
  const atomList = React.useMemo(
    () => parseXYZAtoms(data?.geom_xyz),
    [data?.geom_xyz],
  );
  const smilesDisplay = React.useMemo(() => {
    const noH = data?.smiles_no_h ?? null;
    const full = data?.smiles ?? null;
    return explicitH ? (full ?? noH ?? "—") : (noH ?? full ?? "—");
  }, [data?.smiles, data?.smiles_no_h, explicitH]);
  const keyEnergy = (d: Detail) =>
    d.energy_label && d.energy_value != null
      ? `${d.energy_label}: ${Number(d.energy_value).toFixed(3)}`
      : "—";

  // Pretty-print XYZ once and memoize
  const prettyXYZ = React.useMemo(
    () => formatXYZ(data?.geom_xyz ?? "", 6),
    [data?.geom_xyz],
  );
  const [style, setStyle] = React.useState<"ballstick" | "line" | "spacefill">(
    "ballstick",
  );
  const [spin, setSpin] = React.useState(false);
  const [showLabels, setShowLabels] = React.useState(true);
  const [labelMode, setLabelMode] = React.useState<
    "elem" | "index" | "elem+index"
  >("elem+index");
  const [labelHydrogens, setLabelHydrogens] = React.useState(false);
  const labelsTemporarilyDisabled = style === "line";
  const controlsDisabled = !showLabels || labelsTemporarilyDisabled;
  const indexGutter = React.useMemo(() => {
    const n = prettyXYZ.count ?? 0;
    if (!n) return "";
    return Array.from({ length: n }, (_, i) =>
      String(i + 1).padStart(3, " "),
    ).join("\n");
  }, [prettyXYZ.count]);
  React.useEffect(() => {
    (async () => {
      try {
        const url = new URL(`conformers/${id}`, API_BASE).toString();
        const res = await fetch(url, {
          headers: { Accept: "application/json" },
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.detail || res.statusText);
        setData(body as Detail);
      } catch (e: any) {
        setError(e?.message ?? String(e));
      }
    })();
  }, [id]);

  if (error) return <div className="p-6 text-rose-600">Error: {error}</div>;
  if (!data) return <div className="p-6">Loading…</div>;

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">
          Conformer {data.conformer_id}
        </h1>
        <Link className="text-sm underline" to="/">
          ← Back to search
        </Link>
      </div>

      {/* Tabs wrapper */}
      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="grid w-full max-w-lg grid-cols-5">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="energies">Energies</TabsTrigger>
          <TabsTrigger value="spectra">Spectra</TabsTrigger>
          <TabsTrigger value="geometry">Geometry</TabsTrigger>
          <TabsTrigger value="viewer3d">3D</TabsTrigger>
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
                  {data.lot?.lot_string && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={() =>
                        navigator.clipboard?.writeText(data.lot!.lot_string)
                      }
                    >
                      <Copy className="h-3.5 w-3.5 mr-1" />
                      Copy
                    </Button>
                  )}
                </div>
                <InfoRow label="SMILES">
                  <div className="flex items-center justify-between gap-3">
                    <code className="font-mono break-all text-sm">
                      {smilesDisplay}
                    </code>
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span>Explicit H</span>
                      <Switch
                        checked={explicitH}
                        onCheckedChange={setExplicitH}
                      />
                    </div>
                  </div>
                </InfoRow>
              </CardHeader>

              <CardContent className="space-y-4">
                {/* Level of theory mini title + details */}
                <div>
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
                </div>

                {/* status rows */}
                <div className="space-y-2">
                  <InfoRow label="TS">
                    <span className="inline-flex items-center gap-2 text-sm text-slate-800">
                      <Dot on={data.is_ts} />
                      <span>{data.is_ts ? "Yes" : "No"}</span>
                    </span>
                  </InfoRow>

                  <InfoRow label="Representative">
                    <span className="inline-flex items-center gap-2 text-sm text-slate-800">
                      <Dot on={data.is_well_representative} />
                      <span>{data.is_well_representative ? "Yes" : "No"}</span>
                    </span>
                  </InfoRow>

                  <InfoRow label="Well">
                    <span className="text-sm text-slate-800">
                      {data.well_label ?? "—"}
                      {typeof data.well_rank === "number" ? (
                        <span className="text-slate-500">
                          {" "}
                          · rank {data.well_rank}
                        </span>
                      ) : null}
                    </span>
                  </InfoRow>
                </div>
              </CardContent>
            </Card>

            {/* Key energy only */}
            <Card className="h-full">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Key energy</CardTitle>
                <CardDescription>selected metric</CardDescription>
              </CardHeader>
              <CardContent>
                {data.energy_label && data.energy_value != null ? (
                  <div className="flex items-baseline gap-2">
                    <Badge variant="outline">{data.energy_label}</Badge>
                    <div className="text-base">
                      {Number(data.energy_value).toFixed(3)}
                    </div>
                    <span className="text-slate-500 text-sm">kJ/mol</span>
                  </div>
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
            <CardHeader>
              <CardTitle className="text-base">Energies (kJ/mol)</CardTitle>
              <CardDescription>
                All reported values for this conformer
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="text-sm">
                <tbody>
                  {["G298", "H298", "E0", "E_elec", "ZPE", "E_TS"].map((k) => (
                    <tr key={k}>
                      <td className="pr-6 py-1 text-slate-600">{k}</td>
                      <td className="py-1">{num((data as any)[k])}</td>
                    </tr>
                  ))}
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
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    prettyXYZ.text &&
                    navigator.clipboard?.writeText(prettyXYZ.text)
                  }
                  disabled={!prettyXYZ.text}
                >
                  Copy
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    if (!data.geom_xyz) return;
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
              {prettyXYZ.text ? (
                <div className="flex gap-4">
                  {/* Left: non-selectable index gutter */}
                  <pre className="text-xs whitespace-pre leading-5 font-mono text-slate-400 select-none">
                    {indexGutter}
                  </pre>

                  {/* Right: the actual copy-safe XYZ block */}
                  <pre className="text-xs whitespace-pre leading-5 font-mono flex-1">
                    {prettyXYZ.text}
                  </pre>
                </div>
              ) : (
                <div className="text-sm text-slate-500">
                  No geometry available.
                </div>
              )}
            </CardContent>
          </Card>
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
                <Select value={theme} onValueChange={(v) => setTheme(v as any)}>
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
                    onValueChange={(v) => setStyle(v as any)}
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
                    onValueChange={(v) => setLabelMode(v as any)}
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
      </Tabs>
    </div>
  );
}
