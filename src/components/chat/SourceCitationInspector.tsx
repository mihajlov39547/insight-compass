import React, { useMemo } from "react";
import { ExternalLink, Copy, Loader2, FileText, Globe, Youtube, Network, Link2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import { useCitationDetails } from "@/hooks/useCitationDetails";
import type { CanonicalCitation } from "@/lib/citations";
import { MarkdownContent } from "@/components/chat/MarkdownContent";

interface SourceCitationInspectorProps {
  citation: CanonicalCitation | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Translator = (key: string, defaultValue?: string) => string;

function providerLabel(provider: string | null, sourceType: string | null, t: Translator): string {
  const p = (provider ?? "").toLowerCase();
  if (p === "google_drive") return t("citationInspector.provider.googleDrive", "Google Drive");
  if (p === "google_docs") return t("citationInspector.provider.googleDocs", "Google Docs");
  if (p === "website") return t("citationInspector.provider.website", "Website");
  if (p === "youtube") return t("citationInspector.provider.youtube", "YouTube");
  if (p === "local_upload" || p === "upload") return t("citationInspector.provider.upload", "Upload");
  if (p === "notion") return t("citationInspector.provider.notion", "Notion");
  const s = (sourceType ?? "").toLowerCase();
  if (s === "document") return t("citationInspector.provider.document", "Document");
  if (s === "web") return t("citationInspector.provider.web", "Web");
  if (s === "crawl") return t("citationInspector.provider.crawl", "Website crawl");
  if (s === "youtube") return t("citationInspector.provider.youtube", "YouTube");
  if (s === "transcript") return t("citationInspector.provider.transcript", "Transcript");
  return t("citationInspector.provider.unknown", "Source");
}

function traceabilityLabel(trace: string, t: Translator): string {
  switch (trace) {
    case "chunk":
      return t("citationInspector.trace.chunk", "Exact chunk");
    case "document":
      return t("citationInspector.trace.document", "Document metadata");
    case "resource_link":
      return t("citationInspector.trace.resourceLink", "Linked source");
    case "url_only":
      return t("citationInspector.trace.urlOnly", "URL only");
    default:
      return t("citationInspector.trace.none", "Limited details");
  }
}

function SourceIcon({ sourceType, className }: { sourceType: string; className?: string }) {
  const s = sourceType.toLowerCase();
  if (s === "youtube") return <Youtube className={className ?? "h-4 w-4 text-destructive"} />;
  if (s === "web") return <Globe className={className ?? "h-4 w-4 text-sky-600"} />;
  if (s === "crawl") return <Network className={className ?? "h-4 w-4 text-violet-600"} />;
  if (s === "transcript") return <Link2 className={className ?? "h-4 w-4 text-amber-600"} />;
  return <FileText className={className ?? "h-4 w-4 text-accent"} />;
}

function formatPercent(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  const pct = value <= 1 ? value * 100 : value;
  return `${Math.round(pct)}%`;
}

function formatTimestamp(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds)) return null;
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function SourceCitationInspector({ citation, open, onOpenChange }: SourceCitationInspectorProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { data: enriched, isLoading, isError } = useCitationDetails(open ? citation : null);

  const merged = useMemo(() => {
    if (!citation) return null;
    const pick = <T,>(a: T | null | undefined, b: T | null | undefined): T | null => {
      if (a !== null && a !== undefined && a !== ("" as unknown)) return a as T;
      if (b !== null && b !== undefined && b !== ("" as unknown)) return b as T;
      return null;
    };
    return {
      title: pick(enriched?.title, citation.title),
      provider: pick(enriched?.provider, citation.provider),
      source_type: enriched?.source_type ?? citation.source_type,
      url: pick(enriched?.url, citation.url),
      external_url: pick(enriched?.external_url, citation.external_url),
      excerpt: pick(enriched?.excerpt, citation.snippet),
      snippet: citation.snippet,
      page: pick(enriched?.page, citation.page),
      section: pick(enriched?.section, citation.section),
      chunk_index: pick(enriched?.chunk_index, citation.chunk_index),
      chunk_id: pick(enriched?.chunk_id, citation.chunk_id),
      document_id: pick(enriched?.document_id, citation.document_id),
      resource_link_id: pick(enriched?.resource_link_id, citation.resource_link_id),
      score: pick(enriched?.score, citation.score),
      relevance: pick(enriched?.relevance, citation.relevance),
      match_type: pick(enriched?.match_type, citation.match_type),
      matched_question_text: pick(enriched?.matched_question_text, citation.matched_question_text),
      timestamp_start: pick(enriched?.timestamp_start, citation.timestamp_start),
      timestamp_end: pick(enriched?.timestamp_end, citation.timestamp_end),
      storage_mode: enriched?.storage_mode ?? null,
      mime_type: enriched?.mime_type ?? null,
      external_modified_at: enriched?.external_modified_at ?? null,
      traceability: enriched?.traceability ?? "none",
    };
  }, [citation, enriched]);

  if (!citation || !merged) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-md p-0" />
      </Sheet>
    );
  }

  const openLink = merged.external_url || merged.url;
  const sourceType = String(merged.source_type ?? "unknown");

  const copyExcerpt = async () => {
    const text = merged.excerpt ?? merged.snippet;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast({ description: t("citationInspector.copiedExcerpt", "Excerpt copied") });
    } catch {
      toast({ variant: "destructive", description: t("citationInspector.copyFailed", "Copy failed") });
    }
  };

  const openOriginal = () => {
    if (!openLink) return;
    window.open(openLink, "_blank", "noopener,noreferrer");
  };

  const tsStart = formatTimestamp(merged.timestamp_start);
  const tsEnd = formatTimestamp(merged.timestamp_end);
  const relevancePct = formatPercent(merged.relevance ?? merged.score);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
        <SheetHeader className="px-4 pt-4 pb-3 border-b border-border/60 space-y-2">
          <div className="flex items-start gap-2">
            <div className="mt-0.5"><SourceIcon sourceType={sourceType} /></div>
            <div className="flex-1 min-w-0">
              <SheetTitle className="text-sm font-semibold leading-snug text-left break-words">
                {merged.title ?? t("citationInspector.untitled", "Untitled source")}
              </SheetTitle>
              <SheetDescription className="sr-only">
                {t("citationInspector.description", "Source details")}
              </SheetDescription>
              <div className="flex flex-wrap items-center gap-1 mt-1.5">
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 font-normal">
                  {providerLabel(merged.provider, sourceType, (k, d) => t(k, { defaultValue: d ?? "" }) as string)}
                </Badge>
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 font-normal capitalize">
                  {sourceType}
                </Badge>
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 font-normal">
                  {isLoading ? (
                    <span className="inline-flex items-center gap-1">
                      <Loader2 className="h-2.5 w-2.5 animate-spin" />
                      {t("citationInspector.loading", "Loading…")}
                    </span>
                  ) : (
                    traceabilityLabel(merged.traceability, (k, d) => t(k, { defaultValue: d ?? "" }) as string)
                  )}
                </Badge>
              </div>
            </div>
          </div>
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div className="px-4 py-3 space-y-4">
            {/* Overview */}
            {openLink && (
              <section className="space-y-1">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                  {t("citationInspector.source", "Source")}
                </div>
                <a
                  href={openLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-xs text-accent hover:underline break-all"
                >
                  {openLink}
                </a>
              </section>
            )}

            {/* Evidence */}
            <section className="space-y-1.5">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                {t("citationInspector.evidenceExcerpt", "Evidence excerpt")}
              </div>
              {merged.excerpt ? (
                <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs leading-relaxed text-foreground/90 whitespace-pre-wrap max-h-72 overflow-auto">
                  {merged.excerpt}
                </div>
              ) : isLoading ? (
                <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground inline-flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {t("citationInspector.loadingExcerpt", "Loading excerpt…")}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground italic">
                  {t("citationInspector.noExcerpt", "No excerpt available")}
                </div>
              )}
            </section>

            {/* Location */}
            {(merged.page || merged.section || merged.chunk_index !== null || tsStart || tsEnd) && (
              <section className="space-y-1.5">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                  {t("citationInspector.location", "Location")}
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  {merged.page && (
                    <>
                      <dt className="text-muted-foreground">{t("citationInspector.page", "Page")}</dt>
                      <dd className="text-foreground">{merged.page}</dd>
                    </>
                  )}
                  {merged.section && (
                    <>
                      <dt className="text-muted-foreground">{t("citationInspector.section", "Section")}</dt>
                      <dd className="text-foreground truncate">{merged.section}</dd>
                    </>
                  )}
                  {merged.chunk_index !== null && merged.chunk_index !== undefined && (
                    <>
                      <dt className="text-muted-foreground">{t("citationInspector.chunkIndex", "Chunk")}</dt>
                      <dd className="text-foreground">#{merged.chunk_index}</dd>
                    </>
                  )}
                  {(tsStart || tsEnd) && (
                    <>
                      <dt className="text-muted-foreground">{t("citationInspector.timestamp", "Timestamp")}</dt>
                      <dd className="text-foreground font-mono text-[11px]">
                        {tsStart ?? "0:00"}{tsEnd ? ` – ${tsEnd}` : ""}
                      </dd>
                    </>
                  )}
                </dl>
              </section>
            )}

            {/* Relevance / match */}
            {(relevancePct || merged.match_type || merged.matched_question_text) && (
              <section className="space-y-1.5">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                  {t("citationInspector.relevance", "Relevance")}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {relevancePct && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 font-normal">
                      {relevancePct}
                    </Badge>
                  )}
                  {merged.match_type && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 font-normal capitalize">
                      {merged.match_type}
                    </Badge>
                  )}
                </div>
                {merged.matched_question_text && (
                  <div className="border-l-2 border-accent/30 pl-2 py-0.5 space-y-0.5">
                    <div className="text-[10px] font-medium text-foreground/70">
                      {t("citationInspector.matchedQuestion", "Matched question")}
                    </div>
                    <div className="text-[11px] italic text-foreground/70">
                      "{merged.matched_question_text}"
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* Document/provider metadata */}
            {(merged.storage_mode || merged.mime_type || merged.external_modified_at) && (
              <section className="space-y-1.5">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                  {t("citationInspector.metadata", "Metadata")}
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  {merged.mime_type && (
                    <>
                      <dt className="text-muted-foreground">{t("citationInspector.mimeType", "Type")}</dt>
                      <dd className="text-foreground truncate">{merged.mime_type}</dd>
                    </>
                  )}
                  {merged.storage_mode && (
                    <>
                      <dt className="text-muted-foreground">{t("citationInspector.storage", "Storage")}</dt>
                      <dd className="text-foreground truncate">{merged.storage_mode}</dd>
                    </>
                  )}
                  {merged.external_modified_at && (
                    <>
                      <dt className="text-muted-foreground">{t("citationInspector.modified", "Modified")}</dt>
                      <dd className="text-foreground truncate">
                        {new Date(merged.external_modified_at).toLocaleString()}
                      </dd>
                    </>
                  )}
                </dl>
              </section>
            )}

            {isError && (
              <div className="text-[11px] text-muted-foreground italic">
                {t(
                  "citationInspector.enrichmentFailed",
                  "Additional details could not be loaded.",
                )}
              </div>
            )}

            <Separator />

            {/* Technical IDs (de-emphasized) */}
            {(merged.document_id || merged.chunk_id || merged.resource_link_id) && (
              <section className="space-y-1">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70 font-medium">
                  {t("citationInspector.technical", "Technical")}
                </div>
                <div className="text-[10px] text-muted-foreground/70 font-mono break-all space-y-0.5">
                  {merged.document_id && <div>doc: {merged.document_id}</div>}
                  {merged.chunk_id && <div>chunk: {merged.chunk_id}</div>}
                  {merged.resource_link_id && <div>link: {merged.resource_link_id}</div>}
                </div>
              </section>
            )}
          </div>
        </ScrollArea>

        <div className="border-t border-border/60 px-4 py-3 flex items-center justify-end gap-2">
          {(merged.excerpt || merged.snippet) && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 text-xs gap-1.5"
              onClick={copyExcerpt}
              aria-label={t("citationInspector.copyExcerpt", "Copy excerpt") as string}
            >
              <Copy className="h-3.5 w-3.5" />
              {t("citationInspector.copyExcerpt", "Copy excerpt")}
            </Button>
          )}
          {openLink && (
            <Button
              type="button"
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={openOriginal}
              aria-label={t("citationInspector.openOriginal", "Open original") as string}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {t("citationInspector.openOriginal", "Open original")}
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default SourceCitationInspector;
