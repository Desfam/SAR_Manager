import React, { useState, useRef, useEffect } from 'react';
import {
  Server,
  Laptop,
  Monitor,
  Network,
  Phone,
  Plus,
  Trash2,
  Save,
  Upload,
  Download,
  ZoomIn,
  ZoomOut,
  Move,
  Square,
  MousePointer,
  Grid3x3,
  Building,
  Undo,
  Redo,
  Link2,
  Minus,
  MoreHorizontal,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface Point {
  x: number;
  y: number;
}

interface Wall {
  id: string;
  start: Point;
  end: Point;
}

interface Connection {
  id: string;
  from: string; // equipment id
  to: string; // equipment id
  style: 'solid' | 'dotted' | 'dashed';
  label?: string;
}

interface Equipment {
  id: string;
  type: 'server' | 'laptop' | 'desktop' | 'switch' | 'phone' | 'router';
  position: Point;
  label: string;
}

interface Floor {
  id: string;
  name: string;
  building: string;
  walls: Wall[];
  equipment: Equipment[];
  connections: Connection[];
}

const EQUIPMENT_TYPES = [
  { type: 'server', icon: Server, label: 'Server', color: '#3b82f6', emoji: '🖥️' },
  { type: 'laptop', icon: Laptop, label: 'Laptop', color: '#10b981', emoji: '💻' },
  { type: 'desktop', icon: Monitor, label: 'Desktop', color: '#6366f1', emoji: '🖥️' },
  { type: 'switch', icon: Network, label: 'Switch', color: '#f59e0b', emoji: '🔌' },
  { type: 'phone', icon: Phone, label: 'VoIP Phone', color: '#8b5cf6', emoji: '☎️' },
  { type: 'router', icon: Grid3x3, label: 'Router', color: '#ec4899', emoji: '📡' },
] as const;

const GRID_SIZE = 10;

export const Topology: React.FC = () => {
  const { toast } = useToast();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [floors, setFloors] = useState<Floor[]>([
    {
      id: '1',
      name: 'Ground Floor',
      building: 'Main Building',
      walls: [],
      equipment: [],
      connections: [],
    },
  ]);
  const [currentFloorId, setCurrentFloorId] = useState('1');
  const [tool, setTool] = useState<'select' | 'wall' | 'equipment' | 'pan' | 'connection'>('select');
  const [selectedEquipmentType, setSelectedEquipmentType] = useState<string>('server');
  const [selectedConnectionStyle, setSelectedConnectionStyle] = useState<'solid' | 'dotted' | 'dashed'>('solid');
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<Point | null>(null);
  const [connectionStart, setConnectionStart] = useState<string | null>(null); // equipment id
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [showGrid, setShowGrid] = useState(true);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<Point | null>(null);
  const [isAddFloorOpen, setIsAddFloorOpen] = useState(false);
  const [newFloor, setNewFloor] = useState({ name: '', building: 'Main Building' });

  const currentFloor = floors.find((f) => f.id === currentFloorId) || floors[0];

  useEffect(() => {
    drawCanvas();
  }, [currentFloor, offset, zoom, showGrid, isDrawing, drawStart, connectionStart, selectedConnectionStyle]);

  const drawCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Fill background with dark color
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    ctx.save();

    // Apply transformations
    ctx.translate(offset.x, offset.y);
    ctx.scale(zoom, zoom);

    // Draw grid (dotted)
    if (showGrid) {
      ctx.fillStyle = '#3f3f46';
      const dotRadius = 1.5 / zoom;
      for (let x = 0; x < canvas.width / zoom; x += GRID_SIZE) {
        for (let y = 0; y < canvas.height / zoom; y += GRID_SIZE) {
          ctx.beginPath();
          ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Draw walls
    ctx.strokeStyle = '#9ca3af';
    ctx.lineWidth = 4 / zoom;
    ctx.lineCap = 'round';
    currentFloor.walls.forEach((wall) => {
      ctx.beginPath();
      ctx.moveTo(wall.start.x, wall.start.y);
      ctx.lineTo(wall.end.x, wall.end.y);
      ctx.stroke();
    });

    // Draw temporary wall while drawing
    if (isDrawing && drawStart && tool === 'wall') {
      ctx.strokeStyle = '#60a5fa';
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(drawStart.x, drawStart.y);
      const mousePos = getMousePos(canvas);
      ctx.lineTo(mousePos.x, mousePos.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw connections
    currentFloor.connections.forEach((conn) => {
      const fromEq = currentFloor.equipment.find(e => e.id === conn.from);
      const toEq = currentFloor.equipment.find(e => e.id === conn.to);
      if (!fromEq || !toEq) return;

      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 2 / zoom;
      ctx.lineCap = 'round';
      
      // Apply line style
      if (conn.style === 'dotted') {
        ctx.setLineDash([2, 4]);
      } else if (conn.style === 'dashed') {
        ctx.setLineDash([8, 4]);
      } else {
        ctx.setLineDash([]);
      }

      ctx.beginPath();
      ctx.moveTo(fromEq.position.x, fromEq.position.y);
      ctx.lineTo(toEq.position.x, toEq.position.y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw label if exists
      if (conn.label) {
        const midX = (fromEq.position.x + toEq.position.x) / 2;
        const midY = (fromEq.position.y + toEq.position.y) / 2;
        ctx.font = `${12 / zoom}px Inter`;
        ctx.fillStyle = '#94a3b8';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(conn.label, midX, midY - 4);
      }
    });

    // Draw temporary connection while drawing
    if (tool === 'connection' && connectionStart) {
      const fromEq = currentFloor.equipment.find(e => e.id === connectionStart);
      if (fromEq) {
        const mousePos = getMousePos(canvas);
        ctx.strokeStyle = '#60a5fa';
        ctx.lineWidth = 2 / zoom;
        
        // Apply selected line style to preview
        if (selectedConnectionStyle === 'dotted') {
          ctx.setLineDash([2, 4]);
        } else if (selectedConnectionStyle === 'dashed') {
          ctx.setLineDash([8, 4]);
        }
        
        ctx.beginPath();
        ctx.moveTo(fromEq.position.x, fromEq.position.y);
        ctx.lineTo(mousePos.x, mousePos.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Draw equipment
    currentFloor.equipment.forEach((eq) => {
      const eqType = EQUIPMENT_TYPES.find((t) => t.type === eq.type);
      if (!eqType) return;

      const isSelected = selectedItem === eq.id;
      const size = 40;

      // Draw equipment using emoji symbols
      drawEquipmentIcon(ctx, eqType.emoji, eq.position.x, eq.position.y, size, eqType.color, isSelected);

      // Draw label
      ctx.fillStyle = '#e5e7eb';
      ctx.font = `bold ${11 / zoom}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(eq.label || eqType.label, eq.position.x, eq.position.y + size / 2 + 16);
    });

    ctx.restore();
  };

  const drawEquipmentIcon = (ctx: CanvasRenderingContext2D, emoji: string, x: number, y: number, size: number, color: string, isSelected: boolean) => {
    ctx.save();

    // Draw background circle/box
    const bgSize = size;
    ctx.fillStyle = isSelected ? `${color}33` : `${color}22`;
    ctx.strokeStyle = isSelected ? color : `${color}88`;
    ctx.lineWidth = isSelected ? 3 / zoom : 2 / zoom;
    
    // Draw rounded rectangle background
    const radius = 8;
    const left = x - bgSize / 2;
    const top = y - bgSize / 2;
    
    ctx.beginPath();
    ctx.moveTo(left + radius, top);
    ctx.lineTo(left + bgSize - radius, top);
    ctx.quadraticCurveTo(left + bgSize, top, left + bgSize, top + radius);
    ctx.lineTo(left + bgSize, top + bgSize - radius);
    ctx.quadraticCurveTo(left + bgSize, top + bgSize, left + bgSize - radius, top + bgSize);
    ctx.lineTo(left + radius, top + bgSize);
    ctx.quadraticCurveTo(left, top + bgSize, left, top + bgSize - radius);
    ctx.lineTo(left, top + radius);
    ctx.quadraticCurveTo(left, top, left + radius, top);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Draw emoji symbol
    ctx.font = `${size * 0.6}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText(emoji, x, y);

    ctx.restore();
  };

  const getMousePos = (canvas: HTMLCanvasElement, event?: React.MouseEvent): Point => {
    const rect = canvas.getBoundingClientRect();
    const e = event || (window.event as any);
    return {
      x: ((e?.clientX || 0) - rect.left - offset.x) / zoom,
      y: ((e?.clientY || 0) - rect.top - offset.y) / zoom,
    };
  };

  const snapToGrid = (point: Point): Point => {
    return {
      x: Math.round(point.x / GRID_SIZE) * GRID_SIZE,
      y: Math.round(point.y / GRID_SIZE) * GRID_SIZE,
    };
  };

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Middle mouse button for panning
    if (e.button === 1) {
      e.preventDefault();
      setIsPanning(true);
      setPanStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
      return;
    }

    const pos = snapToGrid(getMousePos(canvas, e));

    if (tool === 'pan') {
      setIsPanning(true);
      setPanStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
      return;
    }

    if (tool === 'wall') {
      if (!isDrawing) {
        setIsDrawing(true);
        setDrawStart(pos);
      } else {
        // Finish drawing wall
        if (drawStart) {
          const newWall: Wall = {
            id: Date.now().toString(),
            start: drawStart,
            end: pos,
          };
          setFloors((prev) =>
            prev.map((f) =>
              f.id === currentFloorId ? { ...f, walls: [...f.walls, newWall] } : f
            )
          );
        }
        setIsDrawing(false);
        setDrawStart(null);
      }
    } else if (tool === 'equipment') {
      const newEquipment: Equipment = {
        id: Date.now().toString(),
        type: selectedEquipmentType as any,
        position: pos,
        label: '',
      };
      setFloors((prev) =>
        prev.map((f) =>
          f.id === currentFloorId ? { ...f, equipment: [...f.equipment, newEquipment] } : f
        )
      );
    } else if (tool === 'select') {
      // Check if clicking on equipment
      const clicked = currentFloor.equipment.find((eq) => {
        const dist = Math.sqrt(
          Math.pow(eq.position.x - pos.x, 2) + Math.pow(eq.position.y - pos.y, 2)
        );
        return dist < 20;
      });
      setSelectedItem(clicked ? clicked.id : null);
    } else if (tool === 'connection') {
      // Check if clicking on equipment
      const clicked = currentFloor.equipment.find((eq) => {
        const dist = Math.sqrt(
          Math.pow(eq.position.x - pos.x, 2) + Math.pow(eq.position.y - pos.y, 2)
        );
        return dist < 20;
      });
      
      if (clicked) {
        if (!connectionStart) {
          // Start connection
          setConnectionStart(clicked.id);
        } else if (connectionStart !== clicked.id) {
          // Complete connection
          const newConnection: Connection = {
            id: Date.now().toString(),
            from: connectionStart,
            to: clicked.id,
            style: selectedConnectionStyle,
          };
          setFloors((prev) =>
            prev.map((f) =>
              f.id === currentFloorId
                ? { ...f, connections: [...f.connections, newConnection] }
                : f
            )
          );
          setConnectionStart(null);
        }
      } else {
        // Clicked empty space - cancel connection
        setConnectionStart(null);
      }
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isPanning && panStart) {
      e.preventDefault();
      setOffset({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y,
      });
      return;
    }

    if (isDrawing || connectionStart) {
      drawCanvas();
    }
  };

  const handleCanvasMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button === 1 || isPanning) {
      setIsPanning(false);
      setPanStart(null);
    }
  };

  const handleDeleteSelected = () => {
    if (!selectedItem) return;

    setFloors((prev) =>
      prev.map((f) =>
        f.id === currentFloorId
          ? {
              ...f,
              equipment: f.equipment.filter((eq) => eq.id !== selectedItem),
              walls: f.walls.filter((w) => w.id !== selectedItem),
              connections: f.connections.filter(
                (conn) => conn.id !== selectedItem && conn.from !== selectedItem && conn.to !== selectedItem
              ),
            }
          : f
      )
    );
    setSelectedItem(null);
  };

  const handleAddFloor = () => {
    if (!newFloor.name) {
      toast({ title: 'Error', description: 'Floor name is required', variant: 'destructive' });
      return;
    }

    const floor: Floor = {
      id: Date.now().toString(),
      name: newFloor.name,
      building: newFloor.building,
      walls: [],
      equipment: [],
      connections: [],
    };

    setFloors((prev) => [...prev, floor]);
    setCurrentFloorId(floor.id);
    setIsAddFloorOpen(false);
    setNewFloor({ name: '', building: 'Main Building' });
    toast({ title: 'Success', description: 'Floor added successfully' });
  };

  const handleSaveTopology = () => {
    const data = JSON.stringify(floors, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'topology.json';
    a.click();
    toast({ title: 'Success', description: 'Topology saved successfully' });
  };

  const handleLoadTopology = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);
        setFloors(data);
        setCurrentFloorId(data[0]?.id || '1');
        toast({ title: 'Success', description: 'Topology loaded successfully' });
      } catch (error) {
        toast({ title: 'Error', description: 'Failed to load topology', variant: 'destructive' });
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-6 animate-fade-in h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Network Topology</h1>
          <p className="text-muted-foreground">Design your network infrastructure layout</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleSaveTopology}>
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
          <Button variant="outline" asChild>
            <label className="cursor-pointer">
              <Upload className="w-4 h-4 mr-2" />
              Import
              <input type="file" className="hidden" accept=".json" onChange={handleLoadTopology} />
            </label>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4 flex-1 min-h-0">
        {/* Toolbar */}
        <Card className="col-span-2 flex flex-col">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Tools</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 flex-1">
            {/* Tool Selection */}
            <div className="space-y-2">
              <Label className="text-xs">Mode</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant={tool === 'select' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setTool('select')}
                >
                  <MousePointer className="w-4 h-4" />
                </Button>
                <Button
                  variant={tool === 'pan' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setTool('pan')}
                >
                  <Move className="w-4 h-4" />
                </Button>
                <Button
                  variant={tool === 'wall' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setTool('wall')}
                >
                  <Square className="w-4 h-4" />
                </Button>
                <Button
                  variant={tool === 'connection' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => {
                    setTool('connection');
                    setConnectionStart(null);
                  }}
                >
                  <Link2 className="w-4 h-4" />
                </Button>
                <Button
                  variant={tool === 'equipment' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setTool('equipment')}
                  className="col-span-2"
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Equipment
                </Button>
              </div>
            </div>

            {/* Equipment Types */}
            {tool === 'equipment' && (
              <div className="space-y-2">
                <Label className="text-xs">Equipment</Label>
                <div className="space-y-1">
                  {EQUIPMENT_TYPES.map((eq) => (
                    <Button
                      key={eq.type}
                      variant={selectedEquipmentType === eq.type ? 'default' : 'ghost'}
                      size="sm"
                      className="w-full justify-start"
                      onClick={() => setSelectedEquipmentType(eq.type)}
                    >
                      <eq.icon className="w-4 h-4 mr-2" style={{ color: eq.color }} />
                      {eq.label}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {/* Connection Styles */}
            {tool === 'connection' && (
              <div className="space-y-2">
                <Label className="text-xs">Connection Style</Label>
                <div className="space-y-1">
                  <Button
                    variant={selectedConnectionStyle === 'solid' ? 'default' : 'ghost'}
                    size="sm"
                    className="w-full justify-start"
                    onClick={() => setSelectedConnectionStyle('solid')}
                  >
                    <Minus className="w-4 h-4 mr-2" />
                    Solid
                  </Button>
                  <Button
                    variant={selectedConnectionStyle === 'dotted' ? 'default' : 'ghost'}
                    size="sm"
                    className="w-full justify-start"
                    onClick={() => setSelectedConnectionStyle('dotted')}
                  >
                    <MoreHorizontal className="w-4 h-4 mr-2" />
                    Dotted
                  </Button>
                  <Button
                    variant={selectedConnectionStyle === 'dashed' ? 'default' : 'ghost'}
                    size="sm"
                    className="w-full justify-start"
                    onClick={() => setSelectedConnectionStyle('dashed')}
                  >
                    <Minus className="w-4 h-4 mr-2" style={{ strokeDasharray: '4 2' }} />
                    Dashed
                  </Button>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-xs">View</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setZoom((z) => Math.min(z + 0.2, 3))}
                >
                  <ZoomIn className="w-4 h-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setZoom((z) => Math.max(z - 0.2, 0.5))}
                >
                  <ZoomOut className="w-4 h-4" />
                </Button>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => setShowGrid(!showGrid)}
              >
                <Grid3x3 className="w-4 h-4 mr-2" />
                {showGrid ? 'Hide Grid' : 'Show Grid'}
              </Button>
            </div>

            {selectedItem && (
              <Button
                variant="destructive"
                size="sm"
                className="w-full"
                onClick={handleDeleteSelected}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Canvas Area */}
        <div className="col-span-8 flex flex-col space-y-4">
          <Card className="flex-1 flex flex-col min-h-0">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>{currentFloor.name}</CardTitle>
                  <p className="text-sm text-muted-foreground">{currentFloor.building}</p>
                </div>
                <Badge variant="outline">
                  Zoom: {Math.round(zoom * 100)}% | {currentFloor.equipment.length} items
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="flex-1 p-0 relative min-h-0">
              <canvas
                ref={canvasRef}
                width={1200}
                height={800}
                style={{ backgroundColor: '#0a0a0a' }}
                className={cn(
                  "w-full h-full border-t",
                  isPanning ? "cursor-grabbing" : tool === 'pan' ? "cursor-grab" : "cursor-crosshair"
                )}
                onMouseDown={handleCanvasMouseDown}
                onMouseMove={handleCanvasMouseMove}
                onMouseUp={handleCanvasMouseUp}
                onMouseLeave={handleCanvasMouseUp}
                onContextMenu={(e) => e.preventDefault()}
              />
            </CardContent>
          </Card>
        </div>

        {/* Floors Panel */}
        <Card className="col-span-2 flex flex-col">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Floors</CardTitle>
              <Dialog open={isAddFloorOpen} onOpenChange={setIsAddFloorOpen}>
                <DialogTrigger asChild>
                  <Button variant="ghost" size="sm">
                    <Plus className="w-4 h-4" />
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Add New Floor</DialogTitle>
                    <DialogDescription>Create a new floor plan</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor="floor-name">Floor Name</Label>
                      <Input
                        id="floor-name"
                        placeholder="Ground Floor"
                        value={newFloor.name}
                        onChange={(e) => setNewFloor({ ...newFloor, name: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="building">Building</Label>
                      <Input
                        id="building"
                        placeholder="Main Building"
                        value={newFloor.building}
                        onChange={(e) => setNewFloor({ ...newFloor, building: e.target.value })}
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setIsAddFloorOpen(false)}>
                      Cancel
                    </Button>
                    <Button onClick={handleAddFloor}>Add Floor</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 flex-1 overflow-y-auto">
            {floors.map((floor) => (
              <Button
                key={floor.id}
                variant={floor.id === currentFloorId ? 'default' : 'ghost'}
                size="sm"
                className="w-full justify-start"
                onClick={() => setCurrentFloorId(floor.id)}
              >
                <Building className="w-4 h-4 mr-2" />
                <div className="flex-1 text-left truncate">
                  <div className="text-sm font-medium truncate">{floor.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{floor.building}</div>
                </div>
              </Button>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
