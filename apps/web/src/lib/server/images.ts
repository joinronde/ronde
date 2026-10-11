import "server-only";

/** Largest photo of a person received: the browser has already cropped it to a 256 px square */
export const AVATAR_MAX_BYTES = 300_000;

/** Actual image type, from its first bytes (the sent header is not trusted); SVG is refused: it can carry scripts */
export function sniffImage(b: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}
