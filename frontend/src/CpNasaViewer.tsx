import React, { useMemo, useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceArea,
} from "recharts";
import { Download, Activity, Thermometer } from "lucide-react";
import { motion } from "framer-motion";

// ---- Types ----
export type CPCurve = {
  T_K: number[];
  Cp_J_per_molK: number[]; // already normalized to SI
  source?: string;
  raw_units?: { Cp_T_units?: string; T_units?: string } | null;
  Cp0_raw?: number | null;
  CpInf_raw?: number | null;
};

export type NASA7 = {
  form: "NASA7" | string;
  Tmin_K: number;
  Tmax_K: number;
  coeffs: [number, number, number, number, number, number, number];
  source?: string | null;
  fit_rmse?: number | null; // J/mol/K
};

export type CpViewerProps = {
  speciesLabel?: string;
  lotString?: string;
  curve?: CPCurve | null;
  polynomials?: NASA7[] | null;
  active?: boolean;
};

// ---- Constants ----
const R = 8.314462618; // J/(mol*K)
const CAL_PER_J = 1 / 4.184;

type Unit = "J" | "kJ" | "cal";

function toUnitsFromJ(vJ: number, unit: Unit) {
  if (unit === "J") return vJ;
  if (unit === "kJ") return vJ / 1000;
  return vJ * CAL_PER_J; // "cal"
}

function unitLabel(unit: Unit) {
  return unit === "J"
    ? "J/(mol·K)"
    : unit === "kJ"
      ? "kJ/(mol·K)"
      : "cal/(mol·K)";
}

// NASA7 Cp(T) in J/mol/K; Cp/R = a1 + a2*T + a3*T^2 + a4*T^3 + a5*T^4
function nasaCpJ(T: number, seg: NASA7): number {
  const [a1, a2, a3, a4, a5] = seg.coeffs;
  const cp_over_R =
    a1 + a2 * T + a3 * T * T + a4 * T * T * T + a5 * T * T * T * T;
  return cp_over_R * R;
}

function formatTick(value: number, decimals: number) {
  // keep at most `decimals`, but strip trailing zeros
  return Number(value.toFixed(decimals)).toString();
}

