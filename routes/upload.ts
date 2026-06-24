import { Router, Request, Response } from "express";
import multer from "multer";
import sharp from "sharp";
import { v4 as uuid } from "uuid";
import { requireAuth } from "../middleware/auth";
import { supabase } from "../db";

const router = Router();

const BUCKET = "uploads";
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/gif"];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    if (ALLOWED.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Format non supporté (jpeg, png, webp ou gif uniquement)."));
  },
});

async function uploadToSupabase(buffer: Buffer, filename: string, contentType = "image/webp"): Promise<string> {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(filename, buffer, { contentType, upsert: true });

  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(filename);
  return data.publicUrl;
}

// POST /api/upload — upload + process one image (auth).
router.post("/", requireAuth, upload.single("image"), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "Aucune image reçue." });
      return;
    }

    const id = uuid();
    const name = `${id}.webp`;
    const thumbName = `${id}_thumb.webp`;

    // Process full image
    const fullBuffer = await sharp(req.file.buffer)
      .rotate()
      .resize({ width: 1400, withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();

    // Process thumbnail
    const thumbBuffer = await sharp(req.file.buffer)
      .rotate()
      .resize({ width: 400, withoutEnlargement: true })
      .webp({ quality: 70 })
      .toBuffer();

    // Upload both to Supabase Storage
    const url = await uploadToSupabase(fullBuffer, name);
    const thumbUrl = await uploadToSupabase(thumbBuffer, thumbName);

    res.json({ url, thumbUrl });
  } catch (err: any) {
    console.error("Upload error:", err);
    res.status(500).json({ error: err?.message ?? "Échec du traitement de l'image." });
  }
});

// DELETE /api/upload/:filename — remove a file (and its thumbnail) from Supabase Storage (auth).
router.delete("/:filename", requireAuth, async (req: Request, res: Response) => {
  try {
    const filename = req.params.filename;
    const toDelete = [filename];

    // Also remove thumbnail if deleting main image
    if (filename.endsWith(".webp") && !filename.endsWith("_thumb.webp")) {
      toDelete.push(filename.replace(/\.webp$/, "_thumb.webp"));
    }

    await supabase.storage.from(BUCKET).remove(toDelete);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: "Échec de la suppression." });
  }
});

export default router;
