import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { useLanguage } from "../context/language.jsx";

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
  const prevScrollHeightRef = useRef(
    window.document.documentElement.scrollHeight,
  );
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
      const { scrollTop, clientHeight, scrollHeight } = scrollElement;
      const isAtBottom = scrollHeight - scrollTop <= clientHeight + 1;

      if (isAtBottom && !isAutoScrollEnabled) {
        setIsAutoScrollEnabled(true);
        const message =
          language === "english" ? "Auto Scroll On" : "自动滚动开启";
        showNotification(message);
      } else if (!isAtBottom && isAutoScrollEnabled) {
        setIsAutoScrollEnabled(false);
        const message =
          language === "english" ? "Auto Scroll Off" : "自动滚动关闭";
        showNotification(message);
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [isAutoScrollEnabled, language]);

  useLayoutEffect(() => {
    const scrollElement = window.document.documentElement;
    const { scrollTop, clientHeight, scrollHeight } = scrollElement;

    const wasAtBottom =
      scrollTop + clientHeight >= prevScrollHeightRef.current - 20;

    if (wasAtBottom) {
      if (lastElementRef.current) {
        ignoreScrollEventsRef.current = true;
        lastElementRef.current.scrollIntoView({
          behavior: "smooth",
          block: "end",
        });
      } else {
        ignoreScrollEventsRef.current = true;
        window.scrollTo({ top: scrollHeight, behavior: "smooth" });
      }

      if (scrollCooldownTimer.current) {
        clearTimeout(scrollCooldownTimer.current);
      }
      scrollCooldownTimer.current = setTimeout(() => {
        ignoreScrollEventsRef.current = false;
      }, 500);
    }

    prevScrollHeightRef.current = scrollHeight;
  }, [list, lastElementRef]);

  return notification;
}
