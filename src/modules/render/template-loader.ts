import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import Handlebars from 'handlebars';
import { type CreativeFormat } from '@prisma/client';
import { NotFoundError } from '../../shared/errors.js';

const TEMPLATES_DIR = join(process.cwd(), 'templates');

const compiledCache = new Map<string, HandlebarsTemplateDelegate>();
let partialsRegistered = false;

async function registerPartials(): Promise<void> {
  if (partialsRegistered) return;
  const dir = join(TEMPLATES_DIR, 'partials');
  const files = await readdir(dir);
  await Promise.all(
    files
      .filter((file) => file.endsWith('.hbs'))
      .map(async (file) => {
        const name = basename(file, '.hbs');
        const content = await readFile(join(dir, file), 'utf8');
        Handlebars.registerPartial(name, content);
      }),
  );
  partialsRegistered = true;
}

/** Compila (e cacheia) o template de um formato/slug. */
export async function loadTemplate(
  format: CreativeFormat,
  slug: string,
): Promise<HandlebarsTemplateDelegate> {
  const cacheKey = `${format}/${slug}`;
  const cached = compiledCache.get(cacheKey);
  if (cached) return cached;

  await registerPartials();

  const path = join(TEMPLATES_DIR, format.toLowerCase(), `${slug}.hbs`);
  let source: string;
  try {
    source = await readFile(path, 'utf8');
  } catch {
    throw new NotFoundError(`Template ${cacheKey}`);
  }

  const compiled = Handlebars.compile(source);
  compiledCache.set(cacheKey, compiled);
  return compiled;
}
