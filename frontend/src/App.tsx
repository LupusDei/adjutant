import { useState, useEffect, useCallback, useMemo } from "react";
import { BeadsView } from "./components/beads/BeadsView";
import { MayorChat } from "./components/chat/MayorChat";
import { EpicsView } from "./components/epics/EpicsView";
import { CrewStats } from "./components/crew/CrewStats";
import { MailView } from "./components/mail/MailView";
import { OverseerNotificationStatus } from "./components/notifications";
import { NuclearPowerButton } from "./components/power/NuclearPowerButton";
import { SettingsView } from "./components/settings/SettingsView";
import { CRTScreen } from "./components/shared/CRTScreen";
import { QuickInput } from "./components/shared/QuickInput";
import { RigFilter } from "./components/shared/RigFilter";
import { RigProvider } from "./contexts/RigContext";
import { CommunicationProvider } from "./contexts/CommunicationContext";
import { ModeProvider, useModeContext } from "./contexts/ModeContext";
import { DashboardView } from "./components/dashboard/OverviewDashboard";

export type ThemeId = 'green' | 'red' | 'blue' | 'tan' | 'pink' | 'purple';

type TabId = "dashboard" | "mail" | "chat" | "epics" | "crew" | "beads" | "settings";

interface Tab {
  id: TabId;
  label: string;
  icon: string;
  /** Features that enable this tab (empty = always visible). Tab shows if ANY feature matches. */
  requiredFeatures: string[];
}

const TABS: Tab[] = [
  { id: "dashboard", label: "OVERVIEW", icon: "📊", requiredFeatures: ["dashboard"] },
  { id: "mail", label: "MAIL", icon: "📧", requiredFeatures: ["mail"] },
  { id: "chat", label: "CHAT", icon: "💬", requiredFeatures: [] },
  { id: "epics", label: "EPICS", icon: "📋", requiredFeatures: ["epics"] },
  { id: "crew", label: "CREW", icon: "👥", requiredFeatures: ["crew_hierarchy", "crew_flat"] },
  { id: "beads", label: "BEADS", icon: "📿", requiredFeatures: [] },
  { id: "settings", label: "SETTINGS", icon: "⚙️", requiredFeatures: [] },
];

function useIsSmallScreen(breakpoint = 768) {
  const [isSmall, setIsSmall] = useState(
    typeof window !== 'undefined' ? window.innerWidth <= breakpoint : false
  );

  const handleResize = useCallback(() => {
    setIsSmall(window.innerWidth <= breakpoint);
  }, [breakpoint]);

  useEffect(() => {
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [handleResize]);

  return isSmall;
}

function AppContent() {
  const { features, loading } = useModeContext();

  // Filter tabs based on current mode features
  const visibleTabs = useMemo(() => {
    if (loading) return TABS; // Show all tabs while loading to avoid flash
    return TABS.filter((tab) => {
      if (tab.requiredFeatures.length === 0) return true;
      return tab.requiredFeatures.some((f) => features.includes(f));
    });
  }, [features, loading]);

  const visibleTabIds = useMemo(() => new Set(visibleTabs.map((t) => t.id)), [visibleTabs]);

  const [activeTab, setActiveTab] = useState<TabId>("dashboard");
  const [theme, setTheme] = useState<ThemeId>(
    (localStorage.getItem('gt-theme') as ThemeId) || 'green'
  );
  const isSmallScreen = useIsSmallScreen();

  // Route guard: if active tab becomes unavailable, redirect to first visible tab
  useEffect(() => {
    if (!loading && !visibleTabIds.has(activeTab)) {
      const fallback = visibleTabs[0];
      if (fallback) {
        setActiveTab(fallback.id);
      }
    }
  }, [activeTab, visibleTabIds, visibleTabs, loading]);

  // Apply theme to document element (html) globally for proper CSS variable cascade
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('gt-theme', theme);
  }, [theme]);

  return (
    <CommunicationProvider>
    <CRTScreen showBootSequence={true} enableFlicker={true} enableScanlines={true} enableNoise={true}>
      <div className="app-container">
        <header className="app-header">
          <h1 className="crt-glow">ADJUTANT</h1>
          <div className="header-controls">
            <OverseerNotificationStatus />
            <RigFilter />
            <NuclearPowerButton comingSoon={true} />
          </div>
        </header>

        <nav className="app-nav">
          {visibleTabs.map((tab) => (
            <button
              key={tab.id}
              className={`nav-tab ${activeTab === tab.id ? "active" : ""}`}
              onClick={() => {
                setActiveTab(tab.id);
              }}
              title={tab.label}
            >
              {isSmallScreen && tab.id === "settings" ? tab.icon : tab.label}
            </button>
          ))}
        </nav>

        <main className="app-content">
          {visibleTabIds.has("dashboard") && (
            <section
              className="tab-view"
              hidden={activeTab !== "dashboard"}
              aria-hidden={activeTab !== "dashboard"}
            >
              <DashboardView />
            </section>
          )}
          {visibleTabIds.has("mail") && (
            <section
              className="tab-view"
              hidden={activeTab !== "mail"}
              aria-hidden={activeTab !== "mail"}
            >
              <MailView isActive={activeTab === "mail"} />
            </section>
          )}
          <section
            className="tab-view"
            hidden={activeTab !== "chat"}
            aria-hidden={activeTab !== "chat"}
          >
            <MayorChat isActive={activeTab === "chat"} />
          </section>
          {visibleTabIds.has("epics") && (
            <section
              className="tab-view"
              hidden={activeTab !== "epics"}
              aria-hidden={activeTab !== "epics"}
            >
              <EpicsView isActive={activeTab === "epics"} />
            </section>
          )}
          {visibleTabIds.has("crew") && (
            <section
              className="tab-view"
              hidden={activeTab !== "crew"}
              aria-hidden={activeTab !== "crew"}
            >
              <CrewStats isActive={activeTab === "crew"} />
            </section>
          )}
          <section
            className="tab-view"
            hidden={activeTab !== "beads"}
            aria-hidden={activeTab !== "beads"}
          >
            <BeadsView isActive={activeTab === "beads"} />
          </section>
          <section
            className="tab-view"
            hidden={activeTab !== "settings"}
            aria-hidden={activeTab !== "settings"}
          >
            <SettingsView theme={theme} setTheme={setTheme} isActive={activeTab === "settings"} />
          </section>
        </main>

        <QuickInput />
      </div>
    </CRTScreen>
    </CommunicationProvider>
  );
}

function App() {
  return (
    <ModeProvider>
      <RigProvider>
        <AppContent />
      </RigProvider>
    </ModeProvider>
  );
}

export default App;
