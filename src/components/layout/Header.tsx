import React from 'react';
import { Bell, Moon, Sun, User, Search, Wifi, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface HeaderProps {
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
  onlineCount: number;
  totalCount: number;
  currentTheme: 'dark' | 'darker' | 'black' | 'light' | 'soft';
  onThemeChange: (theme: 'dark' | 'darker' | 'black' | 'light' | 'soft') => void;
  userDisplay: string;
  onOpenProfile: () => void;
  onOpenPreferences: () => void;
  onSignOut: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  isDarkMode,
  onToggleDarkMode,
  onlineCount,
  totalCount,
  currentTheme,
  onThemeChange,
  userDisplay,
  onOpenProfile,
  onOpenPreferences,
  onSignOut,
}) => {
  return (
    <header className="h-16 bg-card border-b border-border flex items-center justify-between px-6">
      {/* Search */}
      <div className="flex-1 max-w-md">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search connections, scripts, or run commands..."
            className="pl-10 bg-muted/50 border-muted focus:bg-card"
          />
        </div>
      </div>

      {/* Status & Actions */}
      <div className="flex items-center gap-4">
        {/* Connection Status */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted">
          <div className="flex items-center gap-1.5">
            <Wifi className="w-4 h-4 text-success" />
            <span className="text-sm font-medium text-success">{onlineCount}</span>
          </div>
          <span className="text-muted-foreground">/</span>
          <div className="flex items-center gap-1.5">
            <WifiOff className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">{totalCount - onlineCount}</span>
          </div>
        </div>

        {/* Theme Toggle */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
              {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Theme</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onThemeChange('dark')} className={currentTheme === 'dark' ? 'bg-muted' : ''}>
              <span>{currentTheme === 'dark' && '✓'} Dark</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onThemeChange('darker')} className={currentTheme === 'darker' ? 'bg-muted' : ''}>
              <span>{currentTheme === 'darker' && '✓'} Darker</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onThemeChange('black')} className={currentTheme === 'black' ? 'bg-muted' : ''}>
              <span>{currentTheme === 'black' && '✓'} Black</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onThemeChange('light')} className={currentTheme === 'light' ? 'bg-muted' : ''}>
              <span>{currentTheme === 'light' && '✓'} Light</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onThemeChange('soft')} className={currentTheme === 'soft' ? 'bg-muted' : ''}>
              <span>{currentTheme === 'soft' && '✓'} Soft</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Notifications */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="relative text-muted-foreground hover:text-foreground">
              <Bell className="w-5 h-5" />
              <Badge className="absolute -top-1 -right-1 h-5 w-5 p-0 flex items-center justify-center text-[10px] bg-destructive">
                3
              </Badge>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel>Notifications</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="flex flex-col items-start gap-1 py-3">
              <span className="font-medium text-destructive">Build Server offline</span>
              <span className="text-xs text-muted-foreground">Connection lost 2 hours ago</span>
            </DropdownMenuItem>
            <DropdownMenuItem className="flex flex-col items-start gap-1 py-3">
              <span className="font-medium text-warning">Security audit completed</span>
              <span className="text-xs text-muted-foreground">3 issues found on Production Web Server</span>
            </DropdownMenuItem>
            <DropdownMenuItem className="flex flex-col items-start gap-1 py-3">
              <span className="font-medium text-success">Backup completed</span>
              <span className="text-xs text-muted-foreground">Database Master backup finished successfully</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* User Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="rounded-full">
              <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                <User className="w-4 h-4 text-primary-foreground" />
              </div>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>{userDisplay}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onOpenProfile}>Profile</DropdownMenuItem>
            <DropdownMenuItem onClick={onOpenPreferences}>Preferences</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onClick={onSignOut}>Sign out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
};
