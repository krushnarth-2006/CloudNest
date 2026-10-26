import { type ReactNode, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  Activity as ActivityIcon, AlertTriangle, ArrowRightLeft, BarChart3, Bell, Check, ChevronRight,
  CircleHelp, Cloud, Copy, FileArchive, FileImage, FilePlus2, FileSpreadsheet,
  FileText, Folder, FolderPlus, HardDrive, LayoutDashboard, LayoutGrid, Link2, List, ListFilter, LockKeyhole,
  LogOut, Menu, MoreHorizontal, Network, PanelLeftClose, Pencil, Plus, RefreshCw,
  Search, Settings, Share2, ShieldCheck, SlidersHorizontal, Sparkles, Keyboard, Trash2,
  UploadCloud, UserRound, X, Zap
} from "lucide-react";
import {
  getGetAnalyticsQueryKey, getGetDashboardQueryKey, getGetFileQueryKey,
  getHealthCheckQueryKey, getListActivityQueryKey, getListDuplicatesQueryKey,
  getListFilesQueryKey, getListProvidersQueryKey, getListSharesQueryKey,
  getGetMeQueryKey, getGetAllocationRecommendationQueryKey,
  useConnectProvider, useCreateShare, useDeleteFile, useDisconnectProvider,
  useGetAnalytics, useGetDashboard, useGetFile, useHealthCheck, useListActivity,
  useListDuplicates, useListFiles, useListProviders, useListShares,
  useRevokeShare, useUploadFile, useGetMe, useUpdateMe, useChangePassword, useLogout,
  useRenameFile, useMoveFile, useMigrateFile, useCreateFolder, useGetAllocationRecommendation,
  useSyncProvider, useCopyFile,
} from "@workspace/api-client-react";
import type { Activity, Analytics, Dashboard, DuplicateGroup, File as CloudFile, Metric, Provider, Share, UserProfile, AllocationRecommendation, SyncSummary } from "@workspace/api-client-react";

const nav = [
  { label: "Overview", href: "/dashboard", icon: LayoutDashboard },
  { label: "All files", href: "/files", icon: Folder },
  { label: "Providers", href: "/providers", icon: Network },
  { label: "Search", href: "/search", icon: Search },
  { label: "Categories", href: "/categories", icon: ListFilter },
  { label: "Duplicates", href: "/duplicates", icon: Copy },
  { label: "Share links", href: "/shares", icon: Link2 },
  { label: "Storage allocation", href: "/allocation", icon: ArrowRightLeft },
  { label: "Analytics", href: "/analytics", icon: BarChart3 },
  { label: "Activity", href: "/activity", icon: ActivityIcon },
];

