/**
 * Delulu — Global Type Definitions
 *
 * Provides type safety for the existing vanilla JS codebase.
 * Gradually move these into .ts files as you convert modules.
 */

// ── API ──────────────────────────────────────────────────────────────────────
interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

interface User {
  id: number;
  email: string;
  username: string;
  full_name: string;
  gender: 'male' | 'female' | 'other';
  avatar: string;
  college: string;
  hobbies: string[];
  bio?: string;
  token_version?: number;
  created_at: string;
}

interface Connection {
  id: number;
  from_user_id: number;
  to_user_id: number;
  status: 'pending' | 'active' | 'ended';
  face_reveal_available_at?: string;
  from_face_reveal: 0 | 1;
  to_face_reveal: 0 | 1;
  both_face_revealed: boolean;
  meeting_code?: string;
  created_at: string;
}

interface Message {
  id: number;
  connection_id: number;
  sender_id: number;
  content: string;
  is_encrypted: number;
  created_at: string;
}

// ── Session ──────────────────────────────────────────────────────────────────
interface SessionData {
  userId: number;
  user?: User;
}

// ── Capacitor ────────────────────────────────────────────────────────────────
interface CapacitorConfig {
  plugins?: {
    Config?: {
      apiBaseUrl?: string;
    };
  };
}

interface Window {
  Capacitor?: CapacitorConfig;
  Sentry?: {
    init: (config: Record<string, unknown>) => void;
    captureException: (error: Error, context?: Record<string, unknown>) => void;
    setTag: (key: string, value: string) => void;
  };
  __DELULU_DEBUG?: boolean;
}
