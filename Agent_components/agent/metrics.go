package main

import (
	"fmt"
	"os"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/disk"
	"github.com/shirou/gopsutil/v3/host"
	"github.com/shirou/gopsutil/v3/mem"
	"github.com/shirou/gopsutil/v3/net"
	"github.com/shirou/gopsutil/v3/process"
)

type MetricsCollector struct {
	config           *Config
	logger           *Logger
	metrics          *SystemMetrics
	mu               sync.RWMutex
	stopChan         chan struct{}
	lastNetIO        net.IOCountersStat
	serviceCollector *ServiceCollector
	logCollector     *LogCollector
}

type SystemMetrics struct {
	Timestamp   time.Time            `json:"timestamp"`
	AgentID     string               `json:"agent_id"`
	AgentName   string               `json:"agent_name"`
	CPU         CPUMetrics           `json:"cpu"`
	Memory      MemoryMetrics        `json:"memory"`
	Disk        []DiskMetrics        `json:"disk"`
	Network     NetworkMetrics       `json:"network"`
	Connections []ConnectionInfo     `json:"connections,omitempty"`
	Processes   ProcessMetrics       `json:"processes"`
	SystemInfo  SystemInfo           `json:"system_info"`
	DockerStats *DockerStats         `json:"docker_stats,omitempty"`
	Services    []ServiceInfo        `json:"services,omitempty"`
	Logs        map[string][]string  `json:"logs,omitempty"`
}

type ConnectionInfo struct {
	Protocol    string `json:"protocol"`
	LocalAddr   string `json:"local_addr"`
	RemoteAddr  string `json:"remote_addr"`
	Status      string `json:"status"`
	PID         int32  `json:"pid"`
	ProcessName string `json:"process_name,omitempty"`
}

type CPUMetrics struct {
	UsagePercent float64   `json:"usage_percent"`
	PerCore      []float64 `json:"per_core"`
	Cores        int       `json:"cores"`
	LoadAvg      []float64 `json:"load_avg"`
}

type MemoryMetrics struct {
	Total       uint64  `json:"total"`
	Used        uint64  `json:"used"`
	Free        uint64  `json:"free"`
	UsedPercent float64 `json:"used_percent"`
	Cached      uint64  `json:"cached"`
	Available   uint64  `json:"available"`
	SwapTotal   uint64  `json:"swap_total"`
	SwapUsed    uint64  `json:"swap_used"`
	SwapFree    uint64  `json:"swap_free"`
}

type DiskMetrics struct {
	Device      string  `json:"device"`
	Mountpoint  string  `json:"mountpoint"`
	Fstype      string  `json:"fstype"`
	Total       uint64  `json:"total"`
	Used        uint64  `json:"used"`
	Free        uint64  `json:"free"`
	UsedPercent float64 `json:"used_percent"`
}

type NetworkMetrics struct {
	BytesSent   uint64  `json:"bytes_sent"`
	BytesRecv   uint64  `json:"bytes_recv"`
	PacketsSent uint64  `json:"packets_sent"`
	PacketsRecv uint64  `json:"packets_recv"`
	ErrorsIn    uint64  `json:"errors_in"`
	ErrorsOut   uint64  `json:"errors_out"`
	DropIn      uint64  `json:"drop_in"`
	DropOut     uint64  `json:"drop_out"`
	RateSent    float64 `json:"rate_sent"`    // bytes per second
	RateRecv    float64 `json:"rate_recv"`    // bytes per second
}

type ProcessMetrics struct {
	Total   int              `json:"total"`
	Running int              `json:"running"`
	Zombie  int              `json:"zombie"`
	Top     []ProcessInfo    `json:"top"`
}

type ProcessInfo struct {
	PID         int32   `json:"pid"`
	Name        string  `json:"name"`
	CPUPercent  float64 `json:"cpu_percent"`
	MemPercent  float64 `json:"mem_percent"`
	MemoryMB    uint64  `json:"memory_mb"`
	Status      string  `json:"status"`
}

type SystemInfo struct {
	Hostname        string `json:"hostname"`
	OS              string `json:"os"`
	Platform        string `json:"platform"`
	PlatformVersion string `json:"platform_version"`
	KernelVersion   string `json:"kernel_version"`
	Architecture    string `json:"architecture"`
	Uptime          uint64 `json:"uptime"`
}

