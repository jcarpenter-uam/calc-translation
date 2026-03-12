import { pgTable, text, uuid, unique } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// --- Tenants Table ---
export const tenants = pgTable("tenants", {
  tenantId: text("tenant_id").primaryKey(),
  organizationName: text("organization_name"),
});

// --- Tenant Domains Table ---
export const tenantDomains = pgTable("tenant_domains", {
  domain: text("domain").primaryKey(),
  tenantId: text("tenant_id").references(() => tenants.tenantId, {
    onDelete: "cascade",
  }),
  providerType: text("provider_type"),
});

// --- Tenant Auth Configs Table ---
export const tenantAuthConfigs = pgTable(
  "tenant_auth_configs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: text("tenant_id").references(() => tenants.tenantId, {
      onDelete: "cascade",
    }),
    providerType: text("provider_type").notNull(),
    clientId: text("client_id").notNull(),
    clientSecretEncrypted: text("client_secret_encrypted").notNull(),
    tenantHint: text("tenant_hint"),
  },
  (table) => {
    return {
      // Unique constraint on tenant_id and provider_type
      uqTenantProvider: unique("uq_tenant_provider").on(
        table.tenantId,
        table.providerType,
      ),
    };
  },
);

// --- Relations ---
export const tenantsRelations = relations(tenants, ({ many }) => ({
  domains: many(tenantDomains),
  authConfigs: many(tenantAuthConfigs),
}));

export const tenantDomainsRelations = relations(tenantDomains, ({ one }) => ({
  tenant: one(tenants, {
    fields: [tenantDomains.tenantId],
    references: [tenants.tenantId],
  }),
}));

export const tenantAuthConfigsRelations = relations(
  tenantAuthConfigs,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [tenantAuthConfigs.tenantId],
      references: [tenants.tenantId],
    }),
  }),
);
