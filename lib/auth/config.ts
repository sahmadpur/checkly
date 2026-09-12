import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { db } from "@/lib/db";
import { authenticate } from "@/lib/services/auth";

const credentialsSchema = z.object({ identifier: z.string().min(1), password: z.string().min(1) });

async function firstOrgId(userId: string) {
  const m = await db.orgMember.findFirst({ where: { userId }, orderBy: { createdAt: "asc" }, select: { orgId: true } });
  return m?.orgId ?? null;
}

export const { handlers, auth, signIn, signOut, unstable_update } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  // Self-hosted behind a reverse proxy (Docker/standalone): trust the Host
  // header instead of rejecting it, or auth() returns null for every request.
  trustHost: true,
  providers: [
    Credentials({
      credentials: { identifier: {}, password: {} },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const user = await authenticate(parsed.data.identifier, parsed.data.password);
        return user ? { id: user.id, name: user.name } : null;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.userId = user.id;
        token.name = user.name;
        token.activeOrgId = await firstOrgId(user.id);
      }
      if (trigger === "update" && session?.activeOrgId) {
        const ok = await db.orgMember.findUnique({
          where: { orgId_userId: { orgId: session.activeOrgId, userId: token.userId } },
        });
        if (ok) token.activeOrgId = session.activeOrgId;
      }
      if (trigger === "update" && session?.name) token.name = session.name;
      return token;
    },
    async session({ session, token }) {
      session.user = { ...session.user, id: token.userId, name: token.name };
      session.activeOrgId = token.activeOrgId ?? null;
      return session;
    },
  },
});
