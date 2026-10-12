// Whether the reader stopped the clouds. Kept across pages and visits, for the cover and the reading pages alike.

const key = "aih:motion";

export function stopped(): boolean {
  try {
    return localStorage.getItem(key) === "stopped";
  } catch {
    return false;
  }
}

export function remember(stop: boolean): void {
  try {
    if (stop) {
      localStorage.setItem(key, "stopped");
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // Without storage the choice still holds for this page.
  }
}
