package main

import (
	"encoding/json"
	"os"
	"sync"
)

// PolicyFeatures mirrors the server-side feature toggles.
type PolicyFeatures struct {
	Metrics           bool `json:"metrics"`
	SecurityAudits    bool `json:"security_audits"`
	CommandExecution  bool `json:"command_execution"`
	FileCollection    bool `json:"file_collection"`
	ServiceInspection bool `json:"service_inspection"`
	ArtifactUpload    bool `json:"artifact_upload"`
}

// AgentPolicy holds the effective policy pushed from the server.
type AgentPolicy struct {
	ProfileID           string         `json:"profile_id"`
	Features            PolicyFeatures `json:"features"`
	MetricsIntervalSecs int            `json:"metrics_interval_seconds"`
	AuditIntervalSecs   int            `json:"audit_interval_seconds"`
	mu                  sync.RWMutex
}

// DefaultPolicy returns a sensible built-in default.
func DefaultPolicy() *AgentPolicy {
	return &AgentPolicy{
		ProfileID: "standard-linux",
		Features: PolicyFeatures{
			Metrics:           true,
			SecurityAudits:    true,
			CommandExecution:  true,
			FileCollection:    false,
			ServiceInspection: true,
			ArtifactUpload:    false,
		},
		MetricsIntervalSecs: 30,
		AuditIntervalSecs:   3600,
	}
}

// Update applies a policy JSON payload received from the server.
func (p *AgentPolicy) Update(data json.RawMessage) {
	p.mu.Lock()
	defer p.mu.Unlock()
	// Unmarshal into a temporary copy so partial payloads don't corrupt state
	tmp := &AgentPolicy{
		ProfileID:           p.ProfileID,
		Features:            p.Features,
		MetricsIntervalSecs: p.MetricsIntervalSecs,
		AuditIntervalSecs:   p.AuditIntervalSecs,
	}
	if err := json.Unmarshal(data, tmp); err == nil {
		p.ProfileID = tmp.ProfileID
		p.Features = tmp.Features
		if tmp.MetricsIntervalSecs > 0 {
			p.MetricsIntervalSecs = tmp.MetricsIntervalSecs
		}
		if tmp.AuditIntervalSecs > 0 {
			p.AuditIntervalSecs = tmp.AuditIntervalSecs
		}
	}
}

// IsFeatureEnabled returns whether a named feature is active.
func (p *AgentPolicy) IsFeatureEnabled(feature string) bool {
	p.mu.RLock()
	defer p.mu.RUnlock()
	switch feature {
	case "metrics":
		return p.Features.Metrics
	case "security_audits":
		return p.Features.SecurityAudits
	case "command_execution":
		return p.Features.CommandExecution
	case "file_collection":
		return p.Features.FileCollection
	case "service_inspection":
		return p.Features.ServiceInspection
	case "artifact_upload":
		return p.Features.ArtifactUpload
	}
	return false
}

// GetMetricsInterval returns the effective metrics send interval in seconds.
func (p *AgentPolicy) GetMetricsInterval() int {
	p.mu.RLock()
	defer p.mu.RUnlock()
	if p.MetricsIntervalSecs <= 0 {
		return 30
	}
	return p.MetricsIntervalSecs
}

// Save persists the policy to disk so it survives restarts.
func (p *AgentPolicy) Save(path string) error {
	p.mu.RLock()
	defer p.mu.RUnlock()
	data, err := json.MarshalIndent(p, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0600)
}

// LoadPolicy loads a saved policy from disk; returns the default if missing or invalid.
func LoadPolicy(path string) *AgentPolicy {
	data, err := os.ReadFile(path)
	if err != nil {
		return DefaultPolicy()
	}
	policy := DefaultPolicy()
	if err := json.Unmarshal(data, policy); err != nil {
		return DefaultPolicy()
	}
	return policy
}
