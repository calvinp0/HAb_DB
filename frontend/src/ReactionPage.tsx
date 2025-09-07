// src/ReactionPage.tsx
import React, { useEffect, useMemo, useState, Suspense } from "react";
import { useParams, Link } from "react-router-dom";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Loader2,
  Flame,
  ArrowRightLeft,
  Thermometer,
  Gauge,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ExpandableKineticsChart } from "./KineticsPanel";

const RAW_API = import.meta.env.VITE_API_BASE ?? "/api";

function api(path: string) {
  // ensures exactly one slash between base and path
  return `${String(RAW_API).replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

// ---------- module-level types ----------
type Lot = {
  lot_id: number;
  method: string;
  basis?: string | null;
  solvent?: string | null;
  lot_string: string;
};
type ConformerLite = {
  conformer_id: number;
  species_id: number;
  is_ts: boolean;
  well_label?: string | null;
  well_rank?: number | null;
  lot: Lot;
  G298?: number | null;
  H298?: number | null;
  E_elec?: number | null;
  ZPE?: number | null;
  E0?: number | null;
  E_TS?: number | null;
};
type SpeciesLite = {
  species_id: number;
  smiles?: string | null;
  smiles_no_h?: string | null;
};
type Participant = { role: "R1H" | "R2H" | "TS"; conformer: ConformerLite };

type RateModel = {
  rate_model_id: number;
  direction: "forward" | "reverse";
  model: "Arrhenius" | "ModifiedArrhenius";
  A: number;
  n: number | null;
  Ea_kJ_mol: number;
  Tmin_K: number;
  Tmax_K: number;
  T0_K?: number | null; // <-- new (optional)
  source?: string | null;
  reference?: string | null;
};

type ReactionDetail = {
  reaction_id: number;
  reaction_name?: string | null;
  family: string;
  batch?: { batch_id: number; source_label: string } | null;
  participants: Participant[];
  rate_models: RateModel[];
};
type CPCurve = {
  T_K: number[];
  Cp_J_per_molK: number[];
  raw_units?: any;
  Cp0_raw?: number | null;
  CpInf_raw?: number | null;
  source?: string | null;
};
type NASA7 = {
  form: "NASA7";
  Tmin_K: number;
  Tmax_K: number;
  coeffs: [number, number, number, number, number, number, number];
  fit_rmse?: number | null;
  source?: string | null;
};
type Thermo = { curve: CPCurve | null; polynomials: NASA7[] };

// ---------- constants / helpers ----------
const API_BASE = import.meta.env.VITE_API_BASE || "/api";

async function fetchJSON<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

function BackLink() {
  const base = (import.meta as any).env?.BASE_URL || "/";

  return (
    <Link
      to={base}
      className="text-sm underline underline-offset-2 cursor-pointer"
      title="Back to search"
    >
      ← Back to search
    </Link>
  );
}

function ensureXYZHeaderLocal(xyz: string): string {
  const trimmed = (xyz || "").trim();
  if (!trimmed) return "";
  const lines = trimmed.split(/\r?\n/);
  const n = parseInt(lines[0]?.trim() || "", 10);
  if (Number.isFinite(n)) return trimmed; // already has count line
  // naive atom-line count
  const atomish = lines.filter((L) =>
    /^[A-Za-z]{1,2}\s+[-+]?\d/.test(L),
  ).length;
  return `${atomish}\nconformer\n${trimmed}\n`;
}

// choose a display energy + label in kJ/mol
function pickEnergyLabelValue(c: ConformerLite): {
  label: string;
  value: number | null;
} {
  if (c.is_ts && c.E_TS != null) return { label: "E_TS", value: c.E_TS };
  if (c.G298 != null) return { label: "G298", value: c.G298 };
  if (c.H298 != null) return { label: "H298", value: c.H298 };
  if (c.E_elec != null && c.ZPE != null)
    return { label: "E0", value: c.E_elec + c.ZPE };
  if (c.E_elec != null) return { label: "E_elec", value: c.E_elec };
  return { label: "", value: null };
}

type SurfaceMode = "E0" | "H298" | "G298";

function energyForSurface(c: ConformerLite, mode: SurfaceMode): number | null {
  // TS first: you may only have E_TS
  const isTS = !!c.is_ts;
  if (mode === "E0") {
    if (isTS) return firstFinite([c.E_TS, sum(c.E_elec, c.ZPE)]);
    return firstFinite([c.E0, sum(c.E_elec, c.ZPE)]);
  }
  if (mode === "H298") {
    // Only plot H298 if available for ALL points; otherwise return null to avoid a mixed surface
    return isTS ? null : firstFinite([c.H298]);
  }
  if (mode === "G298") {
    return isTS ? null : firstFinite([c.G298]);
  }
  return null;
}

function sum(a?: number | null, b?: number | null) {
  return Number.isFinite(a as number) && Number.isFinite(b as number)
    ? (a as number) + (b as number)
    : null;
}
function firstFinite(xs: Array<number | null | undefined>) {
  for (const x of xs) if (Number.isFinite(x as number)) return x as number;
  return null;
}

// Arrhenius
const R_kJ = 8.314462618e-3;

// full modified Arrhenius with T0 (defaults to 1 K)
function kOfT(model: RateModel, T: number): number {
  const n = model.n ?? 0;
  const Ea = model.Ea_kJ_mol ?? 0;
  const A = model.A ?? 0;
  const T0 = model.T0_K ?? 1; // <-- important
  return A * Math.pow(T / T0, n) * Math.exp(-Ea / (R_kJ * T));
}

function CpSpark({ thermo }: { thermo?: Thermo }) {
  const data = useMemo(() => {
    const cv = thermo?.curve;
    if (!cv || !cv.T_K?.length || !cv.Cp_J_per_molK?.length) return [];
    // Sample down to ~30 points so the sparkline is cheap
    const n = Math.min(30, cv.T_K.length);
    const step = Math.max(1, Math.floor(cv.T_K.length / n));
    const pts = [];
    for (let i = 0; i < cv.T_K.length; i += step) {
      pts.push({ T: cv.T_K[i], Cp: cv.Cp_J_per_molK[i] });
    }
    return pts;
  }, [thermo]);

  if (!data.length)
    return <span className="text-sm text-muted-foreground">—</span>;

  return (
    <div className="h-12 w-40">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ left: 2, right: 2, top: 2, bottom: 2 }}
        >
          <XAxis hide dataKey="T" />
          <YAxis hide />
          <Line type="monotone" dataKey="Cp" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

async function fetchXYZForConformer(conformerId: number): Promise<string> {
  const urls = [
    api(`/conformers/${conformerId}/xyz`), // plain text
    api(`/conformers/${conformerId}?format=xyz`), // query variant
    api(`/conformers/${conformerId}`), // JSON that might contain xyz
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json,chemical/x-xyz,text/plain,*/*" },
      });
      if (!res.ok) continue;
      const ct = res.headers.get("content-type") || "";

      // 1) Raw XYZ payload
      if (!ct.includes("application/json")) {
        const txt = (await res.text()).trim();
        if (looksLikeXYZ(txt)) return ensureXYZHeaderLocal(txt);
        continue;
      }

      // 2) JSON — try common keys
      const j = await res.json();
      const xyz =
        j.xyz ??
        j.XYZ ??
        j.geometry_xyz ??
        j.data?.xyz ??
        j.content?.xyz ??
        null;
      if (typeof xyz === "string" && xyz.trim()) {
        return ensureXYZHeaderLocal(xyz.trim());
      }

      // some APIs send { atoms: [{elem,x,y,z}, ...] }
      if (Array.isArray(j.atoms) && j.atoms.length) {
        const asXYZ = atomsToXYZ(j.atoms);
        if (asXYZ) return ensureXYZHeaderLocal(asXYZ);
      }
    } catch {
      // try next
    }
  }
  throw new Error("No XYZ geometry found for this conformer.");
}

function looksLikeXYZ(s: string): boolean {
  // simple: either starts with integer count line, or has many lines that look like "C 0.0 0.0 0.0"
  const lines = s.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return false;
  if (/^\s*\d+\s*$/.test(lines[0])) return true;
  let atomish = 0;
  for (const L of lines.slice(0, Math.min(10, lines.length))) {
    if (/^[A-Za-z]{1,2}\s+[-+]?\d/.test(L)) atomish++;
  }
  return atomish >= 2; // at least two plausible atom lines
}

function atomsToXYZ(
  atoms: Array<{
    elem?: string;
    element?: string;
    x: number;
    y: number;
    z: number;
  }>,
): string {
  const rows = atoms.map((a) => {
    const e = (a.elem || a.element || "C").toString();
    return `${e} ${a.x} ${a.y} ${a.z}`;
  });
  return `${rows.length}\nfrom JSON atoms\n${rows.join("\n")}\n`;
}

// ---------- lazy viewer at module scope ----------
const ConformerViewer3D = React.lazy(() =>
  import("@/ConformerViewer3D")
    .then((m) => ({ default: m.default }))
    .catch(() => ({
      default: (p: { xyz?: string; skip?: boolean }) =>
        p.skip ? null : (
          <pre className="text-xs p-3 bg-muted rounded-md overflow-auto max-h-64">
            3D viewer not available. XYZ preview:
            {p.xyz || ""}
          </pre>
        ),
    })),
);

function View3DButton({
  conformerId,
  initialXYZ,
}: {
  conformerId: number;
  initialXYZ?: string;
}) {
  const [open, setOpen] = useState(false);
  const [xyz, setXyz] = useState<string | null>(initialXYZ ?? null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open || xyz) return; // already have it
    let abort = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const d = await fetchJSON<any>(api(`/conformers/${conformerId}`));
        if (!abort) {
          const s = ensureXYZHeaderLocal(d?.geom_xyz ?? "");
          if (!s) throw new Error("No geometry available for this conformer.");
          setXyz(s);
        }
      } catch (e: any) {
        if (!abort) setErr(e?.message ?? "Failed to load geometry");
      } finally {
        if (!abort) setLoading(false);
      }
    })();
    return () => {
      abort = true;
    };
  }, [open, conformerId, xyz]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          3D
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Conformer #{conformerId}</DialogTitle>
        </DialogHeader>

        {loading && (
          <div className="p-4 text-sm text-muted-foreground">
            Loading geometry…
          </div>
        )}
        {err && <div className="p-4 text-sm text-rose-600">{err}</div>}
        {!loading && !err && xyz && (
          <div className="rounded-xl border bg-card p-2">
            <Suspense
              fallback={
                <div className="p-4 text-sm text-muted-foreground">
                  Loading viewer…
                </div>
              }
            >
              <ConformerViewer3D xyz={xyz} />
            </Suspense>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

type ParticipantWire =
  | {
      role: "R1H" | "R2H" | "TS";
      conformer: ConformerLite;
      smiles?: string | null;
      smiles_no_h?: string | null;
    }
  | (ConformerLite & {
      role: "R1H" | "R2H" | "TS";
      smiles?: string | null;
      smiles_no_h?: string | null;
    })
  | {
      role: "R1H" | "R2H" | "TS";
      c: ConformerLite;
      smiles?: string | null;
      smiles_no_h?: string | null;
    };

function normalizeParticipants(ps: ParticipantWire[]): Participant[] {
  return ps.map((p: any) => {
    const c: ConformerLite =
      p.conformer ??
      p.c ??
      ({
        conformer_id: p.conformer_id,
        species_id: p.species_id,
        is_ts: p.is_ts,
        well_label: p.well_label,
        well_rank: p.well_rank,
        lot: p.lot,
        G298: p.G298,
        H298: p.H298,
        E_elec: p.E_elec,
        ZPE: p.ZPE,
        E0: p.E0,
        E_TS: p.E_TS,
      } as ConformerLite);

    return { role: p.role, conformer: c };
  });
}

// ---------- data hook (module scope) ----------
// ---------- data hook (module scope) ----------
function useReactionDetail(reactionId: number) {
  const [rxn, setRxn] = useState<ReactionDetail | null>(null);
  const [thermo, setThermo] = useState<Record<number, Thermo>>({});
  const [speciesById, setSpeciesById] = useState<Record<number, SpeciesLite>>(
    {},
  );
  const [geomByConfId, setGeomByConfId] = useState<Record<number, string>>({});
  // ADD: state for energies chosen by the server
  const [energyByConfId, setEnergyByConfId] = useState<Record<number, number>>(
    {},
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoading(true);

        const raw = await fetchJSON<any>(api(`/reactions/${reactionId}`));
        if (!mounted) return;

        const r: ReactionDetail = {
          ...raw,
          participants: normalizeParticipants(raw.participants),
        };
        setRxn(r);

        const confIds = r.participants.map((p) => p.conformer.conformer_id);

        // --- thermo
        const thermoPairs = await Promise.all(
          confIds.map(async (id) => {
            try {
              const t = await fetchJSON<Thermo>(
                api(`/conformers/${id}/thermo`),
              );
              return [id, t] as const;
            } catch {
              return [id, { curve: null, polynomials: [] } as Thermo] as const;
            }
          }),
        );
        if (!mounted) return;
        setThermo(Object.fromEntries(thermoPairs));

        // --- conformer details (for smiles + xyz + energy_value)
        const detailPairs = await Promise.all(
          confIds.map(async (id) => {
            try {
              const d = await fetchJSON<any>(api(`/conformers/${id}`));
              return [id, d] as const;
            } catch {
              return [id, null] as const;
            }
          }),
        );
        if (!mounted) return;

        const detailByConfId: Record<number, any> =
          Object.fromEntries(detailPairs);

        // BUILD: energy map from backend-chosen values
        const energyMap: Record<number, number> = {};
        for (const [cid, d] of detailPairs) {
          const val = d?.energy_value;
          if (typeof val === "number" && Number.isFinite(val)) {
            energyMap[cid] = val; // your API is already kJ/mol
          }
        }
        setEnergyByConfId(energyMap);

        // backfill missing well/TS fields (optional)
        const patchedParticipants = r.participants.map((p) => {
          const c = p.conformer;
          const d = detailByConfId[c.conformer_id];
          if (!d) return p;
          const patched: ConformerLite = {
            ...c,
            G298: c.G298 ?? d.G298 ?? null,
            H298: c.H298 ?? d.H298 ?? null,
            E_elec: c.E_elec ?? d.E_elec ?? null,
            ZPE: c.ZPE ?? d.ZPE ?? null,
            E0:
              c.E0 ??
              d.E0 ??
              (d.E_elec != null && d.ZPE != null ? d.E_elec + d.ZPE : null),
            E_TS: c.E_TS ?? d.E_TS ?? null,
          };
          return { ...p, conformer: patched };
        });
        setRxn({ ...r, participants: patchedParticipants });

        // species + xyz
        const spEntries: Array<[number, SpeciesLite]> = [];
        const xyzEntries: Array<[number, string]> = [];
        for (const [, d] of detailPairs) {
          if (!d) continue;
          if (typeof d.species_id === "number") {
            spEntries.push([
              d.species_id,
              {
                species_id: d.species_id,
                smiles: d.smiles ?? null,
                smiles_no_h: d.smiles_no_h ?? null,
              },
            ]);
          }
          if (
            typeof d.conformer_id === "number" &&
            typeof d.geom_xyz === "string" &&
            d.geom_xyz.trim()
          ) {
            xyzEntries.push([d.conformer_id, d.geom_xyz as string]);
          }
        }

        const mergedSpecies: Record<number, SpeciesLite> = {};
        for (const [sid, sp] of spEntries) {
          mergedSpecies[sid] = {
            species_id: sid,
            smiles: mergedSpecies[sid]?.smiles ?? sp.smiles ?? null,
            smiles_no_h:
              mergedSpecies[sid]?.smiles_no_h ?? sp.smiles_no_h ?? null,
          };
        }
        setSpeciesById(mergedSpecies);
        setGeomByConfId(Object.fromEntries(xyzEntries));
      } catch (e: any) {
        if (mounted) setError(e?.message || "Failed to load reaction");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [reactionId]);

  // RETURN: include the state you created
  return {
    rxn,
    thermo,
    speciesById,
    geomByConfId,
    energyByConfId,
    loading,
    error,
  };
}

// ---------- small UI chunks ----------
function EnergyChip({ c }: { c: ConformerLite }) {
  const { label, value } = pickEnergyLabelValue(c);
  return (
    <Badge variant="secondary" className="font-mono">
      {label ? `${label} = ${value?.toFixed(2)} kJ/mol` : "energy N/A"}
    </Badge>
  );
}
function LotChip({ lot }: { lot: Lot }) {
  return (
    <Badge
      variant="outline"
      title={`${lot.method}${lot.basis ? "/" + lot.basis : ""}${lot.solvent ? ` in ${lot.solvent}` : ""}`}
    >
      {lot.lot_string}
    </Badge>
  );
}

function ParticipantsTable({
  participants,
  thermoById,
  speciesById,
  explicitSmiles,
  geomByConfId,
  reactionId,
}: {
  participants: Participant[];
  thermoById: Record<number, Thermo>;
  speciesById: Record<number, SpeciesLite>;
  explicitSmiles: boolean;
  geomByConfId: Record<number, string>;
  reactionId?: number;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Participants</CardTitle>
        <CardDescription>Reactants, products, and TS</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Role</TableHead>
              <TableHead>Conformer</TableHead>
              <TableHead>SMILES</TableHead>
              <TableHead>LoT</TableHead>
              <TableHead className="whitespace-nowrap">Energy</TableHead>
              <TableHead>Cp(T)</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {participants.map((p) => {
              const c = p.conformer;
              const sp = speciesById[c.species_id];
              const smiles = explicitSmiles
                ? (sp?.smiles ?? `[${c.species_id}]`)
                : (sp?.smiles_no_h ?? sp?.smiles ?? `[${c.species_id}]`);
              const { label, value } = pickEnergyLabelValue(c);

              return (
                <TableRow key={c.conformer_id}>
                  <TableCell>
                    <Badge>{p.role}</Badge>
                  </TableCell>

                  <TableCell className="whitespace-nowrap">
                    #{c.conformer_id}
                    {c.is_ts
                      ? " • TS"
                      : c.well_label
                        ? ` • ${c.well_label}`
                        : ""}
                    {typeof c.well_rank === "number"
                      ? ` (rank ${c.well_rank})`
                      : ""}
                  </TableCell>

                  <TableCell
                    title={smiles}
                    className="font-mono truncate max-w-[28ch]"
                  >
                    {smiles}
                  </TableCell>

                  <TableCell>
                    <Badge variant="outline">{c.lot?.lot_string ?? "—"}</Badge>
                  </TableCell>

                  <TableCell className="font-mono">
                    {label ? `${label} = ${value?.toFixed(2)} kJ/mol` : "—"}
                  </TableCell>

                  <TableCell>
                    <CpSpark thermo={thermoById[c.conformer_id]} />
                  </TableCell>

                  <TableCell className="text-right space-x-2">
                    <View3DButton
                      conformerId={c.conformer_id}
                      initialXYZ={geomByConfId?.[c.conformer_id]}
                    />
                    <Button size="sm" variant="ghost" asChild>
                      <Link
                        to={`/conformers/${c.conformer_id}`}
                        state={
                          reactionId
                            ? { fromReactionId: reactionId }
                            : undefined
                        } // <-- add this
                      >
                        Details
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function ReactionCoordinate({
  participants,
  energyByConfId,
}: {
  participants: Participant[];
  energyByConfId: Record<number, number>;
}) {
  const pick = (role: Participant["role"]) =>
    participants.find((p) => p.role === role)?.conformer;

  const r1 = pick("R1H");
  const ts = pick("TS");
  const r2 = pick("R2H");

  // pull server-picked energies
  let eR1 = r1 ? (energyByConfId[r1.conformer_id] ?? null) : null;
  let eTS = ts ? (energyByConfId[ts.conformer_id] ?? null) : null;
  let eR2 = r2 ? (energyByConfId[r2.conformer_id] ?? null) : null;

  // unit guard: if the spread is obviously J/mol, convert to kJ/mol
  const finite = [eR1, eTS, eR2].filter((v): v is number =>
    Number.isFinite(v as number),
  );
  if (finite.length >= 2) {
    const spread = Math.max(...finite) - Math.min(...finite);
    if (spread > 5000) {
      // ≫ typical kJ/mol scales → must be J/mol
      const s = 1 / 1000;
      eR1 = Number.isFinite(eR1 as number) ? (eR1 as number) * s : eR1;
      eTS = Number.isFinite(eTS as number) ? (eTS as number) * s : eTS;
      eR2 = Number.isFinite(eR2 as number) ? (eR2 as number) * s : eR2;
    }
  }

  // reference = R1H (else lowest well, else min finite)
  const wells = [eR1, eR2].filter((v): v is number =>
    Number.isFinite(v as number),
  );
  const all = [eR1, eTS, eR2].filter((v): v is number =>
    Number.isFinite(v as number),
  );
  const zero = Number.isFinite(eR1 as number)
    ? (eR1 as number)
    : wells.length
      ? Math.min(...wells)
      : all.length
        ? Math.min(...all)
        : 0;

  const rel = (v: number | null) =>
    Number.isFinite(v as number) ? (v as number) - zero : null;

  const data = [
    r1 && { key: "R1H", label: r1.well_label ?? "well", raw: eR1, E: rel(eR1) },
    ts && { key: "TS", label: "TS", raw: eTS, E: rel(eTS) },
    r2 && { key: "R2H", label: r2.well_label ?? "well", raw: eR2, E: rel(eR2) },
  ].filter(Boolean) as Array<{
    key: string;
    label: string;
    raw: number | null;
    E: number | null;
  }>;

  const dE_rxn =
    Number.isFinite(eR1 as number) && Number.isFinite(eR2 as number)
      ? (eR2 as number) - (eR1 as number)
      : null;

  const dE_dagger_fwd =
    Number.isFinite(eR1 as number) && Number.isFinite(eTS as number)
      ? (eTS as number) - (eR1 as number)
      : null;

  const dE_dagger_rev =
    Number.isFinite(eR2 as number) && Number.isFinite(eTS as number)
      ? (eTS as number) - (eR2 as number)
      : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Reaction coordinate (PES)</CardTitle>
        <CardDescription>
          R1H → TS → R2H · energies from backend (relative to{" "}
          {Number.isFinite(eR1 as number) ? "R1H" : "lowest well"})
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data}
              margin={{ left: 28, right: 12, top: 8, bottom: 8 }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" />
              <YAxis
                label={{
                  value: "ΔE [kJ/mol] (relative)",
                  angle: -90,
                  position: "insideLeft",
                }}
                domain={["auto", "auto"]}
              />
              <RTooltip
                formatter={(_v: any, _n: any, p: any) =>
                  `${(p?.payload?.raw as number)?.toFixed?.(2) ?? "N/A"} kJ/mol`
                }
              />
              <Line
                type="linear"
                dataKey={() => 0}
                strokeDasharray="4 4"
                dot={false}
                isAnimationActive={false}
              />
              <Line
                type="linear"
                dataKey="E"
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="flex flex-wrap gap-2 text-sm">
          <Badge variant="outline">
            ΔE‡ (fwd):{" "}
            {Number.isFinite(dE_dagger_fwd as number)
              ? `${(dE_dagger_fwd as number).toFixed(1)} kJ/mol`
              : "—"}
          </Badge>
          <Badge variant="outline">
            ΔE‡ (rev):{" "}
            {Number.isFinite(dE_dagger_rev as number)
              ? `${(dE_dagger_rev as number).toFixed(1)} kJ/mol`
              : "—"}
          </Badge>
          <Badge variant="secondary">
            ΔE_rxn:{" "}
            {Number.isFinite(dE_rxn as number)
              ? `${(dE_rxn as number).toFixed(1)} kJ/mol`
              : "—"}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

function KineticsPanel({
  rateModels,
  order = 2,
}: {
  rateModels: RateModel[];
  order?: 1 | 2 | 3;
}) {
  const [arrheniusX, setArrheniusX] = useState(true);

  const unitLabel = useMemo(() => {
    if (order === 1) return "s⁻¹";
    if (order === 2) return "m³/(mol·s)";
    return "m⁶/(mol²·s)";
  }, [order]);

  const scaleK = order === 2 /* and A is in cm³ */ ? 1e-6 : 1;

  // Tmin/Tmax
  const [Tmin, Tmax] = useMemo(() => {
    const mins = rateModels
      .map((r) => r.Tmin_K)
      .filter(Number.isFinite) as number[];
    const maxs = rateModels
      .map((r) => r.Tmax_K)
      .filter(Number.isFinite) as number[];
    const lo = Math.max(1, Math.min(...mins, 300));
    const hi = Math.max(...maxs, 3000);
    return [lo, hi];
  }, [rateModels]);

  // T grid
  const Tgrid = useMemo(() => {
    const N = 160;
    const step = (Tmax - Tmin) / (N - 1);
    return Array.from({ length: N }, (_, i) => Tmin + i * step);
  }, [Tmin, Tmax]);

  // series
  const series = useMemo(() => {
    return rateModels.map((rm) => {
      const pts = Tgrid.map((T) => {
        const x = arrheniusX ? 1000 / T : T;
        const k = kOfT(rm, T);
        return { x, T, k };
      });
      return {
        id: rm.rate_model_id,
        label: `${rm.direction} ${rm.model}`,
        pts,
      };
    });
  }, [rateModels, Tgrid, arrheniusX]);

  const xLabel = arrheniusX ? "1000 / T [K⁻¹]" : "T [K]";
  const xDomain = arrheniusX ? [1000 / Tmax, 1000 / Tmin] : [Tmin, Tmax];

  const arrheniusTicks = useMemo(() => {
    if (!arrheniusX) return undefined;
    const lo = 1000 / Tmax;
    const hi = 1000 / Tmin;
    const start = Math.floor(lo * 2) / 2;
    const end = Math.ceil(hi * 2) / 2;
    const ticks: number[] = [];
    for (let t = start; t <= end + 1e-9; t += 0.5) {
      if (t >= lo - 1e-9 && t <= hi + 1e-9) ticks.push(Number(t.toFixed(1)));
    }
    return ticks;
  }, [arrheniusX, Tmin, Tmax]);

  const COLORS = [
    "#2563eb",
    "#16a34a",
    "#f59e0b",
    "#dc2626",
    "#7c3aed",
    "#0d9488",
  ];

  const yTickFmt = (v: any) => {
    const n = Number(v);
    if (!isFinite(n) || n === 0) return "0";
    const e = Math.floor(Math.log10(n));
    return `1e${e}`;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <ArrowRightLeft className="h-4 w-4" /> Kinetics
        </CardTitle>
        <CardDescription>Arrhenius/Modified Arrhenius fits</CardDescription>
      </CardHeader>

      <CardContent>
        <div className="flex items-center gap-4 pb-2">
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={arrheniusX}
              onChange={(e) => setArrheniusX(e.target.checked)}
            />
            <span>Arrhenius x-axis (1000 / T)</span>
          </label>
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          {/* LEFT: chart (with expand) */}
          <ExpandableKineticsChart
            series={series.map((s) => ({
              ...s,
              pts: s.pts.map((p) => ({ ...p, k: p.k * scaleK })),
            }))}
            xDomain={xDomain}
            arrheniusTicks={arrheniusTicks}
            arrheniusX={arrheniusX}
            xLabel={xLabel}
            yTickFmt={yTickFmt}
            COLORS={COLORS}
            unitLabel={unitLabel}
          />

          {/* RIGHT: table */}
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Direction</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead className="whitespace-nowrap">A</TableHead>
                  <TableHead>n</TableHead>
                  <TableHead>Ea [kJ/mol]</TableHead>
                  <TableHead>T range [K]</TableHead>
                  <TableHead>Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rateModels.map((rm) => (
                  <TableRow key={rm.rate_model_id}>
                    <TableCell>{rm.direction}</TableCell>
                    <TableCell>{rm.model}</TableCell>
                    <TableCell className="font-mono">
                      {rm.A.toExponential(3)}
                    </TableCell>
                    <TableCell className="font-mono">{rm.n ?? 0}</TableCell>
                    <TableCell className="font-mono">
                      {rm.Ea_kJ_mol.toFixed(1)}
                    </TableCell>
                    <TableCell className="font-mono">
                      {Math.round(rm.Tmin_K)}–{Math.round(rm.Tmax_K)}
                    </TableCell>
                    <TableCell
                      className="truncate max-w-[16ch]"
                      title={rm.source ?? rm.reference ?? ""}
                    >
                      {rm.source ?? rm.reference ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
// ---------- page ----------
export default function ReactionPage() {
  const { id } = useParams();
  const reactionId = Number(id);
  const [explicitSmiles, setExplicitSmiles] = useState(false);
  if (!Number.isFinite(reactionId)) {
    return (
      <div className="p-6 text-sm text-rose-600">Invalid reaction id.</div>
    );
  }

  const {
    rxn,
    thermo,
    speciesById,
    geomByConfId,
    energyByConfId,
    loading,
    error,
  } = useReactionDetail(reactionId);

  if (loading)
    return (
      <div className="p-6 text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading reaction…
      </div>
    );
  if (error) return <div className="p-6 text-sm text-rose-600">{error}</div>;
  if (!rxn)
    return <div className="p-6 text-sm text-rose-600">Reaction not found.</div>;

  const title = rxn.reaction_name || `Reaction #${rxn.reaction_id}`;

  // ✅ compute order OUTSIDE JSX
  const reactantCount = rxn.participants.filter(
    (p) => p.role === "R1H" || p.role === "R2H",
  ).length;
  const order = Math.max(1, Math.min(3, reactantCount)); // clamp 1..3

  return (
    <div className="max-w-7xl mx-auto p-4 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{title}</h1>
        <Badge variant="secondary">{rxn.family}</Badge>
        <div>
          <BackLink />
        </div>
      </div>

      <ReactionCoordinate
        participants={rxn.participants}
        energyByConfId={energyByConfId}
      />

      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{title}</h1>
        <div className="flex items-center gap-4">
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={explicitSmiles}
              onChange={(e) => setExplicitSmiles(e.target.checked)}
            />
            <span>Explicit SMILES</span>
          </label>
          <Badge variant="secondary">{rxn.family}</Badge>
        </div>
      </div>

      <ParticipantsTable
        participants={rxn.participants}
        thermoById={thermo}
        speciesById={speciesById}
        explicitSmiles={explicitSmiles}
        geomByConfId={geomByConfId}
        reactionId={reactionId}
      />

      {/* ✅ now just render the panel */}
      <KineticsPanel rateModels={rxn.rate_models} order={order} />
    </div>
  );
}
