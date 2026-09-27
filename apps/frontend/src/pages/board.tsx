import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import axios from "axios";
import { useNavigate, useParams } from "react-router-dom";
import { useBoardPresence } from "../hooks/useBoardPresence";
import IssueModal from "./issue.tsx";
import {
  PART_LABEL,
  SECTION_META,
  SECTION_ORDER,
  type BoardPart,
  type Issue,
  type IssuesBySection,
  type SectionKey,
} from "./types";
import "./board.css";

/**
 * Board.tsx
 *
 * A single, reusable board page for an organization's TeamPulse dashboard.
 * The same component renders the Frontend, Backend, or DevOps board — only
 * `organizationName` and `boardPart` change. Each of the three sections
 * (Upcoming / In Progress / Done) has its own "+ Add issue" control, and
 * clicking any issue card opens a popup (IssueModal) where the team can
 * read and post comments on that issue.
 *
 * Local state drives everything by default so this works standalone; the
 * optional onIssueAdd / onCommentAdd / onIssueMove callbacks are where you'd
 * hook in the project's REST + WebSocket layer (REST call for the mutation,
 * then rely on the /notify broadcast to keep other tabs in sync).
 */

export interface BoardProps {
  boardId: string;
  organizationName: string;
  boardPart: BoardPart;
  sectionIds: Record<SectionKey, string>;
  currentUserName?: string;
  initialIssues?: Partial<IssuesBySection>;
  onIssueAdd?: (section: SectionKey, issue: Issue) => void;
  onIssueMove?: (issueId: string, from: SectionKey, to: SectionKey) => void;
  onCommentAdd?: (issueId: string, text: string, author: string) => void;
}

function emptySections(): IssuesBySection {
  return { upcoming: [], inProgress: [], done: [] };
}

