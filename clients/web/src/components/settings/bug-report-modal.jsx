import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { FiX } from "react-icons/fi";
import Notification from "../misc/notification.jsx";
import {
  buildClientDiagnosticsLog,
  clientLogger,
  getClientEnvironment,
} from "../../lib/client-logger.js";

const INITIAL_FORM = {
  title: "",
  description: "",
  stepsToReproduce: "",
  expectedBehavior: "",
  actualBehavior: "",
};

function TextAreaField({ label, value, onChange, rows = 3, required = false }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={rows}
        required={required}
        className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
      />
    </label>
  );
}

export default function BugReportModal({ isOpen, onClose }) {
  const [form, setForm] = useState(INITIAL_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState({ type: "idle", message: "" });
  const [toastVisible, setToastVisible] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (status.type !== "success") {
      return undefined;
    }
    setToastVisible(true);
    const timer = window.setTimeout(() => setToastVisible(false), 2400);
    return () => window.clearTimeout(timer);
  }, [status]);

  const setField = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const isFormComplete =
    form.title.trim() &&
    form.description.trim() &&
    form.stepsToReproduce.trim() &&
    form.expectedBehavior.trim() &&
    form.actualBehavior.trim();

  const handleSubmit = async (event) => {
    event.preventDefault();
    setStatus({ type: "idle", message: "" });
    setIsSubmitting(true);

    clientLogger.info("Bug Report: Submitting web bug report", {
      titleLength: form.title.trim().length,
      hasSteps: Boolean(form.stepsToReproduce.trim()),
    });

    try {
      const env = getClientEnvironment();
      const diagnostics = buildClientDiagnosticsLog();
      const payload = new FormData();
      payload.append("title", form.title.trim());
      payload.append("description", form.description.trim());
      payload.append("steps_to_reproduce", form.stepsToReproduce.trim());
      payload.append("expected_behavior", form.expectedBehavior.trim());
      payload.append("actual_behavior", form.actualBehavior.trim());
      payload.append(
        "app_version",
        import.meta.env.VITE_APP_VERSION || import.meta.env.VITE_GIT_SHA || "web",
      );
      payload.append("platform", `${env.os} • ${env.browser} • ${env.deviceType}`);
      payload.append(
        "main_log",
        new Blob([diagnostics], { type: "text/plain" }),
        "web-client-diagnostics.log",
      );

      const response = await fetch("/api/bug-reports/", {
        method: "POST",
        body: payload,
      });

      if (!response.ok) {
        let message = "Failed to submit bug report";
        try {
          const data = await response.json();
          message = data?.detail || data?.message || message;
        } catch {
          // ignore parse failures
        }
        throw new Error(message);
      }

      setForm(INITIAL_FORM);
      setStatus({
        type: "success",
        message: "Bug report submitted with recent client diagnostics.",
      });
      clientLogger.info("Bug Report: Web submission succeeded");
      onClose();
    } catch (error) {
      clientLogger.error("Bug Report: Web submission failed", error);
      setStatus({
        type: "error",
        message: error.message || "Failed to submit bug report",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (typeof document === "undefined") {
    return null;
  }

  return (
    <>
      {isOpen
        ? createPortal(
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
              <div className="w-full max-w-2xl overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
                <div className="flex items-center justify-between border-b border-zinc-100 px-6 py-4 dark:border-zinc-800">
                  <div>
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Report a bug</h2>
                    <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                      Submit a report and attach recent web client diagnostics automatically.
                    </p>
                  </div>
                  <button
                    onClick={onClose}
                    className="cursor-pointer rounded-md p-1 text-zinc-500 transition-colors hover:bg-red-100 hover:text-red-700 dark:hover:bg-red-900 dark:hover:text-red-200"
                  >
                    <FiX className="h-5 w-5" />
                  </button>
                </div>

                <form className="space-y-4 p-6" onSubmit={handleSubmit}>
                  {status.type === "error" ? (
                    <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
                      {status.message}
                    </div>
                  ) : null}

                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Title</span>
                    <input
                      type="text"
                      value={form.title}
                      onChange={(event) => setField("title", event.target.value)}
                      required
                      maxLength={160}
                      className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                    />
                  </label>

                  <TextAreaField label="What happened?" value={form.description} onChange={(value) => setField("description", value)} rows={5} required />
                  <TextAreaField label="Steps to reproduce" value={form.stepsToReproduce} onChange={(value) => setField("stepsToReproduce", value)} rows={4} required />
                  <TextAreaField label="Expected behavior" value={form.expectedBehavior} onChange={(value) => setField("expectedBehavior", value)} rows={3} required />
                  <TextAreaField label="Actual behavior" value={form.actualBehavior} onChange={(value) => setField("actualBehavior", value)} rows={3} required />

                  <div className="flex items-center justify-between gap-3 pt-2">
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      Recent client console, errors, route changes, and request failures are attached automatically.
                    </p>
                    <button
                      type="submit"
                      disabled={isSubmitting || !isFormComplete}
                      className="cursor-pointer rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-zinc-400"
                    >
                      {isSubmitting ? "Submitting..." : "Submit report"}
                    </button>
                  </div>
                </form>
              </div>
            </div>,
            document.body,
          )
        : null}
      <Notification message="Bug report submitted" visible={toastVisible} />
    </>
  );
}
