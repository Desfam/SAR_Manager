import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { applyStoredTheme } from "./hooks/use-theme";
import "./index.css";

applyStoredTheme();
createRoot(document.getElementById("root")!).render(<App />);
