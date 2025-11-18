// main.tsx (entry)
import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";

import "./index.css"; // <- this brings in @tailwind base/components/utilities
import App from "./App";
import ConformerPage from "./ConformerPage";
import ReactionPage from "./ReactionPage";
import ManualMoleculePage from "./ManualMoleculePage";
import { ThemeProvider } from "./theme";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<App />} />
          {/* Reactions list view (opens App on the reactions tab) */}
          <Route path="/reactions" element={<App initialMode="reactions" />} />
          {/* Reaction detail */}
          <Route path="/reactions/:id" element={<ReactionPage />} />
          {/* Conformer detail */}
          <Route path="/conformers/:id" element={<ConformerPage />} />
          {/* Manual molecule builder */}
          <Route path="/draw" element={<ManualMoleculePage />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>,
);
