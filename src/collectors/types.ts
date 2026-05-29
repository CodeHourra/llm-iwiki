export interface RawMessage {
  role: string
  content: string
  timestamp: string | null
}

export interface RawSession {
  sourceSessionId: string
  rawPath: string
  rawProjectPath: string | null
  title: string | null
  createdAt: string | null
  updatedAt: string | null
  messages: RawMessage[]
}

export interface Collector {
  id: string
  name: string
  detect(homeDir: string): boolean
  collect(homeDir: string): RawSession[]
}
