import { AuthForm } from "@/components/auth-form";

export default function SignInPage() {
  return <AuthForm mode="sign-in" githubEnabled={Boolean(process.env.GITHUB_CLIENT_ID)} />;
}
