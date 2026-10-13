import { withBasePath } from "@/lib/shared/base-path";
import { meetingInitials } from "@/lib/shared/initials";

export interface MeetingMarkData {
  id: string;
  name: string;
  /** Emoji chosen for it (empty: its initials) */
  icon: string;
  /** Version of its uploaded image (null: none) */
  image: number | null;
}

/** Address of a meeting's image, versioned so it can stay cached */
export const meetingImageUrl = (slug: string, id: string, version: number) => withBasePath(`/api/w/${slug}/m/${id}/image?v=${version}`);

/** A meeting's mark in lists and menus: its image, otherwise its emoji, otherwise its initials */
export function MeetingMark({
  slug,
  meeting,
  className,
  letters = 1,
}: {
  slug: string;
  meeting: MeetingMarkData;
  /** The look of the place it sits in (side-mark, dash-meeting-mark, mt-mark…) */
  className: string;
  letters?: number;
}) {
  const kind = meeting.image ? " has-image" : meeting.icon ? " has-emoji" : "";
  return (
    <span className={`${className}${kind}`} aria-hidden="true">
      {meeting.image ? (
        <img src={meetingImageUrl(slug, meeting.id, meeting.image)} alt="" loading="lazy" draggable={false} />
      ) : (
        meeting.icon || meetingInitials(meeting.name, letters)
      )}
    </span>
  );
}
