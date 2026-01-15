import "@testing-library/jest-dom/vitest";
import { vi } from 'vitest';

// Configure React Testing Library to use act()
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

if (!window.matchMedia) {
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
}

// Global mocks for dashboard hooks
// vi.mock('../src/hooks/useDashboardMail', () => ({
//   useDashboardMail: vi.fn(() => ({
//     unreadMessages: [],
//     recentMessages: [],
//     loading: false,
//     error: null,
//   })),
// }));

// vi.mock('../src/hooks/useDashboardConvoys', () => ({
//   useDashboardConvoys: vi.fn(() => ({
//     recentConvoys: [],
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
