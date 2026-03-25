import "@testing-library/jest-dom/vitest";

// Configure React Testing Library to use act()
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Polyfill localStorage for jsdom (some versions lack standard methods)
if (typeof globalThis.localStorage === 'undefined' || typeof globalThis.localStorage.clear !== 'function') {
  const store = new Map<string, string>();
  const localStoragePolyfill = {
    getItem: (key: string) => store.get(key) ?? null,
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-conversion
    setItem: (key: string, value: string) => { store.set(key, String(value)); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    get length() { return store.size; },
    key: (index: number) => [...store.keys()][index] ?? null,
  };
  Object.defineProperty(globalThis, 'localStorage', { value: localStoragePolyfill, writable: true });
  Object.defineProperty(window, 'localStorage', { value: localStoragePolyfill, writable: true });
}

// Polyfill matchMedia for jsdom
window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  });

// Global mocks for dashboard hooks
// vi.mock('../src/hooks/useDashboardMail', () => ({
//   useDashboardMail: vi.fn(() => ({
//     unreadMessages: [],
//     recentMessages: [],
//     loading: false,
//     error: null,
//   })),
// }));


// vi.mock('../src/hooks/useDashboardCrew', () => ({
//   useDashboardCrew: vi.fn(() => ({
//     totalCrew: 0,
//     activeCrew: 0,
//     crewAlerts: [],
//     loading: false,
//     error: null,
//   })),
// }));
