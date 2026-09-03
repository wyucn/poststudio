export function publicAppUrl(): string {
  return (process.env.APP_PUBLIC_URL || process.env.AUTH_URL || "http://localhost:3000")
    .trim()
    .replace(/\/$/u, "");
}
