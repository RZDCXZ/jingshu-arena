import {
  ArrowRight,
  CaretDown,
  Check,
  CircleNotch,
  Info,
  MagnifyingGlass,
  Warning,
  X,
} from "@phosphor-icons/react";
import { useEffect, useRef } from "react";

export function Brand({ compact = false, onClick }) {
  const content = (
    <>
      <img src="/assets/jingshu-mark.png" alt="" className="brand-mark" />
      {!compact && (
        <span className="brand-type">
          <strong>竞枢</strong>
          <span>JINGSHU ARENA</span>
        </span>
      )}
    </>
  );

  if (onClick) {
    return (
      <button
        className="brand brand-button"
        onClick={onClick}
        aria-label="返回公开演示入口"
      >
        {content}
      </button>
    );
  }

  return <div className="brand">{content}</div>;
}

export function Button({
  children,
  tone = "secondary",
  icon: Icon,
  trailing: Trailing,
  loading = false,
  className = "",
  ...props
}) {
  return (
    <button className={`button button-${tone} ${className}`} {...props}>
      {loading ? (
        <CircleNotch className="spin" weight="bold" />
      ) : Icon ? (
        <Icon weight="bold" />
      ) : null}
      <span>{children}</span>
      {Trailing ? <Trailing weight="bold" /> : null}
    </button>
  );
}

export function IconButton({ label, icon: Icon, className = "", ...props }) {
  return (
    <button
      className={`icon-button ${className}`}
      aria-label={label}
      title={label}
      {...props}
    >
      <Icon weight="regular" />
    </button>
  );
}

export function statusTone(status = "") {
  if (/已完成|已关闭|已到店|正常|允许|成功|已模拟签到|生效中/.test(status))
    return "success";
  if (/已确认|已模拟支付|待取|实时|制作中/.test(status)) return "info";
  if (/使用中|处理中|待验证|待提交|低库存|迟到|较高/.test(status))
    return "warning";
  if (/紧急|异常|拒绝|已过期|已取消|失效|维护/.test(status)) return "danger";
  return "neutral";
}

export function StatusPill({ children, tone, dot = false }) {
  const resolved = tone || statusTone(String(children));
  return (
    <span className={`status-pill status-${resolved}`}>
      {dot && <span className="status-dot" aria-hidden="true" />}
      {children}
    </span>
  );
}

export function Surface({
  children,
  className = "",
  as: Tag = "section",
  ...props
}) {
  return (
    <Tag className={`surface ${className}`} {...props}>
      {children}
    </Tag>
  );
}

export function SectionHeading({ title, eyebrow, count, action, icon: Icon }) {
  return (
    <div className="section-heading">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h2>
          {Icon && <Icon weight="regular" aria-hidden="true" />}
          {title}
        </h2>
      </div>
      <div className="section-heading-actions">
        {count !== undefined && <span className="count-badge">{count}</span>}
        {action}
      </div>
    </div>
  );
}

export function FilterBar({
  children,
  search,
  onSearch,
  placeholder = "搜索",
}) {
  return (
    <div className="filter-bar">
      <label className="search-field">
        <MagnifyingGlass aria-hidden="true" />
        <span className="sr-only">{placeholder}</span>
        <input
          value={search ?? ""}
          onChange={(event) => onSearch?.(event.target.value)}
          placeholder={placeholder}
        />
      </label>
      <div className="filter-controls">{children}</div>
    </div>
  );
}

export function Select({ label, children, value, onChange, className = "" }) {
  return (
    <label className={`select-control ${className}`}>
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        aria-label={label}
      >
        {children}
      </select>
      <CaretDown weight="bold" aria-hidden="true" />
    </label>
  );
}

