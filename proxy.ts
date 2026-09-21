import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { corsHeaders, corsOrigin } from "@/lib/cors";

function apiBase(): string {
  if (process.env.RAILWAY_ENVIRONMENT) return "";
  return (
    process.env.API_REWRITE_URL?.trim() ||
    process.env.API_INTERNAL_URL?.trim() ||
    ""
  ).replace(/\/$/, "");
}

export function proxy(request: NextRequest) {
  const base = apiBase();
  if (base && request.nextUrl.pathname.startsWith("/api/")) {
    const destination = new URL(
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
      base,
    );
    const headers = new Headers(request.headers);
    const host =
      request.headers.get("x-forwarded-host") || request.headers.get("host") || "";
    if (host) headers.set("x-forwarded-host", host);
    headers.set("x-forwarded-proto", "https");
    return NextResponse.rewrite(destination, { request: { headers } });
  }

  const origin = corsOrigin(request.headers.get("origin"));
  if (request.method === "OPTIONS") {
    return new NextResponse(null, {
      status: 204,
      headers: origin ? corsHeaders(origin) : undefined,
    });
  }
  const response = NextResponse.next();
  if (origin) {
    for (const [key, value] of Object.entries(corsHeaders(origin))) {
      response.headers.set(key, value);
    }
  }
  return response;
}

export const config = {
  matcher: "/api/:path*",
};
