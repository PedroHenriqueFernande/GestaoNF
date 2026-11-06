export function allowedWebOrigins(): string[] {
  const protocol = process.env.LOCAL_HTTPS_ENABLED === 'true' ? 'https' : 'http';
  const configured = [process.env.WEB_ORIGIN ?? `${protocol}://localhost:3001`, process.env.API_ORIGIN ?? `${protocol}://localhost:4030`];
  const local = process.env.NODE_ENV === 'production' ? [] : [
    `${protocol}://localhost:3001`, `${protocol}://localhost:4030`,
    `${protocol}://127.0.0.1:3001`, `${protocol}://127.0.0.1:4030`,
    `${protocol}://[::1]:3001`, `${protocol}://[::1]:4030`,
  ];
  return [...new Set([...configured, ...local])];
}
