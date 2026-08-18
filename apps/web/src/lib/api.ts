// The ONLY data source for the web app: the Railway API over HTTP. Nothing here
// touches Postgres (specs/08-web.md "Data access"). Types come from the shared
// contract package so producer and consumer agree.

import type {
  AttachmentUploadTicket,
  AttachmentViewTicket,
  Board,
  CreateChecklistItemInput,
  CreateCommentInput,
  CreateDocFolderInput,
  CreateDocInput,
  CreateGameNoteInput,
  CreateMilestoneInput,
  CreateNoteInput,
  CreateProjectGameInput,
  CreateProjectInput,
  CreateProjectTagInput,
  CreateSubtaskInput,
  CreateTaskInput,
  DemandOverlay,
  Doc,
  DocFolder,
  FeedItem,
  FeedSort,
  GameDetail,
  GameEvent,
  GameMetric,
  GameNote,
  GameStat,
  LifecycleEvent,
  LifecycleStage,
  LinkedNote,
  Membership,
  Milestone,
  Monetization,
  MoveTaskInput,
  Paged,
  PatchChecklistItemInput,
  PatchCommentInput,
  PatchDocFolderInput,
  PatchDocInput,
  PatchGameNoteInput,
  PatchMilestoneInput,
  PatchNoteInput,
  PatchProjectInput,
  PatchProjectTagInput,
  PatchTaskInput,
  Project,
  ProjectDetail,
  ProjectGame,
  ProjectNote,
  ProjectTag,
  PulseFilter,
  PulsePayload,
  PulseSearchResult,
  PulseSort,
  ReorderTaskInput,
  SortSnapshot,
  Tag,
  Task,
  TaskAttachment,
  TaskChecklistItem,
  TaskComment,
  TaskDetail,
} from "@monkyesuite/shared";

const BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787/v1";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Method = "GET" | "POST" | "PATCH" | "DELETE";

