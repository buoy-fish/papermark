// buoy fork: self-hosted ClickHouse replacement for Tinybird (@chronark/zod-bird).
//
// Tinybird is proprietary (TSML license); its engine is ClickHouse (Apache 2.0).
// This module exposes the SAME interface the app already uses — a `Tinybird`
// class with `buildIngestEndpoint` and `buildPipe` — so publish.ts / pipes.ts
// only change their import. It talks to ClickHouse over its HTTP interface with
// `fetch` (no SDK dependency). The read "pipes" are the SQL from
// lib/tinybird/endpoints/*.pipe, with Tinybird's `{{ Type(name) }}` templating
// rewritten to ClickHouse's native `{name:Type}` parameter syntax.
//
// Coverage (see FORK.md): the document/page/team analytics pipes that power the
// shipped PDF-sharing analytics are ported; the dataroom/video/in-doc-click/
// webhook pipes (unshipped features) return empty until ported against a live
// ClickHouse. All five ingest datasources write for real.

import type { z } from "zod";

const CLICKHOUSE_URL = process.env.CLICKHOUSE_URL ?? "http://clickhouse:8123";
const CLICKHOUSE_USER = process.env.CLICKHOUSE_USER ?? "papermark";
const CLICKHOUSE_PASSWORD = process.env.CLICKHOUSE_PASSWORD ?? "";
const CLICKHOUSE_DB = process.env.CLICKHOUSE_DB ?? "papermark";

function chHeaders(): Record<string, string> {
  return {
    "X-ClickHouse-User": CLICKHOUSE_USER,
    "X-ClickHouse-Key": CLICKHOUSE_PASSWORD,
    "Content-Type": "text/plain",
  };
}

/** Run a read query with named params, return parsed JSONEachRow rows. */
async function chQuery(
  sql: string,
  params: Record<string, unknown>,
): Promise<any[]> {
  const qs = new URLSearchParams({ database: CLICKHOUSE_DB });
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    qs.set(`param_${k}`, String(v));
  }
  const res = await fetch(`${CLICKHOUSE_URL}/?${qs.toString()}`, {
    method: "POST",
    headers: chHeaders(),
    body: `${sql}\nFORMAT JSONEachRow`,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ClickHouse query failed (${res.status}): ${text}`);
  }
  const text = await res.text();
  if (!text.trim()) return [];
  return text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

/** Insert rows into a datasource table as JSONEachRow. */
async function chInsert(
  table: string,
  rows: Record<string, unknown>[],
): Promise<void> {
  if (rows.length === 0) return;
  // ClickHouse JSONEachRow wants 0/1 for UInt8 boolean-ish columns (e.g. `bot`).
  const normalized = rows.map((r) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) {
      out[k] = typeof v === "boolean" ? (v ? 1 : 0) : v;
    }
    return out;
  });
  const qs = new URLSearchParams({ database: CLICKHOUSE_DB });
  const body =
    `INSERT INTO ${table} FORMAT JSONEachRow\n` +
    normalized.map((r) => JSON.stringify(r)).join("\n");
  const res = await fetch(`${CLICKHOUSE_URL}/?${qs.toString()}`, {
    method: "POST",
    headers: chHeaders(),
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ClickHouse insert failed (${res.status}): ${text}`);
  }
}

