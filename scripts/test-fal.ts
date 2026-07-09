/* Teste pontual: valida a geração real de fundo no Flux (fal.ai).
 * Rode: npx tsx scripts/test-fal.ts
 */
import { falEnabled, generateImage } from '../src/config/fal.js';

async function main(): Promise<void> {
  if (!falEnabled()) {
    console.error('❌ FAL_API_KEY ausente no .env');
    process.exit(1);
  }

  const prompt =
    'professional automotive advertising photograph of a prata 2025 Volkswagen Nivus, ' +
    'parked in a premium modern setting, golden hour cinematic lighting, glossy reflections, ' +
    'shallow depth of field, photorealistic, ultra detailed, magazine-quality car commercial';

  console.log('⏳ Gerando fundo no Flux 1.1 Pro (1080x1350, FEED)...');
  const t0 = Date.now();
  const result = await generateImage({ prompt, width: 1080, height: 1350, outputFormat: 'jpeg' });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`✅ OK em ${secs}s`);
  console.log(`   url:  ${result.url}`);
  console.log(`   seed: ${result.seed ?? '(não retornado)'}`);
}

main().catch((err) => {
  console.error('❌ Falhou:', err instanceof Error ? err.message : err);
  // O client do fal anexa status/body ao erro — imprime tudo pra diagnóstico.
  const e = err as Record<string, unknown>;
  if (e && typeof e === 'object') {
    console.error('   status:', e.status ?? e.statusCode ?? '(n/d)');
    console.error('   body:', JSON.stringify(e.body ?? e.detail ?? e.response ?? {}, null, 2));
  }
  process.exit(1);
});
