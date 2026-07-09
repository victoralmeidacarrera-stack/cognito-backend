/* Postgres local de desenvolvimento SEM Docker (embedded-postgres).
 * Sobe um Postgres real em localhost:5432 com dados em .local/pgdata
 * (gitignored) e fica vivo até Ctrl+C.
 *
 * 1ª vez:  npm i --no-save embedded-postgres   (baixa o binário do PG)
 * Rodar:   npm run dev:db
 * .env:    DATABASE_URL=postgresql://cognito:cognito@localhost:5432/cognito?schema=public
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let EmbeddedPostgres;
try {
  ({ default: EmbeddedPostgres } = await import('embedded-postgres'));
} catch {
  console.error(
    '\n❌ embedded-postgres não está instalado.\n' +
      '   Rode uma vez:  npm i --no-save embedded-postgres\n',
  );
  process.exit(1);
}

const databaseDir = join(root, '.local', 'pgdata');
const firstBoot = !existsSync(databaseDir);

const pg = new EmbeddedPostgres({
  databaseDir,
  user: 'cognito',
  password: 'cognito',
  port: 5432,
  persistent: true,
  // UTF-8 forçado: sem isso o initdb no Windows usa WIN1252 e emoji quebra.
  initdbFlags: ['--encoding=UTF8', '--no-locale'],
});

try {
  if (firstBoot) {
    console.log('[db] primeira vez: initdb em .local/pgdata ...');
    await pg.initialise();
  }
  await pg.start();
  try {
    await pg.createDatabase('cognito');
    console.log('[db] database "cognito" criada');
  } catch {
    console.log('[db] database "cognito" já existe');
  }
  console.log(
    '\n✅ Postgres pronto: postgresql://cognito:cognito@localhost:5432/cognito' +
      '\n   (deixe este terminal aberto; Ctrl+C para parar)\n',
  );
} catch (err) {
  console.error('[db] falhou:', err instanceof Error ? err.message : err);
  process.exit(1);
}

process.stdin.resume();
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    try {
      await pg.stop();
    } catch {
      /* já parado */
    }
    process.exit(0);
  });
}