const formatBytes = (bytes = 0) => {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${units[i]}`;
};
const formatDate = (date?: string) => date ? new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(date)) : "—";
const timeAgo = (date?: string) => {
  if (!date) return "—";
  const diff = Math.max(0, Date.now() - new Date(date).getTime());
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
};
const titleCase = (value = "") => value.toLowerCase().replace(/(^|\s)\S/g, (l) => l.toUpperCase());
const providerColor = (name = "") => ({ "Google Drive": "#2ea6b1", OneDrive: "#5576c5", Dropbox: "#e59b2f" }[name] || "#7a8da4");
const fileIcon = (mime = "") => mime.includes("image") ? FileImage : mime.includes("spreadsheet") || mime.includes("excel") ? FileSpreadsheet : mime.includes("pdf") || mime.includes("text") ? FileText : mime.includes("zip") || mime.includes("archive") ? FileArchive : FileText;
const SETTINGS_KEYS = {
  compact: "cloudnest-compact-file-rows",
  notifications: "cloudnest-activity-notifications",
  notificationHistory: "cloudnest-notification-history",

};

function useCloudNestSetting(key: string, defaultValue: boolean) {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(key);
      return saved === null ? defaultValue : saved === "true";
    } catch {
      return defaultValue;
    }
  });

  useEffect(() => {
    const handleChange = () => {
      try {
        const saved = localStorage.getItem(key);
        setValue(saved === null ? defaultValue : saved === "true");
      } catch {
        setValue(defaultValue);
      }
    };

    window.addEventListener("cloudnest-settings-change", handleChange);
    window.addEventListener("storage", handleChange);

    return () => {
      window.removeEventListener("cloudnest-settings-change", handleChange);
      window.removeEventListener("storage", handleChange);
    };
  }, [key, defaultValue]);

  const update = (nextValue: boolean) => {
    setValue(nextValue);

    try {
      localStorage.setItem(key, String(nextValue));
      window.dispatchEvent(new Event("cloudnest-settings-change"));
    } catch {
      // Ignore localStorage errors.
    }
  };

  return [value, update] as const;
}
function Logo({ light = false }: { light?: boolean }) {
return <Link href="/home" className="flex items-center gap-2.5" data-testid="link-logo">
      <span className={`grid size-8 place-items-center rounded-[10px] ${light ? "bg-[hsl(var(--sidebar-primary))] text-[hsl(var(--sidebar)] )" : "bg-[hsl(var(--primary))] text-white"}`}>
      <Cloud className="size-[17px]" strokeWidth={2.5} />
    </span>
    <span className={`font-semibold tracking-[-.04em] text-[17px] ${light ? "text-white" : "text-[hsl(var(--foreground))]"}`}>cloudnest</span>
  </Link>;
}
type CurrentUser = {
  id: string;
  name: string;
  email: string;
};

function getInitials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "U";
}
function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const logout = useLogout();
  const [signOutConfirm, setSignOutConfirm] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const [notificationsEnabled] = useCloudNestSetting(
    SETTINGS_KEYS.notifications,
    true
  );

  type CloudNestNotification = {
  id: string;
  message: string;
  type: "success" | "error" | "info" | "warning";
  createdAt: number;
};

const [notifications, setNotifications] = useState<
  CloudNestNotification[]
>(() => {
  try {
    const saved = localStorage.getItem(
      SETTINGS_KEYS.notificationHistory
    );

    if (!saved) return [];

    return JSON.parse(saved) as CloudNestNotification[];
  } catch {
    return [];
  }
});

const [notificationsOpen, setNotificationsOpen] = useState(false);
useEffect(() => {
  try {
    localStorage.setItem(
      SETTINGS_KEYS.notificationHistory,
      JSON.stringify(notifications)
    );
  } catch {
    // Ignore localStorage errors.
  }
}, [notifications]);

useEffect(() => {
  const handleCloudNestNotification = (event: Event) => {
    if (!notificationsEnabled) return;

    const customEvent =
      event as CustomEvent<{
        message: string;
        type?: "success" | "error" | "info" | "warning";
      }>;

    const newNotification: CloudNestNotification = {
      id: `${Date.now()}-${Math.random()}`,
      message: customEvent.detail.message,
      type: customEvent.detail.type ?? "info",
      createdAt: Date.now(),
    };

    setNotifications((previous) => [
      newNotification,
      ...previous,
    ].slice(0, 20));
  };

  window.addEventListener(
    "cloudnest-notification",
    handleCloudNestNotification
  );

  return () => {
    window.removeEventListener(
      "cloudnest-notification",
      handleCloudNestNotification
    );
  };
}, [notificationsEnabled]);
  const duplicatesQ = useListDuplicates({
  query: { queryKey: getListDuplicatesQueryKey() },
});
const duplicateCount = (duplicatesQ.data as DuplicateGroup[] | undefined)?.length ?? 0;
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);

useEffect(() => {
  let cancelled = false;

  async function loadCurrentUser() {
    try {
      const response = await fetch("/api/auth/me", {
        credentials: "include",
      });

      if (!response.ok) return;

      const user = (await response.json()) as CurrentUser;

      if (!cancelled) {
        setCurrentUser(user);
      }
    } catch {
      // Ignore user loading errors.
    }
  }

  loadCurrentUser();

  return () => {
    cancelled = true;
  };
}, []);


  const current = nav.find((item) => location === item.href || (item.href !== "/dashboard" && location.startsWith(item.href)));
  const extraLabels: Record<string, string> = { "/settings": "Settings", "/profile": "Profile" };
  const crumbLabel = current?.label ?? extraLabels[location] ?? "Home";
  return <div className="cn-app cn-noise flex min-h-[100dvh]">
<aside className="cn-sidebar fixed inset-y-0 left-0 z-30 flex h-screen w-[244px] flex-col overflow-hidden border-r border-[hsl(var(--sidebar-border))]">

  <div className="shrink-0 px-3 pb-5">
    <Logo light />
  </div>

  <div className="flex-1 min-h-0 overflow-y-auto px-3">

    <div className="mb-3 px-3 text-[10px] font-medium uppercase tracking-[.16em] text-[hsl(var(--sidebar-foreground)/.38)]">
      Workspace
    </div>

    <nav className="space-y-1">
      {nav.slice(0, 5).map(({ label, href, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          onClick={() => setMobileOpen(false)}
          className={`cn-nav-item flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium ${
            current?.href === href ? "active" : ""
          }`}
          data-testid={`link-nav-${label.toLowerCase().replace(" ", "-")}`}
        >
          <Icon className="size-[17px]" strokeWidth={1.8} />
          <span>{label}</span>

          {label === "Search" && (
            <span className="ml-auto cn-mono text-[9px] opacity-40">
              ⌘K
            </span>
          )}
        </Link>
      ))}
    </nav>

    <div className="mb-3 mt-8 px-3 text-[10px] font-medium uppercase tracking-[.16em] text-[hsl(var(--sidebar-foreground)/.38)]">
      Manage
    </div>

    <nav className="space-y-1">
      {nav.slice(5).map(({ label, href, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          onClick={() => setMobileOpen(false)}
          className={`cn-nav-item flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium ${
            current?.href === href ? "active" : ""
          }`}
          data-testid={`link-nav-${label.toLowerCase().replace(" ", "-")}`}
        >
          <Icon className="size-[17px]" strokeWidth={1.8} />
          <span>{label}</span>

          {label === "Duplicates" && (
            <span className="ml-auto rounded-md bg-[hsl(var(--accent)/.18)] px-1.5 py-0.5 cn-mono text-[10px] text-[hsl(var(--accent))]">
              {duplicateCount}
            </span>
          )}
        </Link>
      ))}
    </nav>

  </div>

  <div className="shrink-0 space-y-1 px-3 pb-3">

    <Link
      href="/settings"
      className="cn-nav-item flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium"
      data-testid="link-nav-settings"
    >
      <Settings className="size-[17px]" strokeWidth={1.8} />
      Settings
    </Link>

    <Link
      href="/profile"
      className="cn-nav-item flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium"
      data-testid="link-nav-profile"
    >
      <UserRound className="size-[17px]" strokeWidth={1.8} />
      Profile
    </Link>

    <div className="mt-4 border-t border-[hsl(var(--sidebar-border))] px-3 pb-1 pt-4">
      <div className="flex items-center gap-2.5">
        <span className="grid size-8 place-items-center rounded-full bg-[hsl(var(--accent))] text-xs font-bold text-[hsl(var(--accent-foreground))]">
          {getInitials(currentUser?.name ?? "")}
        </span>

        <div className="min-w-0">
          <div className="truncate text-xs font-medium text-white">
            {currentUser?.name ?? "User"}
          </div>

          <div className="truncate text-[10px] text-[hsl(var(--sidebar-foreground)/.48)]">
            Personal workspace
          </div>
        </div>

<div className="relative ml-auto">
 <button
  type="button"
  onClick={() => {
    if (!window.confirm("Want to sign out?")) {
      return;
    }

    logout.mutate(undefined, {
      onSuccess: () => {
        window.location.href = "/home";
      },
      onError: () => {
        window.location.href = "/home";
      },
    });
  }}
  className="ml-auto rounded-md p-2 text-[hsl(var(--sidebar-foreground)/.48)] transition-colors hover:bg-[hsl(var(--sidebar-foreground)/.08)] hover:text-white"
  data-testid="button-account-signout"
  aria-label="Sign out"
>
  <LogOut className="size-4" />
</button>

  {signOutConfirm && (
    <div className="absolute bottom-11 right-0 z-50 w-[220px] rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-[0_15px_40px_hsl(221_35%_20%/.22)]">
      <p className="text-xs font-semibold text-[hsl(var(--foreground))]">
        Want to sign out?
      </p>

      <p className="mt-1 text-[10px] leading-4 text-[hsl(var(--muted-foreground))]">
        You will be signed out of this workspace.
      </p>

      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setSignOutConfirm(false)}
          className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-1.5 text-[10px] font-semibold text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]"
        >
          Cancel
        </button>

        <button
          type="button"
          onClick={() => {
            logout.mutate(undefined, {
              onSuccess: () => {
                window.location.href = "/home";
              },
              onError: () => {
                window.location.href = "/home";
              },
            });
          }}
          className="rounded-md bg-[hsl(var(--destructive))] px-3 py-1.5 text-[10px] font-semibold text-white hover:opacity-90"
        >
          Sign out
        </button>
      </div>
    </div>
  )}
</div>
      </div>
    </div>

  </div>

</aside>
    {mobileOpen && <button className="fixed inset-0 z-20 bg-[hsl(var(--foreground)/.28)] md:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation" data-testid="button-close-navigation" />}
<div className="min-w-0 flex-1 md:ml-[244px]">

    <header className="sticky top-0 z-10 flex h-[70px] items-center justify-between border-b border-[hsl(var(--border)/.8)] bg-[hsl(var(--background)/.84)] px-5 backdrop-blur-xl md:px-9">

  {/* LEFT */}
  <div className="flex items-center gap-3">

    <button
      type="button"
      className="rounded-lg p-2 hover:bg-[hsl(var(--muted))] md:hidden"
      onClick={() => setMobileOpen(true)}
      data-testid="button-open-navigation"
    >
      <Menu className="size-5" />
    </button>

    <div className="hidden text-sm text-[hsl(var(--muted-foreground))] sm:block">
      Workspace /{" "}
      <span className="font-medium text-[hsl(var(--foreground))]">
        {crumbLabel}
      </span>
    </div>

  </div>

  {/* RIGHT */}
  <div className="flex items-center gap-2">

    {/* HELP */}

{/* HELP */}
<div className="relative">
  <button
    type="button"
    onClick={() => setHelpOpen((open) => !open)}
    className="rounded-lg p-2 text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
    data-testid="button-help"
    aria-label="Help"
  >
    <CircleHelp className="size-[18px]" />
  </button>

  {helpOpen && (
    <div className="absolute right-0 top-12 z-50 w-[360px] overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-[0_20px_60px_hsl(221_35%_20%/.18)]">

      {/* HEADER */}
      <div className="border-b border-[hsl(var(--border))] px-4 py-3">
        <h3 className="text-sm font-semibold">
          Help & Support
        </h3>

        <p className="mt-0.5 text-[10px] text-[hsl(var(--muted-foreground))]">
          Quick guides for using CloudNest
        </p>
      </div>

      <div className="max-h-[460px] overflow-y-auto p-2">

        {/* QUICK START */}
        <div className="rounded-lg bg-[hsl(var(--primary)/.06)] p-3">
          <div className="flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-lg bg-[hsl(var(--primary)/.12)] text-[hsl(var(--primary))]">
              <Sparkles className="size-3.5" />
            </span>

            <div>
              <p className="text-xs font-semibold">
                Quick Start
              </p>

              <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
                Get your workspace ready
              </p>
            </div>
          </div>

          <div className="mt-3 space-y-2 text-[11px] text-[hsl(var(--muted-foreground))]">
            <div>1. Connect a cloud provider</div>
            <div>2. Upload or index your files</div>
            <div>3. Search your unified file index</div>
            <div>4. Review detected duplicates</div>
          </div>
        </div>

        {/* NAVIGATION */}
        <div className="mt-2 space-y-1">

          <Link
            href="/providers"
            onClick={() => setHelpOpen(false)}
            className="flex items-center gap-3 rounded-lg p-3 hover:bg-[hsl(var(--muted))]"
          >
            <Network className="size-4 text-[hsl(var(--primary))]" />

            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold">
                Connect clouds
              </p>

              <p className="mt-0.5 text-[10px] text-[hsl(var(--muted-foreground))]">
                Connect Google Drive, OneDrive or Dropbox.
              </p>
            </div>

            <ChevronRight className="size-3.5 text-[hsl(var(--muted-foreground))]" />
          </Link>

          <Link
            href="/files"
            onClick={() => setHelpOpen(false)}
            className="flex items-center gap-3 rounded-lg p-3 hover:bg-[hsl(var(--muted))]"
          >
            <Folder className="size-4 text-[hsl(var(--primary))]" />

            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold">
                Manage files
              </p>

              <p className="mt-0.5 text-[10px] text-[hsl(var(--muted-foreground))]">
                Browse, search and manage your unified files.
              </p>
            </div>

            <ChevronRight className="size-3.5 text-[hsl(var(--muted-foreground))]" />
          </Link>

          <Link
            href="/duplicates"
            onClick={() => setHelpOpen(false)}
            className="flex items-center gap-3 rounded-lg p-3 hover:bg-[hsl(var(--muted))]"
          >
            <Copy className="size-4 text-[hsl(var(--primary))]" />

            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold">
                Duplicate detection
              </p>

              <p className="mt-0.5 text-[10px] text-[hsl(var(--muted-foreground))]">
                Review files that appear to be duplicates.
              </p>
            </div>

            <ChevronRight className="size-3.5 text-[hsl(var(--muted-foreground))]" />
          </Link>

          <Link
            href="/settings"
            onClick={() => setHelpOpen(false)}
            className="flex items-center gap-3 rounded-lg p-3 hover:bg-[hsl(var(--muted))]"
          >
            <Settings className="size-4 text-[hsl(var(--primary))]" />

            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold">
                Workspace settings
              </p>

              <p className="mt-0.5 text-[10px] text-[hsl(var(--muted-foreground))]">
                Manage notifications and file display options.
              </p>
            </div>

            <ChevronRight className="size-3.5 text-[hsl(var(--muted-foreground))]" />
          </Link>

        </div>

        {/* GUIDES */}
        <div className="mt-3 border-t border-[hsl(var(--border))] pt-3">

          <div className="px-2 pb-2 text-[9px] font-semibold uppercase tracking-[.15em] text-[hsl(var(--muted-foreground))]">
            Guides
          </div>

          <div className="space-y-1">

            <div className="rounded-lg p-3 hover:bg-[hsl(var(--muted))]">
              <div className="flex items-center gap-2">
                <Bell className="size-3.5 text-[hsl(var(--primary))]" />

                <p className="text-xs font-semibold">
                  Notifications
                </p>
              </div>

              <p className="mt-1 pl-5 text-[10px] leading-4 text-[hsl(var(--muted-foreground))]">
                The notification bell shows upload, duplicate,
                sync and other workspace activity.
              </p>
            </div>

            <div className="rounded-lg p-3 hover:bg-[hsl(var(--muted))]">
              <div className="flex items-center gap-2">
                <PanelLeftClose className="size-3.5 text-[hsl(var(--primary))]" />

                <p className="text-xs font-semibold">
                  Compact file rows
                </p>
              </div>

              <p className="mt-1 pl-5 text-[10px] leading-4 text-[hsl(var(--muted-foreground))]">
                Enable this option in Settings to fit more
                files on the screen.
              </p>
            </div>

            <div className="rounded-lg p-3 hover:bg-[hsl(var(--muted))]">
              <div className="flex items-center gap-2">
                <Keyboard className="size-3.5 text-[hsl(var(--primary))]" />

                <p className="text-xs font-semibold">
                  Keyboard shortcut
                </p>
              </div>

              <div className="mt-2 flex items-center justify-between pl-5">
                <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
                  Open search
                </span>

                <kbd className="rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-1.5 py-0.5 font-mono text-[9px]">
                  ⌘ K
                </kbd>
              </div>
            </div>

          </div>
        </div>

        {/* TROUBLESHOOTING */}
        <div className="mt-3 border-t border-[hsl(var(--border))] pt-3">

          <div className="px-2 pb-2 text-[9px] font-semibold uppercase tracking-[.15em] text-[hsl(var(--muted-foreground))]">
            Troubleshooting
          </div>

          <div className="space-y-1">

            <div className="rounded-lg p-3">
              <p className="text-xs font-semibold">
                Provider isn't connecting?
              </p>

              <p className="mt-1 text-[10px] leading-4 text-[hsl(var(--muted-foreground))]">
                Open Providers and check the connection status
                or provider credentials.
              </p>
            </div>

            <div className="rounded-lg p-3">
              <p className="text-xs font-semibold">
                Files aren't appearing?
              </p>

              <p className="mt-1 text-[10px] leading-4 text-[hsl(var(--muted-foreground))]">
                Make sure the provider has finished indexing
                before searching for the file.
              </p>
            </div>

          </div>
        </div>

      </div>

      {/* FOOTER */}
      <div className="border-t border-[hsl(var(--border))] px-4 py-3">
        <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
          Need more help? Check your provider connection or
          workspace settings.
        </p>
      </div>

    </div>
  )}
</div>

    {/* NOTIFICATIONS */}
    <div className="relative">

      <button
        type="button"
        onClick={() => setNotificationsOpen((open) => !open)}
        className="relative rounded-lg p-2 text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
        data-testid="button-notifications"
        aria-label="Notifications"
      >
        <Bell className="size-[18px]" />

        {notifications.length > 0 && (
          <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-[hsl(var(--accent))]" />
        )}
      </button>

      {/* NOTIFICATION PANEL */}
      {notificationsOpen && (
        <div className="absolute right-0 top-12 z-50 w-[320px] overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-[0_20px_60px_hsl(221_35%_20%/.18)]">

          {/* PANEL HEADER */}
          <div className="flex items-center justify-between border-b border-[hsl(var(--border))] px-4 py-3">

            <div>
              <h3 className="text-sm font-semibold">
                Notifications
              </h3>

              <p className="mt-0.5 text-[10px] text-[hsl(var(--muted-foreground))]">
                CloudNest activity
              </p>
            </div>

            {notifications.length > 0 && (
              <button
                type="button"
                onClick={() => setNotifications([])}
                className="text-[10px] font-semibold text-[hsl(var(--primary))] hover:underline"
              >
                Clear all
              </button>
            )}

          </div>

          {/* EMPTY */}
          {notifications.length === 0 ? (

            <div className="px-4 py-10 text-center">

              <Bell className="mx-auto mb-3 size-6 text-[hsl(var(--muted-foreground))]" />

              <p className="text-xs font-semibold">
                No notifications
              </p>

              <p className="mt-1 text-[10px] text-[hsl(var(--muted-foreground))]">
                You're all caught up.
              </p>

            </div>

          ) : (

            /* NOTIFICATION LIST */
            <div className="max-h-[360px] overflow-y-auto">

              {notifications.map((item) => (

                <div
                  key={item.id}
                  className="border-b border-[hsl(var(--border)/.7)] px-4 py-3 last:border-0"
                >

                  <div className="flex items-start gap-3">

                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))]">
                      <Bell className="size-4" />
                    </span>

                    <div className="min-w-0 flex-1">

                      <div className="text-xs font-semibold">
                        {item.type === "success"
                          ? "Success"
                          : item.type === "error"
                            ? "Error"
                            : item.type === "warning"
                              ? "Warning"
                              : "Information"}
                      </div>

                      <p className="mt-1 text-[11px] leading-5 text-[hsl(var(--muted-foreground))]">
                        {item.message}
                      </p>

                      <p className="mt-1 text-[9px] text-[hsl(var(--muted-foreground))]">
                        {new Date(item.createdAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>

                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        setNotifications((previous) =>
                          previous.filter((n) => n.id !== item.id)
                        )
                      }
                      className="shrink-0 rounded-md p-1 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
                      aria-label="Dismiss notification"
                    >
                      <X className="size-3.5" />
                    </button>

                  </div>

                </div>

              ))}

            </div>

          )}

        </div>
      )}

    </div>

    {/* PROFILE */}
    <Link
      href="/profile"
      className="ml-2 grid size-8 place-items-center rounded-full bg-[hsl(var(--accent))] text-xs font-bold text-[hsl(var(--accent-foreground))]"
      data-testid="link-header-profile"
    >
      {getInitials(currentUser?.name ?? "")}
    </Link>

  </div>

</header>
      <main className="mx-auto max-w-[1440px] px-5 py-7 md:px-9 md:py-9">{children}</main>
    </div>
  </div>;
}

function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: React.ReactNode }) {
  return <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><div className="mb-2 cn-mono text-[10px] uppercase tracking-[.17em] text-[hsl(var(--primary))]">{eyebrow || "CloudNest workspace"}</div><h1 className="cn-display text-[32px] font-semibold leading-none text-[hsl(var(--foreground))] md:text-[38px]">{title}</h1>{description && <p className="mt-3 max-w-2xl text-sm leading-6 text-[hsl(var(--muted-foreground))]">{description}</p>}</div>{action}</div>;
}

function LoadingState({ rows = 4 }: { rows?: number }) { return <div className="cn-card overflow-hidden rounded-xl">{Array.from({ length: rows }).map((_, i) => <div key={i} className="flex animate-pulse items-center gap-4 border-b border-[hsl(var(--border))] p-4 last:border-0"><div className="size-9 rounded-lg bg-[hsl(var(--muted))]" /><div className="flex-1 space-y-2"><div className="h-3 w-2/5 rounded bg-[hsl(var(--muted))]" /><div className="h-2 w-1/4 rounded bg-[hsl(var(--muted))]" /></div><div className="h-3 w-16 rounded bg-[hsl(var(--muted))]" /></div>)}</div>; }
function ErrorState({ retry }: { retry?: () => void }) { return <div className="cn-card rounded-xl border-[hsl(var(--destructive)/.28)] bg-[hsl(var(--destructive)/.03)] p-8 text-center"><AlertTriangle className="mx-auto mb-3 size-7 text-[hsl(var(--destructive))]" /><h3 className="font-semibold">Could not load this view</h3><p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">The storage service did not respond. Try again in a moment.</p>{retry && <button onClick={retry} className="cn-btn mt-4 inline-flex items-center gap-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-xs font-semibold" data-testid="button-retry"><RefreshCw className="size-3.5" />Retry</button>}</div>; }
function EmptyState({ icon: Icon = Folder, title, text }: { icon?: typeof Folder; title: string; text: string }) { return <div className="cn-card rounded-xl p-14 text-center"><span className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))]"><Icon className="size-6" /></span><h3 className="font-semibold">{title}</h3><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[hsl(var(--muted-foreground))]">{text}</p></div>; }
function Kpi({ label, value, detail, icon: Icon, accent = "primary" }: { label: string; value: string; detail: string; icon: typeof HardDrive; accent?: "primary" | "accent" | "destructive" }) { return <div className="cn-card cn-kpi rounded-xl p-5"><div className="mb-5 flex items-start justify-between"><span className={`grid size-9 place-items-center rounded-lg ${accent === "accent" ? "bg-[hsl(var(--accent)/.15)] text-[hsl(var(--accent-foreground))]" : accent === "destructive" ? "bg-[hsl(var(--destructive)/.11)] text-[hsl(var(--destructive))]" : "bg-[hsl(var(--primary)/.11)] text-[hsl(var(--primary))]"}`}><Icon className="size-[17px]" /></span><span className="cn-mono text-[10px] text-[hsl(var(--muted-foreground))]">LIVE</span></div><div className="cn-mono text-[11px] uppercase tracking-[.08em] text-[hsl(var(--muted-foreground))]">{label}</div><div className="mt-1 text-[25px] font-semibold tracking-[-.04em]">{value}</div><div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{detail}</div></div>; }
function FileRow({
  file,
  onDelete,
}: {
  file: CloudFile;
  onDelete?: (id: string) => void;
}) {
  const Icon = fileIcon(file.mimeType);

  const [compact] = useCloudNestSetting(
    SETTINGS_KEYS.compact,
    false
  );

  const download = async () => {
    const response = await fetch(`/api/files/${file.id}/download`, {
      credentials: "include",
    });

    if (!response.ok) {
      window.alert("Could not download this file from its provider.");
      return;
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    link.click();

    URL.revokeObjectURL(url);
  };

  return (
    <div
      className={`group flex items-center border-b border-[hsl(var(--border)/.76)] transition-colors last:border-0 hover:bg-[hsl(var(--muted)/.55)] ${
        compact
          ? "gap-2 px-3 py-2"
          : "gap-3 px-4 py-3.5"
      }`}
      data-testid={`row-file-${file.id}`}
    >
      <span
        className={`grid shrink-0 place-items-center rounded-lg bg-[hsl(var(--secondary))] text-[hsl(var(--primary))] ${
          compact ? "size-7" : "size-9"
        }`}
      >
        <Icon
          className={compact ? "size-[14px]" : "size-[17px]"}
        />
      </span>

      <Link
        href={`/files/${file.id}`}
        className="min-w-0 flex-1"
        data-testid={`link-file-${file.id}`}
      >
        <div
          className={`truncate font-medium group-hover:text-[hsl(var(--primary))] ${
            compact ? "text-xs" : "text-sm"
          }`}
        >
          {file.name}
        </div>

        <div
          className={`flex items-center gap-2 text-[hsl(var(--muted-foreground))] ${
            compact ? "mt-0 text-[10px]" : "mt-0.5 text-[11px]"
          }`}
        >
          <span>{file.provider}</span>
          <span className="size-0.5 rounded-full bg-current" />
          <span>{titleCase(file.category)}</span>
        </div>
      </Link>

      <div
        className={`hidden text-right text-[hsl(var(--muted-foreground))] sm:block ${
          compact ? "w-20 text-[10px]" : "w-24 text-xs"
        }`}
      >
        {formatBytes(file.size)}
      </div>

      <div
        className={`hidden text-right text-[hsl(var(--muted-foreground))] lg:block ${
          compact ? "w-24 text-[10px]" : "w-28 text-xs"
        }`}
      >
        {formatDate(file.modifiedAt)}
      </div>

      {file.isDuplicate && (
        <span
          className={`hidden rounded-md bg-[hsl(var(--accent)/.15)] cn-mono text-[9px] text-[hsl(31 70% 35%)] md:block ${
            compact ? "px-1.5 py-0.5" : "px-2 py-1"
          }`}
        >
          DUPLICATE
        </span>
      )}

      <button
        className="rounded-md p-1.5 text-[hsl(var(--muted-foreground))] opacity-0 transition-opacity hover:bg-[hsl(var(--primary)/.1)] hover:text-[hsl(var(--primary))] group-hover:opacity-100"
        onClick={download}
        data-testid={`button-download-file-${file.id}`}
      >
        <UploadCloud className="size-3.5 rotate-180" />
      </button>

      <button
        className="rounded-md p-1.5 text-[hsl(var(--muted-foreground))] opacity-0 transition-opacity hover:bg-[hsl(var(--destructive)/.1)] hover:text-[hsl(var(--destructive))] group-hover:opacity-100"
        onClick={() => onDelete?.(file.id)}
        data-testid={`button-delete-file-${file.id}`}
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );
}

function DashboardPage() {
  const q = useGetDashboard({
    query: { queryKey: getGetDashboardQueryKey() }
  });

  const meQ = useGetMe({
    query: { queryKey: getGetMeQueryKey() }
  });

  const currentUser = meQ.data as CurrentUser | undefined;
const dashboard = q.data as Dashboard | undefined;

const now = new Date();

const greeting =
  now.getHours() < 12
    ? "Good morning"
    : now.getHours() < 18
      ? "Good afternoon"
      : "Good evening";

const currentDateTime =
  now.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }) +
  " · " +
  now.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

return (
  <PageFrame>
    <PageHeader
      eyebrow={currentDateTime}
      title={`${greeting}, ${currentUser?.name ?? "User"}.`}
        action={
          <Link
            href="/files"
            className="cn-btn cn-btn-primary inline-flex items-center gap-2 rounded-lg bg-[hsl(var(--primary))] px-4 py-2.5 text-xs font-semibold text-white"
            data-testid="link-browse-files"
          >
            <Folder className="size-4" />
            Browse files
          </Link>
        }
      />

      {q.isLoading ? (
        <LoadingState rows={3} />
      ) : q.isError ? (
        <ErrorState retry={() => q.refetch()} />
      ) : dashboard ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi
              label="Total files"
              value={dashboard.totalFiles.toLocaleString()}
              detail="Across every provider"
              icon={Folder}
            />

            <Kpi
              label="Storage used"
              value={formatBytes(dashboard.totalStorage)}
              detail="Healthy capacity"
              icon={HardDrive}
              accent="accent"
            />

            <Kpi
              label="Connected clouds"
              value={String(dashboard.connectedProviders)}
              detail="All systems operational"
              icon={Network}
            />

            <Kpi
              label="Duplicate files"
              value={String(dashboard.duplicateCount)}
              detail="Potential savings"
              icon={Copy}
              accent="destructive"
            />
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-[1.35fr_1fr]">
            <section className="cn-card rounded-xl">
              <div className="flex items-center justify-between border-b border-[hsl(var(--border))] px-5 py-4">
                <div>
                  <h2 className="text-sm font-semibold">Recent files</h2>
                  <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
                    The latest things in your nest
                  </p>
                </div>

                <Link
                  href="/files"
                  className="text-xs font-semibold text-[hsl(var(--primary))]"
                  data-testid="link-view-all-files"
                >
                  View all
                  <ChevronRight className="inline size-3.5" />
                </Link>
              </div>

              {dashboard.recentFiles?.length ? (
                dashboard.recentFiles
                  .slice(0, 5)
                  .map((file) => <FileRow file={file} key={file.id} />)
              ) : (
                <EmptyState
                  title="No files yet"
                  text="Connect a provider to bring your files together."
                />
              )}
            </section>

            <ProviderSnapshot metrics={dashboard.providerStorage} />
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_1.35fr]">
            <TypeDistribution metrics={dashboard.typeDistribution} />
            <ActivityFeed items={dashboard.recentActivity} />
          </div>
        </>
      ) : (
        <EmptyState
          title="Your dashboard is clear"
          text="Connect a cloud provider to start seeing your workspace."
        />
      )}
    </PageFrame>
  );
}

function ProviderSnapshot({ metrics = [] }: { metrics?: Metric[] }) { const total = metrics.reduce((a, m) => a + m.value, 0); return <section className="cn-card rounded-xl p-5"><div className="mb-5 flex items-start justify-between"><div><h2 className="text-sm font-semibold">Provider health</h2><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Usage by connected cloud</p></div><Link href="/providers" className="rounded-md p-1.5 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]" data-testid="link-provider-settings"><SlidersHorizontal className="size-4" /></Link></div><div className="space-y-5">{metrics.length ? metrics.map(m => <div key={m.label}><div className="mb-2 flex justify-between text-xs"><span className="flex items-center gap-2 font-medium"><i className="size-2 rounded-full" style={{ backgroundColor: providerColor(m.label) }} />{m.label}</span><span className="cn-mono text-[10px] text-[hsl(var(--muted-foreground))]">{formatBytes(m.value)}</span></div><div className="cn-progress h-1.5 rounded-full"><span style={{ width: `${total ? Math.min(100, Math.max(5, m.value / total * 100)) : 0}%`, backgroundColor: providerColor(m.label) }} /></div></div>) : <div className="py-7 text-center text-xs text-[hsl(var(--muted-foreground))]">No provider data available</div>}</div><Link href="/analytics" className="mt-7 flex items-center justify-between border-t border-[hsl(var(--border))] pt-4 text-xs font-semibold text-[hsl(var(--primary))]" data-testid="link-see-analytics">See storage analytics <ChevronRight className="size-3.5" /></Link></section>; }
function TypeDistribution({ metrics = [] }: { metrics?: Metric[] }) { const total = metrics.reduce((a, m) => a + m.value, 0); return <section className="cn-card rounded-xl p-5"><h2 className="text-sm font-semibold">File composition</h2><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">What your workspace holds</p><div className="mt-6 flex h-3 overflow-hidden rounded-full bg-[hsl(var(--muted))]">{metrics.slice(0, 5).map((m, i) => <span key={m.label} style={{ width: `${total ? m.value / total * 100 : 0}%`, backgroundColor: ["#2ea6b1", "#5576c5", "#e59b2f", "#7f9bb5", "#e56a59"][i] }} />)}</div><div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3">{metrics.slice(0, 6).map((m, i) => <div key={m.label} className="flex items-center justify-between text-xs"><span className="flex items-center gap-2 text-[hsl(var(--muted-foreground))]"><i className="size-2 rounded-full" style={{ backgroundColor: ["#2ea6b1", "#5576c5", "#e59b2f", "#7f9bb5", "#e56a59"][i % 5] }} />{m.label}</span><span className="cn-mono text-[10px]">{total ? Math.round(m.value / total * 100) : 0}%</span></div>)}</div></section>; }
function ActivityFeed({ items = [] }: { items?: Activity[] }) { return <section className="cn-card rounded-xl p-5"><div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold">Latest activity</h2><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">A quiet audit trail</p></div><Link href="/activity" className="text-xs font-semibold text-[hsl(var(--primary))]" data-testid="link-view-activity">View timeline</Link></div><div className="mt-4 space-y-1">{items?.slice(0, 4).map(item => <div key={item.id} className="flex gap-3 rounded-lg px-1 py-2.5"><span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-[hsl(var(--secondary))] text-[hsl(var(--primary))]"><Zap className="size-3.5" /></span><div className="min-w-0 flex-1"><div className="text-xs font-medium">{item.description || titleCase(item.action)}</div><div className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">{item.provider || "CloudNest"} · {timeAgo(item.createdAt)}</div></div></div>)}</div></section>; }

function PageFrame({ children }: { children: ReactNode }) { return <Shell>{children}</Shell>; }

const CATEGORY_OPTIONS = ["Career", "Education", "Finance", "Identity", "Personal", "Work", "Other"];
const TYPE_OPTIONS = ["Documents", "Images", "Videos", "Spreadsheets", "Presentations", "Archives", "Code", "Other"];
function broadType(mimeType?: string | null): string {
  const m = mimeType ?? "";
  if (m.startsWith("image/")) return "Images";
  if (m.startsWith("video/")) return "Videos";
  if (m.includes("spreadsheet") || m.includes("excel") || m === "text/csv") return "Spreadsheets";
  if (m.includes("presentation") || m.includes("powerpoint")) return "Presentations";
  if (m.includes("zip") || m.includes("compressed") || m.includes("archive") || m.includes("tar")) return "Archives";
  if (m.includes("javascript") || m.includes("json") || m.includes("python") || m === "text/x-python" || m === "application/x-sh") return "Code";
  if (m === "application/pdf" || m.includes("word") || m.includes("document") || m.startsWith("text/")) return "Documents";
  return "Other";
}

function FilesPage({ searchMode = false, category }: { searchMode?: boolean; category?: string }) {
  const [search, setSearch] = useState(searchMode ? "" : "");
  const [provider, setProvider] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadProvider, setUploadProvider] = useState("");
  const [uploadCategory, setUploadCategory] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [view, setView] = useState<"list" | "grid">("list");
  const [folderOpen, setFolderOpen] = useState(false);
  const [folderProvider, setFolderProvider] = useState("");
  const [folderName, setFolderName] = useState("");
  const [folderError, setFolderError] = useState("");
  const [sizeMin, setSizeMin] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [dupOnly, setDupOnly] = useState(false);
  const [sortBy, setSortBy] = useState<"modified" | "name" | "size">("modified");
  const params = useMemo(() => ({ ...(provider ? { provider } : {}), ...(search ? { search } : {}), ...(category || categoryFilter ? { category: category || categoryFilter } : {}) }), [provider, search, category, categoryFilter]);
  const q = useListFiles(params, { query: { queryKey: getListFilesQueryKey(params) } });
  const queryClient = useQueryClient();
  const del = useDeleteFile();
  const upload = useUploadFile();
  const createFolder = useCreateFolder();
  const providersQ = useListProviders({ query: { queryKey: getListProvidersQueryKey() } });
  const allFiles = q.data as CloudFile[] | undefined;
  // Search relevance: filename matches rank above category/provider-only matches.
  const files = useMemo(() => {
    let list = allFiles ?? [];
    if (sizeMin) { const minBytes = Number(sizeMin) * 1024 * 1024; list = list.filter(f => f.size >= minBytes); }
    if (typeFilter) list = list.filter(f => broadType(f.mimeType) === typeFilter);
    if (dupOnly) list = list.filter(f => f.isDuplicate);
    if (search) {
      const term = search.toLowerCase();
      list = [...list].sort((a, b) => Number(b.name.toLowerCase().includes(term)) - Number(a.name.toLowerCase().includes(term)));
    } else {
      list = [...list].sort((a, b) => sortBy === "name" ? a.name.localeCompare(b.name) : sortBy === "size" ? b.size - a.size : +new Date(b.modifiedAt) - +new Date(a.modifiedAt));
    }
    return list;
  }, [allFiles, sizeMin, typeFilter, dupOnly, search, sortBy]);
  const providersList = providersQ.data as Provider[] | undefined;
  const connectedProviders = providersList?.filter(p => p.connected) ?? [];
  const deleteFile = (id: string) => { if (window.confirm("Delete this file? It will be removed from CloudNest and its cloud provider.")) del.mutate({ id }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListFilesQueryKey(params) }); queryClient.invalidateQueries({ queryKey: getListDuplicatesQueryKey() }); } }); };
  const onFileChosen = (fileList: FileList | null) => {
    const file = fileList?.[0];
    if (!file) return;
    setUploadError("");
    upload.mutate(
      { data: { file, ...(uploadProvider ? { provider: uploadProvider } : {}), ...(uploadCategory ? { category: uploadCategory } : {}) } },
      {
onSuccess: (result) => {
  setUploadOpen(false);
  setUploadCategory("");

  const uploadedFile = result as CloudFile;

  window.dispatchEvent(
    new CustomEvent("cloudnest-notification", {
      detail: {
        message: uploadedFile.isDuplicate
          ? `Duplicate detected: "${file.name}" matches an existing file.`
          : `"${file.name}" uploaded successfully.`,
        type: uploadedFile.isDuplicate ? "warning" : "success",
      },
    })
  );

  queryClient.invalidateQueries({
    queryKey: getListFilesQueryKey(params),
  });

  queryClient.invalidateQueries({
    queryKey: getListDuplicatesQueryKey(),
  });

  queryClient.invalidateQueries({
    queryKey: getListProvidersQueryKey(),
  });
},

onError: (err) => {
  setUploadError(
    err instanceof Error ? err.message : "Upload failed"
  );

  window.dispatchEvent(
    new CustomEvent("cloudnest-notification", {
      detail: {
        message: `Upload failed for "${file.name}".`,
        type: "error",
      },
    })
  );
},
      },
    );
  };
  const submitFolder = () => {
    if (!folderProvider || !folderName.trim()) return;
    setFolderError("");
    createFolder.mutate({ data: { provider: folderProvider, name: folderName.trim() } }, {
      onSuccess: () => { setFolderOpen(false); setFolderName(""); },
      onError: (err) => setFolderError(err instanceof Error ? err.message : "Could not create the folder"),
    });
  };
  return <PageFrame><PageHeader eyebrow={category ? `Category / ${titleCase(category)}` : searchMode ? "Cross-provider search" : "Unified file browser"} title={category ? titleCase(category) : searchMode ? "Find anything, anywhere." : "All files"} description={category ? "A focused view across every connected cloud." : searchMode ? "Search names, paths, and providers from one calm command center." : "One index for every cloud you have connected."} action={!searchMode && <div className="flex gap-2"><button onClick={() => setFolderOpen(true)} className="cn-btn inline-flex items-center gap-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-2.5 text-xs font-semibold hover:bg-[hsl(var(--muted))]" data-testid="button-new-folder"><FolderPlus className="size-4" />New folder</button><button onClick={() => setUploadOpen(true)} className="cn-btn cn-btn-primary inline-flex items-center gap-2 rounded-lg bg-[hsl(var(--primary))] px-4 py-2.5 text-xs font-semibold text-white" data-testid="button-upload-file"><UploadCloud className="size-4" />Upload file</button></div>} />
    {folderOpen && <div className="mb-5 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
      <div className="mb-3 flex items-center justify-between"><span className="text-sm font-semibold">Create a folder</span><button onClick={() => setFolderOpen(false)} data-testid="button-cancel-folder"><X className="size-4" /></button></div>
      {connectedProviders.length === 0 ? <p className="text-xs text-[hsl(var(--muted-foreground))]">Connect a cloud provider first.</p> : <>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <select value={folderProvider} onChange={e => setFolderProvider(e.target.value)} className="h-10 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-xs" data-testid="select-folder-provider"><option value="">Choose provider</option>{connectedProviders.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <input value={folderName} onChange={e => setFolderName(e.target.value)} placeholder="Folder name" className="h-10 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-xs" data-testid="input-folder-name" />
          <button onClick={submitFolder} disabled={createFolder.isPending || !folderProvider || !folderName.trim()} className="cn-btn rounded-lg bg-[hsl(var(--primary))] px-4 text-xs font-semibold text-white disabled:opacity-40" data-testid="button-submit-folder">{createFolder.isPending ? "Creating…" : "Create"}</button>
        </div>
        {folderError && <p className="mt-3 rounded-lg bg-[hsl(var(--destructive)/.1)] px-3 py-2 text-xs text-[hsl(var(--destructive))]">{folderError}</p>}
      </>}
    </div>}
    {uploadOpen && <div className="mb-5 rounded-xl border border-[hsl(var(--primary)/.25)] bg-[hsl(var(--primary)/.06)] p-4">
      <div className="mb-3 flex items-center justify-between"><span className="text-sm font-semibold">Upload a file</span><button onClick={() => setUploadOpen(false)} data-testid="button-cancel-upload"><X className="size-4" /></button></div>
      {connectedProviders.length === 0 ? <p className="text-xs text-[hsl(var(--muted-foreground))]">Connect a cloud provider first, then come back to upload — CloudNest needs somewhere real to put the file.</p> : <>
        <div className="mb-3 grid gap-3 sm:grid-cols-2">
          <select value={uploadProvider} onChange={e => setUploadProvider(e.target.value)} className="h-10 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-xs" data-testid="select-upload-provider"><option value="">Auto-select best provider</option>{connectedProviders.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <select value={uploadCategory} onChange={e => setUploadCategory(e.target.value)} className="h-10 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-xs" data-testid="select-upload-category"><option value="">Let AI categorize it</option>{CATEGORY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}</select>
        </div>
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-[hsl(var(--primary)/.4)] bg-[hsl(var(--card)/.6)] px-4 py-8 text-center hover:bg-[hsl(var(--card))]" data-testid="label-file-input">
          <UploadCloud className="size-6 text-[hsl(var(--primary))]" />
          <span className="text-xs font-medium">{upload.isPending ? "Uploading…" : "Click to choose a file"}</span>
          <span className="text-[10px] text-[hsl(var(--muted-foreground))]">SHA-256 checked for duplicates · AI-categorized · filed automatically</span>
          <input type="file" className="hidden" disabled={upload.isPending} onChange={e => onFileChosen(e.target.files)} data-testid="input-file-upload" />
        </label>
        {uploadError && <p className="mt-3 rounded-lg bg-[hsl(var(--destructive)/.1)] px-3 py-2 text-xs text-[hsl(var(--destructive))]" data-testid="text-upload-error">{uploadError}</p>}
      </>}
    </div>}
    <div className="mb-5 flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row"><label className="relative flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search file names, categories, providers..." className="h-11 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] pl-10 pr-4 text-sm outline-none transition-colors placeholder:text-[hsl(var(--muted-foreground))] focus:border-[hsl(var(--primary))]" data-testid="input-file-search" /></label><div className="flex h-11 items-center gap-1 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-1"><button onClick={() => setView("list")} className={`grid size-8 place-items-center rounded-md ${view === "list" ? "bg-[hsl(var(--muted))]" : ""}`} data-testid="button-view-list"><List className="size-4" /></button><button onClick={() => setView("grid")} className={`grid size-8 place-items-center rounded-md ${view === "grid" ? "bg-[hsl(var(--muted))]" : ""}`} data-testid="button-view-grid"><LayoutGrid className="size-4" /></button></div></div>
      <div className="flex flex-wrap items-center gap-2">
        <select value={provider} onChange={e => setProvider(e.target.value)} className="h-10 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-xs font-medium outline-none focus:border-[hsl(var(--primary))]" data-testid="select-file-provider"><option value="">All providers</option>{providersList?.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</select>
        {!category && <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} className="h-10 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-xs font-medium outline-none focus:border-[hsl(var(--primary))]" data-testid="select-category-filter"><option value="">All categories</option>{CATEGORY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}</select>}
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="h-10 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-xs font-medium outline-none focus:border-[hsl(var(--primary))]" data-testid="select-type-filter"><option value="">All file types</option>{TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}</select>
        <input value={sizeMin} onChange={e => setSizeMin(e.target.value)} type="number" min="0" placeholder="Min size (MB)" className="h-10 w-32 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-xs outline-none focus:border-[hsl(var(--primary))]" data-testid="input-min-size" />
        <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)} className="h-10 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-xs font-medium outline-none focus:border-[hsl(var(--primary))]" data-testid="select-sort-by"><option value="modified">Sort: Recently modified</option><option value="name">Sort: Name</option><option value="size">Sort: Largest first</option></select>
        <button onClick={() => setDupOnly(!dupOnly)} className={`inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold ${dupOnly ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))]" : "border-[hsl(var(--border))] bg-[hsl(var(--card))] hover:bg-[hsl(var(--muted))]"}`} data-testid="button-duplicates-only"><Copy className="size-3.5" />Duplicates only</button>
        {(search || provider || categoryFilter || typeFilter || sizeMin || dupOnly) && <button onClick={() => { setSearch(""); setProvider(""); setCategoryFilter(""); setTypeFilter(""); setSizeMin(""); setDupOnly(false); }} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-xs font-semibold hover:bg-[hsl(var(--muted))]" data-testid="button-clear-filters"><X className="size-3.5" />Clear filters</button>}
      </div>
    </div>
    {q.isLoading ? <LoadingState rows={7} /> : q.isError ? <ErrorState retry={() => q.refetch()} /> : files?.length ? (
      view === "list"
        ? <div className="cn-card overflow-hidden rounded-xl"><div className="hidden items-center gap-3 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted)/.5)] px-4 py-2.5 text-[10px] font-medium uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))] sm:flex"><span className="w-9" /><span className="flex-1">Name</span><span className="w-24 text-right">Size</span><span className="w-28 text-right">Modified</span><span className="w-24" /><span className="w-6" /></div>{files.map(file => <FileRow key={file.id} file={file} onDelete={deleteFile} />)}</div>
        : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{files.map(file => <FileGridCard key={file.id} file={file} onDelete={deleteFile} />)}</div>
    ) : <EmptyState icon={Search} title="No files match that" text="Try a wider search or connect another provider to expand your workspace." />}</PageFrame>;
}

