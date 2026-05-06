import { createBrowserRouter, Navigate } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { IntegrationHome } from "./pages/IntegrationHome";
import { ConnectJira } from "./pages/ConnectJira";
import { SyncRun } from "./pages/SyncRun";
import { SyncGroupDetail } from "./pages/SyncGroupDetail";
import { SyncHistory } from "./pages/SyncHistory";
import { SyncReview } from "./pages/SyncReview";
import { FailedRecords } from "./pages/FailedRecords";
import { AnalyticsLayout } from "./pages/analytics/AnalyticsLayout";
import { Overview } from "./pages/analytics/Overview";
import { TeamPage } from "./pages/analytics/TeamPage";

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: "/", element: <Navigate to="/integrations" replace /> },
      { path: "/integrations", element: <IntegrationHome /> },
      { path: "/integrations/connect", element: <ConnectJira /> },
      { path: "/integrations/sync/group/:syncGroupId", element: <SyncGroupDetail /> },
      { path: "/integrations/sync/:syncStateId", element: <SyncRun /> },
      { path: "/integrations/staging", element: <SyncReview /> },
      { path: "/integrations/history", element: <SyncHistory /> },
      { path: "/integrations/failed", element: <FailedRecords /> },
      {
        path: "/analytics",
        element: <AnalyticsLayout />,
        children: [
          { index: true, element: <Overview /> },
          { path: "team/:teamId", element: <TeamPage /> },
        ],
      },
      { path: "*", element: <Navigate to="/integrations" replace /> },
    ],
  },
]);
