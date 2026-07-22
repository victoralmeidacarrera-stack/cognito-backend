/* Re-renderiza criativos FAILED (copy/fundo já existem; só o PNG falhou —
 * ex.: Chromium morto). Roda os processors inline, sem fila.
 * Rode: npx tsx scripts/re-render-failed.ts
 */
import { CreativeStatus, PrismaClient } from '@prisma/client';
import { type Job } from 'bullmq';
import { closeBrowser } from '../src/config/puppeteer.js';
import { processRenderImage } from '../src/workers/render-image.js';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const failed = await prisma.creative.findMany({
    where: { status: CreativeStatus.FAILED },
    select: { id: true, organizationId: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`${failed.length} criativo(s) FAILED para re-renderizar`);

  let ok = 0;
  for (const c of failed) {
    try {
      await processRenderImage({
        data: { organizationId: c.organizationId, creativeId: c.id },
      } as Job);
      ok += 1;
      console.log(`✔ ${c.id}`);
    } catch (err) {
      console.warn(`✗ ${c.id}: ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(`\n${ok}/${failed.length} re-renderizados`);
}

main()
  .catch((err) => {
    console.error('falhou:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeBrowser();
    await prisma.$disconnect();
  });
