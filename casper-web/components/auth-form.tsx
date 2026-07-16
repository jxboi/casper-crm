"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export function AuthForm({
  mode,
  githubEnabled,
}: {
  mode: "sign-in" | "sign-up";
  githubEnabled: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(formData: FormData) {
    setPending(true);
    setError(null);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const result =
      mode === "sign-up"
        ? await authClient.signUp.email({
            email,
            password,
            name: String(formData.get("name") ?? "").trim(),
            orgName: String(formData.get("orgName") ?? "").trim(),
            workspaceName: String(formData.get("workspaceName") ?? "Sales").trim(),
          })
        : await authClient.signIn.email({ email, password });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? "Authentication failed");
      return;
    }
    router.push("/pipeline");
    router.refresh();
  }

  async function github() {
    setPending(true);
    setError(null);
    const result = await authClient.signIn.social({ provider: "github", callbackURL: "/pipeline" });
    if (result.error) {
      setPending(false);
      setError(result.error.message ?? "GitHub sign-in is unavailable");
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-5 py-10">
      <section className="w-full max-w-md rounded-xl border border-line bg-panel p-7 shadow-2xl">
        <div className="mb-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">Casper CRM</p>
          <h1 className="mt-2 font-display text-2xl font-semibold text-ink">
            {mode === "sign-up" ? "Create your workspace" : "Welcome back"}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {mode === "sign-up"
              ? "Your organization starts isolated from every other tenant."
              : "Sign in to continue to your pipeline."}
          </p>
        </div>

        <form action={submit} className="space-y-4">
          {mode === "sign-up" && (
            <>
              <Field name="name" label="Your name" autoComplete="name" required />
              <Field name="orgName" label="Organization" autoComplete="organization" required />
              <Field name="workspaceName" label="Workspace" defaultValue="Sales" required />
            </>
          )}
          <Field name="email" label="Email" type="email" autoComplete="email" required />
          <Field
            name="password"
            label="Password"
            type="password"
            autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
            minLength={10}
            required
          />
          {error && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink disabled:opacity-50"
          >
            {pending ? "Working…" : mode === "sign-up" ? "Create organization" : "Sign in"}
          </button>
        </form>

        {githubEnabled && (
          <>
            <div className="my-5 flex items-center gap-3 text-xs text-faint">
              <span className="h-px flex-1 bg-line" />or<span className="h-px flex-1 bg-line" />
            </div>
            <button
              type="button"
              disabled={pending}
              onClick={() => void github()}
              className="w-full rounded-md border border-line px-4 py-2.5 text-sm font-medium text-ink hover:border-accent disabled:opacity-50"
            >
              Continue with GitHub
            </button>
          </>
        )}
        <p className="mt-5 text-center text-sm text-muted">
          {mode === "sign-up" ? "Already have an account? " : "New to Casper? "}
          <Link className="font-medium text-accent" href={mode === "sign-up" ? "/sign-in" : "/sign-up"}>
            {mode === "sign-up" ? "Sign in" : "Create an organization"}
          </Link>
        </p>
      </section>
    </main>
  );
}

function Field(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string; name: string }) {
  const { label, ...input } = props;
  return (
    <label className="block text-sm text-muted">
      <span className="mb-1.5 block">{label}</span>
      <input
        {...input}
        className="w-full rounded-md border border-line bg-panel-2 px-3 py-2.5 text-ink outline-none focus:border-accent"
      />
    </label>
  );
}
