import { defineConfig } from 'vitest/config';

// Os testes de integração criam e apagam bancos temporários; com a suíte em paralelo o DROP DATABASE passa de 10 s.
export default defineConfig({ test: { hookTimeout: 60_000 } });
