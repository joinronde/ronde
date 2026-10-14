/** Sent when the open meeting's name, mark or live state changes, for the sidebar around its pages (shell/app-shell.tsx) */
export const MEETING_MARK_EVENT = "ronde:meeting-mark";

export interface MeetingMarkChange {
  id: string;
  name: string;
  icon: string;
  image: number | null;
  live: boolean;
}
