// SFTP file manager API (see backend/src/routes/files.ts)
import { API_CONFIG } from './api-config';

export interface RemoteFile {
  name: string;
  type: 'file' | 'folder';
  size: number;
  modified: string;
  permissions: number;
  uid?: number;
  gid?: number;
}

export type Preview =
  | { kind: 'text'; size: number; content?: string; tooLarge?: boolean; limit?: number }
  | { kind: 'image'; size: number; mime?: string; base64?: string; tooLarge?: boolean; limit?: number }
  | { kind: 'binary'; size: number }
  | { kind: 'directory'; size: number };

async function json<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || data?.details || `HTTP ${response.status}`);
  return data as T;
}

const base = `${API_CONFIG.baseURL}/files`;
const q = (path: string) => `path=${encodeURIComponent(path)}`;

export const filesApi = {
  list: (id: string, path: string) => fetch(`${base}/list/${id}?${q(path)}`).then((r) => json<{ files: RemoteFile[]; path: string }>(r)),
  preview: (id: string, path: string) => fetch(`${base}/preview/${id}?${q(path)}`).then((r) => json<Preview>(r)),
  write: (id: string, path: string, content: string) =>
    fetch(`${base}/write/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, content }) }).then((r) => json(r)),
  move: (id: string, from: string, to: string) =>
    fetch(`${base}/rename/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to }) }).then((r) => json(r)),
  chmod: (id: string, path: string, mode: string) =>
    fetch(`${base}/chmod/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, mode }) }).then((r) => json(r)),
  mkdir: (id: string, path: string) =>
    fetch(`${base}/mkdir/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) }).then((r) => json(r)),
  remove: (id: string, path: string) => fetch(`${base}/delete-recursive/${id}?${q(path)}`, { method: 'DELETE' }).then((r) => json<{ removed: number }>(r)),

  /** Upload with progress (fetch has no upload progress, XHR does). Existing files are overwritten. */
  upload(id: string, directory: string, file: File, onProgress: (fraction: number) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const form = new FormData();
      form.append('file', file);
      form.append('path', directory);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${base}/upload/${id}`);
      xhr.upload.onprogress = (event) => event.lengthComputable && onProgress(event.loaded / event.total);
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) return resolve();
        try {
          reject(new Error(JSON.parse(xhr.responseText).error || `HTTP ${xhr.status}`));
        } catch {
          reject(new Error(`HTTP ${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new Error('Netzwerkfehler beim Hochladen'));
      xhr.send(form);
    });
  },

  async download(id: string, path: string) {
    const response = await fetch(`${base}/download/${id}?${q(path)}`);
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.error || `HTTP ${response.status}`);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = path.split('/').pop() || 'download';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  },
};

export function joinPath(directory: string, name: string) {
  return `${directory.replace(/\/$/, '')}/${name}`.replace(/^\/\//, '/');
}

export function parentOf(path: string) {
  if (path === '/') return '/';
  const parent = path.replace(/\/$/, '').split('/').slice(0, -1).join('/');
  return parent || '/';
}

export function permissionString(mode: number, folder: boolean) {
  const bits = ['r', 'w', 'x'];
  let out = folder ? 'd' : '-';
  for (let shift = 6; shift >= 0; shift -= 3) {
    for (let index = 0; index < 3; index += 1) out += (mode >> (shift + 2 - index)) & 1 ? bits[index] : '-';
  }
  return out;
}

export const octalOf = (mode: number) => (mode & 0o777).toString(8).padStart(3, '0');
