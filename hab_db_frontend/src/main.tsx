// main.tsx (entry)
import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import "./index.css"; // <- this brings in @tailwind base/components/utilities
import App from "./App";
import ConformerPage from "./ConformerPage";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/conformers/:id" element={<ConformerPage />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
