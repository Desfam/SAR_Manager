import { API_CONFIG } from './api-config';

export interface FileItem {
  name: string;
  type: 'folder' | 'file';
  size?: number;
  modified: string;
  permissions: number;
  uid: number;
  gid: number;
}

export interface DirectoryListing {
  files: FileItem[];
  path: string;
}

export interface FileContent {
  content: string;
  path: string;
}

class FileService {
  /**
   * List directory contents
   */
  async listDirectory(connectionId: string, path: string = '/'): Promise<DirectoryListing> {
    const response = await fetch(
      `${API_CONFIG.baseURL}/files/list/${connectionId}?path=${encodeURIComponent(path)}`
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to list directory');
    }

    return response.json();
  }

  /**
   * Read file contents
   */
  async readFile(connectionId: string, path: string): Promise<FileContent> {
    const response = await fetch(
      `${API_CONFIG.baseURL}/files/read/${connectionId}?path=${encodeURIComponent(path)}`
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to read file');
    }

    return response.json();
  }

  /**
   * Upload file to remote server
   */
  async uploadFile(connectionId: string, file: File, remotePath: string): Promise<void> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('path', remotePath);

    const response = await fetch(`${API_CONFIG.baseURL}/files/upload/${connectionId}`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to upload file');
    }
  }

  /**
   * Download file from remote server
   */
  async downloadFile(connectionId: string, remotePath: string): Promise<void> {
    const response = await fetch(
      `${API_CONFIG.baseURL}/files/download/${connectionId}?path=${encodeURIComponent(remotePath)}`
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to download file');
    }

    // Create blob and trigger download
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = remotePath.split('/').pop() || 'download';
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }

  /**
   * Delete file or directory
   */
  async deleteFile(connectionId: string, remotePath: string): Promise<void> {
    const response = await fetch(
      `${API_CONFIG.baseURL}/files/delete/${connectionId}?path=${encodeURIComponent(remotePath)}`,
      {
        method: 'DELETE',
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to delete file');
    }
  }

  /**
   * Create directory
   */
  async createDirectory(connectionId: string, remotePath: string): Promise<void> {
    const response = await fetch(`${API_CONFIG.baseURL}/files/mkdir/${connectionId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path: remotePath }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to create directory');
    }
  }

  /**
   * Format file size for display
   */
  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * Format Unix permissions
   */
  formatPermissions(mode: number): string {
    const perms = ['---', '--x', '-w-', '-wx', 'r--', 'r-x', 'rw-', 'rwx'];
    const type = (mode & 0o170000) === 0o040000 ? 'd' : '-';
    
    return (
      type +
      perms[(mode >> 6) & 0x7] +
      perms[(mode >> 3) & 0x7] +
      perms[mode & 0x7]
    );
  }
}

export const fileService = new FileService();
