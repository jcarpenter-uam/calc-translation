import React, { useState, useEffect } from "react";
import {
  FaEdit,
  FaTrash,
  FaSave,
  FaTimes,
  FaPlus,
  FaMicrosoft,
  FaGoogle,
  FaCheckCircle,
  FaExclamationCircle,
  FaLink,
  FaUnlink,
} from "react-icons/fa";
import { useTranslation } from "react-i18next";
import {
  AdminActionButton,
  AdminCard,
  AdminDangerTextButton,
  AdminIconButton,
  AdminSection,
} from "./ui.jsx";

/**
 * Helper to ensure we always work with domain objects { domain: "...", provider: "..." }
 */
const normalizeDomains = (domains) => {
  if (!Array.isArray(domains)) return [];
  return domains.map((d) => {
    if (typeof d === "string") return { domain: d, provider: null };
    return d;
  });
};

/**
 * Form to create a new tenant.
 */
function CreateTenantForm({ onCreate }) {
  const { t } = useTranslation();
  const [formData, setFormData] = useState({
    tenant_id: "",
    domains: "",
    client_id: "",
    client_secret: "",
    organization_name: "",
    provider_type: "microsoft",
  });

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    const rawDomains = formData.domains
      .split(",")
      .map((d) => d.trim())
      .filter((d) => d.length > 0);

    const domainObjects = rawDomains.map((d) => ({
      domain: d,
      provider: formData.provider_type,
    }));

    onCreate({
      ...formData,
      domains: domainObjects,
    });

    setFormData({
      tenant_id: "",
      domains: "",
      client_id: "",
      client_secret: "",
      organization_name: "",
      provider_type: "microsoft",
    });
  };

  return (
    <AdminCard className="p-4 bg-white dark:bg-zinc-800 mb-6">
      <form
        onSubmit={handleSubmit}
        className="grid grid-cols-1 md:grid-cols-2 gap-4"
      >
        <h3 className="text-lg font-semibold col-span-1 md:col-span-2">
          {t("tenant_create_title")}
        </h3>

        <div className="col-span-1 md:col-span-2">
          <label className="block text-xs font-semibold text-zinc-500 mb-1">
            {t("org_name_placeholder")}
          </label>
          <input
            name="organization_name"
            value={formData.organization_name}
            onChange={handleChange}
            required
            className="w-full px-3 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-zinc-500 mb-1">
            {t("tenant_primary_provider")}
          </label>
          <select
            name="provider_type"
            value={formData.provider_type}
            onChange={handleChange}
            className="cursor-pointer w-full px-3 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="microsoft">{t("provider_microsoft_full")}</option>
            <option value="google">{t("provider_google_full")}</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-zinc-500 mb-1">
            {formData.provider_type === "microsoft"
              ? t("tenant_entra_id_label")
              : t("tenant_google_id_label")}
          </label>
          <input
            name="tenant_id"
            value={formData.tenant_id}
            onChange={handleChange}
            required
            className="w-full px-3 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-zinc-500 mb-1">
            {t("client_id_placeholder")}
          </label>
          <input
            name="client_id"
            value={formData.client_id}
            onChange={handleChange}
            required
            className="w-full px-3 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-zinc-500 mb-1">
            {t("client_secret_placeholder")}
          </label>
          <input
            name="client_secret"
            type="password"
            value={formData.client_secret}
            onChange={handleChange}
            required
            className="w-full px-3 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="col-span-1 md:col-span-2">
          <label className="block text-xs font-semibold text-zinc-500 mb-1">
            {t("domains_placeholder_hint")}
          </label>
          <input
            name="domains"
            value={formData.domains}
            onChange={handleChange}
            placeholder="example.com, myorg.com"
            required
            className="w-full px-3 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-[10px] text-zinc-400 mt-1">
            {t("tenant_create_domain_hint")}
          </p>
        </div>

        <button
          type="submit"
          className="mt-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 cursor-pointer col-span-1 md:col-span-2"
        >
          <FaPlus /> {t("create_tenant_btn")}
        </button>
      </form>
    </AdminCard>
  );
}

/**
 * Component to manage the list of domains for a tenant in Edit mode.
 */
