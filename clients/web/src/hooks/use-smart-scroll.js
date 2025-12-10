import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { useLanguage } from "../context/language.jsx";

// Define the desired padding (in pixels) from the bottom of the viewport.
// 96px = 6rem, which matches the pb-24 class.
const SCROLL_PADDING_BOTTOM = 96;

/**
 * A custom React hook that provides "smart" auto-scrolling for a dynamic list of content.
 * It automatically scrolls to the bottom when new items are added, but only if the user is already
 * near the bottom. It also provides notifications to the user about the auto-scroll status.
 *
 * @param {any[]} list A list of items (e.g., transcripts). The hook's primary scroll effect
 * is triggered when this list's reference changes.
 *
 * @returns {{
 * message: string;
 * visible: boolean;
 * }}
 */
export function useSmartScroll(list, lastElementRef) {
  const [notification, setNotification] = useState({
    message: "",
    visible: false,
  });
  const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState(true);
  const notificationTimeoutRef = useRef(null);
  const ignoreScrollEventsRef = useRef(false);
  const scrollCooldownTimer = useRef(null);

  const { language } = useLanguage();

  const showNotification = (message) => {
    if (notificationTimeoutRef.current) {
      clearTimeout(notificationTimeoutRef.current);
    }
    setNotification({ message, visible: true });
    notificationTimeoutRef.current = setTimeout(() => {
      setNotification({ message: "", visible: false });
    }, 3000);
  };

  useEffect(() => {
    const handleScroll = () => {
      if (ignoreScrollEventsRef.current) {
        return;
      }
      const scrollElement = window.document.documentElement;
      const { clientHeight } = scrollElement;

      let isAtTarget = false;
      if (lastElementRef.current) {
        const { bottom } = lastElementRef.current.getBoundingClientRect();
        isAtTarget = bottom <= clientHeight + 20;
      } else {
        const { scrollTop, scrollHeight } = scrollElement;
        isAtTarget = scrollHeight - scrollTop <= clientHeight + 1;
      }

      if (isAtTarget && !isAutoScrollEnabled) {
        setIsAutoScrollEnabled(true);
        showNotification(t("auto_scroll_on"));
      } else if (!isAtTarget && isAutoScrollEnabled) {
        setIsAutoScrollEnabled(false);
        showNotification(t("auto_scroll_off"));
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [isAutoScrollEnabled, t, lastElementRef]);

  useLayoutEffect(() => {
    if (isAutoScrollEnabled) {
      if (lastElementRef.current) {
        const { bottom } = lastElementRef.current.getBoundingClientRect();
        const targetScrollY =
          window.scrollY + bottom - window.innerHeight + SCROLL_PADDING_BOTTOM;

        window.scrollTo({
          top: targetScrollY,
          behavior: "auto",
        });
      } else {
        ignoreScrollEventsRef.current = true;
        window.scrollTo({
          top: window.document.documentElement.scrollHeight,
          behavior: "auto",
        });
      }

      if (scrollCooldownTimer.current) {
        clearTimeout(scrollCooldownTimer.current);
      }
      scrollCooldownTimer.current = setTimeout(() => {
        ignoreScrollEventsRef.current = false;
      }, 100);
    }
  }, [list, lastElementRef, isAutoScrollEnabled]);

  return notification;
}
