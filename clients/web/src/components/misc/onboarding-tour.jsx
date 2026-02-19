import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { TourGuideClient } from "@sjmc11/tourguidejs";
import "@sjmc11/tourguidejs/dist/css/tour.min.css";
import { useAuth } from "../../context/auth";
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

async function startTourWhenReady({
  tg,
  navigate,
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
    await tg.setOptions({
      completeOnFinish: true,
      showStepProgress: true,
      keyboardControls: false,
      hidePrev: true,
      exitOnClickOutside: false,
      steps: getOnboardingTourSteps(navigate),
    });
    await tg.start(TOUR_GROUP);
  } catch (error) {
    console.error("Failed to start onboarding tour", error);
    hasAttemptedStartRef.current = false;
  }
}

export default function OnboardingTour() {
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
        await waitForFrames();
        await clientRef.current?.updatePositions();
      });
    }
  }, []);

  useEffect(() => {
    if (isLoading || !user || pathname !== "/") {
      return;
    }

    const tg = clientRef.current;
    if (!tg || tg.isFinished(TOUR_GROUP) || hasAttemptedStartRef.current) {
      return;
    }

    hasAttemptedStartRef.current = true;
    let isCancelled = false;
    startTourWhenReady({
      tg,
      navigate,
      hasAttemptedStartRef,
      shouldCancel: () => isCancelled,
    });

    return () => {
      isCancelled = true;
    };
  }, [isLoading, navigate, pathname, user]);

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
        startTourWhenReady({
          tg,
          navigate,
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
  }, [navigate]);

  return null;
}
