export interface QuoteProviderProjectRefs {
  projectId: string;
  quoteId: string;
  revisionId: string;
  quoteNumber?: string;
}

export interface QuoteProviderClient {
  createProject(input: Record<string, unknown>): Promise<Record<string, any>>;
  searchProjects(search: string, pageSize?: number): Promise<Record<string, any>>;
  getProject(projectId: string): Promise<Record<string, any>>;
  getWorkspace(projectId: string): Promise<Record<string, any>>;
  createWorksheet(projectId: string, input: Record<string, unknown>): Promise<Record<string, any>>;
  createWorksheetItem(
    projectId: string,
    worksheetId: string,
    input: Record<string, unknown>,
  ): Promise<Record<string, any>>;
  recalculateProject(projectId: string): Promise<Record<string, any>>;
}

export interface QuoteProviderClientFactory {
  forTenant(tenantId: string): Promise<QuoteProviderClient>;
}

function asObject(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' ? (value as Record<string, any>) : null;
}

export function extractProjectRefs(payload: unknown): QuoteProviderProjectRefs | null {
  const root = asObject(payload);
  if (!root) return null;

  const project = asObject(root.project) ?? root;
  const quote =
    asObject(root.quote) ??
    asObject(project.quote) ??
    asObject(project.quotes?.[0]?.quote) ??
    asObject(root.quotes?.[0]?.quote);
  const revision =
    asObject(root.revision) ?? asObject(root.latestRevision) ?? asObject(project.latestRevision);

  const projectId = String(project.id ?? '');
  const quoteId = String(quote?.id ?? '');
  const revisionId = String(
    revision?.id ?? quote?.currentRevisionId ?? project.quote?.currentRevisionId ?? '',
  );

  if (!projectId || !quoteId || !revisionId) return null;
  return {
    projectId,
    quoteId,
    revisionId,
    ...(quote?.quoteNumber ? { quoteNumber: String(quote.quoteNumber) } : {}),
  };
}

export function projectsFromSearch(payload: unknown): Array<Record<string, any>> {
  const root = asObject(payload);
  if (!root) return [];
  if (Array.isArray(root.projects))
    return root.projects.filter((x): x is Record<string, any> => !!asObject(x));
  if (Array.isArray(payload)) return payload.filter((x): x is Record<string, any> => !!asObject(x));
  return [];
}
