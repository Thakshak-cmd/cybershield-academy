import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import "./theme.css";

const root = document.getElementById("root");
if (!root) throw new Error('No #root element - index.html is missing its mount point');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
