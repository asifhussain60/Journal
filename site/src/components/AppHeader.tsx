import { Link } from "react-router-dom";
import { ThemeSwitcher } from "./ThemeSwitcher";

// Shared top chrome: wordmark (links home) + theme switcher. Kept intentionally
// light so reading surfaces stay calm.
export function AppHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line/60 bg-bg/70 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link to="/" className="flex flex-col leading-none">
          <span className="font-script text-2xl text-accent">Asif's Journal</span>
          <span className="mt-1 text-[0.65rem] uppercase tracking-[0.2em] text-text-muted">
            What I Wish Babu Taught Me
          </span>
        </Link>
        <ThemeSwitcher />
      </div>
    </header>
  );
}
