import { pgTable, text, uuid, unique } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

/**
 * Tenants table schema.
 */
export const tenants = pgTable("tenants", {
  tenantId: text("tenant_id").primaryKey(),
  organizationName: text("organization_name"),
});

/**
 * Domain-to-tenant SSO routing table schema.
 */
export const tenantDomains = pgTable(
  "tenant_domains",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    domain: text("domain").notNull(),
    tenantId: text("tenant_id").references(() => tenants.tenantId, {
      onDelete: "cascade",
    }),
    providerType: text("provider_type").notNull(),
  },
  (table) => ({
    uqTenantDomainProvider: unique("uq_tenant_domain_provider").on(
      table.tenantId,
      table.domain,
      table.providerType,
    ),
  }),
);

/**
 * Per-tenant OAuth provider configuration schema.
 */
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
      uqTenantProvider: unique("uq_tenant_provider").on(
        table.tenantId,
        table.providerType,
      ),
    };
  },
);

/**
 * Tenant relation mapping.
 */
export const tenantsRelations = relations(tenants, ({ many }) => ({
  domains: many(tenantDomains),
  authConfigs: many(tenantAuthConfigs),
}));

/**
 * Tenant domain relation mapping.
 */
export const tenantDomainsRelations = relations(tenantDomains, ({ one }) => ({
  tenant: one(tenants, {
    fields: [tenantDomains.tenantId],
    references: [tenants.tenantId],
  }),
}));

/**
 * Tenant auth config relation mapping.
 */
export const tenantAuthConfigsRelations = relations(
  tenantAuthConfigs,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [tenantAuthConfigs.tenantId],
      references: [tenants.tenantId],
    }),
  }),
);
