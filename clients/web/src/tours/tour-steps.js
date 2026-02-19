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

export function getOnboardingTourSteps(navigate) {
  return [
    {
      target: "#user-avatar-btn-web",
      group: TOUR_GROUP,
      title: "User Menu",
      content:
        "Use the avatar menu for a home button, signing out, and app settings.",
    },
    {
      target: "#user-settings-btn-web",
      group: TOUR_GROUP,
      title: "Settings Shortcut",
      content:
        "Open Settings from here whenever you want to change theme, prefered language, or display preferences.",
      beforeEnter: () => {
        const avatarBtn = document.querySelector("#user-avatar-btn-web");
        if (!document.querySelector("#user-settings-btn-web")) {
          avatarBtn?.click();
        }
      },
      afterLeave: () => {
        const avatarBtn = document.querySelector("#user-avatar-btn-web");
        if (document.querySelector("#user-settings-btn-web")) {
          avatarBtn?.click();
        }
      },
    },
    {
      target: "#landing-calendar-panel-web",
      group: TOUR_GROUP,
      title: "Calendar Join",
      content:
        "We use your calendar to display scheduled Zoom meetings here. Pick one and start transcription in one click.",
    },
    {
      target: "#landing-zoom-tab-web",
      group: TOUR_GROUP,
      title: "Zoom Integration",
      content:
        "Our Zoom integration lets you join using the meeting URL or credentials from the Zoom app.",
    },
    {
      target: "#landing-standalone-tab-web",
      group: TOUR_GROUP,
      title: "Standalone Mode",
      content:
        "The Standalone integration is where you start or join a standalone meeting using a host-provided link.",
    },
    {
      target: "#landing-to-standalone-btn-web",
      group: TOUR_GROUP,
      title: "Standalone Host",
      content:
        "This is the button for standalone hosting. Which will redirect you with options to Host your meeting.",
      beforeEnter: () => {
        const standaloneTab = document.querySelector(
          "#landing-standalone-tab-web",
        );
        standaloneTab?.click();
      },
    },
    {
      target: "#standalone-supported-langs-web",
      group: TOUR_GROUP,
      title: "Supported Languages",
      content:
        "These are the languages supported by real-time translation. Feel free to search our options",
      beforeEnter: async () => {
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