type DockerStats struct {
	ContainersRunning int `json:"containers_running"`
	ContainersStopped int `json:"containers_stopped"`
	Images            int `json:"images"`
}

func NewMetricsCollector(config *Config, logger *Logger) *MetricsCollector {
	return &MetricsCollector{
		config:           config,
		logger:           logger,
		metrics:          &SystemMetrics{},
		stopChan:         make(chan struct{}),
		serviceCollector: NewServiceCollector(config, logger),
		logCollector:     NewLogCollector(config, logger),
	}
}

func (mc *MetricsCollector) Start() {
	ticker := time.NewTicker(mc.config.Metrics.Interval)
	defer ticker.Stop()

	// Collect initial metrics
	mc.Collect()

	for {
		select {
		case <-ticker.C:
			mc.Collect()
		case <-mc.stopChan:
			return
		}
	}
}

func (mc *MetricsCollector) Stop() {
	close(mc.stopChan)
}

func (mc *MetricsCollector) Collect() {
	mc.logger.Debug("Collecting metrics...")

	metrics := &SystemMetrics{
		Timestamp: time.Now(),
		AgentID:   mc.config.Agent.ID,
		AgentName: mc.config.Agent.Name,
	}

	// Collect CPU metrics
	if mc.config.Metrics.Collectors.CPU {
		metrics.CPU = mc.collectCPU()
	}

	// Collect Memory metrics
	if mc.config.Metrics.Collectors.Memory {
		metrics.Memory = mc.collectMemory()
	}

	// Collect Disk metrics
	if mc.config.Metrics.Collectors.Disk {
		metrics.Disk = mc.collectDisk()
	}

	// Collect Network metrics
	if mc.config.Metrics.Collectors.Network {
		metrics.Network = mc.collectNetwork()
	}

	// Collect Process metrics
	if mc.config.Metrics.Collectors.Processes {
		metrics.Processes = mc.collectProcesses()
	}

	// Collect live connection snapshots
	if mc.config.Metrics.Collectors.Connections {
		metrics.Connections = mc.collectConnections(200)
	}

	// Collect System Info
	if mc.config.Metrics.Collectors.SystemInfo {
		metrics.SystemInfo = mc.collectSystemInfo()
	}

	// Collect Services
	if mc.serviceCollector != nil {
		metrics.Services = mc.serviceCollector.CollectServices()
	}

	// Collect Recent Logs (last 50 lines)
	if mc.logCollector != nil {
		metrics.Logs = mc.logCollector.CollectLogs(50)
	}

	mc.mu.Lock()
	mc.metrics = metrics
	mc.mu.Unlock()

	mc.logger.Debug("Metrics collected successfully")
}

func (mc *MetricsCollector) GetMetrics() *SystemMetrics {
	mc.mu.RLock()
	defer mc.mu.RUnlock()
	return mc.metrics
}

func (mc *MetricsCollector) collectCPU() CPUMetrics {
	cpuMetrics := CPUMetrics{
		Cores: runtime.NumCPU(),
	}

	// Overall CPU usage
	if percent, err := cpu.Percent(0, false); err == nil && len(percent) > 0 {
		cpuMetrics.UsagePercent = percent[0]
	}

	// Per-core usage
	if perCore, err := cpu.Percent(0, true); err == nil {
		cpuMetrics.PerCore = perCore
	}

	// Load average (Unix-like systems only) - commented out due to compatibility
	// if loadAvg, err := host.LoadAverage(); err == nil {
	// 	cpuMetrics.LoadAvg = []float64{loadAvg.Load1, loadAvg.Load5, loadAvg.Load15}
	// }

	return cpuMetrics
}

func (mc *MetricsCollector) collectMemory() MemoryMetrics {
	memMetrics := MemoryMetrics{}

	if vmem, err := mem.VirtualMemory(); err == nil {
		memMetrics.Total = vmem.Total
		memMetrics.Used = vmem.Used
		memMetrics.Free = vmem.Free
		memMetrics.UsedPercent = vmem.UsedPercent
		memMetrics.Cached = vmem.Cached
		memMetrics.Available = vmem.Available
	}

	if swap, err := mem.SwapMemory(); err == nil {
		memMetrics.SwapTotal = swap.Total
		memMetrics.SwapUsed = swap.Used
		memMetrics.SwapFree = swap.Free
	}

	return memMetrics
}

