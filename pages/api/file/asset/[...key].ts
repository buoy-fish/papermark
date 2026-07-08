import type { NextApiRequest, NextApiResponse } from "next";

import { GetObjectCommand } from "@aws-sdk/client-s3";

import { getStorageConfig } from "@/ee/features/storage/config";
import { getS3Client } from "@/lib/files/aws-client";

// Public, unauthenticated serve route for branding assets (logo/banner/OG
// images). These are embedded as <img src> on the public /view viewer pages
// served to anonymous recipients, so this path must sit on the Cloudflare
// Access BYPASS list (see ADR-0010 / deployment notes).
//
// SECURITY: only objects under the `assets/` prefix are served. Private
// documents are keyed `<teamId>/<docId>/...` and can never match, so this
// route cannot be used to exfiltrate document content from the shared bucket.

export const config = {
  api: {
    responseLimit: false,
  },
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", ["GET", "HEAD"]);
    return res.status(405).end("Method Not Allowed");
  }

  const segments = Array.isArray(req.query.key)
    ? req.query.key
    : req.query.key
      ? [req.query.key]
      : [];
  const key = segments.join("/");

  // Only assets/*, and no path traversal.
  if (!key.startsWith("assets/") || key.includes("..")) {
    return res.status(404).end("Not found");
  }

  try {
    const client = getS3Client();
    const { bucket } = getStorageConfig();

    const object = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );

    res.setHeader(
      "Content-Type",
      object.ContentType || "application/octet-stream",
    );
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    if (object.ETag) {
      res.setHeader("ETag", object.ETag);
    }

    if (req.method === "HEAD") {
      if (object.ContentLength != null) {
        res.setHeader("Content-Length", String(object.ContentLength));
      }
      return res.status(200).end();
    }

    const bytes = await object.Body!.transformToByteArray();
    return res.status(200).send(Buffer.from(bytes));
  } catch (error) {
    // Missing object, wrong transport, or credential error → 404 (don't leak).
    return res.status(404).end("Not found");
  }
}
