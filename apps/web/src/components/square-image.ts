"use client";

// An image picked by someone, made a square before it is sent: a photo (cropped to fill the square), a logo
// (fitted whole in it, its transparency kept)

const SIZE = 256;

/**
 * Image made a 256 px square, as WebP; where the browser cannot encode WebP (Safari), as PNG when it has to stay
 * transparent (a logo), otherwise as JPEG
 */
export async function squareImage(file: File, fit: "cover" | "contain" = "cover"): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext("2d")!;
  if (fit === "cover") {
    const side = Math.min(bmp.width, bmp.height);
    ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
  } else {
    const scale = SIZE / Math.max(bmp.width, bmp.height);
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    ctx.drawImage(bmp, (SIZE - w) / 2, (SIZE - h) / 2, w, h);
  }
  bmp.close();
  const as = (type: string) => new Promise<Blob | null>((ok) => canvas.toBlob(ok, type, 0.85));
  const webp = await as("image/webp");
  if (webp?.type === "image/webp") return webp;
  if (fit === "contain") {
    const png = await as("image/png");
    if (png && png.size <= 300_000) return png;
  }
  // JPEG has no transparency: what was transparent turns white rather than black
  const flat = document.createElement("canvas");
  flat.width = flat.height = SIZE;
  const fctx = flat.getContext("2d")!;
  fctx.fillStyle = "#fff";
  fctx.fillRect(0, 0, SIZE, SIZE);
  fctx.drawImage(canvas, 0, 0);
  const jpeg = await new Promise<Blob | null>((ok) => flat.toBlob(ok, "image/jpeg", 0.85));
  if (!jpeg) throw new Error("unreadable");
  return jpeg;
}
