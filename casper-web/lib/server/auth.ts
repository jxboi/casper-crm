import "server-only";

import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { Pool } from "pg";
import { attachDatabasePool } from "@vercel/functions";
import { newId } from "@casper/platform";
import { provisionInitialTenant } from "@casper/auth";

let authInstance: ReturnType<typeof createAuth> | undefined;
let authPool: Pool | undefined;

function createAuth() {
  const connectionString = process.env.DATABASE_URL;
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!connectionString) throw new Error("DATABASE_URL is required for authentication");
  if (!secret) throw new Error("BETTER_AUTH_SECRET is required for authentication");

  authPool ??= new Pool({ connectionString, max: 5 });
  attachDatabasePool(authPool);

  const github =
    process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
      ? {
          github: {
            clientId: process.env.GITHUB_CLIENT_ID,
            clientSecret: process.env.GITHUB_CLIENT_SECRET,
          },
        }
      : undefined;

  return betterAuth({
    database: authPool,
    secret,
    baseURL:
      process.env.BETTER_AUTH_URL ??
      (process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : undefined),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      autoSignIn: true,
    },
    socialProviders: github,
    user: {
      modelName: "users",
      fields: {
        emailVerified: "email_verified",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
      additionalFields: {
        orgName: {
          type: "string",
          required: false,
          fieldName: "org_name",
        },
        workspaceName: {
          type: "string",
          required: false,
          fieldName: "workspace_name",
        },
      },
    },
    session: {
      modelName: "auth_sessions",
      fields: {
        expiresAt: "expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
        ipAddress: "ip_address",
        userAgent: "user_agent",
        userId: "user_id",
      },
      cookieCache: { enabled: true, maxAge: 300 },
    },
    account: {
      modelName: "auth_accounts",
      fields: {
        accountId: "account_id",
        providerId: "provider_id",
        userId: "user_id",
        accessToken: "access_token",
        refreshToken: "refresh_token",
        idToken: "id_token",
        accessTokenExpiresAt: "access_token_expires_at",
        refreshTokenExpiresAt: "refresh_token_expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    verification: {
      modelName: "auth_verifications",
      fields: {
        expiresAt: "expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    advanced: {
      database: { generateId: () => newId() },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await provisionInitialTenant({
              userId: user.id,
              orgName: optionalString(user.orgName) || `${user.name}'s organization`,
              workspaceName: optionalString(user.workspaceName) || "Sales",
            });
          },
        },
      },
    },
    plugins: [nextCookies()],
  });
}

/** Build-safe lazy singleton: no database pool or auth SDK is initialized at import time. */
export function getAuth(): ReturnType<typeof createAuth> {
  authInstance ??= createAuth();
  return authInstance;
}

export type Auth = ReturnType<typeof createAuth>;

function optionalString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
