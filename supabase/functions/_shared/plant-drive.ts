// Shared helpers for Google Drive uploads of plant-case images.

export const DRIVE_GATEWAY_UPLOAD =
  'https://connector-gateway.lovable.dev/google_drive/upload/drive/v3/files';
export const DRIVE_GATEWAY_FILES =
  'https://connector-gateway.lovable.dev/google_drive/drive/v3/files';

export interface DriveEnv {
  lovableKey: string;
  driveKey: string;
  folderId: string;
}

export function readDriveEnv(): { env: DriveEnv | null; error: string | null } {
  const lovableKey = Deno.env.get('LOVABLE_API_KEY');
  const driveKey = Deno.env.get('GOOGLE_DRIVE_API_KEY');
  const folderId = Deno.env.get('PLANT_IMAGES_DRIVE_FOLDER_ID');
  if (!lovableKey || !driveKey) {
    return { env: null, error: 'google_drive_not_connected' };
  }
  if (!folderId) {
    return { env: null, error: 'drive_folder_not_configured' };
  }
  return { env: { lovableKey, driveKey, folderId }, error: null };
}

export function sanitizeDriveName(s: string): string {
  return (s || 'image')
    .replace(/[\\/\r\n\t]+/g, '_')
    .replace(/[^\w.\- ()]+/g, '_')
    .slice(0, 180) || 'image';
}

export function extFromMime(mime: string): string {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'bin';
}

export interface DriveUploadResult {
  id: string;
  webViewLink: string | null;
  webContentLink: string | null;
  mimeType: string | null;
  thumbnailLink: string | null;
  thumbnailVersion: string | null;
  hasThumbnail: boolean | null;
  imageWidth: number | null;
  imageHeight: number | null;
}

export const DRIVE_FILE_FIELDS =
  'id,name,mimeType,webViewLink,webContentLink,thumbnailLink,hasThumbnail,thumbnailVersion,imageMediaMetadata(width,height)';

export async function uploadBytesToDrive(opts: {
  env: DriveEnv;
  bytes: Uint8Array;
  filename: string;
  mimeType: string;
  appProperties?: Record<string, string>;
}): Promise<DriveUploadResult> {

  const { env, bytes, filename, mimeType, appProperties } = opts;
  const metadata: Record<string, unknown> = {
    name: filename,
    mimeType,
    parents: [env.folderId],
    description: 'Researcher plant-advisor image',
    appProperties: { source: 'researcher', kind: 'plant-image', ...(appProperties || {}) },
  };
  const boundary = '----researcher-' + crypto.randomUUID().replace(/-/g, '');
  const enc = new TextEncoder();
  const head = enc.encode(
    `--${boundary}\r\n` +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) +
      `\r\n--${boundary}\r\n` +
      `Content-Type: ${mimeType}\r\n` +
      'Content-Transfer-Encoding: binary\r\n\r\n',
  );
  const tail = enc.encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(head.byteLength + bytes.byteLength + tail.byteLength);
  body.set(head, 0);
  body.set(bytes, head.byteLength);
  body.set(tail, head.byteLength + bytes.byteLength);

  const url = new URL(DRIVE_GATEWAY_UPLOAD);
  url.searchParams.set('uploadType', 'multipart');
  url.searchParams.set('fields', DRIVE_FILE_FIELDS);

  const resp = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.lovableKey}`,
      'X-Connection-Api-Key': env.driveKey,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    const err = new Error(`drive_upload_failed_${resp.status}: ${text.slice(0, 300)}`);
    (err as any).status = resp.status;
    throw err;
  }
  const file = await resp.json();
  const meta = file.imageMediaMetadata || {};
  return {
    id: String(file.id),
    webViewLink: file.webViewLink ?? null,
    webContentLink: file.webContentLink ?? null,
    mimeType: file.mimeType ?? mimeType,
    thumbnailLink: file.thumbnailLink ?? null,
    thumbnailVersion: file.thumbnailVersion ?? null,
    hasThumbnail: typeof file.hasThumbnail === 'boolean' ? file.hasThumbnail : null,
    imageWidth: typeof meta.width === 'number' ? meta.width : null,
    imageHeight: typeof meta.height === 'number' ? meta.height : null,
  };
}

export async function getDriveFileMetadata(
  env: DriveEnv,
  fileId: string,
): Promise<Record<string, unknown> | null> {
  const url = new URL(`${DRIVE_GATEWAY_FILES}/${encodeURIComponent(fileId)}`);
  url.searchParams.set('fields', DRIVE_FILE_FIELDS);
  const resp = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${env.lovableKey}`,
      'X-Connection-Api-Key': env.driveKey,
    },
  });
  if (!resp.ok) return null;
  return await resp.json().catch(() => null);
}

export async function fetchDriveFileMedia(
  env: DriveEnv,
  fileId: string,
): Promise<Response> {
  const url = new URL(`${DRIVE_GATEWAY_FILES}/${encodeURIComponent(fileId)}`);
  url.searchParams.set('alt', 'media');
  return await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${env.lovableKey}`,
      'X-Connection-Api-Key': env.driveKey,
    },
  });
}

export async function fetchDriveThumbnail(
  env: DriveEnv,
  thumbnailLink: string,
): Promise<Response> {
  // Some Drive thumbnailLink URLs work anonymously; others require a Bearer token
  // when the target file is private. Send the OAuth token as a best-effort.
  return await fetch(thumbnailLink, {
    headers: { Authorization: `Bearer ${env.lovableKey}` },
  });
}

export async function deleteDriveFile(env: DriveEnv, fileId: string): Promise<boolean> {
  const url = `${DRIVE_GATEWAY_FILES}/${encodeURIComponent(fileId)}`;
  const resp = await fetch(url, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${env.lovableKey}`,
      'X-Connection-Api-Key': env.driveKey,
    },
  });
  return resp.ok || resp.status === 404;
}


export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