func (mc *MetricsCollector) collectDisk() []DiskMetrics {
	var diskMetrics []DiskMetrics

	partitions, err := disk.Partitions(false)
	if err != nil {
		mc.logger.Error("Failed to get disk partitions: %v", err)
		return diskMetrics
	}

	for _, partition := range partitions {
		usage, err := disk.Usage(partition.Mountpoint)
		if err != nil {
			continue
		}

		diskMetrics = append(diskMetrics, DiskMetrics{
			Device:      partition.Device,
			Mountpoint:  partition.Mountpoint,
			Fstype:      partition.Fstype,
			Total:       usage.Total,
			Used:        usage.Used,
			Free:        usage.Free,
			UsedPercent: usage.UsedPercent,
		})
	}

	return diskMetrics
}

func (mc *MetricsCollector) collectNetwork() NetworkMetrics {
	netMetrics := NetworkMetrics{}

	ioCounters, err := net.IOCounters(false)
	if err != nil || len(ioCounters) == 0 {
		mc.logger.Error("Failed to get network stats: %v", err)
		return netMetrics
	}

	current := ioCounters[0]
	netMetrics.BytesSent = current.BytesSent
	netMetrics.BytesRecv = current.BytesRecv
	netMetrics.PacketsSent = current.PacketsSent
	netMetrics.PacketsRecv = current.PacketsRecv
	netMetrics.ErrorsIn = current.Errin
	netMetrics.ErrorsOut = current.Errout
	netMetrics.DropIn = current.Dropin
	netMetrics.DropOut = current.Dropout

	// Calculate rate since last collection
	if mc.lastNetIO.BytesSent > 0 {
		interval := mc.config.Metrics.Interval.Seconds()
		netMetrics.RateSent = float64(current.BytesSent-mc.lastNetIO.BytesSent) / interval
		netMetrics.RateRecv = float64(current.BytesRecv-mc.lastNetIO.BytesRecv) / interval
	}

	mc.lastNetIO = current

	return netMetrics
}

func (mc *MetricsCollector) collectProcesses() ProcessMetrics {
	procMetrics := ProcessMetrics{}

	pids, err := process.Pids()
	if err != nil {
		mc.logger.Error("Failed to get process list: %v", err)
		return procMetrics
	}

	procMetrics.Total = len(pids)
	var processes []*process.Process

	for _, pid := range pids {
		proc, err := process.NewProcess(pid)
		if err != nil {
			continue
		}

		status, _ := proc.Status()
		if len(status) > 0 {
			switch status[0] {
			case "R":
				procMetrics.Running++
			case "Z":
				procMetrics.Zombie++
			}
		}

		processes = append(processes, proc)
	}

	// Get top 10 processes by CPU
	topProcs := make([]ProcessInfo, 0, 10)
	for _, proc := range processes {
		if len(topProcs) >= 10 {
			break
		}

		name, _ := proc.Name()
		cpuPercent, _ := proc.CPUPercent()
		memPercent, _ := proc.MemoryPercent()
		memInfo, _ := proc.MemoryInfo()
		status, _ := proc.Status()

		if cpuPercent > 0 || memPercent > 0 {
			info := ProcessInfo{
				PID:        proc.Pid,
				Name:       name,
				CPUPercent: cpuPercent,
				MemPercent: float64(memPercent),
			}

			if memInfo != nil {
				info.MemoryMB = memInfo.RSS / 1024 / 1024
			}

			if len(status) > 0 {
				info.Status = status[0]
			}

			topProcs = append(topProcs, info)
		}
	}

	procMetrics.Top = topProcs

	return procMetrics
}

