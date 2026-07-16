import { type Vehicle } from '@prisma/client';
import { env } from '../../config/env.js';

/**
 * ════════════════════════════════════════════════════════════════════
 *  PROMPT DO FUNDO (fal.ai Flux 1.1 Pro) — edite AQUI.
 * ════════════════════════════════════════════════════════════════════
 *
 * Este arquivo é a ÚNICA fonte do prompt que o app manda pro Flux gerar o
 * fundo do criativo. Três formas de mudar, da mais rápida à mais permanente:
 *
 *   1. `.env` → FLUX_BACKGROUND_PROMPT=...   (vence tudo; sem deploy)
 *      Use {vehicle} onde quiser a descrição do veículo (ex.: "prata 2025
 *      Volkswagen Nivus Highline"). Sem {vehicle}, o texto vai literal.
 *   2. Editar as constantes DEFAULT_* abaixo.
 *   3. (futuro) prompt por organização, persistido no banco.
 *
 * IMPORTANTE — lugar do Flux no pipeline (backgrounds.service.ts):
 *   1º foto REAL do veículo no banco do cliente (Photo) — prioridade absoluta;
 *   2º Flux (este prompt) — só quando o veículo NÃO tem foto;
 *   3º cor sólida da marca — se o Flux falhar/faltar saldo.
 * Ou seja: com a automação de fotos reais alimentando o banco, este prompt
 * vira só o plano B. Se quiser que o Flux gere uma CENA VAZIA (sem carro,
 * para compor a foto real por cima), troque o prompt com veículo por algo
 * como o DEFAULT_SCENE_PROMPT (sem descrever o carro).
 *
 * Regra de ouro: NUNCA peça texto na imagem — o texto (headline/preço/CTA)
 * é sempre composto por cima no HTML. Um sufixo anti-texto é anexado
 * automaticamente em config/fal.ts.
 */

/** Prompt quando o briefing TEM veículo (o Flux desenha o carro na cena). */
export const DEFAULT_VEHICLE_PROMPT =
  'professional automotive advertising photograph of a {vehicle}, ' +
  'parked in a premium modern setting, golden hour cinematic lighting, ' +
  'glossy reflections, shallow depth of field, photorealistic, ultra detailed, ' +
  'magazine-quality car commercial';

/** Prompt quando NÃO há veículo no briefing (cena de showroom, sem carro). */
export const DEFAULT_SCENE_PROMPT =
  'professional automotive advertising scene, modern car dealership showroom, ' +
  'soft cinematic lighting, premium and aspirational mood, photorealistic, high detail';

/** Descrição curta do veículo usada no lugar do placeholder {vehicle}. */
export function describeVehicle(vehicle: Vehicle): string {
  return [vehicle.color, String(vehicle.year), vehicle.make, vehicle.model, vehicle.trim]
    .filter(Boolean)
    .join(' ');
}

/**
 * Monta o prompt final do fundo. Precedência:
 * FLUX_BACKGROUND_PROMPT (env, com {vehicle}) > DEFAULT_VEHICLE_PROMPT /
 * DEFAULT_SCENE_PROMPT conforme haja veículo.
 */
export function buildBackgroundPrompt(vehicle: Vehicle | null): string {
  const vehicleText = vehicle ? describeVehicle(vehicle) : '';

  if (env.FLUX_BACKGROUND_PROMPT) {
    return env.FLUX_BACKGROUND_PROMPT.replaceAll('{vehicle}', vehicleText);
  }

  if (!vehicle) return DEFAULT_SCENE_PROMPT;
  return DEFAULT_VEHICLE_PROMPT.replaceAll('{vehicle}', vehicleText);
}
