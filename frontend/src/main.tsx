import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/main.css";
import App from "./App";
import { ErrorBoundary } from "./components/shared/ErrorBoundary";
import "./styles/globals.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
