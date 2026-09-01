import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  ActivityPage,
  AnalyticsPage,
  AuthPage,
  CategoriesPage,
  DashboardPage,
  DuplicatesPage,
  FileDetailPage,
  FilesPage,
  HomePage,
  NotFoundPage,
  ProfilePage,
  ProvidersPage,
  SettingsPage,
  SharedFilePage,
  SharesPage,
  StorageAllocationPage,
} from '@/components/cloudnest';
import {
  Route,
  Switch,
  useLocation,
  useParams,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();

function FileDetailsRoute() {
  const params = useParams<{ id: string }>();
  return <FileDetailPage id={params.id || ''} />;
}

function SharedFileRoute() {
  const params = useParams<{ token: string }>();
  return <SharedFilePage token={params.token || ''} />;
}

function Router() {
  return (
    // Keep a shared shell (sidebar, navbar) outside the boundary so it
    // survives a page crash.
    <RoutedErrorBoundary>
      <Switch>
       <Route path="/" component={() => <AuthPage />} />
       <Route path="/home" component={HomePage} />
        <Route path="/login" component={() => <AuthPage />} />
        <Route path="/register" component={() => <AuthPage register />} />
        <Route path="/dashboard" component={DashboardPage} />
        <Route path="/files" component={() => <FilesPage />} />
        <Route path="/files/:id" component={FileDetailsRoute} />
        <Route path="/providers" component={ProvidersPage} />
        <Route path="/search" component={() => <FilesPage searchMode />} />
        <Route path="/categories" component={CategoriesPage} />
        <Route path="/duplicates" component={DuplicatesPage} />
        <Route path="/shares" component={SharesPage} />
        <Route path="/allocation" component={StorageAllocationPage} />
        <Route path="/analytics" component={AnalyticsPage} />
        <Route path="/activity" component={ActivityPage} />
        <Route path="/profile" component={ProfilePage} />
        <Route path="/settings" component={SettingsPage} />
        <Route path="/s/:token" component={SharedFileRoute} />
        <Route component={NotFoundPage} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
