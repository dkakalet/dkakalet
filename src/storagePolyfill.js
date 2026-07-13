// Polyfills the `window.storage` sandbox API (get/set) used by WorkoutTracker
// with a plain localStorage-backed implementation, so the app persists data
// as a standalone website.
if (typeof window !== "undefined" && !window.storage) {
  window.storage = {
    async get(key) {
      const value = window.localStorage.getItem(key);
      return value == null ? null : { value };
    },
    async set(key, value) {
      window.localStorage.setItem(key, value);
      return true;
    },
  };
}
