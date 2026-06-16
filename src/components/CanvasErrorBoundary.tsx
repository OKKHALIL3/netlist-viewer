import { Component, type ReactNode } from 'react';

interface Props {
  /** Re-mount the boundary (clearing the error) whenever this changes — so
      navigating to a different cell recovers automatically after a crash. */
  resetKey: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

// A render error anywhere in the schematic canvas (an unexpected cell shape, a
// React Flow internal throw on a very large graph, etc.) used to unmount the
// whole app to a blank screen. This catches it, keeps the rest of the UI
// (hierarchy, inspector, breadcrumb) alive so the user can navigate elsewhere,
// and shows what went wrong instead of a silent white-out.
export class CanvasErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prev: Props) {
    // Navigated to a different cell after a crash — drop the error and retry.
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="canvas-error">
          <div className="canvas-error-title">Couldn’t draw this cell</div>
          <p className="canvas-error-msg">{this.state.error.message}</p>
          <p className="canvas-error-hint">
            Pick another cell in the hierarchy or breadcrumb to keep going.
          </p>
          <button className="btn-secondary" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
