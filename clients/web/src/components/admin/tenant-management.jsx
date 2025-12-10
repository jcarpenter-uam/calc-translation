import React, { useState } from "react";
import { FaEdit, FaTrash, FaSave, FaTimes, FaPlus } from "react-icons/fa";
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
        placeholder={t("tenant_id_placeholder")}
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
        className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
      >
        <FaPlus /> {t("create_tenant_btn")}
      </button>
    </form>
  );
}

/**
 * A single row in the tenant list, handling its own edit state.
 */
function TenantRow({ tenant, onUpdate, onDelete }) {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);

  const initialDomains = (tenant.domains || []).join(", ");

  const [formData, setFormData] = useState({
    organization_name: tenant.organization_name || "",
    domains: initialDomains,
    client_id: tenant.client_id || "",
    client_secret: "",
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
        .filter((d) => d.length > 0);
    }
    if (formData.client_id !== tenant.client_id) {
      updateData.client_id = formData.client_id;
    }
    if (formData.client_secret) {
      updateData.client_secret = formData.client_secret;
    }

    if (Object.keys(updateData).length > 0) {
      onUpdate(tenant.tenant_id, updateData);
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setFormData({
      organization_name: tenant.organization_name || "",
      domains: initialDomains,
      client_id: tenant.client_id || "",
      client_secret: "",
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

  const renderDomains = () => {
    const list = tenant.domains || [];
    return (
      <div className="flex flex-wrap gap-1 mt-1">
        {list.map(
          (d, i) =>
            d && (
              <span
                key={i}
                className="px-2 py-0.5 text-xs bg-zinc-100 dark:bg-zinc-700 rounded text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-600"
              >
                {d}
              </span>
            ),
        )}
      </div>
    );
  };

  if (isEditing) {
    return (
      <div className="p-4 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-sm space-y-3">
        <input
          name="organization_name"
          value={formData.organization_name}
          onChange={handleChange}
          placeholder={t("org_name_placeholder")}
          className="w-full px-3 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <input
          name="domains"
          value={formData.domains}
          onChange={handleChange}
          placeholder={t("domains_placeholder_simple")}
          className="w-full px-3 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <input
          name="client_id"
          value={formData.client_id}
          onChange={handleChange}
          placeholder={t("client_id_placeholder")}
          className="w-full px-3 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <input
          name="client_secret"
          type="password"
          value={formData.client_secret}
          onChange={handleChange}
          placeholder={t("client_secret_new_placeholder")}
          className="w-full px-3 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <div className="flex gap-2 justify-end mt-2">
          <button
            onClick={handleSave}
            title={t("save_btn")}
            className="px-3 py-1 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors flex items-center gap-1"
          >
            <FaSave /> {t("save_btn")}
          </button>
          <button
            onClick={handleCancel}
            title={t("cancel_btn")}
            className="px-3 py-1 bg-zinc-500 text-white rounded-md hover:bg-zinc-600 transition-colors flex items-center gap-1"
          >
            <FaTimes /> {t("cancel_btn")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-sm flex justify-between items-start">
      <div>
        <p className="font-semibold text-lg text-zinc-900 dark:text-zinc-100">
          {tenant.organization_name}
        </p>
        {renderDomains()}
        <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">
          {t("client_id_label")} {tenant.client_id}
        </p>
        <p className="text-xs text-zinc-400 dark:text-zinc-500">
          {t("tenant_id_label")} {tenant.tenant_id}
        </p>
      </div>
      <div className="flex flex-col items-end gap-2">
        {tenant.has_secret ? (
          <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
            {t("secret_set_badge")}
          </span>
        ) : (
          <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
            {t("no_secret_badge")}
          </span>
        )}
        <div className="flex gap-2">
          <button
            onClick={() => setIsEditing(true)}
            title={t("edit_btn_title")}
            className="p-2 text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
          >
            <FaEdit />
          </button>
          <button
            onClick={handleDelete}
            title={t("delete_btn_title")}
            className="p-2 text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 transition-colors"
          >
            <FaTrash />
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Stateless component to display a list of tenants and allow CRUD operations.
 */
export default function TenantManagement({
  tenants = [],
  onCreateTenant,
  onUpdateTenant,
  onDeleteTenant,
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
