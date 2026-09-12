import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";

const PUBLIC = [
  /^\/login(\/|$)/,
  /^\/signup(\/|$)/,
  /^\/forgot(\/|$)/,
  /^\/reset\//,
  /^\/invite\//,
  /^\/api\/auth/,
  /^\/manifest/,
  /^\/sw\.js$/,
  /^\/icons\//,
];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((re) => re.test(pathname))) return NextResponse.next();
  // Must match how next-auth's own signIn (lib/auth/config.ts, trustHost: true)
  // decides the cookie is secure: `x-forwarded-proto` (Next.js sets this from
  // the real connection even with no reverse proxy in front), not NODE_ENV --
  // a production build served over plain HTTP (e.g. behind a TLS-terminating
  // proxy) writes a non-secure cookie, so checking NODE_ENV here looked for
  // the wrong cookie name and silently treated every signed-in request as
  // signed out.
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(/:$/, "");
  const token = await getToken({
    req,
    secret: process.env.AUTH_SECRET!,
    secureCookie: proto === "https",
  });
  if (!token) {
    const url = new URL("/login", req.nextUrl);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
