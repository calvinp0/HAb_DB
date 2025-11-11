// KineticsPanel.tsx (chart section)
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Maximize2 } from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  Legend,
} from "recharts";
import type { TooltipProps } from "recharts";
import React from "react";
import { cn } from "@/lib/utils";

type LegendVariant = "inline" | "overlay";
type KineticsPoint = { x: number; T: number; k: number };
type KineticsSeries = {
  id: number | string;
  label: string;
  pts: KineticsPoint[];
};
type TickFormatterFn = (value: number | string) => string;

type KineticsChartProps = {
  series: KineticsSeries[];
  xDomain: [number, number];
  arrheniusTicks?: number[];
  arrheniusX: boolean;
  xLabel: string;
  yTickFmt: TickFormatterFn;
  COLORS: string[];
  height?: number | string;
  legendSize?: "sm" | "md" | "lg";
  legendVariant?: LegendVariant;
  unitLabel?: string;
};

function KineticsChartBody({
  series,
  xDomain,
  arrheniusTicks,
  arrheniusX,
  xLabel,
  yTickFmt,
  COLORS,
  height = "100%",
  legendSize = "md",
  legendVariant = "inline",
  unitLabel = "k(T)",
}: KineticsChartProps) {
  const SIZES = {
    sm: {
      swatch: "h-2 w-2",
      text: "text-[11px]",
      pad: "px-2 py-1",
      gap: "gap-x-2 gap-y-1",
    },
    md: {
      swatch: "h-2.5 w-2.5",
      text: "text-xs",
      pad: "px-3 py-1.5",
      gap: "gap-x-3 gap-y-1.5",
    },
    lg: {
      swatch: "h-3.5 w-3.5",
      text: "text-sm",
      pad: "px-3.5 py-2",
      gap: "gap-x-3.5 gap-y-2",
    },
  }[legendSize];

  const tooltipFormatter = React.useCallback<
    TooltipProps<number, string>["formatter"]
  >(
    (value, _name, payloadItem) => {
      const numericValue =
        typeof value === "number" ? value : Number(value);
      const point = payloadItem?.payload as KineticsPoint | undefined;
      const formattedK = Number.isFinite(numericValue)
        ? `${numericValue.toExponential(3)} ${unitLabel}`
        : "—";
      const formattedT =
        point && Number.isFinite(point.T)
          ? `T=${Math.round(point.T)} K`
          : "T=N/A";
      return [formattedK, formattedT];
    },
    [unitLabel],
  );

  return (
    <div className="relative w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          margin={{
            left: 12,
            right: 14,
            top: 8,
            bottom: legendVariant === "inline" ? 28 : 18,
          }}
        >
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            type="number"
            dataKey="x"
            domain={xDomain}
            ticks={arrheniusTicks}
            tickFormatter={(x) =>
              arrheniusX ? Number(x).toFixed(1) : String(Math.round(Number(x)))
            }
            label={{ value: xLabel, position: "insideBottom", dy: 12 }}
          />
          <YAxis
            width={72}
            scale="log"
            domain={["auto", "auto"]}
            tickFormatter={yTickFmt}
            label={{
              value: `k(T) [${unitLabel}]`,
              angle: -90,
              position: "insideLeft",
            }}
          />
          <RTooltip formatter={tooltipFormatter} labelFormatter={() => ""} />

          {legendVariant === "inline" && (
            <Legend
              verticalAlign="bottom"
              align="center"
              height={28}
              wrapperStyle={{ paddingTop: 6, fontSize: 12 }}
              iconType="circle"
              content={() => {
                const items = series.map((s, i) => ({
                  value: s.label,
                  color: COLORS[i % COLORS.length],
                  id: String(s.id),
                }));
                return (
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "center",
                      gap: 16,
                      paddingTop: 4,
                    }}
                  >
                    {items.map((it) => (
                      <span
                        key={it.id}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <span
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: 9999,
                            background: it.color,
                            display: "inline-block",
                          }}
                        />
                        <span>{it.value}</span>
                      </span>
                    ))}
                  </div>
                );
              }}
            />
          )}

          {series.map((s, i) => (
            <Line
              key={s.id}
              data={s.pts}
              type="monotone"
              dataKey="k"
              name={s.label}
              dot={false}
              isAnimationActive={false}
              stroke={COLORS[i % COLORS.length]}
              strokeWidth={2}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>

      {legendVariant === "overlay" && (
        <div
          className={cn(
            "pointer-events-none absolute right-3 top-3 rounded-md backdrop-blur-sm shadow-sm bg-card/90 dark:bg-card/70",
            SIZES.pad,
            SIZES.text,
          )}
        >
          <div className={`flex flex-wrap ${SIZES.gap}`}>
            {series.map((s, i) => (
              <div key={s.id} className="inline-flex items-center gap-2">
                <span
                  className={`inline-block rounded-full ${SIZES.swatch}`}
                  style={{ backgroundColor: COLORS[i % COLORS.length] }}
                />
                <span className="whitespace-nowrap font-medium">{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function ExpandableKineticsChart(props: KineticsChartProps) {
  const { height = 512, ...chartProps } = props;

  return (
    <Dialog>
      <>
        {/* inline (small) chart */}
        <div className="relative rounded-md border" style={{ height }}>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 top-2 z-10 h-8 w-8"
              aria-label="Expand chart"
              title="Expand"
            >
              <Maximize2 className="h-4 w-4" />
            </Button>
          </DialogTrigger>
          <div className="h-full">
            <KineticsChartBody
              {...chartProps}
              legendVariant="inline" // bottom legend on the page
              legendSize="md"
              height={height}
            />
          </div>
        </div>

        {/* modal (expanded) chart */}
        <DialogContent
          className="
            fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2
            w-[95vw] max-w-none md:max-w-[1600px]
            h-[80vh]
            p-3 overflow-hidden
          "
        >
          <div className="w-full h-full">
            <KineticsChartBody
              {...chartProps}
              legendVariant="overlay" // floating legend on the chart
              legendSize="lg"
              height="100%"
            />
          </div>
        </DialogContent>
      </>
    </Dialog>
  );
}
