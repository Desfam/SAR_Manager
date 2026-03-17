// Terminal WebSocket Service

import { API_CONFIG } from './api-config';

export interface TerminalMessage {
  type: 'connect-ssh' | 'connect-local' | 'input' | 'resize' | 'disconnect' | 'output' | 'connected' | 'error' | 'disconnected';
  data?: string;
  connectionId?: string;
  cols?: number;
  rows?: number;
  message?: string;
}

export class TerminalWebSocket {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;

  constructor(
    private onOutput: (data: string) => void,
    private onConnected: (message: string) => void,
    private onError: (error: string) => void,
    private onDisconnected: (message: string) => void
  ) {}

  connect(connectionId?: string) {
    const wsUrl = API_CONFIG.wsURL;
    
    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('Terminal WebSocket connected');
        this.reconnectAttempts = 0;

        // Connect to SSH server or local terminal
        if (connectionId) {
          this.send({
            type: 'connect-ssh',
            connectionId,
          });
        } else {
          this.send({
            type: 'connect-local',
          });
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const message: TerminalMessage = JSON.parse(event.data);

          switch (message.type) {
            case 'output':
              if (message.data) {
                this.onOutput(message.data);
              }
              break;
            case 'connected':
              this.onConnected(message.message || 'Connected');
              break;
            case 'error':
              this.onError(message.message || 'Unknown error');
              break;
            case 'disconnected':
              this.onDisconnected(message.message || 'Disconnected');
              break;
          }
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.onError('Connection error');
      };

      this.ws.onclose = () => {
        console.log('WebSocket closed');
        this.attemptReconnect(connectionId);
      };
    } catch (error) {
      console.error('Failed to create WebSocket:', error);
      this.onError('Failed to connect to terminal');
    }
  }

  private attemptReconnect(connectionId?: string) {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`Reconnecting... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      
      setTimeout(() => {
        this.connect(connectionId);
      }, this.reconnectDelay * this.reconnectAttempts);
    } else {
      this.onDisconnected('Connection closed - max reconnection attempts reached');
    }
  }

  send(message: TerminalMessage) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn('WebSocket is not connected');
    }
  }

  sendInput(data: string) {
    this.send({
      type: 'input',
      data,
    });
  }

  resize(cols: number, rows: number) {
    this.send({
      type: 'resize',
      cols,
      rows,
    });
  }

  disconnect() {
    this.reconnectAttempts = this.maxReconnectAttempts; // Prevent reconnection
    if (this.ws) {
      this.send({
        type: 'disconnect',
      });
      this.ws.close();
      this.ws = null;
    }
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}
