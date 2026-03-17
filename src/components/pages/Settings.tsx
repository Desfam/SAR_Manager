import React, { useState, useEffect } from 'react';
import {
  Settings as SettingsIcon,
  User,
  Shield,
  Palette,
  Bell,
  Key,
  Globe,
  Monitor,
  Moon,
  Sun,
  Check,
  Copy,
  Trash2,
  Plus,
  Download,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { sshKeysAPI } from '@/services/api';
import { cn } from '@/lib/utils';

const themes = [
  { id: 'dark', name: 'Dark', icon: Moon, bg: 'bg-slate-900' },
  { id: 'darker', name: 'Darker', icon: Moon, bg: 'bg-slate-950' },
  { id: 'black', name: 'Black', icon: Moon, bg: 'bg-black' },
  { id: 'soft', name: 'Soft', icon: Moon, bg: 'bg-slate-800' },
  { id: 'light', name: 'Light', icon: Sun, bg: 'bg-white border' },
  { id: 'midnight', name: 'Midnight Blue', icon: Moon, bg: 'bg-blue-950' },
  { id: 'forest', name: 'Forest', icon: Moon, bg: 'bg-green-950' },
];

interface SettingsProps {
  currentTheme?: 'dark' | 'darker' | 'black' | 'light' | 'soft';
  onThemeChange?: (theme: 'dark' | 'darker' | 'black' | 'light' | 'soft') => void;
}

export const Settings: React.FC<SettingsProps> = ({ currentTheme: propTheme, onThemeChange: propOnThemeChange }) => {
  const [selectedTheme, setSelectedTheme] = useState(propTheme || 'dark');
  const [sshKeys, setSshKeys] = useState<any[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [keyForm, setKeyForm] = useState({
    name: '',
    type: 'ed25519' as 'rsa' | 'ed25519' | 'ecdsa',
    comment: '',
    passphrase: '',
  });
  const { toast } = useToast();

  useEffect(() => {
    if (propTheme) {
      setSelectedTheme(propTheme);
    }
  }, [propTheme]);

  useEffect(() => {
    loadSSHKeys();
  }, []);

  const loadSSHKeys = async () => {
    setLoadingKeys(true);
    try {
      const keys = await sshKeysAPI.getAll();
      setSshKeys(keys);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to load SSH keys',
        variant: 'destructive',
      });
    } finally {
      setLoadingKeys(false);
    }
  };

  const handleGenerateKey = async () => {
    try {
      const result = await sshKeysAPI.generate(keyForm);
      toast({
        title: 'Success',
        description: result.message,
      });
      setDialogOpen(false);
      setKeyForm({ name: '', type: 'ed25519', comment: '', passphrase: '' });
      loadSSHKeys();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to generate SSH key',
        variant: 'destructive',
      });
    }
  };

  const handleDeleteKey = async (name: string) => {
    if (!confirm(`Are you sure you want to delete the SSH key "${name}"?`)) return;
    
    try {
      await sshKeysAPI.delete(name);
      toast({
        title: 'Success',
        description: 'SSH key deleted successfully',
      });
      loadSSHKeys();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to delete SSH key',
        variant: 'destructive',
      });
    }
  };

  const handleCopyPublicKey = (publicKey: string) => {
    navigator.clipboard.writeText(publicKey);
    toast({
      title: 'Copied',
      description: 'Public key copied to clipboard',
    });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground">Configure your SSH & RDP Manager preferences</p>
      </div>

      <Tabs defaultValue="general" className="space-y-6">
        <TabsList>
          <TabsTrigger value="general">
            <SettingsIcon className="w-4 h-4 mr-2" />
            General
          </TabsTrigger>
          <TabsTrigger value="appearance">
            <Palette className="w-4 h-4 mr-2" />
            Appearance
          </TabsTrigger>
          <TabsTrigger value="security">
            <Shield className="w-4 h-4 mr-2" />
            Security
          </TabsTrigger>
          <TabsTrigger value="notifications">
            <Bell className="w-4 h-4 mr-2" />
            Notifications
          </TabsTrigger>
        </TabsList>

        {/* General Settings */}
        <TabsContent value="general" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="w-5 h-5" />
                Profile
              </CardTitle>
              <CardDescription>Manage your account settings</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Full Name</Label>
                  <Input defaultValue="System Administrator" />
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input type="email" defaultValue="admin@company.com" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Organization</Label>
                <Input defaultValue="Acme Corporation" />
              </div>
              <Button>Save Changes</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Globe className="w-5 h-5" />
                Connection Defaults
              </CardTitle>
              <CardDescription>Default settings for new connections</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Default SSH Port</Label>
                  <Input type="number" defaultValue="22" />
                </div>
                <div className="space-y-2">
                  <Label>Default RDP Port</Label>
                  <Input type="number" defaultValue="3389" />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <p className="font-medium">Auto-reconnect</p>
                  <p className="text-sm text-muted-foreground">
                    Automatically reconnect on connection loss
                  </p>
                </div>
                <Switch defaultChecked />
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <p className="font-medium">Remember Last Session</p>
                  <p className="text-sm text-muted-foreground">
                    Restore previous connections on startup
                  </p>
                </div>
                <Switch />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Appearance Settings */}
        <TabsContent value="appearance" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Palette className="w-5 h-5" />
                Theme
              </CardTitle>
              <CardDescription>Choose your preferred color theme</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
                {themes.map((theme) => {
                  const isActive = selectedTheme === theme.id;
                  const isImplemented = theme.id === 'dark' || theme.id === 'darker' || theme.id === 'black' || theme.id === 'light' || theme.id === 'soft';
                  
                  return (
                    <button
                      key={theme.id}
                      onClick={() => {
                        if (isImplemented) {
                          setSelectedTheme(theme.id);
                          if (propOnThemeChange && (theme.id === 'dark' || theme.id === 'darker' || theme.id === 'black' || theme.id === 'light' || theme.id === 'soft')) {
                            propOnThemeChange(theme.id as 'dark' | 'darker' | 'black' | 'light' | 'soft');
                          }
                        }
                      }}
                      disabled={!isImplemented}
                      className={cn(
                        'relative p-4 rounded-lg transition-all',
                        theme.bg,
                        isActive && isImplemented
                          ? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                          : 'hover:opacity-80',
                        !isImplemented && 'opacity-40 cursor-not-allowed'
                      )}
                    >
                      <div className="flex flex-col items-center gap-2">
                        <theme.icon
                          className={cn(
                            'w-5 h-5',
                            theme.id === 'light' || theme.id === 'sunset'
                              ? 'text-foreground'
                              : 'text-white'
                          )}
                        />
                        <span
                          className={cn(
                            'text-xs font-medium',
                            theme.id === 'light'
                              ? 'text-foreground'
                              : 'text-white'
                          )}
                        >
                          {theme.name}
                        </span>
                      </div>
                      {isActive && isImplemented && (
                        <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-primary flex items-center justify-center">
                          <Check className="w-3 h-3 text-primary-foreground" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Monitor className="w-5 h-5" />
                Terminal
              </CardTitle>
              <CardDescription>Customize terminal appearance</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Font Size</Label>
                  <Input type="number" defaultValue="14" />
                </div>
                <div className="space-y-2">
                  <Label>Font Family</Label>
                  <Input defaultValue="JetBrains Mono" />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <p className="font-medium">Cursor Blink</p>
                  <p className="text-sm text-muted-foreground">Animate terminal cursor</p>
                </div>
                <Switch defaultChecked />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Security Settings */}
        <TabsContent value="security" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Key className="w-5 h-5" />
                SSH Keys
              </CardTitle>
              <CardDescription>Manage SSH keys for authenticating to remote servers</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {loadingKeys ? (
                <div className="text-center py-4 text-muted-foreground">Loading SSH keys...</div>
              ) : sshKeys.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Key className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>No SSH keys found</p>
                  <p className="text-sm">Generate a new SSH key to get started</p>
                </div>
              ) : (
                sshKeys.map((key) => (
                  <div key={key.name} className="p-4 border border-border rounded-lg space-y-2">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <p className="font-medium">{key.name}</p>
                        <p className="text-xs text-muted-foreground">
                          Created: {new Date(key.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleCopyPublicKey(key.publicKey)}
                        >
                          <Copy className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDeleteKey(key.name)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                    <div className="bg-muted p-2 rounded text-xs font-mono break-all">
                      {key.publicKey}
                    </div>
                  </div>
                ))
              )}

              <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" className="w-full">
                    <Plus className="w-4 h-4 mr-2" />
                    Generate New SSH Key
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Generate New SSH Key</DialogTitle>
                    <DialogDescription>
                      Create a new SSH key pair for authenticating to your servers
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Key Name</Label>
                      <Input
                        placeholder="my-ssh-key"
                        value={keyForm.name}
                        onChange={(e) => setKeyForm({ ...keyForm, name: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Key Type</Label>
                      <Select
                        value={keyForm.type}
                        onValueChange={(value: any) => setKeyForm({ ...keyForm, type: value })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ed25519">ED25519 (Recommended)</SelectItem>
                          <SelectItem value="rsa">RSA (4096 bit)</SelectItem>
                          <SelectItem value="ecdsa">ECDSA</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Comment (Optional)</Label>
                      <Input
                        placeholder="user@hostname"
                        value={keyForm.comment}
                        onChange={(e) => setKeyForm({ ...keyForm, comment: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Passphrase (Optional)</Label>
                      <Input
                        type="password"
                        placeholder="Leave empty for no passphrase"
                        value={keyForm.passphrase}
                        onChange={(e) => setKeyForm({ ...keyForm, passphrase: e.target.value })}
                      />
                    </div>
                    <div className="bg-blue-500/10 border border-blue-500/20 rounded p-3 text-sm">
                      <p className="text-blue-400 mb-1 font-medium">💡 Tip:</p>
                      <p className="text-muted-foreground">
                        After generating, copy the public key and add it to the <code>~/.ssh/authorized_keys</code> file on your target servers.
                      </p>
                    </div>
                    <Button onClick={handleGenerateKey} className="w-full">
                      Generate Key
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="w-5 h-5" />
                Security Settings
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <p className="font-medium">Two-Factor Authentication</p>
                  <p className="text-sm text-muted-foreground">
                    Require 2FA for sensitive operations
                  </p>
                </div>
                <Switch defaultChecked />
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <p className="font-medium">Session Timeout</p>
                  <p className="text-sm text-muted-foreground">
                    Auto-lock after 15 minutes of inactivity
                  </p>
                </div>
                <Switch defaultChecked />
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <p className="font-medium">Audit Logging</p>
                  <p className="text-sm text-muted-foreground">Log all connection activities</p>
                </div>
                <Switch defaultChecked />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Notifications Settings */}
        <TabsContent value="notifications" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="w-5 h-5" />
                Notifications
              </CardTitle>
              <CardDescription>Configure alert preferences</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <p className="font-medium">Connection Lost</p>
                  <p className="text-sm text-muted-foreground">
                    Alert when a monitored server goes offline
                  </p>
                </div>
                <Switch defaultChecked />
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <p className="font-medium">Security Alerts</p>
                  <p className="text-sm text-muted-foreground">
                    Notify on critical security findings
                  </p>
                </div>
                <Switch defaultChecked />
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <p className="font-medium">Script Completion</p>
                  <p className="text-sm text-muted-foreground">
                    Notify when scheduled scripts complete
                  </p>
                </div>
                <Switch />
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <p className="font-medium">Resource Warnings</p>
                  <p className="text-sm text-muted-foreground">
                    Alert on high CPU/memory usage
                  </p>
                </div>
                <Switch defaultChecked />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};
