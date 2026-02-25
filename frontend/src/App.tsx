import { useState, useEffect, useCallback, useMemo } from "react";
import { BeadsView } from "./components/beads/BeadsView";
import { ChatView } from "./components/chat/ChatView";
import { EpicsView } from "./components/epics/EpicsView";
import { CrewStats } from "./components/crew/CrewStats";
import { MailView } from "./components/mail/MailView";
import { OverseerNotificationStatus } from "./components/notifications";
import { NuclearPowerButton } from "./components/power/NuclearPowerButton";
import { SettingsView } from "./components/settings/SettingsView";
import { CRTScreen } from "./components/shared/CRTScreen";
import { QuickInput } from "./components/shared/QuickInput";
import { KeyboardDismiss } from "./components/shared/KeyboardDismiss";
import { RigFilter } from "./components/shared/RigFilter";
import { RigProvider } from "./contexts/RigContext";
import { CommunicationProvider } from "./contexts/CommunicationContext";
import { ModeProvider, useVisibleTabs } from "./contexts/ModeContext";
import { DashboardView } from "./components/dashboard/OverviewDashboard";
import { ProposalsView } from "./components/proposals/ProposalsView";
import { useUnreadCounts } from "./hooks/useUnreadCounts";

export type ThemeId = 'green' | 'red' | 'blue' | 'tan' | 'pink' | 'purple';

type TabId = "dashboard" | "mail" | "chat" | "epics" | "crew" | "beads" | "proposals" | "settings";

interface Tab {
  id: TabId;
  label: string;
  icon: string;
}

const TABS: Tab[] = [
  { id: "dashboard", label: "OVERVIEW", icon: "📊" },
  { id: "mail", label: "MAIL", icon: "📧" },
  { id: "chat", label: "CHAT", icon: "💬" },
  { id: "epics", label: "EPICS", icon: "📋" },
  { id: "crew", label: "CREW", icon: "👥" },
  { id: "beads", label: "BEADS", icon: "📿" },
  { id: "proposals", label: "PROPOSALS", icon: "💡" },
  { id: "settings", label: "SETTINGS", icon: "⚙️" },
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
    return () => { window.removeEventListener('resize', handleResize); };
  }, [handleResize]);

  return isSmall;
}

function AppContent() {
  const [activeTab, setActiveTab] = useState<TabId>("dashboard");
  const [chatRecipient, setChatRecipient] = useState('');
  const [theme, setTheme] = useState<ThemeId>(
    (localStorage.getItem('gt-theme') as ThemeId | null) ?? 'green'
  );
  const isSmallScreen = useIsSmallScreen();
  const visibleTabs = useVisibleTabs();
  const { totalUnread } = useUnreadCounts();

  // Filter tabs based on current mode
  const filteredTabs = useMemo(
    () => TABS.filter((tab) => visibleTabs.has(tab.id)),
    [visibleTabs]
  );

  // Redirect to first visible tab if current tab becomes hidden
  useEffect(() => {
    if (!visibleTabs.has(activeTab) && filteredTabs.length > 0) {
      setActiveTab(filteredTabs[0].id);
    }
  }, [visibleTabs, activeTab, filteredTabs]);

  // Apply theme to document element (html) globally for proper CSS variable cascade
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('gt-theme', theme);
  }, [theme]);

  return (
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
          {filteredTabs.map((tab) => (
            <button
              key={tab.id}
              className={`nav-tab ${activeTab === tab.id ? "active" : ""}`}
              onClick={() => {
                setActiveTab(tab.id);
              }}
              title={tab.label}
            >
              {isSmallScreen && tab.id === "settings" ? tab.icon : tab.label}
              {tab.id === "chat" && totalUnread > 0 && (
                <span className="nav-tab-badge">{totalUnread > 99 ? '99+' : totalUnread}</span>
              )}
            </button>
          ))}
        </nav>

        <main className="app-content">
          {visibleTabs.has("dashboard") && (
            <section
              className="tab-view"
              hidden={activeTab !== "dashboard"}
              aria-hidden={activeTab !== "dashboard"}
            >
              <DashboardView onNavigateToChat={(agentName: string) => { setChatRecipient(agentName); setActiveTab('chat'); }} />
            </section>
          )}
          {visibleTabs.has("mail") && (
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
            <ChatView isActive={activeTab === "chat"} initialAgent={chatRecipient} onInitialAgentConsumed={() => setChatRecipient('')} />
          </section>
          {visibleTabs.has("epics") && (
            <section
              className="tab-view"
              hidden={activeTab !== "epics"}
              aria-hidden={activeTab !== "epics"}
            >
              <EpicsView isActive={activeTab === "epics"} />
            </section>
          )}
          {visibleTabs.has("crew") && (
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
          {visibleTabs.has("proposals") && (
            <section
              className="tab-view"
              hidden={activeTab !== "proposals"}
              aria-hidden={activeTab !== "proposals"}
            >
              <ProposalsView isActive={activeTab === "proposals"} />
            </section>
          )}
          <section
            className="tab-view"
            hidden={activeTab !== "settings"}
            aria-hidden={activeTab !== "settings"}
          >
            <SettingsView theme={theme} setTheme={setTheme} isActive={activeTab === "settings"} />
          </section>
        </main>

        <QuickInput />
        <KeyboardDismiss />
      </div>
    </CRTScreen>
  );
}

function App() {
  return (
    <ModeProvider>
      <RigProvider>
        <CommunicationProvider>
          <AppContent />
        </CommunicationProvider>
      </RigProvider>
    </ModeProvider>
  );
}

export default App;
