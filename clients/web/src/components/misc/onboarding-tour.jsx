import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { TourGuideClient } from "@sjmc11/tourguidejs";
import "@sjmc11/tourguidejs/dist/css/tour.min.css";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../context/auth";
import { useLanguage } from "../../context/language";
import { TOUR_GROUP, getOnboardingTourSteps } from "../../tours/tour-steps";

const MAX_START_ATTEMPTS = 12;
const START_RETRY_MS = 150;
const READY_SELECTOR = "#landing-manual-join-web";

function waitForFrames(frames = 2) {
  return new Promise((resolve) => {
    let remaining = frames;
    const tick = () => {
      if (remaining <= 0) {
        resolve();
        return;
      }
      remaining -= 1;
      window.requestAnimationFrame(tick);
    };
    window.requestAnimationFrame(tick);
  });
}

function addClasses(element, classNames) {
  if (!element) {
    return;
  }
  element.classList.add(...classNames);
}

function applyTourUtilityClasses(tg) {
  const dialog = tg?.dialog || document.querySelector(".tg-dialog");
  if (!dialog) {
    return;
  }

  addClasses(dialog, [
    "w-[min(460px,calc(100vw-2rem))]",
    "max-w-[min(460px,calc(100vw-2rem))]",
    "rounded-xl",
    "border",
    "border-zinc-300",
    "bg-white",
    "text-zinc-900",
  ]);

  addClasses(dialog.querySelector(".tg-dialog-title"), ["text-zinc-900"]);
  addClasses(dialog.querySelector(".tg-dialog-body"), ["break-words", "text-zinc-700"]);

  addClasses(dialog.querySelector(".tg-dialog-progress-bar"), ["bg-zinc-100"]);
  addClasses(dialog.querySelector("#tg-dialog-progbar"), ["bg-blue-500"]);

  addClasses(dialog.querySelector(".tg-dialog-dots"), ["border-zinc-200"]);
  dialog.querySelectorAll(".tg-dot").forEach((dot) => {
    addClasses(dot, ["bg-zinc-400"]);
    if (dot.classList.contains("tg-dot-active")) {
      addClasses(dot, ["!bg-blue-500"]);
    }
  });

  addClasses(dialog.querySelector(".tg-arrow"), ["bg-white"]);

  addClasses(dialog.querySelector(".tg-dialog-footer"), [
    "grid",
    "grid-cols-[auto_1fr_auto]",
    "items-center",
    "gap-2",
    "max-[480px]:grid-cols-2",
  ]);
  addClasses(dialog.querySelector(".tg-dialog-footer-sup"), [
    "!m-0",
    "!px-1.5",
    "max-[480px]:col-span-2",
    "max-[480px]:w-full",
    "max-[480px]:!pt-1",
  ]);
  addClasses(dialog.querySelector(".tg-step-progress"), ["text-zinc-500"]);

  const prevBtn = dialog.querySelector("#tg-dialog-prev-btn");
  const nextBtn = dialog.querySelector("#tg-dialog-next-btn");
  [prevBtn, nextBtn].forEach((btn) => {
    addClasses(btn, [
      "min-w-[72px]",
      "cursor-pointer",
      "rounded-md",
      "border-zinc-300",
      "bg-zinc-100",
      "text-zinc-700",
      "hover:bg-zinc-200",
      "max-[480px]:w-full",
    ]);
  });
  addClasses(nextBtn, ["!ml-0", "justify-self-end"]);

  addClasses(dialog.querySelector("#tg-dialog-close-btn"), [
    "ml-3",
    "!h-[22px]",
    "!w-[22px]",
    "!opacity-100",
    "text-red-500",
    "hover:text-red-600",
  ]);
}

function getTourOptions(navigate, t) {
  return {
    completeOnFinish: true,
    showStepProgress: true,
    keyboardControls: false,
    hidePrev: true,
    exitOnClickOutside: false,
    steps: getOnboardingTourSteps(navigate, t),
  };
}

async function refreshTourLanguage({
  tg,
  navigate,
  t,
  retry = 0,
}) {
  if (!tg || !tg.isVisible || tg.group !== TOUR_GROUP) {
    return;
  }

  try {
    const translatedSteps = getOnboardingTourSteps(navigate, t);
    if (Array.isArray(tg.tourSteps)) {
      tg.tourSteps.forEach((step, index) => {
        const translatedStep = translatedSteps[index];
        if (!translatedStep) {
          return;
        }
        step.title = translatedStep.title;
        step.content = translatedStep.content;
      });
      if (tg.options) {
        tg.options.steps = tg.tourSteps;
      }
    }

    const activeStep = tg.tourSteps?.[tg.activeStep];
    const titleEl = document.getElementById("tg-dialog-title");
    const bodyEl = document.getElementById("tg-dialog-body");
    if (titleEl) {
      titleEl.innerHTML = activeStep?.title || "";
    }
    if (bodyEl) {
      if (typeof activeStep?.content === "string") {
        bodyEl.innerHTML = activeStep.content;
      } else if (activeStep?.content instanceof Element) {
        bodyEl.innerHTML = "";
        bodyEl.append(activeStep.content.cloneNode(true));
      }
    }

    applyTourUtilityClasses(tg);
    await waitForFrames();
    await tg.updatePositions();
  } catch (error) {
    if (String(error).includes("Promise waiting") && retry < 8) {
      setTimeout(() => {
        refreshTourLanguage({
          tg,
          navigate,
          t,
          retry: retry + 1,
        });
      }, 120);
      return;
    }
    console.error("Failed to refresh onboarding tour language", error);
  }
}

