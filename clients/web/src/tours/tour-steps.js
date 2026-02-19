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

export function getOnboardingTourSteps(navigate) {
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
      title: "User Menu",
      content:
        "Use the avatar menu for a home button, signing out, and app settings.",
      beforeEnter: ensureLandingClean,
    },
    {
      target: "#user-settings-btn-web",
      group: TOUR_GROUP,
      title: "Settings Shortcut",
      content: "Open Settings from here.",
      beforeEnter: ensureSettingsShortcutState,
    },
    {
      target: "#settings-theme-row-web",
      group: TOUR_GROUP,
      title: "Theme Setting",
      content: "Switch between light and dark app themes here.",
      beforeEnter: openSettingsModal,
    },
    {
      target: "#settings-language-row-web",
      group: TOUR_GROUP,
      title: "Language Setting",
      content:
        "Set your preferred spoken language for translation, this is what determines the language you see.",
      beforeEnter: openSettingsModal,
    },
    {
      target: "#settings-ui-translation-row-web",
      group: TOUR_GROUP,
      title: "UI Translation",
      content:
        "Turn interface translation on or off. Only select languages are available. And this also follows your selected language above.",
      beforeEnter: openSettingsModal,
    },
    {
      target: "#settings-display-mode-row-web",
      group: TOUR_GROUP,
      title: "Display Mode",
      content: "Choose how translated text is displayed during sessions.",
      beforeEnter: openSettingsModal,
      afterLeave: () => {
        const closeBtn = document.querySelector("#settings-close-btn-web");
        closeBtn?.click();
      },
    },
    {
      target: "#landing-calendar-panel-web",
      group: TOUR_GROUP,
      title: "Calendar Join",
      content:
        "We use your calendar to display scheduled Zoom meetings here. Pick one and start transcription in one click. This automatically refreshes periodicly, so feel free to manually refresh it to check again.",
      beforeEnter: ensureLandingClean,
    },
    {
      target: "#landing-zoom-panel-web",
      group: TOUR_GROUP,
      title: "Zoom Integration",
      content:
        "Our Zoom integration lets you join using the meeting URL or credentials from the Zoom app.",
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
      title: "Add App To Zoom",
      content:
        "Use this button to install our Zoom app so your Zoom meetings can run inside this application.",
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
      title: "Standalone Mode",
      content:
        "The Standalone integration is where you start or join a standalone meeting using a host-provided link.",
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
      title: "Standalone Host",
      content:
        "This is the button for standalone hosting. Which will redirect you with options to Host your meeting.",
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
      title: "Supported Languages",
      content:
        "These are the languages supported by real-time translation. Feel free to search our options",
      beforeEnter: async () => {
        await ensureSettingsModalClosed();
        navigate("/standalone/host");
        await waitForSelector("#standalone-supported-langs-web");
      },
    },
    {
      target: "#standalone-one-way-card-web",
      group: TOUR_GROUP,
      title: "One-Way Translation",
      content:
        "One-Way translates everything into each listener's preferred language. Best for presentations and broadcasts. For the best results be sure to select the spoken languages during your meeting, or leave it blank if you are unsure.",
    },
    {
      target: "#standalone-two-way-card-web",
      group: TOUR_GROUP,
      title: "Two-Way Translation",
      content:
        "Two-Way locks the session to exactly two languages for real-time back-and-forth conversations. Anything outside of those 2 languages will simply be transcribed. For a meeting with more than 2 languages you will need to select One-Way.",
    },
  ];
}
