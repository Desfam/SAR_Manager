import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RotateCcw, TriangleAlert } from 'lucide-react';

/** Keeps title bar and sidebar usable when a page crashes, instead of a blank window */
export class PageErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Page crashed', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto mt-16 max-w-xl rounded-3xl border border-bad/30 bg-bad/[0.06] p-8 text-center">
        <TriangleAlert className="mx-auto mb-3 size-7 text-bad" />
        <p className="text-[16px] font-semibold">Diese Seite ist abgestürzt</p>
        <p className="mt-2 break-words font-mono text-[12px] text-muted">{this.state.error.message}</p>
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          className="mx-auto mt-5 flex h-10 items-center gap-2 rounded-full border border-line/[0.14] px-4 text-[13px] hover:bg-raised"
        >
          <RotateCcw className="size-4" /> Neu laden
        </button>
      </div>
    );
  }
}
