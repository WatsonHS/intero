import { ArrowClockwiseIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { Component, type ErrorInfo, type ReactNode } from "react";

export class RouteErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: true } {
    return { failed: true };
  }

  override componentDidCatch(_error: unknown, _info: ErrorInfo) {
    // The shell intentionally renders a privacy-safe state. Error reporters
    // may attach request IDs outside this boundary, but route content, query
    // data, and component props must never be echoed into the UI.
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        className="grid h-full place-items-center bg-bg p-8"
        data-testid="route-error"
        role="alert"
      >
        <div className="max-w-[440px] rounded-container border border-danger-soft bg-panel2 p-6 text-center">
          <WarningCircleIcon
            size={24}
            weight="fill"
            className="mx-auto text-danger"
          />
          <strong className="mt-3 block text-[16px] font-[630]">
            这个页面没有完整打开
          </strong>
          <p className="mt-2 text-[11.5px] leading-[1.7] text-ink-muted">
            其他页面与已保存数据不受影响。可以安全重试当前页面；若持续失败，请在诊断中心查看服务状态。
          </p>
          <p className="mt-2 font-mono text-[10px] text-danger">
            ROUTE_RENDER_FAILED
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 inline-flex h-9 items-center gap-2 rounded-btn border-0 bg-accent-strong px-4 text-[11.5px] font-[620] text-on-accent"
          >
            <ArrowClockwiseIcon size={13} />
            重试当前页面
          </button>
        </div>
      </div>
    );
  }
}
