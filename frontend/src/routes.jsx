import { createBrowserRouter, Navigate } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { IntegrationHome } from "./pages/IntegrationHome";
import { ConnectJira } from "./pages/ConnectJira";
import { SyncRun } from "./pages/SyncRun";
import { SyncGroupDetail } from "./pages/SyncGroupDetail";
import { SyncHistory } from "./pages/SyncHistory";
import { SyncReview } from "./pages/SyncReview";
import { FailedRecords } from "./pages/FailedRecords";
import { AdminReviewLayout } from "./pages/admin/AdminReviewLayout";
import { AllRecords } from "./pages/admin/AllRecords";
import { AnalyticsLayout } from "./pages/analytics/AnalyticsLayout";
import { AnalyticsOverviewLayout } from "./pages/analytics/AnalyticsOverviewLayout";
import { Overview } from "./pages/analytics/Overview";
import { TeamPage } from "./pages/analytics/TeamPage";
import { AiAdoptionLayout } from "./pages/analytics/AiAdoptionLayout";
import { AiAdoption } from "./pages/analytics/AiAdoption";
import { AiAdoptionTeam } from "./pages/analytics/AiAdoptionTeam";
import { ResourceLayout } from "./pages/analytics/ResourceLayout";
import { Resource } from "./pages/analytics/Resource";
import { ResourceTeam } from "./pages/analytics/ResourceTeam";
import { QualityLayout } from "./pages/analytics/QualityLayout";
import { Quality } from "./pages/analytics/Quality";
import { QualityTeam } from "./pages/analytics/QualityTeam";
import { WorkspaceLayout } from "./pages/workspace/WorkspaceLayout";
import { TestAutomationLayout } from "./pages/workspace/TestAutomationLayout";
import { CoverageOverview } from "./pages/workspace/CoverageOverview";
import { ExecutionPlaceholder } from "./pages/workspace/ExecutionPlaceholder";
import { TestCoverageUpload } from "./pages/admin/TestCoverageUpload";
import { TicketsGrid } from "./pages/admin/TicketsGrid";

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: "/", element: <Navigate to="/integrations" replace /> },
      { path: "/integrations", element: <IntegrationHome /> },
      { path: "/integrations/connect", element: <ConnectJira /> },
      { path: "/integrations/sync/group/:syncGroupId", element: <SyncGroupDetail /> },
      { path: "/integrations/sync/:syncStateId", element: <SyncRun /> },
      { path: "/integrations/history", element: <SyncHistory /> },
      { path: "/integrations/failed", element: <FailedRecords /> },
      {
        element: <AdminReviewLayout />,
        children: [
          { path: "/integrations/staging", element: <SyncReview /> },
          { path: "/integrations/all-records", element: <AllRecords /> },
        ],
      },
      {
        path: "/analytics",
        element: <AnalyticsLayout />,
        children: [
          {
            element: <AnalyticsOverviewLayout />,
            children: [
              { index: true, element: <Overview /> },
              { path: "team/:teamId", element: <TeamPage /> },
            ],
          },
          {
            path: "ai-adoption",
            element: <AiAdoptionLayout />,
            children: [
              { index: true, element: <AiAdoption /> },
              { path: "team/:teamId", element: <AiAdoptionTeam /> },
            ],
          },
          {
            path: "resource",
            element: <ResourceLayout />,
            children: [
              { index: true, element: <Resource /> },
              { path: "team/:teamId", element: <ResourceTeam /> },
            ],
          },
          {
            path: "quality",
            element: <QualityLayout />,
            children: [
              { index: true, element: <Quality /> },
              { path: "team/:teamId", element: <QualityTeam /> },
            ],
          },
        ],
      },
      {
        path: "/workspace",
        element: <WorkspaceLayout />,
        children: [
          {
            path: "test-automation",
            element: <TestAutomationLayout />,
            children: [
              { index: true, element: <Navigate to="coverage" replace /> },
              { path: "coverage", element: <CoverageOverview /> },
              { path: "execution", element: <ExecutionPlaceholder /> },
            ],
          },
        ],
      },
      { path: "/admin/tickets", element: <TicketsGrid /> },
      { path: "/admin/test-coverage", element: <TestCoverageUpload /> },
      { path: "*", element: <Navigate to="/integrations" replace /> },
    ],
  },
]);
