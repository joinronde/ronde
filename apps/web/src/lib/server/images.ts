import "server-only";
import sharp from "sharp";
import { AppError, OpError } from "./errors";
import { readCapped } from "./http";

/** Largest photo of a person received: the browser has already cropped it to a 256 px square */
export const AVATAR_MAX_BYTES = 300_000;

/** Actual image type, from its first bytes (the sent header is not trusted); SVG is refused: it can carry scripts */
export function sniffImage(b: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

/** Images drawn again at once: the others wait their turn, so a burst does not take the server's memory */
const AT_ONCE = 2;
let drawing = 0;
const waiting: (() => void)[] = [];
async function inTurn<T>(work: () => Promise<T>): Promise<T> {
  if (drawing >= AT_ONCE) await new Promise<void>((resolve) => waiting.push(resolve));
  drawing++;
  try {
    return await work();
  } finally {
    drawing--;
    waiting.shift()?.();
  }
}

/**
 * An image received (a photo, a logo, a meeting's picture), read up to its limit and drawn again: turned upright,
 * at most `side` pixels wide and high, as WebP. What it carried besides its pixels (place and camera of a photo)
 * is not kept, nor a size meant to choke a browser. Throws the given errors when too large or not an image.
 */
export async function receiveImage(
  req: Request,
  o: { maxBytes: number; side: number; tooLarge: "avatarTooLarge" | "logoTooLarge"; format: "avatarFormat" | "logoFormat" },
): Promise<{ data: Uint8Array<ArrayBuffer>; type: string }> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  const tooLarge = () => new AppError(o.tooLarge, { max: o.maxBytes / 1000 }, 413);
  if (declared > o.maxBytes) throw tooLarge();
  const bytes = await readCapped(req, o.maxBytes, tooLarge);
  return redrawImage(bytes, o);
}

/** The drawing part of receiveImage, for bytes already read */
export async function redrawImage(
  bytes: Uint8Array,
  o: { side: number; format: "avatarFormat" | "logoFormat" },
): Promise<{ data: Uint8Array<ArrayBuffer>; type: string }> {
  if (!bytes.length || !sniffImage(bytes)) throw new OpError(o.format);
  try {
    const data = await inTurn(() =>
      sharp(bytes, { limitInputPixels: 4096 * 4096 })
        .rotate()
        .resize(o.side, o.side, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 88 })
        .toBuffer(),
    );
    return { data: new Uint8Array(data), type: "image/webp" };
  } catch {
    throw new OpError(o.format);
  }
}
