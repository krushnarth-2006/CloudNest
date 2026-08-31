export * from "./generated/api";
// UploadFileBody is exported twice by orval for multipart/binary schemas: once as a
// runtime zod schema from ./generated/api, and once as a plain TS interface from
// ./generated/types (needed because zod.instanceof(File) doesn't infer a usable type).
// Re-export types explicitly, skipping the interface, so the zod schema wins the name.
export type {
  Activity,
  AllocationRecommendation,
  Analytics,
  ChangePasswordInput,
  CopyFileInput,
  CreateFolderInput,
  Dashboard,
  DuplicateGroup,
  File,
  FileInput,
  FolderResult,
  HealthStatus,
  ListFilesParams,
  Metric,
  MigrateFileInput,
  MoveFileInput,
  Provider,
  RenameFileInput,
  Share,
  ShareInput,
  ShareInputPermission,
  SyncSummary,
  UpdateProfileInput,
  UserProfile,
} from "./generated/types";
