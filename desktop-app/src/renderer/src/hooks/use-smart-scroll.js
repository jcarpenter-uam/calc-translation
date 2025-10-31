import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { useLanguage } from "../context/language.jsx";

const SCROLL_PADDING_BOTTOM = 96;

/**
 * A custom React hook that provides "smart" auto-scrolling for a dynamic list of content.
 * It automatically scrolls to the bottom when new items are added, but only if the user is already
 * near the bottom. It also provides notifications to the user about the auto-scroll status.
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
        const message =
          language === "english" ? "Auto Scroll On" : "自动滚动开启";
        showNotification(message);
      } else if (!isAtTarget && isAutoScrollEnabled) {
        setIsAutoScrollEnabled(false);
        const message =
          language === "english" ? "Auto Scroll Off" : "自动滚动关闭";
        showNotification(message);
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [isAutoScrollEnabled, language, lastElementRef]);

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
