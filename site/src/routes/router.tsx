import { createBrowserRouter } from "react-router-dom";
import { lazy, Suspense } from "react";
import { HomePage } from "./HomePage";

// One chapter view: the always-editable editor (CodeMirror + operations). Both
// /read and /edit resolve to it — there is no separate read-only mode. Code-split
// so the home page stays light.
const EditorPage = lazy(() =>
  import("../features/editor/EditorPage").then((m) => ({ default: m.EditorPage })),
);

function ChapterRoute() {
  return (
    <Suspense fallback={<div className="p-10 text-sm text-text-muted">Loading…</div>}>
      <EditorPage />
    </Suspense>
  );
}

export const router = createBrowserRouter([
  { path: "/", element: <HomePage /> },
  { path: "/read/:chapterId", element: <ChapterRoute /> },
  { path: "/edit/:chapterId", element: <ChapterRoute /> },
  { path: "*", element: <HomePage /> },
]);
