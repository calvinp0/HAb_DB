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
import { Loader2, ArrowRightLeft } from "lucide-react";
import type { TooltipProps } from "recharts";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  ResponsiveContainer,
} from "recharts";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ExpandableKineticsChart } from "./KineticsPanel";
import { ThemeModeToggle } from "@/components/ThemeModeToggle";

const RAW_API = import.meta.env.VITE_API_BASE ?? "/api";
const BASE_URL = import.meta.env.BASE_URL || "/";

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
type Participant = {
  role: "R1H" | "R2H" | "TS" | "R1" | "R2";
  conformer: ConformerLite;
};

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
  raw_units?: Record<string, unknown> | null;
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
type ReactionDetailResponse = Omit<ReactionDetail, "participants"> & {
  participants: ParticipantWire[];
};
type ConformerDetailResponse = ConformerLite & {
  species_id: number;
  smiles?: string | null;
  smiles_no_h?: string | null;
  geom_xyz?: string | null;
  energy_label?: string | null;
  energy_value?: number | null;
};

// ---------- constants / helpers ----------
const formatAbsoluteEnergy = (value: number | null, digits = 2) =>
  Number.isFinite(value as number)
    ? `${(value as number).toFixed(digits)} kJ/mol`
    : "N/A";

const formatRelativeEnergy = (value: number | null, digits = 2) =>
  Number.isFinite(value as number)
    ? `${(value as number) >= 0 ? "+" : ""}${(value as number).toFixed(digits)} kJ/mol`
    : "N/A";

type PesTooltipDatum = {
  label: string;
  raw: number | null;
  E: number | null;
};

type PesTooltipProps = TooltipProps<number, string> & {
  zeroLabel: string;
};

function PesTooltip({ active, payload, zeroLabel }: PesTooltipProps) {
  if (!active || !payload?.length) return null;
  const datum = payload[0]?.payload as PesTooltipDatum | undefined;
  if (!datum) return null;

  return (
    <div className="rounded-md border border-border bg-background/95 px-3 py-2 shadow-md">
      <p className="text-sm font-medium">{datum.label}</p>
      <p className="text-xs text-muted-foreground">
        Absolute: {formatAbsoluteEnergy(datum.raw)}
      </p>
      <p className="text-xs text-muted-foreground">
        Relative to {zeroLabel}: {formatRelativeEnergy(datum.E)}
      </p>
    </div>
  );
}

async function fetchJSON<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