function DomainEditor({ domains, onChange }) {
  const { t } = useTranslation();
  const [newDomain, setNewDomain] = useState("");

  const handleAdd = () => {
    const d = newDomain.trim();
    if (!d) return;
    if (domains.some((item) => item.domain === d)) {
      alert(t("tenant_domain_exists"));
      return;
    }
    onChange([...domains, { domain: d, provider: null }]);
    setNewDomain("");
  };

  const handleDelete = (idx) => {
    const next = [...domains];
    next.splice(idx, 1);
    onChange(next);
  };

  const handleToggleProvider = (idx, currentProvider) => {
    const next = [...domains];
    let nextProvider = null;
    if (!currentProvider) nextProvider = "microsoft";
    else if (currentProvider === "microsoft") nextProvider = "google";
    else nextProvider = null;

    next[idx] = { ...next[idx], provider: nextProvider };
    onChange(next);
  };

  return (
    <div className="border border-zinc-200 dark:border-zinc-600 rounded-md p-3 bg-zinc-50 dark:bg-zinc-700/30">
      <label className="block text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-2">
        {t("tenant_associated_domains")}
      </label>

      <div className="flex gap-2 mb-3">
        <input
          value={newDomain}
          onChange={(e) => setNewDomain(e.target.value)}
          onKeyDown={(e) =>
            e.key === "Enter" && (e.preventDefault(), handleAdd())
          }
          placeholder={t("tenant_add_domain_placeholder")}
          className="flex-1 px-2 py-1 text-sm bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="button"
          onClick={handleAdd}
          className="cursor-pointer px-3 py-1 bg-zinc-200 dark:bg-zinc-600 hover:bg-zinc-300 dark:hover:bg-zinc-500 text-zinc-700 dark:text-zinc-200 rounded text-sm transition-colors"
        >
          {t("add_btn")}
        </button>
      </div>

      <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
        {domains.map((item, idx) => (
          <div
            key={idx}
            className="flex items-center justify-between bg-white dark:bg-zinc-700 px-3 py-2 rounded border border-zinc-200 dark:border-zinc-600"
          >
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200 truncate">
              {item.domain}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleToggleProvider(idx, item.provider)}
                className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs border transition-colors cursor-pointer ${
                  item.provider === "microsoft"
                    ? "bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/30 dark:border-blue-800 dark:text-blue-300"
                    : item.provider === "google"
                      ? "bg-red-50 border-red-200 text-red-700 dark:bg-red-900/30 dark:border-red-800 dark:text-red-300"
                      : "bg-zinc-100 border-zinc-200 text-zinc-500 dark:bg-zinc-600 dark:border-zinc-500 dark:text-zinc-400"
                }`}
                title={t("tenant_toggle_pinning")}
              >
                {item.provider === "microsoft" && <FaMicrosoft />}
                {item.provider === "google" && <FaGoogle />}
                {!item.provider && <FaUnlink />}
                {item.provider ? t("tenant_pinned") : t("tenant_any")}
              </button>
              <button
                type="button"
                onClick={() => handleDelete(idx)}
                className="text-zinc-400 hover:text-red-500 transition-colors p-1 cursor-pointer"
                title={t("tenant_remove_domain")}
              >
                <FaTimes />
              </button>
            </div>
          </div>
        ))}
        {domains.length === 0 && (
          <div className="text-center text-xs text-zinc-400 py-2">
            {t("tenant_no_domains")}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * A row that supports editing multiple providers (Microsoft & Google) for a single tenant.
 */
function TenantRow({ tenant, onUpdate, onDelete, onRefresh }) {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [activeTab, setActiveTab] = useState("microsoft");

  const authMethods = tenant.auth_methods || {};
  const msConfig = authMethods.microsoft || {};
  const googleConfig = authMethods.google || {};

  const [domainObjects, setDomainObjects] = useState([]);

  useEffect(() => {
    setDomainObjects(normalizeDomains(tenant.domains));
  }, [tenant.domains]);

  const [formData, setFormData] = useState({
    organization_name: tenant.organization_name || "",

    // Microsoft
    microsoft_client_id: msConfig.client_id || "",
    microsoft_secret: "",
    microsoft_tenant_hint: msConfig.tenant_hint || "",

    // Google
    google_client_id: googleConfig.client_id || "",
    google_secret: "",
    google_tenant_hint: googleConfig.tenant_hint || "",
  });

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSave = () => {
    const updateData = {};

    if (formData.organization_name !== tenant.organization_name) {
      updateData.organization_name = formData.organization_name;
    }

    updateData.domains = domainObjects;

    updateData.provider_type = activeTab;

    if (activeTab === "microsoft") {
      if (formData.microsoft_client_id !== msConfig.client_id) {
        updateData.client_id = formData.microsoft_client_id;
      }
      if (formData.microsoft_secret) {
        updateData.client_secret = formData.microsoft_secret;
      }
      if (formData.microsoft_tenant_hint !== msConfig.tenant_hint) {
        updateData.tenant_hint = formData.microsoft_tenant_hint;
      }
    } else if (activeTab === "google") {
      if (formData.google_client_id !== googleConfig.client_id) {
        updateData.client_id = formData.google_client_id;
      }
      if (formData.google_secret) {
        updateData.client_secret = formData.google_secret;
      }
      if (formData.google_tenant_hint !== googleConfig.tenant_hint) {
        updateData.tenant_hint = formData.google_tenant_hint;
      }
    }

    if (Object.keys(updateData).length > 0) {
      onUpdate(tenant.tenant_id, updateData);
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setFormData({
      organization_name: tenant.organization_name || "",

      microsoft_client_id: msConfig.client_id || "",
      microsoft_secret: "",
      microsoft_tenant_hint: msConfig.tenant_hint || "",

      google_client_id: googleConfig.client_id || "",
      google_secret: "",
      google_tenant_hint: googleConfig.tenant_hint || "",
    });
    setDomainObjects(normalizeDomains(tenant.domains));
    setIsEditing(false);
  };

  const handleDelete = () => {
    if (
      window.confirm(
        t("delete_confirm_tenant", { name: tenant.organization_name }),
      )
    ) {
      onDelete(tenant.tenant_id);
    }
  };

  const handleDeleteAuth = async (provider) => {
    const activeMethods = Object.keys(authMethods).filter(
      (k) => authMethods[k].has_secret,
    );
    const isLastMethod =
      activeMethods.length <= 1 && activeMethods.includes(provider);

    const confirmMessage = isLastMethod
      ? t("tenant_delete_last_auth_confirm", { provider })
      : t("tenant_delete_auth_confirm", { provider });

    if (!window.confirm(confirmMessage)) return;

    try {
      const response = await fetch(
        `/api/tenant/${tenant.tenant_id}/auth/${provider}`,
        {
          method: "DELETE",
        },
      );

      if (response.status === 204) {
        if (onRefresh) onRefresh();
      } else if (response.ok) {
        if (onRefresh) {
          onRefresh();
          setIsEditing(false);
        }
      } else {
        alert(t("tenant_delete_config_failed"));
      }
    } catch (error) {
      console.error("Error deleting auth method:", error);
      alert(t("error_generic"));
    }
  };

  const renderDomains = () => {
    const domains = normalizeDomains(tenant.domains);
    return (
      <div className="flex flex-wrap gap-2 mt-2">
        {domains.map((d, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1.5 px-2 py-1 text-xs font-medium bg-zinc-100 dark:bg-zinc-700/50 rounded border border-zinc-200 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300"
          >
            {d.domain}
            {d.provider === "microsoft" && (
              <FaMicrosoft
                className="text-[#00a4ef]"
                title={t("tenant_pinned_microsoft")}
              />
            )}
            {d.provider === "google" && (
              <FaGoogle
                className="text-[#EA4335]"
                title={t("tenant_pinned_google")}
              />
            )}
          </span>
        ))}
      </div>
    );
  };

  const renderProviderInfo = (label, icon, config) => {
    const isConfigured = config && config.has_secret;
    return (
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1 font-medium text-zinc-700 dark:text-zinc-300">
            {icon} {label}
          </span>
          {isConfigured ? (
            <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400 font-medium">
              <FaCheckCircle /> {t("status_active")}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-zinc-400">
              <FaExclamationCircle /> {t("status_not_set")}
            </span>
          )}
        </div>
        {isConfigured && config.client_id && (
          <div
            className="text-xs text-zinc-500 dark:text-zinc-400 pl-4 font-mono truncate max-w-[200px]"
            title={config.client_id}
          >
            {t("client_id_prefix")} {config.client_id}
          </div>
        )}
      </div>
    );
  };

  if (isEditing) {
    return (
      <AdminCard className="p-4 bg-white dark:bg-zinc-800 space-y-4">
        {/* Header Inputs */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1">
              {t("org_name_placeholder")}
            </label>
            <input
              name="organization_name"
              value={formData.organization_name}
              onChange={handleChange}
              placeholder={t("org_name_placeholder")}
              className="w-full px-3 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 rounded-md"
            />
          </div>

          {/* Use the new Domain Editor */}
          <DomainEditor domains={domainObjects} onChange={setDomainObjects} />
        </div>

        {/* TABS for Providers */}
        <div className="border-b border-zinc-200 dark:border-zinc-700 flex gap-4 mt-2">
          <button
            type="button"
            onClick={() => setActiveTab("microsoft")}
            className={`cursor-pointer pb-2 px-1 flex items-center gap-2 text-sm font-medium transition-colors ${
              activeTab === "microsoft"
                ? "border-b-2 border-blue-500 text-blue-600 dark:text-blue-400"
                : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400"
            }`}
          >
            <FaMicrosoft /> {t("provider_microsoft")}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("google")}
            className={`cursor-pointer pb-2 px-1 flex items-center gap-2 text-sm font-medium transition-colors ${
              activeTab === "google"
                ? "border-b-2 border-red-500 text-red-600 dark:text-red-400"
                : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400"
            }`}
          >
            <FaGoogle /> {t("provider_google")}
          </button>
        </div>

        {/* Dynamic Auth Inputs based on Tab */}
        <div className="bg-zinc-50 dark:bg-zinc-700/30 p-3 rounded-md border border-zinc-200 dark:border-zinc-700">
          {activeTab === "microsoft" && (
            <div className="space-y-3 animate-fade-in">
              <p className="text-xs text-zinc-500">
                {t("tenant_config_microsoft_desc")}
              </p>
              <div className="grid grid-cols-1 gap-3">
                <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 -mb-1">
                  {t("tenant_microsoft_hint")}
                </label>
                <input
                  name="microsoft_tenant_hint"
                  value={formData.microsoft_tenant_hint}
                  onChange={handleChange}
                  placeholder="e.g. 88888888-4444-..."
                  className="w-full px-3 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 rounded-md"
                />

                <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 -mb-1">
                  {t("client_id_placeholder")}
                </label>
                <input
                  name="microsoft_client_id"
                  value={formData.microsoft_client_id}
                  onChange={handleChange}
                  placeholder={t("tenant_microsoft_client_id_placeholder")}
                  className="w-full px-3 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 rounded-md"
                />

                <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 -mb-1">
                  {t("client_secret_placeholder")}
                </label>
                <input
                  name="microsoft_secret"
                  type="password"
                  value={formData.microsoft_secret}
                  onChange={handleChange}
                  placeholder={
                    msConfig.has_secret
                      ? t("tenant_secret_update_placeholder")
                      : t("tenant_secret_set_placeholder")
                  }
                  className="w-full px-3 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 rounded-md"
                />
              </div>

              {/* Delete Config Button */}
              {msConfig.has_secret && (
                <div className="pt-2 border-t border-zinc-200 dark:border-zinc-600 mt-2">
                  <AdminDangerTextButton
                    onClick={() => handleDeleteAuth("microsoft")}
                  >
                    <FaTrash className="text-[10px]" />{" "}
                    {t("tenant_remove_microsoft")}
                  </AdminDangerTextButton>
                </div>
              )}
            </div>
          )}

          {activeTab === "google" && (
            <div className="space-y-3 animate-fade-in">
              <p className="text-xs text-zinc-500">
                {t("tenant_config_google_desc")}
              </p>
              <div className="grid grid-cols-1 gap-3">
                <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 -mb-1">
                  {t("tenant_google_hint")}
                </label>
                <input
                  name="google_tenant_hint"
                  value={formData.google_tenant_hint}
                  onChange={handleChange}
                  placeholder="e.g. C02g3... or example.com"
                  className="w-full px-3 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 rounded-md"
                />

                <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 -mb-1">
                  {t("client_id_placeholder")}
                </label>
                <input
                  name="google_client_id"
                  value={formData.google_client_id}
                  onChange={handleChange}
                  placeholder={t("tenant_google_client_id_placeholder")}
                  className="w-full px-3 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 rounded-md"
                />

                <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 -mb-1">
                  {t("client_secret_placeholder")}
                </label>
                <input
                  name="google_secret"
                  type="password"
                  value={formData.google_secret}
                  onChange={handleChange}
                  placeholder={
                    googleConfig.has_secret
                      ? t("tenant_secret_update_placeholder")
                      : t("tenant_secret_set_placeholder")
                  }
                  className="w-full px-3 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 rounded-md"
                />
              </div>

              {/* Delete Config Button */}
              {googleConfig.has_secret && (
                <div className="pt-2 border-t border-zinc-200 dark:border-zinc-600 mt-2">
                  <AdminDangerTextButton
                    onClick={() => handleDeleteAuth("google")}
                  >
                    <FaTrash className="text-[10px]" />{" "}
                    {t("tenant_remove_google")}
                  </AdminDangerTextButton>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2 justify-end mt-2">
          <AdminActionButton
            onClick={handleSave}
            title={t("save_btn")}
            variant="primary"
          >
            <FaSave /> {t("save_btn")}
          </AdminActionButton>
          <AdminActionButton
            onClick={handleCancel}
            title={t("cancel_btn")}
            variant="secondary"
          >
            <FaTimes /> {t("cancel_btn")}
          </AdminActionButton>
        </div>
      </AdminCard>
    );
  }

  return (
    <AdminCard className="p-4 bg-white dark:bg-zinc-800 flex flex-col sm:flex-row justify-between items-start gap-4">
      <div className="flex-1 w-full">
        <div className="flex items-center gap-3">
          <p className="font-semibold text-lg text-zinc-900 dark:text-zinc-100">
            {tenant.organization_name}
          </p>
          {/* Show icons for Active Providers */}
          <div className="flex gap-2">
            {msConfig.has_secret && (
              <FaMicrosoft
                className="text-[#00a4ef]"
                title={t("tenant_microsoft_enabled")}
              />
            )}
            {googleConfig.has_secret && (
              <FaGoogle
                className="text-[#EA4335]"
                title={t("tenant_google_enabled")}
              />
            )}
          </div>
        </div>

        {renderDomains()}

        {/* Auth Methods Grid */}
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm bg-zinc-50 dark:bg-zinc-700/20 p-3 rounded-md border border-zinc-100 dark:border-zinc-700/50">
          {renderProviderInfo(
            t("provider_microsoft"),
            <FaMicrosoft className="text-xs" />,
            msConfig,
          )}
          {renderProviderInfo(
            t("provider_google"),
            <FaGoogle className="text-xs" />,
            googleConfig,
          )}
        </div>
      </div>

      <div className="flex gap-2 shrink-0">
        <AdminIconButton
          onClick={() => setIsEditing(true)}
          title={t("edit_btn_title")}
          tone="blue"
        >
          <FaEdit />
        </AdminIconButton>
        <AdminIconButton
          onClick={handleDelete}
          title={t("delete_btn_title")}
          tone="red"
        >
          <FaTrash />
        </AdminIconButton>
      </div>
    </AdminCard>
  );
}

export default function TenantManagement({
  tenants = [],
  onCreateTenant,
  onUpdateTenant,
  onDeleteTenant,
  onRefresh,
}) {
  const { t } = useTranslation();

  return (
    <AdminSection>
      <h2 className="text-2xl font-semibold mb-6 text-center">
        {t("tenant_mgmt_title")}
      </h2>
      <CreateTenantForm onCreate={onCreateTenant} />
      <div className="space-y-4">
        {tenants.length > 0 ? (
          tenants.map((tenant) => (
            <TenantRow
              key={tenant.tenant_id}
              tenant={tenant}
              onUpdate={onUpdateTenant}
              onDelete={onDeleteTenant}
              onRefresh={onRefresh}
            />
          ))
        ) : (
          <p className="text-center text-zinc-500 dark:text-zinc-400">
            {t("no_tenants_found")}
          </p>
        )}
      </div>
    </AdminSection>
  );
}
