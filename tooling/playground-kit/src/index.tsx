import type { ReactNode } from "react";

export interface PlaygroundScenarioProps {
  searchParams: Record<string, string | undefined>;
}

export interface PlaygroundManifest {
  title: string;
  scenarios: Array<{
    path: string;
    label: string;
    component: (props: PlaygroundScenarioProps) => ReactNode | Promise<ReactNode>;
  }>;
}

export function JsonViewer({ value }: { value: unknown }) {
  return <pre className="json">{JSON.stringify(value, null, 2)}</pre>;
}
