import { DEMO_NOW, daysBetween } from "@/lib/pipeline";

const sgd = new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD", maximumFractionDigits: 0 });
const usd = new Intl.NumberFormat("en-SG", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** amount is integer minor units (D-012) */
export function money(amount: number | null, currency: "SGD" | "USD"): string {
  if (amount === null) return "—";
  return (currency === "SGD" ? sgd : usd).format(amount / 100);
}

export function dateShort(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-SG", { day: "2-digit", month: "short" });
}

export function relDays(iso: string): string {
  const d = daysBetween(iso, DEMO_NOW);
  if (d <= 0) return "today";
  if (d === 1) return "1d ago";
  return `${d}d ago`;
}

export function dueLabel(iso: string): { text: string; overdue: boolean } {
  const overdue = new Date(iso) < DEMO_NOW;
  return { text: dateShort(iso), overdue };
}
