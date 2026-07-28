import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";

import { NotificationProvider } from "./design/notifications.js";
import { ThemeProvider } from "./design/theme.js";
import { I18nProvider } from "./i18n/index.js";
import { PilotProvider } from "./pilot/context.js";
import { router } from "./router.js";
import { ConversationRealtimeProvider } from "./realtime/context.js";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: 2,
      refetchOnWindowFocus: true,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <PilotProvider>
        <I18nProvider>
          <ThemeProvider>
            <NotificationProvider>
              <ConversationRealtimeProvider>
                <RouterProvider router={router} />
              </ConversationRealtimeProvider>
            </NotificationProvider>
          </ThemeProvider>
        </I18nProvider>
      </PilotProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