function FileGridCard({ file, onDelete }: { file: CloudFile; onDelete?: (id: string) => void }) {
  const Icon = fileIcon(file.mimeType);
  return <Link href={`/files/${file.id}`} className="cn-card group relative flex flex-col rounded-xl p-4" data-testid={`grid-file-${file.id}`}>
    <div className="flex items-start justify-between"><span className="grid size-10 place-items-center rounded-lg bg-[hsl(var(--secondary))] text-[hsl(var(--primary))]"><Icon className="size-5" /></span>{file.isDuplicate && <span className="rounded-md bg-[hsl(var(--accent)/.15)] px-2 py-1 cn-mono text-[9px] text-[hsl(31 70% 35%)]">DUP</span>}</div>
    <div className="mt-3 truncate text-sm font-medium">{file.name}</div>
    <div className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">{file.provider} · {titleCase(file.category)}</div>
    <div className="mt-3 flex items-center justify-between text-[11px] text-[hsl(var(--muted-foreground))]"><span>{formatBytes(file.size)}</span><span>{formatDate(file.modifiedAt)}</span></div>
    <button onClick={(e) => { e.preventDefault(); onDelete?.(file.id); }} className="absolute right-3 top-3 rounded-md bg-[hsl(var(--card))] p-1.5 text-[hsl(var(--muted-foreground))] opacity-0 shadow-sm transition-opacity hover:text-[hsl(var(--destructive))] group-hover:opacity-100" data-testid={`button-grid-delete-${file.id}`}><Trash2 className="size-3.5" /></button>
  </Link>;
}

