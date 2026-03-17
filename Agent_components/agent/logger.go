package main

import (
	"fmt"
	"log"
	"os"
	"strings"
	"time"
)

type Logger struct {
	level      string
	file       *os.File
	maxSize    int
	maxBackups int
}

func NewLogger(config struct {
	Level      string `yaml:"level"`
	File       string `yaml:"file"`
	MaxSize    int    `yaml:"max_size"`
	MaxBackups int    `yaml:"max_backups"`
}) *Logger {
	logger := &Logger{
		level:      config.Level,
		maxSize:    config.MaxSize,
		maxBackups: config.MaxBackups,
	}

	if config.File != "" {
		file, err := os.OpenFile(config.File, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
		if err != nil {
			log.Printf("Failed to open log file: %v", err)
		} else {
			logger.file = file
			// Set log output to file
			log.SetOutput(file)
		}
	}

	return logger
}

func (l *Logger) shouldLog(level string) bool {
	levels := map[string]int{
		"debug": 0,
		"info":  1,
		"warn":  2,
		"error": 3,
	}

	currentLevel, ok := levels[strings.ToLower(l.level)]
	if !ok {
		currentLevel = 1 // default to info
	}

	msgLevel, ok := levels[strings.ToLower(level)]
	if !ok {
		return true
	}

	return msgLevel >= currentLevel
}

func (l *Logger) log(level, format string, args ...interface{}) {
	if !l.shouldLog(level) {
		return
	}

	timestamp := time.Now().Format("2006-01-02 15:04:05")
	message := fmt.Sprintf(format, args...)
	logLine := fmt.Sprintf("[%s] [%s] %s\n", timestamp, strings.ToUpper(level), message)

	if l.file != nil {
		l.file.WriteString(logLine)
	} else {
		fmt.Print(logLine)
	}
}

func (l *Logger) Debug(format string, args ...interface{}) {
	l.log("debug", format, args...)
}

func (l *Logger) Info(format string, args ...interface{}) {
	l.log("info", format, args...)
}

func (l *Logger) Warn(format string, args ...interface{}) {
	l.log("warn", format, args...)
}

func (l *Logger) Error(format string, args ...interface{}) {
	l.log("error", format, args...)
}

func (l *Logger) Close() {
	if l.file != nil {
		l.file.Close()
	}
}
