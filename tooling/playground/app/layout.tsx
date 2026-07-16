import "./style.css";

export const metadata = { title: "Casper module playground" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