export default function Board({
  boardId,
  organizationName,
  boardPart,
  sectionIds,
  currentUserName = "You",
  initialIssues,
  onIssueAdd,
  onIssueMove,
  onCommentAdd,
}: BoardProps) {
  const [issues, setIssues] = useState<IssuesBySection>(() => ({
    ...emptySections(),
    ...initialIssues,
  }));
  const [openComposer, setOpenComposer] = useState<SectionKey | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [saveError, setSaveError] = useState("");
  const activeUserCount = useBoardPresence(boardId);
  const [selected, setSelected] = useState<{ section: SectionKey; issueId: string } | null>(
    null
  );

  

  const issueCount = useMemo(
    () => SECTION_ORDER.reduce((sum, key) => sum + issues[key].length, 0),
    [issues]
  );

  const nextIssueNumber = issueCount + 1;

  const handleOpenComposer = useCallback((section: SectionKey) => {
    setOpenComposer(section);
    setDraftTitle("");
  }, []);

  const handleCloseComposer = useCallback(() => {
    setOpenComposer(null);
    setDraftTitle("");
  }, []);

  const handleAddIssue = useCallback(
    async (event: FormEvent, section: SectionKey) => {
      event.preventDefault();
      const title = draftTitle.trim();
      if (!title) return;

      setSaveError("");
      try {
        const token = sessionStorage.getItem("authToken");
        const response = await axios.post(
          `http://localhost:4000/api/v1/issue/${sectionIds[section]}`,
          { title, description: "" },
          { headers: { Authorization: token ?? "" } },
        );
        const savedIssue = response.data.data;
        const issue: Issue = {
          id: savedIssue.id,
          number: nextIssueNumber,
          title: savedIssue.title,
          comments: [],
          createdAt: savedIssue.createdAt ?? "",
        };

        setIssues((prev) => ({ ...prev, [section]: [...prev[section], issue] }));
        onIssueAdd?.(section, issue);
        setDraftTitle("");
        setOpenComposer(null);
      } catch (requestError) {
        setSaveError(
          axios.isAxiosError(requestError)
            ? requestError.response?.data?.error || "Unable to save issue."
            : "Unable to save issue.",
        );
      }
    },
    [draftTitle, nextIssueNumber, onIssueAdd, sectionIds]
  );

  const handleAdvanceIssue = useCallback(
    async (section: SectionKey, issueId: string) => {
      const next = SECTION_META[section].next;
      if (!next) return;

      setSaveError("");
      try {
        const token = sessionStorage.getItem("authToken");
        await axios.put(
          `http://localhost:4000/api/v1/issue/move/${issueId}/${sectionIds[next]}`,
          {},
          { headers: { Authorization: token ?? "" } },
        );
        setIssues((prev) => {
          const issue = prev[section].find((item) => item.id === issueId);
          if (!issue) return prev;
          return { ...prev, [section]: prev[section].filter((item) => item.id !== issueId), [next]: [...prev[next], issue] };
        });
        onIssueMove?.(issueId, section, next);
      } catch (requestError) {
        setSaveError(
          axios.isAxiosError(requestError)
            ? requestError.response?.data?.error || "Unable to move issue."
            : "Unable to move issue.",
        );
      }
    },
    [onIssueMove, sectionIds]
  );

  const handleAddComment = useCallback(
    async (issueId: string, text: string) => {
      const token = sessionStorage.getItem("authToken");
      try {
        const response = await axios.post(
          `http://localhost:4000/api/v1/comment/${issueId}`,
          { comment: text },
          { headers: { Authorization: token ?? "" } },
        );
        const savedComment = response.data.data;
        setIssues((prev) => {
          const updated: IssuesBySection = { ...prev };
          for (const key of SECTION_ORDER) {
            updated[key] = updated[key].map((issue) =>
              issue.id === issueId
                ? {
                    ...issue,
                    comments: [
                      ...issue.comments,
                      {
                        id: savedComment.id,
                        author: savedComment.user?.email ?? currentUserName,
                        text: savedComment.comment,
                        createdAt: savedComment.createdAt ?? "",
                      },
                    ],
                  }
                : issue
            );
          }
          return updated;
        });
        onCommentAdd?.(issueId, text, currentUserName);
      } catch (requestError) {
        const message = axios.isAxiosError(requestError)
          ? requestError.response?.data?.error || "Unable to save comment."
          : "Unable to save comment.";
        throw new Error(message);
      }
    },
    [currentUserName, onCommentAdd]
  );

  const handleRefreshComments = useCallback(async (issueId: string) => {
    const token = sessionStorage.getItem("authToken");
    const response = await axios.get(
      `http://localhost:4000/api/v1/comment/${issueId}`,
      { headers: { Authorization: token ?? "" } },
    );
    const comments = (response.data.data ?? []).map((comment: {
      id: string;
      comment: string;
      user?: { email?: string };
    }) => ({
      id: comment.id,
      author: comment.user?.email ?? "Team member",
      text: comment.comment,
      createdAt: "",
    }));

    setIssues((prev) => {
      const updated: IssuesBySection = { ...prev };
      for (const key of SECTION_ORDER) {
        updated[key] = updated[key].map((issue) =>
          issue.id === issueId ? { ...issue, comments } : issue,
        );
      }
      return updated;
    });
  }, []);

  const selectedIssue =
    selected && issues[selected.section].find((issue) => issue.id === selected.issueId);

  return (
    <div className="board-page">
      <header className="board-navbar">
        <div className="board-navbar__crumb">
          <span className="board-navbar__org">{organizationName}</span>
          <span className="board-navbar__sep" aria-hidden="true">
            /
          </span>
          <span className={`board-navbar__part board-navbar__part--${boardPart}`}>
            {PART_LABEL[boardPart]}
          </span>
        </div>
        <div className="board-navbar__meta">
          <span>{issueCount} issue{issueCount === 1 ? "" : "s"}</span>
          <span aria-live="polite">
            {activeUserCount === null
              ? "connecting…"
              : `${activeUserCount} active user${activeUserCount === 1 ? "" : "s"}`}
          </span>
        </div>
      </header>

      {saveError && <p className="board-error" role="alert">{saveError}</p>}

      <main className="board-columns">
        {SECTION_ORDER.map((section) => {
          const meta = SECTION_META[section];
          const sectionIssues = issues[section];
          const isComposerOpen = openComposer === section;

          return (
            <section
              key={section}
              className={`board-column board-column--${section}`}
              aria-labelledby={`board-column-heading-${section}`}
            >
              <div className="board-column__header">
                <h2 id={`board-column-heading-${section}`} className="board-column__title">
                  {meta.label}
                </h2>
                <span className="board-column__count">{sectionIssues.length}</span>
              </div>

              <ul className="board-column__list">
                {sectionIssues.map((issue) => (
                  <li key={issue.id}>
                    <button
                      type="button"
                      className="board-issue"
                      onClick={() => setSelected({ section, issueId: issue.id })}
                    >
                      <span className="board-issue__number">Issue {issue.number}</span>
                      <span className="board-issue__title">{issue.title}</span>
                      {issue.comments.length > 0 && (
                        <span className="board-issue__comment-count">
                          {issue.comments.length} comment{issue.comments.length === 1 ? "" : "s"}
                        </span>
                      )}
                    </button>
                    {meta.next && (
                      <button
                        type="button"
                        className="board-issue__advance"
                        onClick={() => handleAdvanceIssue(section, issue.id)}
                      >
                        Move to {SECTION_META[meta.next].label} →
                      </button>
                    )}
                  </li>
                ))}

                {sectionIssues.length === 0 && !isComposerOpen && (
                  <li className="board-column__empty">No issues yet.</li>
                )}
              </ul>

              {isComposerOpen ? (
                <form
                  className="board-composer"
                  onSubmit={(event) => handleAddIssue(event, section)}
                >
                  <input
                    autoFocus
                    type="text"
                    className="board-composer__input"
                    placeholder="Issue title"
                    value={draftTitle}
                    onChange={(event) => setDraftTitle(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") handleCloseComposer();
                    }}
                  />
                  <div className="board-composer__actions">
                    <button type="submit" className="board-composer__submit">
                      Add issue
                    </button>
                    <button
                      type="button"
                      className="board-composer__cancel"
                      onClick={handleCloseComposer}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  type="button"
                  className="board-column__add"
                  onClick={() => handleOpenComposer(section)}
                >
                  + Add issue
                </button>
              )}
            </section>
          );
        })}
      </main>

      {selectedIssue && (
        <IssueModal
          issue={selectedIssue}
          currentUserName={currentUserName}
          onAddComment={handleAddComment}
          onRefreshComments={handleRefreshComments}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

const BOARD_PARTS: BoardPart[] = ["frontend", "backend", "devops"];

export function BoardRoute() {
  const { orgId, boardPart } = useParams();
  const navigate = useNavigate();
  const [organizationName, setOrganizationName] = useState("Loading...");
  const [error, setError] = useState("");
  const [boardData, setBoardData] = useState<{
    boardId: string;
    sectionIds: Record<SectionKey, string>;
    issues: IssuesBySection;
  } | null>(null);

  useEffect(() => {
    if (!orgId || !boardPart || !BOARD_PARTS.includes(boardPart as BoardPart)) {
      navigate("/", { replace: true });
      return;
    }

    const fetchOrganization = async () => {
      try {
        const token = sessionStorage.getItem("authToken");
        const headers = { Authorization: token ?? "" };
        const [response, sectionsResponse] = await Promise.all([
          axios.get(
            `http://localhost:4000/api/v1/organization/${encodeURIComponent(orgId)}`,
            { headers },
          ).catch((requestError) => {
            throw new Error(`Organization request failed: ${getRequestErrorMessage(requestError)}`);
          }),
          axios.get(
            `http://localhost:4000/api/v1/section?orgId=${encodeURIComponent(orgId)}`,
            { headers },
          ).catch((requestError) => {
            throw new Error(`Board request failed: ${getRequestErrorMessage(requestError)}`);
          }),
        ]);
        const organization = response.data.data?.membership?.organization;

        if (!response.data.success || !organization) {
          setError("Organization not found.");
          return;
        }

        setOrganizationName(organization.name);
        const boards = sectionsResponse.data.data ?? [];
        const normalizedPart = boardPart.toLowerCase();
        const board = boards.find((item: { title: string }) =>
          item.title.toLowerCase().includes(normalizedPart),
        );

        if (!board) {
          setError(`The ${PART_LABEL[boardPart as BoardPart]} board has not been created yet.`);
          return;
        }

        const sectionIds = getSectionIds(board.section ?? []);
        if (Object.values(sectionIds).some((sectionId) => !sectionId)) {
          setError("This board needs Upcoming, In progress, and Done sections before it can be used.");
          return;
        }
        const issues = emptySections();
        const loadedSections = await Promise.all(SECTION_ORDER.map(async (section) => {
          const issueResponse = await axios.get(
            `http://localhost:4000/api/v1/issue/section/${sectionIds[section]}`,
            { headers },
          ).catch((requestError) => {
            throw new Error(`Issue request failed: ${getRequestErrorMessage(requestError)}`);
          });
          const savedIssues = issueResponse.data.data ?? [];
          const sectionIssues = savedIssues.map((savedIssue: {
            id: string;
            title: string;
            createdAt?: string;
            comments?: Array<{ id: string; comment: string; user?: { email?: string } }>;
          }, index: number) => ({
                id: savedIssue.id,
                number: index + 1,
                title: savedIssue.title,
                createdAt: savedIssue.createdAt ?? "",
                comments: (savedIssue.comments ?? []).map((comment) => ({
                  id: comment.id,
                  author: comment.user?.email ?? "Team member",
                  text: comment.comment,
                  createdAt: "",
                })),
              }));
          return { section, issues: sectionIssues };
        }));
        for (const loadedSection of loadedSections) {
          issues[loadedSection.section] = loadedSection.issues;
        }
        setBoardData({ boardId: board.id, sectionIds, issues });
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Unable to load board.");
      }
    };

    void fetchOrganization();
  }, [boardPart, navigate, orgId]);

  if (error) {
    return <div className="board-page board-route-error">{error}</div>;
  }

  if (!orgId || !boardPart || !BOARD_PARTS.includes(boardPart as BoardPart)) {
    return null;
  }

  if (!boardData) {
    return <div className="board-page board-route-loading">Loading board...</div>;
  }

  return (
    <Board
      boardId={boardData.boardId}
      organizationName={organizationName}
      boardPart={boardPart as BoardPart}
      sectionIds={boardData.sectionIds}
      initialIssues={boardData.issues}
    />
  );
}

function getRequestErrorMessage(requestError: unknown): string {
  if (axios.isAxiosError(requestError)) {
    return requestError.response?.data?.error || requestError.message;
  }
  return requestError instanceof Error ? requestError.message : "Unexpected error.";
}

function getSectionIds(
  sections: Array<{ id: string; title: string }>,
): Record<SectionKey, string> {
  const byTitle = new Map(sections.map((section) => [section.title.toLowerCase(), section.id]));
  const findSection = (names: string[], fallbackIndex: number) =>
    names.map((name) => byTitle.get(name)).find(Boolean) ?? sections[fallbackIndex]?.id;

  return {
    upcoming: findSection(["upcoming", "todo", "to do", "backlog"], 0) ?? "",
    inProgress: findSection(["in progress", "in-progress", "progress"], 1) ?? "",
    done: findSection(["done", "completed", "complete"], 2) ?? "",
  };
}