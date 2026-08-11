import { Hono } from "hono";
import type { ApiHealth } from "@jingshu/contracts";
import type { PublicSandboxDatabase } from "@jingshu/database";

import { registerPublicSandboxRoutes } from "./public-sandbox-routes.js";
import { registerRoleAccessRoutes } from "./role-access-routes.js";
import { registerRoleContextRoutes } from "./role-context-routes.js";
import type { AppServices } from "./route-support.js";
import { registerDemoToolsRoutes } from "./demo-tools-routes.js";
import { registerCustomerSeatBrowseRoutes } from "./customer-seat-browse-routes.js";
import { registerCustomerMembershipRoutes } from "./customer-membership-routes.js";
import { registerCustomerOrderRoutes } from "./customer-order-routes.js";
import { registerStaffReservationRoutes } from "./staff-reservation-routes.js";
import { registerStaffShiftRoutes } from "./staff-shift-routes.js";
import { registerStaffHandoverRoutes } from "./staff-handover-routes.js";
import { registerStaffOrderRoutes } from "./staff-order-routes.js";
import { registerManagerInventoryRoutes } from "./manager-inventory-routes.js";
import { registerManagerStoreConfigurationRoutes } from "./manager-store-configuration-routes.js";
import { registerManagerPeopleScheduleRoutes } from "./manager-people-schedule-routes.js";
import { registerRepairIntakeRoutes } from "./repair-intake-routes.js";
import type { RepairImageStorage } from "./repair-image-storage.js";

interface AppOptions {
  allowedOrigins?: ReadonlyArray<string>;
  sandboxDatabase?: PublicSandboxDatabase;
  repairImageSigningSecret?: string;
  repairImageStorage?: RepairImageStorage;
  sessionSecret?: string;
  secureCookies?: boolean;
  wallClock?: { now(): Date };
}

export function createApp(options: AppOptions = {}) {
  const app = new Hono();
  const services: AppServices = {
    allowedOrigins: new Set(
      options.allowedOrigins ?? [
        "http://127.0.0.1:3000",
        "http://localhost:3000",
      ],
    ),
    ...(options.sandboxDatabase
      ? { sandboxDatabase: options.sandboxDatabase }
      : {}),
    secureCookies:
      options.secureCookies ?? process.env.NODE_ENV === "production",
    ...(options.repairImageSigningSecret
      ? { repairImageSigningSecret: options.repairImageSigningSecret }
      : {}),
    ...(options.repairImageStorage
      ? { repairImageStorage: options.repairImageStorage }
      : {}),
    ...(options.sessionSecret ? { sessionSecret: options.sessionSecret } : {}),
    wallClock: options.wallClock ?? { now: () => new Date() },
  };

  app.get("/api/v1/health", (context) =>
    context.json({
      service: "jingshu-api",
      status: "ready",
    } satisfies ApiHealth),
  );
  registerRoleContextRoutes(app, services);
  registerRoleAccessRoutes(app, services);
  registerDemoToolsRoutes(app, services);
  registerCustomerSeatBrowseRoutes(app, services);
  registerCustomerMembershipRoutes(app, services);
  registerCustomerOrderRoutes(app, services);
  registerStaffReservationRoutes(app, services);
  registerStaffShiftRoutes(app, services);
  registerStaffHandoverRoutes(app, services);
  registerStaffOrderRoutes(app, services);
  registerManagerInventoryRoutes(app, services);
  registerManagerStoreConfigurationRoutes(app, services);
  registerManagerPeopleScheduleRoutes(app, services);
  registerRepairIntakeRoutes(app, services);
  registerPublicSandboxRoutes(app, services);

  return app;
}

export const app = createApp();