async function startTourWhenReady({
  tg,
  navigate,
  t,
  hasAttemptedStartRef,
  attempt = 0,
  shouldCancel = () => false,
}) {
  if (shouldCancel()) {
    return;
  }

  const hasTarget = document.querySelector(READY_SELECTOR);
  if (!hasTarget) {
    if (attempt < MAX_START_ATTEMPTS) {
      setTimeout(
        () =>
          startTourWhenReady({
            tg,
            navigate,
            t,
            hasAttemptedStartRef,
            attempt: attempt + 1,
            shouldCancel,
          }),
        START_RETRY_MS,
      );
    }
    if (attempt >= MAX_START_ATTEMPTS) {
      hasAttemptedStartRef.current = false;
    }
    return;
  }

  try {
    await tg.setOptions(getTourOptions(navigate, t));
    await tg.start(TOUR_GROUP);
  } catch (error) {
    console.error("Failed to start onboarding tour", error);
    hasAttemptedStartRef.current = false;
  }
}

export default function OnboardingTour() {
  const { t, i18n } = useTranslation();
  const { uiLanguage } = useLanguage();
  const { user, isLoading } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const clientRef = useRef(null);
  const hasAttemptedStartRef = useRef(false);

  useEffect(() => {
    if (!clientRef.current) {
      clientRef.current = new TourGuideClient({
        completeOnFinish: true,
        showStepProgress: true,
      });
      clientRef.current.onBeforeExit(async () => {
        const tg = clientRef.current;
        if (!tg || tg.isFinished(TOUR_GROUP)) {
          return;
        }
        await tg.finishTour(false, TOUR_GROUP);
      });
      clientRef.current.onAfterStepChange(async () => {
        applyTourUtilityClasses(clientRef.current);
        await waitForFrames();
        await clientRef.current?.updatePositions();
      });
    }
  }, []);

  useEffect(() => {
    if (isLoading || !user || pathname !== "/") {
      return;
    }

    if (uiLanguage && i18n.resolvedLanguage !== uiLanguage) {
      return;
    }

    const tg = clientRef.current;
    if (!tg || tg.isFinished(TOUR_GROUP) || hasAttemptedStartRef.current) {
      return;
    }

    hasAttemptedStartRef.current = true;
    let isCancelled = false;
    const tourT = i18n.getFixedT(uiLanguage || i18n.resolvedLanguage || "en");
    startTourWhenReady({
      tg,
      navigate,
      t: tourT,
      hasAttemptedStartRef,
      shouldCancel: () => isCancelled,
    });

    return () => {
      isCancelled = true;
    };
  }, [i18n, isLoading, navigate, pathname, t, uiLanguage, user]);

  useEffect(() => {
    const tg = clientRef.current;
    if (!tg || !tg.isVisible || tg.group !== TOUR_GROUP) {
      return;
    }

    if (uiLanguage && i18n.resolvedLanguage !== uiLanguage) {
      return;
    }

    const tourT = i18n.getFixedT(uiLanguage || i18n.resolvedLanguage || "en");
    refreshTourLanguage({ tg, navigate, t: tourT });
  }, [i18n, i18n.resolvedLanguage, navigate, uiLanguage]);

  useEffect(() => {
    const handleLanguageChanged = (lng) => {
      const tg = clientRef.current;
      if (!tg || !tg.isVisible || tg.group !== TOUR_GROUP) {
        return;
      }
      const tourT = i18n.getFixedT(lng || uiLanguage || "en");
      refreshTourLanguage({ tg, navigate, t: tourT });
    };

    i18n.on("languageChanged", handleLanguageChanged);
    return () => {
      i18n.off("languageChanged", handleLanguageChanged);
    };
  }, [i18n, navigate, uiLanguage]);

  useEffect(() => {
    const handleRestartTour = async () => {
      const tg = clientRef.current;
      if (!tg) {
        return;
      }

      try {
        tg.deleteFinishedTour(TOUR_GROUP);
        await tg.exit().catch(() => {});
        hasAttemptedStartRef.current = true;
        if (window.location.pathname !== "/") {
          navigate("/");
        }
        await waitForFrames(3);
        const tourT = i18n.getFixedT(uiLanguage || i18n.resolvedLanguage || "en");
        startTourWhenReady({
          tg,
          navigate,
          t: tourT,
          hasAttemptedStartRef,
        });
      } catch (error) {
        console.error("Failed to reset onboarding tour", error);
        hasAttemptedStartRef.current = false;
      }
    };

    window.addEventListener("restart-onboarding-tour", handleRestartTour);
    return () => {
      window.removeEventListener("restart-onboarding-tour", handleRestartTour);
    };
  }, [i18n, navigate, t, uiLanguage]);

  return null;
}
