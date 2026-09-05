import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";

import "./fonts.css";
import "./globals.css";

// index.html ships this element; the page has no other mount point.
const container = document.getElementById("root")!;

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
