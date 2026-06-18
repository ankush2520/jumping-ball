export type AnalyticsEventParams = Record<string, unknown>;

const MEASUREMENT_ID = "G-TQENYKZDV3";

let hasTrackedWebsiteVisit = false;

const isBrowser = () => typeof window !== "undefined";

export const trackEvent = (
  eventName: string,
  eventParams: AnalyticsEventParams = {},
) => {
  console.log("[analytics] event", eventName, eventParams);

  if (!isBrowser() || typeof window.gtag !== "function") {
    console.warn("[analytics] gtag unavailable", {
      eventName,
      hasWindow: isBrowser(),
      hasGtag: isBrowser() && typeof window.gtag === "function",
    });
    return false;
  }

  window.gtag("event", eventName, eventParams);
  return true;
};

export const trackWebsiteVisit = () => {
  console.log("[analytics] website_visit fired");

  if (!isBrowser() || hasTrackedWebsiteVisit) {
    return;
  }

  const sent = trackEvent("website_visit", {
    page_title: document.title,
    page_location: window.location.href,
    page_path: window.location.pathname,
  });

  if (sent) {
    hasTrackedWebsiteVisit = true;
  }
};

export const analyticsDebug = () => {
  const hasWindow = typeof window !== "undefined";

  return {
    hasWindow,
    hasGtag: hasWindow && typeof window.gtag === "function",
    measurementId: MEASUREMENT_ID,
  };
};
