import type { PlaygroundManifest } from "@casper/playground-kit";

async function loadManifest(): Promise<PlaygroundManifest> {
  if (process.env.PLAYGROUND_MODULE === "records") return (await import("@casper/records/playground")).playground;
  return (await import("@casper/auth/playground")).playground;
}

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const manifest = await loadManifest();
  const raw = await searchParams;
  const params = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));
  const selected = manifest.scenarios.find((item) => item.path === params.scenario) ?? manifest.scenarios[0]!;
  const Scenario = selected.component;
  return <main>
    <header><div className="status">Local PGlite only · never deployed</div><h1>{manifest.title}</h1>
      <nav>{manifest.scenarios.map((item) => <a key={item.path} href={`?scenario=${item.path}`}>{item.label}</a>)}</nav>
    </header>
    <Scenario searchParams={params} />
  </main>;
}
