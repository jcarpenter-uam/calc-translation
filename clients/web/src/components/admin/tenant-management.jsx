import React, { useState } from "react";
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
  FaCopy,
} from "react-icons/fa";
import { useTranslation } from "react-i18next";

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

    const domainArray = formData.domains
      .split(",")
      .map((d) => d.trim())
      .filter((d) => d.length > 0);

    onCreate({
      ...formData,
      domains: domainArray,
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
    <form
      onSubmit={handleSubmit}
      className="p-4 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-sm mb-6 grid grid-cols-1 md:grid-cols-2 gap-4"
    >
      <h3 className="text-lg font-semibold col-span-1 md:col-span-2">
        {t("tenant_create_title")}
      </h3>

      <input
        name="organization_name"
        value={formData.organization_name}
        onChange={handleChange}
        placeholder={t("org_name_placeholder")}
        required
        className="w-full px-3 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
      />

      <select
        name="provider_type"
        value={formData.provider_type}
        onChange={handleChange}
        className="cursor-pointer w-full px-3 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="microsoft">Microsoft Entra ID</option>
        <option value="google">Google Workspace</option>
      </select>

      <input
        name="domains"
        value={formData.domains}
        onChange={handleChange}
        placeholder={t("domains_placeholder_hint")}
        required
        className="w-full px-3 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
      />

      <input
        name="tenant_id"
        value={formData.tenant_id}
        onChange={handleChange}
        placeholder={
          formData.provider_type === "microsoft"
            ? "Entra Directory (Tenant) ID"
            : "Google Customer ID (or 'hd' domain)"
        }
        required
        className="w-full px-3 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
      />

      <input
        name="client_id"
        value={formData.client_id}
        onChange={handleChange}
        placeholder={t("client_id_placeholder")}
        required
        className="w-full px-3 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
      />

      <input
        name="client_secret"
        type="password"
        value={formData.client_secret}
        onChange={handleChange}
        placeholder={t("client_secret_placeholder")}
        required
        className="w-full px-3 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
      />

      <button
        type="submit"
        className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 cursor-pointer col-span-1 md:col-span-2"
      >
        <FaPlus /> {t("create_tenant_btn")}
      </button>
    </form>
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

  const initialDomains = (tenant.domains || []).join(", ");

  const [formData, setFormData] = useState({
    organization_name: tenant.organization_name || "",
    domains: initialDomains,

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
    const currentDomainString = (tenant.domains || []).join(", ");
    if (formData.domains !== currentDomainString) {
      updateData.domains = formData.domains
        .split(",")
        .map((d) => d.trim())
        .filter(Boolean);
    }

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

    if (Object.keys(updateData).length > 1) {
      onUpdate(tenant.tenant_id, updateData);
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setFormData({
      organization_name: tenant.organization_name || "",
      domains: initialDomains,

      microsoft_client_id: msConfig.client_id || "",
      microsoft_secret: "",
      microsoft_tenant_hint: msConfig.tenant_hint || "",

      google_client_id: googleConfig.client_id || "",
      google_secret: "",
      google_tenant_hint: googleConfig.tenant_hint || "",
    });
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
      ? `Removing ${provider} will remove the last authentication method and DELETE this tenant. Are you sure?`
      : `Are you sure you want to remove the ${provider} configuration?`;

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
        alert("Failed to delete configuration.");
      }
    } catch (error) {
      console.error("Error deleting auth method:", error);
      alert("An error occurred.");
    }
  };

  const renderDomains = () => (
    <div className="flex flex-wrap gap-1 mt-1">
      {(tenant.domains || []).map((d, i) => (
        <span
          key={i}
          className="px-2 py-0.5 text-xs bg-zinc-100 dark:bg-zinc-700 rounded text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-600"
        >
          {d}
        </span>
      ))}
    </div>
  );

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
              <FaCheckCircle /> Active
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-zinc-400">
              <FaExclamationCircle /> Not Set
            </span>
          )}
        </div>
        {isConfigured && config.client_id && (
          <div
            className="text-xs text-zinc-500 dark:text-zinc-400 pl-4 font-mono truncate max-w-[200px]"
            title={config.client_id}
          >
            Client: {config.client_id}
          </div>
        )}
      </div>
    );
  };

  if (isEditing) {
    return (
      <div className="p-4 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-sm space-y-4">
        {/* Header Inputs */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <input
            name="organization_name"
            value={formData.organization_name}
            onChange={handleChange}
            placeholder={t("org_name_placeholder")}
            className="w-full px-3 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 rounded-md"
          />
          <input
            name="domains"
            value={formData.domains}
            onChange={handleChange}
            placeholder={t("domains_placeholder_simple")}
            className="w-full px-3 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 rounded-md"
          />
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
            <FaMicrosoft /> Microsoft Entra
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
            <FaGoogle /> Google Workspace
          </button>
        </div>

        {/* Dynamic Auth Inputs based on Tab */}
        <div className="bg-zinc-50 dark:bg-zinc-700/30 p-3 rounded-md border border-zinc-200 dark:border-zinc-700">
          {activeTab === "microsoft" && (
            <div className="space-y-3 animate-fade-in">
              <p className="text-xs text-zinc-500">
                Configure Microsoft Entra ID (OIDC)
              </p>
              <div className="grid grid-cols-1 gap-3">
                <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 -mb-1">
                  Entra Tenant ID (Hint)
                </label>
                <input
                  name="microsoft_tenant_hint"
                  value={formData.microsoft_tenant_hint}
                  onChange={handleChange}
                  placeholder="e.g. 88888888-4444-..."
                  className="w-full px-3 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 rounded-md"
                />

                <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 -mb-1">
                  Client ID
                </label>
                <input
                  name="microsoft_client_id"
                  value={formData.microsoft_client_id}
                  onChange={handleChange}
                  placeholder="Microsoft Client ID"
                  className="w-full px-3 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 rounded-md"
                />

                <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 -mb-1">
                  Client Secret
                </label>
                <input
                  name="microsoft_secret"
                  type="password"
                  value={formData.microsoft_secret}
                  onChange={handleChange}
                  placeholder={
                    msConfig.has_secret
                      ? "Update Client Secret (Encrypted)"
                      : "Set Client Secret"
                  }
                  className="w-full px-3 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 rounded-md"
                />
              </div>

              {/* Delete Config Button */}
              {msConfig.has_secret && (
                <div className="pt-2 border-t border-zinc-200 dark:border-zinc-600 mt-2">
                  <button
                    type="button"
                    onClick={() => handleDeleteAuth("microsoft")}
                    className="text-xs text-red-600 hover:text-red-800 dark:text-red-400 flex items-center gap-1 cursor-pointer"
                  >
                    <FaTrash className="text-[10px]" /> Remove Microsoft
                    Configuration
                  </button>
                </div>
              )}
            </div>
          )}

          {activeTab === "google" && (
            <div className="space-y-3 animate-fade-in">
              <p className="text-xs text-zinc-500">
                Configure Google Workspace (OAuth2)
              </p>
              <div className="grid grid-cols-1 gap-3">
                <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 -mb-1">
                  Customer ID / HD (Hint)
                </label>
                <input
                  name="google_tenant_hint"
                  value={formData.google_tenant_hint}
                  onChange={handleChange}
                  placeholder="e.g. C02g3... or example.com"
                  className="w-full px-3 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 rounded-md"
                />

                <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 -mb-1">
                  Client ID
                </label>
                <input
                  name="google_client_id"
                  value={formData.google_client_id}
                  onChange={handleChange}
                  placeholder="Google Client ID"
                  className="w-full px-3 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 rounded-md"
                />

                <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 -mb-1">
                  Client Secret
                </label>
                <input
                  name="google_secret"
                  type="password"
                  value={formData.google_secret}
                  onChange={handleChange}
                  placeholder={
                    googleConfig.has_secret
                      ? "Update Client Secret (Encrypted)"
                      : "Set Client Secret"
                  }
                  className="w-full px-3 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 rounded-md"
                />
              </div>

              {/* Delete Config Button */}
              {googleConfig.has_secret && (
                <div className="pt-2 border-t border-zinc-200 dark:border-zinc-600 mt-2">
                  <button
                    type="button"
                    onClick={() => handleDeleteAuth("google")}
                    className="text-xs text-red-600 hover:text-red-800 dark:text-red-400 flex items-center gap-1 cursor-pointer"
                  >
                    <FaTrash className="text-[10px]" /> Remove Google
                    Configuration
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2 justify-end mt-2">
          <button
            onClick={handleSave}
            title={t("save_btn")}
            className="px-3 py-1 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors flex items-center gap-1 cursor-pointer"
          >
            <FaSave /> {t("save_btn")}
          </button>
          <button
            onClick={handleCancel}
            title={t("cancel_btn")}
            className="px-3 py-1 bg-zinc-500 text-white rounded-md hover:bg-zinc-600 transition-colors flex items-center gap-1 cursor-pointer"
          >
            <FaTimes /> {t("cancel_btn")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-sm flex flex-col sm:flex-row justify-between items-start gap-4">
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
                title="Microsoft Enabled"
              />
            )}
            {googleConfig.has_secret && (
              <FaGoogle className="text-[#EA4335]" title="Google Enabled" />
            )}
          </div>
        </div>

        {renderDomains()}

        {/* Auth Methods Grid */}
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm bg-zinc-50 dark:bg-zinc-700/20 p-3 rounded-md border border-zinc-100 dark:border-zinc-700/50">
          {renderProviderInfo(
            "Entra",
            <FaMicrosoft className="text-xs" />,
            msConfig,
          )}
          {renderProviderInfo(
            "Google",
            <FaGoogle className="text-xs" />,
            googleConfig,
          )}
        </div>
      </div>

      <div className="flex gap-2 shrink-0">
        <button
          onClick={() => setIsEditing(true)}
          title={t("edit_btn_title")}
          className="p-2 text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 transition-colors cursor-pointer"
        >
          <FaEdit />
        </button>
        <button
          onClick={handleDelete}
          title={t("delete_btn_title")}
          className="p-2 text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 transition-colors cursor-pointer"
        >
          <FaTrash />
        </button>
      </div>
    </div>
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
    <div className="w-full max-w-4xl mx-auto">
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
    </div>
  );
}
