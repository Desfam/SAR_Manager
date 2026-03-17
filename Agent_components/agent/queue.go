package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// QueueEntry represents a single buffered message.
type QueueEntry struct {
	ID        string          `json:"id"`
	Type      string          `json:"type"`
	Payload   json.RawMessage `json:"payload"`
	CreatedAt time.Time       `json:"created_at"`
	Attempts  int             `json:"attempts"`
}

// OfflineQueue is a file-based queue that buffers outgoing messages
// when the server is unreachable and drains them on reconnect.
type OfflineQueue struct {
	dir    string
	logger *Logger
	mu     sync.Mutex
}

// NewOfflineQueue creates the queue directory and returns a ready queue.
func NewOfflineQueue(dir string, logger *Logger) (*OfflineQueue, error) {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, fmt.Errorf("failed to create queue dir %s: %w", dir, err)
	}
	return &OfflineQueue{dir: dir, logger: logger}, nil
}

// Enqueue serialises payload and writes it to the queue directory.
func (q *OfflineQueue) Enqueue(msgType string, payload interface{}) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal payload: %w", err)
	}

	entry := QueueEntry{
		ID:        fmt.Sprintf("%d_%d", time.Now().UnixNano(), os.Getpid()),
		Type:      msgType,
		Payload:   data,
		CreatedAt: time.Now(),
	}

	entryData, err := json.Marshal(entry)
	if err != nil {
		return err
	}

	q.mu.Lock()
	defer q.mu.Unlock()
	filePath := filepath.Join(q.dir, "q_"+entry.ID+".json")
	return os.WriteFile(filePath, entryData, 0600)
}

// Drain reads all queued entries and tries to send them via sendFn.
// Successfully sent entries are deleted; failed entries keep their attempt count.
// Entries that fail 5+ times are dropped.
func (q *OfflineQueue) Drain(sendFn func(msgType string, payload json.RawMessage) error) {
	q.mu.Lock()
	defer q.mu.Unlock()

	pattern := filepath.Join(q.dir, "q_*.json")
	files, err := filepath.Glob(pattern)
	if err != nil || len(files) == 0 {
		return
	}

	q.logger.Info("Draining %d queued message(s)", len(files))

	for _, file := range files {
		data, err := os.ReadFile(file)
		if err != nil {
			q.logger.Error("Failed to read queue file %s: %v", file, err)
			continue
		}

		var entry QueueEntry
		if err := json.Unmarshal(data, &entry); err != nil {
			q.logger.Error("Invalid queue file %s — removing: %v", file, err)
			os.Remove(file)
			continue
		}

		if err := sendFn(entry.Type, entry.Payload); err != nil {
			entry.Attempts++
			q.logger.Warn("Failed to drain %s (attempt %d): %v", entry.Type, entry.Attempts, err)
			if entry.Attempts >= 5 {
				q.logger.Warn("Dropping queue entry %s after %d failed attempts", entry.ID, entry.Attempts)
				os.Remove(file)
			} else {
				updated, _ := json.Marshal(entry)
				os.WriteFile(file, updated, 0600)
			}
		} else {
			os.Remove(file)
			q.logger.Debug("Drained queued message: %s", entry.Type)
		}
	}
}

// Size returns the number of messages currently in the queue.
func (q *OfflineQueue) Size() int {
	q.mu.Lock()
	defer q.mu.Unlock()
	files, _ := filepath.Glob(filepath.Join(q.dir, "q_*.json"))
	return len(files)
}
