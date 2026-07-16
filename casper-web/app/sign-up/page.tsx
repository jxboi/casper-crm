import { AuthForm } from "@/components/auth-form";

export default function SignUpPage() {
  return <AuthForm mode="sign-up" githubEnabled={Boolean(process.env.GITHUB_CLIENT_ID)} />;
}
