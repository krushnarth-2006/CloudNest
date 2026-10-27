import type { Metric } from "@workspace/api-client-react";
import { buildFileComposition } from "../lib/mimeDisplay";

const COLORS = ["#2ea6b1", "#5576c5", "#e59b2f", "#7f9bb5", "#e56a59", "#8b6fc0"];
const numberFormat = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });

export function FileComposition({ metrics = [] }: { metrics?: Metric[] }) {
  const items = buildFileComposition(metrics);
  const total = items.reduce((sum, item) => sum + item.value, 0);

  return (
    <section className="cn-card min-w-0 rounded-xl p-5" aria-labelledby="file-composition-title">
      <h2 id="file-composition-title" className="text-sm font-semibold">File composition</h2>
      <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">What your workspace holds</p>
      {total === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-[hsl(var(--border))] px-4 py-7 text-center">
          <p className="text-sm font-medium">No files indexed yet</p>
          <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Connect a provider or sync files to see their composition.</p>
        </div>
      ) : (
        <>
          <div
            className="mt-6 flex h-3 w-full overflow-hidden rounded-full bg-[hsl(var(--muted))]"
            role="img"
            aria-label={`File type distribution across ${total} files`}
          >
            {items.map((item) => (
              <span
                key={item.label}
                className="h-full min-w-0"
                title={`${item.label}: ${numberFormat.format((item.value / total) * 100)}%`}
                style={{ width: `${(item.value / total) * 100}%`, backgroundColor: COLORS[item.colorIndex % COLORS.length] }}
              />
            ))}
          </div>
          <ul className="mt-5 grid min-w-0 grid-cols-1 gap-x-5 gap-y-3 sm:grid-cols-2" aria-label="File types">
            {items.map((item) => {
              const percentage = (item.value / total) * 100;
              return (
                <li key={item.label} className="flex min-w-0 items-center gap-2 text-xs">
                  <i
                    className="size-2 shrink-0 rounded-full"
                    aria-hidden="true"
                    style={{ backgroundColor: COLORS[item.colorIndex % COLORS.length] }}
                  />
                  <span className="min-w-0 flex-1 truncate text-[hsl(var(--muted-foreground))]" title={item.label}>
                    {item.label}
                  </span>
                  <span className="cn-mono w-12 shrink-0 text-right text-[10px] text-[hsl(var(--foreground))]">
                    {numberFormat.format(percentage)}%
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
