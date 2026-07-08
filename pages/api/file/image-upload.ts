import type { NextApiRequest, NextApiResponse } from "next";

import { PutObjectCommand } from "@aws-sdk/client-s3";
import { type HandleUploadBody, handleUpload } from "@vercel/blob/client";
import { getServerSession } from "next-auth/next";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { getStorageConfig } from "@/ee/features/storage/config";
import { getS3Client } from "@/lib/files/aws-client";
import { CustomUser } from "@/lib/types";
import { safeSlugify } from "@/lib/utils";

import { authOptions } from "../auth/[...nextauth]";

const uploadConfig = {
  profile: {
    allowedContentTypes: ["image/png", "image/jpg"],
    maximumSizeInBytes: 2 * 1024 * 1024, // 2MB
  },
  assets: {
    allowedContentTypes: [
      "image/png",
      "image/jpeg",
      "image/jpg",
      "image/svg+xml",
      "image/x-icon",
      "image/ico",
    ],
    maximumSizeInBytes: 5 * 1024 * 1024, // 5MB
  },
};

// Extension fallbacks for content types the uploaded filename may lack.
const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/svg+xml": ".svg",
  "image/x-icon": ".ico",
  "image/ico": ".ico",
};

// The S3/R2 branch consumes the raw request body, so Next's body parser must
// be disabled. The Vercel Blob fallback below is not used on the R2 self-host
// (it requires the parsed body); it is retained for upstream parity.
export const config = {
  api: {
    bodyParser: false,
  },
};

async function readRequestBody(
  req: NextApiRequest,
  maxBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) {
      throw new Error("File exceeds the maximum allowed size.");
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

// logo-upload/?type= "profile" | "assets"
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const type = Array.isArray(req.query.type)
    ? req.query.type[0]
    : req.query.type;

  if (!type || !(type in uploadConfig)) {
    return res.status(400).json({ error: "Invalid upload type specified." });
  }

  const typeConfig = uploadConfig[type as keyof typeof uploadConfig];

  // --- R2 / S3 self-host path: upload raw bytes to the private bucket. ---
  if (process.env.NEXT_PUBLIC_UPLOAD_TRANSPORT === "s3") {
    if (req.method !== "POST") {
      res.setHeader("Allow", ["POST"]);
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    // Touch the user so the type import is exercised and intent is explicit:
    // any authenticated team member may upload a branding asset.
    void (session.user as CustomUser).id;

    const contentType = (req.headers["content-type"] || "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (!typeConfig.allowedContentTypes.includes(contentType)) {
      return res
        .status(400)
        .json({ error: `Unsupported content type: ${contentType}` });
    }

    let buffer: Buffer;
    try {
      buffer = await readRequestBody(req, typeConfig.maximumSizeInBytes);
    } catch {
      return res
        .status(400)
        .json({ error: "File exceeds the maximum allowed size." });
    }
    if (buffer.length === 0) {
      return res.status(400).json({ error: "Empty file." });
    }

    const rawName = req.headers["x-file-name"]
      ? decodeURIComponent(
          Array.isArray(req.headers["x-file-name"])
            ? req.headers["x-file-name"][0]
            : req.headers["x-file-name"],
        )
      : "image";
    const { name, ext } = path.parse(rawName);
    const safeExt = ext || EXT_BY_CONTENT_TYPE[contentType] || "";
    const filename = `${safeSlugify(name || "image")}${safeExt}`;

    // `assets/` prefix is the contract the public serve route enforces: it only
    // streams objects under this prefix, so document keys (<teamId>/<docId>/...)
    // can never be reached through /api/file/asset/*.
    const key = `assets/${randomUUID()}/${filename}`;

    try {
      const client = getS3Client();
      const { bucket } = getStorageConfig();

      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: buffer,
          ContentType: contentType,
          CacheControl: "public, max-age=31536000, immutable",
        }),
      );
    } catch (error) {
      console.error("[image-upload] R2 put failed", error);
      return res.status(500).json({ error: "Failed to store image." });
    }

    return res.status(200).json({ url: `/api/file/asset/${key}` });
  }

  // --- Vercel Blob fallback (upstream parity; unused on the R2 self-host). ---
  const body = req.body as HandleUploadBody;
  try {
    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async () => {
        const session = await getServerSession(req, res, authOptions);
        if (!session) {
          res.status(401).end("Unauthorized");
          throw new Error("Unauthorized");
        }

        return {
          addRandomSuffix: true,
          allowedContentTypes: typeConfig.allowedContentTypes,
          maximumSizeInBytes: typeConfig.maximumSizeInBytes,
          metadata: JSON.stringify({
            userId: (session.user as CustomUser).id,
          }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        console.log("blob upload completed", blob, tokenPayload);
      },
    });

    return res.status(200).json(jsonResponse);
  } catch (error) {
    return res.status(400).json({ error: (error as Error).message });
  }
}