func (mc *MetricsCollector) collectConnections(limit int) []ConnectionInfo {
	connections := make([]ConnectionInfo, 0, limit)

	stats, err := net.Connections("inet")
	if err != nil {
		mc.logger.Warn("Failed to collect connections: %v", err)
		return connections
	}

	for _, conn := range stats {
		if len(connections) >= limit {
			break
		}

		local := conn.Laddr.IP
		if conn.Laddr.Port > 0 {
			local = local + ":" + fmt.Sprintf("%d", conn.Laddr.Port)
		}

		remote := conn.Raddr.IP
		if conn.Raddr.Port > 0 {
			remote = remote + ":" + fmt.Sprintf("%d", conn.Raddr.Port)
		}

		processName := ""
		if conn.Pid > 0 {
			if proc, procErr := process.NewProcess(conn.Pid); procErr == nil {
				if name, nameErr := proc.Name(); nameErr == nil {
					processName = name
				}
			}
		}

		connections = append(connections, ConnectionInfo{
			Protocol:    protocolFromSocketType(conn.Type),
			LocalAddr:   local,
			RemoteAddr:  remote,
			Status:      conn.Status,
			PID:         conn.Pid,
			ProcessName: processName,
		})
	}

	return connections
}

func protocolFromSocketType(socketType uint32) string {
	switch socketType {
	case syscall.SOCK_STREAM:
		return "tcp"
	case syscall.SOCK_DGRAM:
		return "udp"
	case syscall.SOCK_RAW:
		return "raw"
	default:
		return fmt.Sprintf("sock_%d", socketType)
	}
}

func isContainerEnvironment() bool {
	if _, err := os.Stat("/.dockerenv"); err == nil {
		return true
	}

	cgroupBytes, err := os.ReadFile("/proc/1/cgroup")
	if err != nil {
		return false
	}

	cgroup := strings.ToLower(string(cgroupBytes))
	return strings.Contains(cgroup, "docker") ||
		strings.Contains(cgroup, "kubepods") ||
		strings.Contains(cgroup, "containerd") ||
		strings.Contains(cgroup, "lxc")
}

func getContainerUptimeSeconds() (uint64, error) {
	uptimeBytes, err := os.ReadFile("/proc/uptime")
	if err != nil {
		return 0, err
	}

	uptimeFields := strings.Fields(string(uptimeBytes))
	if len(uptimeFields) == 0 {
		return 0, fmt.Errorf("invalid /proc/uptime format")
	}

	systemUptimeSeconds, err := strconv.ParseFloat(uptimeFields[0], 64)
	if err != nil {
		return 0, err
	}

	pid1Bytes, err := os.ReadFile("/proc/1/stat")
	if err != nil {
		return 0, err
	}

	statLine := string(pid1Bytes)
	nameEnd := strings.LastIndex(statLine, ") ")
	if nameEnd == -1 {
		return 0, fmt.Errorf("invalid /proc/1/stat format")
	}

	restFields := strings.Fields(statLine[nameEnd+2:])
	if len(restFields) <= 19 {
		return 0, fmt.Errorf("missing starttime in /proc/1/stat")
	}

	// In /proc/[pid]/stat, field #22 is starttime (clock ticks since boot).
	// After removing pid+comm (first 2 fields), it becomes index 19.
	startTicks, err := strconv.ParseFloat(restFields[19], 64)
	if err != nil {
		return 0, err
	}

	// Linux default HZ is typically 100 for modern kernels.
	const clockTicksPerSecond = 100.0
	containerUptime := systemUptimeSeconds - (startTicks / clockTicksPerSecond)
	if containerUptime < 0 {
		containerUptime = 0
	}

	return uint64(containerUptime), nil
}

func (mc *MetricsCollector) collectSystemInfo() SystemInfo {
	sysInfo := SystemInfo{
		Architecture: runtime.GOARCH,
	}

	if info, err := host.Info(); err == nil {
		sysInfo.Hostname = info.Hostname
		sysInfo.OS = info.OS
		sysInfo.Platform = info.Platform
		sysInfo.PlatformVersion = info.PlatformVersion
		sysInfo.KernelVersion = info.KernelVersion
		sysInfo.Uptime = info.Uptime
	}

	if isContainerEnvironment() {
		if containerUptime, err := getContainerUptimeSeconds(); err == nil {
			sysInfo.Uptime = containerUptime
		}
	}

	return sysInfo
}
