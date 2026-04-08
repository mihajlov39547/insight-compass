/**
 * Resource classification utilities.
 * Two axes: resource type (what it is) and source type (where it came from).
 * Designed for extensibility — future resource kinds plug in here.
 */

// ── Resource Types ──────────────────────────────────────────────────
export type ResourceType =
  | 'document' | 'image' | 'spreadsheet' | 'presentation'
  | 'email' | 'text' | 'dataset' | 'audio' | 'video' | 'link' | 'other';

const RESOURCE_TYPE_VALUES: ResourceType[] = [
  'document', 'image', 'spreadsheet', 'presentation', 'email', 'text', 'dataset', 'audio', 'video', 'link', 'other',
];

export const RESOURCE_TYPE_LABELS: Record<ResourceType, string> = {
  document: 'Document',
  image: 'Image',
  spreadsheet: 'Spreadsheet',
  presentation: 'Presentation',
  email: 'Email',
  text: 'Text',
  dataset: 'Data',
  audio: 'Audio',
  video: 'Video',
  link: 'Link',
  other: 'Other',
};

export const RESOURCE_TYPE_ICONS: Record<ResourceType, string> = {
  document: 'FileText',
  image: 'Image',
  spreadsheet: 'FileSpreadsheet',
  presentation: 'Presentation',
  email: 'Mail',
  text: 'FileType',
  dataset: 'Database',
  audio: 'Music',
  video: 'Video',
  link: 'Link',
  other: 'File',
};

// ── Source Types ─────────────────────────────────────────────────────
export type SourceType = 'uploaded' | 'linked' | 'synced' | 'generated' | 'imported';

const SOURCE_TYPE_VALUES: SourceType[] = ['uploaded', 'linked', 'synced', 'generated', 'imported'];

export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  uploaded: 'Uploaded',
  linked: 'Linked',
  synced: 'Synced',
  generated: 'Generated',
  imported: 'Imported',
};

// ── Provider ─────────────────────────────────────────────────────────
export type SourceProvider =
  | 'local_upload' | 'google_drive' | 'youtube' | 'dropbox'
  | 'notion' | 'internal' | 'email_import' | 'unknown';

// ── Container Types ──────────────────────────────────────────────────
export type ContainerType = 'project' | 'notebook' | 'personal';

export const CONTAINER_TYPE_LABELS: Record<ContainerType, string> = {
  project: 'Project',
  notebook: 'Notebook',
  personal: 'Personal',
};

// ── Processing / Readiness ───────────────────────────────────────────
export type ReadinessStatus = 'ready' | 'processing' | 'failed' | 'partial' | 'unknown';

export function deriveReadiness(processingStatus: string): ReadinessStatus {
  if (processingStatus === 'completed') return 'ready';
  if (processingStatus === 'failed') return 'failed';
  if (['uploaded', 'extracting_metadata', 'extracting_content', 'detecting_language',
    'summarizing', 'indexing', 'chunking', 'generating_embeddings',
    'generating_chunk_questions', 'pending', 'queued', 'claimed',
    'running', 'waiting_retry'].includes(processingStatus)) return 'processing';
  return 'unknown';
}

// ── Unified Resource Shape ───────────────────────────────────────────
export interface Resource {
  id: string;
  resourceKind: string;
  resourceType: ResourceType;
  sourceType: SourceType;
  provider: SourceProvider;
  title: string;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  storagePath: string;
  ownerUserId: string;
  ownerDisplayName: string;
  containerType: ContainerType;
  containerId: string | null;
  containerName: string | null;
  isOwnedByMe: boolean;
  isSharedWithMe: boolean;
  // Backward-compatible alias for legacy shared chip/filter behavior.
  isShared: boolean;
  canOpen: boolean;
  canViewDetails: boolean;
  canDownload: boolean;
  canRename: boolean;
  canDelete: boolean;
  canRetry: boolean;
  uploadedAt: string;
  updatedAt: string;
  processingStatus: string;
  processingError: string | null;
  readiness: ReadinessStatus;
  summary: string | null;
  pageCount: number | null;
  wordCount: number | null;
  detectedLanguage: string | null;
}

function parseResourceType(value: unknown): ResourceType {
  if (typeof value === 'string' && RESOURCE_TYPE_VALUES.includes(value as ResourceType)) {
    return value as ResourceType;
  }
  return 'other';
}

function parseSourceType(value: unknown): SourceType {
  if (typeof value === 'string' && SOURCE_TYPE_VALUES.includes(value as SourceType)) {
    return value as SourceType;
  }
  return 'uploaded';
}

/**
 * Maps a raw row from get_user_resources RPC into the frontend Resource shape.
 */
export function mapRpcRowToResource(row: Record<string, any>): Resource {
  // Backend RPC classification is canonical; frontend only validates unknown values.
  const resourceType = parseResourceType(row.resource_type);
  const sourceType = parseSourceType(row.source_type);
  const sharedWithMe = row.is_shared_with_me ?? row.is_shared ?? false;
  const ownedByMe = row.is_owned_by_me ?? !sharedWithMe;

  return {
    id: row.id,
    resourceKind: row.resource_kind,
    resourceType,
    sourceType,
    provider: (row.provider || 'local_upload') as SourceProvider,
    title: row.title,
    mimeType: row.mime_type,
    extension: row.extension,
    sizeBytes: Number(row.size_bytes),
    storagePath: row.storage_path,
    ownerUserId: row.owner_user_id,
    ownerDisplayName: row.owner_display_name || 'Unknown',
    containerType: (row.container_type || 'personal') as ContainerType,
    containerId: row.container_id || null,
    containerName: row.container_name || null,
    isOwnedByMe: !!ownedByMe,
    isSharedWithMe: !!sharedWithMe,
    isShared: !!sharedWithMe,
    canOpen: row.can_open ?? true,
    canViewDetails: row.can_view_details ?? true,
    canDownload: row.can_download ?? true,
    canRename: row.can_rename ?? false,
    canDelete: row.can_delete ?? false,
    canRetry: row.can_retry ?? false,
    uploadedAt: row.uploaded_at,
    updatedAt: row.updated_at,
    processingStatus: row.processing_status,
    processingError: row.processing_error || null,
    readiness: deriveReadiness(row.processing_status),
    summary: row.summary || null,
    pageCount: row.page_count,
    wordCount: row.word_count,
    detectedLanguage: row.detected_language || null,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

export function truncateFileName(name: string, maxBase = 35): string {
  const dotIndex = name.lastIndexOf('.');
  if (dotIndex === -1) return name.length > maxBase ? name.slice(0, maxBase) + '…' : name;
  const base = name.slice(0, dotIndex);
  const ext = name.slice(dotIndex);
  if (base.length <= maxBase) return name;
  return base.slice(0, maxBase) + '…' + ext;
}
