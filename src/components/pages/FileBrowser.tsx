import React, { useState, useEffect, useRef } from 'react';
import {
  Folder,
  File,
  ChevronRight,
  ChevronDown,
  Download,
  Upload,
  Trash2,
  Edit,
  Plus,
  Home,
  Server,
  FolderPlus,
  RefreshCw,
  Eye,
  X,
  ArrowLeft,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { connectionAPI } from '@/services/api';
import { fileService, FileItem } from '@/services/file-service';
import { cn } from '@/lib/utils';

export const FileBrowser: React.FC = () => {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [connections, setConnections] = useState<any[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>('');
  const [currentPath, setCurrentPath] = useState('/');
  const [files, setFiles] = useState<FileItem[]>([]);
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [mkdirOpen, setMkdirOpen] = useState(false);
  const [newDirName, setNewDirName] = useState('');

  // Load connections
  useEffect(() => {
    loadConnections();
  }, []);

  // Load directory when connection or path changes
  useEffect(() => {
    if (selectedConnectionId) {
      loadDirectory();
    }
  }, [selectedConnectionId, currentPath]);

  const loadConnections = async () => {
    try {
      const data = await connectionAPI.getAll();
      const onlineConnections = data.filter((c: any) => c.status === 'online');
      setConnections(onlineConnections);
      if (onlineConnections.length > 0 && !selectedConnectionId) {
        const preferredConnectionId = localStorage.getItem('preferredConnectionId');
        const preferredConnectionExists = preferredConnectionId
          ? onlineConnections.some((connection: any) => connection.id === preferredConnectionId)
          : false;

        setSelectedConnectionId(preferredConnectionExists ? preferredConnectionId! : onlineConnections[0].id);
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to load connections',
        variant: 'destructive',
      });
    }
  };

  const loadDirectory = async () => {
    if (!selectedConnectionId) return;

    setLoading(true);
    try {
      const data = await fileService.listDirectory(selectedConnectionId, currentPath);
      setFiles(data.files.sort((a, b) => {
        // Folders first, then files, alphabetically
        if (a.type === b.type) return a.name.localeCompare(b.name);
        return a.type === 'folder' ? -1 : 1;
      }));
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to load directory',
        variant: 'destructive',
      });
      setFiles([]);
    } finally {
      setLoading(false);
    }
  };

  const handleFileClick = async (file: FileItem) => {
    if (file.type === 'folder') {
      // Navigate into folder
      const newPath = currentPath.endsWith('/')
        ? currentPath + file.name
        : `${currentPath}/${file.name}`;
      setCurrentPath(newPath);
      setSelectedFile(null);
      setFileContent('');
    } else {
      // Select file
      setSelectedFile(file);
    }
  };

  const navigateUp = () => {
    if (currentPath === '/') return;
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    setCurrentPath(parts.length > 0 ? '/' + parts.join('/') : '/');
    setSelectedFile(null);
  };

  const handlePreview = async () => {
    if (!selectedFile || selectedFile.type !== 'file') return;

    setLoading(true);
    try {
      const filePath = currentPath.endsWith('/')
        ? currentPath + selectedFile.name
        : `${currentPath}/${selectedFile.name}`;
      
      const data = await fileService.readFile(selectedConnectionId, filePath);
      setFileContent(data.content);
      setPreviewOpen(true);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to read file',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    if (!selectedFile || selectedFile.type !== 'file') return;

    setLoading(true);
    try {
      const filePath = currentPath.endsWith('/')
        ? currentPath + selectedFile.name
        : `${currentPath}/${selectedFile.name}`;
      
      await fileService.downloadFile(selectedConnectionId, filePath);
      toast({
        title: 'Success',
        description: 'File downloaded successfully',
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to download file',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedFile) return;

    if (!confirm(`Are you sure you want to delete "${selectedFile.name}"?`)) {
      return;
    }

    setLoading(true);
    try {
      const filePath = currentPath.endsWith('/')
        ? currentPath + selectedFile.name
        : `${currentPath}/${selectedFile.name}`;
      
      await fileService.deleteFile(selectedConnectionId, filePath);
      toast({
        title: 'Success',
        description: `${selectedFile.type === 'folder' ? 'Directory' : 'File'} deleted successfully`,
      });
      setSelectedFile(null);
      loadDirectory();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to delete',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setLoading(true);
    try {
      await fileService.uploadFile(selectedConnectionId, file, currentPath);
      toast({
        title: 'Success',
        description: 'File uploaded successfully',
      });
      loadDirectory();
      setUploadOpen(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to upload file',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateDirectory = async () => {
    if (!newDirName.trim()) {
      toast({
        title: 'Error',
        description: 'Directory name is required',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      const dirPath = currentPath.endsWith('/')
        ? currentPath + newDirName
        : `${currentPath}/${newDirName}`;
      
      await fileService.createDirectory(selectedConnectionId, dirPath);
      toast({
        title: 'Success',
        description: 'Directory created successfully',
      });
      setNewDirName('');
      setMkdirOpen(false);
      loadDirectory();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to create directory',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">File Browser</h1>
          <p className="text-muted-foreground">Browse and manage files via SFTP</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={selectedConnectionId} onValueChange={setSelectedConnectionId}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder="Select connection" />
            </SelectTrigger>
            <SelectContent>
              {connections.map((conn) => (
                <SelectItem key={conn.id} value={conn.id}>
                  <div className="flex items-center gap-2">
                    <Server className="w-4 h-4" />
                    {conn.name}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 flex-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setCurrentPath('/')}
                  disabled={currentPath === '/'}
                >
                  <Home className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={navigateUp}
                  disabled={currentPath === '/'}
                >
                  <ArrowLeft className="w-4 h-4" />
                </Button>
                <span className="font-mono text-sm text-muted-foreground flex-1">
                  {currentPath}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={loadDirectory}
                  disabled={loading}
                >
                  <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setMkdirOpen(true)}
                  disabled={!selectedConnectionId}
                >
                  <FolderPlus className="w-4 h-4 mr-2" />
                  New Folder
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!selectedConnectionId}
                >
                  <Upload className="w-4 h-4 mr-2" />
                  Upload
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={handleUpload}
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading && !files.length ? (
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="w-8 h-8 animate-spin text-muted-foreground" />
              </div>
            ) : files.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Folder className="w-16 h-16 mb-4 opacity-50" />
                <p>Empty directory</p>
              </div>
            ) : (
              <div className="space-y-1">
                {files.map((file, idx) => (
                  <div
                    key={idx}
                    className={cn(
                      'flex items-center justify-between px-3 py-2 rounded-md cursor-pointer transition-colors',
                      selectedFile?.name === file.name
                        ? 'bg-primary text-primary-foreground'
                        : 'hover:bg-muted'
                    )}
                    onClick={() => handleFileClick(file)}
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      {file.type === 'folder' ? (
                        <Folder className="w-5 h-5 flex-shrink-0 text-warning" />
                      ) : (
                        <File className="w-5 h-5 flex-shrink-0 text-muted-foreground" />
                      )}
                      <span className="text-sm truncate">{file.name}</span>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      {file.type === 'file' && file.size && (
                        <span className="w-20 text-right">
                          {fileService.formatFileSize(file.size)}
                        </span>
                      )}
                      <span className="w-24 text-right font-mono text-xs">
                        {fileService.formatPermissions(file.permissions)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* File Actions */}
            {selectedFile && (
              <div className="mt-6 pt-6 border-t">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="font-medium">{selectedFile.name}</h3>
                    <p className="text-sm text-muted-foreground">
                      {selectedFile.type === 'file' && selectedFile.size
                        ? fileService.formatFileSize(selectedFile.size)
                        : 'Directory'}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {selectedFile.type === 'file' && (
                      <>
                        <Button variant="outline" size="sm" onClick={handlePreview}>
                          <Eye className="w-4 h-4 mr-2" />
                          Preview
                        </Button>
                        <Button variant="outline" size="sm" onClick={handleDownload}>
                          <Download className="w-4 h-4 mr-2" />
                          Download
                        </Button>
                      </>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={handleDelete}
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Preview Dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>Preview: {selectedFile?.name}</DialogTitle>
          </DialogHeader>
          <div className="bg-terminal-bg rounded-lg p-4 overflow-auto max-h-[60vh]">
            <pre className="text-terminal text-sm font-mono whitespace-pre-wrap">
              {fileContent}
            </pre>
          </div>
        </DialogContent>
      </Dialog>

      {/* Create Directory Dialog */}
      <Dialog open={mkdirOpen} onOpenChange={setMkdirOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Directory</DialogTitle>
            <DialogDescription>
              Create a new directory in {currentPath}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="dirname">Directory Name</Label>
              <Input
                id="dirname"
                value={newDirName}
                onChange={(e) => setNewDirName(e.target.value)}
                placeholder="my-directory"
                onKeyDown={(e) => e.key === 'Enter' && handleCreateDirectory()}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMkdirOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateDirectory} disabled={loading || !newDirName.trim()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