function BackLink() {
  return (
    <Link
      to={BASE_URL}
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

function stripExplicitHydrogens(smiles?: string | null) {
  if (!smiles) return null;
  let s = smiles.replace(/\[\s*H(?:[+-]?\d*)?\s*]/gi, "");
  // Collapse duplicate separators introduced after removals
  s = s
    .replace(/\.+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .replace(/\s+/g, "")
    .replace(/\.\+/g, "+")
    .replace(/\+\./g, "+");
  s = s.trim();
  return s || null;
}

function displaySmiles(
  sp: SpeciesLite | undefined,
  speciesId: number,
  explicit: boolean,
) {
  if (explicit) return sp?.smiles ?? `[${speciesId}]`;
  const candidate =
    (sp?.smiles_no_h && sp.smiles_no_h.trim().length
      ? sp.smiles_no_h
      : stripExplicitHydrogens(sp?.smiles)) ?? null;
  return candidate ?? `[${speciesId}]`;
}

// Arrhenius
const R_kJ = 8.314462618e-3;
const R_J = 8.314462618;

// full modified Arrhenius with T0 (defaults to 1 K)
function kOfT(model: RateModel, T: number): number {
  const n = model.n ?? 0;
  const Ea = model.Ea_kJ_mol ?? 0;
  const A = model.A ?? 0;
  const T0 = model.T0_K ?? 1; // <-- important
  return A * Math.pow(T / T0, n) * Math.exp(-Ea / (R_kJ * T));
}

function coerceNumber(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function sampleNASAForSpark(polys: NASA7[], maxPoints = 24) {
  if (!polys?.length) return [];
  const Tmin = Math.min(
    ...polys
      .map((p) => coerceNumber(p.Tmin_K))
      .filter((n): n is number => n != null),
  );
  const Tmax = Math.max(
    ...polys
      .map((p) => coerceNumber(p.Tmax_K))
      .filter((n): n is number => n != null),
  );
  if (!Number.isFinite(Tmin) || !Number.isFinite(Tmax) || Tmax <= Tmin) {
    return [];
  }

  const pickSegment = (T: number) => {
    const direct = polys.find((p) => T >= p.Tmin_K && T <= p.Tmax_K);
    if (direct) return direct;
    return polys.reduce((best, p) => {
      if (!best) return p;
      const mid = 0.5 * (p.Tmin_K + p.Tmax_K);
      const bestMid = 0.5 * (best.Tmin_K + best.Tmax_K);
      return Math.abs(T - mid) < Math.abs(T - bestMid) ? p : best;
    }, polys[0] as NASA7);
  };

  const n = Math.max(3, Math.min(maxPoints, 30));
  const denom = Math.max(1, n - 1);
  const step = (Tmax - Tmin) / denom;
  const pts: Array<{ T: number; Cp: number }> = [];
  for (let i = 0; i < n; i++) {
    const T = i === n - 1 ? Tmax : Tmin + i * step;
    const seg = pickSegment(T);
    const clamped = Math.min(
      Math.max(T, coerceNumber(seg.Tmin_K) ?? T),
      coerceNumber(seg.Tmax_K) ?? T,
    );
    const [a1r, a2r, a3r, a4r, a5r] = seg.coeffs;
    const a1 = coerceNumber(a1r) ?? 0;
    const a2 = coerceNumber(a2r) ?? 0;
    const a3 = coerceNumber(a3r) ?? 0;
    const a4 = coerceNumber(a4r) ?? 0;
    const a5 = coerceNumber(a5r) ?? 0;
    const cpOverR =
      a1 +
      a2 * clamped +
      a3 * clamped * clamped +
      a4 * clamped * clamped * clamped +
      a5 * clamped * clamped * clamped * clamped;
    pts.push({ T, Cp: cpOverR * R_J });
  }
  return pts;
}

function CpSpark({ thermo }: { thermo?: Thermo }) {
  const data = useMemo(() => {
    const cv = thermo?.curve;
    if (cv && cv.T_K?.length && cv.Cp_J_per_molK?.length) {
      // Sample down to ~30 points so the sparkline is cheap
      const n = Math.min(30, cv.T_K.length);
      const step = Math.max(1, Math.floor(cv.T_K.length / n));
      const pts = [];
      for (let i = 0; i < cv.T_K.length; i += step) {
        const T = coerceNumber(cv.T_K[i]);
        const Cp = coerceNumber(cv.Cp_J_per_molK[i]);
        if (T == null || Cp == null) continue;
        pts.push({ T, Cp });
      }
      if (pts.length) return pts;
    }

    const polys = thermo?.polynomials;
    if (polys?.length) {
      return sampleNASAForSpark(polys);
    }
    return [];
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
        const d = await fetchJSON<ConformerDetailResponse>(
          api(`/conformers/${conformerId}`),
        );
        if (!abort) {
          const s = ensureXYZHeaderLocal(d?.geom_xyz ?? "");
          if (!s) throw new Error("No geometry available for this conformer.");
          setXyz(s);
        }
      } catch (e: unknown) {
        if (!abort) {
          const message =
            e instanceof Error ? e.message : "Failed to load geometry";
          setErr(message);
        }
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
      role: "R1H" | "R2H" | "TS" | "R1" | "R2";
      conformer: ConformerLite;
      smiles?: string | null;
      smiles_no_h?: string | null;
    }
  | (ConformerLite & {
      role: "R1H" | "R2H" | "TS" | "R1" | "R2";
      smiles?: string | null;
      smiles_no_h?: string | null;
    })
  | {
      role: "R1H" | "R2H" | "TS" | "R1" | "R2";
      c: ConformerLite;
      smiles?: string | null;
      smiles_no_h?: string | null;
    };

function getConformerFromWire(p: ParticipantWire): ConformerLite {
  if ("conformer" in p && p.conformer) return p.conformer;
  if ("c" in p && p.c) return p.c;
  const fallback = p as ConformerLite;
  return {
    conformer_id: fallback.conformer_id,
    species_id: fallback.species_id,
    is_ts: fallback.is_ts,
    well_label: fallback.well_label ?? null,
    well_rank: fallback.well_rank ?? null,
    lot: fallback.lot,
    G298: fallback.G298 ?? null,
    H298: fallback.H298 ?? null,
    E_elec: fallback.E_elec ?? null,
    ZPE: fallback.ZPE ?? null,
    E0: fallback.E0 ?? null,
    E_TS: fallback.E_TS ?? null,
  };
}

function normalizeParticipants(ps: ParticipantWire[]): Participant[] {
  return ps.map((p) => ({ role: p.role, conformer: getConformerFromWire(p) }));
}

// ---------- data hook (module scope) ----------
// ---------- data hook (module scope) ----------
function useReactionDetail(reactionId: number | null) {
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
    if (reactionId == null || !Number.isFinite(reactionId)) {
      setRxn(null);
      setThermo({});
      setSpeciesById({});
      setGeomByConfId({});
      setEnergyByConfId({});
      setLoading(false);
      return;
    }

    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        setError(null);

        const raw = await fetchJSON<ReactionDetailResponse>(
          api(`/reactions/${reactionId}`),
        );
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
              const d = await fetchJSON<ConformerDetailResponse>(
                api(`/conformers/${id}`),
              );
              return [id, d] as const;
            } catch {
              return [id, null] as const;
            }
          }),
        );
        if (!mounted) return;

        const detailByConfId: Record<number, ConformerDetailResponse | null> =
          Object.fromEntries(detailPairs);

        // BUILD: energy map from backend-chosen values
        const energyMap: Record<number, number> = {};
        for (const [cid, d] of detailPairs) {
          const val = d?.energy_value;
          if (typeof val === "number" && Number.isFinite(val)) {
            energyMap[cid] = val; // API returns kJ/mol
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
          spEntries.push([
            d.species_id,
            {
              species_id: d.species_id,
              smiles: d.smiles ?? null,
              smiles_no_h: d.smiles_no_h ?? null,
            },
          ]);
          if (typeof d.geom_xyz === "string" && d.geom_xyz.trim()) {
            xyzEntries.push([d.conformer_id, d.geom_xyz]);
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
      } catch (e: unknown) {
        if (mounted) {
          const message =
            e instanceof Error ? e.message : "Failed to load reaction";
          setError(message);
        }
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
              const smiles = displaySmiles(sp, c.species_id, explicitSmiles);
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
                    className="font-mono break-words max-w-[28ch] whitespace-normal"
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

  const r1h = pick("R1H");
  const r2 = pick("R2");
  const ts = pick("TS");
  const r1 = pick("R1");
  const r2h = pick("R2H");

  const energyFor = (c?: ConformerLite) =>
    c ? (energyByConfId[c.conformer_id] ?? null) : null;

  const eR1H = energyFor(r1h);
  const eR2 = energyFor(r2);
  const eTS = energyFor(ts);
  const eR1 = energyFor(r1);
  const eR2H = energyFor(r2h);

  const sumEnergy = (...vals: Array<number | null>) => {
    const finite = vals.filter((v): v is number => Number.isFinite(v as number));
    return finite.length ? finite.reduce((a, b) => a + b, 0) : null;
  };

  const eReactants = sumEnergy(eR1H, eR2);
  const eProducts = sumEnergy(eR1, eR2H);

  const referencePool = [eReactants, eTS, eProducts].filter(
    (v): v is number => Number.isFinite(v as number),
  );
  const zero = Number.isFinite(eReactants as number)
    ? (eReactants as number)
    : referencePool.length
      ? Math.min(...referencePool)
      : 0;

  const rel = (v: number | null) =>
    Number.isFinite(v as number) ? (v as number) - zero : null;

  const formatLabel = (role: Participant["role"], label?: string | null) =>
    label && !/^(?:well|iso)/i.test(label) ? `${role} (${label})` : role;
  const reactantLabel = [
    formatLabel("R1H", r1h?.well_label),
    formatLabel("R2", r2?.well_label),
  ]
    .filter(Boolean)
    .join(" + ");
  const productLabel = [
    formatLabel("R1", r1?.well_label),
    formatLabel("R2H", r2h?.well_label),
  ]
    .filter(Boolean)
    .join(" + ");
  const reactantDisplayLabel = reactantLabel || "R1H + R2";
  const productDisplayLabel = productLabel || "R1 + R2H";
  const zeroReferenceDescription = Number.isFinite(eReactants as number)
    ? "reactants"
    : "lowest well";
  const relativeZeroLabel = Number.isFinite(eReactants as number)
    ? reactantDisplayLabel
    : "lowest-energy well";

  const data = [
    eReactants != null && {
      key: "reactants",
      label: reactantDisplayLabel,
      raw: eReactants,
      E: rel(eReactants),
    },
    ts && { key: "TS", label: "TS", raw: eTS, E: rel(eTS) },
    eProducts != null && {
      key: "products",
      label: productDisplayLabel,
      raw: eProducts,
      E: rel(eProducts),
    },
  ].filter(Boolean) as Array<{
    key: string;
    label: string;
    raw: number | null;
    E: number | null;
  }>;

  const dE_rxn =
    Number.isFinite(eReactants as number) && Number.isFinite(eProducts as number)
      ? (eProducts as number) - (eReactants as number)
      : null;

  const dE_dagger_fwd =
    Number.isFinite(eReactants as number) && Number.isFinite(eTS as number)
      ? (eTS as number) - (eReactants as number)
      : null;

  const dE_dagger_rev =
    Number.isFinite(eProducts as number) && Number.isFinite(eTS as number)
      ? (eTS as number) - (eProducts as number)
      : null;

  const yValues = data
    .map((d) => d.E)
    .filter((v): v is number => Number.isFinite(v as number));
  const yMin = yValues.length ? Math.min(...yValues) : -10;
  const yMax = yValues.length ? Math.max(...yValues) : 10;
  const yDomain: [number, number] = useMemo(() => {
    const padding = Math.max(5, Math.abs(yMax - yMin) * 0.2);
    return [
      Math.floor((yMin - padding) * 10) / 10,
      Math.ceil((yMax + padding) * 10) / 10,
    ];
  }, [yMin, yMax]);
  const yTicks = useMemo(() => {
    const [minY, maxY] = yDomain;
    if (!Number.isFinite(minY) || !Number.isFinite(maxY)) return undefined;
    const span = maxY - minY || 1;
    const approx = span / 5;
    const magnitude = Math.pow(10, Math.floor(Math.log10(Math.abs(approx))));
    const normalized = approx / magnitude;
    const niceNormalized =
      normalized < 1.5 ? 1 : normalized < 3 ? 2 : normalized < 7 ? 5 : 10;
    const step = niceNormalized * magnitude;
    const ticks: number[] = [];
    const start = Math.ceil(minY / step) * step;
    for (let val = start; val <= maxY + step * 0.5; val += step) {
      ticks.push(Number(val.toFixed(2)));
    }
    if (minY <= 0 && maxY >= 0 && !ticks.some((t) => Math.abs(t) < step * 0.01)) {
      ticks.push(0);
    }
    return Array.from(new Set(ticks)).sort((a, b) => a - b);
  }, [yDomain]);

  const relativeCallouts =
    Number.isFinite(eReactants as number)
      ? [
          Number.isFinite(dE_dagger_fwd as number) && {
            label: "TS",
            value: dE_dagger_fwd as number,
          },
          Number.isFinite(dE_rxn as number) && {
            label: productDisplayLabel,
            value: dE_rxn as number,
          },
        ].filter(Boolean)
      : [];
  const relativeCalloutText = (relativeCallouts as Array<{
    label: string;
    value: number;
  }>)
    .map(
      ({ label, value }) => `${label}: ${formatRelativeEnergy(value, 1)}`,
    )
    .join(" · ");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Reaction coordinate (PES)</CardTitle>
        <CardDescription>
          R1H + R2 → TS → R1 + R2H · absolute + relative energies (relative to{" "}
          {zeroReferenceDescription})
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
                width={82}
                tick={{ dx: -2 }}
                ticks={yTicks}
                label={{
                  value: "ΔE [kJ/mol] (relative)",
                  angle: -90,
                  position: "insideLeft",
                  offset: -12,
                  style: { textAnchor: "middle" },
                }}
                domain={yDomain}
              />
              <RTooltip content={<PesTooltip zeroLabel={relativeZeroLabel} />} />
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

        {relativeCallouts.length > 0 && relativeCalloutText && (
          <p className="text-xs text-muted-foreground">
            Relative to {reactantDisplayLabel}: {relativeCalloutText}
          </p>
        )}

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

  const yTickFmt = (value: number | string) => {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n) || n === 0) return "0";
    const exponent = Math.floor(Math.log10(Math.abs(n)));
    return `1e${exponent}`;
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
  const reactionIdRaw = Number(id);
  const reactionId = Number.isFinite(reactionIdRaw) ? reactionIdRaw : null;
  const [explicitSmiles, setExplicitSmiles] = useState(false);

  const {
    rxn,
    thermo,
    speciesById,
    geomByConfId,
    energyByConfId,
    loading,
    error,
  } = useReactionDetail(reactionId);

  if (reactionId == null) {
    return (
      <div className="p-6 text-sm text-rose-600">Invalid reaction id.</div>
    );
  }

  if (loading)
    return (
      <div className="p-6 text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading reaction…
      </div>
    );
  if (error) return <div className="p-6 text-sm text-rose-600">{error}</div>;
  if (!rxn)
    return <div className="p-6 text-sm text-rose-600">Reaction not found.</div>;

  const labelForRole = (role: Participant["role"]) => {
    const conf = rxn.participants.find((p) => p.role === role)?.conformer;
    if (!conf) return `[${role}]`;
    const sp = speciesById[conf.species_id];
    return displaySmiles(sp, conf.species_id, false);
  };

  const reactionTitle = [
    `${labelForRole("R1H")} + ${labelForRole("R2")}`,
    "⇌",
    `${labelForRole("R1")} + ${labelForRole("R2H")}`,
  ]
    .filter(Boolean)
    .join(" ");

  // ✅ compute order OUTSIDE JSX
  const reactantCount = rxn.participants.filter(
    (p) => p.role === "R1H" || p.role === "R2",
  ).length;
  const order = Math.max(1, Math.min(3, reactantCount)); // clamp 1..3

  return (
    <div className="max-w-7xl mx-auto p-4 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">{reactionTitle}</h1>
          {rxn.reaction_name && (
            <span className="text-sm text-muted-foreground">
              {rxn.reaction_name}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{rxn.family}</Badge>
          <ThemeModeToggle condensed />
          <BackLink />
        </div>
      </div>

      <ReactionCoordinate
        participants={rxn.participants}
        energyByConfId={energyByConfId}
      />

      <div className="flex items-center justify-between">
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
