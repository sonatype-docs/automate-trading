// Shared hour selector: "All" + 00–23 buttons. Emits the selected hour
// (0-23) or null for "All". Used to slice results/research by IST break
// hour without re-running the backtest.

import { hourDistribution } from "@/lib/research/hour-filter";
import type { backtestRange } from "@/lib/strategy.functions";

type RangeData = Awaited<ReturnType<typeof backtestRange>>;

export function HourFilterBar({
  data,
  value,
  onChange,
}: {
  data: RangeData;
  value: number | null;
  onChange: (h: number | null) => void;
}) {
  const dist = hourDistribution(data.days);
  const maxCount = Math.max(1, ...dist.map((d) => d.count));

  const btn = (active: boolean, extra = "") =>
    `h-8 min-w-[2.75rem] px-2 font-mono text-[11px] rounded border transition ${
      active
        ? "border-primary bg-primary/20 text-primary"
        : "border-border bg-background hover:border-primary/60 hover:bg-muted/60 text-muted-foreground"
    } ${extra}`;

  return (
    <div className="rounded border border-border bg-muted/20 p-2 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Hour filter (IST break hour) — applies to Results, Research &amp; Advanced Research
        </div>
        <div className="text-[10px] font-mono text-muted-foreground">
          {value == null ? "All hours" : `Hour ${String(value).padStart(2, "0")}:00`}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" className={btn(value == null)} onClick={() => onChange(null)}>
          All
        </button>
        {dist.map((d) => {
          const active = value === d.hour;
          const empty = d.count === 0;
          const intensity = Math.min(1, d.count / maxCount);
          const pnlHint = d.pnl >= 0 ? "text-emerald-400" : "text-red-400";
          return (
            <button
              key={d.hour}
              type="button"
              disabled={empty}
              className={btn(active, empty ? "opacity-40 cursor-not-allowed" : "")}
              onClick={() => onChange(d.hour)}
              title={`${d.count} trades · ${d.pnl >= 0 ? "+" : ""}$${d.pnl.toFixed(0)}`}
            >
              <div className="leading-tight">{String(d.hour).padStart(2, "0")}</div>
              <div className={`text-[9px] leading-tight ${empty ? "text-muted-foreground" : pnlHint}`}>
                {empty ? "—" : d.count}
              </div>
              {!empty && (
                <div
                  className="mt-0.5 h-0.5 rounded bg-primary/70"
                  style={{ width: `${Math.max(10, Math.round(intensity * 100))}%` }}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
