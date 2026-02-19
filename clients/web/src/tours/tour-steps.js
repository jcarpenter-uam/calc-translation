export const TOUR_GROUP = "app-onboarding-v1";

const WAIT_ATTEMPTS = 40;
const WAIT_MS = 100;

async function waitForSelector(selector, attempt = 0) {
  if (document.querySelector(selector)) {
    return true;
  }
  if (attempt >= WAIT_ATTEMPTS) {
    return false;
  }
  await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
  return waitForSelector(selector, attempt + 1);
}

async function waitForNoSelector(selector, attempt = 0) {
  if (!document.querySelector(selector)) {
    return true;
  }
  if (attempt >= WAIT_ATTEMPTS) {
    return false;
  }
  await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
  return waitForNoSelector(selector, attempt + 1);
}

export function getOnboardingTourSteps(navigate, t) {
  const ensureLandingPage = async () => {
    navigate("/");
    await waitForSelector("#user-avatar-btn-web");
  };

  const ensureSettingsModalClosed = async () => {
    const closeBtn = document.querySelector("#settings-close-btn-web");
    if (closeBtn) {
      closeBtn.click();
      await waitForNoSelector("#settings-modal-web");
    }
  };

  const ensureDropdownOpen = async () => {
    if (!document.querySelector("#user-settings-btn-web")) {
      const avatarBtn = document.querySelector("#user-avatar-btn-web");
      avatarBtn?.click();
      await waitForSelector("#user-settings-btn-web");
    }
  };

  const ensureDropdownClosed = async () => {
    if (document.querySelector("#user-settings-btn-web")) {
      const avatarBtn = document.querySelector("#user-avatar-btn-web");
      avatarBtn?.click();
      await waitForNoSelector("#user-settings-btn-web");
    }
  };

  const ensureLandingClean = async () => {
    await ensureLandingPage();
    await ensureSettingsModalClosed();
    await ensureDropdownClosed();
  };

  const ensureSettingsShortcutState = async (_currentStep, nextStep) => {
    await ensureLandingPage();
    await ensureSettingsModalClosed();
    await ensureDropdownOpen();
    const settingsBtn = document.querySelector("#user-settings-btn-web");
    const avatarBtn = document.querySelector("#user-avatar-btn-web");
    nextStep.target = settingsBtn || avatarBtn || document.body;
    nextStep.dialogTarget = settingsBtn || avatarBtn || document.body;
  };

  const openSettingsModal = async () => {
    await ensureLandingPage();
    if (document.querySelector("#settings-modal-web")) {
      return;
    }
    await ensureDropdownOpen();
    const settingsBtn = document.querySelector("#user-settings-btn-web");
    settingsBtn?.click();
    await waitForSelector("#settings-modal-web");
  };

  return [
    {
      target: "#user-avatar-btn-web",
      group: TOUR_GROUP,
      title: t("tour_user_menu_title"),
      content: t("tour_user_menu_content"),
      beforeEnter: ensureLandingClean,
    },
    {
      target: "#user-settings-btn-web",
      group: TOUR_GROUP,
      title: t("tour_settings_shortcut_title"),
      content: t("tour_settings_shortcut_content"),
      beforeEnter: ensureSettingsShortcutState,
    },
    {
      target: "#settings-theme-row-web",
      group: TOUR_GROUP,
      title: t("tour_settings_theme_title"),
      content: t("tour_settings_theme_content"),
      beforeEnter: openSettingsModal,
    },
    {
      target: "#settings-language-row-web",
      group: TOUR_GROUP,
      title: t("tour_settings_language_title"),
      content: t("tour_settings_language_content"),
      beforeEnter: openSettingsModal,
    },
    {
      target: "#settings-ui-translation-row-web",
      group: TOUR_GROUP,
      title: t("tour_settings_ui_translation_title"),
      content: t("tour_settings_ui_translation_content"),
      beforeEnter: openSettingsModal,
    },
    {
      target: "#settings-display-mode-row-web",
      group: TOUR_GROUP,
      title: t("tour_settings_display_mode_title"),
      content: t("tour_settings_display_mode_content"),
      beforeEnter: openSettingsModal,
      afterLeave: () => {
        const closeBtn = document.querySelector("#settings-close-btn-web");
        closeBtn?.click();
      },
    },
    {
      target: "#landing-calendar-panel-web",
      group: TOUR_GROUP,
      title: t("tour_calendar_join_title"),
      content: t("tour_calendar_join_content"),
      beforeEnter: ensureLandingClean,
    },
    {
      target: "#landing-zoom-panel-web",
      group: TOUR_GROUP,
      title: t("tour_zoom_integration_title"),
      content: t("tour_zoom_integration_content"),
      beforeEnter: async () => {
        await ensureLandingClean();
        const zoomTab = document.querySelector("#landing-zoom-tab-web");
        zoomTab?.click();
        await waitForSelector("#landing-zoom-panel-web");
      },
    },
    {
      target: "#landing-add-app-to-zoom-btn-web",
      group: TOUR_GROUP,
      title: t("tour_add_app_to_zoom_title"),
      content: t("tour_add_app_to_zoom_content"),
      beforeEnter: async () => {
        await ensureLandingClean();
        const zoomTab = document.querySelector("#landing-zoom-tab-web");
        zoomTab?.click();
        await waitForSelector("#landing-add-app-to-zoom-btn-web");
      },
    },
    {
      target: "#landing-standalone-panel-web",
      group: TOUR_GROUP,
      title: t("tour_standalone_mode_title"),
      content: t("tour_standalone_mode_content"),
      beforeEnter: async () => {
        await ensureLandingClean();
        const standaloneTab = document.querySelector(
          "#landing-standalone-tab-web",
        );
        standaloneTab?.click();
        await waitForSelector("#landing-standalone-panel-web");
      },
    },
    {
      target: "#landing-to-standalone-btn-web",
      group: TOUR_GROUP,
      title: t("tour_standalone_host_title"),
      content: t("tour_standalone_host_content"),
      beforeEnter: async () => {
        await ensureLandingClean();
        const standaloneTab = document.querySelector(
          "#landing-standalone-tab-web",
        );
        standaloneTab?.click();
        await waitForSelector("#landing-to-standalone-btn-web");
      },
    },
    {
      target: "#standalone-supported-langs-web",
      group: TOUR_GROUP,
      title: t("tour_supported_languages_title"),
      content: t("tour_supported_languages_content"),
      beforeEnter: async () => {
        await ensureSettingsModalClosed();
        navigate("/standalone/host");
        await waitForSelector("#standalone-supported-langs-web");
      },
    },
    {
      target: "#standalone-one-way-card-web",
      group: TOUR_GROUP,
      title: t("tour_one_way_translation_title"),
      content: t("tour_one_way_translation_content"),
    },
    {
      target: "#standalone-two-way-card-web",
      group: TOUR_GROUP,
      title: t("tour_two_way_translation_title"),
      content: t("tour_two_way_translation_content"),
    },
  ];
}
