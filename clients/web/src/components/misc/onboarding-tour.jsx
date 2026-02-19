import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { TourGuideClient } from "@sjmc11/tourguidejs";
import "@sjmc11/tourguidejs/dist/css/tour.min.css";
import { useAuth } from "../../context/auth";
import { TOUR_GROUP, getOnboardingTourSteps } from "../../tours/tour-steps";

const MAX_START_ATTEMPTS = 12;
const START_RETRY_MS = 150;
const READY_SELECTOR = "#landing-manual-join-web";

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

    const startTourWhenReady = async (attempt = 0) => {
      if (isCancelled) {
        return;
      }

      const hasTarget = document.querySelector(READY_SELECTOR);
      if (!hasTarget) {
        if (attempt < MAX_START_ATTEMPTS) {
          setTimeout(() => startTourWhenReady(attempt + 1), START_RETRY_MS);
        }
        if (attempt >= MAX_START_ATTEMPTS) {
          hasAttemptedStartRef.current = false;
        }
        return;
      }

      try {
        tg.setOptions({
          completeOnFinish: true,
          showStepProgress: true,
          keyboardControls: true,
          exitOnClickOutside: false,
          steps: getOnboardingTourSteps(navigate),
        });
        await tg.start(TOUR_GROUP);
      } catch (error) {
        console.error("Failed to start onboarding tour", error);
        hasAttemptedStartRef.current = false;
      }
    };

    startTourWhenReady();

    return () => {
      isCancelled = true;
    };
  }, [isLoading, navigate, pathname, user]);

  return null;
}
