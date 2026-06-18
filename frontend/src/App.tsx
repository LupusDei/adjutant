import { useState, useEffect, useCallback } from "react";
import { BeadsView } from "./components/beads/BeadsView";
import { ChatView } from "./components/chat/ChatView";
import { EpicsView } from "./components/epics/EpicsView";
import { CrewStats } from "./components/crew/CrewStats";
import { OverseerNotificationStatus } from "./components/notifications";
import { SettingsView } from "./components/settings/SettingsView";
import { CRTScreen } from "./components/shared/CRTScreen";
import { KeyboardDismiss } from "./components/shared/KeyboardDismiss";
import { ProjectSelector } from "./components/shared/ProjectSelector";
import { ProjectProvider } from "./contexts/ProjectContext";
import { CommunicationProvider } from "./contexts/CommunicationContext";
import { DashboardView } from "./components/dashboard/OverviewDashboard";
import { ProposalsView } from "./components/proposals/ProposalsView";
import { ProposalPage } from "./components/proposals/ProposalPage";
import { ProjectsView } from "./components/projects/ProjectsView";
import { TimelineView } from "./components/timeline/TimelineView";
import { EpicGraphPage } from "./components/beads/EpicGraphPage";
import { ChatBadge } from "./components/chat/ChatBadge";
import { OpenQuestionsView } from "./components/questions/OpenQuestionsView";
import { QuestionsBadge } from "./components/questions/QuestionsBadge";

export type ThemeId = 'pipboy' | 'document' | 'starcraft' | 'friendly' | 'glass';

/** Theme configuration — matches iOS CRTTheme.ColorTheme */
export interface ThemeConfig {
  id: ThemeId;
  label: string;
  crtEffects: boolean;
  darkMode: boolean;
}

export const THEME_CONFIGS: Record<ThemeId, ThemeConfig> = {
  pipboy:    { id: 'pipboy',    label: 'PIP-BOY',    crtEffects: true,  darkMode: true },
  document:  { id: 'document',  label: 'DOCUMENT',   crtEffects: false, darkMode: false },
  starcraft: { id: 'starcraft', label: 'STARCRAFT',  crtEffects: true,  darkMode: true },
  friendly:  { id: 'friendly',  label: 'FRIENDLY',   crtEffects: false, darkMode: false },
  glass:     { id: 'glass',     label: 'DARK MODE',   crtEffects: false, darkMode: true },
};

/** Migrate legacy theme values from old color-based system */
function migrateTheme(stored: string | null): ThemeId {
  if (!stored) return 'starcraft';
  if (stored in THEME_CONFIGS) return stored as ThemeId;
  // Legacy color names → starcraft (they were all CRT color variants)
  const legacyMap: Record<string, ThemeId> = {
    green: 'starcraft', red: 'starcraft', blue: 'starcraft',
    tan: 'starcraft', pink: 'starcraft', purple: 'starcraft',
  };
  return legacyMap[stored] ?? 'starcraft';
}

type TabId = "dashboard" | "chat" | "epics" | "crew" | "beads" | "projects" | "timeline" | "proposals" | "questions" | "settings";

interface Tab {
  id: TabId;
  label: string;
  icon: string;
}