function autoDecimals(ymin: number, ymax: number, unit: Unit) {
  const span = Math.abs(ymax - ymin) || Math.abs(ymax) || 1;
  // Base on span, then bias a bit by unit
  let d = span < 0.2 ? 3 : span < 2 ? 2 : span < 20 ? 1 : 0;

  // Gentle nudges per unit
  if (unit === "kJ") d = Math.max(d, 3); // kJ tends to be small numbers
  if (unit === "cal") d = Math.max(d, 2); // a tad more detail
  return Math.min(d, 6);
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function sampleNASA(polys: NASA7[], Tmin: number, Tmax: number, points = 240) {
  if (!polys.length) return [] as { T: number; cp_fit_j: number }[];
  const step = Math.max((Tmax - Tmin) / points, 1);
  const out: { T: number; cp_fit_j: number }[] = [];
  for (let T = Tmin; T <= Tmax + 1e-9; T += step) {
    // choose the segment whose range contains T; if none, pick nearest
    let seg = polys.find((p) => T >= p.Tmin_K && T <= p.Tmax_K);
    if (!seg) {
      // nearest segment by midpoint distance
      seg = polys.reduce((best, p) => {
        const mid = 0.5 * (p.Tmin_K + p.Tmax_K);
        const bmid = best ? 0.5 * (best.Tmin_K + best.Tmax_K) : mid;
        return Math.abs(T - mid) < Math.abs(T - bmid) ? p : (best as NASA7);
      }, polys[0] as NASA7);
      T = clamp(T, seg.Tmin_K, seg.Tmax_K); // force into valid range for evaluation
    }
    out.push({ T, cp_fit_j: nasaCpJ(T, seg) });
  }
  return out;
}

function zipRaw(curve?: CPCurve | null) {
  if (!curve) return [] as { T: number; cp_raw_j: number }[];
  const { T_K, Cp_J_per_molK } = curve;
  const n = Math.min(T_K.length, Cp_J_per_molK.length);
  const out = new Array(n);
  for (let i = 0; i < n; i++)
    out[i] = { T: T_K[i], cp_raw_j: Cp_J_per_molK[i] };
  return out;
}

// ---- CSV helper ----
function downloadCSV(
  rows: Array<Record<string, number | string>>,
  filename = "cp_curve.csv",
) {
  const headers = Object.keys(rows[0] ?? { T: 0, Cp: 0 });
  const body = rows
    .map((r) => headers.map((h) => String(r[h] ?? "")).join(","))
    .join("\n");
  const csv = `${headers.join(",")}\n${body}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ---- Pretty chips ----
function SegmentBadges({ polys }: { polys: NASA7[] }) {
  if (!polys?.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {polys.map((p, i) => (
        <Badge
          key={i}
          variant={i % 2 ? "default" : "secondary"}
          className="rounded-2xl"
        >
          {Math.round(p.Tmin_K)}–{Math.round(p.Tmax_K)} K • RMSE{" "}
          {p.fit_rmse ? p.fit_rmse.toFixed(2) : "–"} J/mol·K
        </Badge>
      ))}
    </div>
  );
}

// ---- Tooltip ----
const ChartTooltip = ({ active, payload, label, units }: any) => {
  if (!active || !payload?.length) return null;
  const find = (key: string) =>
    payload.find((p: any) => p.dataKey === key)?.value;
  const T = label;
  const raw = find("cp_raw");
  const fit = find("cp_fit");
  const delta = raw != null && fit != null ? raw - fit : undefined;
  return (
    <div className="rounded-xl border bg-background/90 p-3 shadow-xl">
      <div className="text-sm font-medium">T = {Number(T).toFixed(1)} K</div>
      {raw != null && (
        <div className="text-sm">
          Cp(raw) = {raw.toFixed(3)} {units}
        </div>
      )}
      {fit != null && (
        <div className="text-sm">
          Cp(fit) = {fit.toFixed(3)} {units}
        </div>
      )}
      {delta != null && (
        <div
          className={`text-sm ${Math.abs(delta) < 1e-6 ? "" : delta > 0 ? "text-emerald-600" : "text-rose-600"}`}
        >
          Δ = {(delta >= 0 ? "+" : "") + delta.toFixed(3)} {units}
        </div>
      )}
    </div>
  );
};

// ---- Main component ----
export default function CpCurveViewer({
  speciesLabel,
  lotString,
  curve,
  polynomials,
  active = true,
}: CpViewerProps) {
  // Fallback sample (small NH fragment) to keep the component previewable
  const samplePolys: NASA7[] = [
    {
      form: "NASA7",
      Tmin_K: 200,
      Tmax_K: 1000,
      coeffs: [3.5, 1.2e-3, -3.4e-6, 5.6e-9, -2.1e-12, 0, 0],
      fit_rmse: 30,
    },
    {
      form: "NASA7",
      Tmin_K: 1000,
      Tmax_K: 3000,
      coeffs: [4.0, 8.0e-4, -2.8e-7, 4.1e-10, -1.5e-13, 0, 0],
      fit_rmse: 22,
    },
  ];
  const sampleCurve: CPCurve = {
    T_K: [300, 400, 500, 600, 800, 1000, 1500, 2000, 2400],
    Cp_J_per_molK: [44.1, 49.2, 53.1, 56.3, 61.4, 64.0, 69.8, 73.0, 75.2],
    source: "example",
    raw_units: { Cp_T_units: "J/(mol*K)", T_units: "K" },
  };

  const polys = useMemo(
    () => (polynomials && polynomials.length ? polynomials : samplePolys),
    [polynomials],
  );
  const rawPairs = useMemo(() => zipRaw(curve ?? sampleCurve), [curve]);

  const Tmin = useMemo(
    () =>
      Math.min(
        ...(rawPairs.length
          ? [rawPairs[0].T, rawPairs[rawPairs.length - 1].T]
          : [polys[0].Tmin_K, polys[polys.length - 1].Tmax_K]),
      ),
    [rawPairs, polys],
  );

  const Tmax = useMemo(
    () =>
      Math.max(
        ...(rawPairs.length
          ? [rawPairs[0].T, rawPairs[rawPairs.length - 1].T]
          : [polys[0].Tmin_K, polys[polys.length - 1].Tmax_K]),
      ),
    [rawPairs, polys],
  );

  const fitSeries = useMemo(
    () => sampleNASA(polys, Tmin, Tmax, 300),
    [polys, Tmin, Tmax],
  );

  // UI state
  // const [useCal, setUseCal] = useState(false);
  const [unit, setUnit] = useState<Unit>("J");
  const [showRaw, setShowRaw] = useState(true);
  const [showFit, setShowFit] = useState(true);
  const [chartsEnabled, setChartsEnabled] = useState<boolean>(active);

  useEffect(() => {
    setChartsEnabled(active);
  }, [active]);

  // const units = useCal ? "cal/(mol·K)" : "J/(mol·K)";
  const units = unitLabel(unit);

  const chartData = useMemo(() => {
    const byT = new Map<
      number,
      { T: number; cp_raw?: number; cp_fit?: number }
    >();

    for (const f of fitSeries) {
      const row = byT.get(f.T) ?? { T: f.T };
      row.cp_fit = toUnitsFromJ(f.cp_fit_j, unit);
      byT.set(f.T, row);
    }

    const pickSeg = (T: number) =>
      polys.find((p) => T >= p.Tmin_K && T <= p.Tmax_K) ??
      polys.reduce((best, p) => {
        const mid = 0.5 * (p.Tmin_K + p.Tmax_K);
        const bmid = best ? 0.5 * (best.Tmin_K + best.Tmax_K) : mid;
        return Math.abs(T - mid) < Math.abs(T - bmid) ? p : (best as NASA7);
      }, polys[0] as NASA7);

    for (const r of rawPairs) {
      const row = byT.get(r.T) ?? { T: r.T };
      row.cp_raw = toUnitsFromJ(r.cp_raw_j, unit);

      if (row.cp_fit == null && polys.length) {
        const seg = pickSeg(r.T);
        const fitJ = nasaCpJ(clamp(r.T, seg.Tmin_K, seg.Tmax_K), seg);
        row.cp_fit = toUnitsFromJ(fitJ, unit);
      }
      byT.set(r.T, row);
    }

    return Array.from(byT.values()).sort((a, b) => a.T - b.T);
  }, [rawPairs, fitSeries, polys, unit]);

  const [ymin, ymax] = useMemo(() => {
    let lo = +Infinity,
      hi = -Infinity;
    for (const d of chartData) {
      if (showRaw && d.cp_raw != null) {
        lo = Math.min(lo, d.cp_raw);
        hi = Math.max(hi, d.cp_raw);
      }
      if (showFit && d.cp_fit != null) {
        lo = Math.min(lo, d.cp_fit);
        hi = Math.max(hi, d.cp_fit);
      }
    }
    if (!isFinite(lo) || !isFinite(hi)) {
      lo = 0;
      hi = 1;
    }
    const pad = 0.05 * Math.max(1e-9, hi - lo);
    return [lo - pad, hi + pad];
  }, [chartData, showRaw, showFit]);

  const cpDecimals = useMemo(
    () => autoDecimals(ymin, ymax, unit),
    [ymin, ymax, unit],
  );
  const residuals = useMemo(
    () =>
      chartData
        .filter((d) => d.cp_raw != null && d.cp_fit != null)
        .map((d) => ({
          T: d.T,
          resid: (d.cp_raw as number) - (d.cp_fit as number),
        })),
    [chartData],
  );

  const [rmin, rmax] = useMemo(() => {
    if (!residuals.length) return [0, 1];
    let lo = +Infinity,
      hi = -Infinity;
    for (const r of residuals) {
      lo = Math.min(lo, r.resid);
      hi = Math.max(hi, r.resid);
    }
    const pad = 0.05 * Math.max(1e-9, hi - lo);
    return [lo - pad, hi + pad];
  }, [residuals]);

  const residDecimals = useMemo(
    () => autoDecimals(rmin, rmax, unit),
    [rmin, rmax, unit],
  );

  const segBands = useMemo(
    () => polys.map((p, i) => ({ ...p, idx: i })),
    [polys],
  );

  const renderCharts = chartsEnabled;

  const title = speciesLabel ?? "Species";
  const subtitle = lotString
    ? `Level of Theory: ${lotString}`
    : "Thermo overview";

  return (
    <Card className="w-full overflow-hidden">
      <CardHeader className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-xl md:text-2xl">
              <Activity className="size-5" /> Cp(T) Viewer
              <span className="font-normal text-muted-foreground">
                • {title}
              </span>
            </CardTitle>
            <CardDescription className="flex items-center gap-2">
              <Thermometer className="size-4" /> {subtitle}
            </CardDescription>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Label className="text-sm">Units</Label>
              <div className="inline-flex rounded-xl border p-1">
                {(["J", "kJ", "cal"] as Unit[]).map((u) => (
                  <Button
                    key={u}
                    type="button"
                    size="sm"
                    variant={unit === u ? "default" : "ghost"}
                    className="rounded-lg"
                    onClick={() => setUnit(u)}
                  >
                    {u === "J"
                      ? "J/(mol·K)"
                      : u === "kJ"
                        ? "kJ/(mol·K)"
                        : "cal/(mol·K)"}
                  </Button>
                ))}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const rows = chartData.map((d) => ({
                  T_K: d.T,
                  Cp_raw: d.cp_raw ?? "",
                  Cp_fit: d.cp_fit ?? "",
                }));
                downloadCSV(rows, `cp_curve_${title.replace(/\s+/g, "_")}.csv`);
              }}
            >
              <Download className="mr-2 size-4" /> CSV
            </Button>
          </div>
        </div>
        <SegmentBadges polys={polys} />
      </CardHeader>

      <CardContent>
        <Tabs defaultValue="cp">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="cp">Cp vs T</TabsTrigger>
            <TabsTrigger value="resid">Residuals (raw − fit)</TabsTrigger>
          </TabsList>

          <TabsContent value="cp" className="mt-4">
            <div className="mb-3 flex items-center gap-4 text-sm">
              <label className="flex items-center gap-2">
                <Switch checked={showRaw} onCheckedChange={setShowRaw} /> Raw
              </label>
              <label className="flex items-center gap-2">
                <Switch checked={showFit} onCheckedChange={setShowFit} /> NASA
                fit
              </label>
            </div>
            <div className="h-[380px] w-full">
              {renderCharts ? (
                <ResponsiveContainer>
                  <LineChart
                    data={chartData}
                    margin={{ top: 10, right: 24, left: 8, bottom: 8 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="T"
                      type="number"
                      domain={[Tmin, Tmax]}
                      tickFormatter={(v) => `${Math.round(v)}`}
                      label={{
                        value: "T (K)",
                        position: "insideBottom",
                        offset: -2,
                      }}
                    />
                    <YAxis
                      yAxisId={0}
                      domain={[ymin, ymax]}
                      allowDecimals
                      tickFormatter={(v) => formatTick(v as number, cpDecimals)}
                      label={{
                        value: units,
                        angle: -90,
                        position: "insideLeft",
                      }}
                    />
                    {segBands.map((s, i) => (
                      <ReferenceArea
                        key={i}
                        x1={s.Tmin_K}
                        x2={s.Tmax_K}
                        y1={0}
                        y2={1}
                        yAxisId={0}
                        ifOverflow="extendDomain"
                        fill={i % 2 ? "#e5e7eb" : "#f9fafb"}
                        fillOpacity={0.45}
                        strokeOpacity={0}
                      />
                    ))}
                    <Tooltip content={<ChartTooltip units={units} />} />
                    <Legend />
                    {showRaw && (
                      <Line
                        type="monotone"
                        dataKey="cp_raw"
                        name="Cp raw"
                        stroke="#2563eb"
                        dot={true}
                        strokeWidth={2}
                        isAnimationActive={false}
                      />
                    )}
                    {showFit && (
                      <Line
                        type="monotone"
                        dataKey="cp_fit"
                        name="Cp NASA7"
                        stroke="#16a34a"
                        dot={false}
                        strokeWidth={2}
                      />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
                  Open the Thermo tab to render Cp curves.
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="resid" className="mt-4">
            <div className="h-[320px] w-full">
              {renderCharts ? (
                <ResponsiveContainer>
                  <LineChart
                    data={residuals}
                    margin={{ top: 10, right: 24, left: 8, bottom: 8 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="T"
                      type="number"
                      domain={[Tmin, Tmax]}
                      tickFormatter={(v) => `${Math.round(v)}`}
                      label={{
                        value: "T (K)",
                        position: "insideBottom",
                        offset: -2,
                      }}
                    />
                    <YAxis
                      domain={[rmin, rmax]}
                      allowDecimals
                      tickFormatter={(v) =>
                        formatTick(v as number, residDecimals)
                      }
                      label={{
                        value: `ΔCp (${units})`,
                        angle: -90,
                        position: "insideLeft",
                      }}
                    />
                    <Tooltip
                      formatter={(v: number) => v.toFixed(3)}
                      labelFormatter={(l) => `T = ${l} K`}
                    />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="resid"
                      name="raw − fit"
                      stroke="#ef4444"
                      dot={false}
                      strokeWidth={2}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
                  Open the Thermo tab to render residuals.
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>

        {/* Tiny entrance animation */}
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="mt-4 text-xs text-muted-foreground"
        >
          Tips: toggle units J↔cal, hover to compare raw vs NASA, download CSV
          for analysis.
        </motion.div>
      </CardContent>
    </Card>
  );
}
