import { useState } from "react";
import { MailView } from "./components/mail/MailView";
import { PowerButton } from "./components/power/PowerButton";

type TabId = "mail" | "power" | "crew";

interface Tab {
  id: TabId;
  label: string;
}

const TABS: Tab[] = [
  { id: "mail", label: "MAIL" },
  { id: "power", label: "POWER" },
  { id: "crew", label: "CREW" },
];

function App() {
  const [activeTab, setActiveTab] = useState<TabId>("mail");

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>GASTOWN BOY</h1>
      </header>

      <nav className="app-nav">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`nav-tab ${activeTab === tab.id ? "active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <main className="app-content">
        {activeTab === "mail" && <MailView />}
        {activeTab === "power" && <PowerButton />}
        {activeTab === "crew" && (
          <div className="tab-panel">
            <h2>Crew</h2>
            <p>Team management</p>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