function CategoriesPage() {
  const q = useListFiles(undefined, { query: { queryKey: getListFilesQueryKey() } });
  const [selected, setSelected] = useState("all");
  const files = q.data as CloudFile[] | undefined;
  const categories = useMemo(() => {
    const map = new Map<string, CloudFile[]>();
    files?.forEach(file => map.set(file.category, [...(map.get(file.category) || []), file]));
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [files]);
  const visible = selected === "all" ? files : files?.filter(file => file.category === selected);
  return <PageFrame><PageHeader eyebrow="Organize by meaning" title="Your filing cabinet, simplified." description="CloudNest reads the shape of your workspace so you can jump straight to the kind of file you need." />{q.isLoading ? <LoadingState rows={5} /> : q.isError ? <ErrorState retry={() => q.refetch()} /> : files?.length ? <><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><button onClick={() => setSelected("all")} className={`cn-card rounded-xl p-4 text-left ${selected === "all" ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary)/.07)]" : ""}`} data-testid="button-category-all"><div className="flex items-center justify-between"><Folder className="size-5 text-[hsl(var(--primary))]" /><span className="cn-mono text-[10px] text-[hsl(var(--muted-foreground))]">{files.length}</span></div><div className="mt-5 text-sm font-semibold">Everything</div><div className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">All indexed files</div></button>{categories.map(([name, items], i) => <button key={name} onClick={() => setSelected(name)} className={`cn-card rounded-xl p-4 text-left ${selected === name ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary)/.07)]" : ""}`} data-testid={`button-category-${name}`}><div className="flex items-center justify-between"><span className="grid size-8 place-items-center rounded-lg" style={{ backgroundColor: ["#2ea6b118", "#5576c518", "#e59b2f18", "#e56a5918"][i % 4], color: ["#2ea6b1", "#5576c5", "#c57d12", "#d85e4d"][i % 4] }}><FileText className="size-4" /></span><span className="cn-mono text-[10px] text-[hsl(var(--muted-foreground))]">{items.length}</span></div><div className="mt-4 truncate text-sm font-semibold">{titleCase(name)}</div><div className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">{formatBytes(items.reduce((sum, file) => sum + file.size, 0))}</div></button>)}</div><div className="mt-6"><div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold">{selected === "all" ? "All categories" : titleCase(selected)}</h2><span className="cn-mono text-[10px] text-[hsl(var(--muted-foreground))]">{visible?.length || 0} FILES</span></div><div className="cn-card overflow-hidden rounded-xl">{visible?.map(file => <FileRow key={file.id} file={file} />)}</div></div></> : <EmptyState icon={Folder} title="Categories are waiting" text="Connect a provider and index a few files to see them sorted here." />}</PageFrame>;
}

function ProvidersPage() {
  const q = useListProviders({ query: { queryKey: getListProvidersQueryKey() } });
  const connect = useConnectProvider();
  const disconnect = useDisconnectProvider();
  const sync = useSyncProvider();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState("");
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const providers = q.data as Provider[] | undefined;
   const toggle = (p: Provider) => {
    if (!p.connected && p.configured) {
      window.location.assign(`/api/providers/${p.id}/connect`);
      return;
    }

    const mutation = p.connected ? disconnect : connect;

    mutation.mutate(
      { provider: p.id },
      {
        onSuccess: (result) => {
          if (result) {
            setNotice(
              result.statusMessage || `${p.name} connection updated.`
            );
          }

          // Refresh provider status
          queryClient.invalidateQueries({
            queryKey: getListProvidersQueryKey(),
          });

          // Refresh files
          queryClient.invalidateQueries({
            queryKey: getListFilesQueryKey(),
          });

          // Refresh duplicates
          queryClient.invalidateQueries({
            queryKey: getListDuplicatesQueryKey(),
          });

          // Refresh dashboard counts and storage
          queryClient.invalidateQueries({
            queryKey: getGetDashboardQueryKey(),
          });

          // Refresh analytics
          queryClient.invalidateQueries({
            queryKey: getGetAnalyticsQueryKey(),
          });

          // Refresh activity
          queryClient.invalidateQueries({
            queryKey: getListActivityQueryKey(),
          });
        },

        onError: (err) => {
          setNotice(
            err instanceof Error
              ? err.message
              : "Provider connection update failed"
          );
        },
      }
    );
  };

  const syncProvider = (p: Provider) => {
    setSyncingId(p.id);
    setNotice("");

    sync.mutate(
      { provider: p.id },
      {
        onSuccess: (summary) => {
          const s = summary as SyncSummary;

          setNotice(
            `${p.name} sync complete: ${s.imported} new file(s) indexed, ${s.updated} updated, ${s.unchanged} already up to date (${s.totalRemote} found on ${p.name}).`
          );

          window.dispatchEvent(
            new CustomEvent("cloudnest-notification", {
              detail: {
                message: `${p.name} finished indexing. ${s.imported} new file(s) indexed.`,
                type: "success",
              },
            })
          );

          // Refresh files
          queryClient.invalidateQueries({
            queryKey: getListFilesQueryKey(),
          });

          // Refresh duplicates
          queryClient.invalidateQueries({
            queryKey: getListDuplicatesQueryKey(),
          });

          // Refresh dashboard counts and storage
          queryClient.invalidateQueries({
            queryKey: getGetDashboardQueryKey(),
          });
        },

        onError: (err) => {
          setNotice(
            err instanceof Error ? err.message : "Sync failed"
          );
        },

        onSettled: () => {
          setSyncingId(null);
        },
      }
    );
  };


  return <PageFrame><PageHeader eyebrow="Connections" title="Your cloud perimeter." description="Connect providers once. CloudNest keeps the index unified and your credentials with the provider." action={<div className="flex items-center gap-2 rounded-lg bg-[hsl(var(--primary)/.08)] px-3 py-2 text-xs font-medium text-[hsl(var(--primary))]"><ShieldCheck className="size-4" />Credentials stay with providers</div>} />{notice && <div className="mb-5 flex items-center justify-between rounded-lg bg-[hsl(var(--primary)/.08)] px-4 py-3 text-xs text-[hsl(var(--primary))]" data-testid="status-provider-message"><span className="flex items-center gap-2"><Check className="size-4" />{notice}</span><button onClick={() => setNotice("")} data-testid="button-dismiss-provider-message"><X className="size-4" /></button></div>}{q.isLoading ? <LoadingState rows={3} /> : q.isError ? <ErrorState retry={() => q.refetch()} /> : <div className="grid gap-4 lg:grid-cols-3">{providers?.map(p => <ProviderCard key={p.id} provider={p} onToggle={() => toggle(p)} onSync={() => syncProvider(p)} busy={connect.isPending || disconnect.isPending} syncing={syncingId === p.id} />)}</div>}{!q.isLoading && !providers?.length && <EmptyState icon={Network} title="No providers registered" text="The API has not returned any supported cloud providers yet." />}</PageFrame>;
}
function ProviderCard({ provider: p, onToggle, onSync, busy, syncing }: { provider: Provider; onToggle: () => void; onSync: () => void; busy: boolean; syncing: boolean }) { const pct = p.totalBytes ? Math.round(p.usedBytes / p.totalBytes * 100) : 0; return <article className="cn-card rounded-xl p-5"><div className="flex items-start justify-between"><div className="grid size-11 place-items-center rounded-xl text-lg font-bold" style={{ backgroundColor: `${providerColor(p.name)}18`, color: providerColor(p.name) }}>{p.name === "Google Drive" ? "G" : p.name === "OneDrive" ? "O" : "D"}</div><span className={`flex items-center gap-1.5 rounded-full px-2 py-1 cn-mono text-[9px] ${p.connected ? "bg-[hsl(159 46% 42%/.12)] text-[hsl(159 46% 34%)]" : "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]"}`}><i className={`size-1.5 rounded-full ${p.connected ? "bg-[hsl(159 46% 42%)]" : "bg-[hsl(var(--muted-foreground))]"}`} />{p.connected ? "CONNECTED" : "OFFLINE"}</span></div><h2 className="mt-5 font-semibold">{p.name}</h2><p className="mt-1 min-h-10 text-xs leading-5 text-[hsl(var(--muted-foreground))]">{p.statusMessage || (p.configured ? "Ready to sync your file index." : "Configuration required by the provider.")}</p><div className="mt-5"><div className="mb-2 flex justify-between text-[11px]"><span className="text-[hsl(var(--muted-foreground))]">Storage used</span><span className="cn-mono">{formatBytes(p.usedBytes)} / {formatBytes(p.totalBytes)}</span></div><div className="cn-progress h-1.5 rounded-full"><span style={{ width: `${pct}%`, backgroundColor: providerColor(p.name) }} /></div></div><div className="mt-6 flex gap-2">{p.connected && <button disabled={syncing} onClick={onSync} className="cn-btn inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2.5 text-xs font-semibold hover:bg-[hsl(var(--muted))] disabled:opacity-50" data-testid={`button-sync-${p.id}`}><RefreshCw className={`size-3.5 ${syncing ? "animate-spin" : ""}`} />{syncing ? "Syncing…" : "Sync files"}</button>}<button disabled={busy} onClick={onToggle} className={`cn-btn rounded-lg border px-3 py-2.5 text-xs font-semibold ${p.connected ? "flex-1 border-[hsl(var(--border))] bg-[hsl(var(--card))] hover:bg-[hsl(var(--muted))]" : "w-full border-transparent bg-[hsl(var(--primary))] text-white hover:bg-[hsl(var(--primary)/.88)]"}`} data-testid={`button-${p.connected ? "disconnect" : "connect"}-${p.id}`}>{busy ? "Updating…" : p.connected ? "Disconnect" : p.configured ? "Connect provider" : "Check configuration"}</button></div></article>; }

function AnalyticsPage() { const q = useGetAnalytics({ query: { queryKey: getGetAnalyticsQueryKey() } }); const a = q.data as Analytics | undefined; return <PageFrame><PageHeader eyebrow="Storage intelligence" title="Make space with certainty." description="A measured view of what is taking up room across your connected clouds." action={<Link href="/duplicates" className="cn-btn inline-flex items-center gap-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-2.5 text-xs font-semibold hover:bg-[hsl(var(--muted))]" data-testid="link-review-duplicates"><Copy className="size-4" />Review duplicates</Link>} />{q.isLoading ? <LoadingState rows={5} /> : q.isError ? <ErrorState retry={() => q.refetch()} /> : a ? <><div className="grid gap-4 sm:grid-cols-2"><Kpi label="Indexed storage" value={formatBytes(a.totalStorage)} detail="Across connected providers" icon={HardDrive} accent="accent" /><Kpi label="Duplicate groups" value={String(a.duplicateCount)} detail="Review before removing" icon={Copy} accent="destructive" /></div><div className="mt-6 grid gap-6 lg:grid-cols-2"><MetricPanel title="Storage by provider" metrics={a.providerStorage} colors={["#2ea6b1", "#5576c5", "#e59b2f"]} unit="bytes" /><MetricPanel title="File types" metrics={a.fileTypes} colors={["#2ea6b1", "#5576c5", "#e59b2f", "#e56a59", "#7f9bb5"]} unit="count" /></div><div className="mt-6 grid gap-6 lg:grid-cols-[.9fr_1.1fr]"><MetricPanel title="Categories" metrics={a.categories} colors={["#2ea6b1", "#5576c5", "#e59b2f", "#e56a59", "#7f9bb5"]} unit="count" /><LargestFiles files={a.largestFiles} /></div></> : <EmptyState icon={BarChart3} title="Analytics will appear here" text="Connect a provider and index your files to see storage intelligence." />}</PageFrame>; }
function MetricPanel({ title, metrics = [], colors, unit = "bytes" }: { title: string; metrics?: Metric[]; colors: string[]; unit?: "bytes" | "count" }) { const max = Math.max(...metrics.map(m => m.value), 1); const fmt = (v: number) => unit === "bytes" ? formatBytes(v) : `${v} file${v === 1 ? "" : "s"}`; return <section className="cn-card rounded-xl p-5"><h2 className="text-sm font-semibold">{title}</h2><div className="mt-6 space-y-4">{metrics.length ? metrics.map((m, i) => <div key={m.label}><div className="mb-1.5 flex justify-between text-xs"><span>{m.label}</span><span className="cn-mono text-[10px] text-[hsl(var(--muted-foreground))]">{fmt(m.value)}</span></div><div className="cn-progress h-2 rounded-full"><span style={{ width: `${m.value / max * 100}%`, background: colors[i % colors.length] }} /></div></div>) : <div className="py-8 text-center text-xs text-[hsl(var(--muted-foreground))]">No metrics returned</div>}</div></section>; }
function LargestFiles({ files = [] }: { files?: CloudFile[] }) { return <section className="cn-card rounded-xl p-5"><h2 className="text-sm font-semibold">Largest files</h2><div className="mt-4 space-y-1">{files.slice(0, 5).map(f => <Link key={f.id} href={`/files/${f.id}`} className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-[hsl(var(--muted))]" data-testid={`link-largest-file-${f.id}`}><span className="grid size-8 place-items-center rounded-lg bg-[hsl(var(--secondary))] text-[hsl(var(--primary))]"><FileText className="size-4" /></span><span className="min-w-0 flex-1 truncate text-xs font-medium">{f.name}</span><span className="cn-mono text-[10px] text-[hsl(var(--muted-foreground))]">{formatBytes(f.size)}</span></Link>)}</div></section>; }


function ActivityPage() {
  const q = useListActivity({
    query: { queryKey: getListActivityQueryKey() },
  });

  const items = q.data as Activity[] | undefined;
const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const handleRefresh = async () => {
    try {
      await q.refetch();
      setLastRefreshed(new Date());
    } catch (error) {
      console.error("Failed to refresh activity:", error);
    }
  };

  return (
    <PageFrame>
      <PageHeader
        eyebrow="Audit trail"
        title="Everything in motion."
        description="A chronological record of changes across your cloud perimeter."
        action={
          <div className="flex items-center gap-3">
            {lastRefreshed && (
              <span className="text-xs text-[hsl(var(--muted-foreground))]">
                Updated {lastRefreshed.toLocaleTimeString()}
              </span>
            )}
            <button
              onClick={handleRefresh}
              disabled={q.isFetching}
              className="cn-btn inline-flex items-center gap-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-2.5 text-xs font-semibold hover:bg-[hsl(var(--muted))] disabled:cursor-not-allowed disabled:opacity-60"
              data-testid="button-refresh-activity"
            >
              <RefreshCw
                className={`size-4 ${q.isFetching ? "animate-spin" : ""}`}
              />
              {q.isFetching ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        }
      />

      {q.isLoading ? (
        <LoadingState rows={7} />
      ) : q.isError ? (
        <ErrorState retry={handleRefresh} />
      ) : items?.length ? (
        <div className="cn-card rounded-xl p-5 md:p-7">
          <div className="relative ml-3 border-l border-[hsl(var(--border))]">
            {items.map((item) => (
              <div
                key={item.id}
                className="relative pb-7 pl-7 last:pb-0"
              >
                <span className="absolute -left-[7px] top-0 grid size-3 place-items-center rounded-full border-2 border-[hsl(var(--background))] bg-[hsl(var(--primary))]" />
                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="text-sm font-medium">
                      {item.description || titleCase(item.action)}
                    </div>
                    <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
                      {titleCase(item.action)}
                      {item.provider ? ` · ${item.provider}` : ""}
                    </div>
                  </div>
                  <time className="cn-mono text-[10px] text-[hsl(var(--muted-foreground))]">
                    {formatDate(item.createdAt)} · {timeAgo(item.createdAt)}
                  </time>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <EmptyState
          icon={ActivityIcon}
          title="No activity yet"
          text="Actions from your connected clouds will land here."
        />
      )}
    </PageFrame>
  );
}


function DuplicatesPage() { const q = useListDuplicates({ query: { queryKey: getListDuplicatesQueryKey() } }); const groups = q.data as DuplicateGroup[] | undefined; return <PageFrame><PageHeader eyebrow="Storage hygiene" title="Duplicate radar." description="Review repeated files before they quietly consume another gigabyte." action={<div className="flex items-center gap-2 rounded-lg bg-[hsl(var(--accent)/.15)] px-3 py-2 text-xs font-semibold text-[hsl(31 70% 35%)]"><Sparkles className="size-4" />Safe review mode</div>} />{q.isLoading ? <LoadingState rows={4} /> : q.isError ? <ErrorState retry={() => q.refetch()} /> : groups?.length ? <div className="space-y-4">{groups.map(g => <DuplicateCard key={g.hash} group={g} />)}</div> : <EmptyState icon={Copy} title="No duplicates detected" text="Your connected workspace is remarkably tidy. We'll keep watching." />}</PageFrame>; }
function DuplicateCard({ group }: { group: DuplicateGroup }) { const [open, setOpen] = useState(false); return <article className="cn-card rounded-xl p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-center"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[hsl(var(--accent)/.16)] text-[hsl(31 70% 35%)]"><Copy className="size-[18px]" /></span><div className="min-w-0 flex-1"><div className="text-sm font-semibold">{group.files?.[0]?.name || "Duplicate group"}</div><div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{group.files?.length || 0} copies · {formatBytes(group.totalSize)} total · hash <span className="cn-mono">{group.hash.slice(0, 10)}…</span></div></div><button onClick={() => setOpen(!open)} className="rounded-lg border border-[hsl(var(--border))] px-3 py-2 text-xs font-semibold hover:bg-[hsl(var(--muted))]" data-testid={`button-review-duplicate-${group.hash}`}>{open ? "Hide copies" : "Review copies"} <ChevronRight className={`ml-1 inline size-3.5 transition-transform ${open ? "rotate-90" : ""}`} /></button></div>{open && <div className="mt-5 divide-y divide-[hsl(var(--border))] rounded-lg border border-[hsl(var(--border))]">{group.files?.map(f => <div className="flex items-center gap-3 px-3 py-3" key={f.id}><FileText className="size-4 text-[hsl(var(--primary))]" /><div className="min-w-0 flex-1"><div className="truncate text-xs font-medium">{f.path || f.name}</div><div className="text-[10px] text-[hsl(var(--muted-foreground))]">{f.provider} · {formatDate(f.modifiedAt)}</div></div><Link href={`/files/${f.id}`} className="text-xs font-semibold text-[hsl(var(--primary))]" data-testid={`link-duplicate-file-${f.id}`}>Open</Link></div>)}</div>}</article>; }

function StorageAllocationPage() {
  const filesQ = useListFiles(undefined, { query: { queryKey: getListFilesQueryKey() } });
  const files = filesQ.data as CloudFile[] | undefined;
  const [fileId, setFileId] = useState("");
  const recQ = useGetAllocationRecommendation(fileId, { query: { enabled: Boolean(fileId), queryKey: getGetAllocationRecommendationQueryKey(fileId) } });
  const migrate = useMigrateFile();
  const queryClient = useQueryClient();
  const [migrated, setMigrated] = useState(false);
  const rec = recQ.data as AllocationRecommendation | undefined;
  const selectedFile = files?.find(f => f.id === fileId);
  const confirmMigration = () => {
    if (!rec?.shouldMigrate || !fileId) return;
    if (!window.confirm(`Move "${selectedFile?.name}" from ${rec.currentProvider} to ${rec.recommendedProvider}? A copy will be created there; the original will not be deleted automatically.`)) return;
    migrate.mutate({ id: fileId, data: { toProvider: rec.recommendedProvider } }, { onSuccess: () => { setMigrated(true); queryClient.invalidateQueries({ queryKey: getListFilesQueryKey() }); } });
  };
  return <PageFrame><PageHeader eyebrow="Intelligent placement" title="Where should this file live?" description="CloudNest compares real quota across your connected providers and recommends the best fit. Nothing moves without your confirmation." />
    <section className="cn-card rounded-xl p-5">
      <label className="text-xs font-semibold">Choose a file to evaluate</label>
      <select value={fileId} onChange={e => { setFileId(e.target.value); setMigrated(false); }} className="mt-2 h-10 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-xs" data-testid="select-allocation-file">
        <option value="">Choose a file…</option>
        {files?.map(f => <option key={f.id} value={f.id}>{f.name} · {f.provider} · {formatBytes(f.size)}</option>)}
      </select>
      {!fileId && <EmptyState icon={ArrowRightLeft} title="Pick a file above" text="CloudNest will check every connected provider's live quota and tell you if a move is worth it." />}
      {fileId && recQ.isLoading && <div className="mt-5"><LoadingState rows={2} /></div>}
      {fileId && recQ.isError && <div className="mt-5"><ErrorState retry={() => recQ.refetch()} /></div>}
      {fileId && rec && <div className="mt-5 rounded-xl bg-[hsl(var(--muted)/.55)] p-5">
        <div className="flex flex-wrap items-center gap-2 text-sm font-semibold"><span>{rec.currentProvider}</span><ArrowRightLeft className="size-4 text-[hsl(var(--muted-foreground))]" /><span className={rec.shouldMigrate ? "text-[hsl(var(--primary))]" : ""}>{rec.recommendedProvider}</span>{rec.shouldMigrate ? <span className="ml-1 rounded-full bg-[hsl(var(--primary)/.12)] px-2 py-0.5 cn-mono text-[9px] text-[hsl(var(--primary))]">MOVE RECOMMENDED</span> : <span className="ml-1 rounded-full bg-[hsl(159_46%_42%/.12)] px-2 py-0.5 cn-mono text-[9px] text-[hsl(159_46%_34%)]">ALREADY OPTIMAL</span>}</div>
        <p className="mt-3 text-xs leading-5 text-[hsl(var(--muted-foreground))]" data-testid="text-allocation-reason">{rec.reason}</p>
        {rec.estimatedFreeAfter != null && <p className="mt-2 text-[11px] text-[hsl(var(--muted-foreground))]">Estimated free space remaining after this file: {formatBytes(Math.max(0, rec.estimatedFreeAfter))}</p>}
        {rec.shouldMigrate && <button onClick={confirmMigration} disabled={migrate.isPending} className="cn-btn mt-4 inline-flex items-center gap-2 rounded-lg bg-[hsl(var(--primary))] px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-40" data-testid="button-confirm-allocation-migration"><ArrowRightLeft className="size-4" />{migrate.isPending ? "Moving…" : `Copy to ${rec.recommendedProvider}`}</button>}
        {migrated && <p className="mt-3 text-xs text-[hsl(159_46%_34%)]" data-testid="text-allocation-migrated">Done — a copy now lives on {rec.recommendedProvider}. The original on {rec.currentProvider} was left in place.</p>}
      </div>}
    </section>
  </PageFrame>;
}

function SharesPage() { const q = useListShares({ query: { queryKey: getListSharesQueryKey() } }); const filesQ = useListFiles(undefined, { query: { queryKey: getListFilesQueryKey() } }); const create = useCreateShare(); const revoke = useRevokeShare(); const queryClient = useQueryClient(); const [show, setShow] = useState(false); const [fileId, setFileId] = useState(""); const [permission, setPermission] = useState<"READ" | "WRITE">("READ"); const [expiresAt, setExpiresAt] = useState(""); const [copiedId, setCopiedId] = useState(""); const shares = q.data as Share[] | undefined; const files = filesQ.data as CloudFile[] | undefined; const createLink = () => { if (!fileId || !expiresAt) return; create.mutate({ data: { fileId, permission, expiresAt } }, { onSuccess: () => { setShow(false); setFileId(""); queryClient.invalidateQueries({ queryKey: getListSharesQueryKey() }); } }); }; const shareUrl = (token: string) => `${window.location.origin}/s/${token}`; const copyLink = (s: Share) => { navigator.clipboard.writeText(shareUrl(s.token)).then(() => { setCopiedId(s.id); setTimeout(() => setCopiedId(""), 2000); }); }; return <PageFrame><PageHeader eyebrow="Safe sharing" title="Links with an expiry." description="Keep control of what leaves your nest. Every link is visible, permissioned, and revocable." action={<button onClick={() => setShow(!show)} className="cn-btn cn-btn-primary inline-flex items-center gap-2 rounded-lg bg-[hsl(var(--primary))] px-4 py-2.5 text-xs font-semibold text-white" data-testid="button-create-share"><Plus className="size-4" />New share link</button>} />{show && <div className="cn-card mb-5 rounded-xl p-5"><div className="mb-4 flex items-center justify-between"><h2 className="text-sm font-semibold">Create a controlled link</h2><button onClick={() => setShow(false)} data-testid="button-close-share-form"><X className="size-4" /></button></div><div className="grid gap-3 sm:grid-cols-3"><select value={fileId} onChange={e => setFileId(e.target.value)} className="h-10 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-xs" data-testid="select-share-file"><option value="">Choose a file</option>{files?.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select><select value={permission} onChange={e => setPermission(e.target.value as "READ" | "WRITE")} className="h-10 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-xs" data-testid="select-share-permission"><option value="READ">Can view</option><option value="WRITE">Can view & replace</option></select><input type="datetime-local" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} className="h-10 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-xs" data-testid="input-share-expiry" /></div>{permission === "WRITE" && <p className="mt-3 text-[11px] leading-5 text-[hsl(var(--muted-foreground))]">Anyone with this link and the password (if set) can replace the file's content on {files?.find(f => f.id === fileId)?.provider ?? "its provider"}.</p>}<button onClick={createLink} disabled={create.isPending || !fileId || !expiresAt} className="cn-btn mt-4 rounded-lg bg-[hsl(var(--primary))] px-4 py-2.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40" data-testid="button-submit-share">{create.isPending ? "Creating…" : "Create link"}</button></div>}{q.isLoading ? <LoadingState rows={4} /> : q.isError ? <ErrorState retry={() => q.refetch()} /> : shares?.length ? <div className="cn-card overflow-hidden rounded-xl">{shares.map(s => <div key={s.id} className="flex flex-col gap-3 border-b border-[hsl(var(--border))] px-5 py-4 last:border-0 sm:flex-row sm:items-center"><span className="grid size-9 place-items-center rounded-lg bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))]"><Link2 className="size-4" /></span><div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{s.fileName}</div><div className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-[hsl(var(--muted-foreground))]"><span>{s.permission === "WRITE" ? "Can view & replace" : "Can view"}</span><span>·</span><span>Expires {formatDate(s.expiresAt)}</span><span>·</span><span>{s.accessCount} opens</span></div></div><div className="flex gap-2"><button onClick={() => copyLink(s)} className="inline-flex items-center gap-1.5 rounded-lg border border-[hsl(var(--border))] px-3 py-2 text-xs font-semibold hover:bg-[hsl(var(--muted))]" data-testid={`button-copy-share-${s.id}`}><Copy className="size-3.5" />{copiedId === s.id ? "Copied!" : "Copy link"}</button><button onClick={() => { if (window.confirm("Revoke this share link?")) revoke.mutate({ id: s.id }, { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListSharesQueryKey() }) }); }} className="rounded-lg border border-[hsl(var(--border))] px-3 py-2 text-xs font-semibold text-[hsl(var(--destructive))] hover:bg-[hsl(var(--destructive)/.07)]" data-testid={`button-revoke-share-${s.id}`}>Revoke</button></div></div>)}</div> : <EmptyState icon={Share2} title="No active share links" text="Create a link when you need to share a file, then let it expire." />}</PageFrame>; }

function FileDetailPage({ id }: { id: string }) {
  const q = useGetFile(id, { query: { enabled: Boolean(id), queryKey: getGetFileQueryKey(id) } });
  const del = useDeleteFile();
  const rename = useRenameFile();
  const move = useMoveFile();
  const migrate = useMigrateFile();
  const copyFile = useCopyFile();
  const providersQ = useListProviders({ query: { queryKey: getListProvidersQueryKey() } });
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const file = q.data as CloudFile | undefined;
  const providersList = providersQ.data as Provider[] | undefined;
  const Icon = fileIcon(file?.mimeType || "");
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveCategory, setMoveCategory] = useState("");
  const [migrateOpen, setMigrateOpen] = useState(false);
  const [migrateProvider, setMigrateProvider] = useState("");
  const [actionError, setActionError] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  if (q.isLoading) return <PageFrame><LoadingState rows={6} /></PageFrame>;
  if (q.isError || !file) return <PageFrame><ErrorState retry={() => q.refetch()} /></PageFrame>;
  const invalidate = () => { queryClient.invalidateQueries({ queryKey: getGetFileQueryKey(id) }); queryClient.invalidateQueries({ queryKey: getListFilesQueryKey() }); };
  const submitRename = () => {
    if (!nameDraft.trim() || nameDraft === file.name) { setRenaming(false); return; }
    setActionError("");
    rename.mutate({ id, data: { name: nameDraft.trim() } }, { onSuccess: () => { setRenaming(false); invalidate(); }, onError: (err) => setActionError(err instanceof Error ? err.message : "Rename failed") });
  };
  const submitMove = () => {
    if (!moveCategory) return;
    setActionError("");
    move.mutate({ id, data: { category: moveCategory } }, { onSuccess: () => { setMoveOpen(false); invalidate(); }, onError: (err) => setActionError(err instanceof Error ? err.message : "Move failed") });
  };
  const submitMigrate = () => {
    if (!migrateProvider) return;
    if (!window.confirm(`Copy "${file.name}" to ${migrateProvider}? The original on ${file.provider} will not be deleted.`)) return;
    setActionError("");
    migrate.mutate({ id, data: { toProvider: migrateProvider } }, { onSuccess: (created) => { setMigrateOpen(false); invalidate(); setLocation(`/files/${(created as CloudFile).id}`); }, onError: (err) => setActionError(err instanceof Error ? err.message : "Migration failed") });
  };
  const submitCopy = () => {
    setActionError("");
    copyFile.mutate({ id, data: {} }, { onSuccess: (created) => { invalidate(); setLocation(`/files/${(created as CloudFile).id}`); }, onError: (err) => setActionError(err instanceof Error ? err.message : "Copy failed") });
  };
  const otherProviders = providersList?.filter(p => p.connected && p.id !== file.provider) ?? [];
const mimeType = file.mimeType?.toLowerCase() ?? "";

const isImage = mimeType.startsWith("image/");
const isVideo = mimeType.startsWith("video/");
const isPdf = mimeType === "application/pdf";

const isExcel =
  mimeType.includes("spreadsheet") ||
  mimeType.includes("excel");

const isPreviewable = isImage || isVideo || isPdf || isExcel;

const loadPreview = async () => {
  if (previewUrl) {
    setPreviewUrl(null);
    setPreviewHtml(null);
    return;
  }

  setPreviewLoading(true);
  setPreviewError("");

  try {
    const response = await fetch(`/api/files/${id}/download`, {
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error("Could not load a preview from the provider.");
    }

    const blob = await response.blob();

    if (isExcel) {
      const arrayBuffer = await blob.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: "array" });

      const sheetName = workbook.SheetNames[0];

      if (!sheetName) {
        throw new Error("The Excel file has no worksheet.");
      }

      const worksheet = workbook.Sheets[sheetName];
      const html = XLSX.utils.sheet_to_html(worksheet);

      setPreviewHtml(html);
      setPreviewUrl("excel");
    } else {
      setPreviewHtml(null);
      setPreviewUrl(URL.createObjectURL(blob));
    }
  } catch (err) {
    setPreviewError(
      err instanceof Error ? err.message : "Preview failed"
    );
  } finally {
    setPreviewLoading(false);
  }
};
const downloadNow = async () => {
  try {
    const response = await fetch(`/api/files/${id}/download`, {
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error("Could not download this file from its provider.");
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    a.style.display = "none";

    document.body.appendChild(a);
    a.click();
    a.remove();

    window.setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
  } catch (err) {
    window.alert(
      err instanceof Error ? err.message : "Download failed"
    );
  }
};
  return <PageFrame><div className="mb-6 flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]"><Link href="/files" className="hover:text-[hsl(var(--primary))]" data-testid="link-back-files">All files</Link><ChevronRight className="size-3.5" /><span className="text-[hsl(var(--foreground))]">Details</span></div><div className="grid gap-6 lg:grid-cols-[1.15fr_.85fr]"><section className="cn-card rounded-xl p-6 md:p-8"><div className="flex items-start justify-between"><span className="grid size-14 place-items-center rounded-2xl bg-[hsl(var(--secondary))] text-[hsl(var(--primary))]"><Icon className="size-7" /></span><div className="flex gap-1"><button onClick={downloadNow} className="rounded-lg p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--primary)/.1)] hover:text-[hsl(var(--primary))]" data-testid="button-download-file-detail" title="Download"><UploadCloud className="size-4 rotate-180" /></button><button onClick={() => { setNameDraft(file.name); setRenaming(true); }} className="rounded-lg p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--primary)/.1)] hover:text-[hsl(var(--primary))]" data-testid="button-rename-file"><Pencil className="size-4" /></button><button onClick={() => { if (window.confirm(`Delete "${file.name}"? It will be removed from CloudNest and deleted from ${file.provider}.`)) del.mutate({ id }, { onSuccess: () => setLocation("/files") }); }} className="rounded-lg p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--destructive)/.1)] hover:text-[hsl(var(--destructive))]" data-testid="button-delete-file-detail"><Trash2 className="size-4" /></button></div></div>
    {renaming
      ? <div className="mt-7 flex gap-2"><input autoFocus value={nameDraft} onChange={e => setNameDraft(e.target.value)} onKeyDown={e => e.key === "Enter" && submitRename()} className="h-10 flex-1 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-lg font-semibold outline-none focus:border-[hsl(var(--primary))]" data-testid="input-rename-file" /><button onClick={submitRename} disabled={rename.isPending} className="cn-btn rounded-lg bg-[hsl(var(--primary))] px-4 text-xs font-semibold text-white" data-testid="button-confirm-rename">{rename.isPending ? "Saving…" : "Save"}</button><button onClick={() => setRenaming(false)} className="rounded-lg border border-[hsl(var(--border))] px-3 text-xs font-semibold" data-testid="button-cancel-rename">Cancel</button></div>
      : <h1 className="cn-display mt-7 break-words text-3xl font-semibold">{file.name}</h1>}
    <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">{file.path || "Indexed in your unified workspace"}</p>
    {actionError && <p className="mt-3 rounded-lg bg-[hsl(var(--destructive)/.1)] px-3 py-2 text-xs text-[hsl(var(--destructive))]" data-testid="text-file-action-error">{actionError}</p>}
    <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3">{[["Provider", file.provider], ["Type", titleCase(file.category)], ["Size", formatBytes(file.size)], ["Modified", formatDate(file.modifiedAt)], ["MIME", file.mimeType], ["Status", file.isDuplicate ? "Duplicate" : "Unique"]].map(([k, v]) => <div key={k} className="rounded-lg bg-[hsl(var(--muted)/.64)] p-3"><div className="cn-mono text-[9px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">{k}</div><div className="mt-1 truncate text-xs font-semibold">{v}</div></div>)}</div>
    <div className="mt-6 flex flex-wrap gap-2">
      {isPreviewable && <button onClick={loadPreview} disabled={previewLoading} className="cn-btn inline-flex items-center gap-2 rounded-lg border border-[hsl(var(--border))] px-4 py-2.5 text-xs font-semibold hover:bg-[hsl(var(--muted))] disabled:opacity-50" data-testid="button-toggle-preview"><FileText className="size-4" />{previewLoading ? "Loading…" : previewUrl ? "Hide preview" : "Preview"}</button>}
      <button onClick={downloadNow} className="cn-btn inline-flex items-center gap-2 rounded-lg border border-[hsl(var(--border))] px-4 py-2.5 text-xs font-semibold hover:bg-[hsl(var(--muted))]" data-testid="button-open-download"><UploadCloud className="size-4 rotate-180" />Download</button>
      <button onClick={() => { setMoveCategory(file.category); setMoveOpen(!moveOpen); setMigrateOpen(false); }} className="cn-btn inline-flex items-center gap-2 rounded-lg border border-[hsl(var(--border))] px-4 py-2.5 text-xs font-semibold hover:bg-[hsl(var(--muted))]" data-testid="button-toggle-move"><Folder className="size-4" />Move category</button>
      <button onClick={submitCopy} disabled={copyFile.isPending} className="cn-btn inline-flex items-center gap-2 rounded-lg border border-[hsl(var(--border))] px-4 py-2.5 text-xs font-semibold hover:bg-[hsl(var(--muted))] disabled:opacity-50" data-testid="button-copy-file"><Copy className="size-4" />{copyFile.isPending ? "Copying…" : "Copy"}</button>
      <button onClick={() => { setMigrateOpen(!migrateOpen); setMoveOpen(false); }} className="cn-btn inline-flex items-center gap-2 rounded-lg border border-[hsl(var(--border))] px-4 py-2.5 text-xs font-semibold hover:bg-[hsl(var(--muted))]" data-testid="button-toggle-migrate"><ArrowRightLeft className="size-4" />Migrate provider</button>
    </div>
    {previewError && <p className="mt-3 rounded-lg bg-[hsl(var(--destructive)/.1)] px-3 py-2 text-xs text-[hsl(var(--destructive))]" data-testid="text-preview-error">{previewError}</p>}
{previewUrl && (
  <div className="mt-4 overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted)/.4)]">
    {isExcel ? (
  <iframe
    srcDoc={previewHtml ?? ""}
    title={file.name}
    className="h-[480px] w-full bg-white"
    data-testid="iframe-excel-preview"
  />
) : isVideo ? (
  <video
    src={previewUrl}
    controls
    className="max-h-[480px] w-full"
    data-testid="video-file-preview"
  >
    Your browser does not support video playback.
  </video>
) : isImage ? (
  <img
    src={previewUrl}
    alt={file.name}
    className="max-h-[480px] w-full object-contain"
    data-testid="img-file-preview"
  />
) : (
  <iframe
    src={previewUrl}
    title={file.name}
    className="h-[480px] w-full"
    data-testid="iframe-file-preview"
  />
)}
  </div>
)}    {moveOpen && <div className="mt-4 flex gap-2 rounded-lg bg-[hsl(var(--muted)/.5)] p-3"><select value={moveCategory} onChange={e => setMoveCategory(e.target.value)} className="h-10 flex-1 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-xs" data-testid="select-move-category">{CATEGORY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}</select><button onClick={submitMove} disabled={move.isPending} className="cn-btn rounded-lg bg-[hsl(var(--primary))] px-4 text-xs font-semibold text-white" data-testid="button-confirm-move">{move.isPending ? "Moving…" : "Move"}</button></div>}
    {migrateOpen && <div className="mt-4 rounded-lg bg-[hsl(var(--muted)/.5)] p-3">{otherProviders.length === 0 ? <p className="text-xs text-[hsl(var(--muted-foreground))]">Connect another provider to migrate this file.</p> : <div className="flex gap-2"><select value={migrateProvider} onChange={e => setMigrateProvider(e.target.value)} className="h-10 flex-1 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-xs" data-testid="select-migrate-provider"><option value="">Choose destination</option>{otherProviders.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><button onClick={submitMigrate} disabled={migrate.isPending || !migrateProvider} className="cn-btn rounded-lg bg-[hsl(var(--primary))] px-4 text-xs font-semibold text-white disabled:opacity-40" data-testid="button-confirm-migrate">{migrate.isPending ? "Copying…" : "Copy there"}</button></div>}<p className="mt-2 text-[10px] text-[hsl(var(--muted-foreground))]">This copies the file; the original on {file.provider} is never deleted automatically.</p></div>}
    </section><section className="cn-card rounded-xl p-6"><div className="mb-5 flex items-center gap-2"><LockKeyhole className="size-4 text-[hsl(var(--primary))]" /><h2 className="text-sm font-semibold">Sharing & security</h2></div><p className="text-xs leading-5 text-[hsl(var(--muted-foreground))]">Share this file with a time-bound link. Permissions can be viewed and revoked from one place.</p><Link href="/shares" className="cn-btn mt-5 flex items-center justify-center gap-2 rounded-lg bg-[hsl(var(--primary))] px-4 py-2.5 text-xs font-semibold text-white" data-testid="link-share-file"><Share2 className="size-4" />Manage share links</Link><div className="mt-8 border-t border-[hsl(var(--border))] pt-5"><div className="flex items-center gap-2 text-xs font-semibold"><ShieldCheck className="size-4 text-[hsl(159 46% 42%)]" />Indexed safely</div><p className="mt-2 text-xs leading-5 text-[hsl(var(--muted-foreground))]">CloudNest stores metadata for this file. The original bytes remain in {file.provider}.</p></div></section></div></PageFrame>;
}

function ProfilePage() {
  const q = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const update = useUpdateMe();
  const changePw = useChangePassword();
  const queryClient = useQueryClient();
  const user = q.data as UserProfile | undefined;
  const [name, setName] = useState(""); const [email, setEmail] = useState("");
  const [profileSaved, setProfileSaved] = useState(false); const [profileError, setProfileError] = useState("");
  const [currentPw, setCurrentPw] = useState(""); const [newPw, setNewPw] = useState("");
  const [pwSaved, setPwSaved] = useState(false); const [pwError, setPwError] = useState("");
  useEffect(() => { if (user) { setName(user.name); setEmail(user.email); } }, [user?.id]);
  if (q.isLoading) return <PageFrame><LoadingState rows={5} /></PageFrame>;
  if (q.isError || !user) return <PageFrame><ErrorState retry={() => q.refetch()} /></PageFrame>;
  const initials = user.name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
  const saveProfile = () => { setProfileError(""); setProfileSaved(false); update.mutate({ data: { name, email } }, { onSuccess: () => { setProfileSaved(true); queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() }); }, onError: (err) => setProfileError(err instanceof Error ? err.message : "Could not save profile") }); };
  const savePassword = () => { setPwError(""); setPwSaved(false); changePw.mutate({ data: { currentPassword: currentPw, newPassword: newPw } }, { onSuccess: () => { setPwSaved(true); setCurrentPw(""); setNewPw(""); }, onError: (err) => setPwError(err instanceof Error ? err.message : "Could not change password") }); };
  return <PageFrame><PageHeader eyebrow="Account" title="Your workspace identity." description="A few details about the person steering this nest." /><div className="grid gap-6 lg:grid-cols-[.8fr_1.2fr]"><section className="cn-card rounded-xl p-6 text-center"><span className="mx-auto grid size-20 place-items-center rounded-3xl bg-[hsl(var(--accent))] text-2xl font-bold text-[hsl(var(--accent-foreground))]">{initials}</span><h2 className="mt-4 text-lg font-semibold">{user.name}</h2><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{user.email}</p><span className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-[hsl(159 46% 42%/.1)] px-2.5 py-1 cn-mono text-[9px] text-[hsl(159 46% 34%)]"><Check className="size-3" />ACCOUNT ACTIVE</span></section><div className="space-y-6"><section className="cn-card rounded-xl p-6"><h2 className="text-sm font-semibold">Profile details</h2><div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="text-xs font-medium">Full name<input value={name} onChange={e => setName(e.target.value)} className="mt-2 h-10 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-sm outline-none focus:border-[hsl(var(--primary))]" data-testid="input-profile-name" /></label><label className="text-xs font-medium">Email address<input value={email} onChange={e => setEmail(e.target.value)} className="mt-2 h-10 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-sm outline-none focus:border-[hsl(var(--primary))]" data-testid="input-profile-email" /></label></div>{profileError && <p className="mt-3 text-xs text-[hsl(var(--destructive))]" data-testid="text-profile-error">{profileError}</p>}{profileSaved && <p className="mt-3 text-xs text-[hsl(159_46%_34%)]" data-testid="text-profile-saved">Saved.</p>}<button onClick={saveProfile} disabled={update.isPending} className="cn-btn mt-5 rounded-lg bg-[hsl(var(--primary))] px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-40" data-testid="button-save-profile">{update.isPending ? "Saving…" : "Save profile"}</button></section><section className="cn-card rounded-xl p-6"><h2 className="text-sm font-semibold">Change password</h2><div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="text-xs font-medium">Current password<input type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)} className="mt-2 h-10 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-sm outline-none focus:border-[hsl(var(--primary))]" data-testid="input-current-password" /></label><label className="text-xs font-medium">New password<input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} className="mt-2 h-10 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-sm outline-none focus:border-[hsl(var(--primary))]" data-testid="input-new-password" /></label></div>{pwError && <p className="mt-3 text-xs text-[hsl(var(--destructive))]" data-testid="text-password-error">{pwError}</p>}{pwSaved && <p className="mt-3 text-xs text-[hsl(159_46%_34%)]" data-testid="text-password-saved">Password updated.</p>}<button onClick={savePassword} disabled={changePw.isPending || !currentPw || newPw.length < 8} className="cn-btn mt-5 rounded-lg bg-[hsl(var(--primary))] px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-40" data-testid="button-change-password">{changePw.isPending ? "Updating…" : "Update password"}</button></section></div></div></PageFrame>;
}

function SettingsPage() {
  const [helpOpen, setHelpOpen] = useState(false);
  const [compact, setCompact] = useCloudNestSetting(
    SETTINGS_KEYS.compact,
    false
  );

  const [notify, setNotify] = useCloudNestSetting(
    SETTINGS_KEYS.notifications,
    true
  );

  const providersQ = useListProviders({
    query: {
      queryKey: getListProvidersQueryKey(),
    },
  });

  const disconnect = useDisconnectProvider();
  const queryClient = useQueryClient();
  const logout = useLogout();
  const [, setLocation] = useLocation();

  const providers =
    (providersQ.data as Provider[] | undefined)?.filter(
      (p) => p.connected
    ) ?? [];

  const signOut = () => {
    logout.mutate(undefined, {
      onSuccess: () => {
        queryClient.removeQueries({
          queryKey: getGetMeQueryKey(),
        });

        setLocation("/home");
      },

      onError: () => {
        queryClient.removeQueries({
          queryKey: getGetMeQueryKey(),
        });

        setLocation("/home");
      },
    });
  };

  const disconnectAll = () => {
    if (!providers.length) return;

    if (
      !window.confirm(
        `Disconnect all ${providers.length} connected provider(s)? CloudNest will stop indexing new files from them.`
      )
    ) {
      return;
    }

    Promise.all(
      providers.map((p) =>
        disconnect.mutateAsync({
          provider: p.id,
        })
      )
    ).then(() =>
      queryClient.invalidateQueries({
        queryKey: getListProvidersQueryKey(),
      })
    );
  };

  return (
    <PageFrame>
      <PageHeader
        eyebrow="Preferences"
        title="Tune the cockpit."
        description="Keep the workspace aligned with how you actually work."
      />

      <div className="cn-card divide-y divide-[hsl(var(--border))] rounded-xl">

        <SettingRow
          icon={Bell}
          title="Activity notifications"
          text="Show a small alert when providers finish indexing."
          control={
            <button
              type="button"
              onClick={() => setNotify(!notify)}
              aria-pressed={notify}
              className={`relative h-7 w-12 shrink-0 rounded-full transition-all duration-200 ${
                notify
                  ? "bg-[hsl(var(--primary))]"
                  : "bg-[hsl(var(--muted))]"
              }`}
              data-testid="button-toggle-notifications"
            >
              <span
                className={`absolute top-1 size-5 rounded-full bg-white shadow-sm transition-all duration-200 ${
                  notify ? "left-6" : "left-1"
                }`}
              />
            </button>
          }
        />

        <SettingRow
          icon={PanelLeftClose}
          title="Compact file rows"
          text="Fit more files into the unified browser."
          control={
            <button
              type="button"
              onClick={() => setCompact(!compact)}
              aria-pressed={compact}
              className={`relative h-7 w-12 shrink-0 rounded-full transition-all duration-200 ${
                compact
                  ? "bg-[hsl(var(--primary))]"
                  : "bg-[hsl(var(--muted))]"
              }`}
              data-testid="button-toggle-compact"
            >
              <span
                className={`absolute top-1 size-5 rounded-full bg-white shadow-sm transition-all duration-200 ${
                  compact ? "left-6" : "left-1"
                }`}
              />
            </button>
          }
        />

        <SettingRow
          icon={Network}
          title="Connected clouds"
          text={`${providers.length} provider(s) connected. Manage individually from Providers.`}
          control={
            <button
              type="button"
              onClick={disconnectAll}
              disabled={
                !providers.length ||
                disconnect.isPending
              }
              className="rounded-lg border border-[hsl(var(--destructive)/.3)] px-3 py-2 text-xs font-semibold text-[hsl(var(--destructive))] hover:bg-[hsl(var(--destructive)/.07)] disabled:opacity-40"
              data-testid="button-disconnect-all"
            >
              Disconnect all
            </button>
          }
        />

        <SettingRow
          icon={LogOut}
          title="Session"
          text="Sign out of this CloudNest workspace on this device."
          control={
            <button
              type="button"
              onClick={signOut}
              disabled={logout.isPending}
              className="rounded-lg border border-[hsl(var(--border))] px-3 py-2 text-xs font-semibold hover:bg-[hsl(var(--muted))]"
              data-testid="button-sign-out"
            >
              {logout.isPending
                ? "Signing out…"
                : "Sign out"}
            </button>
          }
        />

      </div>



  <div className="mt-6 rounded-xl border border-[hsl(var(--accent)/.3)] bg-[hsl(var(--accent)/.08)] p-5">
  <div className="flex items-center gap-3">
    <CircleHelp className="size-4 shrink-0 text-[hsl(31 70% 35%)]" />

    <div className="min-w-0 flex-1">
      <h2 className="text-sm font-semibold">
        Need a hand?
      </h2>

      <p className="mt-1 text-xs leading-5 text-[hsl(var(--muted-foreground))]">
        CloudNest is designed to be readable at a glance.
        If a provider needs credentials, its connection card
        will say so plainly.
      </p>
    </div>

    <button
      type="button"
      onClick={() => setHelpOpen(!helpOpen)}
      className="shrink-0 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-xs font-semibold transition-colors hover:bg-[hsl(var(--muted))]"
    >
      {helpOpen ? "Hide" : "Explore"}
      <ChevronRight
        className={`ml-1 inline-block size-3 transition-transform ${
          helpOpen ? "rotate-90" : ""
        }`}
      />
    </button>
  </div>

  {helpOpen && (
    <div className="mt-5 grid gap-3 border-t border-[hsl(var(--border)/.7)] pt-5 sm:grid-cols-2">

      <Link
        href="/providers"
        className="group flex items-center gap-3 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card)/.7)] p-3 transition-colors hover:bg-[hsl(var(--card))]"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))]">
          <Network className="size-4" />
        </span>

        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold">
            Manage providers
          </span>
          <span className="mt-1 block text-[10px] text-[hsl(var(--muted-foreground))]">
            Connect or manage your cloud storage.
          </span>
        </span>

        <ChevronRight className="size-4 text-[hsl(var(--muted-foreground))] transition-transform group-hover:translate-x-0.5" />
      </Link>

      <Link
        href="/files"
        className="group flex items-center gap-3 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card)/.7)] p-3 transition-colors hover:bg-[hsl(var(--card))]"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))]">
          <Folder className="size-4" />
        </span>

        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold">
            Browse files
          </span>
          <span className="mt-1 block text-[10px] text-[hsl(var(--muted-foreground))]">
            Search and manage your unified files.
          </span>
        </span>

        <ChevronRight className="size-4 text-[hsl(var(--muted-foreground))] transition-transform group-hover:translate-x-0.5" />
      </Link>

      <Link
        href="/duplicates"
        className="group flex items-center gap-3 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card)/.7)] p-3 transition-colors hover:bg-[hsl(var(--card))]"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[hsl(var(--accent)/.15)] text-[hsl(31 70% 35%)]">
          <Copy className="size-4" />
        </span>

        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold">
            Review duplicates
          </span>
          <span className="mt-1 block text-[10px] text-[hsl(var(--muted-foreground))]">
            Find and review duplicate files.
          </span>
        </span>

        <ChevronRight className="size-4 text-[hsl(var(--muted-foreground))] transition-transform group-hover:translate-x-0.5" />
      </Link>

      <Link
        href="/activity"
        className="group flex items-center gap-3 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card)/.7)] p-3 transition-colors hover:bg-[hsl(var(--card))]"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))]">
          <ActivityIcon className="size-4" />
        </span>

        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold">
            Recent activity
          </span>
          <span className="mt-1 block text-[10px] text-[hsl(var(--muted-foreground))]">
            See uploads, syncs, and workspace events.
          </span>
        </span>

        <ChevronRight className="size-4 text-[hsl(var(--muted-foreground))] transition-transform group-hover:translate-x-0.5" />
      </Link>

    </div>
  )}
</div>

    </PageFrame>
  );
};

function SettingRow({ icon: Icon, title, text, control }: { icon: typeof Bell; title: string; text: string; control: ReactNode }) { return <div className="flex items-center gap-4 px-5 py-5"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[hsl(var(--secondary))] text-[hsl(var(--primary))]"><Icon className="size-4" /></span><div className="min-w-0 flex-1"><div className="text-sm font-semibold">{title}</div><div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{text}</div></div>{control}</div>; }

function HomePage() {
  const q = useHealthCheck({
    query: { queryKey: getHealthCheckQueryKey() }
  });

  const meQ = useGetMe({
    query: { queryKey: getGetMeQueryKey() }
  });

  const isLoggedIn = !!meQ.data;

  const startDestination = isLoggedIn ? "/dashboard" : "/login";
  const workspaceDestination = isLoggedIn ? "/dashboard" : "/login";
  const providersDestination = isLoggedIn ? "/providers" : "/login";

  return (
    <div className="cn-app min-h-[100dvh]">

      {/* =========================
          HEADER
      ========================== */}
      <header className="w-full">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-5 md:px-10 lg:px-12">
          <Logo />

          <div className="flex items-center gap-3">
            {!isLoggedIn && (
              <Link
                href="/login"
                className="cn-btn rounded-lg px-4 py-2.5 text-xs font-semibold text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]"
                data-testid="link-sign-in"
              >
                Sign in
              </Link>
            )}

            <Link
              href={workspaceDestination}
              className="cn-btn inline-flex items-center gap-1 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card)/.7)] px-4 py-2.5 text-xs font-semibold hover:bg-[hsl(var(--card))]"
              data-testid="link-open-workspace"
            >
              Open workspace
              <ChevronRight className="size-3.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* =========================
          HERO
      ========================== */}
      <main className="w-full">
        <div className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-12 px-6 pb-12 pt-12 md:grid-cols-[1.08fr_.92fr] md:gap-12 md:px-10 md:pb-14 md:pt-14 lg:grid-cols-[1.1fr_.9fr] lg:px-12">

          {/* =====================
              LEFT HERO CONTENT
          ====================== */}
          <div className="cn-reveal flex flex-col items-start justify-start">

            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[hsl(var(--primary)/.2)] bg-[hsl(var(--primary)/.07)] px-3 py-1.5 cn-mono text-[10px] text-[hsl(var(--primary))]">
              <span className="size-1.5 rounded-full bg-[hsl(var(--primary))]" />

              {q.data?.status === "ok"
                ? "ALL SYSTEMS NOMINAL"
                : "CLOUD INDEX ONLINE"}
            </div>

            <h1 className="cn-display max-w-[700px] text-left text-[50px] font-semibold leading-[.94] tracking-[-.055em] text-[hsl(var(--foreground))] sm:text-[60px] md:text-[68px] lg:text-[76px]">
              Your clouds,
              <br />
              <span className="text-[hsl(var(--primary))]">
                finally in formation.
              </span>
            </h1>

            <p className="mt-6 max-w-[590px] text-left text-[15px] leading-7 text-[hsl(var(--muted-foreground))]">
              CloudNest brings Drive, OneDrive, and Dropbox into one clear
              workspace — so your files feel closer, not scattered.
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link
                href={startDestination}
                className="cn-btn cn-btn-primary inline-flex items-center gap-2 rounded-lg bg-[hsl(var(--primary))] px-5 py-3 text-sm font-semibold text-white"
                data-testid="link-start-organizing"
              >
                Start organizing
                <ChevronRight className="size-4" />
              </Link>

              <Link
                href={providersDestination}
                className="cn-btn inline-flex items-center gap-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card)/.65)] px-5 py-3 text-sm font-semibold hover:bg-[hsl(var(--card))]"
                data-testid="link-connect-clouds"
              >
                Connect clouds
              </Link>
            </div>
          </div>

          {/* =====================
              RIGHT HERO CARD
          ====================== */}
          <div className="cn-reveal cn-reveal-delay-2 relative flex w-full items-start justify-end">

            <div className="absolute -inset-8 rounded-[3rem] bg-[hsl(188_64%_88%/.45)] blur-3xl" />

            <div className="relative w-full max-w-[500px] rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.86)] p-5 shadow-[0_24px_70px_hsl(221_35%_20%/.12)] backdrop-blur-xl">

              {/* CARD HEADER */}
              <div className="flex items-center justify-between border-b border-[hsl(var(--border))] pb-4">
                <div className="flex items-center gap-2">
                  <span className="size-2 rounded-full bg-[hsl(var(--primary))]" />

                  <span className="cn-mono text-[10px] uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
                    How it works
                  </span>
                </div>
              </div>

              {/* STEPS */}
              <div className="space-y-3 py-4">
                {[
                  ["1", "Connect Drive, OneDrive, or Dropbox", Network],
                  [
                    "2",
                    "Upload — CloudNest hashes, categorizes, and files it automatically",
                    Sparkles
                  ],
                  [
                    "3",
                    "Search, share, and track it all from one index",
                    ShieldCheck
                  ]
                ].map(([step, text, Icon]) => (
                  <div
                    key={step as string}
                    className="flex items-center gap-3 rounded-xl bg-[hsl(var(--secondary)/.7)] p-3"
                  >
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[hsl(var(--primary)/.12)] text-xs font-bold text-[hsl(var(--primary))]">
                      {step as string}
                    </span>

                    <span className="flex-1 text-xs leading-5">
                      {text as string}
                    </span>

                    {typeof Icon !== "string" && (
                      <Icon className="size-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
                    )}
                  </div>
                ))}
              </div>

              {/* PROVIDERS */}
              <div className="space-y-2 rounded-xl border border-[hsl(var(--border))] p-4">
                <div className="text-xs font-semibold">
                  Providers CloudNest unifies
                </div>

                {["Google Drive", "OneDrive", "Dropbox"].map((label) => (
                  <div
                    key={label}
                    className="flex items-center gap-2 text-[11px] text-[hsl(var(--muted-foreground))]"
                  >
                    <i
                      className="size-2 rounded-full"
                      style={{ backgroundColor: providerColor(label) }}
                    />

                    {label}
                  </div>
                ))}
              </div>

              {/* STORAGE MESSAGE */}
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-[hsl(var(--primary)/.07)] px-3 py-2 text-[11px] text-[hsl(var(--primary))]">
                <ShieldCheck className="size-3.5" />

                Your storage numbers appear here once you connect a provider
              </div>

            </div>
          </div>
        </div>
      </main>

      {/* =========================
          FEATURES
      ========================== */}
      <section className="w-full">
        <div className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-4 px-6 pb-16 md:grid-cols-3 md:px-10 lg:px-12">

          {/* FEATURE 1 */}
          <div className="min-h-[155px] rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.6)] p-5">
            <Network className="mb-6 size-5 text-[hsl(var(--primary))]" />

            <h3 className="font-semibold">
              One calm index
            </h3>

            <p className="mt-2 text-sm leading-6 text-[hsl(var(--muted-foreground))]">
              See every file, provider, and category without opening three tabs.
            </p>
          </div>

          {/* FEATURE 2 */}
          <div className="min-h-[155px] rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.6)] p-5">
            <Copy className="mb-6 size-5 text-[hsl(var(--accent-foreground))]" />

            <h3 className="font-semibold">
              No wasted space
            </h3>

            <p className="mt-2 text-sm leading-6 text-[hsl(var(--muted-foreground))]">
              Find duplicates with enough context to make the safe call.
            </p>
          </div>

          {/* FEATURE 3 */}
          <div className="min-h-[155px] rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.6)] p-5">
            <LockKeyhole className="mb-6 size-5 text-[hsl(var(--primary))]" />

            <h3 className="font-semibold">
              Sharing with edges
            </h3>

            <p className="mt-2 text-sm leading-6 text-[hsl(var(--muted-foreground))]">
              Create links that expire, track access, and leave no ambiguity.
            </p>
          </div>

        </div>
      </section>

    </div>
  );
}

function AuthPage({ register = false }: { register?: boolean }) {
  const [, navigate] = useLocation();
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch(`/api/auth/${register ? "register" : "login"}`, { method: "POST", headers: { "content-type": "application/json" }, credentials: "include", body: JSON.stringify(register ? { name, email, password } : { email, password }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Unable to authenticate");
      navigate("/dashboard");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to authenticate"); } finally { setBusy(false); }
  };
  return <div className="cn-app cn-grid grid min-h-[100dvh] place-items-center p-5"><div className="w-full max-w-md"><div className="mb-8 flex justify-center"><Logo /></div><div className="cn-card rounded-2xl p-7 md:p-9"><div className="mb-7"><div className="cn-mono text-[10px] uppercase tracking-[.17em] text-[hsl(var(--primary))]">Private workspace</div><h1 className="cn-display mt-2 text-4xl font-semibold">{register ? "Create your nest." : "Welcome back."}</h1><p className="mt-3 text-sm leading-6 text-[hsl(var(--muted-foreground))]">{register ? "Start bringing your cloud files into one clear index." : "Sign in to continue to your unified cloud workspace."}</p></div><form onSubmit={submit} className="space-y-4">{register && <label className="block text-xs font-semibold">Name<input required value={name} onChange={e => setName(e.target.value)} className="mt-2 h-11 w-full rounded-lg border border-[hsl(var(--border))] bg-transparent px-3 text-sm outline-none focus:border-[hsl(var(--primary))]" /></label>}<label className="block text-xs font-semibold">Email<input required type="email" value={email} onChange={e => setEmail(e.target.value)} className="mt-2 h-11 w-full rounded-lg border border-[hsl(var(--border))] bg-transparent px-3 text-sm outline-none focus:border-[hsl(var(--primary))]" /></label><label className="block text-xs font-semibold">Password<input required minLength={8} type="password" value={password} onChange={e => setPassword(e.target.value)} className="mt-2 h-11 w-full rounded-lg border border-[hsl(var(--border))] bg-transparent px-3 text-sm outline-none focus:border-[hsl(var(--primary))]" /></label>{error && <p className="rounded-lg bg-[hsl(var(--destructive)/.1)] px-3 py-2 text-xs text-[hsl(var(--destructive))]">{error}</p>}<button disabled={busy} className="cn-btn cn-btn-primary w-full rounded-lg bg-[hsl(var(--primary))] px-4 py-3 text-sm font-semibold text-white">{busy ? "Working…" : register ? "Create account" : "Sign in"}</button></form><div className="mt-6 text-center text-xs text-[hsl(var(--muted-foreground))]">{register ? "Already have an account? " : "New to CloudNest? "}<Link href={register ? "/login" : "/register"} className="font-semibold text-[hsl(var(--primary))]">{register ? "Sign in" : "Create an account"}</Link></div></div></div></div>;
}

function NotFoundPage() { return <div className="cn-app grid min-h-[100dvh] place-items-center p-6"><div className="text-center"><div className="cn-mono text-xs text-[hsl(var(--primary))]">ERROR 404 / LOST IN THE CLOUD</div><h1 className="cn-display mt-4 text-6xl font-semibold">That view drifted away.</h1><p className="mx-auto mt-4 max-w-sm text-sm leading-6 text-[hsl(var(--muted-foreground))]">The page you're looking for is not in this workspace.</p><Link href="/dashboard" className="mt-7 inline-flex rounded-lg bg-[hsl(var(--primary))] px-4 py-2.5 text-xs font-semibold text-white" data-testid="link-return-dashboard">Return to dashboard</Link></div></div>; }

interface ShareInfo { fileName: string; mimeType?: string; size?: number; permission: "READ" | "WRITE"; passwordProtected: boolean }

// Standalone, unauthenticated page for whoever receives a share link - it never renders the
// app shell (sidebar/nav) since the visitor isn't a CloudNest account holder. Handles the
// full loop: fetch share metadata, verify password if needed, download, and - for WRITE
// links only - upload a replacement file straight through to the real cloud provider.
function SharedFilePage({ token }: { token: string }) {
  const [info, setInfo] = useState<ShareInfo | null>(null);
  const [loadError, setLoadError] = useState("");
  const [password, setPassword] = useState("");
  const [verified, setVerified] = useState(false);
  const [verifyError, setVerifyError] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [replaceFile, setReplaceFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadDone, setUploadDone] = useState(false);
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    fetch(`/api/share/${token}`).then(async (r) => {
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || "This link is not available.");
      setInfo(body);
      if (!body.passwordProtected) setVerified(true);
    }).catch((err) => setLoadError(err instanceof Error ? err.message : "This link is not available."));
  }, [token]);

  const verify = async () => {
    setVerifying(true); setVerifyError("");
    try {
      const r = await fetch(`/api/share/${token}/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || "Incorrect password");
      setVerified(true);
    } catch (err) { setVerifyError(err instanceof Error ? err.message : "Incorrect password"); } finally { setVerifying(false); }
  };

  const download = async () => {
    setDownloading(true); setActionError("");
    try {
      const r = await fetch(`/api/share/${token}/download`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
      if (!r.ok) { const body = await r.json().catch(() => ({})); throw new Error(body.error || "Download failed"); }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = info?.fileName || "download"; a.click();
      URL.revokeObjectURL(url);
    } catch (err) { setActionError(err instanceof Error ? err.message : "Download failed"); } finally { setDownloading(false); }
  };

  const uploadReplacement = async () => {
    if (!replaceFile) return;
    setUploading(true); setActionError(""); setUploadDone(false);
    try {
      const form = new FormData(); form.append("file", replaceFile); form.append("password", password);
      const r = await fetch(`/api/share/${token}/upload`, { method: "POST", body: form });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || "Upload failed");
      setUploadDone(true); setReplaceFile(null);
    } catch (err) { setActionError(err instanceof Error ? err.message : "Upload failed"); } finally { setUploading(false); }
  };

  return <div className="cn-app cn-grid grid min-h-[100dvh] place-items-center p-5"><div className="w-full max-w-md"><div className="mb-8 flex justify-center"><Logo /></div><div className="cn-card rounded-2xl p-7 md:p-9">
    {loadError ? <div className="text-center"><AlertTriangle className="mx-auto size-8 text-[hsl(var(--destructive))]" /><p className="mt-4 text-sm font-semibold" data-testid="text-share-load-error">{loadError}</p></div> : !info ? <LoadingState rows={3} /> : <>
      <div className="mb-6 flex items-center gap-3"><span className="grid size-11 place-items-center rounded-xl bg-[hsl(var(--secondary))] text-[hsl(var(--primary))]"><FileText className="size-5" /></span><div className="min-w-0"><h1 className="truncate text-lg font-semibold" data-testid="text-share-filename">{info.fileName}</h1><p className="text-xs text-[hsl(var(--muted-foreground))]">{info.size ? formatBytes(info.size) : ""} · {info.permission === "WRITE" ? "Can view & replace" : "Can view"}</p></div></div>
      {!verified ? <div>
        <label className="block text-xs font-semibold">This link is password protected<input type="password" value={password} onChange={e => setPassword(e.target.value)} className="mt-2 h-11 w-full rounded-lg border border-[hsl(var(--border))] bg-transparent px-3 text-sm outline-none focus:border-[hsl(var(--primary))]" data-testid="input-share-password" /></label>
        {verifyError && <p className="mt-3 rounded-lg bg-[hsl(var(--destructive)/.1)] px-3 py-2 text-xs text-[hsl(var(--destructive))]" data-testid="text-share-verify-error">{verifyError}</p>}
        <button onClick={verify} disabled={verifying || !password} className="cn-btn cn-btn-primary mt-4 w-full rounded-lg bg-[hsl(var(--primary))] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50" data-testid="button-verify-share">{verifying ? "Checking…" : "Unlock"}</button>
      </div> : <div className="space-y-4">
        <button onClick={download} disabled={downloading} className="cn-btn cn-btn-primary flex w-full items-center justify-center gap-2 rounded-lg bg-[hsl(var(--primary))] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50" data-testid="button-share-download"><UploadCloud className="size-4 rotate-180" />{downloading ? "Downloading…" : "Download file"}</button>
        {info.permission === "WRITE" && <div className="rounded-lg border border-[hsl(var(--border))] p-4">
          <div className="text-xs font-semibold">Replace this file</div>
          <p className="mt-1 text-[11px] leading-5 text-[hsl(var(--muted-foreground))]">This link has write access. Uploading a new file here replaces the original on {info.fileName ? "the owner's cloud provider" : "the provider"} — the previous version is not kept.</p>
<input
  type="file"
  onChange={(e) => {
    const selectedFile = e.currentTarget.files?.[0] ?? null;
    setReplaceFile(selectedFile);
    setActionError("");
    setUploadDone(false);
  }}
  className="mt-3 w-full text-xs"
  data-testid="input-share-replace-file"
/>
<button
  type="button"
  onClick={uploadReplacement}
  disabled={uploading || !replaceFile}
  className="cn-btn mt-3 w-full rounded-lg border border-[hsl(var(--border))] px-4 py-2.5 text-xs font-semibold hover:bg-[hsl(var(--muted))] disabled:opacity-50"
  data-testid="button-share-upload"
>
  {uploading ? "Uploading..." : "Upload replacement"}
</button>          {uploadDone && <p className="mt-3 text-xs text-[hsl(159_46%_34%)]" data-testid="text-share-upload-done">File replaced successfully.</p>}
        </div>}
        {actionError && <p className="rounded-lg bg-[hsl(var(--destructive)/.1)] px-3 py-2 text-xs text-[hsl(var(--destructive))]" data-testid="text-share-action-error">{actionError}</p>}
      </div>}
    </>}
  </div><p className="mt-6 text-center text-xs text-[hsl(var(--muted-foreground))]">Shared securely via CloudNest</p></div></div>;
}

export { ActivityPage, AnalyticsPage, AuthPage, CategoriesPage, DashboardPage, DuplicatesPage, FileDetailPage, FilesPage, HomePage, NotFoundPage, ProfilePage, ProvidersPage, SettingsPage, SharedFilePage, SharesPage, StorageAllocationPage };