// One request path for global reads AND scoped calls. credentials:"include"
// sends the Better Auth session cookie to the API origin so scoped routes see a
// session; it's harmless on anonymous global reads.
async function request<T>(
  method: Method,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: "include",
    headers: {
      accept: "application/json",
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let code = "error";
    let message = res.statusText;
    try {
      const errBody: unknown = await res.json();
      if (
        errBody &&
        typeof errBody === "object" &&
        "error" in errBody &&
        errBody.error &&
        typeof errBody.error === "object"
      ) {
        const e = errBody.error as { code?: string; message?: string };
        code = e.code ?? code;
        message = e.message ?? message;
      }
    } catch {
      // non-JSON error body — keep statusText
    }
    throw new ApiError(res.status, code, message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const get = <T>(path: string): Promise<T> => request<T>("GET", path);
const post = <T>(path: string, body?: unknown): Promise<T> =>
  request<T>("POST", path, body ?? {});
const patch = <T>(path: string, body: unknown): Promise<T> =>
  request<T>("PATCH", path, body);
const del = (path: string): Promise<void> => request<void>("DELETE", path);

function qs(params: Record<string, string | number | undefined>): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") s.set(k, String(v));
  }
  const str = s.toString();
  return str ? `?${str}` : "";
}

export interface FeedParams {
  page?: number;
  pageSize?: number;
  sort?: FeedSort;
  lifecycle?: LifecycleStage;
  genre?: string;
}

export const api = {
  feed: (p: FeedParams = {}) => get<Paged<FeedItem>>(`/feed${qs({ ...p })}`),

  // Pulse: precomputed hot-path read. Returned payload is edge-cached by the
  // API (Cache-Control s-maxage=30 SWR 120), so client-side memoization on
  // top is unnecessary; TanStack Query's staleTime handles the rest.
  pulse: (filter: PulseFilter = "all", sort: PulseSort = "spike") =>
    get<PulsePayload>(`/pulse${qs({ filter, sort })}`),

  pulseSearch: (q: string) => get<PulseSearchResult[]>(`/search${qs({ q })}`),

  game: (id: number) => get<GameDetail>(`/games/${id}`),
  metrics: (
    id: number,
    interval: "raw" | "hour" | "day" = "hour",
    pageSize = 500,
  ) =>
    get<Paged<GameMetric>>(`/games/${id}/metrics${qs({ interval, pageSize })}`),
  stats: (id: number, pageSize = 500) =>
    get<Paged<GameStat>>(`/games/${id}/stats${qs({ pageSize })}`),
  lifecycle: (id: number) => get<LifecycleEvent[]>(`/games/${id}/lifecycle`),
  sorts: (id: number) => get<SortSnapshot[]>(`/games/${id}/sorts`),
  events: (id: number) => get<GameEvent[]>(`/games/${id}/events`),
  monetization: (id: number) => get<Monetization>(`/games/${id}/monetization`),
  demand: (id: number) => get<DemandOverlay>(`/games/${id}/demand`),
  gameTags: (id: number) => get<Tag[]>(`/games/${id}/tags`),
  notes: (id: number) => get<GameNote[]>(`/games/${id}/notes`),

  // Game-note authoring (auth required; author-gated at the API).
  createNote: (id: number, input: CreateGameNoteInput) =>
    post<GameNote>(`/games/${id}/notes`, input),
  patchNote: (noteId: string, input: PatchGameNoteInput) =>
    patch<GameNote>(`/notes/${noteId}`, input),
  deleteNote: (noteId: string) => del(`/notes/${noteId}`),

  /* ----------------------------- scoped realm --------------------------- */

  projects: () => get<Project[]>("/projects"),
  project: (id: string) => get<ProjectDetail>(`/projects/${id}`),
  createProject: (input: CreateProjectInput) =>
    post<ProjectDetail>("/projects", input),
  patchProject: (id: string, input: PatchProjectInput) =>
    patch<Project>(`/projects/${id}`, input),
  deleteProject: (id: string) => del(`/projects/${id}`),

  members: (id: string) => get<Membership[]>(`/projects/${id}/members`),
  addMember: (id: string, email: string) =>
    post<Membership>(`/projects/${id}/members`, { email }),
  removeMember: (id: string, userId: string) =>
    del(`/projects/${id}/members/${userId}`),

  // Board.
  board: (id: string) => get<Board>(`/projects/${id}/board`),
  createTask: (id: string, input: CreateTaskInput) =>
    post<Task>(`/projects/${id}/tasks`, input),
  patchTask: (taskId: string, input: PatchTaskInput) =>
    patch<Task>(`/tasks/${taskId}`, input),
  moveTask: (taskId: string, input: MoveTaskInput) =>
    patch<Task>(`/tasks/${taskId}/move`, input),
  reorderTask: (taskId: string, input: ReorderTaskInput) =>
    patch<Task>(`/tasks/${taskId}/reorder`, input),
  createSubtask: (taskId: string, input: CreateSubtaskInput) =>
    post<Task>(`/tasks/${taskId}/subtasks`, input),
  deleteTask: (taskId: string) => del(`/tasks/${taskId}`),

  // Milestones.
  createMilestone: (id: string, input: CreateMilestoneInput) =>
    post<Milestone>(`/projects/${id}/milestones`, input),
  patchMilestone: (milestoneId: string, input: PatchMilestoneInput) =>
    patch<Milestone>(`/milestones/${milestoneId}`, input),
  deleteMilestone: (milestoneId: string) => del(`/milestones/${milestoneId}`),

  // Docs.
  docs: (id: string) => get<Doc[]>(`/projects/${id}/docs`),
  doc: (docId: string) => get<Doc>(`/docs/${docId}`),
  createDoc: (id: string, input: CreateDocInput) =>
    post<Doc>(`/projects/${id}/docs`, input),
  patchDoc: (docId: string, input: PatchDocInput) =>
    patch<Doc>(`/docs/${docId}`, input),
  deleteDoc: (docId: string) => del(`/docs/${docId}`),

  // Doc folders.
  docFolders: (id: string) => get<DocFolder[]>(`/projects/${id}/doc-folders`),
  createDocFolder: (id: string, input: CreateDocFolderInput) =>
    post<DocFolder>(`/projects/${id}/doc-folders`, input),
  patchDocFolder: (folderId: string, input: PatchDocFolderInput) =>
    patch<DocFolder>(`/doc-folders/${folderId}`, input),
  deleteDocFolder: (folderId: string) => del(`/doc-folders/${folderId}`),

  // Project notes.
  projectNotes: (id: string) => get<ProjectNote[]>(`/projects/${id}/notes`),
  createProjectNote: (id: string, input: CreateNoteInput) =>
    post<ProjectNote>(`/projects/${id}/notes`, input),
  patchProjectNote: (noteId: string, input: PatchNoteInput) =>
    patch<ProjectNote>(`/project-notes/${noteId}`, input),
  deleteProjectNote: (noteId: string) => del(`/project-notes/${noteId}`),

  // Pinned tracker games.
  projectGames: (id: string) => get<ProjectGame[]>(`/projects/${id}/games`),
  linkGame: (id: string, input: CreateProjectGameInput) =>
    post<ProjectGame>(`/projects/${id}/games`, input),
  unlinkGame: (id: string, universeId: number) =>
    del(`/projects/${id}/games/${universeId}`),

  // Card detail modal.
  cardDetail: (taskId: string) => get<TaskDetail>(`/tasks/${taskId}/detail`),
  cardLinkedNotes: (taskId: string) =>
    get<LinkedNote[]>(`/tasks/${taskId}/linked-notes`),

  createComment: (taskId: string, input: CreateCommentInput) =>
    post<TaskComment>(`/tasks/${taskId}/comments`, input),
  patchComment: (commentId: string, input: PatchCommentInput) =>
    patch<TaskComment>(`/comments/${commentId}`, input),
  deleteComment: (commentId: string) => del(`/comments/${commentId}`),

  createChecklistItem: (taskId: string, input: CreateChecklistItemInput) =>
    post<TaskChecklistItem>(`/tasks/${taskId}/checklist`, input),
  patchChecklistItem: (itemId: string, input: PatchChecklistItemInput) =>
    patch<TaskChecklistItem>(`/checklist/${itemId}`, input),
  deleteChecklistItem: (itemId: string) => del(`/checklist/${itemId}`),

  requestAttachmentUpload: (
    taskId: string,
    input: { fileName: string; mimeType: string; sizeBytes: number },
  ) =>
    post<AttachmentUploadTicket>(`/tasks/${taskId}/attachments/upload-url`, input),
  confirmAttachment: (
    taskId: string,
    input: {
      attachmentId: string;
      fileName: string;
      mimeType: string;
      sizeBytes: number;
    },
  ) => post<TaskAttachment>(`/tasks/${taskId}/attachments/confirm`, input),
  attachmentViewUrl: (attachmentId: string) =>
    get<AttachmentViewTicket>(`/attachments/${attachmentId}/url`),
  deleteAttachment: (attachmentId: string) =>
    del(`/attachments/${attachmentId}`),

  // Card tags — per-project vocabulary + per-card application.
  projectTags: (projectId: string) =>
    get<ProjectTag[]>(`/projects/${projectId}/tags`),
  createProjectTag: (projectId: string, input: CreateProjectTagInput) =>
    post<ProjectTag>(`/projects/${projectId}/tags`, input),
  patchProjectTag: (tagId: string, input: PatchProjectTagInput) =>
    patch<ProjectTag>(`/project-tags/${tagId}`, input),
  deleteProjectTag: (tagId: string) => del(`/project-tags/${tagId}`),
  applyTaskTag: (taskId: string, tagId: string) =>
    post<ProjectTag>(`/tasks/${taskId}/tags`, { tagId }),
  removeTaskTag: (taskId: string, tagId: string) =>
    del(`/tasks/${taskId}/tags/${tagId}`),
};
