export function PageHeader({
  kicker,
  title,
  children,
}: {
  kicker: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 px-6 pb-4 pt-6">
      <div className="flex flex-col gap-1">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-faint">{kicker}</span>
        <h1 className="font-display text-[22px] font-semibold tracking-tight">{title}</h1>
      </div>
      {children}
    </div>
  );
}
