const LOCAL_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

export function allowedOrigins(): string[] {
  const configured = process.env.FRONTEND_ORIGIN?.trim();
  const origins = new Set(LOCAL_ORIGINS);
  if (configured) origins.add(configured.replace(/\/$/, ""));
  origins.add("https://astronotes.ai");
  origins.add("https://www.astronotes.ai");
  return [...origins];
}

export function corsOrigin(requestOrigin: string | null): string | null {
  if (!requestOrigin) return null;
  const normalized = requestOrigin.replace(/\/$/, "");
  return allowedOrigins().includes(normalized) ? normalized : null;
}

export function applyCors(request: Request, headers: Headers) {
  const origin = corsOrigin(request.headers.get("origin"));
  if (!origin) return headers;
  for (const [key, value] of Object.entries(corsHeaders(origin))) {
    headers.set(key, value);
  }
  return headers;
}

export function corsHeaders(origin: string): HeadersInit {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    Vary: "Origin",
  };
}
