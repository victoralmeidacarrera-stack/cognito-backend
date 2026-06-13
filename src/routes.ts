import { type FastifyInstance } from 'fastify';
import { authenticate } from './modules/auth/auth.middleware.js';
import { registerClerkWebhook } from './modules/auth/webhook.routes.js';
import { registerBrandBookRoutes } from './modules/brand-books/brand-books.routes.js';
import { registerVehicleRoutes } from './modules/vehicles/vehicles.routes.js';
import { registerPhotoRoutes } from './modules/photos/photos.routes.js';
import { registerCampaignRoutes } from './modules/campaigns/campaigns.routes.js';
import { registerTemplateRoutes } from './modules/templates/templates.routes.js';
import { registerBriefingRoutes } from './modules/briefings/briefings.routes.js';
import { registerCreativeRoutes } from './modules/creatives/creatives.routes.js';
import { registerApprovalRoutes } from './modules/approvals/approvals.routes.js';
import { registerUsageRoutes } from './modules/usage/usage.routes.js';
import { registerMeRoutes } from './modules/me/me.routes.js';

/** Registra webhooks (públicos) e a API v1 (autenticada). */
export async function registerRoutes(app: FastifyInstance): Promise<void> {
  // Webhooks: sem auth, body cru (verificação por assinatura).
  registerClerkWebhook(app);

  // API v1: tudo atrás do preHandler de autenticação (popula ctx + tenant db).
  await app.register(
    (api, _opts, done) => {
      api.addHook('preHandler', authenticate);

      registerMeRoutes(api);
      registerBrandBookRoutes(api);
      registerVehicleRoutes(api);
      registerPhotoRoutes(api);
      registerCampaignRoutes(api);
      registerTemplateRoutes(api);
      registerBriefingRoutes(api);
      registerCreativeRoutes(api);
      registerApprovalRoutes(api);
      registerUsageRoutes(api);

      done();
    },
    { prefix: '/api/v1' },
  );
}
