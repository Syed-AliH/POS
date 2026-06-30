export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export interface UpdateStatusPayload {
  phase: UpdatePhase;
  version?: string;
  currentVersion?: string;
  percent?: number;
  transferred?: number;
  total?: number;
  message?: string;
}
