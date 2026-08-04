import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Env mínimo para que src/config/env.ts valide ao importar os módulos.
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      REDIS_URL: 'redis://localhost:6379',
      ANTHROPIC_API_KEY: 'sk-ant-test',
      // FIXO, não herdado: sem isso o .env da máquina (ou o shell) escolheria o
      // provedor e os testes do caminho fal cairiam em outro SDK — discando
      // para a rede real com o mock do fal inútil.
      COPY_PROVIDER: 'fal',
      // ⚠️ FAL_API_KEY definida aqui vale para TODOS os arquivos de teste e faz
      // `falEnabled()` retornar true em qualquer um deles. Um teste futuro que
      // toque render.service.ts (fallback de storage) ou photos.routes.ts
      // (presign) tentaria upload REAL no fal se não mockar '@fal-ai/client'.
      FAL_API_KEY: 'fal-test',
    },
  },
});