export function Tabs({ items, value, onChange, ariaLabel = "页面分段" }) {
  return (
    <div className="tabs" role="tablist" aria-label={ariaLabel}>
      {items.map((item) => {
        const [id, label, count] = item;
        return (
          <button
            key={id}
            role="tab"
            aria-selected={value === id}
            className={value === id ? "is-active" : ""}
            onClick={() => onChange(id)}
          >
            {label}
            {count !== undefined && <span>{count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function DataTable({
  columns,
  rows,
  rowKey,
  selectedKey,
  onRowClick,
  emptyText = "当前筛选下没有记录",
}) {
  if (!rows.length)
    return <EmptyState title={emptyText} body="可以调整筛选条件后重试。" />;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const key =
              typeof rowKey === "function" ? rowKey(row) : row[rowKey];
            return (
              <tr
                key={key}
                className={`${onRowClick ? "is-clickable" : ""} ${selectedKey === key ? "is-selected" : ""}`}
                onClick={() => onRowClick?.(row)}
                tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={(event) => {
                  if (
                    onRowClick &&
                    (event.key === "Enter" || event.key === " ")
                  ) {
                    event.preventDefault();
                    onRowClick(row);
                  }
                }}
              >
                {columns.map((column) => (
                  <td key={column.key}>
                    {column.render ? column.render(row) : row[column.key]}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function MetricCard({
  label,
  value,
  delta,
  detail,
  tone = "cyan",
  onClick,
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag className={`metric-card metric-${tone}`} onClick={onClick}>
      <span className="metric-label">
        {label} <Info aria-hidden="true" />
      </span>
      <span className="metric-value">{value}</span>
      <span className="metric-foot">
        <b>{delta}</b>
        {detail}
      </span>
    </Tag>
  );
}

export function EmptyState({ title, body, action }) {
  return (
    <div className="empty-state">
      <Info weight="duotone" aria-hidden="true" />
      <strong>{title}</strong>
      <p>{body}</p>
      {action}
    </div>
  );
}

export function InlineNotice({
  tone = "info",
  title,
  children,
  action,
  className = "",
}) {
  const Icon =
    tone === "danger" || tone === "warning"
      ? Warning
      : tone === "success"
        ? Check
        : Info;
  return (
    <div
      className={`inline-notice notice-${tone} ${className}`.trim()}
      role={tone === "danger" ? "alert" : "status"}
    >
      <Icon weight="fill" aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        {children && <p>{children}</p>}
      </div>
      {action && <div className="notice-action">{action}</div>}
    </div>
  );
}

export function Modal({
  title,
  eyebrow,
  children,
  onClose,
  footer,
  size = "medium",
}) {
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const returnTarget = document.activeElement;
    const dialog = dialogRef.current;
    const focusableSelector =
      "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";
    dialog?.querySelector(focusableSelector)?.focus();

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = [...dialog.querySelectorAll(focusableSelector)];
      const first = focusable.at(0);
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    dialog?.addEventListener("keydown", handleKeyDown);
    return () => {
      dialog?.removeEventListener("keydown", handleKeyDown);
      if (returnTarget instanceof HTMLElement) returnTarget.focus();
    };
  }, []);

  return (
    <div
      className="overlay"
      role="presentation"
      onMouseDown={(event) =>
        event.target === event.currentTarget && onClose?.()
      }
    >
      <section
        className={`modal modal-${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        ref={dialogRef}
      >
        <header className="modal-header">
          <div>
            {eyebrow && <span className="eyebrow">{eyebrow}</span>}
            <h2 id="modal-title">{title}</h2>
          </div>
          <IconButton label="关闭" icon={X} onClick={onClose} />
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </section>
    </div>
  );
}

export function Drawer({ title, children, onClose, footer, width = "wide" }) {
  return (
    <div
      className="overlay drawer-overlay"
      role="presentation"
      onMouseDown={(event) =>
        event.target === event.currentTarget && onClose?.()
      }
    >
      <aside
        className={`drawer drawer-${width}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
      >
        <header className="drawer-header">
          <h2 id="drawer-title">{title}</h2>
          <IconButton label="关闭" icon={X} onClick={onClose} />
        </header>
        <div className="drawer-body">{children}</div>
        {footer && <footer className="drawer-footer">{footer}</footer>}
      </aside>
    </div>
  );
}

export function Toast({ tone = "success", children, onClose }) {
  const Icon = tone === "success" ? Check : tone === "danger" ? Warning : Info;
  return (
    <div className={`toast toast-${tone}`} role="status">
      <Icon weight="bold" aria-hidden="true" />
      <span>{children}</span>
      <IconButton label="关闭提示" icon={X} onClick={onClose} />
    </div>
  );
}

export function Definition({ label, children }) {
  return (
    <details className="definition">
      <summary>
        {label}
        <Info aria-hidden="true" />
      </summary>
      <p>{children}</p>
    </details>
  );
}

export function Timeline({ items, compact = false }) {
  return (
    <ol className={`timeline ${compact ? "timeline-compact" : ""}`}>
      {items.map((item, index) => (
        <li
          key={`${item.time}-${item.title}-${index}`}
          className={item.pending ? "is-pending" : "is-complete"}
        >
          <span className="timeline-marker">
            {item.pending ? index + 1 : <Check weight="bold" />}
          </span>
          <div className="timeline-content">
            <time>{item.time}</time>
            <strong>{item.title}</strong>
            {item.meta && <small>{item.meta}</small>}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function SummaryRow({
  icon: Icon,
  title,
  children,
  onClick,
  danger = false,
}) {
  return (
    <button
      className={`summary-row ${danger ? "is-danger" : ""}`}
      onClick={onClick}
    >
      <span className="summary-title">
        <Icon weight="regular" />
        {title}
      </span>
      <span className="summary-content">{children}</span>
      <ArrowRight weight="bold" aria-hidden="true" />
    </button>
  );
}

export function ChartTooltip({ active, payload, label, formatter }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <strong>{label}</strong>
      {payload.map((item) => (
        <span key={item.dataKey}>
          <i style={{ backgroundColor: item.color }} />
          {item.name} <b>{formatter ? formatter(item.value) : item.value}</b>
        </span>
      ))}
    </div>
  );
}
