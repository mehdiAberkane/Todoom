const MAX_SIDE = 2560;
const JPEG_QUALITY = 0.82;

/**
 * Turns a picked image into a JPEG data URL small enough to sync through
 * Drive (a few hundred KB) while staying sharp full-screen.
 */
export async function imageToBackground(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Ce fichier n'est pas une image.");
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("Image illisible : essaie un JPEG, un PNG ou un WebP.");
  });
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d")!;
  // JPEG has no transparency: fill with the app background so transparent PNGs don't turn black.
  ctx.fillStyle = "#0e0d11";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}
