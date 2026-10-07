export function allowedWebOrigins(): string[] {
  const configured = [process.env.WEB_ORIGIN ?? 'http://localhost:5173', process.env.API_ORIGIN ?? 'http://localhost:3000'];
  const local = process.env.NODE_ENV === 'production' ? [] : ['http://127.0.0.1:5173', 'http://127.0.0.1:3000'];
  return [...new Set([...configured, ...local])];
}
