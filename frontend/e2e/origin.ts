export const localWebOrigin = new URL(process.env.E2E_BASE_URL || `${process.env.LOCAL_HTTPS_ENABLED === 'true' ? 'https' : 'http'}://127.0.0.1:3001`).origin;