const TABS: Tab[] = [
  { id: "dashboard", label: "OVERVIEW", icon: "📊" },
  { id: "chat", label: "CHAT", icon: "💬" },
  { id: "epics", label: "EPICS", icon: "📋" },
  { id: "crew", label: "AGENTS", icon: "👥" },
  { id: "beads", label: "BEADS", icon: "📿" },
  { id: "projects", label: "PROJECTS", icon: "🗂" },
  { id: "timeline", label: "TIMELINE", icon: "⏱" },
  { id: "proposals", label: "PROPOSALS", icon: "💡" },
  { id: "questions", label: "QUESTIONS", icon: "?" },
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
    () => migrateTheme(localStorage.getItem('gt-theme'))
  );
  const themeConfig = THEME_CONFIGS[theme];
  const isSmallScreen = useIsSmallScreen();

  // Apply theme to document element (html) globally for proper CSS variable cascade
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('gt-theme', theme);
  }, [theme]);

  return (
    <CRTScreen showBootSequence={true} enableFlicker={themeConfig.crtEffects} enableScanlines={themeConfig.crtEffects} enableNoise={themeConfig.crtEffects}>
      <div className="app-container">
        <header className="app-header">
          <h1 className="crt-glow">ADJUTANT</h1>
          <div className="header-controls">
            <OverseerNotificationStatus />
            <ProjectSelector />
          </div>
        </header>

        <nav className="app-nav">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={`nav-tab ${activeTab === tab.id ? "active" : ""}`}
              onClick={() => {
                setActiveTab(tab.id);
              }}
              title={tab.label}
            >
              {isSmallScreen && tab.id === "settings" ? tab.icon : tab.label}
              {tab.id === "chat" && <ChatBadge />}
              {tab.id === "questions" && <QuestionsBadge />}
            </button>
          ))}
        </nav>

        <main className="app-content">
          <section
            className="tab-view"
            hidden={activeTab !== "dashboard"}
            aria-hidden={activeTab !== "dashboard"}
          >
            <DashboardView onNavigateToChat={(agentName: string) => { setChatRecipient(agentName); setActiveTab('chat'); }} />
          </section>
          <section
            className="tab-view"
            hidden={activeTab !== "chat"}
            aria-hidden={activeTab !== "chat"}
          >
            <ChatView isActive={activeTab === "chat"} initialAgent={chatRecipient} onInitialAgentConsumed={() => { setChatRecipient(''); }} />
          </section>
          <section
            className="tab-view"
            hidden={activeTab !== "epics"}
            aria-hidden={activeTab !== "epics"}
          >
            <EpicsView isActive={activeTab === "epics"} />
          </section>
          <section
            className="tab-view"
            hidden={activeTab !== "crew"}
            aria-hidden={activeTab !== "crew"}
          >
            <CrewStats isActive={activeTab === "crew"} onNavigateToChat={(agentName: string) => { setChatRecipient(agentName); setActiveTab('chat'); }} />
          </section>
          <section
            className="tab-view"
            hidden={activeTab !== "beads"}
            aria-hidden={activeTab !== "beads"}
          >
            <BeadsView isActive={activeTab === "beads"} />
          </section>
          <section
            className="tab-view"
            hidden={activeTab !== "projects"}
            aria-hidden={activeTab !== "projects"}
          >
            <ProjectsView isActive={activeTab === "projects"} />
          </section>
          <section
            className="tab-view"
            hidden={activeTab !== "timeline"}
            aria-hidden={activeTab !== "timeline"}
          >
            <TimelineView isActive={activeTab === "timeline"} />
          </section>
          <section
            className="tab-view"
            hidden={activeTab !== "proposals"}
            aria-hidden={activeTab !== "proposals"}
          >
            <ProposalsView isActive={activeTab === "proposals"} />
          </section>
          <section
            className="tab-view"
            hidden={activeTab !== "questions"}
            aria-hidden={activeTab !== "questions"}
          >
            <OpenQuestionsView isActive={activeTab === "questions"} />
          </section>
          <section
            className="tab-view"
            hidden={activeTab !== "settings"}
            aria-hidden={activeTab !== "settings"}
          >
            <SettingsView theme={theme} setTheme={setTheme} isActive={activeTab === "settings"} />
          </section>
        </main>

        <KeyboardDismiss />
      </div>
    </CRTScreen>
  );
}

/**
 * Parse hash route for standalone pages.
 * Supports:
 *   #graph/<epicId>     — full-page dependency graph for an epic.
 *   #proposal/<id>      — full-page standalone proposal reader (adj-200).
 */
export type HashRoute =
  | { type: 'graph'; epicId: string }
  | { type: 'proposal'; proposalId: string };

export function parseHashRoute(): HashRoute | null {
  const hash = window.location.hash;
  const graphMatch = /^#graph\/(.+)$/.exec(hash);
  if (graphMatch?.[1]) {
    return { type: 'graph', epicId: decodeURIComponent(graphMatch[1]) };
  }
  const proposalMatch = /^#proposal\/(.+)$/.exec(hash);
  if (proposalMatch?.[1]) {
    return { type: 'proposal', proposalId: decodeURIComponent(proposalMatch[1]) };
  }
  return null;
}

function App() {
  const hashRoute = parseHashRoute();

  // Standalone graph page — render without the full dashboard chrome
  if (hashRoute?.type === 'graph') {
    return (
      <ProjectProvider>
        <EpicGraphPage epicId={hashRoute.epicId} />
      </ProjectProvider>
    );
  }

  // Standalone proposal page — full-page reader, no dashboard chrome
  if (hashRoute?.type === 'proposal') {
    return (
      <ProjectProvider>
        <ProposalPage proposalId={hashRoute.proposalId} />
      </ProjectProvider>
    );
  }

  return (
    <ProjectProvider>
      <CommunicationProvider>
        <AppContent />
      </CommunicationProvider>
    </ProjectProvider>
  );
}

export default App;
