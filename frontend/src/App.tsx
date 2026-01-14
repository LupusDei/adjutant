import { useState } from "react";
import { CrewStats } from "./components/crew/CrewStats";
import { MailView } from "./components/mail/MailView";
import { NuclearPowerButton } from "./components/power/NuclearPowerButton";
import { CRTScreen } from "./components/shared/CRTScreen";
import { RigFilter } from "./components/shared/RigFilter";
import { RigProvider } from "./contexts/RigContext";

type TabId = "mail" | "crew";

interface Tab {
  id: TabId;
  label: string;
  icon: string;
}

const TABS: Tab[] = [
  { id: "mail", label: "MAIL", icon: "📧" },
  { id: "crew", label: "CREW", icon: "👥" },
];

function App() {
  const [activeTab, setActiveTab] = useState<TabId>("mail");

  return (
    <RigProvider>
      <CRTScreen showBootSequence={true} enableFlicker={true} enableScanlines={true} enableNoise={true}>
        <div className="app-container">
          <header className="app-header">
            <h1>GASTOWN-BOY</h1>
            <div className="header-controls">
              <RigFilter />
              <NuclearPowerButton />
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
              >
                {tab.label}
              </button>
            ))}
          </nav>

          <main className="app-content">
            {activeTab === "mail" && <MailView />}
            {activeTab === "crew" && <CrewStats />}
          </main>
        </div>
      </CRTScreen>
    </RigProvider>
  );
}

export default App;
