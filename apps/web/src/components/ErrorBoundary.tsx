import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Alert, Button } from './ui/index.js';

interface State {
  error: Error | undefined;
}

/**
 * Contains a rendering error to the screen that raised it: the navigation and the rest of the
 * shell keep working, and the user sees what failed instead of a blank page. Remount it (a `key`
 * per route) to clear the error when the user navigates elsewhere.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: undefined };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('screen failed to render', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="p-4">
        <Alert title="This screen failed to render">
          <p className="mb-2">{error.message}</p>
          <Button size="sm" variant="outline" onClick={() => this.setState({ error: undefined })}>
            Try again
          </Button>
        </Alert>
      </div>
    );
  }
}
