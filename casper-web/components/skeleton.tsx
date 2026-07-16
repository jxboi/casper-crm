/** Shimmer placeholders shown while a view loads from the engine (see .skeleton in globals.css). */

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`skeleton ${className}`} />;
}

/** Placeholder rows matching the list-view tables; widths vary so it reads as content, not stripes. */
export function TableSkeletonRows({ rows = 5, cols }: { rows?: number; cols: number }) {
  const widths = ["w-40", "w-28", "w-20", "w-24", "w-16", "w-24", "w-16"];
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} className="border-b border-line last:border-b-0">
          {Array.from({ length: cols }, (_, c) => (
            <td key={c} className="px-4 py-3">
              <Skeleton className={`h-3.5 ${widths[(r + c) % widths.length]}`} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** Placeholder board for the pipeline while stages + deals load. */
export function BoardSkeleton() {
  return (
    <div className="flex h-full min-w-max gap-3" aria-hidden>
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="flex w-64 flex-none flex-col gap-2 rounded-xl border border-line bg-panel-2/40 p-2">
          <div className="flex items-center gap-1.5 px-1 pt-1">
            <Skeleton className="size-2 rounded-full" />
            <Skeleton className="h-3.5 w-20" />
          </div>
          {Array.from({ length: i === 0 || i === 3 ? 2 : 1 }, (_, j) => (
            <div key={j} className="rounded-lg border border-line bg-panel p-3 shadow-card">
              <Skeleton className="h-3.5 w-36" />
              <Skeleton className="mt-1.5 h-3 w-24" />
              <div className="mt-3 flex items-center justify-between">
                <Skeleton className="h-3.5 w-16" />
                <Skeleton className="size-5 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
