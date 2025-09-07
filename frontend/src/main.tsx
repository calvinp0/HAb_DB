// main.tsx (entry)
import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import "./index.css"; // <- this brings in @tailwind base/components/utilities
import App from "./App";
import ConformerPage from "./ConformerPage";
import ReactionPage from "./ReactionPage";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        {/* Reactions list view (opens App on the reactions tab) */}
        <Route path="/reactions" element={<App initialMode="reactions" />} />
        {/* Reaction detail */}
        <Route path="/reactions/:id" element={<ReactionPage />} />
        {/* Conformer detail */}
        <Route path="/conformers/:id" element={<ConformerPage />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