// Tinybird pipe name -> ClickHouse SQL. `{{ Type(x) }}` -> `{x:Type}`. Source:
// lib/tinybird/endpoints/*.pipe. Pipes for unshipped features map to null (the
// endpoint returns an empty result set rather than 500-ing the caller).
const PIPE_SQL: Record<string, string | null> = {
  get_total_average_page_duration__v5: `
    WITH DistinctDurations AS (
      SELECT versionNumber, pageNumber, viewId, SUM(duration) AS distinct_duration
      FROM page_views__v3
      WHERE documentId = {documentId:String}
        AND time >= {since:Int64}
        AND linkId NOT IN splitByChar(',', {excludedLinkIds:String})
        AND viewId NOT IN splitByChar(',', {excludedViewIds:String})
      GROUP BY versionNumber, pageNumber, viewId
    )
    SELECT versionNumber, pageNumber, AVG(distinct_duration) AS avg_duration
    FROM DistinctDurations
    GROUP BY versionNumber, pageNumber
    ORDER BY versionNumber ASC, pageNumber ASC`,

  get_page_duration_per_view__v5: `
    SELECT pageNumber, SUM(duration) AS sum_duration
    FROM page_views__v3
    WHERE documentId = {documentId:String} AND viewId = {viewId:String}
      AND time >= {since:Int64}
    GROUP BY pageNumber ORDER BY pageNumber ASC`,

  get_view_completion_stats__v1: `
    SELECT viewId, versionNumber, COUNT(DISTINCT pageNumber) AS pages_viewed
    FROM page_views__v3
    WHERE documentId = {documentId:String}
      AND viewId NOT IN splitByChar(',', {excludedViewIds:String})
      AND time >= {since:Int64}
    GROUP BY viewId, versionNumber`,

  get_total_document_duration__v1: `
    SELECT SUM(duration) AS sum_duration
    FROM page_views__v3
    WHERE documentId = {documentId:String} AND time >= {since:Int64}
      AND linkId NOT IN splitByChar(',', {excludedLinkIds:String})
      AND viewId NOT IN splitByChar(',', {excludedViewIds:String})`,

  get_total_link_duration__v1: `
    SELECT SUM(duration) AS sum_duration, COUNT(DISTINCT viewId) AS view_count
    FROM page_views__v3
    WHERE linkId = {linkId:String} AND time >= {since:Int64}
      AND documentId = {documentId:String}
      AND viewId NOT IN splitByChar(',', {excludedViewIds:String})`,

  get_total_viewer_duration__v1: `
    SELECT SUM(duration) AS sum_duration
    FROM page_views__v3
    WHERE viewId IN splitByChar(',', {viewIds:String}) AND time >= {since:Int64}`,

  get_document_duration_per_viewer__v1: `
    SELECT SUM(duration) AS sum_duration
    FROM page_views__v3
    WHERE documentId = {documentId:String}
      AND viewId IN splitByChar(',', {viewIds:String})`,

  // useragent per view — geo/device captured on the link-open event.
  get_useragent_per_view__v3: `
    SELECT country, city, browser, os, device
    FROM pm_click_events__v1
    WHERE view_id = {viewId:String} LIMIT 1`,
  // v2 has no .pipe in the repo; approximate with the v3 query (by view_id).
  get_useragent_per_view__v2: `
    SELECT country, city, browser, os, device
    FROM pm_click_events__v1
    WHERE view_id = {viewId:String} LIMIT 1`,

  get_total_team_duration__v1: `
    SELECT
      (SELECT SUM(duration) FROM page_views__v3
        WHERE documentId IN splitByString(',', {documentIds:String})
          AND time >= {since:Int64} AND time < {until:Int64}) AS total_duration,
      (SELECT groupArray(DISTINCT country) FROM pm_click_events__v1
        WHERE document_id IN splitByString(',', {documentIds:String})
          AND toUnixTimestamp64Milli(timestamp) >= {since:Int64}
          AND toUnixTimestamp64Milli(timestamp) < {until:Int64}
          AND country != 'Unknown' AND country != '') AS unique_countries`,

  // Unshipped features (dataroom / video / in-doc click / webhooks) — port
  // against a live ClickHouse when those features are enabled. Source files:
  // get_total_dataroom_duration.pipe, get_dataroom_view_document_stats.pipe,
  // get_video_events_by_document.pipe, get_video_events_by_view.pipe,
  // get_click_events_by_view.pipe, get_webhook_events.pipe.
  get_total_dataroom_duration__v1: null,
  get_dataroom_view_document_stats__v1: null,
  get_video_events_by_document__v1: null,
  get_video_events_by_view__v1: null,
  get_click_events_by_view__v1: null,
  get_webhook_events__v1: null,
};

type IngestConfig = { datasource: string; event: z.ZodTypeAny };
type PipeConfig = {
  pipe: string;
  parameters?: z.ZodTypeAny;
  data?: z.ZodTypeAny;
};

export class Tinybird {
  // Accepts the same `{ token }` options as zod-bird; ignored (we use env).
  constructor(_opts?: { token?: string; baseUrl?: string }) {}

  buildIngestEndpoint(config: IngestConfig) {
    const table = config.datasource; // datasource name == ClickHouse table name
    return async (
      data: unknown,
    ): Promise<{ successful_rows: number; quarantined_rows: number }> => {
      const arr = Array.isArray(data) ? data : [data];
      const rows = arr.map((d) => config.event.parse(d) as Record<string, unknown>);
      await chInsert(table, rows);
      return { successful_rows: rows.length, quarantined_rows: 0 };
    };
  }

  buildPipe(config: PipeConfig) {
    return async (params: Record<string, unknown> = {}): Promise<{ data: any[] }> => {
      const parsed = config.parameters
        ? (config.parameters.parse(params) as Record<string, unknown>)
        : params;
      const sql = PIPE_SQL[config.pipe];
      if (sql == null) {
        // Unported pipe (unshipped feature) — return empty rather than throw.
        return { data: [] };
      }
      const rows = await chQuery(sql, parsed);
      // Lenient: return rows as-is (ClickHouse columns already match the data
      // schema). Avoids 500s on minor JSON number/string coercion differences.
      return { data: rows };
    };
  }
}
