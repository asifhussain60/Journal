import React from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { Toaster } from "sonner";
import { router } from "./routes/router";
import { useThemeStore } from "./stores/useThemeStore";
import { useIdentity } from "./stores/useIdentity";
import "./styles/tailwind.css";

// Reconcile the theme <link> with persisted store state on boot. The inline
// script in index.html already applied it pre-hydration to avoid a flash; this
// keeps React's store as the source of truth thereafter.
useThemeStore.getState().hydrateLink();

// Resolve who's signed in (and whether they may edit) once at boot. Fail-closed
// until it returns, so viewers never see the editing rail flash.
useIdentity.getState().load();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
    <Toaster position="bottom-right" richColors closeButton />
  </React.StrictMode>,
);
