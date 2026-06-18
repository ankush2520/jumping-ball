export type AnalyticsEventParams = Record<string, unknown>;

let hasTrackedWebsiteVisit = false;

const isBrowser = typeof window !== "undefined";

export const trackEvent = (
  eventName: string,
  eventParams: AnalyticsEventParams = {},
) => {
  if (!isBrowser || typeof window.gtag !== "function") {
    return;
  }

  window.gtag("event", eventName, eventParams);
};

export const trackWebsiteVisit = () => {
  if (!isBrowser || hasTrackedWebsiteVisit) {
    return;
  }

  hasTrackedWebsiteVisit = true;

  trackEvent("website_visit", {
    page_title: document.title,
    page_location: window.location.href,
    page_path: window.location.pathname,
  });
};
