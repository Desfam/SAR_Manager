import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import {
  Server,
  Star,
  Folder,
  Shield,
  Package,
  FileSearch,
  Terminal,
  Settings,
  Activity,
  Search,
} from 'lucide-react';
import { connectionAPI } from '@/services/api';
import type { SSHConnection, RDPConnection } from '@/types/connection';

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const navigate = useNavigate();
  const [connections, setConnections] = useState<(SSHConnection | RDPConnection)[]>([]);
  const [search, setSearch] = useState('');

  // Load connections
  useEffect(() => {
    if (open) {
      loadConnections();
    }
  }, [open]);

  const loadConnections = async () => {
    try {
      const data = await connectionAPI.getAll();
      setConnections(data);
    } catch (error) {
      console.error('Failed to load connections:', error);
    }
  };

  // Filter connections based on search
  const filteredConnections = connections.filter((conn) =>
    conn.name.toLowerCase().includes(search.toLowerCase()) ||
    conn.host.toLowerCase().includes(search.toLowerCase())
  );

  // Favorite connections
  const favoriteConnections = filteredConnections.filter((conn: any) => conn.is_favorite);
  const otherConnections = filteredConnections.filter((conn: any) => !conn.is_favorite);

  const handleSelectConnection = (id: string) => {
    navigate(`/connections/${id}`);
    onOpenChange(false);
  };

  const handleNavigate = (path: string) => {
    navigate(path);
    onOpenChange(false);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput 
        placeholder="Search connections, navigate, or run commands..." 
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        {/* Quick Navigation */}
        <CommandGroup heading="Quick Navigation">
          <CommandItem onSelect={() => handleNavigate('/')}>
            <Activity className="mr-2 h-4 w-4" />
            <span>Dashboard</span>
          </CommandItem>
          <CommandItem onSelect={() => handleNavigate('/connections')}>
            <Server className="mr-2 h-4 w-4" />
            <span>Connections</span>
          </CommandItem>
          <CommandItem onSelect={() => handleNavigate('/docker')}>
            <Package className="mr-2 h-4 w-4" />
            <span>Docker</span>
          </CommandItem>
          <CommandItem onSelect={() => handleNavigate('/security')}>
            <Shield className="mr-2 h-4 w-4" />
            <span>Security</span>
          </CommandItem>
          <CommandItem onSelect={() => handleNavigate('/diagnostics')}>
            <FileSearch className="mr-2 h-4 w-4" />
            <span>Diagnostics</span>
          </CommandItem>
          <CommandItem onSelect={() => handleNavigate('/scripts')}>
            <Terminal className="mr-2 h-4 w-4" />
            <span>Scripts</span>
          </CommandItem>
        </CommandGroup>

        {/* Favorite Connections */}
        {favoriteConnections.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Favorite Connections">
              {favoriteConnections.map((conn) => (
                <CommandItem
                  key={conn.id}
                  value={`${conn.name} ${conn.host}`}
                  onSelect={() => handleSelectConnection(conn.id)}
                >
                  <Star className="mr-2 h-4 w-4 fill-yellow-400 text-yellow-400" />
                  <div className="flex flex-col">
                    <span>{conn.name}</span>
                    <span className="text-xs text-muted-foreground">{conn.host}</span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {/* All Connections */}
        {otherConnections.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="All Connections">
              {otherConnections.slice(0, 10).map((conn) => (
                <CommandItem
                  key={conn.id}
                  value={`${conn.name} ${conn.host}`}
                  onSelect={() => handleSelectConnection(conn.id)}
                >
                  <Server className="mr-2 h-4 w-4" />
                  <div className="flex flex-col">
                    <span>{conn.name}</span>
                    <span className="text-xs text-muted-foreground">{conn.host}</span>
                  </div>
                </CommandItem>
              ))}
              {otherConnections.length > 10 && (
                <CommandItem disabled>
                  <span className="text-xs text-muted-foreground">
                    +{otherConnections.length - 10} more... (refine search)
                  </span>
                </CommandItem>
              )}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}

// Hook for keyboard shortcut
export function useCommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };

    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  return { open, setOpen };
}
